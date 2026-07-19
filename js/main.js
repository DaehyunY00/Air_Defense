/**
 * K-JAMDS 시뮬레이터 — 부트스트랩·상태 관리
 * 상태 단일원천: 딥링크 해시(#tab=&sc=&mode=&x=&seed=&dur=) ↔ UI 동기화.
 *
 * 탭 구조(개편): [시뮬레이션(지도·실행·결과창)] [분석(9단계 파이프라인+해석)] [Monte Carlo] [근거자료].
 * 체계 모드는 단일 토글 스위치(off=As-Is 분절형, on=To-Be 통합형)로 단순화.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var state = null;
  var analysisCache = null;
  var prevTab = null;
  var intensityTimer = null;

  function modelConfig() {
    var high = state.dep && state.dep !== 'legacy';
    return high ? { deploymentId: state.dep, features: { highResolutionDeployment: true } } : {};
  }

  function analyze() {
    analysisCache = KJ.analyzeScenario(KJ.scenarioById(state.sc), state.mode, state.x, modelConfig());
    return analysisCache;
  }

  function setState(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    KJ.router.apply(state);
    render();
  }

  function render() {
    // 시뮬레이션 탭 이탈 시 애니메이션 루프 정지 (rAF 누수 방지)
    if (prevTab === 'sim' && state.tab !== 'sim' && KJ.simView) {
      KJ.simView.onLeave();
    }
    prevTab = state.tab;

    // 탭 전환
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === state.tab);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + state.tab);
    });

    // 공통 컨트롤 동기화
    document.getElementById('scenario-select').value = state.sc;
    document.getElementById('deployment-select').value = state.dep;
    var depWarning = document.getElementById('deployment-warning');
    var high = state.dep !== 'legacy';
    depWarning.classList.toggle('hidden', !high);
    depWarning.textContent = high
      ? '⚠️ ' + state.dep + ': 원본의 위협종류·아키텍처·C2 생존상태 책임결정, scope WTA, 개념 PIP, 발사대별 탄약·900초 재장전을 실행합니다. 좌표·운동학·센서 상태·PSSEK는 공개자료 기반 개념 근사이며 전술적 절대값으로 해석하면 안 됩니다.'
      : '';
    var sw = document.getElementById('mode-switch');
    sw.checked = state.mode === 'tobe';
    document.querySelector('.mode-switch').classList.toggle('tobe', state.mode === 'tobe');
    var slider = document.getElementById('intensity-slider');
    slider.value = state.x;
    document.getElementById('intensity-value').textContent = '×' + Number(state.x).toFixed(1);

    var analysis = analyze();

    if (state.tab === 'sim') {
      KJ.mapView.invalidateSize();
      KJ.simView.render(state, analysis);
    } else if (state.tab === 'analysis') {
      KJ.panels.renderAnalysis(state, analysis);
    } else if (state.tab === 'mc') {
      KJ.mcPanel.render(state);
    } else if (state.tab === 'data') {
      KJ.panels.renderData(state);
    }

  }

  function bindEvents() {
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { setState({ tab: b.dataset.tab, open: '' }); });
    });
    // 체계 모드: 단일 토글 스위치 (off=As-Is, on=To-Be)
    document.getElementById('mode-switch').addEventListener('change', function (e) {
      setState({ mode: e.target.checked ? 'tobe' : 'asis' });
    });
    document.getElementById('scenario-select').addEventListener('change', function (e) {
      setState({ sc: e.target.value });
    });
    document.getElementById('deployment-select').addEventListener('change', function (e) {
      setState({ dep: e.target.value, open: '' });
    });
    document.getElementById('intensity-slider').addEventListener('input', function (e) {
      var value = parseFloat(e.target.value);
      document.getElementById('intensity-value').textContent = '×' + value.toFixed(1);
      clearTimeout(intensityTimer);
      intensityTimer = setTimeout(function () { setState({ x: value }); }, 120);
    });
    document.getElementById('intensity-slider').addEventListener('change', function (e) {
      clearTimeout(intensityTimer);
      setState({ x: parseFloat(e.target.value) });
    });

    // 시뮬레이션 패널: seed/dur → 상태 반영(+재실행 필요 안내), 실행·결과·속도·링 토글
    document.getElementById('sim-seed').addEventListener('change', function (e) {
      setState({ seed: Math.max(0, Math.floor(parseFloat(e.target.value) || 0)) });
      KJ.simView.notePendingConfig();
    });
    document.getElementById('sim-dur').addEventListener('change', function (e) {
      setState({ dur: Math.min(7200, Math.max(60, Math.floor(parseFloat(e.target.value) || 1800))) });
      KJ.simView.notePendingConfig();
    });
    document.getElementById('sim-run').addEventListener('click', function () {
      KJ.simView.start(state);
    });
    document.getElementById('sim-play').addEventListener('click', function () {
      KJ.simView.togglePlay();
    });
    document.getElementById('sim-results').addEventListener('click', function () {
      KJ.simView.showResults();
    });
    document.getElementById('sim-speed').addEventListener('change', function (e) {
      KJ.simView.setSpeed(e.target.value);
    });
    document.getElementById('toggle-rings').addEventListener('change', function (e) {
      KJ.simView.toggleRings(e.target.checked);
    });
    document.getElementById('toggle-links').addEventListener('change', function (e) {
      KJ.simView.toggleLinks(e.target.checked);
    });

    // 결과 모달 닫기 (배경 클릭 포함)
    document.getElementById('modal-close').addEventListener('click', function () {
      KJ.simView.hideResults();
    });
    document.getElementById('result-modal').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) KJ.simView.hideResults();
    });

    // Monte Carlo 패널 (임계 전환점 버튼은 mc-panel.js가 자체 바인딩)
    document.getElementById('mc-run').addEventListener('click', function () {
      KJ.mcPanel.run(state);
    });

    KJ.router.onChange(function () {
      state = KJ.router.parse();
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    state = KJ.router.parse();

    // 시나리오 셀렉트 옵션 채우기 (KJADS 3대 문제 상황)
    var sel = document.getElementById('scenario-select');
    sel.innerHTML = KJ.SCENARIOS.map(function (s) {
      return '<option value="' + s.id + '">' + s.name + '</option>';
    }).join('');

    var depSel = document.getElementById('deployment-select');
    depSel.innerHTML = '<option value="legacy">기존 대표 배치 (legacy)</option>' +
      KJ.DEPLOYMENT_IDS.map(function (id) {
        return '<option value="' + id + '">' + KJ.deploymentById(id).name + '</option>';
      }).join('');

    KJ.mapView.init('map', function (nodeId) {
      state.open = nodeId;
      KJ.router.apply(state);
    });

    bindEvents();
    render();
  });
})();
