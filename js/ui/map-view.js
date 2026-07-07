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
  var SERVICE_LABEL = { af: '공군', army: '육군', navy: '해군', joint: '합동' };
  var CAT_SHAPE = { c2: 'shape-square', sensor: 'shape-circle', shooter: 'shape-triangle' };
  var COMM_STYLE = {
    datalink: { color: '#2e6fd8', dashArray: null, weight: 2 },
    link16: { color: '#2e6fd8', dashArray: '6 4', weight: 2 },
    voice: { color: '#d32f2f', dashArray: '2 6', weight: 3 },
    broadcast: { color: '#ef6c00', dashArray: '1 5', weight: 1.5 }
  };

  var map = null;
  var markerLayer = null;
  var linkLayer = null;
  var ringLayer = null;   // 자산 범위 링 (탐지/교전, 개념값)
  var ringsVisible = true;
  var markers = {}; // nodeId -> marker
  var fallback = false; // Leaflet 로드 실패(오프라인/폐쇄망) 시 SVG 개념도로 대체
  var containerId = null;

  KJ.mapView = {
    init: function (id, onNodeClick) {
      containerId = id;
      this._onNodeClick = onNodeClick;
      if (typeof L === 'undefined') {
        fallback = true;
        return;
      }
      map = L.map(id, { zoomControl: true }).setView([37.3, 127.3], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; OpenStreetMap contributors | 좌표는 도시 수준 개념좌표'
      }).addTo(map);
      ringLayer = L.layerGroup().addTo(map);
      linkLayer = L.layerGroup().addTo(map);
      markerLayer = L.layerGroup().addTo(map);
    },

    /** 시뮬레이션 뷰(sim-view)가 애니메이션 레이어를 얹기 위한 접근자 */
    getMap: function () { return map; },
    isFallback: function () { return fallback; },

    /** 자산 범위 링 표시 토글 */
    setRingsVisible: function (v) {
      ringsVisible = !!v;
      if (!map || !ringLayer) return;
      if (ringsVisible) { if (!map.hasLayer(ringLayer)) map.addLayer(ringLayer); }
      else if (map.hasLayer(ringLayer)) map.removeLayer(ringLayer);
    },

    /** 모드·분석 결과에 따라 노드/링크 재렌더 */
    render: function (state, analysis) {
      if (fallback) { renderFallbackSvg(state, analysis); return; }
      if (!map) return;
      var mode = state.mode;
      var levelById = {};
      if (analysis) {
        analysis.nodes.forEach(function (r) { levelById[r.id] = r; });
      }

      // ── 자산 범위 링 (공개자료 기반 개념값: 센서 탐지범위 / 무기 교전범위) ──
      ringLayer.clearLayers();
      KJ.nodesInMode(mode).forEach(function (n) {
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
      KJ.linksInMode(mode).forEach(function (l) {
        var from = KJ.nodeById(l.from), to = KJ.nodeById(l.to);
        if (!from || !to) return;
        if (from.modes && from.modes.indexOf(mode) === -1) return;
        if (to.modes && to.modes.indexOf(mode) === -1) return;
        var comm = l.comm[mode];
        var style = COMM_STYLE[comm.type] || COMM_STYLE.datalink;
        var line = L.polyline([from.coord, to.coord], {
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
      markers = {};
      var self = this;
      KJ.nodesInMode(mode).forEach(function (n) {
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
        var m = L.marker(n.coord, { icon: icon });
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
    var levelById = {};
    if (analysis) analysis.nodes.forEach(function (r) { levelById[r.id] = r; });

    var W = 1000, H = 640;
    function px(coord) { return KJ.geo.project(coord, W, H); }
    var LINK_COLOR = { datalink: '#2e6fd8', link16: '#2e6fd8', voice: '#d32f2f', broadcast: '#ef6c00' };
    var LINK_DASH = { datalink: '', link16: '6 4', voice: '2 6', broadcast: '1 5' };

    var svg = '';
    KJ.linksInMode(mode).forEach(function (l) {
      var from = KJ.nodeById(l.from), to = KJ.nodeById(l.to);
      if (!from || !to) return;
      if (from.modes && from.modes.indexOf(mode) === -1) return;
      if (to.modes && to.modes.indexOf(mode) === -1) return;
      var comm = l.comm[mode];
      var a = px(from.coord), b = px(to.coord);
      svg += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] +
        '" stroke="' + (LINK_COLOR[comm.type] || '#888') + '" stroke-width="1.5" opacity="0.6"' +
        (LINK_DASH[comm.type] ? ' stroke-dasharray="' + LINK_DASH[comm.type] + '"' : '') + '>' +
        '<title>' + from.name + ' → ' + to.name + ' | ' + comm.type + ' ' + comm.delaySec + 's</title></line>';
    });
    KJ.nodesInMode(mode).forEach(function (n) {
      var p = px(n.coord);
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
