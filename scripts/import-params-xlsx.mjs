#!/usr/bin/env node
/**
 * 파라미터 가져오기(ADR-108) — 사용자가 고친 `K-JAMDS_파라미터.xlsx`를 읽어 **현행 카탈로그와 다른 값만** 덮어쓰기(overlay)
 * JSON으로 만든다. 소스 파일은 건드리지 않는다. 만든 JSON은 엔진에 `features.catalogOverlay`로 넘기거나
 * `scripts/run-with-overlay.mjs`로 실행한다.
 *
 * 실행:  node scripts/import-params-xlsx.mjs [xlsx경로] [--deployment HANBANDO_FULL_NORMAL] [--out overlay.json] [--strict]
 *   · 기본 xlsx: 저장소 루트 K-JAMDS_파라미터.xlsx · 기본 out: 저장소 루트 K-JAMDS_파라미터_overlay.json
 *   · --strict: 검증 경고가 하나라도 있으면 종료 코드 1(파일은 쓰지 않는다)
 *
 * 읽는 시트와 셀(내보내기 형식과 같은 열 이름을 머리글에서 찾는다 — 열 순서가 바뀌어도 된다):
 *   아군자산_<배치>  : 위도·경도 · 탐지거리km(센서) · 사거리km·동시교전채널·교전시간s·탄약(포대) · 결심석·대기실·처리시간s(As-Is/To-Be)(C2)
 *   자산제원_센서    : 탐지km·추적km·사통km·탐지→추적s·추적→사통s·탐지확률·보고주기s  → 그 유형의 센서 노드 전부
 *   자산제원_포대    : 요격탄별 최소/최대사거리·최소/최대고도·요격탄속도 · 교전가능위협(IADS)  → 그 유형의 포대 노드 전부
 *   통신계선_<배치>  : As-Is/To-Be 매체·지연s  (종류 열로 링크를 특정)
 *   행 삭제: 아군자산 시트에서 id 행을 지우면 그 노드를 제거한다(removeNodes). 새 행(새 id)은 지원하지 않는다 — 경고.
 *
 * 규율: 값을 지어내지 않는다(현행 값과 같은 셀은 무시). 검증에 걸린 셀은 이름과 함께 경고하고 건너뛴다.
 * 보안: 실제 위치·제원을 넣은 xlsx와 overlay JSON은 저장소에 커밋하지 않는다(.gitignore에 *_overlay.json).
 */
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
import { readXlsx } from './xlsx-read.mjs';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js',
  'data/threats.js', 'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js',
  'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);

// ── 인자 ──
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const xlsxPath = argv.find((a) => a.endsWith('.xlsx')) || path.join(root, 'K-JAMDS_파라미터.xlsx');
const depId = opt('--deployment', 'HANBANDO_FULL_NORMAL');
const outPath = opt('--out', path.join(root, 'K-JAMDS_파라미터_overlay.json'));
const strict = argv.includes('--strict');
const depSuffix = depId.indexOf('LEGACY') !== -1 ? 'LEGACY' : 'FULL';

const MEDIA_KO = { datalink: '데이터링크', ifcn: 'IFCN 킬웹', internal: '체계 내부', 'report-cycle': '센서 보고주기',
  'kvmf-relay': 'KVMF 상급경유', voice: '음성 협조', chat: '문자(서버 채팅)', 'voice-vtc': '음성/VTC', fanout: '병렬 통보' };
const KIND_KO = { report: '항적보고', coord: '협조', command: '명령', status: '교전현황' };
const inv = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
const MEDIA_FROM_KO = inv(MEDIA_KO), KIND_FROM_KO = inv(KIND_KO);

// ── 현행 카탈로그(두 모드 합집합 — 내보내기와 같은 features) ──
const F = { highResolutionDeployment: true, southernAxes: true, linkSemanticsV2: true, sensorReportParity: true, approvalChain: true,
  kvmfLateral: true, rokUsfkCoordination: { asis: 'voice', tobe: 'datalink' }, c2DecisionTimeParity: true };   // [지휘 흐름] 화면 기본(내보내기와 같은 조건)
const cats = {}; ['asis', 'tobe'].forEach((m) => { cats[m] = KJ.resolveModelCatalog({ deploymentId: depId, mode: m, modelFidelity: 'iads-c2', features: F }); });
const nodeById = new Map();
['asis', 'tobe'].forEach((m) => KJ.nodesInMode(m, cats[m]).forEach((n) => { if (!nodeById.has(n.id)) nodeById.set(n.id, n); }));
const linkByKey = new Map();
['asis', 'tobe'].forEach((m) => KJ.linksInMode(m, cats[m]).forEach((l) => {
  const k = l.from + '>' + l.to + '|' + l.kind; const e = linkByKey.get(k) || { l, asis: null, tobe: null }; e[m] = l.comm && l.comm[m]; linkByKey.set(k, e);
}));

// ── 도우미 ──
const warnings = [], notes = [];
const warn = (s) => warnings.push(s);
const num = (v) => (v === '' || v == null) ? null : (typeof v === 'number' ? v : (Number.isNaN(Number(v)) ? NaN : Number(v)));
const near = (a, b) => (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9) || a === b;
/** 「aircraft: 100; ballistic: 300」 또는 숫자 → 값 */
function parseMapped(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!Number.isNaN(Number(s))) return Number(s);
  if (s.indexOf(':') === -1) return NaN;
  const o = {}; s.split(';').forEach((part) => { const [k, val] = part.split(':').map((x) => x.trim()); if (k) o[k] = Number(val); });
  return o;
}
const mappedEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function headerIndex(rows, name) { const i = (rows[0] || []).indexOf(name); return i; }
function col(rows, name, required) {
  const i = headerIndex(rows, name);
  if (i < 0 && required) throw new Error(`시트에 「${name}」 열이 없습니다`);
  return i;
}
const overlay = { version: 1, deploymentId: depId, source: null, nodes: {}, links: [], removeNodes: [] };
const nodeOv = (id) => (overlay.nodes[id] = overlay.nodes[id] || {});

// ── 읽기 ──
const wb = readXlsx(xlsxPath);
const sheet = (name) => { const s = wb.sheets[name]; if (!s) throw new Error(`시트 「${name}」가 없습니다`); return s; };

// 1) 아군자산_<배치> — 노드별 위치·실효 제원
{
  const rows = sheet('아군자산_' + depSuffix);
  const cId = col(rows, 'id', true), cLat = col(rows, '위도', true), cLon = col(rows, '경도', true), cCat = col(rows, '구분');
  const cDet = col(rows, '탐지거리km'), cRng = col(rows, '사거리km'), cCh = col(rows, '동시교전채널'), cEt = col(rows, '교전시간s'), cMag = col(rows, '탄약');
  const cSrv = col(rows, '결심석'), cCap = col(rows, '대기실'), cSa = col(rows, '처리시간s(As-Is)'), cSt = col(rows, '처리시간s(To-Be)');
  const seen = new Set();
  rows.slice(1).forEach((r, i) => {
    const id = String(r[cId] || '').trim(); if (!id) return;
    const n = nodeById.get(id);
    if (!n) { warn(`아군자산 ${i + 2}행: 알 수 없는 id ${id} — 새 노드 추가는 지원하지 않습니다(건너뜀)`); return; }
    seen.add(id);
    const lat = num(r[cLat]), lon = num(r[cLon]);
    if (lat != null || lon != null) {
      if (Number.isNaN(lat) || Number.isNaN(lon) || lat == null || lon == null) warn(`${id}: 위도·경도가 숫자가 아닙니다(건너뜀)`);
      else if (lat < 33 || lat > 43 || lon < 124 || lon > 132) warn(`${id}: 좌표 (${lat}, ${lon})가 한반도 범위(위도 33~43, 경도 124~132) 밖입니다 — 위도·경도 순서를 확인하세요(건너뜀)`);
      else if (!near(lat, n.coord[0]) || !near(lon, n.coord[1])) { nodeOv(id).coord = [lat, lon]; notes.push(`${id}: 좌표 [${n.coord[0]}, ${n.coord[1]}] → [${lat}, ${lon}]`); }
    }
    if (n.category === 'sensor' && cDet >= 0) {
      const v = num(r[cDet]); if (v != null && !Number.isNaN(v) && !near(v, n.rangeKm)) {
        if (v <= 0) warn(`${id}: 탐지거리 ${v}km는 0 이하(건너뜀)`);
        else { nodeOv(id).sensor = Object.assign(nodeOv(id).sensor || {}, { ranges: { detect: v } }); notes.push(`${id}: 탐지거리 ${n.rangeKm} → ${v}km`); }
      }
    }
    if (n.category === 'shooter' && n.engage) {
      const e = {};
      [[cRng, 'rangeKm', '사거리'], [cCh, 'channels', '동시교전채널'], [cEt, 'engageTimeSec', '교전시간'], [cMag, 'magazine', '탄약']].forEach(([c, k, label]) => {
        if (c < 0) return; const v = num(r[c]); if (v == null || Number.isNaN(v)) return;
        if (!near(v, n.engage[k])) { if (v < 0) warn(`${id}: ${label} ${v}는 음수(건너뜀)`); else { e[k] = v; notes.push(`${id}: ${label} ${n.engage[k]} → ${v}`); } }
      });
      if (Object.keys(e).length) nodeOv(id).engage = Object.assign(nodeOv(id).engage || {}, e);
    }
    if (n.category === 'c2' && n.queue) {
      const q = {};
      [[cSrv, 'servers', '결심석'], [cCap, 'capacity', '대기실']].forEach(([c, k, label]) => {
        if (c < 0) return; const v = num(r[c]); if (v == null || Number.isNaN(v)) return;
        if (!near(v, n.queue[k])) { if (v < 1 || v !== Math.floor(v)) warn(`${id}: ${label} ${v}는 1 이상의 정수여야 합니다(건너뜀)`); else { q[k] = v; notes.push(`${id}: ${label} ${n.queue[k]} → ${v}`); } }
      });
      const st = {};
      [[cSa, 'asis'], [cSt, 'tobe']].forEach(([c, m]) => { if (c < 0) return; const v = num(r[c]); if (v == null || Number.isNaN(v)) return;
        const cur = n.queue.serviceTimeSec && n.queue.serviceTimeSec[m]; if (!near(v, cur)) { if (v < 0) warn(`${id}: 처리시간(${m}) ${v}는 음수(건너뜀)`); else { st[m] = v; notes.push(`${id}: 처리시간 ${m} ${cur} → ${v}s`); } } });
      if (Object.keys(st).length) q.serviceTimeSec = st;
      if (q.servers != null && q.capacity != null && q.capacity < q.servers) { warn(`${id}: 대기실(${q.capacity})이 결심석(${q.servers})보다 작습니다(둘 다 건너뜀)`); delete q.servers; delete q.capacity; }
      if (Object.keys(q).length) nodeOv(id).queue = Object.assign(nodeOv(id).queue || {}, q);
    }
  });
  nodeById.forEach((n, id) => { if (!seen.has(id)) { overlay.removeNodes.push(id); notes.push(`${id}: 시트에서 지워짐 → 노드 제거`); } });
}

// 2) 자산제원_센서 — 유형별 → 그 유형의 센서 노드 전부
{
  const rows = sheet('자산제원_센서');
  const cT = col(rows, 'typeId', true), cDet = col(rows, '탐지km'), cTrk = col(rows, '추적km'), cFc = col(rows, '사통km'),
    cD2T = col(rows, '탐지→추적s'), cT2F = col(rows, '추적→사통s'), cPd = col(rows, '탐지확률'), cRp = col(rows, '보고주기s');
  rows.slice(1).forEach((r, i) => {
    const typeId = String(r[cT] || '').trim(); if (!typeId) return;
    const t = KJ.SENSOR_TYPES[typeId]; if (!t) { warn(`자산제원_센서 ${i + 2}행: 알 수 없는 typeId ${typeId}(건너뜀)`); return; }
    const ranges = {}, trans = {}; let pd = null, rp = null;
    [[cDet, 'detect'], [cTrk, 'track'], [cFc, 'fireControl']].forEach(([c, k]) => { if (c < 0) return; const v = parseMapped(r[c]); if (v == null) return;
      if (typeof v === 'number' && Number.isNaN(v)) { warn(`${typeId}: ${k} 값 「${r[c]}」을 읽을 수 없습니다(건너뜀)`); return; }
      if (!mappedEq(v, t.ranges[k] ?? null)) ranges[k] = v; });
    [[cD2T, 'detectToTrack'], [cT2F, 'trackToFireControl']].forEach(([c, k]) => { if (c < 0) return; const v = num(r[c]); if (v == null || Number.isNaN(v)) return;
      if (!near(v, t.transitionTime[k])) trans[k] = v; });
    if (cPd >= 0) { const v = num(r[cPd]); if (v != null && !Number.isNaN(v) && !near(v, t.detectionProbability)) { if (v < 0 || v > 1) warn(`${typeId}: 탐지확률 ${v}는 0~1 범위 밖(건너뜀)`); else pd = v; } }
    if (cRp >= 0) { const v = num(r[cRp]); if (v != null && !Number.isNaN(v) && !near(v, t.reportingPeriod)) { if (v <= 0) warn(`${typeId}: 보고주기 ${v}s는 0 이하(건너뜀)`); else rp = v; } }
    if (!Object.keys(ranges).length && !Object.keys(trans).length && pd == null && rp == null) return;
    const ids = [...nodeById.values()].filter((n) => n.category === 'sensor' && n.typeId === typeId).map((n) => n.id);
    if (!ids.length) { warn(`${typeId}: 이 배치에 해당 센서 노드가 없어 제원 변경이 적용될 곳이 없습니다`); return; }
    ids.forEach((id) => { const s = nodeOv(id).sensor = nodeOv(id).sensor || {};
      if (Object.keys(ranges).length) s.ranges = Object.assign(s.ranges || {}, ranges);
      if (Object.keys(trans).length) s.transitionTime = Object.assign(s.transitionTime || {}, trans);
      if (pd != null) s.detectionProbability = pd; if (rp != null) s.reportingPeriod = rp; });
    notes.push(`${typeId}(센서 ${ids.length}개): ${[Object.keys(ranges).length ? '탐지범위 ' + JSON.stringify(ranges) : '', Object.keys(trans).length ? '전이 ' + JSON.stringify(trans) : '', pd != null ? '탐지확률 ' + pd : '', rp != null ? '보고주기 ' + rp : ''].filter(Boolean).join(' · ')}`);
  });
}

// 3) 자산제원_포대 — 유형×요격탄 → 그 유형의 포대 노드 전부
{
  const rows = sheet('자산제원_포대');
  const cT = col(rows, 'typeId', true), cM = col(rows, '요격탄', true), cEng = col(rows, '교전가능위협(IADS)'),
    cRmin = col(rows, '최소사거리km'), cRmax = col(rows, '최대사거리km'), cHmin = col(rows, '최소고도km'), cHmax = col(rows, '최대고도km'), cSpd = col(rows, '요격탄속도m/s');
  const seenEng = new Set();
  rows.slice(1).forEach((r, i) => {
    const typeId = String(r[cT] || '').trim(), mk = String(r[cM] || '').trim(); if (!typeId) return;
    const t = KJ.SHOOTER_TYPES[typeId]; if (!t) { warn(`자산제원_포대 ${i + 2}행: 알 수 없는 typeId ${typeId}(건너뜀)`); return; }
    const ids = [...nodeById.values()].filter((n) => n.category === 'shooter' && n.typeId === typeId).map((n) => n.id);
    // 교전가능위협
    if (cEng >= 0 && !seenEng.has(typeId)) {
      seenEng.add(typeId);
      const raw = String(r[cEng] || '').trim();
      if (raw) {
        const list = raw.split(',').map((x) => x.trim()).filter(Boolean);
        const known = Object.keys(KJ.THREAT_TYPES || {});
        const bad = list.filter((x) => known.indexOf(x) === -1);
        const cur = (t.iadsEngageableThreats || t.engageableThreats || []).slice();
        if (bad.length) warn(`${typeId}: 교전가능위협에 알 수 없는 위협 ${bad.join(', ')}(이 셀 건너뜀)`);
        else if (JSON.stringify(list.slice().sort()) !== JSON.stringify(cur.slice().sort())) {
          if (!ids.length) warn(`${typeId}: 이 배치에 해당 포대가 없어 교전가능위협 변경이 적용될 곳이 없습니다`);
          ids.forEach((id) => { nodeOv(id).iadsEngageableThreats = list; });
          notes.push(`${typeId}(포대 ${ids.length}개): 교전가능위협 [${cur.join(', ')}] → [${list.join(', ')}]`);
        }
      }
    }
    const m = t.missiles && t.missiles[mk]; if (!m) return;
    const env = m.engagementEnvelope || {}; const e2 = {};
    [[cRmin, 'Rmin'], [cRmax, 'Rmax'], [cHmin, 'Hmin'], [cHmax, 'Hmax']].forEach(([c, k]) => { if (c < 0) return; const v = num(r[c]); if (v == null || Number.isNaN(v)) return; if (!near(v, env[k])) e2[k] = v; });
    const merged = Object.assign({}, env, e2);
    if (Object.keys(e2).length && (merged.Rmin >= merged.Rmax || merged.Hmin >= merged.Hmax || merged.Rmin < 0 || merged.Hmin < 0)) { warn(`${typeId}/${mk}: 요격 구간이 뒤집혔습니다(최소 ≥ 최대 또는 음수) — 건너뜀 ${JSON.stringify(merged)}`); return; }
    let spd = null; if (cSpd >= 0) { const v = num(r[cSpd]); if (v != null && !Number.isNaN(v) && !near(v, m.missileSpeed)) { if (v <= 0) warn(`${typeId}/${mk}: 요격탄속도 ${v}는 0 이하(건너뜀)`); else spd = v; } }
    if (!Object.keys(e2).length && spd == null) return;
    if (!ids.length) { warn(`${typeId}: 이 배치에 해당 포대가 없어 요격탄 제원 변경이 적용될 곳이 없습니다`); return; }
    ids.forEach((id) => { const eo = nodeOv(id).engage = nodeOv(id).engage || {}; eo.missiles = eo.missiles || {}; const mo = eo.missiles[mk] = eo.missiles[mk] || {};
      if (Object.keys(e2).length) mo.engagementEnvelope = Object.assign(mo.engagementEnvelope || {}, e2); if (spd != null) mo.missileSpeed = spd; });
    notes.push(`${typeId}/${mk}(포대 ${ids.length}개): ${Object.keys(e2).length ? '요격구간 ' + JSON.stringify(e2) : ''}${spd != null ? ' 속도 ' + spd : ''}`);
  });
}

// 4) 통신계선_<배치> — 매체·지연
{
  const rows = sheet('통신계선_' + depSuffix);
  const cF = col(rows, 'from(id)', true), cTo = col(rows, 'to(id)', true), cK = col(rows, '종류', true),
    cMa = col(rows, 'As-Is 매체'), cDa = col(rows, 'As-Is 지연s'), cMt = col(rows, 'To-Be 매체'), cDt = col(rows, 'To-Be 지연s');
  rows.slice(1).forEach((r, i) => {
    const from = String(r[cF] || '').trim(), to = String(r[cTo] || '').trim(); if (!from || !to) return;
    const kind = KIND_FROM_KO[String(r[cK] || '').trim()] || String(r[cK] || '').trim();
    const e = linkByKey.get(from + '>' + to + '|' + kind);
    if (!e) { warn(`통신계선 ${i + 2}행: ${from} → ${to} (${kind}) 계선이 카탈로그에 없습니다(건너뜀)`); return; }
    const ov = { from, to, kind };
    let changed = false;
    [['asis', cMa, cDa], ['tobe', cMt, cDt]].forEach(([mode, cM, cD]) => {
      const cur = e[mode]; if (!cur) return;   // 그 모드에 없는 계선은 손대지 않는다
      const o = {};
      if (cM >= 0) { const raw = String(r[cM] || '').trim(); if (raw && raw !== '—') { const type = MEDIA_FROM_KO[raw] || (MEDIA_KO[raw] ? raw : null);
        if (!type) warn(`${from} → ${to} (${mode}): 알 수 없는 매체 「${raw}」(건너뜀)`); else if (type !== cur.type) o.type = type; } }
      if (cD >= 0) { const v = num(r[cD]); if (v != null && !Number.isNaN(v) && !near(v, cur.delaySec)) { if (v < 0) warn(`${from} → ${to} (${mode}): 지연 ${v}는 음수(건너뜀)`); else o.delaySec = v; } }
      if (Object.keys(o).length) { ov[mode] = o; changed = true; }
    });
    if (changed) { overlay.links.push(ov); notes.push(`${from} → ${to} (${kind}): ${['asis', 'tobe'].filter((m) => ov[m]).map((m) => m + ' ' + JSON.stringify(ov[m])).join(' · ')}`); }
  });
}

// ── 출처·요약 ──
overlay.source = { file: path.basename(xlsxPath), sha256: createHash('sha256').update(fs.readFileSync(xlsxPath)).digest('hex').slice(0, 16), importedAt: new Date().toISOString() };
const nNodes = Object.keys(overlay.nodes).length;
console.log(`가져오기: ${xlsxPath}\n  배치 ${depId} · 바뀐 노드 ${nNodes} · 바뀐 계선 ${overlay.links.length} · 제거 노드 ${overlay.removeNodes.length} · 경고 ${warnings.length}`);
notes.forEach((n) => console.log('  · ' + n));
warnings.forEach((w) => console.log('  ⚠ ' + w));
if (strict && warnings.length) { console.error('--strict: 경고가 있어 파일을 쓰지 않습니다'); process.exit(1); }
if (!nNodes && !overlay.links.length && !overlay.removeNodes.length) console.log('  현행 카탈로그와 다른 값이 없습니다(빈 overlay를 씁니다).');
fs.writeFileSync(outPath, JSON.stringify(overlay, null, 1));
console.log(`  → ${outPath}`);
