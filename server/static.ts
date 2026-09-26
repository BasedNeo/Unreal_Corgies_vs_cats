// Minimal, safe static file server for the production build (dist/): GET/HEAD only, no directory
// listing, no dotfiles, no path traversal (decoded path must stay under the root), correct MIME
// types, ETag/304, long-lived caching for Vite's hashed /assets/, gzip for compressible types
// (compressed off the event loop and cached in memory so the game loop never stalls). Brotli / gzip -9 siblings
// written at build time by server/precompress.ts (`app.js.br`, `app.js.gz`) are served when the browser accepts
// them and they are at least as new as the file.
import { promises as fsp } from 'node:fs';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const gzipAsync = promisify(gzip);

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

export const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.wasm', '.txt', '.xml', '.svg', '.gltf']);
const CACHE_LIMIT = 256 * 1024 * 1024;

interface Entry { key: string; body: Buffer; gz: Buffer | null; br: Buffer | null; type: string; etag: string; immutable: boolean }

const entryBytes = (e: Entry) => e.body.length + (e.gz?.length ?? 0) + (e.br?.length ?? 0);

/** The q-value an Accept-Encoding header gives `enc` (0 when it is absent or refused with q=0). */
export function acceptQ(header: string | string[] | undefined, enc: string): number {
  for (const part of String(header ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((x) => x.trim());
    if (name !== enc) continue;
    const q = params.find((p) => p.startsWith('q='));
    const v = q ? Number(q.slice(2)) : 1;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  return 0;
}

export interface StaticOptions {
  /** Transform index.html (e.g. inject <meta name="cvc-ws">). */
  transformHtml?: (html: string) => string;
}

export function createStaticHandler(rootDir: string, opts: StaticOptions = {}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const root = path.resolve(rootDir);
  const cache = new Map<string, Entry>();
  let cacheBytes = 0;

  const remember = (e: Entry) => {
    const size = entryBytes(e);
    if (size > CACHE_LIMIT / 4) return;
    while (cacheBytes + size > CACHE_LIMIT && cache.size) {
      const [k, v] = cache.entries().next().value as [string, Entry];
      cache.delete(k);
      cacheBytes -= entryBytes(v);
    }
    cache.set(e.key, e);
    cacheBytes += size;
  };

  async function load(file: string, mtimeMs: number, size: number, rel: string): Promise<Entry> {
    const key = `${file}:${mtimeMs}:${size}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const ext = path.extname(file).toLowerCase();
    const transformed = ext === '.html' && !!opts.transformHtml;
    let body: Buffer = await fsp.readFile(file);
    if (transformed) body = Buffer.from(opts.transformHtml!(body.toString('utf8')));
    // A build-time sibling: a regular file (lstat: never a symlink) no older than the file it compresses.
    const sibling = async (suffix: string): Promise<Buffer | null> => {
      if (transformed || !COMPRESSIBLE.has(ext)) return null;
      const s = await fsp.lstat(file + suffix).catch(() => null);
      return s?.isFile() && s.mtimeMs >= mtimeMs ? fsp.readFile(file + suffix).catch(() => null) : null;
    };
    const br = await sibling('.br');
    const gz = (await sibling('.gz')) ?? (COMPRESSIBLE.has(ext) && body.length > 1024 ? await gzipAsync(body, { level: 6 }) : null);
    const e: Entry = {
      key, body, gz: gz && gz.length < body.length * 0.9 ? gz : null, br: br && br.length < body.length * 0.9 ? br : null,
      type: MIME[ext] ?? 'application/octet-stream',
      etag: `W/"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}${ext === '.html' && opts.transformHtml ? '-t' : ''}"`,
      immutable: rel.startsWith('/assets/'),
    };
    remember(e);
    return e;
  }

  const fail = (res: ServerResponse, code: number, text: string) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(text);
  };

  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); fail(res, 405, 'method not allowed'); return; }
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      fail(res, 400, 'bad request'); return;
    }
    if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some((seg) => seg === '..' || (seg.startsWith('.') && seg !== ''))) { fail(res, 404, 'not found'); return; }
    let file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) { fail(res, 404, 'not found'); return; }
    let st = await fsp.stat(file).catch(() => null);
    if (st?.isDirectory()) { file = path.join(file, 'index.html'); st = await fsp.stat(file).catch(() => null); rel = rel.replace(/\/?$/, '/index.html'); }
    if (!st && !path.extname(rel)) { file = path.join(root, 'index.html'); rel = '/index.html'; st = await fsp.stat(file).catch(() => null); } // client routes
    if (!st || !st.isFile()) { fail(res, 404, 'not found'); return; }
    // Refuse symlinks that escape the root.
    const real = await fsp.realpath(file).catch(() => null);
    const realRoot = await fsp.realpath(root).catch(() => root);
    if (!real || (real !== realRoot && !real.startsWith(realRoot + path.sep))) { fail(res, 404, 'not found'); return; }

    const e = await load(file, st.mtimeMs, st.size, rel);
    const headers: Record<string, string> = {
      'Content-Type': e.type,
      'ETag': e.etag,
      'Cache-Control': e.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Vary': 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); res.end(); return; }
    const accept = req.headers['accept-encoding'];
    const coding = e.br && acceptQ(accept, 'br') > 0 ? 'br' : e.gz && acceptQ(accept, 'gzip') > 0 ? 'gzip' : null;
    const body = coding === 'br' ? e.br! : coding === 'gzip' ? e.gz! : e.body;
    if (coding) headers['Content-Encoding'] = coding;
    headers['Content-Length'] = String(body.length);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
