// Build-time precompression (server/precompress.ts) and how the static server picks an encoding: Brotli siblings
// when accepted, gzip -9 siblings otherwise, on-the-fly gzip when there are none; stale or symlinked siblings and
// the transformed index.html never use them.
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, utimesSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { acceptQ, createStaticHandler } from '../../server/static';
import { precompressDir } from '../../server/precompress';

const servers: http.Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await new Promise((r) => s.close(r)); });

function makeDist(): string {
  const dist = path.join(mkdtempSync(path.join(tmpdir(), 'cvc-static-')), 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), `<!doctype html><html><head></head><body>${'<p>yard</p>'.repeat(200)}</body></html>`);
  writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'export const bark = () => console.log("woof");\n'.repeat(500));
  writeFileSync(path.join(dist, 'assets', 'tiny.js'), 'export {};\n');
  writeFileSync(path.join(dist, 'assets', 'font.woff2'), Buffer.alloc(4096, 7));
  return dist;
}

async function serve(dist: string, transformHtml?: (h: string) => string): Promise<string> {
  const handler = createStaticHandler(dist, { transformHtml });
  const s = http.createServer((req, res) => { void handler(req, res); });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}

function get(url: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('build-time precompression', () => {
  it('writes .br and .gz next to compressible files worth it; skips tiny and binary files; re-runs are idempotent', async () => {
    const dist = makeDist();
    const app = path.join(dist, 'assets', 'app-abc123.js');
    const r = await precompressDir(dist);
    expect(r.files).toBe(2); // app js + index.html
    expect(existsSync(`${app}.br`) && existsSync(`${app}.gz`)).toBe(true);
    expect(brotliDecompressSync(readFileSync(`${app}.br`)).equals(readFileSync(app))).toBe(true);
    expect(gunzipSync(readFileSync(`${app}.gz`)).equals(readFileSync(app))).toBe(true);
    expect(existsSync(path.join(dist, 'assets', 'tiny.js.br'))).toBe(false);
    expect(existsSync(path.join(dist, 'assets', 'font.woff2.br'))).toBe(false);
    const again = await precompressDir(dist);
    expect(again.files).toBe(2);
    expect(existsSync(`${app}.br.br`) || existsSync(`${app}.gz.gz`)).toBe(false);
  });
});

describe('static encoding negotiation', () => {
  it('parses Accept-Encoding q-values', () => {
    expect(acceptQ('gzip, deflate, br, zstd', 'br')).toBe(1);
    expect(acceptQ('gzip;q=0.8, br;q=0', 'br')).toBe(0);
    expect(acceptQ('gzip;q=0.8, br;q=0', 'gzip')).toBe(0.8);
    expect(acceptQ('x-gzip', 'gzip')).toBe(0);
    expect(acceptQ(undefined, 'gzip')).toBe(0);
  });

  it('serves Brotli siblings when accepted, the gzip -9 sibling otherwise, identity when neither', async () => {
    const dist = makeDist();
    await precompressDir(dist);
    const app = path.join(dist, 'assets', 'app-abc123.js');
    const u = await serve(dist);

    const br = await get(`${u}/assets/app-abc123.js`, { 'Accept-Encoding': 'gzip, deflate, br' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['vary']).toBe('Accept-Encoding');
    expect(br.headers['content-type']).toMatch(/text\/javascript/);
    expect(Number(br.headers['content-length'])).toBe(statSync(`${app}.br`).size);
    expect(brotliDecompressSync(br.body).equals(readFileSync(app))).toBe(true);

    const gz = await get(`${u}/assets/app-abc123.js`, { 'Accept-Encoding': 'gzip, br;q=0' });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gz.body.equals(readFileSync(`${app}.gz`))).toBe(true); // the build's -9 file, not an on-the-fly -6

    const plain = await get(`${u}/assets/app-abc123.js`);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.equals(readFileSync(app))).toBe(true);

    const head = await get(`${u}/assets/app-abc123.js`, { 'Accept-Encoding': 'br' }, 'HEAD');
    expect(head.body.length).toBe(0);
    expect(Number(head.headers['content-length'])).toBe(statSync(`${app}.br`).size);
  });

  it('ignores stale and symlinked siblings, and never uses them for the transformed index.html', async () => {
    const dist = makeDist();
    await precompressDir(dist);
    const app = path.join(dist, 'assets', 'app-abc123.js');
    // The file was rebuilt after its sibling was written: the sibling is stale.
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${app}.br`, old, old);
    utimesSync(`${app}.gz`, old, old);
    // A symlinked sibling pointing out of the root is never read.
    const outside = path.join(path.dirname(dist), 'secret.txt');
    writeFileSync(outside, 'top secret');
    writeFileSync(path.join(dist, 'assets', 'b.js'), 'let x = 1;\n'.repeat(400));
    symlinkSync(outside, path.join(dist, 'assets', 'b.js.br'));
    const u = await serve(dist, (h) => h.replace('<head>', '<head><meta name="cvc-ws" content="/ws">'));

    const stale = await get(`${u}/assets/app-abc123.js`, { 'Accept-Encoding': 'gzip, br' });
    expect(stale.headers['content-encoding']).toBe('gzip'); // on-the-fly from the current file
    expect(gunzipSync(stale.body).equals(readFileSync(app))).toBe(true);
    expect(stale.body.equals(readFileSync(`${app}.gz`))).toBe(false);

    const linked = await get(`${u}/assets/b.js`, { 'Accept-Encoding': 'br' });
    expect(linked.headers['content-encoding']).toBeUndefined();
    expect(linked.body.toString()).not.toContain('top secret');

    const index = await get(`${u}/`, { 'Accept-Encoding': 'gzip, br' });
    expect(index.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(index.body).toString()).toContain('cvc-ws'); // the injected meta survives compression
  });
});
