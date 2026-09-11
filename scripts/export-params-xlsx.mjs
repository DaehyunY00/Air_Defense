#!/usr/bin/env node
/**
 * 파라미터 내보내기 — 현재 카탈로그(배치·제원·위협·공격 경로·조준점·시나리오·통신 계선)를
 * 한 권의 .xlsx로 뽑는다. 사용자가 위치·수량·유형을 고쳐 다시 넣기 위한 **템플릿**이다.
 *
 * 실행:  node scripts/export-params-xlsx.mjs            (→ K-JAMDS_파라미터.xlsx)
 *
 * 규율:
 *  · 값은 전부 **카탈로그에서 읽는다** — 여기서 숫자를 지어내지 않는다. 카탈로그가 바뀌면
 *    다시 뽑으면 그만이다(단일본 빌더와 같은 생성물 규칙).
 *  · 모든 수치 행에 **출처·등급** 열을 함께 적는다. 이 저장소가 지키는 「모르는 것은 모른다고
 *    적는다」를 시트에 그대로 옮긴 것이다. 사용자가 고친 값에는 등급이 없다 — 불러올 때
 *    그것을 표기하는 것이 다음 단계(import)의 일이다.
 *  · 좌표는 **[위도, 경도] 순서·십진도**다. codex 표는 [경도, 위도]라 복사하면 뒤바뀐다 —
 *    「안내」 시트 첫 줄에 적는다.
 *  · 용어: 코드의 `axis`는 시트에서 **공격 경로**로 적는다(사용자 결정 2026-09-10).
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installIadsKernel } from '../js/model/iads/index.js';
import { writeXlsx } from './xlsx-lite.mjs';

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js', 'data/links.js',
  'data/threats.js', 'data/scenarios.js', 'data/axes.js', 'config/deployment-adapter.js',
  'core/rng.js', 'core/heap.js', 'engine/sim-engine.js'].forEach((f) => require(path.join(root, 'js', f)));
const KJ = globalThis.KJ; installIadsKernel(KJ);

const OUT = path.join(root, 'K-JAMDS_파라미터.xlsx');
const F = { highResolutionDeployment: true };
const j = (v) => Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v));
const hav = (a, b) => { const R = 6371, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const CAT_KO = { sensor: '센서', c2: 'C2', shooter: '포대' };
const MEDIA_KO = { datalink: '데이터링크', ifcn: 'IFCN 킬웹', internal: '체계 내부', 'report-cycle': '센서 보고주기',
  'kvmf-relay': 'KVMF 상급경유', voice: '음성 협조', chat: '문자(서버 채팅)', 'voice-vtc': '음성/VTC', fanout: '병렬 통보' };
const KIND_KO = { report: '항적보고', coord: '협조', command: '명령', status: '교전현황' };

/** 자산 행의 등급 — 유형 제원(system-types)의 confidence. node.confidence는 출처 태그('scenario')라 등급이 아니다. */
function typeGrade(n) {
  const t = (KJ.SYSTEM_TYPES && KJ.SYSTEM_TYPES[n.category] && KJ.SYSTEM_TYPES[n.category][n.typeId]) || null;
  return (t && t.confidence) || (n.queue && n.queue.confidence) || '';
}

// ── 아군 자산 (배치별) ──
function assetSheet(depId) {
  const cats = {};
  ['asis', 'tobe'].forEach((m) => { cats[m] = KJ.resolveModelCatalog({ deploymentId: depId, mode: m, modelFidelity: 'iads-c2', features: F }); });
  const nodes = new Map();
  ['asis', 'tobe'].forEach((m) => KJ.nodesInMode(m, cats[m]).forEach((n) => {
    const e = nodes.get(n.id) || { n, modes: [] }; e.modes.push(m); nodes.set(n.id, e);
  }));
  // 보고 대상(상위) — 이 노드에서 나가는 항적보고 계선의 도착지(모드별 합집합)
  const parent = {};
  ['asis', 'tobe'].forEach((m) => KJ.linksInMode(m, cats[m]).forEach((l) => {
    if (l.kind !== 'report') return;
    (parent[l.from] = parent[l.from] || new Set()).add(l.to);
  }));
  const rows = [['id', '구분', '유형(typeId)', '이름', '소속', '제대', '모드', '위도', '경도', '좌표메모',
    '보고대상(상위, id)', '탐지거리km', '사거리km', '동시교전채널', '교전시간s', 'Pk(기본)', '단가M$', '탄약',
    '결심석', '대기실', '처리시간s(As-Is)', '처리시간s(To-Be)', '체계처리s(min~max)', '운용자처리s', '등급', '출처']];
  [...nodes.values()].sort((a, b) => (a.n.category + a.n.typeId + a.n.name).localeCompare(b.n.category + b.n.typeId + b.n.name, 'ko'))
    .forEach(({ n, modes }) => {
      const q = n.queue || null, e = n.engage || null;
      const pk = e && e.pk && e.pk.default ? (e.pk.default.mode ?? e.pk.default.max ?? '') : '';
      rows.push([n.id, CAT_KO[n.category] || n.category, n.typeId, n.name || '', n.forceOwner || n.service || '', n.echelon || '',
        modes.length === 2 ? 'both' : modes[0], n.coord ? n.coord[0] : '', n.coord ? n.coord[1] : '', n.coordNote || '',
        parent[n.id] ? [...parent[n.id]].join(', ') : '',
        n.rangeKm ?? '', e ? e.rangeKm ?? '' : '', e ? e.channels ?? '' : '', e ? e.engageTimeSec ?? '' : '', pk,
        e ? e.costPerShotM ?? '' : '', e ? e.magazine ?? '' : '',
        q ? q.servers : '', q ? q.capacity : '', q && q.serviceTimeSec ? q.serviceTimeSec.asis : '', q && q.serviceTimeSec ? q.serviceTimeSec.tobe : '',
        q && q.serviceParts ? j(q.serviceParts.systemSec) : '', q && q.serviceParts ? q.serviceParts.operatorSec : '',
        typeGrade(n), n.sourceNote || (q && q.paramRef) || (e && e.pk && e.pk.paramRef) || '']);
    });
  return rows;
}

// ── 통신 계선 (배치별, 모드 합집합) ──
function linkSheet(depId) {
  const rows = [['from(id)', 'to(id)', '종류', 'As-Is 매체', 'As-Is 지연s', 'As-Is 분포', 'To-Be 매체', 'To-Be 지연s', 'To-Be 분포',
    '채널수', '채널대기실', '등급', '출처(paramRef)']];
  const seen = new Map();
  ['asis', 'tobe'].forEach((m) => {
    const cat = KJ.resolveModelCatalog({ deploymentId: depId, mode: m, modelFidelity: 'iads-c2', features: F });
    KJ.linksInMode(m, cat).forEach((l) => {
      const k = l.from + '>' + l.to + '|' + l.kind;
      const e = seen.get(k) || { l, asis: null, tobe: null }; e[m] = l.comm && l.comm[m]; seen.set(k, e);
    });
  });
  const dist = (c) => c && c.dist ? `${c.dist.kind}(${c.dist.mean ?? ''}${c.dist.stddev != null ? ',σ' + c.dist.stddev : ''})` : '';
  [...seen.values()].sort((a, b) => (a.l.from + a.l.to).localeCompare(b.l.from + b.l.to)).forEach(({ l, asis, tobe }) => {
    const c = asis || tobe;
    rows.push([l.from, l.to, KIND_KO[l.kind] || l.kind,
      asis ? (MEDIA_KO[asis.type] || asis.type) : '—', asis ? asis.delaySec ?? '' : '', dist(asis),
      tobe ? (MEDIA_KO[tobe.type] || tobe.type) : '—', tobe ? tobe.delaySec ?? '' : '', dist(tobe),
      c && c.messageServers != null ? c.messageServers : '', c && c.messageCapacity != null ? c.messageCapacity : '',
      c && c.confidence || '', c && c.paramRef || '']);
  });
  return rows;
}

// ── 제원 ──
function sensorTypes() {
  const rows = [['typeId', '이름', '대역', '역할', '보고주기s', '보고대상C2', '탐지km', '추적km', '사통km', '탐지→추적s', '추적→사통s',
    '추적용량', '최소고도m', '탐지확률', '탐지가능위협', '등급', '출처(paramRef)', '비고']];
  Object.entries(KJ.SENSOR_TYPES).forEach(([id, t]) => rows.push([id, t.name, t.band, t.role, t.reportingPeriod, t.c2Report || '',
    t.ranges.detect ?? '', t.ranges.track ?? '', t.ranges.fireControl ?? '', t.transitionTime.detectToTrack ?? '', t.transitionTime.trackToFireControl ?? '',
    t.trackCapacity, t.minAltitude, t.detectionProbability ?? '', j(t.detectableThreats), t.confidence, t.paramRef, t.sourceNote || '']));
  return rows;
}
function shooterTypes() {
  // 한 행 = 포대 유형 × 요격탄(ABM/AAM). 사거리·단가·교리는 요격탄 몫이고 발사대·동시교전·재장전은 포대 몫이다.
  const rows = [['typeId', '이름', '요격탄', '요격탄 이름', '우선순위', '교전가능위협(IADS)', '최소사거리km', '최대사거리km', '최소고도km', '최대고도km',
    '요격탄속도m/s', '발사간격s', '교리', '요격방식', '기본Pk(pssek default)', 'BDA지연s', '단가M$', '발사대당 탄수', '발사대 수', '동시교전', '재장전s', '등급', '출처(paramRef)', '비고']];
  Object.entries(KJ.SHOOTER_TYPES).forEach(([id, t]) => {
    const b = t.battery || {};
    Object.entries(t.missiles || { '—': null }).forEach(([mk, m]) => {
      const env = (m && m.engagementEnvelope) || {};
      rows.push([id, t.name, mk, m ? m.name : '', t.priority ?? '', j(t.iadsEngageableThreats || t.engageableThreats),
        env.Rmin ?? '', env.Rmax ?? '', env.Hmin ?? '', env.Hmax ?? '', m ? m.missileSpeed ?? '' : '', m ? m.launchInterval ?? '' : '',
        m ? m.doctrine ?? '' : '', m ? m.interceptMethod ?? '' : '', m && m.pssekTable ? m.pssekTable.default ?? '' : '', m ? m.bdaDelay ?? '' : '',
        m ? m.costPerShot ?? '' : '', m ? m.roundsPerLauncher ?? '' : '', b.launcherCount ?? '', b.simultaneousEngagement ?? '', b.reloadTime ?? '',
        (m && m.confidence) || t.confidence || '', (m && m.paramRef) || t.paramRef || '', t.sourceNote || '']);
    });
  });
  return rows;
}
function c2Types() {
  const rows = [['typeId', '이름', '계층', '결심석(동시)', '체계처리s(min)', '체계처리s(max)', '운용자 고숙련s', '운용자 중간s', '운용자 저숙련s', '지휘범위', '보고주기s', '통합여부', '등급', '출처(paramRef)', '비고']];
  Object.entries(KJ.C2_TYPES).forEach(([id, t]) => rows.push([id, t.name, t.tier, t.simultaneousCapacity, t.processing.system[0], t.processing.system[1],
    t.processing.operator.high, t.processing.operator.mid, t.processing.operator.low, t.commandScope, t.reportingPeriod, t.integrated ? 'Y' : 'N',
    t.confidence, t.paramRef, t.sourceNote || '']));
  return rows;
}
function threatTypes() {
  const rows = [['type', '이름', '속도km/h', '고도대', '체공창s', '탐지계수', '사거리min km', '사거리max km', '발사권역', '단가M$', '교전권 보유 C2 As-Is', '교전권 보유 C2 To-Be', '자동화 As-Is', '자동화 To-Be', '조준점 대상', '출처(paramRef)', '사거리출처', '단가출처', '비고']];
  const aimTypes = new Set(KJ.AIMPOINT_TYPES || []);
  Object.keys(KJ.THREAT_TYPES || {}).forEach((k) => {
    const t = KJ.threatType(k); if (!t) return;
    rows.push([k, t.name, t.speedKmh, t.altBand, t.dwellSec, t.detectFactor ?? '', t.rangeBandKm ? t.rangeBandKm.min : '', t.rangeBandKm ? t.rangeBandKm.max : '',
      j(t.originZones), t.unitCostM ?? '', t.approvalLevel ? t.approvalLevel.asis ?? '' : '', t.approvalLevel ? t.approvalLevel.tobe ?? '' : '',
      t.automation ? t.automation.asis : '', t.automation ? t.automation.tobe : '', aimTypes.has(k) ? 'Y' : 'N', t.paramRef || '', t.rangeRef || '', t.costRef || '', t.note || '']);
  });
  return rows;
}

// ── 공격 경로 · 조준점 · 시나리오 ──
function routeSheet() {
  const rows = [['key', '이름', '발사점 위도', '발사점 경도', '발사점 메모', '표적 위도', '표적 경도', '표적 메모', '발사권역', '개념거리km(선언)', '실측거리km(계산)',
    '탄도탄 연장km(srbm)', '탄도탄 연장km(mrl_large)', '비고']];
  Object.entries(KJ.AXES).forEach(([k, a]) => {
    const ex = (t) => { const e = KJ.ballisticLaunchExtension && KJ.ballisticLaunchExtension(t, k); return e ? Math.round(e.extKm) : 0; };
    rows.push([k, a.label, a.entry[0], a.entry[1], a.entryNote || '', a.target[0], a.target[1], a.targetNote || '', j(a.launchZones),
      a.conceptReachKm ?? '', Math.round(hav(a.entry, a.target)), ex('srbm'), ex('mrl_large'), a.reachNote || '']);
  });
  return rows;
}
function aimSheet() {
  const rows = [['id', '이름', '계열', '위도', '경도', '비고']];
  (KJ.TARGET_AIMPOINTS || []).forEach((p) => rows.push([p.id, p.label, p.family, p.pos[0], p.pos[1], 'IADS_codex HANBANDO_FULL_16T 조준점 세트 — 도시 수준 개념좌표']));
  return rows;
}
function scenarioSheet() {
  const rows = [['시나리오 id', '시나리오 이름', '기본 모드', '위협 유형', '공격 경로(key)', '분당 도착률(λ)', '동시 다발 수(burst)', '발생 시각s(atSec)', '등가 도착률', '문제 설명']];
  KJ.SCENARIOS.forEach((s) => (s.mix || []).forEach((e) =>
    rows.push([s.id, s.name, s.defaultMode || '', e.type, e.axis, e.ratePerMin ?? '', e.burst ?? '', e.atSec ?? '', e.equivRatePerMin ?? '', s.problem || ''])));
  return rows;
}

// ── 기본 설정 · 안내 ──
function metaSheet() {
  const nodeCount = (d, m) => KJ.nodesInMode(m, KJ.resolveModelCatalog({ deploymentId: d, mode: m, modelFidelity: 'iads-c2', features: F })).length;
  return [['항목', '값', '설명'],
    ['배치 목록', KJ.DEPLOYMENT_IDS.join(', '), '「아군자산_…」 시트는 LEGACY·FULL 두 배치'],
    ['LEGACY 노드 수', nodeCount('HANBANDO_LEGACY_NORMAL', 'asis') + ' / ' + nodeCount('HANBANDO_LEGACY_NORMAL', 'tobe'), 'As-Is / To-Be'],
    ['FULL 노드 수', nodeCount('HANBANDO_FULL_NORMAL', 'asis') + ' / ' + nodeCount('HANBANDO_FULL_NORMAL', 'tobe'), 'As-Is / To-Be'],
    ['좌표 순서', '위도, 경도 (십진도)', '⚠️ codex 표는 경도,위도 — 복사 시 열이 뒤바뀐다'],
    ['좌표 성격', '개념', '개념 = 도시 수준 개념좌표(실제 배치·표적 아님) / 실제 = 사용자가 실좌표를 넣음'],
    ['기본 seed', 29, '[지휘 흐름] 대표 표본 (ADR-084 추기)'],
    ['기본 관측시간 s', 600, ''],
    ['표적 산포 반경 km', KJ.THREAT_TARGET_SPREAD_KM, 'ADR-063 · 조준점 중심으로 흩어지는 반경'],
    ['자위권 반경 km', KJ.SELF_DEFENSE_RADIUS_KM, 'ADR-071'],
    ['남부 공격 경로 키', j(KJ.SOUTHERN_AXIS_KEYS), 'southernAxes 플래그가 켤 때만 사용'],
    ['조준점 대상 위협', j(KJ.AIMPOINT_TYPES), 'ADR-097 · 탄도탄만'],
    ['내보낸 날짜', new Date().toISOString().slice(0, 10), 'node scripts/export-params-xlsx.mjs'],
    ['작성자', '', '사용자가 고친 뒤 적는다'],
    ['수정 메모', '', '무엇을 왜 고쳤는지 — 등급 없는 값은 결과 인용 시 「사용자 가정」으로 표기해야 한다']];
}
function guideSheet() {
  return [['안내'],
    ['이 파일은 K-JAMDS 시뮬레이터의 현재 파라미터를 그대로 뽑은 것입니다. 값을 고쳐 다시 넣기 위한 템플릿입니다.'],
    [''],
    ['1. 좌표는 위도, 경도 순서·십진도입니다. codex 자료는 경도, 위도 순서라 그대로 복사하면 열이 뒤바뀝니다. 위도 33~43 · 경도 124~132 밖이면 불러올 때 거부됩니다.'],
    ['2. 「아군자산_LEGACY / _FULL」 — 한 행이 자산 하나입니다. 위도·경도를 고치면 그 자리로 옮겨집니다. 행을 복사해 자산을 늘릴 때는 id를 새로 주고 「보고대상」에 상위 C2 id를 적어야 계선이 이어집니다.'],
    ['3. 「공격경로」 — 적이 어디서 어디로 오는가. 한 행이 경로 하나(발사점 → 표적)입니다. 행을 추가하면 새 경로가 생기고 「시나리오」 시트에서 key로 가리킵니다. 탄도탄은 사거리에 맞춰 발사점이 자동으로 더 뒤로 물러납니다(연장km 열).'],
    ['4. 「조준점」 — 탄도탄이 나눠 노리는 표적 후보 10점(ADR-097). 추가·삭제·이동할 수 있습니다. 실제 착탄은 여기서 산포 반경만큼 흩어집니다.'],
    ['5. 「시나리오」 — 한 행이 위협 흐름 하나. 유형 × 공격 경로 × 도착률(또는 동시 다발 수·시각).'],
    ['6. 「자산제원_…」「위협제원」 — 유형별 성능. 빈 칸은 카탈로그 기본값 그대로라는 뜻입니다.'],
    ['7. 「통신계선_…」 — 누가 누구에게 어떤 매체로 얼마나 걸려 보내는가. 모드(As-Is/To-Be)별로 매체가 다를 수 있습니다.'],
    [''],
    ['등급: A 실측·공개근거 / B 2차 자료 / C 추정(근거 문헌 없음). 이 파일의 지연·처리시간은 거의 전부 C입니다. 사용자가 고친 값에는 등급이 없으므로, 그 결과를 인용할 때는 「사용자 가정 기반」을 반드시 함께 적어야 합니다.'],
    ['불러오기(import)는 다음 단계입니다. 지금 이 파일은 내보내기 전용이며, 고친 값을 아직 시뮬레이터가 읽지 않습니다.']];
}

writeXlsx(OUT, [
  { name: '안내', rows: guideSheet(), widths: [140] },
  { name: '기본설정', rows: metaSheet() },
  { name: '아군자산_LEGACY', rows: assetSheet('HANBANDO_LEGACY_NORMAL') },
  { name: '아군자산_FULL', rows: assetSheet('HANBANDO_FULL_NORMAL') },
  { name: '자산제원_센서', rows: sensorTypes() },
  { name: '자산제원_포대', rows: shooterTypes() },
  { name: '자산제원_C2', rows: c2Types() },
  { name: '위협제원', rows: threatTypes() },
  { name: '공격경로', rows: routeSheet() },
  { name: '조준점', rows: aimSheet() },
  { name: '시나리오', rows: scenarioSheet() },
  { name: '통신계선_LEGACY', rows: linkSheet('HANBANDO_LEGACY_NORMAL') },
  { name: '통신계선_FULL', rows: linkSheet('HANBANDO_FULL_NORMAL') }
]);
console.log('내보내기 완료:', OUT);
