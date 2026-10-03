#!/usr/bin/env node
// W15 p-art: character reference sheets through the xAI Grok Imagine image API, under a hard money cap.
// Every call is checked against the ledger BEFORE it is made and recorded in it (one line per call):
//   assets/incoming/w15-char-refs/ledger.jsonl
// The cap: the owner allows $12 in total; no new call starts once the ledger would pass STOP_USD ($11.00).
// Prices come from the API itself (GET /v1/image-generation-models: `pricing` per quality and resolution, else
// `image_price`; both in 1e-8 US cents), fetched before each call. The cost a call records is the response's
// usage.cost_in_usd_ticks (1 USD = 1e10 ticks) when present, otherwise the estimate (listed price x images, where an
// edit is billed for its input images too, per docs.x.ai "Imagine Overview > Pricing").
// No credential is set, read, printed or stored here: the environment's proxy authenticates requests to api.x.ai.
// Cap memory (W15 patch): PRIOR_SPEND_FLOOR_USD is the committed spend; the pre-check never reads below it, and `run`
// refuses (exit 2, before any request) when the ledger is missing, empty or sums below it. There is no override flag; a new
// budget is a code change (the cap, the stop line and the floor). One O_EXCL lockfile (<ledger>.lock) covers every ledger writer (run, review,
// tools/art/w15-export.py); the ledger is written to .tmp and renamed; new rows record prompt_sha256; a job must name its
// resolution. Tests: node --test tools/art/grok-sheets.test.mjs (a mock API; no real call).
// Real API runs are CLOSED (REAL_RUNS_OPEN = false): `run` exits 2 before any request unless W15_ART_API is
// http://127.0.0.1 or http://localhost (the tests' mock) or --dry is given (--dry and `prices` only GET the free model
// list). Requests never follow redirects. Reopening is a code change made with the owner.
//
// Usage (from the repo root; raw downloads go to $W15_ART_SCRATCH/raw, default <tmp>/w15-char-refs):
//   node tools/art/grok-sheets.mjs prices                     list the image models and their prices
//   node tools/art/grok-sheets.mjs run <job> [--dry]   refused while closed (a mock or --dry only); jobs: tools/art/w15-prompts.mjs
//   node tools/art/grok-sheets.mjs review <raw-file> keep|reject "<reason>" [--as <delivered path>]
//   node tools/art/grok-sheets.mjs summary                    write LEDGER.md from the ledger
//   node tools/art/grok-sheets.mjs prompts                    write PROMPTS.md from the prompt library
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Node's fetch only uses HTTPS_PROXY with NODE_USE_ENV_PROXY=1: re-run under it when a proxy is configured.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== '1') {
  const r = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// W15_ART_OUT, W15_ART_API and W15_ART_JOBS point the script at a temp ledger, a mock API and test jobs (the tests use
// them; a real run is refused below whatever they say, while REAL_RUNS_OPEN is false).
const OUT = process.env.W15_ART_OUT ? resolve(process.env.W15_ART_OUT) : join(ROOT, 'assets/incoming/w15-char-refs');
const LEDGER = join(OUT, 'ledger.jsonl');
const LOCK = `${LEDGER}.lock`;
const SCRATCH = process.env.W15_ART_SCRATCH || join(tmpdir(), 'w15-char-refs');
const RAW = join(SCRATCH, 'raw');
const API = process.env.W15_ART_API || 'https://api.x.ai/v1';
const CAP_USD = 12.0; // the owner's cap
const STOP_USD = 11.0; // no call may take the ledger past this (the rest is the safety margin)
// The committed spend (calls c001-c045, 2026-10-01 to 10-03): the spend never reads lower.
const PRIOR_SPEND_FLOOR_USD = 6.412; // raise in the same commit as any ledger growth
// Real API runs are CLOSED: W15's images are made ($6.412 of the owner's $12). A local ledger cannot be the only memory of
// real spend (a git restore or a second checkout or ledger copy hides calls made since the last commit), so reopening is a
// code change made with the owner. While open, a real call also needs the ledger tracked by git, unmodified, and summing
// to the floor: commit each call's row together with the raised floor before the next call.
const REAL_RUNS_OPEN = false;
const LOCAL_API = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(API); // the tests' mock

const { PROMPTS, JOBS } = await import(
  process.env.W15_ART_JOBS ? pathToFileURL(resolve(process.env.W15_ART_JOBS)).href : './w15-prompts.mjs');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const usd = (x) => Math.round(x * 1e6) / 1e6;

function readLedger() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
// Write a .tmp beside the ledger, then rename it over the ledger: a crash leaves the old ledger or the new one, never half.
function writeLedger(rows) {
  mkdirSync(OUT, { recursive: true });
  const tmp = `${LEDGER}.tmp`;
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  renameSync(tmp, LEDGER);
}
const ledgerSum = (rows) => usd(rows.reduce((s, r) => s + (Number(r.call_cost_usd) || 0), 0));
const spent = (rows) => usd(Math.max(PRIOR_SPEND_FLOOR_USD, ledgerSum(rows)));

// One writer at a time: an exclusive lockfile ('wx' fails when it exists) held until the command ends.
function lock() {
  mkdirSync(OUT, { recursive: true });
  let fd;
  try {
    fd = openSync(LOCK, 'wx');
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    console.log(`LOCKED: ${LOCK} exists (another run holds the ledger, or a crashed run left it: check, then delete it). No call made.`);
    process.exit(3);
  }
  writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
  closeSync(fd);
  let held = true;
  const release = () => {
    if (held) {
      held = false;
      try { unlinkSync(LOCK); } catch { /* already gone */ }
    }
  };
  process.on('exit', release);
  return release;
}

async function fetchPrices() {
  const r = await fetch(`${API}/image-generation-models`, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!r.ok) throw new Error(`GET /v1/image-generation-models: HTTP ${r.status}`);
  const j = await r.json();
  return { fetched: new Date().toISOString(), models: j.models || [] };
}

// The listed price of one image. API units: 1e-8 US cents, so USD = units / 1e10.
function priceFor(table, model, quality, resolution) {
  const m = table.models.find((x) => x.id === model || (x.aliases || []).includes(model));
  if (!m) throw new Error(`model ${model} is not in /v1/image-generation-models`);
  if (!resolution) throw new Error(`${model}: the job must name its resolution (1k, 1.5k or 2k); no price is assumed`);
  const res = resolution;
  if (Array.isArray(m.pricing) && m.pricing.length) {
    if (!quality) throw new Error(`${model} prices by quality: pin "quality" in the job`);
    const row = m.pricing.find((p) => p.quality === quality && p.resolution === res);
    if (!row) throw new Error(`${model} has no listed price for quality ${quality} at ${res}`);
    return {
      usd: row.price_per_image / 1e10,
      source: `api GET /v1/image-generation-models ${m.id} pricing[quality=${quality},resolution=${res}].price_per_image=${row.price_per_image} (1e-8 USD cents), fetched ${table.fetched}`,
    };
  }
  if (res !== '1k') throw new Error(`${model} lists one image_price; only 1k is priced unambiguously`);
  return {
    usd: m.image_price / 1e10,
    source: `api GET /v1/image-generation-models ${m.id} image_price=${m.image_price} (1e-8 USD cents), fetched ${table.fetched}`,
  };
}

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { ext: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const mk = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) {
        return { ext: 'jpg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
    return { ext: 'jpg', w: 0, h: 0 };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { ext: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { ext: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { ext: 'webp', w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    return { ext: 'webp', w: 0, h: 0 };
  }
  return { ext: 'bin', w: 0, h: 0 };
}

// A job's input image: a repo path, raw:<file> (a download in the scratch dir) or guide:<file> (a proportion guide made
// by tools/art/w15-guide.py in the scratch dir; never delivered, its sha256 is in the ledger).
function inputPath(p) {
  if (p.startsWith('raw:')) return join(RAW, p.slice(4));
  if (p.startsWith('guide:')) return join(SCRATCH, 'guides', p.slice(6));
  return isAbsolute(p) ? p : join(ROOT, p);
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

async function run(jobId, dry) {
  const job = JOBS[jobId];
  if (!job) throw new Error(`unknown job ${jobId}`);
  const prompt = PROMPTS[job.prompt];
  if (!prompt) throw new Error(`job ${jobId}: unknown prompt ${job.prompt}`);
  if (!LOCAL_API && !dry) {
    if (!REAL_RUNS_OPEN) {
      console.log(`REFUSED: real API runs are closed (W15 spent $${PRIOR_SPEND_FLOOR_USD} of the $${CAP_USD} cap); reopening ` +
        'is a code change made with the owner (REAL_RUNS_OPEN). No call made.');
      process.exit(2);
    }
    const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' });
    const tracked = git('ls-files', '--error-unmatch', LEDGER).status === 0;
    const clean = tracked && git('status', '--porcelain', '--', LEDGER, fileURLToPath(import.meta.url)).stdout.trim() === '';
    const sum = ledgerSum(readLedger());
    if (!clean || Math.abs(sum - PRIOR_SPEND_FLOOR_USD) > 1e-9) {
      console.log(`REFUSED: a real call needs the committed ledger, unmodified and summing to the floor (tracked ${tracked}, ` +
        `clean ${clean}, sum $${sum}, floor $${PRIOR_SPEND_FLOOR_USD}). Commit the last call with the raised floor first. No call made.`);
      process.exit(2);
    }
  }
  const rows = readLedger();
  if (!existsSync(LEDGER) || rows.length === 0 || ledgerSum(rows) + 1e-9 < PRIOR_SPEND_FLOOR_USD) {
    console.log('REFUSED: ledger missing, empty or below the recorded floor; restore it from git. ' +
      `(ledger ${existsSync(LEDGER) ? `${rows.length} rows, sum $${ledgerSum(rows)}` : 'missing'}; ` +
      `floor $${PRIOR_SPEND_FLOOR_USD}.) No call made.`);
    process.exit(2);
  }
  const edit = job.endpoint === 'edits';
  const inputs = (job.images || []).map((p) => {
    const buf = readFileSync(inputPath(p));
    return { ref: p, sha256: sha256(buf), px: (({ w, h }) => `${w}x${h}`)(sniff(buf)), uri: `data:${MIME[extname(p).toLowerCase()] || 'image/png'};base64,${buf.toString('base64')}` };
  });
  if (edit && !inputs.length) throw new Error(`job ${jobId}: an edit needs input images`);
  const n = job.n || 1;
  const table = await fetchPrices();
  const price = priceFor(table, job.model, job.quality, job.resolution);
  const billed = n + (edit ? inputs.length : 0);
  const estimate = usd(price.usd * billed);
  const before = spent(rows);
  const body = { model: job.model, prompt, n, response_format: 'b64_json' };
  if (job.aspect_ratio) body.aspect_ratio = job.aspect_ratio;
  if (job.resolution) body.resolution = job.resolution;
  if (job.quality) body.quality = job.quality;
  if (edit) {
    const imgs = inputs.map((i) => ({ url: i.uri, type: 'image_url' }));
    if (imgs.length === 1) body.image = imgs[0];
    else body.images = imgs;
  }
  console.log(`job ${jobId}: ${job.model} /v1/images/${job.endpoint} n=${n} inputs=${inputs.length} ` +
    `${job.quality || '-'}/${job.resolution}/${job.aspect_ratio || 'auto'}; price $${price.usd} x ${billed} = est $${estimate}; ` +
    `spent $${before} (ledger sum $${ledgerSum(rows)}, floor $${PRIOR_SPEND_FLOOR_USD}) -> $${usd(before + estimate)} ` +
    `(stop at $${STOP_USD}, cap $${CAP_USD})`);
  if (before + estimate > STOP_USD + 1e-9) {
    console.log(`REFUSED: $${before} + $${estimate} would pass the $${STOP_USD} stop line. No call made.`);
    process.exit(2);
  }
  if (dry) {
    console.log('DRY RUN: no call made. Prompt:\n' + prompt);
    return;
  }
  if (!LOCAL_API && !REAL_RUNS_OPEN) throw new Error('real API runs are closed'); // a second guard before any reservation
  const callId = `c${String(rows.length + 1).padStart(3, '0')}`;
  const row = {
    call_id: callId,
    time: new Date().toISOString(),
    status: 'pending',
    job: jobId,
    prompt_id: job.prompt,
    prompt_sha256: sha256(Buffer.from(prompt, 'utf8')),
    model: job.model,
    endpoint: `POST /v1/images/${job.endpoint}`,
    n,
    inputs: inputs.map(({ ref, sha256: s, px }) => ({ file: ref, sha256: s, px })),
    size: { resolution: job.resolution, aspect_ratio: job.aspect_ratio || 'auto', output_px: null },
    quality: job.quality || null,
    price_per_image_usd: price.usd,
    price_source: price.source,
    billed_images_estimate: billed,
    estimated_cost_usd: estimate,
    call_cost_usd: estimate, // reserved until the response says what it cost
    cost_source: 'reserved estimate (call in flight)',
    cumulative_usd: usd(before + estimate),
    outputs: [],
    kept: false,
  };
  rows.push(row);
  writeLedger(rows); // the reservation is on disk before the request leaves
  let res, text, json = null;
  try {
    res = await fetch(`${API}/images/${job.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
      redirect: 'error', // a local URL must not hand the request to another host
    });
    text = await res.text();
    try { json = JSON.parse(text); } catch { json = null; }
  } catch (e) {
    row.status = 'error';
    row.error = `network: ${e.name}: ${e.message}`;
    row.cost_source = 'estimate kept: the request may have been served (no response)';
    writeLedger(rows);
    throw e;
  }
  row.http_status = res.status;
  const ticks = json?.usage?.cost_in_usd_ticks;
  if (json?.usage) row.usage = json.usage;
  if (json?.model) row.model_served = json.model;
  if (typeof ticks === 'number') {
    row.call_cost_usd = usd(ticks / 1e10);
    row.cost_source = `response usage.cost_in_usd_ticks=${ticks}`;
  } else if (!res.ok && res.status >= 400 && res.status < 500) {
    row.call_cost_usd = 0;
    row.cost_source = `HTTP ${res.status} with no usage: rejected before generation`;
  } else {
    row.cost_source = 'estimate (no usage field in the response)';
  }
  if (!res.ok) {
    row.status = 'error';
    row.error = (json?.error?.message || json?.error || json?.message || text || '').toString().slice(0, 600);
  } else {
    row.status = 'ok';
    mkdirSync(RAW, { recursive: true });
    (json?.data || []).forEach((d, k) => {
      if (!d.b64_json) {
        row.outputs.push({ file: null, note: d.url ? 'url only (not downloaded)' : 'empty', kept: false });
        return;
      }
      const buf = Buffer.from(d.b64_json, 'base64');
      const s = sniff(buf);
      const name = `${callId}_${k}_${jobId}.${s.ext}`;
      writeFileSync(join(RAW, name), buf);
      row.outputs.push({ file: `raw/${name}`, sha256: sha256(buf), px: `${s.w}x${s.h}`, bytes: buf.length, mime: d.mime_type || null, kept: null, reason: null });
    });
    row.size.output_px = [...new Set(row.outputs.map((o) => o.px).filter(Boolean))].join(',') || null;
  }
  row.cumulative_usd = usd(before + row.call_cost_usd);
  writeLedger(rows);
  console.log(`${row.status.toUpperCase()} ${callId} HTTP ${res.status}: cost $${row.call_cost_usd} (${row.cost_source}); ledger $${row.cumulative_usd}`);
  if (row.error) console.log(`error: ${row.error}`);
  for (const o of row.outputs) console.log(`  ${o.file} ${o.px} ${o.bytes}B sha256 ${o.sha256?.slice(0, 16)}`);
  if (row.usage) console.log(`  usage: ${JSON.stringify(row.usage)}`);
}

function review(file, verdict, reason, as) {
  const rows = readLedger();
  const name = basename(file);
  for (const r of rows) {
    for (const o of r.outputs || []) {
      if (o.file && basename(o.file) === name) {
        o.kept = verdict === 'keep';
        o.reason = reason || null;
        if (as) o.delivered = as;
        else delete o.delivered;
        r.kept = r.outputs.some((x) => x.kept === true);
        writeLedger(rows);
        console.log(`${r.call_id} ${name}: kept=${o.kept}${as ? ` as ${as}` : ''} (${reason || ''})`);
        return;
      }
    }
  }
  throw new Error(`no output named ${name} in the ledger`);
}

function summary() {
  const rows = readLedger();
  const by = {};
  let images = 0, kept = 0, rejected = 0, pending = 0;
  for (const r of rows) {
    const k = r.model;
    by[k] ??= { calls: 0, images: 0, billed: 0, cost: 0 };
    by[k].calls++;
    by[k].images += (r.outputs || []).filter((o) => o.file).length;
    by[k].cost = usd(by[k].cost + (Number(r.call_cost_usd) || 0));
    for (const o of r.outputs || []) {
      if (!o.file) continue;
      images++;
      if (o.kept === true) kept++;
      else if (o.kept === false) rejected++;
      else pending++;
    }
  }
  const total = spent(rows);
  const L = [];
  L.push('# W15 character reference sheets: cost ledger (summary)', '');
  L.push('Generated by `node tools/art/grok-sheets.mjs summary` from `ledger.jsonl` (one line per API call; the full record,');
  L.push('with prompt ids, inputs, outputs and sha256). The kept images\' raw downloads are copied to `raw/` and their C2PA manifests');
  L.push('exported to `provenance/` (tools/art/w15-provenance.py); rejects and guides are not committed: their sha256 is below.', '');
  L.push(`- **Final cumulative: $${total.toFixed(4)}** of the owner's $${CAP_USD.toFixed(2)} cap (stop line $${STOP_USD.toFixed(2)}; never crossed: every call was pre-checked).`);
  L.push(`- Cap memory: the pre-check's spend is max($${PRIOR_SPEND_FLOOR_USD} floor, ledger sum); **real API runs are closed** (\`REAL_RUNS_OPEN = false\`: reopening is a code change made with the owner, and then each real call needs the committed, unmodified ledger summing to the floor); a lost or emptied ledger, or one cut below the floor, is refused; the floor is the committed spend (raised in the same commit as any ledger growth); there is no override flag. One exclusive lockfile per command that writes the ledger (\`run\`, \`review\`, \`w15-export.py\`); the ledger is replaced by rename. Tests: \`node --test tools/art/grok-sheets.test.mjs\`.`);
  L.push(`- Calls: ${rows.length} (${rows.filter((r) => r.status === 'ok').length} ok, ${rows.filter((r) => r.status === 'error').length} error). Images returned: ${images}; kept ${kept}, rejected ${rejected}${pending ? `, unreviewed ${pending}` : ''}.`);
  const fromUsage = rows.filter((r) => String(r.cost_source).startsWith('response usage')).length;
  L.push(fromUsage === rows.length
    ? `- Cost source: every call's cost is the API's own \`usage.cost_in_usd_ticks\` from its response (1 USD = 1e10 ticks).`
    : `- Cost source: ${fromUsage} of ${rows.length} calls carry the API's own \`usage.cost_in_usd_ticks\` (used as the cost); the others use the listed price (source on each ledger line).`);
  // what the responses say an edit's input image costs: (call cost - outputs x listed price) / inputs
  const perInput = new Map();
  for (const r of rows.filter((x) => x.endpoint.endsWith('/edits') && String(x.cost_source).startsWith('response usage') && x.inputs?.length)) {
    const each = usd((r.call_cost_usd - r.n * r.price_per_image_usd) / r.inputs.length);
    perInput.set(r.model, [...new Set([...(perInput.get(r.model) || []), each])]);
  }
  if (perInput.size) L.push(`- Edits: the responses bill each output at the listed price plus, per input image, ${[...perInput.entries()].map(([m, v]) => `$${v.join(' / $')} on ${m}`).join(' and ')} (docs.x.ai: "Image edits are billed for both the input image and the generated output image"). The pre-check reserved the listed output price for each input, so it always over-estimated.`);
  L.push('');
  L.push('## Listed prices used for the pre-check', '');
  L.push('From the API, `GET https://api.x.ai/v1/image-generation-models` (`pricing[].price_per_image`, or `image_price`; units of 1e-8 US cents), fetched before every call. The docs pricing page (docs.x.ai/developers/pricing) lists $0.02 for grok-imagine-image and $0.04 for grok-imagine-image-2.0 (its low / 1k tier).', '');
  L.push('| Model | Quality | Resolution | USD per image |', '|---|---|---|---:|');
  const tiers = new Map();
  for (const r of rows) tiers.set(`${r.model}|${r.quality || '-'}|${String(r.size?.resolution).replace(' (default)', '')}`, r.price_per_image_usd);
  for (const [k, v] of [...tiers.entries()].sort()) L.push(`| ${k.split('|').join(' | ')} | ${Number(v).toFixed(2)} |`);
  L.push('');
  L.push('## Totals by model', '', '| Model | Calls | Images | Cost (USD) |', '|---|---:|---:|---:|');
  for (const [m, v] of Object.entries(by)) L.push(`| ${m} | ${v.calls} | ${v.images} | ${v.cost.toFixed(4)} |`);
  L.push(`| **Total** | **${rows.length}** | **${images}** | **${total.toFixed(4)}** |`, '');
  L.push('## Calls', '', '| Call | Job (prompt id) | Model | Endpoint | n | In | Quality / res / aspect | Cost | Cumulative | Kept |', '|---|---|---|---|---:|---:|---|---:|---:|---|');
  for (const r of rows) {
    const ks = (r.outputs || []).map((o) => (o.kept === true ? 'K' : o.kept === false ? 'x' : '?')).join('');
    L.push(`| ${r.call_id} | ${r.job} (${r.prompt_id}) | ${r.model} | ${r.endpoint.replace('POST /v1/images/', '')} | ${r.n} | ${(r.inputs || []).length} | ${r.quality || '-'} / ${String(r.size?.resolution).replace(' (default)', '')} / ${r.size?.aspect_ratio} | ${Number(r.call_cost_usd).toFixed(4)} | ${Number(r.cumulative_usd).toFixed(4)} | ${ks || '-'}${r.status === 'error' ? ' (error)' : ''} |`);
  }
  L.push('', 'Kept column: one mark per returned image, K kept, x rejected (the reason is on the ledger line).', '');
  const attested = rows.filter((r) => r.prompt_sha256).map((r) => r.call_id);
  const unattested = rows.filter((r) => !r.prompt_sha256).map((r) => r.call_id);
  L.push('## Prompt attestation', '');
  if (unattested.length) {
    L.push(`- ${unattested[0]}-${unattested.at(-1)} (${unattested.length} calls) predate \`prompt_sha256\`: their prompt text is attested only by a ` +
      'snapshot of the prompt library taken at 2026-10-01 16:45 UTC (after the last of them), which matches the current ' +
      '`tools/art/w15-prompts.mjs` text for every one of their prompt ids. No record was made at send time.');
  }
  if (attested.length) {
    L.push(`- ${attested[0]}-${attested.at(-1)} (${attested.length} calls) record \`prompt_sha256\`, the sha256 of the exact UTF-8 prompt text sent; ` +
      'each matches the current library text.');
  }
  L.push('');
  L.push('## sha256 of every raw download and input guide', '');
  L.push('Raw downloads stay in the scratch dir (the kept ones are copied to `raw/`); guides (`guide:`) are the proportion guides made by `tools/art/w15-guide.py` and sent as edit inputs. Never delivered: the guides and the rejects.', '');
  L.push('| File | Call | Kind | sha256 | Kept |', '|---|---|---|---|---|');
  const guides = new Map();
  for (const r of rows) {
    for (const o of r.outputs || []) if (o.file) L.push(`| ${o.file.replace('raw/', '')} | ${r.call_id} | output | \`${o.sha256}\` | ${o.kept === true ? 'yes' : 'no'} |`);
    for (const i of r.inputs || []) if (i.file.startsWith('guide:') && !guides.has(i.file)) guides.set(i.file, [r.call_id, i.sha256]);
  }
  for (const [f, [c, h]] of guides) L.push(`| ${f.replace('guide:', 'guides/')} | first input to ${c} | guide | \`${h}\` | never delivered |`);
  L.push('');
  writeFileSync(join(OUT, 'LEDGER.md'), L.join('\n'));
  console.log(`LEDGER.md: ${rows.length} calls, ${images} images, $${total}`);
}

function prompts() {
  const rows = readLedger();
  const L = ['# W15 character reference sheets: prompts', ''];
  L.push('Every prompt sent to the image API, by id. Generated by `node tools/art/grok-sheets.mjs prompts` from');
  L.push('`tools/art/w15-prompts.mjs` (shared fragments, so both characters and every view say the same thing the same way).');
  L.push('Jobs (model, endpoint, n, inputs, quality, resolution, aspect) are listed under the prompt they used, with the ledger calls.', '');
  for (const [id, text] of Object.entries(PROMPTS)) {
    const jobs = Object.entries(JOBS).filter(([, j]) => j.prompt === id);
    const used = rows.filter((r) => r.prompt_id === id);
    if (!used.length) continue;
    L.push(`## \`${id}\``, '');
    L.push('```text', text, '```', '');
    for (const [jid, j] of jobs) {
      const calls = used.filter((r) => r.job === jid).map((r) => r.call_id);
      if (!calls.length) continue;
      L.push(`- job \`${jid}\`: ${j.model}, /v1/images/${j.endpoint}, n=${j.n || 1}, ${j.quality || 'no quality param'}, ${j.resolution || '1k'}, ${j.aspect_ratio || 'auto'}${j.images ? `, inputs: ${j.images.map((x) => '`' + x + '`').join(', ')}` : ''}; calls ${calls.join(', ')}`);
    }
    L.push('');
  }
  writeFileSync(join(OUT, 'PROMPTS.md'), L.join('\n'));
  console.log('PROMPTS.md written');
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'prices') {
    const t = await fetchPrices();
    for (const m of t.models) {
      const tiers = (m.pricing || []).map((p) => `${p.quality}/${p.resolution} $${p.price_per_image / 1e10}`).join(', ');
      console.log(`${m.id} (aliases ${(m.aliases || []).join(', ') || '-'}; in ${m.input_modalities}): image_price $${m.image_price / 1e10}${tiers ? `; ${tiers}` : ''}`);
    }
    console.log(`ledger so far: $${spent(readLedger())}`);
  } else if (cmd === 'run') {
    const dry = args.includes('--dry');
    const release = dry ? () => {} : lock();
    try {
      await run(args[0], dry);
    } finally {
      release();
    }
  } else if (cmd === 'review') {
    const ai = args.indexOf('--as');
    const release = lock();
    try {
      review(args[0], args[1], args[2], ai >= 0 ? args[ai + 1] : null);
    } finally {
      release();
    }
  } else if (cmd === 'summary') {
    summary();
  } else if (cmd === 'prompts') {
    prompts();
  } else {
    console.log('usage: grok-sheets.mjs prices | run <job> [--dry] | review <raw-file> keep|reject "<reason>" [--as <path>] | summary | prompts');
    process.exit(1);
  }
} catch (e) {
  console.error(`grok-sheets: ${e.message}`);
  process.exit(1);
}
