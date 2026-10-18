// CHAR standard (task #75; docs/design/CHARACTER_PIPELINE.md §8): tools/assets/check-char-contract.mjs keeps the
// character contracts, the receipt template and the route ledger honest.
// 1. The shipped files pass: the corgi and cat contracts (one role profile, so one profile hash), the receipt template
//    (against each contract) and the ledger rows of the current contract version.
// 2. Every sub-check of the checker's seven rules fails a broken copy of a shipped file (one assertion each), and the
//    loopholes the reviews measured stay shut: acceptance without --contract or with one gate; a required gate set to
//    not_applicable; a receipt overruling the contract's director; a receiver adopting through a gate that is not its
//    own; a proposed or null decision under an agreed contract; a relaxed threshold, a dropped gate or a rewritten
//    criterion under the same contract_version; a profile hash blind to thresholds, engine or lighting.
// 3. A positive control (an agreed contract and a receipt with every gate passed) shows acceptance is reachable.
// 4. No production gate, criterion or command depends on a twin config (Godot decides production; the twin adopts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  CORE_GATES, STATUSES, checkContract, checkReceipt, openItems, profileHash, semverCmp,
} from '../../tools/assets/check-char-contract.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const CHECKER = 'tools/assets/check-char-contract.mjs';
const CORGI_PATH = 'assets/characters/corgi_rifleman/contract.json';
const TEMPLATE_PATH = 'assets/characters/receipt.template.json';
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const CORGI: Any = read(CORGI_PATH);
const CAT: Any = read('assets/characters/cat_rifleman/contract.json');
const TEMPLATE: Any = read(TEMPLATE_PATH);
const clone = <T>(v: T): T => structuredClone(v);
const has = (errs: string[], re: RegExp) => expect(errs.some((e) => re.test(e)), `${re}\n${errs.join('\n')}`).toBe(true);
const hasNot = (errs: string[], re: RegExp) => expect(errs.some((e) => re.test(e)), `${re}\n${errs.join('\n')}`).toBe(false);
const gates = (r: Any): Any[] => [...r.gates, ...r.role_specific_gates];
const gate = (r: Any, id: string): Any => gates(r).find((g) => g.id === id);
const ev = (exportHash = 'sha256:e', path = 'docs/qa/char/x.md') => ({
  path, sha256: 'sha256:f', export_hash: exportHash, engine: 'Godot 4.7.2', renderer: 'forward_plus', camera: 'V30', conditions: 'the Lot night',
});

/** The template filled as a receipt whose every gate passed (face_speech stays a justified not_applicable). */
function passing(assetId = 'corgi_rifleman'): Any {
  const r = clone(TEMPLATE);
  Object.assign(r, {
    asset_id: assetId, contract_hash: 'sha256:c', source_hash: 'sha256:s', export_hash: 'sha256:e', web_variant_hash: 'sha256:w',
    tool_versions: { blender: 'bpy 5.0.1' }, engine_and_hardware_profile: { godot: '4.7.2' }, family_and_skeleton_versions: { cvc_quadruped: '1.0.0' },
  });
  for (const g of gates(r)) if (g.status !== 'not_applicable') Object.assign(g, { status: 'pass', evidence: [ev()] });
  r.director_decision = { ...r.director_decision, status: 'pass', evidence: 'docs/qa/char/DIRECTOR.md' };
  r.reviewers = [{ name: 'QA-CHAR', independent: true, evidence: 'docs/qa/char/REVIEW.md' }];
  r.adoption.production_accepted = true;
  return r;
}
/** `passing()` with the twin's proof adopted. */
function adopted(): Any {
  const r = passing();
  Object.assign(r.adoption.receiver_proofs[0], { adopted: true, version: 'sha256:e', evidence: [ev('sha256:w')] });
  return r;
}
/** The corgi contract with every record agreed and every open decision made. */
function agreed(base: Any = CORGI): Any {
  const walk = (v: Any): Any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null) return 'decided';
    if (typeof v !== 'object') return v;
    const o: Any = { ...v };
    if (['proposed', 'agreed'].includes(o.status)) Object.assign(o, { status: 'agreed', agreed_by: 'owner', agreed_on: '2026-10-20', value: o.value ?? 1 });
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
  };
  return { ...walk(clone(base)), status: 'requirements_agreed' };
}
const R = (r: Any, opts: Any = { contract: agreed() }) => checkReceipt(r, opts);

describe('CHAR shipped files', () => {
  it('both contracts pass and share one role profile hash; the template passes against each', () => {
    expect(checkContract(CORGI)).toEqual([]);
    expect(checkContract(CAT)).toEqual([]);
    expect(profileHash(CAT)).toBe(profileHash(CORGI));
    expect(CAT.asset_id).not.toBe(CORGI.asset_id);
    expect(checkReceipt(TEMPLATE)).toEqual([]);
    for (const c of [CORGI, CAT]) expect(checkReceipt({ ...TEMPLATE, asset_id: c.asset_id }, { contract: c })).toEqual([]);
    expect(CORGI.acceptance.allowed_statuses).toEqual(STATUSES);
  });

  it('the template carries every contract gate, required and not_run, and the twin gate as a receiver gate', () => {
    for (const id of CORGI.acceptance.required_gate_ids) expect([gate(TEMPLATE, id)?.required, gate(TEMPLATE, id)?.status], id).toEqual([true, 'not_run']);
    for (const id of CORE_GATES) expect(CORGI.acceptance.required_gate_ids).toContain(id);
    expect(gate(TEMPLATE, 'engine_parity_twin').required_for).toBe('receiver:twin');
    expect(CORGI.acceptance.receiver_gate_ids).toEqual({ twin: ['engine_parity_twin'] });
  });

  it('Godot decides production: no production gate, criterion or config names a twin config', () => {
    for (const g of gates(TEMPLATE).filter((x) => x.required_for === undefined)) {
      expect(`${g.command} ${g.pass_rule}`, g.id).not.toMatch(/webgl|webgpu/i);
    }
    for (const c of [CORGI, CAT]) {
      for (const k of c.visual_acceptance.blocking_criteria) expect([k.id, k.configs], k.id).toEqual([k.id, ['compat', 'fplus']]);
      expect(c.visual_acceptance.configs.join(' ')).not.toMatch(/webgl|webgpu/i);
      expect(c.camera.engine_profile.configs).toEqual(['fplus', 'compat']);
    }
    expect(gate(TEMPLATE, 'team_read_30m').command).toMatch(/--configs compat,fplus/);
    expect(gate(TEMPLATE, 'engine_parity_twin').command).toMatch(/--configs webgl,webgpu/);
  });

  it('the ledger: well-formed profile hashes; the current version\'s rows carry the current hash; old rows are left alone', () => {
    const [head, ...rows] = readFileSync('docs/qa/char/benchmark.csv', 'utf8').trim().split('\n');
    const cols = head.split(',');
    for (const c of ['route', 'profile_hash', 'role', 'candidate_id', 'status', 'acceptance_evidence', 'active_minutes', 'cash_cost_usd', 'allocated_usage_usd', 'variant_kind', 'contract_version']) expect(cols).toContain(c);
    // the hash and version cells never hold a comma or a quote, so a plain split finds them
    const cell = (row: string, c: string) => row.split(',')[cols.indexOf(c)];
    const ver = (row: string) => row.split(',').at(-1);
    expect(cols.at(-1)).toBe('contract_version');
    const current = rows.filter((row) => ver(row) === CORGI.contract_version);
    expect(current.length).toBeGreaterThan(0);
    for (const row of rows) expect(cell(row, 'profile_hash')).toMatch(/^sha256:[0-9a-f]{16}$/);
    for (const row of current) expect(cell(row, 'profile_hash')).toBe(`sha256:${profileHash(CORGI).slice(0, 16)}`);
  });

  it('the CLI: exit 0 on the contracts, 1 with errors, 2 on usage; --profile-hash prints the hash', () => {
    const run = (...a: string[]) => spawnSync(process.execPath, [CHECKER, ...a], { encoding: 'utf8' });
    expect(run(CORGI_PATH, 'assets/characters/cat_rifleman/contract.json').status).toBe(0);
    const bad = run(TEMPLATE_PATH, '--contract', CORGI_PATH);
    expect([bad.status, /asset_id "null"/.test(bad.stdout)]).toEqual([1, true]);
    expect(run().status).toBe(2);
    expect(run('--profile-hash', CORGI_PATH).stdout.trim()).toBe(profileHash(CORGI));
  });
});

describe('rule 1: template keys, versions, changelog', () => {
  it('contract keys, schema, status, version and changelog', () => {
    expect(checkContract([] as Any)).toEqual(['contract: not a JSON object']);
    const c = clone(CORGI);
    delete c.identity;
    delete c.rig.max_skin_influences;
    c.camera = 'fov 72';
    Object.assign(c, { schema_version: 1, status: 'agreed', changelog: {} });
    const e = checkContract(c);
    has(e, /missing key "identity"/);
    has(e, /missing key "rig\.max_skin_influences"/);
    has(e, /"camera" must be an object/);
    has(e, /schema_version 1 \(want 2\)/);
    has(e, /status "agreed" \(want/);
    has(e, /changelog must be an array/);
    const v = clone(CORGI);
    v.contract_version = '0.1';
    has(checkContract(v), /contract_version "0\.1" is not x\.y\.z/);
    const n = clone(CORGI);
    n.contract_version = '0.1.1';
    has(checkContract(n), /no changelog entry for 0\.1\.1/);
    n.changelog.push({ version: '0.1.1', date: '2026-10-21', change: 'x' });
    has(checkContract(n), /changelog\[1\] needs version/);
    expect(semverCmp('0.10.0', '0.9.9')).toBe(1);
    expect(semverCmp('1.0.0', '1.0.0')).toBe(0);
    expect(semverCmp('x', '1.0.0')).toBe(null);
  });

  it('receipt keys and schema', () => {
    expect(checkReceipt(null as Any)).toEqual(['receipt: not a JSON object']);
    const r = clone(TEMPLATE);
    delete r.reviewers;
    delete r.director_decision.required;
    r.schema_version = 1;
    r.role_specific_gates = {};
    const e = checkReceipt(r);
    has(e, /missing key "reviewers"/);
    has(e, /missing key "director_decision\.required"/);
    has(e, /schema_version 1 \(want 2\)/);
    has(e, /gates and role_specific_gates must be arrays/);
  });
});

describe('rule 2: statuses, gate ids, core gates', () => {
  it('contract: allowed statuses, unique gate ids, core gates, no gate both production and receiver', () => {
    const c = clone(CORGI);
    c.acceptance.allowed_statuses.push('conditional');
    c.acceptance.required_gate_ids = c.acceptance.required_gate_ids.filter((x: string) => x !== 'fresh_import').concat('structural', 'engine_parity_twin');
    const e = checkContract(c);
    has(e, /allowed_statuses must be exactly/);
    has(e, /required_gate_ids must be unique strings/);
    has(e, /lacks the core gate "fresh_import"/);
    has(e, /"engine_parity_twin" is both a production gate and a receiver gate/);
  });

  it('receipt: gate keys, status, required type, duplicate ids (no shadowing), core gates', () => {
    const r = clone(TEMPLATE);
    r.gates[0].status = 'partial';
    delete r.gates[1].evidence_origin;
    r.gates[2].required = 'yes';
    const e = checkReceipt(r);
    has(e, /gate "design_form": status "partial"/);
    has(e, /gate "structural": missing evidence_origin/);
    has(e, /gate "fresh_import": required must be true, false or null/);
    const d = passing();
    d.gates.push({ ...clone(gate(d, 'runtime_performance')), evidence: [ev()] });
    gate(d, 'runtime_performance').status = 'not_run';
    const de = R(d);
    has(de, /gate "runtime_performance": duplicate id/);
    has(de, /required gate "runtime_performance" is not_run/);
    const core = clone(TEMPLATE);
    core.gates = core.gates.filter((g: Any) => g.id !== 'motion_visual');
    gate(core, 'fresh_import').required = false;
    Object.assign(gate(core, 'deformation_contact'), { required_for: 'receiver:twin' });
    core.adoption.receiver_proofs.push({ receiver: 'twin', gate_id: 'deformation_contact', adopted: false, version: null, evidence: [] });
    const ce = checkReceipt(core);
    has(ce, /core gate "motion_visual" is missing/);
    has(ce, /core gate "fresh_import" must be required for production/);
    has(ce, /core gate "deformation_contact" must be required for production/);
  });
});

describe('rule 3: evidence, justification, inheritance', () => {
  it('evidence is an array of complete entries bound to this export', () => {
    const r = passing();
    gate(r, 'design_form').evidence = [];
    gate(r, 'structural').evidence = 'report.txt';
    gate(r, 'fresh_import').evidence = [''];
    gate(r, 'motion_visual').evidence = [{ ...ev(), camera: '' }];
    gate(r, 'controller_fit').evidence = [ev('sha256:old')];
    const e = R(r);
    has(e, /gate "design_form": pass without evidence/);
    has(e, /gate "structural": evidence must be an array/);
    has(e, /gate "fresh_import": evidence\[0\] must be \{ path, sha256, export_hash, engine, renderer, camera, conditions \}/);
    has(e, /gate "motion_visual": evidence\[0\] must be/);
    has(e, /gate "controller_fit": pass evidence is not bound to this receipt's export_hash/);
    const w = passing();
    gate(w, 'engine_parity_twin').evidence = [ev('sha256:w')];
    hasNot(R(w), /engine_parity_twin.*not bound/);
  });

  it('not_applicable needs a justification; origin and inheritance are explicit; fresh import and runtime are never inherited', () => {
    const r = passing();
    delete gate(r, 'face_speech').justification;
    gate(r, 'design_form').evidence_origin = 'copied';
    gate(r, 'controller_fit').inherited_from = 'receipt-1a2b3c4d.json#controller_fit';
    const e = R(r);
    has(e, /gate "face_speech": not_applicable without a justification/);
    has(e, /gate "design_form": evidence_origin "copied"/);
    has(e, /gate "controller_fit": inherited_from and evidence_origin disagree/);
    const full = { evidence_origin: 'inherited', inherited_from: 'receipt-1a2b3c4d.json#structural', dependency_hashes: { skeleton: 'sha256:k' }, reuse_justification: 'rig and mesh unchanged; palette edit only' };
    for (const k of ['inherited_from', 'dependency_hashes', 'reuse_justification']) {
      const i = passing();
      Object.assign(gate(i, 'structural'), full, { evidence: [ev('sha256:old')], [k]: k === 'dependency_hashes' ? {} : '' });
      has(R(i), /gate "structural": inherited evidence needs inherited_from, dependency_hashes and reuse_justification/);
    }
    const ok = passing();
    Object.assign(gate(ok, 'structural'), full, { evidence: [ev('sha256:old')] });
    expect(R(ok)).toEqual([]);
    for (const id of ['fresh_import', 'runtime_performance']) {
      const n = passing();
      Object.assign(gate(n, id), full);
      has(R(n), new RegExp(`gate "${id}": never inherited`));
    }
  });
});

describe('rule 4: production acceptance', () => {
  it('the positive control: an agreed contract and a fully passed receipt are accepted', () => {
    expect(checkContract(agreed())).toEqual([]);
    expect(R(passing())).toEqual([]);
    const sha = createHash('sha256').update(readFileSync(CORGI_PATH)).digest('hex');
    const bound = passing();
    bound.contract_hash = `sha256:${sha}`;
    expect(R(bound, { contract: agreed(), contractSha: sha })).toEqual([]);
    has(R(passing(), { contract: agreed(), contractSha: sha }), /contract_hash sha256:c is not the sha256 of the contract checked/);
  });

  it('acceptance is never checked without its contract (the one-gate receipt loophole)', () => {
    const r = passing();
    r.gates = r.gates.filter((g: Any) => CORE_GATES.includes(g.id));
    r.role_specific_gates = [];
    has(checkReceipt(r), /production_accepted is checked only against its contract/);
    const e = R(r);
    has(e, /the contract's required gate "team_read_30m" is missing/);
  });

  it('every required gate passes: not_run, unsupported or not_applicable on a required gate blocks; applicability is decided', () => {
    for (const s of ['not_run', 'unsupported', 'not_applicable']) {
      const r = passing();
      Object.assign(gate(r, 'runtime_performance'), { status: s, evidence: [], justification: 'no GPU here' });
      has(R(r), new RegExp(`required gate "runtime_performance" is ${s}`));
    }
    const n = passing();
    gate(n, 'face_speech').required = null;
    has(R(n), /gate "face_speech" has no decided applicability/);
    const tmpl = clone(TEMPLATE);
    tmpl.adoption.production_accepted = true;
    for (const id of CORGI.acceptance.required_gate_ids) has(checkReceipt(tmpl), new RegExp(`required gate "${id}" is not_run`));
  });

  it('hashes, tool versions, engine and family profile, the director and reviewers', () => {
    for (const k of ['contract_hash', 'source_hash', 'export_hash', 'tool_versions', 'engine_and_hardware_profile', 'family_and_skeleton_versions']) {
      const r = passing();
      r[k] = k.endsWith('hash') ? null : {};
      has(R(r), new RegExp(`accepted without ${k}`));
    }
    const d = passing();
    d.director_decision.status = 'not_run';
    has(R(d), /required director decision is not_run or has no evidence/);
    const de = passing();
    de.director_decision.evidence = null;
    has(R(de), /required director decision is pass or has no evidence/);
    const v = passing();
    v.reviewers = [{ independent: true, evidence: 'x' }, { name: 'a', independent: 'yes', evidence: 'x' }, { name: 'b', independent: false }];
    const ve = R(v);
    for (const i of [0, 1, 2]) has(ve, new RegExp(`reviewers\\[${i}\\] needs a name`));
    const nv = passing();
    nv.reviewers = 'QA';
    has(R(nv), /reviewers\[0\] needs a name/);
    const b = passing();
    b.adoption.production_accepted = 'yes';
    has(R(b), /production_accepted must be true or false/);
  });

  it('with --contract: asset, gates present, required and production; the receipt cannot overrule the director', () => {
    const r = passing('cat_rifleman');
    r.gates = r.gates.filter((g: Any) => g.id !== 'rights_provenance');
    gate(r, 'controller_fit').required = false;
    Object.assign(gate(r, 'team_read_30m'), { required_for: 'receiver:twin', status: 'not_run', evidence: [] });
    const e = R(r);
    has(e, /asset_id "cat_rifleman" is not the contract's "corgi_rifleman"/);
    has(e, /the contract's required gate "rights_provenance" is missing/);
    has(e, /requires gate "controller_fit" but the receipt marks it required: false/);
    has(e, /requires gate "team_read_30m" for production, but the receipt moves it to receiver:twin/);
    has(e, /gate "team_read_30m": required_for "receiver:twin" names no receiver proof/);
    const d = passing();
    d.director_decision = { status: 'not_run', evidence: null, required: false };
    has(R(d), /director_decision\.required is false, but the contract says true/);
    const f = agreed();
    f.visual_acceptance.director_review_required = false;
    has(R(passing(), { contract: f }), /director_decision\.required is true, but the contract says false/);
    const nul = agreed();
    nul.visual_acceptance.director_review_required = null;
    has(R(passing(), { contract: nul }), /visual_acceptance\.director_review_required is null/);
    const solo = passing();
    solo.reviewers = [{ name: 'builder', independent: false, evidence: 'x' }];
    has(R(solo), /independent reviewer/);
    const ok = agreed();
    ok.visual_acceptance.independent_review_required = false;
    expect(R(solo, { contract: ok })).toEqual([]);
  });

  it('with --contract: an accepted receipt needs an agreed contract with no open item', () => {
    const e = R(passing(), { contract: CORGI });
    has(e, /contract in status "requirements_draft"/);
    has(e, /contract's budgets\.target_hardware is proposed/);
    has(e, /contract's budgets\.target_hardware\.value is null/);
    has(e, /contract's body_family is proposed/);
    has(e, /contract's contacts\.paw_fl\.thresholds\.slip_m_per_stance:<= is proposed/);
    has(e, /contract's family_version is null/);
    has(e, /contract's rig\.weight_sum_tolerance is null/);
    has(e, /contract's delivery\.editable_source is null/);
    has(e, /contract's delivery\.tool_versions\.blender is null/);
    has(e, /contract's source_authority\.build_recipe is null/);
    has(e, /contract's rights\.output_terms is null/);
    has(e, /contract's required_clips\.Walk\.stride_length_m is null/);
    has(e, /contract's visual_acceptance\.review_policy is proposed/);
    const one = agreed();
    one.budgets.material_slots.status = 'proposed';
    has(R(passing(), { contract: one }), /contract's budgets\.material_slots is proposed/);
    const dr = agreed();
    dr.status = 'requirements_draft';
    has(R(passing(), { contract: dr }), /accepted against a contract in status "requirements_draft"/);
  });
});

describe('open items: what an agreed contract must decide', () => {
  it('proposed records and nulls are open; { not_applicable: reason } decides a field; notes never count', () => {
    expect(openItems(agreed())).toEqual([]);
    const c = agreed();
    c.rights.code_license = { not_applicable: 'authored route: no third-party code' };
    c.rig.required_bones_note = null;
    c.source_authority.preservation = { status: 'not_run', evidence: [] };
    expect(openItems(c)).toEqual([]);
    c.rights.weights_license = { not_applicable: '' };
    c.contacts[0].thresholds[1].value = null;
    c.visual_acceptance.independent_review_required = null;
    const o = openItems(c);
    expect(o).toContain('rights.weights_license is not_applicable without a reason');
    expect(o).toContain('contacts.paw_fl.thresholds.slip_m_per_stance:<=.value is null');
    expect(o).toContain('visual_acceptance.independent_review_required is null');
    has(checkContract(c), /contract: agreed, but visual_acceptance\.independent_review_required is null/);
    const p = agreed();
    p.body_family.status = 'proposed';
    has(checkContract(p), /contract: agreed, but body_family is proposed/);
    const s = clone(CORGI);
    s.status = 'requirements_agreed';
    has(checkContract(s), /contract: agreed, but family_version is null/);
  });
});

describe('rule 5: receiver adoption', () => {
  it('the twin adopts this exact accepted export through its own passed gate; production does not wait for it', () => {
    expect(R(adopted())).toEqual([]);
    const pending = passing();
    gate(pending, 'engine_parity_twin').status = 'not_run';
    expect(R(pending)).toEqual([]);
    const r = adopted();
    gate(r, 'engine_parity_twin').status = 'not_run';
    has(R(r), /receiver "twin" adopted without its gate "engine_parity_twin" passing/);
    has(R(r), /receiver "twin" adopted while its gate "engine_parity_twin" is not_run/);
    const early = adopted();
    early.adoption.production_accepted = false;
    has(checkReceipt(early), /receiver "twin" adopted a release that is not production accepted/);
    const v = adopted();
    v.adoption.receiver_proofs[0].version = 'sha256:other';
    has(R(v), /receiver "twin" must adopt this exact export/);
    const nv = adopted();
    nv.export_hash = null;
    nv.adoption.receiver_proofs[0].version = null;
    has(R(nv), /receiver "twin" must adopt this exact export/);
    const ne = adopted();
    ne.adoption.receiver_proofs[0].evidence = [];
    has(R(ne), /receiver "twin" adopted without evidence/);
    const be = adopted();
    be.adoption.receiver_proofs[0].evidence = ['PARITY.md'];
    has(R(be), /receiver "twin": evidence\[0\] must be/);
  });

  it('a receiver cannot adopt through a gate that is not its own (the measured loophole), nor twice', () => {
    const r = adopted();
    gate(r, 'engine_parity_twin').status = 'fail';
    r.adoption.receiver_proofs[0].adopted = false;
    r.adoption.receiver_proofs.push({ receiver: 'twin', gate_id: 'structural', adopted: true, version: 'sha256:e', evidence: [ev()] });
    const e = R(r);
    has(e, /receiver "twin" cites gate "structural", which is not its own receiver gate/);
    has(e, /receiver "twin" cites "structural", not one of the contract's receiver_gate_ids/);
    has(e, /receiver "twin" adopted while its gate "engine_parity_twin" is fail/);
    has(checkReceipt(r), /cites gate "structural", which is not its own/);
    const twice = adopted();
    twice.adoption.receiver_proofs.push(clone(twice.adoption.receiver_proofs[0]));
    has(R(twice), /more than one receiver proof for twin\/engine_parity_twin/);
    const named = adopted();
    gate(named, 'engine_parity_twin').required_for = 'receiver:';
    named.adoption.receiver_proofs.push({ gate_id: 'engine_parity_twin', adopted: false, version: null, evidence: [] });
    has(checkReceipt(named), /required_for "receiver:" names no receiver proof/);
  });

  it('with --contract: every receiver gate is present and passes before any adoption', () => {
    const c = agreed();
    c.acceptance.receiver_gate_ids.twin.push('twin_perf');
    const r = adopted();
    r.gates.push({ ...clone(gate(r, 'engine_parity_twin')), id: 'twin_perf', status: 'not_run', evidence: [] });
    r.adoption.receiver_proofs.push({ receiver: 'twin', gate_id: 'twin_perf', adopted: false, version: null, evidence: [] });
    has(R(r, { contract: c }), /receiver "twin" adopted while its gate "twin_perf" is not_run/);
    const m = passing();
    m.gates = m.gates.filter((g: Any) => g.id !== 'engine_parity_twin');
    has(R(m), /the contract's receiver gate "engine_parity_twin" \(twin\) is missing/);
    const w = passing();
    delete gate(w, 'engine_parity_twin').required_for;
    has(R(w), /gate "engine_parity_twin" must be required_for "receiver:twin"/);
    const q = passing();
    gate(q, 'engine_parity_twin').required = false;
    has(R(q), /gate "engine_parity_twin" must be required_for "receiver:twin"/);
  });
});

describe('rule 6: requirement records, thresholds and criteria', () => {
  it('budgets, body_family and thresholds are { value, status, basis } records', () => {
    const c = clone(CORGI);
    c.budgets.triangles_per_lod = [20000, 8000, 3000, 1000];
    c.body_family = 'quadruped';
    delete c.budgets.texture_px.value;
    c.budgets.material_slots.status = 'measured';
    c.budgets.render_primitives.basis = ' ';
    c.budgets.deform_bones_per_lod.status = 'agreed';
    delete c.budgets.target_hardware.owner_decision;
    c.visual_acceptance.blocking_criteria[1].thresholds[0].status = 'final';
    const e = checkContract(c);
    has(e, /budgets\.triangles_per_lod must be \{ value, status, basis \}, not a bare value/);
    has(e, /body_family must be \{ value, status, owner_decision, basis \}/);
    has(e, /budgets\.texture_px must be \{ value, status, basis \}$/);
    has(e, /budgets\.material_slots: status "measured"/);
    has(e, /budgets\.render_primitives: no basis/);
    has(e, /budgets\.deform_bones_per_lod: agreed without agreed_by and agreed_on/);
    has(e, /budgets\.target_hardware: null value without owner_decision/);
    has(e, /blocking_criteria\.A2\.thresholds\.team_share:corgi:side:>=: status "final"/);
    const half = clone(CORGI);
    Object.assign(half.budgets.deform_bones_per_lod, { status: 'agreed', agreed_by: 'owner' });
    has(checkContract(half), /deform_bones_per_lod: agreed without agreed_by and agreed_on/);
  });

  it('criteria: an id, a text, its gate, thresholds with a metric and an op, no comparison in prose, no twin config', () => {
    const c = clone(CORGI);
    const k = (id: string) => c.visual_acceptance.blocking_criteria.find((x: Any) => x.id === id);
    k('A1').thresholds = {};
    k('B1').thresholds[0].op = '=>';
    k('B2').thresholds[0].metric = '';
    k('A3').text = '';
    k('A2').text += ' Share ≥ 0.35.';
    k('C1').text += ' At least >= 4.';
    k('D1').gate = 'engine_parity_twin';
    k('G1').configs = ['compat', 'fplus', 'webgl'];
    c.visual_acceptance.receiver_criteria[0].gate = 'team_read_30m';
    c.contacts[0].thresholds = null;
    const e = checkContract(c);
    has(e, /blocking_criteria\.A1\.thresholds must be an array/);
    has(e, /blocking_criteria\.B1\.thresholds\[0\] needs a metric and an op/);
    has(e, /blocking_criteria\.B2\.thresholds\[0\] needs a metric and an op/);
    has(e, /blocking_criteria entries need an id and a text/);
    has(e, /blocking_criteria\.A2: a comparison in the text belongs in thresholds/);
    has(e, /blocking_criteria\.C1: a comparison in the text belongs in thresholds/);
    has(e, /blocking_criteria\.D1: gate "engine_parity_twin" is not one of its gates/);
    has(e, /blocking_criteria\.G1: a production criterion names a twin config/);
    has(e, /receiver_criteria\.P1: gate "team_read_30m" is not one of its gates/);
    has(e, /contract: contacts\.paw_fl\.thresholds must be an array/);
    hasNot(checkContract(CORGI), /receiver_criteria/);
  });
});

describe('rule 6: --against, the versioned contract', () => {
  const bump = (c: Any, v: string, changes: string[]) => { c.contract_version = v; c.changelog.push({ version: v, date: '2026-10-21', change: 'owner ruling', changes }); return c; };

  it('the reviews\' silent edits fail under the same contract_version', () => {
    const c = clone(CORGI);
    c.contacts[0].thresholds[0].value = 0.2;
    c.acceptance.required_gate_ids = c.acceptance.required_gate_ids.filter((x: string) => x !== 'species_read');
    c.visual_acceptance.blocking_criteria[1].text = 'Team paint share >= 0.05';
    c.rig.max_skin_influences = 8;
    c.camera.engine_profile.version = '4.8.0';
    delete c.rig.required_morph_targets;
    const e = checkContract(c, { previous: CORGI });
    has(e, /rig\.required_morph_targets was removed without a higher contract_version/);
    has(e, /contacts\.paw_fl\.thresholds\.height_error_m:<=\.value changed without a higher contract_version: a silent change/);
    has(e, /acceptance\.required_gate_ids\.\d+ (changed|was removed) without a higher contract_version/);
    has(e, /blocking_criteria\.A2\.text changed without a higher contract_version/);
    has(e, /rig\.max_skin_influences changed without a higher contract_version/);
    has(e, /camera\.engine_profile\.version changed without a higher contract_version/);
  });

  it('a higher version needs a changelog entry for that version naming each changed path; notes are free', () => {
    const c = clone(CORGI);
    c.budgets.triangles_per_lod.value = [23456, 8000, 3000, 1000];
    c.visual_acceptance.blocking_criteria = c.visual_acceptance.blocking_criteria.filter((x: Any) => x.id !== 'B2');
    c.visual_acceptance.blocking_criteria.push({ id: 'H1', gate: 'motion_visual', configs: ['compat', 'fplus'], text: 'New check.', thresholds: [] });
    bump(c, '0.2.0', []);
    const e = checkContract(c, { previous: CORGI });
    has(e, /budgets\.triangles_per_lod\.value\.0 changed in 0\.2\.0 but no changelog entry for it names it/);
    has(e, /blocking_criteria\.B2\.text was removed in 0\.2\.0/);
    has(e, /blocking_criteria\.H1\.text was added in 0\.2\.0/);
    hasNot(e, /blocking_criteria\.B3/);
    c.changelog.find((x: Any) => x.version === '0.1.0').changes.push('budgets.triangles_per_lod');
    has(checkContract(c, { previous: CORGI }), /budgets\.triangles_per_lod\.value\.0 changed in 0\.2\.0/);
    c.changelog.at(-1).changes.push('budgets.triangles_per_lod', 'visual_acceptance.blocking_criteria.B2', 'visual_acceptance.blocking_criteria.H1');
    expect(checkContract(c, { previous: CORGI })).toEqual([]);
    const prose = clone(CORGI);
    prose.note += ' Reworded.';
    prose.role_note = 'reworded';
    prose.changelog[0].change = 'reworded';
    expect(checkContract(prose, { previous: CORGI })).toEqual([]);
    const tri = clone(CORGI);
    tri.budgets.triangles_per_lod.value = [23456, 8000, 3000, 1000];
    bump(tri, '0.2.0', ['budgets.triangles']);
    has(checkContract(tri, { previous: CORGI }), /budgets\.triangles_per_lod\.value\.0 changed in 0\.2\.0 but no changelog entry/);
  });

  it('versions only go up; the older copy must be a contract; a changed agreed record needs a new agreement', () => {
    const c = clone(CORGI);
    c.budgets.rifle_triangles_per_lod.value = [9000, 1000, 200];
    bump(c, '0.0.9', ['budgets.rifle_triangles_per_lod']);
    const e = checkContract(c, { previous: CORGI });
    has(e, /contract_version went backwards \(0\.1\.0 -> 0\.0\.9\)/);
    has(e, /rifle_triangles_per_lod\.value\.0 changed without a higher contract_version/);
    has(checkContract(CORGI, { previous: {} }), /--against copy has no x\.y\.z contract_version/);
    has(checkContract(CORGI, { previous: null }), /--against copy has no x\.y\.z contract_version/);
    const old = agreed();
    const cur = bump(clone(old), '0.2.0', ['budgets.material_slots']);
    cur.budgets.material_slots.value = [5, 2, 1, 1];
    has(checkContract(cur, { previous: old }), /budgets\.material_slots changed but keeps the old agreement \(agreed_on 2026-10-20\)/);
    cur.budgets.material_slots.agreed_on = '2026-10-22';
    expect(checkContract(cur, { previous: old })).toEqual([]);
    const down = clone(old);
    down.budgets.material_slots.status = 'proposed';
    has(checkContract(down, { previous: old }), /budgets\.material_slots\.status changed without a higher contract_version/);
  });
});

describe('the profile hash (ledger cohorts)', () => {
  it('ignores prose and bookkeeping, follows every requirement value', () => {
    const base = profileHash(CORGI);
    const same = clone(CORGI);
    same.budgets.triangles_per_lod.basis = 'reworded';
    same.budgets.triangles_per_lod.status = 'agreed';
    same.camera.vertical_fov_deg.source = 'reworded';
    same.camera.engine_profile.viewport_note = 'reworded';
    same.visual_acceptance.blocking_criteria[0].thresholds[0].basis = 'reworded';
    same.visual_acceptance.blocking_criteria[0].thresholds[0].owner_decision = 'OD-9';
    expect(profileHash(same)).toBe(base);
    const edits: Array<[string, (c: Any) => void]> = [
      ['body family', (c) => { c.body_family.value = 'upright_biped'; }],
      ['role', (c) => { c.role = 'crowd'; }],
      ['budget value', (c) => { c.budgets.triangles_per_lod.value = [6000, 3500, 3000, 1000]; }],
      ['clip', (c) => { c.required_clips[0].name = 'Idle_01'; }],
      ['clip loop', (c) => { c.required_clips[0].loop = false; }],
      ['contact', (c) => { c.contacts.pop(); }],
      ['contact threshold', (c) => { c.contacts[0].thresholds[0].value = 0.2; }],
      ['gate', (c) => { c.acceptance.required_gate_ids.pop(); }],
      ['receiver gate', (c) => { c.acceptance.receiver_gate_ids.twin.push('twin_perf'); }],
      ['criterion threshold', (c) => { c.visual_acceptance.blocking_criteria[1].thresholds[0].value = 0.05; }],
      ['criterion text', (c) => { c.visual_acceptance.blocking_criteria[2].text = 'Species reads.'; }],
      ['receiver criterion', (c) => { c.visual_acceptance.receiver_criteria.pop(); }],
      ['motion', (c) => { c.visual_acceptance.motion_sequences.pop(); }],
      ['deformation test', (c) => { c.deformation_tests.pop(); }],
      ['skin influences', (c) => { c.rig.max_skin_influences = 8; }],
      ['engine version', (c) => { c.camera.engine_profile.version = '4.8.0'; }],
      ['lighting profile', (c) => { c.camera.lighting_and_exposure_profile.sha256 = '0'.repeat(64); }],
      ['camera fov', (c) => { c.camera.horizontal_fov_deg = 90; }],
      ['view distances', (c) => { c.camera.view_distances_m.push(100); }],
      ['locked poses', (c) => { c.camera.locked_comparison_poses.pop(); }],
    ];
    for (const [what, edit] of edits) {
      const c = clone(CORGI);
      edit(c);
      expect(profileHash(c), what).not.toBe(base);
    }
  });
});

describe('rule 7: a measured result above its budget cannot sit beside the measuring gate\'s pass', () => {
  it('numbers, arrays and objects key by key; runtime budgets belong to runtime_performance; test descriptors are not limits', () => {
    const c = agreed();
    c.budgets.triangles_per_lod.value = [20000, 8000, 3000, 1000];
    c.budgets.render_primitives.value = [5, 3, 2, 1];
    c.budgets.material_slots.value = 4;
    c.budgets.resident_texture_memory_mib.value = { godot_desktop_cast: 57, twin_webp_1k_cast: 80 };
    c.budgets.incremental_p95_frame_time_budget_ms.value = 0.5;
    c.budgets.simultaneous_character_test_counts.value = [1, 4, 8, 24];
    const ok = passing();
    ok.measured_results = { triangles_per_lod: [20000, 7000, 2900, 900], render_primitives: [5, 3, 2, 1], material_slots: 4, simultaneous_character_test_counts: [48] };
    expect(R(ok, { contract: c })).toEqual([]);
    const cases: Array<[string, unknown, string]> = [
      ['triangles_per_lod', [21000, 7000, 2900, 900], 'structural'],
      ['material_slots', 5, 'structural'],
      ['resident_texture_memory_mib', { godot_desktop_cast: 999 }, 'runtime_performance'],
      ['incremental_p95_frame_time_budget_ms', 0.7, 'runtime_performance'],
    ];
    for (const [k, m, g] of cases) {
      const r = passing();
      r.measured_results = { [k]: m };
      has(R(r, { contract: c }), new RegExp(`measured ${k} .* exceeds the budget .* but ${g} is pass`));
      gate(r, g).status = 'fail';
      hasNot(R(r, { contract: c }), /exceeds the budget/);
    }
    const cross = passing();
    cross.measured_results = { incremental_p95_frame_time_budget_ms: 0.7 };
    gate(cross, 'runtime_performance').status = 'fail';
    hasNot(R(cross, { contract: c }), /exceeds the budget/);
  });
});
