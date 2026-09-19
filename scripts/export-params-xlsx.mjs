#!/usr/bin/env node
/**
 * 파라미터 내보내기 — 현재 카탈로그(배치·제원·위협·공격 경로·조준점·시나리오·통신 계선)를
 * 기존 13장 .xlsx의 구조·서식을 보존하며 갱신한다. 참조·내보내기용이며 import 기능은 없다.
 *
 * 실행:  node scripts/export-params-xlsx.mjs            (→ K-JAMDS_파라미터.xlsx)
 *
 * 규율:
 *  · 값은 전부 **카탈로그에서 읽는다** — 여기서 숫자를 지어내지 않는다. 카탈로그가 바뀌면
 *    다시 뽑으면 그만이다(단일본 빌더와 같은 생성물 규칙).
 *  · 모든 수치 행에 **출처·등급** 열을 함께 적는다. 이 저장소가 지키는 「모르는 것은 모른다고
 *    적는다」를 시트에 그대로 옮긴 것이다. 기존 작성자·수정 메모는 보존한다.
 *  · 좌표는 **[위도, 경도] 순서·십진도**다. codex 표는 [경도, 위도]라 복사하면 뒤바뀐다 —
 *    「안내」 시트 첫 줄에 적는다.
 *  · 용어: 코드의 `axis`는 시트에서 **공격 경로**로 적는다(사용자 결정 2026-09-10).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const uiSource = readFileSync(path.join(root, 'prototype/command-flow.html'), 'utf8');
function section(start, end) {
  const from = uiSource.indexOf(start), to = uiSource.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error(`화면 설정 소스 범위 없음: ${start}`);
  return uiSource.slice(from, to);
}
const ctx = vm.createContext({ URLSearchParams, location: { search: '' } });
vm.runInContext(section('const PARAMS = [', 'const INTENSITY = ') +
  section('function features() {', '/* ═') +
  '\nglobalThis.ui = { params: PARAMS, values: P, features: features() };', ctx);
const UI = JSON.parse(JSON.stringify(ctx.ui));
const F = UI.features; // 숫자 선언 기본값이 아닌 실제 URL 파서가 만든 typed defaults.
const BASE_ENGINE = new KJ.Simulation({ scenario: KJ.scenarioById(UI.values.sc), mode: UI.values.mode,
  intensity: 1, seed: UI.values.seed, endTimeSec: UI.values.dur, deploymentId: UI.values.dep,
  modelFidelity: 'iads-c2', features: { highResolutionDeployment: true } });
const VERSION = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
const AS_OF = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const SOURCE_FILES = ['js/config/system-types.js', 'js/config/deployments.js', 'js/config/deployment-adapter.js',
  'js/data/threats.js', 'js/data/axes.js', 'js/data/scenarios.js', 'js/engine/sim-engine.js',
  'js/model/iads/c2-agent.js', 'prototype/command-flow.html', 'scripts/export-params-xlsx.mjs'];
const SOURCE_DIRTY = execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', ...SOURCE_FILES],
  { cwd: root, encoding: 'utf8', timeout: 5000 }).trim().length > 0;
const SOURCE_HASHES = SOURCE_FILES.map((file) => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]);
const j = (v) => Array.isArray(v) ? v.join(', ') : (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const mapped = (v) => v != null && typeof v === 'object'
  ? Object.entries(v).map(([key, value]) => `${key}: ${value}`).join('; ') : (v ?? '');
const hav = (a, b) => { const R = 6371, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const CAT_KO = { sensor: '센서', c2: 'C2', shooter: '포대' };
const MEDIA_KO = { datalink: '데이터링크', ifcn: 'IFCN 킬웹', internal: '체계 내부', 'report-cycle': '센서 보고주기',
  'kvmf-relay': 'KVMF 상급경유', voice: '음성 협조', chat: '문자(서버 채팅)', 'voice-vtc': '음성/VTC', fanout: '병렬 통보' };
const KIND_KO = { report: '항적보고', coord: '협조', command: '명령', status: '교전현황' };
const LINK_MODE_DIFFERENCES = [];

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
  const statusChannels = Object.fromEntries(['asis', 'tobe'].map((mode) => [mode,
    new KJ.Simulation({ scenario: KJ.scenarioById(UI.values.sc), mode, intensity: 1,
      seed: UI.values.seed, endTimeSec: UI.values.dur, deploymentId: depId,
      modelFidelity: 'iads-c2', features: F }).iadsStatusChannels]));
  const rows = [['from(id)', 'to(id)', '종류', 'As-Is 매체', 'As-Is 지연s', 'As-Is 분포', 'To-Be 매체', 'To-Be 지연s', 'To-Be 분포',
    '채널수', '채널대기실', '등급', '출처(paramRef)', 'As-Is 현황 유효기간s', 'To-Be 현황 유효기간s', '현황 채택 규칙']];
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
    const channelKey = l.from + '>' + l.to;
    const statusA = asis && l.kind === 'status' ? statusChannels.asis[channelKey] : null;
    const statusT = tobe && l.kind === 'status' ? statusChannels.tobe[channelKey] : null;
    const status = statusA || statusT;
    if (statusA && statusT && (statusA.servers !== statusT.servers || statusA.capacity !== statusT.capacity)) {
      LINK_MODE_DIFFERENCES.push({ deploymentId: depId, channelKey,
        asis: { servers: statusA.servers, capacity: statusA.capacity },
        tobe: { servers: statusT.servers, capacity: statusT.capacity } });
    }
    const byMode = (key) => {
      const a = asis?.[key] ?? '', b = tobe?.[key] ?? '';
      return asis && tobe && a !== b ? `As-Is: ${a || '미지정'}; To-Be: ${b || '미지정'}` : (a || b);
    };
    rows.push([l.from, l.to, KIND_KO[l.kind] || l.kind,
      asis ? (MEDIA_KO[asis.type] || asis.type) : '—', asis ? asis.delaySec ?? '' : '', dist(asis),
      tobe ? (MEDIA_KO[tobe.type] || tobe.type) : '—', tobe ? tobe.delaySec ?? '' : '', dist(tobe),
      statusA && statusT && statusA.servers !== statusT.servers
        ? `As-Is: ${statusA.servers}; To-Be: ${statusT.servers}`
        : status ? status.servers : c && c.messageServers != null ? c.messageServers : '',
      statusA && statusT && statusA.capacity !== statusT.capacity
        ? `As-Is: ${statusA.capacity}; To-Be: ${statusT.capacity}`
        : status ? status.capacity : c && c.messageCapacity != null ? c.messageCapacity : '',
      byMode('confidence'), byMode('paramRef'),
      statusA ? statusA.freshnessSec : '', statusT ? statusT.freshnessSec : '',
      l.kind === 'status' ? '엔진 실효값(미지정: 1서버·용량4·300초). 생성 기준 TTL, 과거·중복·만료 미채택 (ADR-100)' : '']);
  });
  return rows;
}

// ── 제원 ──
function sensorTypes() {
  const rows = [['typeId', '이름', '대역', '역할', '보고주기s', '보고대상C2', '탐지km', '추적km', '사통km', '탐지→추적s', '추적→사통s',
    '추적용량', '최소고도m', '탐지확률', '탐지가능위협', '등급', '출처(paramRef)', '비고']];
  Object.entries(KJ.SENSOR_TYPES).forEach(([id, t]) => rows.push([id, t.name, t.band, t.role, t.reportingPeriod, t.c2Report || '',
    mapped(t.ranges.detect), mapped(t.ranges.track), mapped(t.ranges.fireControl), t.transitionTime.detectToTrack ?? '', t.transitionTime.trackToFireControl ?? '',
    mapped(t.trackCapacity), t.minAltitude, t.detectionProbability ?? '', j(t.detectableThreats), t.confidence, t.paramRef, t.sourceNote || '']));
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
  const context = {
    IAOC: '원시 유형 운용자 중간값은 1초. 지휘흐름 par=true 적용 자산은 30초, 총 평균 31.5초. To-Be 주축 결심 담당.',
    MCRC: '원시 유형과 실효 결심석 10. As-Is 공중위협 주축. To-Be 병렬 도메인 통보·처리 결과는 IAOC 결심의 승인 조건이 아님.',
    KAMD_OPS: 'As-Is 탄도위협 주축. To-Be 병렬 도메인 통보·처리 결과는 IAOC 결심의 승인 조건이 아님.',
    ICC: '중계 인가는 화면 기본 ON, 엔진 기본 OFF. 재배정은 실제 ICC 발령자와 부모 명령 ID를 기록하며 원 통제 commander를 유지.',
    ECS: '교전명령 접수 큐를 처리. ecs 전용시간 플래그는 화면·엔진 기본 OFF.'
  };
  Object.entries(KJ.C2_TYPES).forEach(([id, t]) => rows.push([id, t.name, t.tier, t.simultaneousCapacity, t.processing.system[0], t.processing.system[1],
    t.processing.operator.high, t.processing.operator.mid, t.processing.operator.low, t.commandScope, t.reportingPeriod, t.integrated ? 'Y' : 'N',
    t.confidence, t.paramRef, [t.sourceNote, context[id]].filter(Boolean).join(' / ')]));
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
  KJ.SCENARIOS.forEach((s) => {
    const add = (e, condition) => rows.push([s.id, s.name, s.defaultMode || '', e.type, e.axis,
      e.ratePerMin ?? '', e.burst ?? '', e.atSec ?? '', e.equivRatePerMin ?? '',
      [s.problem, condition].filter(Boolean).join(' / ')]);
    (s.mix || []).forEach((e) => add(e, '기본 mix'));
    (s.southernMix || []).forEach((e) => add(e, 'southernMix: southernAxes=true일 때 추가. 현재 화면·엔진 기본 ON'));
  });
  return rows;
}

// ── 기본 설정 · 안내 ──
function metaSheet() {
  const nodeCount = (d, m) => KJ.nodesInMode(m, KJ.resolveModelCatalog({ deploymentId: d, mode: m, modelFidelity: 'iads-c2', features: F })).length;
  const effective = KJ.resolveModelCatalog({ deploymentId: UI.values.dep, features: F });
  const iaoc = effective.nodes.find((n) => n.typeId === 'IAOC');
  const mcrc = effective.nodes.find((n) => n.typeId === 'MCRC');
  const rows = [['항목', '값', '설명'],
    ['배치 목록', KJ.DEPLOYMENT_IDS.join(', '), '「아군자산_…」 시트는 LEGACY·FULL 두 배치'],
    ['LEGACY 노드 수', nodeCount('HANBANDO_LEGACY_NORMAL', 'asis') + ' / ' + nodeCount('HANBANDO_LEGACY_NORMAL', 'tobe'), 'As-Is / To-Be'],
    ['FULL 노드 수', nodeCount('HANBANDO_FULL_NORMAL', 'asis') + ' / ' + nodeCount('HANBANDO_FULL_NORMAL', 'tobe'), 'As-Is / To-Be'],
    ['좌표 순서', '위도, 경도 (십진도)', '⚠️ codex 표는 경도,위도 — 복사 시 열이 뒤바뀐다'],
    ['좌표 성격', '개념', '개념 = 도시 수준 개념좌표(실제 배치·표적 아님) / 실제 = 사용자가 실좌표를 넣음'],
    ['기본 seed', UI.values.seed, '지휘흐름 재현용 예시. 현행 조건의 평균·통계적 대표성을 뜻하지 않음 (ADR-100)'],
    ['기본 관측시간 s', UI.values.dur, '지휘흐름 화면 실제 파서 기본값'],
    ['표적 산포 반경 km', KJ.THREAT_TARGET_SPREAD_KM, 'ADR-063 · 조준점 중심으로 흩어지는 반경'],
    ['자위권 반경 km', KJ.SELF_DEFENSE_RADIUS_KM, 'ADR-071'],
    ['남부 공격 경로 키', j(KJ.SOUTHERN_AXIS_KEYS), 'southernAxes 플래그가 켤 때만 사용'],
    ['조준점 대상 위협', j(KJ.AIMPOINT_TYPES), 'ADR-097 · 탄도탄만'],
    ['내보낸 날짜', new Date(`${AS_OF}T00:00:00Z`), 'Asia/Seoul 기준. node scripts/export-params-xlsx.mjs'],
    ['작성자', '', '사용자가 고친 뒤 적는다'],
    ['수정 메모', '', '작성자·수정 메모는 재내보내기 시 보존. 다른 값은 현재 코드에서 새로 읽음'],
    ['기준 소스 버전', VERSION + (SOURCE_DIRTY ? '+dirty' : ''), 'Git HEAD + 미커밋 소스 여부. 아래 SHA-256은 실제 내보낸 작업 파일 내용'],
    ['파라미터 적용 기준', '지휘흐름 URL 미지정 기본값', '아군자산·통신계선은 typed 화면 features로 만든 실효 카탈로그. 자산제원은 원시 유형'],
    ['기본 시나리오', UI.values.sc, 'prototype/command-flow.html PARAMS를 실제 파서로 실행'],
    ['기본 배치', UI.values.dep, 'LEGACY·FULL 두 자산 시트는 동일한 화면 features를 각각 적용'],
    ['기본 모드', UI.values.mode, 'asis = As-Is / tobe = To-Be'],
    ['위협 강도', Number(/const INTENSITY = ([\d.]+)/.exec(uiSource)?.[1]), '지휘흐름 화면 고정 배율'],
    ['IAOC 원시 운용자 중간 s', KJ.C2_TYPES.IAOC.processing.operator.mid, '자산제원_C2에 실린 원시 유형. par=false 또는 엔진 기본값 경로'],
    ['IAOC 실효 운용자 s', iaoc.queue.serviceParts.operatorSec, '화면 par=true의 적용값. As-Is KAMD_OPS 중간 운용자 성분과 동일'],
    ['IAOC 실효 총 평균 s', iaoc.queue.serviceTimeSec.tobe, '체계 성분 중점 + 운용자 성분. 실제 사람 결심시간의 실측치가 아님'],
    ['MCRC 실효 결심석', mcrc.queue.servers, '현행 배치 카탈로그 값. 과거 문서의 8석 대신 현재 10석'],
    ['항적 상세 기록 상한', Number(/traceCap:\s*(\d+)/.exec(uiSource)?.[1]), '전체 생성·격추·누수·종료 미해결 집계와 별도. 절삭 시 지도·상세 목록은 표본'],
    ['흐름 기록 기본 상한', BASE_ENGINE.flowTraceCap, '화면 flowTrace=true. flowTruncated를 traceTruncated와 별도로 표기'],
    ['종료 결과 계정', '생성 = 격추 + 누수 + 종료 미해결', '미해결은 관측 종료 시 생존 항적이며 성공·실패로 확정하지 않음'],
    ['구조 역할 개요', '가정된 책임·후보 표시', '실제 교신 기록과 별개. observed flow/C2 event만 실제 도착·명령 증거로 해석'],
    ['To-Be 도메인 제대', '병렬 통보·처리 부하', 'MCRC·KAMDOC 처리 완료는 IAOC 결심을 승인하거나 거부하는 게이트가 아님'],
    ['교전현황 신선도', '생성 시각 기준 TTL', '수신 시 유효기간을 재시작하지 않음. 과거·중복·만료 상태는 채택하지 않으며 전달 계정 유지'],
    ['분기별 포화', '실패한 분기에 한정', '협조 회신·ICC 중계·명령 발령의 포화가 다른 독립 계통의 공통 항적을 중단하지 않음'],
    ['명령 감사 계보', 'issuedByC2Id / parentDirectiveId', 'ICC 재배정은 실제 발령자와 원 명령을 기록. 통제 commander와 발령자를 구분'],
    ['불러오기 기능', false, '내보내기·검토 전용. 엑셀을 수정해도 시뮬레이터에 자동 반영되지 않음']];
  UI.params.forEach((p) => rows.push([`화면 설정 ${p.k}`, UI.values[p.k],
    `${p.h}. 적용 타입=${typeof UI.values[p.k]}, 선언 기본값=${JSON.stringify(p.d)}. 출처: prototype/command-flow.html PARAMS/파서`]));
  Object.keys(UI.features).forEach((key) => {
    const value = BASE_ENGINE[key] ?? BASE_ENGINE.features[key] ?? null;
    rows.push([`엔진 기본 ${key}`, value == null ? '미지정' : value,
      `features를 명시하지 않은 Simulation 생성값. 화면 전달값=${JSON.stringify(UI.features[key])}. 출처: js/engine/sim-engine.js`]);
  });
  SOURCE_HASHES.forEach(([file, hash]) => rows.push([`SHA-256 ${file}`, hash, '작업 파일 내용 해시. 경로는 저장소 루트 기준']));
  return rows;
}
function guideSheet() {
  return [['안내'],
    [`K-JAMDS 파라미터 참조본. ${AS_OF} 현재 소스 ${VERSION}${SOURCE_DIRTY ? '+dirty' : ''}에서 재내보냈습니다. 엑셀 불러오기 기능은 없습니다.`],
    [''],
    ['1. 좌표는 위도, 경도 순서의 십진도입니다. codex 원자료의 경도, 위도 순서와 구분합니다. 현 좌표는 도시 수준 개념값이며 실제 배치·표적이 아닙니다.'],
    ['2. 「아군자산_LEGACY / _FULL」은 자산별 실효 카탈로그입니다. 현재 지휘흐름 화면 기본 features를 각각 적용합니다. 엑셀 값 수정은 실행 모델을 변경하지 않습니다.'],
    ['3. 「공격경로」는 원래 발사점·표적과 계산된 탄도탄 발사점 연장량을 함께 기록합니다. 현재 화면 lx=true이며 비탄도 경로를 연장하지 않습니다.'],
    [`4. 「조준점」은 코드에 있는 ${KJ.TARGET_AIMPOINTS.length}개 개념 표적 후보입니다. 현재 화면 aim=true. 지정 위협은 후보 배정 후 산포 반경을 적용합니다.`],
    ['5. 「시나리오」는 기본 mix와 조건부 southernMix를 모두 기록합니다. 남부 흐름은 southernAxes=true일 때 추가되며 현재 화면과 엔진의 기본값은 ON입니다.'],
    ['6. 「자산제원_…」「위협제원」은 원시 유형 값입니다. 빈 칸은 해당 속성의 원시 값 없음/해당 없음입니다. 센서의 위협별 값은 aircraft: 값; ballistic: 값처럼 구분합니다.'],
    ['7. 「통신계선_…」은 모드별 매체·지연·현황 유효기간입니다. 현황은 생성 시각부터 유효하며 늦은 도착이 수명을 연장하지 않습니다.'],
    [''],
    ['등급과 paramRef·출처는 현재 코드의 표기를 유지합니다. C는 개념 추정이며 실제 절차의 검증값을 뜻하지 않습니다. 사용자 수정값은 코드 원본과 구분해야 합니다.'],
    ['내보내기 전용입니다. 다시 실행하면 모든 카탈로그 값을 현재 소스에서 갱신합니다. 작성자·수정 메모, 기존 서식·수식·주석은 보존하며 다른 값은 소스 기준으로 바뀝니다.'],
    ['8. IAOC 원시 운용자 중간값은 1초입니다. 화면 par=true를 적용한 자산 값은 운용자 30초·총 평균 31.5초입니다. 엔진의 par 기본값은 OFF이므로 실행 경로를 구분합니다.'],
    ['9. 구조 역할 개요는 가정된 책임·후보를 보여 줍니다. 실제 기록된 교신·명령 경로와 다릅니다. To-Be 도메인 제대는 병렬 통보 부하이며 IAOC의 승인 게이트가 아닙니다.'],
    ['10. seed29는 재현용 단일 예시입니다. 전체 생성·격추·누수·종료 미해결과 상세 기록 표본을 구분합니다. 구조 효과의 평균이나 통계적 유의성을 이 파일이 제공하지는 않습니다.']];
}

const sheets = [
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
];
if (process.argv.includes('--data-only')) {
  console.log(JSON.stringify({ sourceVersion: VERSION, sourceDirty: SOURCE_DIRTY,
    uiDefaults: UI.values, uiFeatures: F, linkModeDifferences: LINK_MODE_DIFFERENCES, sheets }, null, 2));
  process.exit(0);
}

// Dependencies stay outside the repository. The bundled runtime is the default;
// KJ_ARTIFACT_NODE_MODULES can point to another managed loader node_modules.
const runtimeModules = process.env.KJ_ARTIFACT_NODE_MODULES || path.join(os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const qaDir = process.env.KJ_XLSX_QA_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'kj-params-xlsx-'));
await fs.mkdir(qaDir, { recursive: true });
const runtimeLink = path.join(qaDir, 'node_modules');
try { await fs.symlink(runtimeModules, runtimeLink, 'dir'); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
let artifact;
try {
  const runtimeRequire = createRequire(path.join(qaDir, 'runtime-loader.mjs'));
  artifact = await import(pathToFileURL(runtimeRequire.resolve('@oai/artifact-tool')).href);
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  // The dependency-free exporter is retained for an explicitly requested fallback,
  // because it cannot preserve unrelated formulas, annotations or native objects.
  if (!process.argv.includes('--lite')) throw new Error(
    'Artifact Tool을 찾지 못했습니다. KJ_ARTIFACT_NODE_MODULES를 설정하세요. --lite는 기존 서식·수식 보존 없는 재생성입니다.');
  console.warn('Artifact Tool unavailable: explicit --lite regeneration; existing workbook preservation is not available.');
  writeXlsx(OUT, sheets.map((s) => ({ ...s, rows: s.rows.map((r) => r.map((v) => v instanceof Date ? AS_OF : v)) })));
  console.log('내보내기 완료:', OUT);
  process.exit(0);
}
const { FileBlob, SpreadsheetFile, Workbook } = artifact;
let existed = true;
try { await fs.access(OUT); } catch { existed = false; }
const wb = existed ? await SpreadsheetFile.importXlsx(await FileBlob.load(OUT)) : Workbook.create();
const colName = (index) => {
  let out = '', i = index + 1;
  while (i) { out = String.fromCharCode(65 + (i - 1) % 26) + out; i = Math.floor((i - 1) / 26); }
  return out;
};
const report = { asOf: AS_OF, sourceVersion: VERSION, sourceDirty: SOURCE_DIRTY, sourceHashes: SOURCE_HASHES,
  uiDefaults: UI.values, uiFeatures: F, authoring: '@oai/artifact-tool', sheets: [] };
for (let si = 0; si < sheets.length; si++) {
  const spec = sheets[si];
  const sheet = existed ? wb.worksheets.getItem(spec.name) : wb.worksheets.add(spec.name);
  const old = existed ? sheet.getUsedRange().values : [];
  const formulas = existed ? sheet.getUsedRange().formulas : [];
  const changes = [], retainedFormulas = [];
  const oldColumns = Math.max(0, ...old.map((r) => r.length));
  const oldRows = old.length;
  if (spec.name === '기본설정') {
    for (const label of ['작성자', '수정 메모']) {
      const previous = old.find((r) => r[0] === label), next = spec.rows.find((r) => r[0] === label);
      if (previous && next) next[1] = previous[1] ?? '';
    }
  }
  for (let r = 0; r < spec.rows.length; r++) {
    const changedText = [];
    for (let c = 0; c < spec.rows[r].length; c++) {
      const value = spec.rows[r][c], before = old[r]?.[c] ?? '';
      const address = `${colName(c)}${r + 1}`;
      if (formulas[r]?.[c]) { retainedFormulas.push(address); continue; }
      if (!(value instanceof Date) && before === (value ?? '')) continue;
      const cell = sheet.getRange(address);
      if (existed && (r >= oldRows || c >= oldColumns) && oldRows && oldColumns) {
        cell.copyFrom(sheet.getRange(`${colName(Math.min(c, oldColumns - 1))}${r === 0 ? 1 : Math.min(r + 1, oldRows)}`), 'all');
      }
      cell.values = [[value ?? null]];
      if (value instanceof Date) cell.setNumberFormat('yyyy-mm-dd');
      if (typeof value === 'string' && value.length > 18) {
        cell.format.wrapText = true;
        cell.format.verticalAlignment = 'top';
        changedText.push(address);
      }
      changes.push({ cell: address, before, after: value });
    }
    if (changedText.length) sheet.getRange(`A${r + 1}:${colName(spec.rows[0].length - 1)}${r + 1}`).format.autofitRows();
  }
  if (!existed) {
    const used = sheet.getRange(`A1:${colName(spec.rows[0].length - 1)}${spec.rows.length}`);
    used.format.font = { name: 'Calibri', size: 11 };
    sheet.getRange(`A1:${colName(spec.rows[0].length - 1)}1`).format.font = { bold: true };
    sheet.freezePanes.freezeRows(1);
  }
  if (spec.name === '안내') {
    sheet.getRange(`A2:A${spec.rows.length}`).format.wrapText = true;
    sheet.getRange(`A2:A${spec.rows.length}`).format.autofitRows();
  }
  if (spec.name === '기본설정') {
    sheet.getRange(`A16:A${spec.rows.length}`).format.wrapText = true;
    sheet.getRange(`A16:C${spec.rows.length}`).format.autofitRows();
    sheet.getRange('B2').format.wrapText = true;
    sheet.getRange('A2:C2').format.autofitRows();
  }
  if (spec.name.startsWith('통신계선_')) {
    sheet.getRange('N:P').format.columnWidth = 24;
    sheet.getRange('P:P').format.columnWidth = 64;
    sheet.getRange('N1:P1').format.wrapText = true;
    sheet.getRange('N1:P1').format.font = { bold: true };
    sheet.getRange('A1:P1').format.autofitRows();
    spec.rows.forEach((row, r) => {
      if (row[2] !== '교전현황') return;
      sheet.getRange(`A${r + 1}:P${r + 1}`).format.rowHeight = 20;
      sheet.getRange(`A${r + 1}:P${r + 1}`).format.autofitRows();
    });
  }
  report.sheets.push({ name: spec.name, rows: spec.rows.length, columns: spec.rows[0].length,
    changedCells: changes.length, changedRows: new Set(changes.map((c) => /\d+$/.exec(c.cell)[0])).size,
    changes, retainedFormulas });
}
wb.recalculate();
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!|\\[object Object\\]',
  options: { useRegex: true, maxResults: 100 }, summary: 'formula and serialization error scan', maxChars: 3000 });
report.errorScan = errors.ndjson;
for (let i = 0; i < sheets.length; i++) {
  const spec = sheets[i];
  const ranges = spec.name === '안내' ? [`A1:A${spec.rows.length}`]
    : spec.name === '기본설정' ? ['A1:C18', 'A19:C34', 'A35:C55', `A${Math.max(1, spec.rows.length - 11)}:C${spec.rows.length}`]
      : spec.name.startsWith('아군자산_') ? ['A1:F9', 'S1:Z15']
        : spec.name === '자산제원_C2' ? ['A1:I9', 'J1:O9']
          : spec.name === '자산제원_센서' ? ['A1:F9', 'G1:R9']
            : spec.name.startsWith('통신계선_') ? ['A1:F8', 'J1:P8']
              : [`A1:${colName(Math.min(spec.rows[0].length, 8) - 1)}${Math.min(spec.rows.length, 10)}`];
  if (spec.name.startsWith('아군자산_')) {
    const iaocRow = spec.rows.findIndex((r) => r[2] === 'IAOC') + 1;
    ranges.push(`S${iaocRow}:Z${iaocRow}`);
  }
  for (let n = 0; n < ranges.length; n++) {
    const preview = await wb.render({ sheetName: spec.name, range: ranges[n], scale: 1.5, format: 'png' });
    await fs.writeFile(path.join(qaDir, `after-${i + 1}-${n + 1}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}
const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(OUT);
try { await fs.rename(`${OUT}.inspect.ndjson`, path.join(qaDir, 'export-inspect.ndjson')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(path.join(qaDir, 'changes.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(qaDir, 'expected-sheets.json'), JSON.stringify(sheets, null, 2));
console.log(JSON.stringify({ output: OUT, qaDir, sourceVersion: VERSION, asOf: AS_OF,
  sheets: report.sheets.map(({name,rows,columns,changedCells,changedRows}) => ({name,rows,columns,changedCells,changedRows})), errorScan: report.errorScan }, null, 2));
