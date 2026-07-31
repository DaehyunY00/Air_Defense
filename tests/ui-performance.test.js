/** Worker offload and map-control UI regression. */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
var index = read('index.html');
var css = read('css/style.css');
var main = read('js/main.js');
var map = read('js/ui/map-view.js');
var sim = read('js/ui/sim-view.js');
var mc = read('js/ui/mc-panel.js');
var client = read('js/core/sim-worker-client.js');
var worker = read('js/workers/sim-worker.js');
var moduleWorker = read('js/workers/sim-worker.mjs');
var workerRuntime = read('js/workers/sim-worker-runtime.js');
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

assert(index.indexOf('header-bn-count') === -1, '우측 상단 도출 병목 배지 제거');
assert(index.indexOf('id="toggle-links"') !== -1, 'C2 연결선 표시 토글 노출');
assert(/id="toggle-links"(?![^>]*checked)/.test(index), '과밀 방지: C2 연결선 기본 OFF');
assert(/<details[^>]*id="map-legend"[^>]*open/.test(index) && index.indexOf('class="map-legend-toggle"') !== -1,
  '지도 범례를 기본 열린 접근 가능 details 토글로 제공');
assert(index.indexOf('id="map-asset-summary"') !== -1, '현재 배치 자산 수 지도 범례에 상시 표시');
assert(index.indexOf('js/core/sim-worker-client.js') !== -1, 'Worker client 로드');
assert(index.indexOf('js/model/iads/bootstrap.js') !== -1 && client.indexOf("type: 'module'") !== -1 &&
  client.indexOf("msg.type === 'worker-ready'") !== -1 && client.indexOf('workerQueue') !== -1,
  'IADS_C2식 ES module 커널·Worker 준비 핸드셰이크 로딩');
assert(index.indexOf('id="sim-compute-mode"') !== -1, 'Worker/폴백 계산 모드 상시 안내');
assert(/\.map-legend\s*\{[^}]*right:\s*12px;[^}]*left:\s*auto;/s.test(css) &&
  /\.sim-hud\s*\{[^}]*z-index:\s*1100;/s.test(css) && css.indexOf('.sim-hud { right: 424px; }') !== -1,
  '범례 우측 하단 배치·낮은 화면 HUD 적중영역 보존');
assert(main.indexOf("getElementById('toggle-links')") !== -1, '링크 토글 이벤트 바인딩');
assert(main.indexOf('header-bn-count') === -1, '헤더 병목 수 갱신 로직 제거');
assert(map.indexOf('setLinksVisible: function') !== -1, 'Leaflet C2 링크 레이어 토글');
assert(map.indexOf('linksVisible ? KJ.linksInMode') !== -1, 'SVG fallback 링크 토글');
assert(map.indexOf('groupBySite') !== -1 && map.indexOf('node-site-stack') !== -1 &&
  map.indexOf('asset-spread-line') === -1,
  '동일 좌표 ECS·MFR/레이더·포대를 중첩 사이트 마커로 통합');
assert(map.indexOf('asset-range-ring') !== -1 && map.indexOf('if (fallback)') !== -1,
  'SVG fallback 탐지·교전 범위 링과 토글 재렌더');
assert(sim.indexOf("KJ.compute.run('desPair'") !== -1, '주 시뮬레이션 DES Worker 분리');
// ⚠️ 결과 모달은 [분석] 탭 전면 개편에 맞춰 **시간·노드 활성화만** 남기도록 축소됐다.
// 종전에 여기서 잠그던 정량 지표 어서션(확정 누출·관측 종료 미해결·paired Δ·명령 수명주기
// ·기회손실 등)은 그 화면과 함께 사라졌으므로 제거한다. 되살릴 때 이 블록도 함께 되살린다.
// 자동 MC(mcPair)도 모달의 신뢰구간 섹션 전용이었어서 함께 걷어냈다 — 대신 "다시 살아나지
// 않았는지"를 부재 어서션으로 고정한다(아무도 안 보는 30~200복제가 조용히 복귀하는 것을 막는다).
assert(sim.indexOf("KJ.compute.run('mcPair'") === -1,
  '결과 모달 축소: 자동 백그라운드 MC 제거 (소비처였던 신뢰구간 섹션이 사라짐)');
// 주석에도 'includeHeat'가 등장하므로(제거 사유 설명) 실제 **요청 형태**로만 판정한다.
assert(!/includeHeat\s*:\s*true/.test(sim),
  '결과 모달 축소: 중복교전 히트맵 선계산 요청 제거 (소비처 사라짐)');
assert(sim.indexOf('run.modalRendered') !== -1, '결과 모달 1회 렌더 캐시 유지');
// ADR-076: 결과 모달은 **항적 병렬 대조 한 절만** 남기도록 더 줄였다(사용자 요청).
// 실행 정보·시간 카드·노드 활성화 표는 [분석]·[C2 구조] 탭으로 옮겼다.
assert(!/plainCategory/.test(sim) && !/시뮬레이션 속에서 흐른 시간/.test(sim),
  '결과 모달에서 실행정보·시간카드·노드표 제거 (분석/C2 구조 탭으로 이관)');
assert(/renderThreatCompare/.test(sim),
  '결과 모달이 항적 병렬 대조 렌더러를 공용 진입점으로 노출 ([분석] 탭이 재사용)');
// As-Is↔To-Be 항적 병렬 대조는 축소 후에도 **남긴** 섹션이다(사용자 요구).
// 필터는 섹션만 다시 그려야 한다 — 모달 전체를 재렌더하면 펼쳐 둔 항목이 닫힌다.
assert(/sim-compare-section/.test(sim) && /threatCompareSection/.test(sim),
  '결과 모달에 As-Is↔To-Be 항적 병렬 대조 섹션 존재');
assert(/box\.innerHTML = threatCompareSection\(\)/.test(sim),
  '병렬 대조 필터는 섹션만 부분 갱신 (펼친 항목 보존)');
assert(sim.indexOf('renderEveryMs = objectCount > 160 ? 100 : 33') !== -1 && sim.indexOf('lastRingWall') !== -1,
  'FULL 지도 적응형 프레임률·링 갱신 제한');
assert(mc.indexOf("KJ.compute.run('mcBundle'") !== -1, 'MC·민감도 Worker 분리');
assert(mc.indexOf('c2Mop: true') !== -1 && sim.indexOf('c2Mop: true') === -1,
  'C2 MOP 이벤트는 수동 MC에서만 명시 활성화해 자동 MC 부하 억제');
assert(mc.indexOf('C2 MOP 쌍체 비교') !== -1 && mc.indexOf('nPaired / 요청') !== -1 &&
  mc.indexOf('계측 없음') !== -1,
  'MC 탭에 동일 seed 교집합 C2 MOP Δ·결측 표본 노출');
assert(mc.indexOf("KJ.compute.run('transition'") !== -1, '임계 전환점 Worker 분리');
// ADR-075: Worker의 모든 import에 캐시 버스터(`?v=…`)가 붙었다. 검증 대상은 "어떤 정본을
// 싣는가"이지 버전 문자열이 아니므로 쿼리를 허용하고 경로만 본다 — 다음 버전 갱신에서
// 이 어서션이 거짓 실패하지 않도록.
['../engine/sim-engine.js', '../analysis/c2-report.js', '../analysis/overlap-heatmap.js']
  .forEach(function (path) {
    assert(new RegExp("'" + path.replace(/[./]/g, '\\$&') + "(\\?v=[^']*)?'").test(worker),
      'Worker 정본 로드: ' + path);
  });
// 캐시 버스터가 **빠짐없이** 붙어 있어야 한다. 하나라도 버전이 없으면 갱신 배포를 받은
// 브라우저가 옛 사본을 섞어 써 조용히 다른 수치를 낸다(ADR-075 §배포 결함 실측).
assert(!/'\.\.?\/[^']*\.js'/.test(worker.replace(/\?v=[^']*/g, '?v=')),
  'Classic Worker의 전 import에 캐시 버스터 부착(버전 없는 경로 0건)');
assert(!/'\.\.?\/[^']*\.js'/.test(moduleWorker.replace(/\?v=[^']*/g, '?v=')),
  'Module Worker의 전 import에 캐시 버스터 부착(버전 없는 경로 0건)');
assert(workerRuntime.indexOf('heatCurrentAxes') !== -1 && client.indexOf('heatCurrentAxes') !== -1,
  'Worker/폴백 overlap 축선 결과 전달');
assert(moduleWorker.indexOf('installIadsKernel') !== -1 && worker.indexOf('sim-worker-runtime.js') !== -1,
  'Module 우선·Classic 호환 Worker가 공통 실행 런타임 사용');
// 버전 문자열을 고정하지 않는다(갱신 때마다 거짓 실패) — classic 폴백 경로가 살아 있고
// 그 워커 URL에도 캐시 버스터가 붙어 있는지만 본다.
assert(client.indexOf("startWorker('classic')") !== -1 &&
  /sim-worker\.js\?v=[^'"]+/.test(client) && /sim-worker\.mjs\?v=[^'"]+/.test(client),
  'Module Worker 초기화 실패 시 대기 작업을 보존해 Classic Worker로 1회 전환(양 워커 URL 버전 부착)');
assert(client.indexOf('main-thread-fallback') !== -1, '단일 HTML/Worker 미지원 폴백 보존');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
