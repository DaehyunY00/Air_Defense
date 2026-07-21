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
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }

assert(index.indexOf('header-bn-count') === -1, '우측 상단 도출 병목 배지 제거');
assert(index.indexOf('id="toggle-links"') !== -1, 'C2 연결선 표시 토글 노출');
assert(/id="toggle-links"(?![^>]*checked)/.test(index), '과밀 방지: C2 연결선 기본 OFF');
assert(index.indexOf('id="map-asset-summary"') !== -1, '현재 배치 자산 수 지도 범례에 상시 표시');
assert(index.indexOf('js/core/sim-worker-client.js') !== -1, 'Worker client 로드');
assert(index.indexOf('id="sim-compute-mode"') !== -1, 'Worker/폴백 계산 모드 상시 안내');
assert(/\.map-legend\s*\{[^}]*right:\s*12px;[^}]*left:\s*auto;/s.test(css), '범례 우측 하단 배치');
assert(main.indexOf("getElementById('toggle-links')") !== -1, '링크 토글 이벤트 바인딩');
assert(main.indexOf('header-bn-count') === -1, '헤더 병목 수 갱신 로직 제거');
assert(map.indexOf('setLinksVisible: function') !== -1, 'Leaflet C2 링크 레이어 토글');
assert(map.indexOf('linksVisible ? KJ.linksInMode') !== -1, 'SVG fallback 링크 토글');
assert(map.indexOf('expandedLegacyOffset') !== -1 && map.indexOf('asset-spread-line') !== -1,
  'legacy 10세트 저배율 표시좌표 방사형 분리');
assert(map.indexOf('asset-range-ring') !== -1 && map.indexOf('if (fallback)') !== -1,
  'SVG fallback 탐지·교전 범위 링과 토글 재렌더');
assert(sim.indexOf("KJ.compute.run('desPair'") !== -1, '주 시뮬레이션 DES Worker 분리');
assert(sim.indexOf('includeHeat: true') !== -1, '중복교전 위험 Worker 선계산 요청');
assert(sim.indexOf("KJ.compute.run('mcPair'") !== -1, '백그라운드 MC Worker 분리');
assert(sim.indexOf("pair.execution === 'web-worker'") !== -1 && sim.indexOf('run.mc.skipped = true') !== -1,
  '메인 스레드 폴백 자동 MC 차단');
assert(sim.indexOf('KJ.computeOverlapHeat') === -1, '결과 모달 메인 스레드 overlap 재계산 제거');
assert(sim.indexOf('renderMcSectionIfOpen') !== -1 && sim.indexOf('run.modalRendered') !== -1,
  'MC 부분 갱신·결과 모달 캐시');
assert(sim.indexOf('관측 종료 미해결') !== -1 && sim.indexOf('확정 누출 (전체 생성 기준)') !== -1,
  '결과 요약에 확정 누출·관측 종료 미해결 분리 표시');
assert(sim.indexOf('해결분 기준 요격 실패율 평균') !== -1 && sim.indexOf('rateOf(asisG.leaked, asisG.spawned)') !== -1,
  '해결분 기준 MC와 전체 생성 기준 비교의 분모 명시');
assert(sim.indexOf('renderEveryMs = objectCount > 160 ? 100 : 33') !== -1 && sim.indexOf('lastRingWall') !== -1,
  'FULL 지도 적응형 프레임률·링 갱신 제한');
assert(mc.indexOf("KJ.compute.run('mcBundle'") !== -1, 'MC·민감도 Worker 분리');
assert(mc.indexOf("KJ.compute.run('transition'") !== -1, '임계 전환점 Worker 분리');
assert(worker.indexOf("'../engine/sim-engine.js'") !== -1 && worker.indexOf("'../analysis/overlap-heatmap.js'") !== -1,
  'Worker 엔진·분석 정본 로드');
assert(worker.indexOf('heatCurrentAxes') !== -1 && client.indexOf('heatCurrentAxes') !== -1,
  'Worker/폴백 overlap 축선 결과 전달');
assert(client.indexOf('main-thread-fallback') !== -1, '단일 HTML/Worker 미지원 폴백 보존');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
