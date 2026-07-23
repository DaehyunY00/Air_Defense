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
assert(groups[2].items.length === 33 && groups[0].items.length === 38,
  'Leaflet As-Is: 동일 좌표 자산을 합친 33사이트 마커·범위 링 38');
assert(KJ.LEGACY_AIR_DEFENSE_SITES.every(function (s) {
  return icons.some(function (h) {
    return h.indexOf('BAT-' + s.weapon + '-' + s.key + ' · 4자산') !== -1 &&
      h.indexOf('node-site-count">4<') !== -1;
  });
}), 'Leaflet legacy 10개 포대 사이트에 ICC·ECS·MFR·사수 중첩 마커');
assert(!attached.has(groups[1]) && groups[1].items.length === 92, 'Leaflet 연결선 92개 준비·기본 레이어 OFF');
assert(/legacy 확장 배치.*활성 63노드.*지도 33사이트 \(중첩 10\).*10세트/.test(summaryEl.textContent),
  '지도 범례에 활성 노드·표시 사이트·중첩 사이트 수 표시');
KJ.mapView.setLinksVisible(true);
assert(attached.has(groups[1]), '연결선 토글 ON 시 Leaflet 링크 레이어 활성화');
icons.length = 0;
KJ.mapView.render({ dep: 'legacy', mode: 'tobe', open: '' }, null);
assert(groups[2].items.length === 34 && groups[1].items.length === 132,
  'Leaflet To-Be: 동일 좌표 기준 34사이트 마커·연결선 132');

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
assert((svgEl.innerHTML.match(/data-site-assets="4"/g) || []).length === 10,
  'SVG fallback legacy 10개 공동 사이트에 4자산 중첩 표시');
assert(KJ.LEGACY_AIR_DEFENSE_SITES.every(function (s) {
  return svgEl.innerHTML.indexOf('>BAT-' + s.weapon + '-' + s.key + ' · 4자산</text>') !== -1;
}), 'SVG fallback 공동 포대 사이트 라벨 누락 없음');
KJ.mapView.setLinksVisible(true);
assert((svgEl.innerHTML.match(/<line /g) || []).length === 92,
  'SVG fallback 연결선 ON: As-Is 링크 92개');
KJ.mapView.setRingsVisible(false);
assert(svgEl.innerHTML.indexOf('asset-range-ring') === -1, 'SVG fallback 범위 링 토글 OFF 반영');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
