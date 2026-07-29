/**
 * K-JAMDS 시뮬레이터 — 딥링크 라우터 (Phase 1, Phase 4에서 t= 실제 활용)
 *
 * URL 해시 스킴: #tab=<탭ID>&sc=<시나리오ID>&mode=<asis|tobe>&dep=<배치ID>&appr=<0|1>&disp=<0|1>&south=<0|1>&linkv2=<0|1>&t=<재생시각(초)>&open=<노드ID>&x=<강도>&seed=&dur=
 *   (ADR-061: 구 dep=legacy·fid= 파라미터는 기본값으로 정규화 / ADR-065: appr·disp·south는 기본 1, '0'으로 해제
 *    / ADR-066: linkv2도 기본 1, '0'으로 해제)
 *   - t    : [playback 탭] 재생 스크러버 시각(초). 다른 탭에서는 보존만 됨
 *   - open : 지도에서 팝업을 열 노드 ID
 *   - x    : 위협 강도 배수
 *   - seed/dur : DES·MC 탭 재현용 시드·시뮬레이션 시간
 * 예: #tab=playback&sc=sc3&mode=asis&x=1.5&t=240
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  // ADR-061: dep 기본값은 주 분석 배치, fid는 하위호환 파싱만 남기고 항상 iads-c2로 고정된다.
  // ADR-065: appr(승인 계선)·disp(표적 산포)·south(남부 축선)는 **기본 ON**이다('0'으로 해제).
  // ADR-066: linkv2(링크 의미론 codex 정합)도 **기본 ON** — 반증용 해제 경로로 linkv2=0을 신설.
  var DEFAULTS = { tab: 'sim', sc: 'sc1', mode: 'asis', dep: 'HANBANDO_LEGACY_NORMAL', fid: 'iads-c2', appr: '1', disp: '1', south: '1', linkv2: '1', t: 0, open: '', x: 1, seed: 12345, dur: 1800 };
  var VALID_TABS = ['sim', 'analysis', 'mc', 'data'];
  // 구 딥링크 호환: 지도/시나리오/DES/재생 탭은 통합 [시뮬레이션] 탭으로 흡수
  var LEGACY_TAB = { map: 'sim', scenario: 'sim', des: 'sim', playback: 'sim' };

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
      if (LEGACY_TAB[state.tab]) state.tab = LEGACY_TAB[state.tab];
      if (VALID_TABS.indexOf(state.tab) === -1) state.tab = DEFAULTS.tab;
      if (state.mode !== 'asis' && state.mode !== 'tobe') state.mode = DEFAULTS.mode;
      state.fid = 'iads-c2'; // 구 딥링크 fid=compat 하위호환 — 항상 iads-c2로 정규화(ADR-061)
      // ADR-065: 기본 ON이므로 **명시적 '0'만 해제**로 읽는다(알 수 없는 값은 기본값 유지).
      state.appr = (state.appr === '0' || state.appr === false) ? '0' : '1';
      state.disp = (state.disp === '0' || state.disp === false) ? '0' : '1';
      state.south = (state.south === '0' || state.south === false) ? '0' : '1';
      state.linkv2 = (state.linkv2 === '0' || state.linkv2 === false) ? '0' : '1'; // ADR-066
      if (!KJ.DEPLOYMENT_IDS || KJ.DEPLOYMENT_IDS.indexOf(state.dep) === -1) {
        state.dep = DEFAULTS.dep; // 구 dep=legacy·HANBANDO_MINI_* 딥링크 폴백
      }
      if (!KJ.SCENARIOS.some(function (s) { return s.id === state.sc; })) state.sc = DEFAULTS.sc;
      state.x = Math.min(3, Math.max(0.5, state.x));
      // seed 0은 유효한 값이므로 보존한다 (과거 `>>> 0 || DEFAULTS.seed`는 0을 12345로 붕괴시켰음).
      state.seed = Math.max(0, Math.floor(state.seed)) >>> 0;
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
