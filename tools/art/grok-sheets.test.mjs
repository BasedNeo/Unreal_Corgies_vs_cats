// W15 p-art: tests for the cap memory of tools/art/grok-sheets.mjs, against a mock image API (no real call, no cost).
// Run: node --test tools/art/grok-sheets.test.mjs
// Each test gets a temp ledger dir (W15_ART_OUT), scratch dir, a test jobs module (W15_ART_JOBS) and the mock
// (W15_ART_API). The mock records every request and, while a paid POST is in flight, what the ledger and lock looked like.
// Most tests start from a ledger seeded at the recorded floor (as the committed ledger is); FLOOR is read from the script.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'grok-sheets.mjs');
const EXPORT = join(HERE, 'w15-export.py');
const REAL_LEDGER = join(HERE, '..', '..', 'assets', 'incoming', 'w15-char-refs', 'ledger.jsonl');
const FLOOR = Number(/const PRIOR_SPEND_FLOOR_USD = ([0-9.]+);/.exec(readFileSync(SCRIPT, 'utf8'))[1]);
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const esc = (x) => String(x).replace('.', '\\.');
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PROMPT = 'a test prompt, nothing else';
const sha = (s) => createHash('sha256').update(s).digest('hex');

let server;
let port;
let state; // per test: { posts: [], during: [], ledger, lock }

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/v1/image-generation-models') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          models: [
            { id: 'mock-image', image_price: 200000000 }, // $0.02
            { id: 'mock-image-2', image_price: 600000000, pricing: [
              { quality: 'low', resolution: '1k', price_per_image: 400000000 }, // $0.04
              { quality: 'medium', resolution: '1k', price_per_image: 8000000000 }, // $0.80 (to reach the stop line)
            ] },
          ],
        }));
        return;
      }
      if (req.method === 'POST' && req.url.startsWith('/v1/images/')) {
        const j = JSON.parse(body);
        state.posts.push(j);
        const rows = existsSync(state.ledger)
          ? readFileSync(state.ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
        state.during.push({ lockHeld: existsSync(state.lock), lastStatus: rows.at(-1)?.status ?? null });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          data: Array.from({ length: j.n || 1 }, () => ({ b64_json: PNG_1PX, mime_type: 'image/png' })),
          usage: { cost_in_usd_ticks: 300000000 * (j.n || 1) }, // $0.03 an image, unlike any listed price
        }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'w15-grok-test-'));
  const out = join(dir, 'out');
  const input = join(dir, 'in.png');
  writeFileSync(input, Buffer.from(PNG_1PX, 'base64'));
  const jobs = join(dir, 'jobs.mjs');
  writeFileSync(jobs, `export const PROMPTS = { p1: ${JSON.stringify(PROMPT)} };
export const JOBS = {
  ok: { prompt: 'p1', model: 'mock-image', endpoint: 'generations', n: 1, resolution: '1k' },
  edit: { prompt: 'p1', model: 'mock-image-2', endpoint: 'edits', n: 2, resolution: '1k', quality: 'low', images: [${JSON.stringify(input)}] },
  big: { prompt: 'p1', model: 'mock-image-2', endpoint: 'generations', n: 10, resolution: '1k', quality: 'medium' },
  nores: { prompt: 'p1', model: 'mock-image', endpoint: 'generations', n: 1 },
};\n`);
  const ledger = join(out, 'ledger.jsonl');
  state = { posts: [], during: [], ledger, lock: `${ledger}.lock` };
  return { dir, out, ledger, lock: `${ledger}.lock`, jobs };
}

function cli(t, ...args) {
  const env = { ...process.env, W15_ART_OUT: t.out, W15_ART_SCRATCH: join(t.dir, 'scratch'), W15_ART_JOBS: t.jobs,
    W15_ART_API: `http://127.0.0.1:${port}/v1` };
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NODE_USE_ENV_PROXY']) delete env[k];
  return new Promise((res) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env });
    let stdout = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stdout += c));
    p.on('close', (code) => res({ code, stdout }));
  });
}
const rowsOf = (t) => readFileSync(t.ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
// A ledger whose rows sum to `usd` (one row, c001), as the committed ledger sums to the floor.
function seed(t, usd) {
  mkdirSync(t.out, { recursive: true });
  writeFileSync(t.ledger, JSON.stringify({ call_id: 'c001', status: 'ok', job: 'seed', model: 'mock-image',
    endpoint: 'POST /v1/images/generations', n: 0, inputs: [], outputs: [], call_cost_usd: usd, cumulative_usd: usd }) + '\n');
}
const ledgerSum = (rows) => r6(rows.reduce((s, r) => s + (Number(r.call_cost_usd) || 0), 0));

test('run refuses when the ledger is missing: exit 2, no paid request, no ledger created', async () => {
  const t = setup();
  const r = await cli(t, 'run', 'ok');
  assert.equal(r.code, 2, r.stdout);
  assert.match(r.stdout, /REFUSED: ledger missing, empty or below the recorded floor; restore it from git/);
  assert.equal(state.posts.length, 0);
  assert.equal(existsSync(t.ledger), false);
  assert.equal(existsSync(t.lock), false, 'the lock is released on refusal');
  rmSync(t.dir, { recursive: true });
});

test('(a) an empty (0-byte) ledger: exit 2, no paid request, the file untouched', async () => {
  const t = setup();
  mkdirSync(t.out, { recursive: true });
  writeFileSync(t.ledger, '');
  const r = await cli(t, 'run', 'ok');
  assert.equal(r.code, 2, r.stdout);
  assert.match(r.stdout, /REFUSED: ledger missing, empty or below the recorded floor/);
  assert.equal(state.posts.length, 0);
  assert.equal(readFileSync(t.ledger).length, 0);
  assert.equal(existsSync(t.lock), false);
  rmSync(t.dir, { recursive: true });
});

test('(b) a ledger summing below the floor (truncated): exit 2, no paid request, the bytes untouched', async () => {
  const t = setup();
  seed(t, r6(FLOOR - 1.0));
  const bytes = readFileSync(t.ledger);
  const r = await cli(t, 'run', 'ok');
  assert.equal(r.code, 2, r.stdout);
  assert.match(r.stdout, /REFUSED: ledger missing, empty or below the recorded floor/);
  assert.equal(state.posts.length, 0);
  assert.deepEqual(readFileSync(t.ledger), bytes);
  rmSync(t.dir, { recursive: true });
});

test('(c) w15-export.py with the lock held: exit 3, the ledger bytes and the lock unchanged', async () => {
  const t = setup();
  seed(t, FLOOR);
  const bytes = readFileSync(t.ledger);
  writeFileSync(t.lock, 'someone else\n');
  const r = await new Promise((res) => {
    const env = { ...process.env, W15_ART_OUT: t.out, W15_ART_SCRATCH: join(t.dir, 'scratch') };
    const p = spawn('python3', [EXPORT], { env });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('close', (code) => res({ code, out }));
  });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /LOCKED/);
  assert.deepEqual(readFileSync(t.ledger), bytes);
  assert.equal(readFileSync(t.lock, 'utf8'), 'someone else\n');
  assert.equal(existsSync(`${t.ledger}.tmp`), false);
  rmSync(t.dir, { recursive: true });
});

test('(d) guard: the committed ledger sums to no more than the recorded floor (raise the floor with the ledger)', () => {
  const rows = readFileSync(REAL_LEDGER, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  assert.ok(rows.length > 0, 'the committed ledger has rows');
  assert.ok(ledgerSum(rows) <= FLOOR + 1e-9, `ledger sum $${ledgerSum(rows)} > floor $${FLOOR}: raise PRIOR_SPEND_FLOOR_USD`);
});

test('a call on a ledger at the floor: usage cost, prompt_sha256 and the in-flight reservation and lock', async () => {
  const t = setup();
  seed(t, FLOOR);
  const r = await cli(t, 'run', 'edit');
  assert.equal(r.code, 0, r.stdout);
  assert.equal(state.posts.length, 1);
  assert.deepEqual(state.during, [{ lockHeld: true, lastStatus: 'pending' }], 'reservation and lock on disk before the request');
  const row = rowsOf(t)[1];
  assert.equal(row.status, 'ok');
  assert.equal(row.prompt_sha256, sha(PROMPT));
  assert.equal(row.prompt_sha256, sha(state.posts[0].prompt), 'the hash is of the text actually sent');
  assert.equal(row.call_cost_usd, 0.06, 'the cost comes from usage.cost_in_usd_ticks');
  assert.equal(row.cumulative_usd, r6(FLOOR + 0.06), 'cumulative = max(floor, ledger sum) + this call');
  assert.match(r.stdout, new RegExp(`spent \\$${esc(FLOOR)} \\(ledger sum \\$${esc(FLOOR)}, floor \\$${esc(FLOOR)}\\)`));
  assert.equal(row.outputs.length, 2);
  assert.equal(existsSync(t.lock), false, 'lock released');
  assert.equal(existsSync(`${t.ledger}.tmp`), false, 'no .tmp left behind');
  rmSync(t.dir, { recursive: true });
});

test('no override flag: the old --new-budget no longer starts a ledger, and the stop line holds on a ledger at the floor', async () => {
  const t = setup();
  const r0 = await cli(t, 'run', 'ok', '--new-budget');
  assert.equal(r0.code, 2, r0.stdout);
  assert.equal(state.posts.length, 0, 'no paid request without the committed ledger');
  seed(t, FLOOR);
  assert.equal((await cli(t, 'run', 'ok')).code, 0);
  state.posts = [];
  const r = await cli(t, 'run', 'big'); // 10 x $0.80 = $8.00: the floor + $0.03 + $8 passes the stop line
  assert.equal(r.code, 2, r.stdout);
  assert.match(r.stdout, /REFUSED: .* would pass the \$11 stop line/);
  assert.equal(state.posts.length, 0);
  assert.equal(rowsOf(t).length, 2, 'no row added');
  rmSync(t.dir, { recursive: true });
});

test('real API runs are closed: a non-mock API is refused before any request, even on a ledger at the floor', async () => {
  const t = setup();
  seed(t, FLOOR);
  const env = { ...process.env, W15_ART_OUT: t.out, W15_ART_SCRATCH: join(t.dir, 'scratch'), W15_ART_JOBS: t.jobs,
    W15_ART_API: 'https://api.invalid/v1' };
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NODE_USE_ENV_PROXY']) delete env[k];
  const r = await new Promise((res) => {
    const p = spawn(process.execPath, [SCRIPT, 'run', 'ok'], { env });
    let stdout = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stdout += c));
    p.on('close', (code) => res({ code, stdout }));
  });
  assert.equal(r.code, 2, r.stdout);
  assert.match(r.stdout, /REFUSED: real API runs are closed/);
  assert.equal(rowsOf(t).length, 1, 'no row added');
  assert.equal(existsSync(t.lock), false, 'lock released');
  rmSync(t.dir, { recursive: true });
});

test('closed for every non-local API URL form, and requests never follow a redirect to another host', async () => {
  const t = setup();
  seed(t, FLOOR);
  const runWith = (api, ...args) => new Promise((res) => {
    const env = { ...process.env, W15_ART_OUT: t.out, W15_ART_SCRATCH: join(t.dir, 'scratch'), W15_ART_JOBS: t.jobs, W15_ART_API: api };
    for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NODE_USE_ENV_PROXY']) delete env[k];
    const p = spawn(process.execPath, [SCRIPT, ...args], { env });
    let stdout = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stdout += c));
    p.on('close', (code) => res({ code, stdout }));
  });
  for (const api of ['https://api.invalid/v1', 'http://127.0.0.1@api.invalid/v1', 'http://localhost.invalid/v1',
    'http://127.0.0.1:1@api.invalid/v1', 'https://api.invalid/v1/images/generations?u=http://127.0.0.1/']) {
    const r = await runWith(api, 'run', 'ok');
    assert.equal(r.code, 2, `${api}: ${r.stdout}`);
    assert.match(r.stdout, /REFUSED: real API runs are closed/, api);
    assert.doesNotMatch(r.stdout, /committed ledger|job ok:/, api);
    assert.equal(rowsOf(t).length, 1, `${api}: no row added`);
  }
  // A local server that answers with a 307 to a second (non-local-looking) host: the request must not follow it.
  const hits = [];
  const far = createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.end('{}'); });
  await new Promise((r) => far.listen(0, '127.0.0.2', r));
  const near = createServer(async (req, res) => {
    if (req.method === 'GET') { // the price list comes through, so the POST is what meets the redirect
      const list = await fetch(`http://127.0.0.1:${port}${req.url}`);
      res.setHeader('Content-Type', 'application/json');
      res.end(await list.text());
      return;
    }
    res.statusCode = 307;
    res.setHeader('Location', `http://127.0.0.2:${far.address().port}${req.url}`);
    res.end();
  });
  await new Promise((r) => near.listen(0, '127.0.0.1', r));
  const r = await runWith(`http://127.0.0.1:${near.address().port}/v1`, 'run', 'ok');
  near.close(); far.close();
  assert.notEqual(r.code, 0, r.stdout);
  assert.deepEqual(hits, [], 'nothing reached the redirect target');
  rmSync(t.dir, { recursive: true });
});

test('--dry makes no paid request and leaves the ledger as it was', async () => {
  const t = setup();
  seed(t, FLOOR);
  const before = readFileSync(t.ledger);
  const r = await cli(t, 'run', 'ok', '--dry');
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /DRY RUN: no call made/);
  assert.equal(state.posts.length, 0);
  assert.deepEqual(readFileSync(t.ledger), before);
  rmSync(t.dir, { recursive: true });
});

test('a held lock refuses run and review: exit 3, no paid request, the lock left as it was', async () => {
  const t = setup();
  seed(t, FLOOR);
  assert.equal((await cli(t, 'run', 'ok')).code, 0);
  state.posts = [];
  writeFileSync(t.lock, 'someone else\n');
  const r = await cli(t, 'run', 'ok');
  assert.equal(r.code, 3, r.stdout);
  assert.match(r.stdout, /LOCKED/);
  assert.equal(state.posts.length, 0);
  assert.equal(readFileSync(t.lock, 'utf8'), 'someone else\n');
  const file = rowsOf(t)[1].outputs[0].file;
  const rv = await cli(t, 'review', file, 'keep', 'test');
  assert.equal(rv.code, 3, rv.stdout);
  assert.equal(rowsOf(t)[1].outputs[0].kept, null, 'review wrote nothing');
  rmSync(t.dir, { recursive: true });
});

test('the ledger is replaced by rename (a new inode), never edited in place', async () => {
  const t = setup();
  seed(t, FLOOR);
  assert.equal((await cli(t, 'run', 'ok')).code, 0);
  // A hard link keeps the old inode: a rename leaves its bytes as they were, an in-place edit would change them. (Comparing
  // inode numbers was flaky: run 2 renames twice, so the final file can reuse the first file's freed inode number.)
  const before = readFileSync(t.ledger);
  const old = `${t.ledger}.old`;
  linkSync(t.ledger, old);
  assert.equal((await cli(t, 'run', 'ok')).code, 0);
  assert.deepEqual(readFileSync(old), before, 'the old ledger file was not edited in place');
  assert.notDeepEqual(readFileSync(t.ledger), before);
  assert.equal(existsSync(`${t.ledger}.tmp`), false);
  const rows = rowsOf(t);
  assert.deepEqual(rows.map((x) => x.call_id), ['c001', 'c002', 'c003']);
  assert.equal(rows[2].cumulative_usd, r6(FLOOR + 0.06), 'cumulative = max(floor, ledger sum) + this call');
  rmSync(t.dir, { recursive: true });
});

test('a job without a resolution fails before any paid request and adds no row', async () => {
  const t = setup();
  seed(t, FLOOR);
  const r = await cli(t, 'run', 'nores');
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /must name its resolution/);
  assert.equal(state.posts.length, 0);
  assert.equal(rowsOf(t).length, 1);
  assert.equal(existsSync(t.lock), false);
  rmSync(t.dir, { recursive: true });
});
