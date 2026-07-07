/**
 * K-JAMDS 시뮬레이터 — 부트스트랩·상태 관리 (Phase 1)
 * 상태 단일원천: 딥링크 해시(#tab=&sc=&mode=&t=&open=&x=) ↔ UI 동기화.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var state = null;
  var analysisCache = null;

  function analyze() {
    analysisCache = KJ.analyzeScenario(KJ.scenarioById(state.sc), state.mode, state.x);
    return analysisCache;
  }

  function setState(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    KJ.router.apply(state);
    render();
  }

  function render() {
    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === state.tab);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + state.tab);
    });

    // 공통 컨트롤 동기화
    document.getElementById('scenario-select').value = state.sc;
    document.querySelectorAll('.mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });
    var slider = document.getElementById('intensity-slider');
    slider.value = state.x;
    document.getElementById('intensity-value').textContent = '×' + Number(state.x).toFixed(1);

    var analysis = analyze();

    if (state.tab === 'map') {
      KJ.mapView.invalidateSize();
      KJ.mapView.render(state, analysis);
    } else if (state.tab === 'scenario') {
      KJ.panels.renderScenario(state);
    } else if (state.tab === 'analysis') {
      KJ.panels.renderAnalysis(state, analysis);
    } else if (state.tab === 'data') {
      KJ.panels.renderData();
    }

    // 헤더 요약 (전 탭 공통): 도출된 병목 개수
    var n = analysis.bottlenecks.length;
    var summary = document.getElementById('header-bn-count');
    summary.textContent = n > 0 ? '도출된 병목 ' + n + '건' : '병목 없음';
    summary.className = n > 0 ? 'bn-count has-bn' : 'bn-count';
  }

  function bindEvents() {
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { setState({ tab: b.dataset.tab, open: '' }); });
    });
    document.querySelectorAll('.mode-btn').forEach(function (b) {
      b.addEventListener('click', function () { setState({ mode: b.dataset.mode }); });
    });
    document.getElementById('scenario-select').addEventListener('change', function (e) {
      setState({ sc: e.target.value });
    });
    document.getElementById('intensity-slider').addEventListener('input', function (e) {
      setState({ x: parseFloat(e.target.value) });
    });
    document.getElementById('scenario-cards') &&
      document.getElementById('scenario-cards').addEventListener('click', function (e) {
        var card = e.target.closest('.scenario-card');
        if (card) setState({ sc: card.dataset.sc });
      });
    KJ.router.onChange(function () {
      state = KJ.router.parse();
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    state = KJ.router.parse();

    // 시나리오 셀렉트 옵션 채우기
    var sel = document.getElementById('scenario-select');
    sel.innerHTML = KJ.SCENARIOS.map(function (s) {
      return '<option value="' + s.id + '">' + s.name + '</option>';
    }).join('');

    KJ.mapView.init('map', function (nodeId) {
      state.open = nodeId;
      KJ.router.apply(state);
    });

    bindEvents();
    render();
  });
})();
