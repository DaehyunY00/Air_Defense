/** 고해상도 기본 배치(HANBANDO_LEGACY_NORMAL)의 Leaflet/SVG 지도 렌더 실효성 검증 (ADR-061). */
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

// ── 기대값을 카탈로그에서 직접 산출 (렌더러와 데이터의 정합 검증) ──
var catalog = KJ.buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL');
function expectFor(mode) {
  var nodes = KJ.nodesInMode(mode, catalog);
  var by = {};
  nodes.forEach(function (n) {
    var k = Number(n.coord[0]).toFixed(6) + '|' + Number(n.coord[1]).toFixed(6);
    (by[k] = by[k] || []).push(n);
  });
  var groups = Object.keys(by).map(function (k) { return by[k]; });
  return {
    nodes: nodes,
    sites: groups.length,
    stacked: groups.filter(function (g) { return g.length > 1; }),
    rings: nodes.filter(function (n) {
      return n.category === 'sensor' ? n.rangeKm : (n.category === 'shooter' && n.engage && n.engage.rangeKm);
    }).length,
    links: KJ.linksInMode(mode, catalog).filter(function (l) {
      var f = KJ.nodeById(l.from, catalog), t = KJ.nodeById(l.to, catalog);
      if (!f || !t) return false;
      if (f.modes && f.modes.indexOf(mode) === -1) return false;
      if (t.modes && t.modes.indexOf(mode) === -1) return false;
      return true;
    }).length
  };
}
var asis = expectFor('asis'), tobe = expectFor('tobe');
// 10세트 교차 배치(BAT_W1~E3) 포대 사이트는 ECS·MFR 등과 좌표를 공유해 중첩 마커가 된다.
var batterySites = asis.stacked.filter(function (g) {
  return g.some(function (n) { return /^BATTERY_BAT_/.test(n.id); });
});
assert(batterySites.length === 10, '10세트 포대 사이트가 전부 좌표 중첩(카탈로그 자체 검증)');

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
KJ.mapView.render({ dep: 'HANBANDO_LEGACY_NORMAL', mode: 'asis', open: '' }, null);
assert(groups[2].items.length === asis.sites && groups[0].items.length === asis.rings,
  'Leaflet As-Is: 동일 좌표 자산을 합친 ' + asis.sites + '사이트 마커·범위 링 ' + asis.rings);
assert(batterySites.every(function (g) {
  var shooter = g.find(function (n) { return n.category === 'shooter'; });
  return icons.some(function (h) {
    return h.indexOf(shooter.id + ' · ' + g.length + '자산') !== -1 &&
      h.indexOf('node-site-count">' + g.length + '<') !== -1;
  });
}), 'Leaflet 10개 포대 사이트에 공동 자산 중첩 마커');
assert(!attached.has(groups[1]) && groups[1].items.length === asis.links,
  'Leaflet 연결선 ' + asis.links + '개 준비·기본 레이어 OFF');
var summaryRe = new RegExp('HANBANDO_LEGACY_NORMAL.*활성 ' + asis.nodes.length + '노드.*지도 ' +
  asis.sites + '사이트 \\(중첩 ' + asis.stacked.length + '\\)');
assert(summaryRe.test(summaryEl.textContent),
  '지도 범례에 배치 ID·활성 노드·표시 사이트·중첩 사이트 수 표시');
KJ.mapView.setLinksVisible(true);
assert(attached.has(groups[1]), '연결선 토글 ON 시 Leaflet 링크 레이어 활성화');
icons.length = 0;
KJ.mapView.render({ dep: 'HANBANDO_LEGACY_NORMAL', mode: 'tobe', open: '' }, null);
assert(groups[2].items.length === tobe.sites && groups[1].items.length === tobe.links,
  'Leaflet To-Be: 동일 좌표 기준 ' + tobe.sites + '사이트 마커·연결선 ' + tobe.links);
// ADR-061: 폐기된 'legacy' 배치 ID는 기본 고해상도 배치로 정규화되어 렌더된다(크래시 없음).
KJ.mapView.render({ dep: 'legacy', mode: 'asis', open: '' }, null);
assert(groups[2].items.length === asis.sites && summaryRe.test(summaryEl.textContent),
  "구식 dep 'legacy'는 기본 배치로 정규화 렌더(ADR-061)");

// ── SVG fallback 경로 모의 실행 ──
delete global.L;
delete require.cache[require.resolve(mapModule)];
var svgEl = { innerHTML: '' };
global.document = { getElementById: function (id) { return id === 'map' ? svgEl : summaryEl; } };
require(mapModule);
KJ.mapView.init('map', function () {});
KJ.mapView.render({ dep: 'HANBANDO_LEGACY_NORMAL', mode: 'asis', open: '' }, null);
assert((svgEl.innerHTML.match(/class="asset-range-ring"/g) || []).length === asis.rings,
  'SVG fallback 범위 링 ' + asis.rings + '개 표시');
assert(batterySites.every(function (g) {
  var shooter = g.find(function (n) { return n.category === 'shooter'; });
  return svgEl.innerHTML.indexOf('>' + shooter.id + ' · ' + g.length + '자산</text>') !== -1;
}), 'SVG fallback 공동 포대 사이트 라벨 누락 없음');
var stackedCounts = {};
asis.stacked.forEach(function (g) { stackedCounts[g.length] = (stackedCounts[g.length] || 0) + 1; });
Object.keys(stackedCounts).forEach(function (size) {
  assert((svgEl.innerHTML.match(new RegExp('data-site-assets="' + size + '"', 'g')) || []).length === stackedCounts[size],
    'SVG fallback 중첩 ' + size + '자산 사이트 ' + stackedCounts[size] + '개 표시');
});
KJ.mapView.setLinksVisible(true);
assert((svgEl.innerHTML.match(/<line /g) || []).length === asis.links,
  'SVG fallback 연결선 ON: As-Is 링크 ' + asis.links + '개');
KJ.mapView.setRingsVisible(false);
assert(svgEl.innerHTML.indexOf('asset-range-ring') === -1, 'SVG fallback 범위 링 토글 OFF 반영');

console.log(fail === 0 ? '\nOK — 전체 통과' : '\nFAILED — ' + fail + '건');
process.exit(fail ? 1 : 0);
