/**
 * K-JAMDS 시뮬레이터 — 딥링크 라우터 (Phase 1)
 *
 * URL 해시 스킴: #tab=<탭ID>&sc=<시나리오ID>&mode=<asis|tobe>&t=<시뮬레이션시각(초)>&open=<노드ID>
 *   - t    : Phase 2 DES 도입 시 사용될 시뮬레이션 시각 (Phase 1에서는 보존만)
 *   - open : 지도에서 팝업을 열 노드 ID
 *   - x    : 위협 강도 배수 (스킴 확장: intensity)
 * 예: #tab=analysis&sc=sc3&mode=asis&x=1.5&open=MCRC
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var DEFAULTS = { tab: 'map', sc: 'sc1', mode: 'asis', t: 0, open: '', x: 1, seed: 12345, dur: 1800 };
  var VALID_TABS = ['map', 'scenario', 'analysis', 'des', 'data'];

  KJ.router = {
    /** 현재 해시를 상태 객체로 파싱 (유효성 검증 포함) */
    parse: function () {
      var state = {};
      Object.keys(DEFAULTS).forEach(function (k) { state[k] = DEFAULTS[k]; });
      var hash = window.location.hash.replace(/^#/, '');
      if (!hash) return state;
      hash.split('&').forEach(function (pair) {
        var idx = pair.indexOf('=');
        if (idx < 0) return;
        var k = decodeURIComponent(pair.slice(0, idx));
        var v = decodeURIComponent(pair.slice(idx + 1));
        if (!(k in DEFAULTS)) return;
        if (k === 't' || k === 'x' || k === 'seed' || k === 'dur') {
          var num = parseFloat(v);
          if (!isNaN(num) && num >= 0) state[k] = num;
        } else {
          state[k] = v;
        }
      });
      if (VALID_TABS.indexOf(state.tab) === -1) state.tab = DEFAULTS.tab;
      if (state.mode !== 'asis' && state.mode !== 'tobe') state.mode = DEFAULTS.mode;
      if (!KJ.SCENARIOS.some(function (s) { return s.id === state.sc; })) state.sc = DEFAULTS.sc;
      state.x = Math.min(3, Math.max(0.5, state.x));
      state.seed = Math.max(0, Math.floor(state.seed)) >>> 0 || DEFAULTS.seed;
      state.dur = Math.min(7200, Math.max(60, Math.floor(state.dur)));
      return state;
    },

    /** 상태 객체를 해시 문자열로 직렬화 (기본값은 생략) */
    serialize: function (state) {
      var parts = [];
      Object.keys(DEFAULTS).forEach(function (k) {
        if (state[k] !== undefined && state[k] !== DEFAULTS[k] && state[k] !== '') {
          parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(state[k]));
        }
      });
      return parts.length ? '#' + parts.join('&') : '#';
    },

    /** 해시 갱신 (히스토리 오염 방지를 위해 replaceState 사용) */
    apply: function (state) {
      var hash = this.serialize(state);
      if (window.location.hash !== hash) {
        history.replaceState(null, '', hash === '#' ? window.location.pathname : hash);
      }
    },

    onChange: function (handler) {
      window.addEventListener('hashchange', handler);
    }
  };
})();
