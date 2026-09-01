/**
 * K-JAMDS 시뮬레이터 — 전체 회귀 스위트 단일 실행기 (Phase 5)
 * 실행:  node tests/run-all.js   (저장소 루트에서)
 *
 * 1) 전 JS 파일 구문 검증(node --check)
 * 2) 등록된 회귀 테스트 순차 실행
 * 하나라도 실패하면 비영(非零) 종료 — CI 게이트로 사용.
 */
'use strict';
var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

var failures = 0;

// ── 1) 구문 검증 ──
function walk(dir) {
  return fs.readdirSync(dir).reduce(function (acc, name) {
    var p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) return acc.concat(walk(p));
    if (/\.m?js$/.test(name)) acc.push(p);
    return acc;
  }, []);
}
var jsFiles = walk(path.join(root, 'js'));
console.log('== 구문 검증 (' + jsFiles.length + '개 파일) ==');
jsFiles.forEach(function (f) {
  var r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failures++;
    console.log('  SYNTAX FAIL ' + path.relative(root, f) + '\n' + r.stderr);
  }
});
if (!failures) console.log('  전체 통과');

// ── 2) 회귀 테스트 스위트 ──
// ADR-061: legacy 파이프라인·배치 전용 스위트 16종은 폐기 — 목록·사유·대체 커버리지는
// tests/retired-legacy-suites.md 원장 참조.
var suites = [
  ['engine.test.mjs', 'DES 엔진 (재현성·극한값·시나리오 병목·보존·trace — native 이관)'],
  ['mc.test.mjs', 'Monte Carlo (Welford·샘플러·수렴·유의성·민감도 — native 이관)'],
  ['overlap.test.js', '중복교전 히트맵 (순수성·스케일링·융합허브)'],
  ['transition.test.mjs', '임계 전환점 (Rec.6 — ρ>0.9 구간 개선폭 — native 이관)'],
  ['constraints.test.mjs', '제약 어서션 (Rec.5 — a~g, ADR-061 고해상도 이관)']
  ,['hires-baseline.test.mjs', 'ADR-061 고해상도 기준선 (이관 시점 지문 6케이스 SHA-256)']
  ,['deployment.test.js', '고해상도 배치 선언 (6개 ID·수량·참조·SHORAD·USFK·MDL)']
  ,['deployment-adapter.test.mjs', '배치 호환 어댑터 (토폴로지·DOWN·결정론·보존법칙)']
  ,['high-resolution-connection.test.mjs', '고해상도 C2 연결 (ICC 상향 승인경로·As-Is 주교전)']
  ,['iads-native-pipeline.test.mjs', '원본 IADS 파이프라인 (책임 C2·scope WTA·PIP·발사대·실제 중복 BDA)']
  ,['c2a-asis.test.mjs', 'FULL As-Is 군단 AOC C2A (MCRC+국지 융합·우선순위·제한형 현황공유)']
  ,['iads-failure-realism.test.mjs', '고해상도 요격 실패 현실성 (SHORAD Pk·2발 SLS·무한 재교전 방지·분모 보존)']
  ,['failure-classification.test.mjs', '실패 분류 v2 (주원인·기여원인·구조성·PIP 세분화·사수부하)']
  ,['ui-performance.test.js', 'UI 응답성·지도 제어 (Worker·병목배지·C2링크·범례)']
  ,['map-visualization.test.js', '지도 시각화 (접이식 범례·공동 포대 중첩 마커·Leaflet/SVG·범위 링)']
  ,['vendor-leaflet.test.js', 'Leaflet 동봉본 (무결성·CDN 의존 부재·이미지 불요·fallback 유지)']
  ,['overlap-performance.test.js', 'FULL 중복교전 계산 성능·정본 동등성']
  ,['iads-kernel.test.mjs', 'IADS_C2 공통 커널 (ES module·이벤트 큐·도메인 RNG·SNR/RCS/수평선 센서)']
  ,['c2-analysis.test.mjs', 'C2 구조화 계측·병목 귀속·동일 seed paired Monte Carlo']
  ,['metrics-accounting.test.mjs', '지표 계정 (native 고가유도탄·중복교전 귀속 범위·MC 시간지표 표본)']
  ,['legacy-hires-deployment.test.mjs', 'LEGACY_HIRES 배치 (legacy 자산 배치 × iads-c2 물리·DOWN 대체·기존경로 불변)']
  ,['engagement-state-unification.test.mjs', 'ADR-056 교전상태 통합 (OFF bit-exact·ON To-Be 소비·As-Is 불변)']
  ,['link-semantics.test.mjs', 'ADR-057 링크 의미론 codex 정합 (보고주기 차등·C2 전송 1초·OFF 불변)']
  ,['approval-chain.test.mjs', 'ADR-058 승인 계선 이식 (coord 경유·approval 서비스·위임·USFK 불변·반증)']
  ,['native-wta.test.mjs', 'ADR-059 native WTA 모드 차등 (As-Is 부하선택·보존율 차등·비용항 반증)']
  ,['analysis-metric-honesty.test.mjs', 'ADR-062 지표 정직성 (死 지표 근거·승인계선 토글 배선·OFF bit-exact)']
  ,['target-dispersion.test.mjs', 'ADR-063 표적권역 산포 (OFF bit-exact·균등원판·seed 의존·스트림 분리·권역 무결성·제약 불변)']
  ,['southern-axes.test.mjs', 'ADR-064 남부 종심 축선 (OFF bit-exact·coverage 분리·사거리 정합·체공 환산·남부 자산 활성화)']
  ,['sensor-report-parity.test.mjs', 'ADR-067 레이더→C2 보고 주기 양 모드 공통 (대칭·킬웹 포함·음성 비대칭 유지·As-Is 불변)']
  ,['codex-alignment.test.mjs', 'ADR-069~072 IADS_codex 정본 정합 (톱니 신선도·원격교전+웹파티션·자위권 발사·기본값 전환)']
  ,['threat-log-pairing.test.mjs', '항적 CRN 짝맞춤·trace 비침습성 (위협집단 동일성·판정 분기 실재·tracePair 배선)']
  // 종전에 decision-audit이 두 줄(ADR-073·ADR-062 라벨)로 등록돼 같은 파일을 두 번 돌렸다.
  // 라벨만 다를 뿐 같은 스위트라 게이트 시간만 늘었다 — 한 줄로 합친다(ADR 두 개를 다 적는다).
  ,['decision-audit.test.mjs', 'ADR-062·073 결심 감사 로깅 (OFF bit-exact·RNG 소비 불변·상한/표본 결정론)']
  ,['shadow-eval.test.mjs', 'ADR-074 그림자 평가·교전창 계측 (RNG 불변·regret≥0·USFK 제외·전수 분모)']
  ,['decision-comparison.test.mjs', 'ADR-075 결심 비교 탭 (순수 후처리·미측정 표시·딥링크 하위호환·단일본)']
  ,['geometry-window-cache.test.mjs', 'ADR-076 교전창 캐시 키 정합 (순수함수 캐시·순서 독립·종전 키 충돌 실측·산포 OFF 불변)']
  ,['approval-authority.test.mjs', 'ADR-077 교전승인권자 해소 정합 (미등록 역할=승인 증발 방지·To-Be 조율층 경유·As-Is 불변)']
  ,['c2-echelon-hierarchy.test.mjs', 'ADR-078 IAOC 상위 제대화 (도메인 제대 실부하·병렬 통보·교전현황 조율층 수신·As-Is 불변)']
  ,['analysis-pipeline-table.test.mjs', 'ADR-083 탐지→발사 시간표 단일화 (산술 정합·승인 0초 규칙·단일 코호트·구표 검산)']
  ,['flow-trace.test.mjs', '지휘 흐름 관측 flowTrace (ON/OFF bit-exact·간선/매체 정합·병렬 계선·체류 순서·절삭 고지)']
  ,['usfk-track-sharing.test.mjs', 'ADR-085 연합 항적 공유 반사실 (OFF 계선 0·상황인식만 개방·지휘/승인 격리 유지·매체 검증)']
  ,['command-flow-single.test.mjs', '[지휘 흐름] 단일본 (빌더 바이트 재현·자기완결·인라인 순서=import 순서·커널 IIFE 공유)']
  ,['c2-service-floor.test.mjs', 'ADR-092 C2 처리 시간 바닥 (OFF 골든 bit-exact·성분 항등·바닥 위반 0·평균 항등·mult 배율·배선)']
  ,['approval-pipeline-realism.test.mjs', 'ADR-093 승인 파이프라인 현실화 (OFF 골든·To-Be bit-exact·요청 시 실행가능·회신 역방향·C2A 회신 큐·마크 순서·wire shape)']
];
// 스위트 타임아웃: 고해상도 FULL 스위트는 느린 CI·컨테이너에서 4분을 넘길 수 있어
// 종전 120초 상한이 정상 통과하는 테스트를 강제 종료해 거짓 실패를 냈다(2026-07).
// ADR-061 이후 iads-c2가 유일 충실도라 MC 계열(mc·transition)은 복제수를 줄여도
// 10분 안팎이 걸린다 — 행(hang) 감지 목적은 유지하면서 상한을 30분으로 둔다.
// SUITE_TIMEOUT_MS로 재정의 가능.
var SUITE_TIMEOUT_MS = Number(process.env.SUITE_TIMEOUT_MS) || 1800000;
suites.forEach(function (s) {
  console.log('\n== ' + s[1] + ' ==');
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, s[0])], {
    encoding: 'utf8', cwd: root, timeout: SUITE_TIMEOUT_MS
  });
  var out = (r.stdout || '') + (r.stderr || '');
  var tail = out.trim().split('\n');
  var passCount = (out.match(/PASS /g) || []).length;
  var failCount = (out.match(/FAIL /g) || []).length;
  if (r.status === 0) {
    console.log('  통과 (어서션 ' + passCount + '건)');
  } else {
    failures++;
    console.log('  ★ 실패 (통과 ' + passCount + ' / 실패 ' + failCount + ')');
    // 어서션 실패와 타임아웃·크래시를 구분해 표시한다(종전에는 둘 다 "실패"로만 보였다).
    if (r.error && r.error.code === 'ETIMEDOUT') {
      console.log('  ⏱ 타임아웃 — ' + (SUITE_TIMEOUT_MS / 1000) + '초 내 미완료 (SUITE_TIMEOUT_MS로 조정)');
    } else if (failCount === 0) {
      console.log('  ⚠️ 어서션 실패 없이 비정상 종료 (예외·크래시) — 아래 출력 확인');
    }
    console.log(out.split('\n').filter(function (l) { return l.indexOf('FAIL') !== -1; }).join('\n'));
    console.log('  마지막 출력: ' + tail.slice(-3).join(' | '));
  }
});

console.log('\n' + (failures === 0
  ? '════ 전체 회귀 스위트 통과 ════'
  : '════ 실패 ' + failures + '건 — 커밋 금지 ════'));
process.exit(failures ? 1 : 0);
