/**
 * K-JAMDS 시뮬레이터 — Leaflet 지도 뷰 (Phase 1)
 * Leaflet 1.9.4 사용. 모든 좌표는 도시 수준 개념좌표.
 * 병목 하이라이트는 분석 결과(analysis)에서 받아 표시할 뿐, 지도 데이터에 고정하지 않는다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  // 아군 자산 색: 기능별 구분 — 탐지(센서)=파랑, C2(지휘통제)=호박, 요격(무기)=초록.
  // 적 위협은 붉은색 계열(sim-view.js THREAT_COLOR)로 표시해 피아·기능이 즉시 구분된다.
  var CAT_COLOR = { sensor: '#2e6fd8', c2: '#f0a020', shooter: '#3d8b40' };
  var SERVICE_LABEL = { af: '공군', army: '육군', navy: '해군', joint: '합동', usfk: '주한미군' };
  var CAT_SHAPE = { c2: 'shape-square', sensor: 'shape-circle', shooter: 'shape-triangle' };
  var COMM_STYLE = {
    datalink: { color: '#2e6fd8', dashArray: null, weight: 2 },
    kvmf: { color: '#2eb8c9', dashArray: '8 3', weight: 2 }, // 육군 계열 데이터링크(KVMF/ADC2A)
    link16: { color: '#2e6fd8', dashArray: '6 4', weight: 2 },
    voice: { color: '#d32f2f', dashArray: '2 6', weight: 3 },
    broadcast: { color: '#ef6c00', dashArray: '1 5', weight: 1.5 }
  };

  var map = null;
  var markerLayer = null;
  var linkLayer = null;
  var spreadLayer = null; // 저배율 겹침 방지용 표시좌표 리더선(실제 좌표 불변)
  var ringLayer = null;   // 자산 범위 링 (탐지/교전, 개념값)
  var ringsVisible = true;
  var linksVisible = false; // legacy 92~132개 선 과밀 방지 — 사용자가 범례에서 활성화
  var markers = {}; // nodeId -> marker
  var fallback = false; // Leaflet 로드 실패(오프라인/폐쇄망) 시 SVG 개념도로 대체
  var containerId = null;
  var lastState = null, lastAnalysis = null;

  function catalogFor(state) {
    if (!KJ.resolveModelCatalog) return null;
    var high = state && state.dep && state.dep !== 'legacy';
    return KJ.resolveModelCatalog(high ? {
      deploymentId: state.dep,
      features: { highResolutionDeployment: true }
    } : {});
  }

  function expandedLegacyOffset(n) {
    if (!n || !/^(ICC|ECS|MFR|BAT)-(?:CHUNMA-|CHEONGUNG2-)?[WCE]\d$/.test(n.id)) return null;
    if (n.id.indexOf('ICC-') === 0) return [-25, -22];
    if (n.id.indexOf('ECS-') === 0) return [25, -22];
    if (n.id.indexOf('MFR-') === 0) return [-25, 22];
    return [25, 22];
  }

  /** 실제 좌표는 유지하고 저배율 표시점만 픽셀 단위로 분리한다. */
  function leafletDisplayCoord(n) {
    var off = expandedLegacyOffset(n);
    if (!off || !map || !map.getZoom || map.getZoom() >= 11 ||
        !map.latLngToLayerPoint || !map.layerPointToLatLng) return n.coord;
    var zoom = map.getZoom();
    var scale = zoom >= 10 ? 0.45 : (zoom === 9 ? 0.7 : 1);
    var p = map.latLngToLayerPoint(n.coord);
    return map.layerPointToLatLng(L.point(p.x + off[0] * scale, p.y + off[1] * scale));
  }

  function updateAssetSummary(state, catalog, nodes) {
    var el = document.getElementById('map-asset-summary');
    if (!el) return;
    var by = { c2: 0, sensor: 0, shooter: 0 };
    nodes.forEach(function (n) { if (by[n.category] !== undefined) by[n.category]++; });
    var legacy = !state.dep || state.dep === 'legacy';
    el.textContent = (legacy ? 'legacy 확장 배치' : state.dep) + ' · 활성 ' + nodes.length + '노드' +
      ' (C2 ' + by.c2 + ' · 센서 ' + by.sensor + ' · 무기 ' + by.shooter + ')' +
      (legacy ? ' · ICC–ECS–MFR–포대 10세트 포함' : '');
  }

  KJ.mapView = {
    init: function (id, onNodeClick) {
      containerId = id;
      this._onNodeClick = onNodeClick;
      if (typeof L === 'undefined') {
        fallback = true;
        return;
      }
      // 북측 개념 발사권(해주·평강·원산)에서 출발하는 위협 궤적이 보이도록 중심 상향
      map = L.map(id, { zoomControl: true }).setView([37.8, 127.3], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; OpenStreetMap contributors | 좌표는 도시 수준 개념좌표'
      }).addTo(map);
      ringLayer = L.layerGroup().addTo(map);
      spreadLayer = L.layerGroup().addTo(map);
      linkLayer = L.layerGroup();
      if (linksVisible) linkLayer.addTo(map);
      markerLayer = L.layerGroup().addTo(map);
      map.on('zoomend', function () {
        if (lastState) KJ.mapView.render(lastState, lastAnalysis);
      });
    },

    /** 시뮬레이션 뷰(sim-view)가 애니메이션 레이어를 얹기 위한 접근자 */
    getMap: function () { return map; },
    isFallback: function () { return fallback; },

    /** 자산 범위 링 표시 토글 */
    setRingsVisible: function (v) {
      ringsVisible = !!v;
      if (fallback) {
        if (lastState) renderFallbackSvg(lastState, lastAnalysis);
        return;
      }
      if (!map || !ringLayer) return;
      if (ringsVisible) { if (!map.hasLayer(ringLayer)) map.addLayer(ringLayer); }
      else if (map.hasLayer(ringLayer)) map.removeLayer(ringLayer);
    },

    /** C2 보고·협조·명령 연결선 레이어 표시 토글 */
    setLinksVisible: function (v) {
      linksVisible = !!v;
      if (fallback) {
        if (lastState) renderFallbackSvg(lastState, lastAnalysis);
        return;
      }
      if (!map || !linkLayer) return;
      if (linksVisible) { if (!map.hasLayer(linkLayer)) map.addLayer(linkLayer); }
      else if (map.hasLayer(linkLayer)) map.removeLayer(linkLayer);
    },

    /** 모드·분석 결과에 따라 노드/링크 재렌더 */
    render: function (state, analysis) {
      lastState = state; lastAnalysis = analysis;
      if (fallback) { renderFallbackSvg(state, analysis); return; }
      if (!map) return;
      var mode = state.mode;
      var catalog = catalogFor(state);
      var activeNodes = KJ.nodesInMode(mode, catalog);
      updateAssetSummary(state, catalog, activeNodes);
      var levelById = {};
      if (analysis) {
        analysis.nodes.forEach(function (r) { levelById[r.id] = r; });
      }

      // ── 자산 범위 링 (공개자료 기반 개념값: 센서 탐지범위 / 무기 교전범위) ──
      ringLayer.clearLayers();
      activeNodes.forEach(function (n) {
        var km = n.category === 'sensor' ? n.rangeKm
          : (n.category === 'shooter' && n.engage ? n.engage.rangeKm : null);
        if (!km) return;
        var isSensor = n.category === 'sensor';
        // 대형 링의 채움은 SVG 뷰포트 클리핑 사각형 아티팩트를 만들므로 외곽선 위주로 표시
        // 색은 기능별 노드 색과 일치: 탐지범위=파랑 점선, 교전범위=초록
        var ring = L.circle(n.coord, {
          radius: km * 1000,
          color: isSensor ? CAT_COLOR.sensor : CAT_COLOR.shooter,
          weight: 1, dashArray: isSensor ? '4 6' : null,
          fill: !isSensor && km <= 200,
          fillColor: CAT_COLOR.shooter, fillOpacity: 0.05, opacity: 0.4,
          interactive: false
        });
        ringLayer.addLayer(ring);
      });

      // ── 링크 ──
      linkLayer.clearLayers();
      KJ.linksInMode(mode, catalog).forEach(function (l) {
        var from = KJ.nodeById(l.from, catalog), to = KJ.nodeById(l.to, catalog);
        if (!from || !to) return;
        if (from.modes && from.modes.indexOf(mode) === -1) return;
        if (to.modes && to.modes.indexOf(mode) === -1) return;
        var comm = l.comm[mode];
        var style = COMM_STYLE[comm.type] || COMM_STYLE.datalink;
        var line = L.polyline([leafletDisplayCoord(from), leafletDisplayCoord(to)], {
          color: style.color, weight: style.weight,
          dashArray: style.dashArray, opacity: 0.65
        });
        line.bindTooltip(
          from.name + ' → ' + to.name + '<br>' +
          '<b>' + comm.type + '</b> · 지연 ' + comm.delaySec + '초 (' + l.kind + ')' +
          (l.note ? '<br><i>' + l.note + '</i>' : ''),
          { sticky: true }
        );
        linkLayer.addLayer(line);
      });

      // ── 노드 마커 ──
      markerLayer.clearLayers();
      spreadLayer.clearLayers();
      markers = {};
      var self = this;
      activeNodes.forEach(function (n) {
        var displayCoord = leafletDisplayCoord(n);
        if (displayCoord !== n.coord) {
          spreadLayer.addLayer(L.polyline([n.coord, displayCoord], {
            color: '#9fb2c7', weight: 1, dashArray: '2 3', opacity: 0.55,
            interactive: false, className: 'asset-spread-line'
          }));
        }
        var res = levelById[n.id];
        var levelClass = res && (res.level === 'bottleneck' || res.level === 'saturated')
          ? ' node-' + res.level : '';
        var icon = L.divIcon({
          className: 'node-icon',
          html: '<div class="node-mark ' + CAT_SHAPE[n.category] + levelClass +
            '" style="--svc:' + CAT_COLOR[n.category] + '"></div>' +
            '<div class="node-label">' + n.id + '</div>',
          iconSize: [60, 30], iconAnchor: [30, 10]
        });
        var m = L.marker(displayCoord, { icon: icon });
        m.bindPopup(popupHtml(n, res, mode));
        m.on('click', function () {
          if (self._onNodeClick) self._onNodeClick(n.id);
        });
        markerLayer.addLayer(m);
        markers[n.id] = m;
      });

      // 딥링크 open= 복원
      if (state.open && markers[state.open]) {
        markers[state.open].openPopup();
      }
    },

    invalidateSize: function () { if (map) map.invalidateSize(); }
  };

  /** Leaflet 부재 시 SVG 개념도 렌더 (등장방형 근사 투영, 지도 타일 없음) */
  function renderFallbackSvg(state, analysis) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var mode = state.mode;
    var catalog = catalogFor(state);
    var activeNodes = KJ.nodesInMode(mode, catalog);
    updateAssetSummary(state, catalog, activeNodes);
    var levelById = {};
    if (analysis) analysis.nodes.forEach(function (r) { levelById[r.id] = r; });

    var W = 1000, H = 640;
    function px(coord) { return KJ.geo.project(coord, W, H); }
    function displayPx(n) {
      var p = px(n.coord), off = expandedLegacyOffset(n);
      return off ? [p[0] + off[0], p[1] + off[1]] : p;
    }
    var LINK_COLOR = { datalink: '#2e6fd8', kvmf: '#2eb8c9', link16: '#2e6fd8', voice: '#d32f2f', broadcast: '#ef6c00' };
    var LINK_DASH = { datalink: '', kvmf: '8 3', link16: '6 4', voice: '2 6', broadcast: '1 5' };

    var svg = '';
    if (ringsVisible) {
      activeNodes.forEach(function (n) {
        var km = n.category === 'sensor' ? n.rangeKm
          : (n.category === 'shooter' && n.engage ? n.engage.rangeKm : null);
        if (!km) return;
        var p = px(n.coord), latRad = n.coord[0] * Math.PI / 180;
        var rx = km / (111.32 * Math.max(0.2, Math.cos(latRad))) /
          (KJ.geo.BOUNDS.lonMax - KJ.geo.BOUNDS.lonMin) * W;
        var ry = km / 111.32 / (KJ.geo.BOUNDS.latMax - KJ.geo.BOUNDS.latMin) * H;
        var sensor = n.category === 'sensor';
        svg += '<ellipse class="asset-range-ring" cx="' + p[0] + '" cy="' + p[1] +
          '" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' +
          (sensor ? CAT_COLOR.sensor : CAT_COLOR.shooter) + '" stroke-width="1" opacity="0.35"' +
          (sensor ? ' stroke-dasharray="4 6"' : '') + '/>';
      });
    }
    (linksVisible ? KJ.linksInMode(mode, catalog) : []).forEach(function (l) {
      var from = KJ.nodeById(l.from, catalog), to = KJ.nodeById(l.to, catalog);
      if (!from || !to) return;
      if (from.modes && from.modes.indexOf(mode) === -1) return;
      if (to.modes && to.modes.indexOf(mode) === -1) return;
      var comm = l.comm[mode];
      var a = displayPx(from), b = displayPx(to);
      svg += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] +
        '" stroke="' + (LINK_COLOR[comm.type] || '#888') + '" stroke-width="1.5" opacity="0.6"' +
        (LINK_DASH[comm.type] ? ' stroke-dasharray="' + LINK_DASH[comm.type] + '"' : '') + '>' +
        '<title>' + from.name + ' → ' + to.name + ' | ' + comm.type + ' ' + comm.delaySec + 's</title></line>';
    });
    activeNodes.forEach(function (n) {
      var origin = px(n.coord), p = displayPx(n);
      if (expandedLegacyOffset(n)) {
        svg += '<line class="asset-spread-line" x1="' + origin[0] + '" y1="' + origin[1] +
          '" x2="' + p[0] + '" y2="' + p[1] + '"/>';
      }
      var res = levelById[n.id];
      var hot = res && (res.level === 'bottleneck' || res.level === 'saturated');
      var c = CAT_COLOR[n.category];
      if (hot) {
        svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="13" fill="none" stroke="' +
          (res.level === 'saturated' ? '#ff2d1a' : '#e05545') + '" stroke-width="3" opacity="0.8"/>';
      }
      if (n.category === 'c2') {
        svg += '<rect x="' + (p[0] - 6) + '" y="' + (p[1] - 6) + '" width="12" height="12" fill="' + c + '"/>';
      } else if (n.category === 'sensor') {
        svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="6" fill="' + c + '"/>';
      } else {
        svg += '<polygon points="' + p[0] + ',' + (p[1] - 7) + ' ' + (p[0] - 7) + ',' + (p[1] + 6) +
          ' ' + (p[0] + 7) + ',' + (p[1] + 6) + '" fill="' + c + '"/>';
      }
      svg += '<text x="' + p[0] + '" y="' + (p[1] + 18) + '" font-size="9" fill="#cfd8e3" text-anchor="middle">' +
        n.id + '</text>' +
        '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="14" fill="transparent"><title>' + n.name +
        '\n' + n.coordNote + (res && res.lambda > 0 ? '\nλ=' + res.lambda.toFixed(2) +
          '/분, ρ=' + (isFinite(res.rho) ? res.rho.toFixed(2) : '∞') : '') + '</title></circle>';
    });

    el.innerHTML =
      '<div style="padding:6px 10px;font-size:11px;color:#f0a020;background:#2a2410;">' +
      '지도 라이브러리(Leaflet)를 불러올 수 없어 SVG 개념도로 표시 중입니다. 좌표는 도시 수준 개념좌표.</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:calc(100% - 28px);background:#0b0e12">' +
      svg + '</svg>';
  }

  function popupHtml(n, res, mode) {
    var CAT_LABEL = { c2: '지휘통제(C2)', sensor: '탐지(센서)', shooter: '요격(무기)' };
    var h = '<div class="popup"><b>' + n.name + '</b>' +
      '<div class="popup-meta">' + (CAT_LABEL[n.category] || n.category) + ' · ' +
      (SERVICE_LABEL[n.service] || n.service) + ' · ' + n.echelon + '</div>' +
      '<div class="popup-coord">📍 ' + n.coordNote + '</div>' +
      '<p>' + n.role + '</p>';
    var km = n.category === 'sensor' ? n.rangeKm
      : (n.category === 'shooter' && n.engage ? n.engage.rangeKm : null);
    if (km) {
      h += '<div class="popup-coord">📡 ' + (n.category === 'sensor' ? '탐지범위' : '교전범위') +
        ' 약 ' + km + 'km — ' + (n.rangeNote || '공개자료 기반 개념값') + '</div>';
    }
    if (res && res.lambda > 0) {
      h += '<div class="popup-metrics">부하 λ=' + res.lambda.toFixed(2) + '건/분 · ' +
        'ρ=' + (isFinite(res.rho) ? res.rho.toFixed(2) : '∞') +
        (isFinite(res.Wq) ? ' · 평균대기 ' + res.Wq.toFixed(1) + '초' : ' · 포화') +
        '</div>';
    }
    if (n.category === 'shooter') {
      var no = Object.keys(n.canEngage).filter(function (k) { return !n.canEngage[k]; });
      if (no.length) {
        h += '<div class="popup-constraint">교전 불가: ' + no.map(function (k) {
          return KJ.threatType(k) ? KJ.threatType(k).name : k;
        }).join(', ') + '</div>';
      }
    }
    return h + '</div>';
  }
})();
