/**
 * K-JAMDS 시뮬레이터 — 공용 위경도→SVG 좌표 투영 (Phase 4)
 * 등장방형(equirectangular) 근사 투영. Leaflet 부재 시 SVG 개념도(map-view.js)와
 * 폐쇄망 대체 SVG 개념도가 이 투영을 사용한다 (Leaflet 부재 시 graceful degradation).
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var BOUNDS = { latMin: 36.3, latMax: 38.5, lonMin: 125.3, lonMax: 130.0 };

  KJ.geo = {
    BOUNDS: BOUNDS,
    /** [lat,lon] → [x,y] (viewBox 기준, W×H 픽셀) */
    project: function (coord, W, H) {
      return [
        (coord[1] - BOUNDS.lonMin) / (BOUNDS.lonMax - BOUNDS.lonMin) * W,
        (BOUNDS.latMax - coord[0]) / (BOUNDS.latMax - BOUNDS.latMin) * H
      ];
    }
  };
})();
