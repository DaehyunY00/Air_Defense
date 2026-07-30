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
    // ADR-065: 승인 계선·표적 산포·남부 축선은 기본 ON — 상태가 '0'일 때만 끈다.
    features.approvalChain = state.appr !== '0';
    features.threatTargetDispersion = state.disp !== '0';
    features.southernAxes = state.south !== '0';
    features.linkSemanticsV2 = state.linkv2 !== '0'; // ADR-066
    features.sensorReportParity = state.rp !== '0'; // ADR-067
    features.unifiedEngagementState = state.cop !== '0'; // ADR-068
    features.sawtoothFreshness = state.saw !== '0'; // ADR-069·072
    features.selfDefenseFire = state.sdf !== '0'; // ADR-071·072
    features.engageOnRemote = state.eor === '1'; // ADR-070: 기본 꺼짐 실험 옵션
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
    depWarning.classList.remove('hidden');
    // 배치별 경고문(물리 실행 안내·ADR-054 이식 배치·ADR-060 범위)은 사용자 요청으로 삭제했다.
    // 개념값 고지만 남긴다 — 상단 #disclaimer가 실제 작전자료 아님·ADR-060 범위·제약을
    // 상시 표출하므로(제약 어서션 c가 고정) 고지 의무는 그대로 충족된다.
    depWarning.textContent = '좌표와 수치는 공개자료 기반 정책연구용 개념값이며 전술적 절대값이 아닙니다.';
    var apprBox = document.getElementById('approval-chain-toggle');
    if (apprBox) apprBox.checked = state.appr === '1'; // ADR-062
    var dispBox = document.getElementById('target-dispersion-toggle');
    if (dispBox) dispBox.checked = state.disp === '1'; // ADR-063
    var southBox = document.getElementById('southern-axes-toggle');
    if (southBox) southBox.checked = state.south === '1'; // ADR-064
    var linkBox = document.getElementById('link-semantics-toggle');
    if (linkBox) linkBox.checked = state.linkv2 === '1'; // ADR-066
    var rpBox = document.getElementById('sensor-parity-toggle');
    if (rpBox) rpBox.checked = state.rp === '1'; // ADR-067
    var copBox = document.getElementById('engagement-cop-toggle');
    if (copBox) copBox.checked = state.cop === '1'; // ADR-068
    var sawBox = document.getElementById('sawtooth-toggle');
    if (sawBox) sawBox.checked = state.saw === '1'; // ADR-069·072
    var sdfBox = document.getElementById('self-defense-toggle');
    if (sdfBox) sdfBox.checked = state.sdf === '1'; // ADR-071·072
    var eorBox = document.getElementById('engage-on-remote-toggle');
    if (eorBox) eorBox.checked = state.eor === '1'; // ADR-070: 기본 꺼짐 실험 옵션
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
    // ADR-064: 남부 종심 축선 토글 — 위협 집합 자체가 늘어나므로 실행 조건 변경으로 취급.
    var southToggle = document.getElementById('southern-axes-toggle');
    if (southToggle) {
      southToggle.addEventListener('change', function (e) {
        setState({ south: e.target.checked ? '1' : '0', open: '' });
        if (KJ.simView && KJ.simView.notePendingConfig) KJ.simView.notePendingConfig();
      });
    }
    // ADR-066: 링크 의미론 토글 — 링크 지연 집합이 바뀌므로 실행 조건 변경으로 취급한다.
    // 지도 연결선 툴팁의 지연값도 달라지므로 open은 유지하되 카탈로그는 재해석된다.
    var linkToggle = document.getElementById('link-semantics-toggle');
    if (linkToggle) {
      linkToggle.addEventListener('change', function (e) {
        setState({ linkv2: e.target.checked ? '1' : '0' });
        if (KJ.simView && KJ.simView.notePendingConfig) KJ.simView.notePendingConfig();
      });
    }
    // ADR-067: 레이더→C2 보고 주기 대칭 토글 — To-Be 보고 링크 지연이 바뀌므로 실행 조건 변경.
    var rpToggle = document.getElementById('sensor-parity-toggle');
    if (rpToggle) {
      rpToggle.addEventListener('change', function (e) {
        setState({ rp: e.target.checked ? '1' : '0' });
        if (KJ.simView && KJ.simView.notePendingConfig) KJ.simView.notePendingConfig();
      });
    }
    // ADR-068: 교전현황 공유(양방향 COP) 토글 — To-Be 중복교전 해소 경로. 실행 조건 변경.
    var copToggle = document.getElementById('engagement-cop-toggle');
    if (copToggle) {
      copToggle.addEventListener('change', function (e) {
        setState({ cop: e.target.checked ? '1' : '0' });
        if (KJ.simView && KJ.simView.notePendingConfig) KJ.simView.notePendingConfig();
      });
    }
    // ADR-069·072: 톱니 신선도 토글 — 보고 링크 지연 해석이 바뀌므로 실행 조건 변경.
    var sawToggle = document.getElementById('sawtooth-toggle');
    if (sawToggle) {
      sawToggle.addEventListener('change', function (e) {
        setState({ saw: e.target.checked ? '1' : '0' });
        if (KJ.simView && KJ.simView.notePendingConfig) KJ.simView.notePendingConfig();
      });
    }
    // ADR-071·072: 자위권 발사 토글 — 발사 경로가 추가되므로 실행 조건 변경.
    var sdfToggle = document.getElementById('self-defense-toggle');
    if (sdfToggle) {
      sdfToggle.addEventListener('change', function (e) {
        setState({ sdf: e.target.checked ? '1' : '0' });
        if (KJ.simView && KJ.simView.notePendingConfig) KJ.simView.notePendingConfig();
      });
    }
    // ADR-070: 원격 교전(engage-on-remote) — 기본 꺼짐 실험 옵션. 켜면 To-Be 격추율이 오르지만
    // 비용 지표(교환비·고가유도탄 보존율)가 폭주하는 대비를 보여주는 것이 이 토글의 용도다.
    var eorToggle = document.getElementById('engage-on-remote-toggle');
    if (eorToggle) {
      eorToggle.addEventListener('change', function (e) {
        setState({ eor: e.target.checked ? '1' : '0' });
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
