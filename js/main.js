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
    // ADR-061: 충실도 1종(iads-c2)·고해상도 6배치만 존재한다.
    // ADR-062: 승인 계선(ADR-058)은 화면에서 켤 수 있어야 한다 — 끈 채로 두면 ⑥⑦ 승인·협조
    // 지표가 영구 0이 되어 "승인 병목 없음"으로 오독된다. 기본값은 OFF(종전과 bit-exact).
    var features = { highResolutionDeployment: true };
    if (state.appr === '1') features.approvalChain = true;
    if (state.disp === '1') features.threatTargetDispersion = true; // ADR-063
    return { deploymentId: state.dep, features: features, modelFidelity: 'iads-c2' };
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
    depWarning.classList.remove('hidden'); // ADR-061: 고해상도 배치만 존재 — 경고 상시 표출
    // LEGACY_HIRES는 legacy 자산 배치를 고해상도 타입으로 이식한 계열이라, 제외 자산군 때문에
    // legacy(compat)와 절대값을 직접 비교할 수 없다는 경고를 따로 붙인다(ADR-054).
    var legacyHires = state.dep.indexOf('HANBANDO_LEGACY_') === 0;
    depWarning.textContent = '⚠️ ' + state.dep +
      ': IADS_C2식 모듈 Worker·이벤트 큐·SNR/RCS/수평선/센서상태 물리를 실행합니다.' +
      (legacyHires
        ? ' legacy 자산 편성을 고해상도 타입으로 이식한 배치입니다(ADR-054).'
        : '') +
      ' 본 모델은 지상배치 방공 C2에 한정하며 요격기·해상 자산을 포함하지 않습니다(ADR-060).' +
      ' 좌표와 수치는 공개자료 기반 정책연구용 개념값이며 전술적 절대값이 아닙니다.';
    var apprBox = document.getElementById('approval-chain-toggle');
    if (apprBox) apprBox.checked = state.appr === '1'; // ADR-062
    var dispBox = document.getElementById('target-dispersion-toggle');
    if (dispBox) dispBox.checked = state.disp === '1'; // ADR-063
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
    // ADR-062: 승인 계선 토글 — 실행 조건이 바뀌므로 분석 탭 DES 캐시도 무효화된다(설정 키에 포함).
    var apprToggle = document.getElementById('approval-chain-toggle');
    if (apprToggle) {
      apprToggle.addEventListener('change', function (e) {
        setState({ appr: e.target.checked ? '1' : '0' });
        if (KJ.simView && KJ.simView.notePendingConfig) KJ.simView.notePendingConfig();
      });
    }
    // ADR-063: 표적 산포 토글 — 착탄점 집합이 바뀌므로 실행 조건 변경으로 취급한다.
    var dispToggle = document.getElementById('target-dispersion-toggle');
    if (dispToggle) {
      dispToggle.addEventListener('change', function (e) {
        setState({ disp: e.target.checked ? '1' : '0' });
        if (KJ.simView && KJ.simView.notePendingConfig) KJ.simView.notePendingConfig();
      });
    }
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

  // 실행 제어는 독립적으로 먼저 바인딩한다. 모듈 로더와 지도 초기화 중 일부가
  // 실패하더라도 시뮬레이션 버튼·지도 토글의 기본 조작 계약을 잃지 않게 한다.
  function bindSimulationEvents() {
    document.getElementById('sim-seed').addEventListener('change', function (e) {
      setState({ seed: Math.max(0, Math.floor(parseFloat(e.target.value) || 0)) });
      KJ.simView.notePendingConfig();
    });
    document.getElementById('sim-dur').addEventListener('change', function (e) {
      setState({ dur: Math.min(7200, Math.max(60, Math.floor(parseFloat(e.target.value) || 1800))) });
      KJ.simView.notePendingConfig();
    });
    document.getElementById('sim-run').addEventListener('click', function () {
      try {
        KJ.simView.start(state);
      } catch (err) {
        document.getElementById('sim-status').textContent = 'DES 실행 초기화 실패: ' + err.message;
      }
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
    document.getElementById('sim-run').dataset.eventsBound = 'true';
  }

  document.addEventListener('DOMContentLoaded', function () {
    state = KJ.router.parse();

    // 시나리오 셀렉트 옵션 채우기 (KJADS 3대 문제 상황)
    var sel = document.getElementById('scenario-select');
    sel.innerHTML = KJ.SCENARIOS.map(function (s) {
      return '<option value="' + s.id + '">' + s.name + '</option>';
    }).join('');

    var depSel = document.getElementById('deployment-select');
    depSel.innerHTML = KJ.DEPLOYMENT_IDS.map(function (id) {
        return '<option value="' + id + '">' + KJ.deploymentById(id).name + '</option>';
      }).join('');

    bindSimulationEvents();

    KJ.mapView.init('map', function (nodeId) {
      state.open = nodeId;
      KJ.router.apply(state);
    });

    bindEvents();
    render();
  });
})();
