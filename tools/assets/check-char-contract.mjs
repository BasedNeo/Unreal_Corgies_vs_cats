#!/usr/bin/env node
// tools/assets/check-char-contract.mjs (CHAR standard; docs/design/CHARACTER_PIPELINE.md §8): checks character
// contracts (assets/characters/<id>/contract.json) and acceptance receipts (assets/characters/receipt.template.json and
// the receipts made from it) against the studio standard's templates (character-contract.template.json and
// acceptance-receipt.template.json, schema_version 2) plus the project keys. Structure and acceptance logic only: it
// never opens a mesh, a render, a log or a licence, so a clean run proves no art, motion or performance.
//   node tools/assets/check-char-contract.mjs <file.json>... [--contract <contract.json>] [--against <older contract.json>]
//   node tools/assets/check-char-contract.mjs --profile-hash <contract.json>
// A file with a "gates" array is a receipt; any other file is a contract. --contract cross-checks receipts against one
// contract (and binds receipt.contract_hash to that file's sha256); --against compares each contract with an older copy
// (e.g. `git show HEAD:<path>`). Exit 0 = no errors, 1 = errors (one per line), 2 = usage or unreadable file.
// The rules (each one is pinned by a failing copy in tests/unit/char-contract.test.ts):
//  1. every key of the templates is present, nested ones too; schema_version 2; a known contract status; a semver
//     contract_version with its own changelog entry (null = unspecified, never unlimited or passed);
//  2. gate statuses are pass | fail | not_run | unsupported | not_applicable, and allowed_statuses is exactly that set;
//     gate ids are unique; the standard's five core gates are present and required for production;
//  3. a pass names evidence, each entry {path, sha256, export_hash, engine, renderer, camera, conditions}, bound to this
//     receipt's export (or web variant); not_applicable names a justification; inherited evidence names the prior
//     result, the unchanged dependency hashes and the reason; fresh_import and runtime_performance are never inherited;
//  4. production_accepted: true is checked only with --contract and needs every required gate pass (not_applicable only
//     for a gate that is not required), every gate's applicability decided, the hashes, tool versions, engine and
//     family profile, the director's pass when the contract requires it (the receipt cannot overrule the contract), named
//     reviewers with evidence, an independent one when required, and an agreed contract with no open item: no
//     { status: proposed } record anywhere and no null where a decision is due (or { not_applicable: <reason> });
//  5. a receiver adoption needs an accepted release, adopts that exact export, and cites a passed gate of its own
//     receiver (required_for "receiver:<name>"; with --contract, one of receiver_gate_ids[<name>], all of which pass);
//     one proof per (receiver, gate); a production gate cannot be moved to a receiver;
//  6. every requirement record (budgets, body_family, criterion and contact thresholds, review policy) is
//     { value, status: proposed | agreed, basis }: agreed names agreed_by and agreed_on, a null value names an
//     owner_decision; comparisons live in thresholds, not in criterion text; a production criterion never names a twin
//     config. With --against, any change of a requirement field (all but notes and the changelog) needs a higher
//     contract_version and a changelog entry for it that names the changed path; a changed agreed record needs a new
//     agreement;
//  7. with --contract, a measured result above its budget (numbers, arrays and objects, key by key) cannot sit beside a
//     pass of the gate that measures it (runtime budgets: runtime_performance; the rest: structural).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const STATUSES = ['pass', 'fail', 'not_run', 'unsupported', 'not_applicable'];
export const RECORD_STATUSES = ['proposed', 'agreed'];
export const CONTRACT_STATUSES = ['requirements_template', 'requirements_draft', 'requirements_agreed'];
export const CORE_GATES = ['structural', 'fresh_import', 'deformation_contact', 'motion_visual', 'runtime_performance'];
export const NEVER_INHERITED = ['fresh_import', 'runtime_performance'];
export const RUNTIME_BUDGETS = ['incremental_p95_frame_time_budget_ms', 'resident_texture_memory_mib',
  'cpu_animation_update_ms_per_character', 'transparent_overdraw'];
/** Budgets that describe the test, not a ceiling. */
export const NOT_LIMITS = ['simultaneous_character_test_counts', 'target_hardware', 'target_resolution',
  'lod_switch_projected_height_px'];
export const TWIN_CONFIGS = ['webgl', 'webgpu'];
export const EVIDENCE_KEYS = ['path', 'sha256', 'export_hash', 'engine', 'renderer', 'camera', 'conditions'];
export const OPS = ['>=', '<=', '>', '<', '=='];

/** The standard's contract template (schema_version 2): top key -> null (any value) or its required sub-keys. */
export const CONTRACT_KEYS = {
  schema_version: null, status: null, asset_id: null, role: null, family_version: null, source_priority: null,
  coordinates: ['units', 'blender_axes', 'delivery_up', 'delivery_forward', 'pivot'],
  identity: ['reference_hashes', 'style_profile', 'proportion_landmarks', 'allowed_variant_dimensions'],
  camera: ['engine_profile', 'horizontal_fov_deg', 'aspect_ratio', 'view_distances_m', 'near_plane_m',
    'locked_comparison_poses', 'lighting_and_exposure_profile'],
  rig: ['skeleton_contract_version', 'bind_pose', 'required_bones', 'joint_limit_source', 'max_skin_influences',
    'weight_sum_tolerance', 'required_morph_targets', 'attachment_nodes', 'root_motion_authority'],
  budgets: ['triangles_per_lod', 'deform_bones_per_lod', 'material_slots', 'render_primitives',
    'resident_texture_memory_mib', 'simultaneous_character_test_counts', 'incremental_p95_frame_time_budget_ms',
    'target_hardware', 'target_resolution'],
  required_clips: null, deformation_tests: null, contacts: null,
  delivery: ['editable_source', 'review_package', 'production_layout', 'render_mesh_used_as_physics_collision',
    'source_and_delivery_hashes', 'tool_versions', 'upstream_dependency_hashes'],
  rights: ['code_license', 'weights_license', 'base_and_module_licenses', 'input_and_likeness_rights', 'output_terms',
    'preprocessing_dependency_terms', 'upload_and_spend_authorization'],
  acceptance: ['receipt_path', 'required_gate_ids', 'allowed_statuses'],
  known_defects: null, note: null,
  source_authority: ['editable_art_source', 'build_recipe', 'base_release_hash', 'skeleton_release_hash', 'preservation'],
  visual_acceptance: ['reference_hashes', 'blocking_criteria', 'motion_sequences', 'independent_review_required',
    'director_review_required'],
  intentional_exceptions: null,
  // project keys (docs/design/CHARACTER_PIPELINE.md §3)
  contract_version: null, changelog: null, body_family: null, controller_contract: null,
};

/** The standard's receipt template (schema_version 2). director_decision.required is a project key. */
export const RECEIPT_KEYS = {
  schema_version: null, asset_id: null, contract_hash: null, source_hash: null, export_hash: null,
  family_and_skeleton_versions: null, tool_versions: null, engine_and_hardware_profile: null, gates: null,
  reviewers: null, director_decision: ['status', 'evidence', 'required'], measured_results: null, known_defects: null,
  adoption: ['production_accepted', 'receiver_proofs'], note: null, role_specific_gates: null,
};
export const GATE_KEYS = ['id', 'status', 'required', 'evidence', 'limitations', 'evidence_origin', 'dependency_hashes',
  'inherited_from', 'reuse_justification'];

/** Where a null is an open decision once a contract is agreed (a { not_applicable: <reason> } object decides it). */
export const DECISION_PATHS = ['family_version', 'rig', 'contacts', 'required_clips', 'budgets', 'rights',
  'delivery.editable_source', 'delivery.tool_versions', 'source_authority.editable_art_source',
  'source_authority.build_recipe', 'source_authority.base_release_hash', 'source_authority.skeleton_release_hash',
  'visual_acceptance.independent_review_required', 'visual_acceptance.director_review_required'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) ? v.length > 0 : isObj(v) ? Object.keys(v).length > 0 : v != null;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const semver = (v) => SEMVER.exec(String(v))?.slice(1).map(Number) ?? null;
/** -1, 0 or 1; null when either side is not x.y.z. */
export function semverCmp(a, b) {
  const x = semver(a), y = semver(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
const at = (doc, path) => path.split('.').reduce((v, k) => (isObj(v) ? v[k] : undefined), doc);
/** An array member's stable key: its id or name, a threshold's metric[:species][:view]:op, else its index. */
const memberKey = (x, i) => !isObj(x) ? i : filled(x.id) ? x.id : filled(x.name) ? x.name
  : filled(x.metric) ? [x.metric, x.species, x.view, x.op].filter(Boolean).join(':') : i;
const isProse = (k) => k === 'note' || k === 'notes' || k.endsWith('_note') || k.endsWith('_notes');

function keysErrors(doc, spec, what) {
  if (!isObj(doc)) return [`${what}: not a JSON object`];
  const errs = [];
  for (const [k, sub] of Object.entries(spec)) {
    if (!(k in doc)) { errs.push(`${what}: missing key "${k}"`); continue; }
    if (sub && !isObj(doc[k])) { errs.push(`${what}: "${k}" must be an object`); continue; }
    for (const s of sub ?? []) if (!(s in doc[k])) errs.push(`${what}: missing key "${k}.${s}"`);
  }
  return errs;
}

/** Every object below `v` with a `status` key, as [path, object] (gates and preservation records excluded). */
function records(v, path = '') {
  if (Array.isArray(v)) return v.flatMap((x, i) => records(x, `${path}.${memberKey(x, i)}`));
  if (!isObj(v)) return [];
  const own = 'status' in v && path !== '' && path !== '.source_authority.preservation' ? [[path.slice(1), v]] : [];
  return [...own, ...Object.entries(v).flatMap(([k, x]) => records(x, `${path}.${k}`))];
}

/** The decisions still open in a contract: proposed records anywhere, and nulls under DECISION_PATHS. */
export function openItems(c) {
  const out = records(c).filter(([, r]) => r.status !== 'agreed').map(([p, r]) => `${p} is ${r.status}`);
  const nulls = (v, path) => v === null ? [`${path} is null`]
    : Array.isArray(v) ? v.flatMap((x, i) => nulls(x, `${path}.${memberKey(x, i)}`))
      : isObj(v) && 'not_applicable' in v ? (filled(v.not_applicable) ? [] : [`${path} is not_applicable without a reason`])
        : isObj(v) ? Object.entries(v).filter(([k]) => !isProse(k)).flatMap(([k, x]) => nulls(x, `${path}.${k}`))
        : [];
  for (const p of DECISION_PATHS) out.push(...nulls(at(c, p), p));
  return out;
}

function recordErrors(path, r) {
  const where = `contract: ${path}`;
  if (!('value' in r)) return [`${where} must be { value, status, basis }`];
  const errs = [];
  if (!RECORD_STATUSES.includes(r.status)) errs.push(`${where}: status "${r.status}" (want proposed | agreed)`);
  if (!filled(r.basis)) errs.push(`${where}: no basis`);
  if (r.status === 'agreed' && (!filled(r.agreed_by) || !filled(r.agreed_on))) errs.push(`${where}: agreed without agreed_by and agreed_on`);
  if (r.value === null && !filled(r.owner_decision)) errs.push(`${where}: null value without owner_decision`);
  return errs;
}

function thresholdErrors(where, list) {
  if (!Array.isArray(list)) return [`contract: ${where}.thresholds must be an array`];
  return list.flatMap((t, i) => !isObj(t) || !filled(t.metric) || !OPS.includes(t.op)
    ? [`contract: ${where}.thresholds[${i}] needs a metric and an op (${OPS.join(' ')})`] : []);
}

/** A requirement view: the contract without notes, the changelog and its version, flattened to path -> JSON value. Array members
 *  with an id (or a name, or a metric) are keyed by it, so a removal names the member, not a shifted index. */
export function requirementPaths(c) {
  const out = new Map();
  const walk = (v, path) => {
    if (Array.isArray(v)) {
      const keyed = v.every((x, i) => memberKey(x, i) !== i);
      if (!v.length) out.set(path, '[]');
      v.forEach((x, i) => walk(x, `${path}.${keyed ? memberKey(x, i) : i}`));
    } else if (isObj(v)) {
      const keys = Object.keys(v).filter((k) => !isProse(k) && !(path === '' && ['changelog', 'contract_version'].includes(k)));
      if (!keys.length) out.set(path, '{}');
      for (const k of keys) walk(v[k], path ? `${path}.${k}` : k);
    } else out.set(path, JSON.stringify(v));
  };
  walk(c, '');
  return out;
}

/** Errors of one contract; `previous` is an older copy of the same contract (rule 6). */
export function checkContract(c, { previous } = {}) {
  const errs = keysErrors(c, CONTRACT_KEYS, 'contract');
  if (!isObj(c)) return errs;
  if (c.schema_version !== 2) errs.push(`contract: schema_version ${c.schema_version} (want 2)`);
  if (!CONTRACT_STATUSES.includes(c.status)) errs.push(`contract: status "${c.status}" (want ${CONTRACT_STATUSES.join(' | ')})`);
  if (!semver(c.contract_version)) errs.push(`contract: contract_version "${c.contract_version}" is not x.y.z`);
  if (!Array.isArray(c.changelog)) errs.push('contract: changelog must be an array');
  else {
    for (const [i, e] of c.changelog.entries()) {
      if (!isObj(e) || !semver(e.version) || !filled(e.date) || !filled(e.change) || !Array.isArray(e.changes)) {
        errs.push(`contract: changelog[${i}] needs version (x.y.z), date, change and a changes array`);
      }
    }
    if (!c.changelog.some((e) => e?.version === c.contract_version)) errs.push(`contract: no changelog entry for ${c.contract_version}`);
  }
  const allowed = c.acceptance?.allowed_statuses;
  if (!Array.isArray(allowed) || allowed.length !== STATUSES.length || !STATUSES.every((s) => allowed.includes(s))) {
    errs.push(`contract: acceptance.allowed_statuses must be exactly ${STATUSES.join(', ')}`);
  }
  const ids = c.acceptance?.required_gate_ids;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string') || new Set(ids).size !== ids.length) {
    errs.push('contract: acceptance.required_gate_ids must be unique strings');
  }
  for (const g of CORE_GATES) if (!(ids ?? []).includes?.(g)) errs.push(`contract: required_gate_ids lacks the core gate "${g}"`);
  for (const [name, rids] of Object.entries(c.acceptance?.receiver_gate_ids ?? {})) {
    for (const id of Array.isArray(rids) ? rids : []) {
      if ((ids ?? []).includes?.(id)) errs.push(`contract: "${id}" is both a production gate and a receiver gate (${name})`);
    }
  }
  for (const [k, b] of Object.entries(isObj(c.budgets) ? c.budgets : {})) {
    if (!isObj(b) || !('status' in b)) errs.push(`contract: budgets.${k} must be { value, status, basis }, not a bare value`);
  }
  if (!isObj(c.body_family) || !('status' in c.body_family)) errs.push('contract: body_family must be { value, status, owner_decision, basis }');
  for (const [path, r] of records(c)) errs.push(...recordErrors(path, r));
  const criteria = (where, list, gateIds, twinOk) => {
    for (const x of Array.isArray(list) ? list : []) {
      const w = `${where}.${x?.id}`;
      if (!filled(x?.id) || !filled(x?.text)) { errs.push(`contract: ${where} entries need an id and a text`); continue; }
      errs.push(...thresholdErrors(w, x.thresholds));
      if (/[≥≤]|>=|<=/.test(x.text)) errs.push(`contract: ${w}: a comparison in the text belongs in thresholds`);
      if (!gateIds.includes(x.gate)) errs.push(`contract: ${w}: gate "${x.gate}" is not one of its gates`);
      if (!twinOk && (x.configs ?? []).some((cfg) => TWIN_CONFIGS.includes(cfg))) errs.push(`contract: ${w}: a production criterion names a twin config`);
    }
  };
  criteria('visual_acceptance.blocking_criteria', c.visual_acceptance?.blocking_criteria, ids ?? [], false);
  criteria('visual_acceptance.receiver_criteria', c.visual_acceptance?.receiver_criteria ?? [],
    Object.values(c.acceptance?.receiver_gate_ids ?? {}).flat(), true);
  for (const x of Array.isArray(c.contacts) ? c.contacts : []) errs.push(...thresholdErrors(`contacts.${x?.id}`, x?.thresholds));
  if (c.status === 'requirements_agreed') for (const o of openItems(c)) errs.push(`contract: agreed, but ${o}`);
  if (previous !== undefined) errs.push(...againstErrors(c, previous));
  return errs;
}

function againstErrors(c, previous) {
  if (!isObj(previous) || !semver(previous.contract_version)) return ['contract: the --against copy has no x.y.z contract_version'];
  const errs = [];
  const cmp = semverCmp(c.contract_version, previous.contract_version);
  if (cmp === -1) errs.push(`contract: contract_version went backwards (${previous.contract_version} -> ${c.contract_version})`);
  const now = requirementPaths(c), was = requirementPaths(previous);
  const changed = [...new Set([...now.keys(), ...was.keys()])].filter((p) => now.get(p) !== was.get(p)).sort();
  const named = (c.changelog ?? []).filter((e) => e?.version === c.contract_version).flatMap((e) => e.changes ?? []);
  for (const p of changed) {
    const what = now.has(p) ? (was.has(p) ? 'changed' : 'was added') : 'was removed';
    if (cmp !== 1) errs.push(`contract: ${p} ${what} without a higher contract_version: a silent change`);
    else if (!named.some((n) => p === n || p.startsWith(`${n}.`))) errs.push(`contract: ${p} ${what} in ${c.contract_version} but no changelog entry for it names it`);
  }
  const old = new Map(records(previous));
  for (const [path, r] of records(c)) {
    const o = old.get(path);
    if (o?.status === 'agreed' && r.status === 'agreed' && JSON.stringify(o.value) !== JSON.stringify(r.value) && r.agreed_on === o.agreed_on) {
      errs.push(`contract: ${path} changed but keeps the old agreement (agreed_on ${o.agreed_on})`);
    }
  }
  return errs;
}

function evidenceErrors(where, list) {
  return (Array.isArray(list) ? list : []).flatMap((e, i) => !isObj(e) || EVIDENCE_KEYS.some((k) => !filled(e[k]))
    ? [`${where}: evidence[${i}] must be { ${EVIDENCE_KEYS.join(', ')} }, each filled`] : []);
}

const forProduction = (g) => g.required_for === undefined || g.required_for === 'production';

/** Errors of one receipt; `contract` enables rules 4, 5 and 7 in full; `contractSha` is that file's sha256 (hex). */
export function checkReceipt(r, { contract, contractSha } = {}) {
  const errs = keysErrors(r, RECEIPT_KEYS, 'receipt');
  if (!isObj(r)) return errs;
  if (r.schema_version !== 2) errs.push(`receipt: schema_version ${r.schema_version} (want 2)`);
  if (!Array.isArray(r.gates) || !Array.isArray(r.role_specific_gates)) errs.push('receipt: gates and role_specific_gates must be arrays');
  const gates = [...(Array.isArray(r.gates) ? r.gates : []), ...(Array.isArray(r.role_specific_gates) ? r.role_specific_gates : [])];
  const proofs = Array.isArray(r.adoption?.receiver_proofs) ? r.adoption.receiver_proofs : [];
  const exports = [r.export_hash, r.web_variant_hash].filter(filled);
  const byId = new Map();
  for (const g of gates) {
    const where = `receipt: gate "${g?.id}"`;
    const miss = GATE_KEYS.filter((k) => !isObj(g) || !(k in g));
    if (miss.length) { errs.push(`${where}: missing ${miss.join(', ')}`); continue; }
    if (byId.has(g.id)) { errs.push(`${where}: duplicate id`); continue; }
    byId.set(g.id, g);
    if (!STATUSES.includes(g.status)) errs.push(`${where}: status "${g.status}" (want ${STATUSES.join(' | ')})`);
    if (g.required !== null && typeof g.required !== 'boolean') errs.push(`${where}: required must be true, false or null`);
    if (!Array.isArray(g.evidence)) errs.push(`${where}: evidence must be an array`);
    errs.push(...evidenceErrors(where, g.evidence));
    if (g.status === 'pass' && !filled(g.evidence)) errs.push(`${where}: pass without evidence`);
    if (g.status === 'pass' && g.evidence_origin === 'current_export' && (g.evidence ?? []).some?.((e) => !exports.includes(e?.export_hash))) {
      errs.push(`${where}: pass evidence is not bound to this receipt's export_hash or web_variant_hash`);
    }
    if (g.status === 'not_applicable' && !filled(g.justification)) errs.push(`${where}: not_applicable without a justification`);
    if (!['current_export', 'inherited'].includes(g.evidence_origin)) errs.push(`${where}: evidence_origin "${g.evidence_origin}"`);
    if ((g.evidence_origin === 'inherited') !== (g.inherited_from != null)) errs.push(`${where}: inherited_from and evidence_origin disagree`);
    if (g.evidence_origin === 'inherited' && (!filled(g.inherited_from) || !filled(g.reuse_justification) || !filled(g.dependency_hashes))) {
      errs.push(`${where}: inherited evidence needs inherited_from, dependency_hashes and reuse_justification`);
    }
    if (g.evidence_origin === 'inherited' && NEVER_INHERITED.includes(g.id)) errs.push(`${where}: never inherited (it runs on the new export)`);
    if (!forProduction(g)) {
      const name = /^receiver:(\w+)$/.exec(String(g.required_for))?.[1];
      if (!name || !proofs.some((p) => p?.receiver === name && p?.gate_id === g.id)) {
        errs.push(`${where}: required_for "${g.required_for}" names no receiver proof that uses this gate`);
      }
    }
  }
  for (const id of CORE_GATES) {
    const g = byId.get(id);
    if (!g) errs.push(`receipt: the core gate "${id}" is missing`);
    else if (g.required !== true || !forProduction(g)) errs.push(`receipt: the core gate "${id}" must be required for production`);
  }
  for (const [i, x] of (Array.isArray(r.reviewers) ? r.reviewers : [null]).entries()) {
    if (!isObj(x) || !filled(x.name) || typeof x.independent !== 'boolean' || !filled(x.evidence)) {
      errs.push(`receipt: reviewers[${i}] needs a name, independent true | false and evidence`);
    }
  }
  const accepted = r.adoption?.production_accepted;
  if (accepted !== true && accepted !== false) errs.push('receipt: adoption.production_accepted must be true or false');
  if (accepted === true) {
    if (contract === undefined) errs.push('receipt: production_accepted is checked only against its contract (--contract)');
    for (const g of byId.values()) {
      if (g.required === null) errs.push(`receipt: accepted, but gate "${g.id}" has no decided applicability (required: null)`);
      if (g.required === true && forProduction(g) && g.status !== 'pass') errs.push(`receipt: accepted, but required gate "${g.id}" is ${g.status}`);
    }
    for (const k of ['contract_hash', 'source_hash', 'export_hash', 'tool_versions', 'engine_and_hardware_profile', 'family_and_skeleton_versions']) {
      if (!filled(r[k])) errs.push(`receipt: accepted without ${k}`);
    }
    if (r.director_decision?.required === true && (r.director_decision?.status !== 'pass' || !filled(r.director_decision?.evidence))) {
      errs.push(`receipt: accepted, but the required director decision is ${r.director_decision?.status} or has no evidence`);
    }
  }
  const seen = new Set();
  for (const p of proofs) {
    const key = `${p?.receiver}/${p?.gate_id}`;
    if (seen.has(key)) errs.push(`receipt: more than one receiver proof for ${key}`);
    seen.add(key);
    if (p?.adopted !== true) continue;
    const g = byId.get(p.gate_id);
    if (accepted !== true) errs.push(`receipt: receiver "${p.receiver}" adopted a release that is not production accepted`);
    if (!g || g.required_for !== `receiver:${p.receiver}`) errs.push(`receipt: receiver "${p.receiver}" cites gate "${p.gate_id}", which is not its own receiver gate`);
    else if (g.status !== 'pass') errs.push(`receipt: receiver "${p.receiver}" adopted without its gate "${p.gate_id}" passing`);
    if (!filled(r.export_hash) || p.version !== r.export_hash) errs.push(`receipt: receiver "${p.receiver}" must adopt this exact export (version = export_hash)`);
    errs.push(...evidenceErrors(`receipt: receiver "${p.receiver}"`, p.evidence));
    if (!filled(p.evidence)) errs.push(`receipt: receiver "${p.receiver}" adopted without evidence`);
  }
  if (contract !== undefined) errs.push(...contractCrossErrors(r, contract, byId, proofs, accepted, contractSha));
  return errs;
}

function contractCrossErrors(r, contract, byId, proofs, accepted, contractSha) {
  const errs = [];
  if (r.asset_id !== contract?.asset_id) errs.push(`receipt: asset_id "${r.asset_id}" is not the contract's "${contract?.asset_id}"`);
  if (accepted === true && contractSha !== undefined && r.contract_hash !== `sha256:${contractSha}`) {
    errs.push(`receipt: contract_hash ${r.contract_hash} is not the sha256 of the contract checked (sha256:${contractSha})`);
  }
  for (const id of contract?.acceptance?.required_gate_ids ?? []) {
    const g = byId.get(id);
    if (!g) errs.push(`receipt: the contract's required gate "${id}" is missing`);
    else if (g.required !== true) errs.push(`receipt: the contract requires gate "${id}" but the receipt marks it required: ${g.required}`);
    else if (!forProduction(g)) errs.push(`receipt: the contract requires gate "${id}" for production, but the receipt moves it to ${g.required_for}`);
  }
  const receivers = contract?.acceptance?.receiver_gate_ids ?? {};
  for (const [name, rids] of Object.entries(receivers)) {
    for (const id of Array.isArray(rids) ? rids : []) {
      const g = byId.get(id);
      if (!g) errs.push(`receipt: the contract's receiver gate "${id}" (${name}) is missing`);
      else if (g.required !== true || g.required_for !== `receiver:${name}`) errs.push(`receipt: gate "${id}" must be required_for "receiver:${name}"`);
    }
  }
  for (const p of proofs) {
    if (p?.adopted !== true) continue;
    const rids = Array.isArray(receivers[p.receiver]) ? receivers[p.receiver] : [];
    if (!rids.includes(p.gate_id)) errs.push(`receipt: receiver "${p.receiver}" cites "${p.gate_id}", not one of the contract's receiver_gate_ids`);
    for (const id of rids) if (byId.get(id)?.status !== 'pass') errs.push(`receipt: receiver "${p.receiver}" adopted while its gate "${id}" is ${byId.get(id)?.status}`);
  }
  const director = contract?.visual_acceptance?.director_review_required;
  if (typeof director === 'boolean' && r.director_decision?.required !== director) {
    errs.push(`receipt: director_decision.required is ${r.director_decision?.required}, but the contract says ${director}`);
  }
  if (accepted === true) {
    if (contract?.status !== 'requirements_agreed') errs.push(`receipt: accepted against a contract in status "${contract?.status}"`);
    for (const o of openItems(contract ?? {})) errs.push(`receipt: accepted while the contract's ${o}`);
    if (contract?.visual_acceptance?.independent_review_required === true && !(r.reviewers ?? []).some?.((x) => x?.independent === true)) {
      errs.push('receipt: accepted, but the contract requires an independent reviewer and none is on record');
    }
  }
  const over = (m, lim) => typeof m === 'number' && typeof lim === 'number' ? m > lim
    : Array.isArray(m) && Array.isArray(lim) ? m.some((x, i) => over(x, lim[i]))
      : isObj(m) && isObj(lim) ? Object.keys(m).some((k) => over(m[k], lim[k])) : false;
  for (const [k, b] of Object.entries(contract?.budgets ?? {})) {
    if (NOT_LIMITS.includes(k)) continue;
    const m = r.measured_results?.[k];
    const gate = RUNTIME_BUDGETS.includes(k) ? 'runtime_performance' : 'structural';
    if (m != null && b?.value != null && over(m, b.value) && byId.get(gate)?.status === 'pass') {
      errs.push(`receipt: measured ${k} ${JSON.stringify(m)} exceeds the budget ${JSON.stringify(b.value)}, but ${gate} is pass`);
    }
  }
  return errs;
}

const canon = (v) => Array.isArray(v) ? v.map(canon)
  : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
/** Prose and agreement bookkeeping: left out of the profile, so rewording a basis or agreeing an unchanged value does
 *  not split a cohort. */
const PROFILE_SKIP = new Set(['basis', 'status', 'agreed_by', 'agreed_on', 'owner_decision', 'source', 'sources']);
const bare = (v) => Array.isArray(v) ? v.map(bare)
  : isObj(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !isProse(k) && !PROFILE_SKIP.has(k)).map(([k, x]) => [k, bare(x)])) : v;

/** The role profile's hash (the benchmark ledger's profile_hash): what makes two candidates comparable, not who they
 *  are. Identity, rights, delivery and prose are left out, so the corgi and the cat of one role share it; a changed
 *  number, threshold, criterion, clip, contact, gate, engine version or lighting profile changes it. */
export function profileHash(c) {
  const cam = c.camera ?? {};
  const va = c.visual_acceptance ?? {};
  const profile = bare({
    role: c.role, body_family: c.body_family?.value ?? null,
    camera: [cam.vertical_fov_deg, cam.horizontal_fov_deg, cam.aspect_ratio, cam.view_distances_m, cam.near_plane_m,
      cam.locked_comparison_poses, cam.engine_profile, cam.lighting_and_exposure_profile],
    max_skin_influences: c.rig?.max_skin_influences ?? null,
    budgets: Object.fromEntries(Object.entries(c.budgets ?? {}).map(([k, b]) => [k, isObj(b) ? b.value ?? null : b])),
    clips: (c.required_clips ?? []).map((x) => [x?.name, x?.kind, x?.loop, x?.in_place]),
    contacts: (c.contacts ?? []).map((x) => [x?.id, x?.type, x?.effector, x?.thresholds]),
    gates: c.acceptance?.required_gate_ids ?? [], receiver_gates: c.acceptance?.receiver_gate_ids ?? {},
    criteria: [va.blocking_criteria ?? [], va.receiver_criteria ?? []], motion: va.motion_sequences ?? [],
    deformation_tests: (c.deformation_tests ?? []).map((x) => x?.id ?? x),
  });
  return createHash('sha256').update(JSON.stringify(canon(profile))).digest('hex');
}

function main(argv) {
  const files = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (['--contract', '--against', '--profile-hash'].includes(argv[i])) opt[argv[i].slice(2)] = argv[++i];
    else files.push(argv[i]);
  }
  const text = (p) => readFileSync(p, 'utf8');
  try {
    if (opt['profile-hash']) { console.log(profileHash(JSON.parse(text(opt['profile-hash'])))); return 0; }
    if (!files.length) throw new Error('usage: check-char-contract.mjs <file.json>... [--contract <c.json>] [--against <old.json>]');
    const contract = opt.contract ? JSON.parse(text(opt.contract)) : undefined;
    const contractSha = opt.contract ? createHash('sha256').update(readFileSync(opt.contract)).digest('hex') : undefined;
    const previous = opt.against ? JSON.parse(text(opt.against)) : undefined;
    let bad = 0;
    for (const f of files) {
      const doc = JSON.parse(text(f));
      const errs = isObj(doc) && Array.isArray(doc.gates) ? checkReceipt(doc, { contract, contractSha }) : checkContract(doc, { previous });
      for (const e of errs) console.log(`${f}: ${e}`);
      console.log(`${f}: ${errs.length ? `FAIL (${errs.length})` : 'PASS'}`);
      bad += errs.length;
    }
    return bad ? 1 : 0;
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
