// Build-time precompression of the client build: writes `<file>.br` (Brotli q11) and `<file>.gz` (gzip -9) next
// to every compressible file in dist/. The static server (server/static.ts) serves those siblings when the browser
// accepts them. Brotli q11 is ~26 % smaller than the gzip -6 the server makes on the fly for the Rapier chunks
// (1.73 → 1.28 MB each) but takes seconds per file, so it runs once at build time, never in the request path.
//   npx tsx server/precompress.ts dist        (the Dockerfile runs it after `npm run build`)
import { promises as fsp } from 'node:fs';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPRESSIBLE } from './static';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Files smaller than this are not worth an extra request header's worth of work. */
const MIN_BYTES = 1024;
/** A compressed sibling is kept only when it saves at least 10 %. */
const MAX_RATIO = 0.9;

export interface PrecompressResult { files: number; bytes: number; br: number; gz: number }

async function walk(dir: string, out: string[]): Promise<string[]> {
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walk(p, out);
    else if (d.isFile() && COMPRESSIBLE.has(path.extname(d.name).toLowerCase())) out.push(p);
  }
  return out;
}

/**
 * Precompress every compressible file under `dir`. Idempotent: `.br` / `.gz` files are not themselves inputs, and
 * a sibling that would not save 10 % is removed rather than left stale. zlib runs on the libuv pool, so files are
 * compressed in parallel.
 */
export async function precompressDir(dir: string): Promise<PrecompressResult> {
  const files = await walk(path.resolve(dir), []);
  const res: PrecompressResult = { files: 0, bytes: 0, br: 0, gz: 0 };
  await Promise.all(files.map(async (file) => {
    const body = await fsp.readFile(file);
    const [br, gz] = body.length < MIN_BYTES ? [null, null] : await Promise.all([
      brotliAsync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } }),
      gzipAsync(body, { level: 9 }),
    ]);
    const pairs: Array<[string, Buffer | null]> = [[`${file}.br`, br], [`${file}.gz`, gz]];
    let wrote = false;
    for (const [out, z] of pairs) {
      if (z && z.length <= body.length * MAX_RATIO) {
        await fsp.writeFile(out, z);
        wrote = true;
        if (out.endsWith('.br')) res.br += z.length; else res.gz += z.length;
      } else {
        await fsp.rm(out, { force: true });
      }
    }
    if (wrote) { res.files++; res.bytes += body.length; }
  }));
  return res;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2] ?? 'dist';
  const t0 = Date.now();
  const r = await precompressDir(dir);
  const mb = (n: number) => (n / 1e6).toFixed(2);
  console.log(`[precompress] ${r.files} files, ${mb(r.bytes)} MB → br ${mb(r.br)} MB · gz ${mb(r.gz)} MB (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
