/** legacy 확장 자산의 Leaflet/SVG 지도 렌더 실효성 검증. */
'use strict';
global.window = global;
var path = require('path');
var root = path.join(__dirname, '..');
[
  'config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js',
  'data/nodes.js', 'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js', 'ui/geo.js'
].forEach(function (f) { require(path.join(root, 'js', f)); });
var KJ = global.KJ;
var fail = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; }
var expandedIds = KJ.LEGACY_AIR_DEFENSE_SITES.reduce(function (a, s) {
  return a.concat(['ICC-' + s.key, 'ECS-' + s.key, 'MFR-' + s.key, 'BAT-' + s.weapon + '-' + s.key]);
}, []);

// ── Leaflet 경로 모의 실행 ──
var summaryEl = { textContent: '' };
global.document = { getElementById: function (id) { return id === 'map-asset-summary' ? summaryEl : { innerHTML: '' }; } };
var groups = [], icons = [], attached = new Set(), zoomHandler = null;
var fakeMap = {
  zoom: 7,
  setView: function () { return this; },
  hasLayer: function (l) { return attached.has(l); },
  addLayer: function (l) { attached.add(l); },
  removeLayer: function (l) { attached.delete(l); },
  on: function (name, fn) { if (name === 'zoomend') zoomHandler = fn; },
  getZoom: function () { return this.zoom; },
  latLngToLayerPoint: function (c) { return { x: c[1] * 100, y: c[0] * 100 }; },
  layerPointToLatLng: function (p) { return [p.y / 100, p.x / 100]; }
};
function addable(o) { o.addTo = function () { attached.add(o); return o; }; return o; }
global.L = {
  map: function () { return fakeMap; }, tileLayer: function () { return addable({}); },
  layerGroup: function () {
    var g = addable({ items: [], clearLayers: function () { this.items = []; }, addLayer: function (x) { this.items.push(x); } });
    groups.push(g); return g;
  },
  point: function (x, y) { return { x: x, y: y }; },
  circle: function (coord, opts) { return { kind: 'circle', coord: coord, opts: opts }; },
  polyline: function (coords, opts) { return { kind: 'polyline', coords: coords, opts: opts, bindTooltip: function () { return this; } }; },
  divIcon: function (opts) { icons.push(opts.html); return opts; },
  marker: function (coord, opts) {
    return { kind: 'marker', coord: coord, opts: opts, bindPopup: function () { return this; }, on: function () { return this; }, openPopup: function () {} };
  }
};
var mapModule = path.join(root, 'js', 'ui', 'map-view.js');
require(mapModule);
KJ.mapView.init('map', function () {});
KJ.mapView.render({ dep: 'legacy', mode: 'asis', open: '' }, null);
assert(groups[3].items.length === 63 && groups[0].items.length === 38,
  'Leaflet As-Is: 활성 마커 63·범위 링 38');
assert(groups[1].items.length === 40, 'Leaflet 저배율: 신규 40개 자산 리더선으로 분리');
assert(expandedIds.every(function (id) { return icons.some(function (h) { return h.indexOf('>' + id + '<') !== -1; }); }),
  'Leaflet 신규 40개 자산 마커 ID 누락 없음');
assert(!attached.has(groups[2]) && groups[2].items.length === 92, 'Leaflet 연결선 92개 준비·기본 레이어 OFF');
assert(/legacy 확장 배치.*활성 63노드.*10세트/.test(summaryEl.textContent), '지도 범례에 legacy 확장 배치·활성 노드·10세트 표시');
KJ.mapView.setLinksVisible(true);
assert(attached.has(groups[2]), '연결선 토글 ON 시 Leaflet 링크 레이어 활성화');
fakeMap.zoom = 11; zoomHandler();
assert(groups[1].items.length === 0, 'zoom 11 이상에서는 표시좌표 분리 해제·실제 좌표 사용');
icons.length = 0;
KJ.mapView.render({ dep: 'legacy', mode: 'tobe', open: '' }, null);
assert(groups[3].items.length === 64 && groups[2].items.length === 132, 'Leaflet To-Be: 활성 마커 64·연결선 132');

// ── SVG fallback 경로 모의 실행 ──
delete global.L;
delete require.cache[require.resolve(mapModule)];
var svgEl = { innerHTML: '' };
global.document = { getElementById: function (id) { return id === 'map' ? svgEl : summaryEl; } };
require(mapModule);
KJ.mapView.init('map', function () {});
KJ.mapView.render({ dep: 'legacy', mode: 'asis', open: '' }, null);
assert((svgEl.innerHTML.match(/class="asset-range-ring"/g) || []).length === 38,
  'SVG fallback 범위 링 38개 표시');
assert((svgEl.innerHTML.match(/class="asset-spread-line"/g) || []).length === 40,
  'SVG fallback 신규 자산 리더선 40개 표시');
assert(expandedIds.every(function (id) { return svgEl.innerHTML.indexOf('>' + id + '</text>') !== -1; }),
  'SVG fallback 신규 40개 라벨 누락 없음');
KJ.mapView.setLinksVisible(true);
assert((svgEl.innerHTML.match(/<line /g) || []).length === 132,
  'SVG fallback 연결선 ON: 리더선 40 + As-Is 링크 92');
KJ.mapView.setRingsVisible(false);
assert(svgEl.innerHTML.indexOf('asset-range-ring') === -1, 'SVG fallback 범위 링 토글 OFF 반영');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
