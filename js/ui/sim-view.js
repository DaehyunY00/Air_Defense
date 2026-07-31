/**
 * K-JAMDS 시뮬레이터 — 통합 시뮬레이션 뷰 (실행 → 지도 시각화 → 결과창)
 *
 * 사용 흐름(요구 반영):
   *  1) [시뮬레이션 시작] → DES(trace)를 실행하고, 동일 seed 반대 모드 DES와
   *     Monte Carlo(양 모드)를 Web Worker에서 수행한다. Worker 불가 환경은 자동 MC를 생략한다.
 *  2) 실행 결과의 위협궤적·노드 재고를 Leaflet 지도 위에 애니메이션으로 재생한다
 *     (위협 = canvas circleMarker, 노드 링 = 재고/용량 비율).
 *  3) 재생 종료(또는 [결과 보기]) 시 결과 모달을 띄워 정량 분석(요약·As-Is↔To-Be 비교·
 *     병목·요격 실패 사유·단계별 funnel·노드 관측통계·MC 신뢰구간·중복교전 위험)을 제공한다.
 *
 * 폐쇄망(Leaflet 부재) 시: 애니메이션은 생략하고 시뮬레이션·결과 모달만 제공(우아한 축소).
 * 모든 좌표·궤적은 도시 수준 개념좌표(axes.js)다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  // 적 위협 = 붉은색 계열 통일 (아군 자산의 기능별 색과 피아 구분).
  // 저속·저위협일수록 밝은 적색, 탄도탄·방사포일수록 진한 적색.
  var THREAT_COLOR = {
    uav_small: '#ff8a7a', ac_low: '#ff7261', heli: '#ff7261',
    fighter: '#f4442e', cruise: '#e01e1e', srbm: '#b3001b', mrl_large: '#d90429'
  };
  // 요격 실패(구 '누수') 세부 사유 라벨·분류는 엔진 정본 KJ.LEAK_TAXONOMY(Phase C)를 사용.
  var LEVEL_BADGE = {
    idle: '<span class="badge badge-idle">유휴</span>',
    normal: '<span class="badge badge-ok">정상</span>',
    warn: '<span class="badge badge-warn">주의 ρ≥0.7</span>',
    bottleneck: '<span class="badge badge-bad">병목 ρ≥0.9</span>',
    saturated: '<span class="badge badge-crit">포화(드롭)</span>'
  };
  var KIND_ICON = { node: '⬛', link: '🔗', gap: '⚠️' };

  /** trace 원시 단계명 → 9단계 파이프라인 라벨 (항적 로그용) */
  function stageLabel(name) {
    if (name === '생성') return '① 침투 개시';
    if (name === '탐지') return '② 탐지';
    if (name.indexOf('C2도착:') === 0) return '③ 항적보고 → ' + name.slice(5);
    if (name.indexOf('C2처리완료:') === 0) return '④⑤ 식별·평가·WTA (' + name.slice(7) + ')';
    if (name.indexOf('항적정보접수:') === 0) return '② ' + name;
    if (name.indexOf('항적융합:') === 0) return '③ ' + name;
    if (name.indexOf('위협우선순위:') === 0 || name.indexOf('위협판단·표적할당준비:') === 0) return '④⑤ ' + name;
    if (name.indexOf('사수선정·표적할당:') === 0) return '⑤ ' + name;
    if (name.indexOf('자체교전승인:') === 0) return '⑥⑦ ' + name;
    if (name.indexOf('교전현황') === 0 || name.indexOf('사격직전중복해소:') === 0 ||
        name.indexOf('교전중복해소:') === 0) return '⑦ ' + name;
    if (name === '융합경유') return '③ JAMDC2 융합 경유';
    if (name === '융합처리완료') return '④⑤ 융합·AI식별·WTA (JAMDC2)';
    if (name.indexOf('협조개시:') === 0) return '⑥⑦ 결심·교전협조 (' + name.slice(5) + ')';
    if (name.indexOf('승인완료:') === 0) return '⑥ 교전승인 (' + name.slice(5) + ')';
    if (name.indexOf('권한위임:') === 0) return '⑦ 동적 권한위임 → 분권 교전 (' + name.slice(5) + ' 포화)';
    if (name.indexOf('감독승인개시:') === 0) return '⑥ 감독하 자동교전 승인 (' + name.slice(7) + ')';
    if (name.indexOf('교전명령#') === 0) return '⑧ ' + name;
    if (name.indexOf('격추성공#') === 0) return '⑨ BDA: 격추 ✔';
    if (name.indexOf('교전실패#') === 0) return '⑨ BDA: ' + name;
    if (name.indexOf('누수:') === 0) return '✖ 요격 실패: ' + leakLabel(name.slice(3));
    // 종전에 원문 그대로 노출되던 엔진 이벤트명(SENSOR_DETECTED:… 등)을 우리말로 옮긴다.
    // ⚠️ 등록(register)은 **보고서용**이다 — 원문 식별자처럼 날것도 아니고 구어체도 아닌,
    // 기존 단계 라벨(①침투 개시·②탐지·④⑤식별·평가)과 같은 결의 용어를 쓴다.
    // 이 함수는 지도 위 항적 로그와 공유하므로 양쪽 표기가 함께 정렬된다.
    if (name.indexOf('책임C2:') === 0) return '① 책임 C2 지정: ' + name.slice(5);
    if (name.indexOf('SENSOR_DETECTED:') === 0) return '② 센서 탐지: ' + name.slice(16);
    if (name.indexOf('SENSOR_TRACKED:') === 0) return '② 추적 유지: ' + name.slice(15);
    if (name.indexOf('SENSOR_FIRE_CONTROL:') === 0) return '② 사격통제 추적(FC): ' + name.slice(20);
    if (name.indexOf('SENSOR_FC_DEGRADED:') === 0) return '② 사격통제 강등: ' + name.slice(19);
    if (name.indexOf('SENSOR_TRACK_LOST:') === 0) return '② 추적 상실: ' + name.slice(18);
    if (name.indexOf('식별확정:') === 0) return '④ 식별 확정: ' + name.slice(5);
    if (name.indexOf('자위권발사:') === 0) return '⑧ 자위권 발사: ' + name.slice(6);
    if (name.indexOf('발사:') === 0) return '⑧ 발사: ' + name.slice(3);
    if (name.indexOf('BDA:HIT:') === 0) return '⑨ BDA: 명중 — ' + name.slice(8);
    if (name.indexOf('BDA:MISS:') === 0) return '⑨ BDA: 빗나감 — ' + name.slice(9);
    if (name.indexOf('항적폐기:') === 0) return '✖ 항적 폐기: ' + name.slice(5);
    if (name.indexOf('교전현황드롭') === 0) return '⑦ 교전현황 전달 실패';
    return name;
  }

  /** 누수 원인코드 → 사람이 읽는 라벨. 위 stageLabel(지도 위 위협 항적 로그)이 쓴다.
   *  ⚠️ 결과 모달용 헬퍼가 아니다 — 모달을 축소할 때 함께 지웠다가 항적 로그가 깨졌다. */
  function leakLabel(code) { return KJ.leakTaxonomy(code).label; }

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function pct(x) { return (x * 100).toFixed(0) + '%'; }
  function rateOf(count, total) { return total > 0 ? count / total : 0; }

  /** nodeSeries(t 오름차순)에서 t 이하 최신 재고 n (이진탐색) */
  function countAt(series, t) {
    if (!series || series.length === 0) return 0;
    var lo = 0, hi = series.length - 1, ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (series[mid].t <= t) { ans = series[mid].n; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  // ── 모듈 상태 ──
  var run = null;   // { cfg, res, elapsedMs, execution, threats, nodeMeta, modalRendered }
  var anim = {
    playing: false, t: 0, speed: 30, lastTs: null, raf: null, done: false,
    lastRenderWall: 0, lastRingWall: 0
  };
  var layers = null; // { canvasRenderer, threatMarkers:{}, nodeRings:{}, group }
  var currentState = null;
  var computeGeneration = 0;
  var inputTouched = { seed: false, dur: false };
  var tlog = { els: {}, lastUpdate: 0 }; // 위협 항적 로그 패널 상태 (실행당 재구성)

  function modelConfig(cfg) {
    // ADR-061: 충실도 1종(iads-c2)·고해상도 배치만 존재한다.
    // ADR-062: 승인 계선(ADR-058) 토글 — 기본 OFF.
    var features = { highResolutionDeployment: true };
    // ADR-065: 승인 계선·표적 산포·남부 축선은 기본 ON — 상태가 '0'일 때만 끈다.
    features.approvalChain = cfg && cfg.appr !== '0';
    features.threatTargetDispersion = cfg && cfg.disp !== '0';
    features.southernAxes = cfg && cfg.south !== '0';
    features.linkSemanticsV2 = !cfg || cfg.linkv2 !== '0'; // ADR-066
    features.sensorReportParity = !cfg || cfg.rp !== '0'; // ADR-067
    features.unifiedEngagementState = !cfg || cfg.cop !== '0'; // ADR-068
    features.sawtoothFreshness = !cfg || cfg.saw !== '0'; // ADR-069·072
    features.selfDefenseFire = !cfg || cfg.sdf !== '0'; // ADR-071·072
    features.engageOnRemote = !!cfg && cfg.eor === '1'; // ADR-070: 기본 꺼짐 실험 옵션
    return { deploymentId: cfg && cfg.dep, features: features, modelFidelity: 'iads-c2' };
  }

  function runCatalog() {
    return KJ.resolveModelCatalog ? KJ.resolveModelCatalog(modelConfig(run && run.cfg)) : null;
  }

  function contextLabel(cfg) {
    return KJ.scenarioById(cfg.sc).name + ' · ' +
      (cfg.mode === 'asis' ? 'As-Is 분절형' : 'To-Be 통합형') +
      ' · ' + cfg.dep + ' · IADS_C2 물리' + (cfg.appr === '1' ? ' · 승인계선 ON' : '') + (cfg.disp === '1' ? ' · 표적산포 ON' : '') + (cfg.south === '1' ? ' · 남부축선 ON' : '') +
      // ADR-066: 기본 ON이라 해제했을 때만 표시한다 — 구 링크 의미론 실행임을 놓치지 않게.
      (cfg.linkv2 === '0' ? ' · 구 링크의미론(OFF)' : '') + (cfg.rp === '0' ? ' · 보고주기 비대칭(OFF)' : '') + (cfg.cop === '0' ? ' · 교전현황 공유 OFF' : '') + (cfg.saw === '0' ? ' · 톱니 OFF' : '') + (cfg.sdf === '0' ? ' · 자위권 OFF' : '') + (cfg.eor === '1' ? ' · 원격 교전 ON(실험)' : '') +
      ' · 강도 ×' + Number(cfg.x).toFixed(1) + ' · seed ' + cfg.seed;
  }

  KJ.simView = {
    /** 탭 진입/상태 변경 시 호출 — 시나리오 요약·지도 렌더 동기화 */
    render: function (state, analysis) {
      currentState = state;
      var sc = KJ.scenarioById(state.sc);
      el('sim-scenario-blurb').innerHTML =
        '<b>' + esc(sc.name) + '</b>' +
        (sc.problem ? ' <span class="sim-problem">' + esc(sc.problem) + '</span>' : '') +
        '<div class="sim-desc">' + esc(sc.description) + '</div>' +
        '<div class="basis">근거: ' + esc(sc.basis) + '</div>';
      if (!inputTouched.seed) el('sim-seed').value = state.seed;
      if (!inputTouched.dur) el('sim-dur').value = state.dur;
      KJ.mapView.render(state, analysis);
      if (!run) {
        setStatus('시나리오·모드·강도를 고른 뒤 [시뮬레이션 시작]을 누르세요.');
      } else if (!anim.done && !anim.playing && layers &&
                 el('result-modal').classList.contains('hidden')) {
        // 탭 이탈로 일시정지된 재생을 복귀 시 자동 재개
        play();
      }
    },

    /** ▶ 시뮬레이션 시작: DES(trace) + 반대모드 + 백그라운드 MC → 지도 애니메이션 */
    start: function (state) {
      var self = this;
      this.stop(); // 이전 실행 정리
      var generation = ++computeGeneration;
      var seed = Math.max(0, Math.floor(parseFloat(el('sim-seed').value) || 0));
      var dur = Math.min(7200, Math.max(60, Math.floor(parseFloat(el('sim-dur').value) || 1800)));
      var cfg = { sc: state.sc, mode: state.mode, dep: state.dep, fid: 'iads-c2',
        appr: state.appr === '1' ? '1' : '0', disp: state.disp === '1' ? '1' : '0',
        south: state.south === '1' ? '1' : '0',
        linkv2: state.linkv2 === '0' ? '0' : '1', // ADR-066: 기본 ON
        rp: state.rp === '0' ? '0' : '1', // ADR-067: 기본 ON
        cop: state.cop === '0' ? '0' : '1', // ADR-068: 기본 ON
        saw: state.saw === '0' ? '0' : '1', // ADR-069·072: 기본 ON
        sdf: state.sdf === '0' ? '0' : '1', // ADR-071·072: 기본 ON
        eor: state.eor === '1' ? '1' : '0', // ADR-070: 기본 OFF
        x: state.x, seed: seed, dur: dur };
      var btn = el('sim-run');
      btn.disabled = true; btn.textContent = '⏳ DES 실행 중...';
      setStatus('DES 실행 중 (trace 모드)...');
      setComputeNotice('checking');

      var highCfg = modelConfig(cfg);
      // ADR-073/074 결심 감사 계측을 켠다 — 결과 화면의 「결심 순간 해부」가 쓰는 재료다.
      // ⚠️ 켜도 결과는 한 발도 안 바뀐다: OFF/ON bit-exact·RNG 소비 횟수 동일이 두 ADR에서
      //    증명돼 있고, ADR-076로 관측이 실제 경로를 흔들던 경로(캐시 순서 의존)까지 제거됐다.
      //    난수를 쓰지 않는 순수 관측이므로 기본 실행에 상시 켜 둔다.
      var auditFeatures = Object.assign({}, highCfg.features, {
        decisionAudit: true, shadowEval: true, windowMargin: true
      });
      var computeCfg = {
        scenarioId: cfg.sc, mode: cfg.mode, intensity: cfg.x,
        seed: cfg.seed, endTimeSec: cfg.dur, trace: true, traceCap: 300,
        deploymentId: highCfg.deploymentId, features: auditFeatures,
        modelFidelity: highCfg.modelFidelity
      };
      var t0 = now();
      // tracePair=true — 결과 화면의 As-Is↔To-Be 항적 병렬 대조가 **양쪽 trace**를 요구한다.
      // 반대 모드 DES는 desPair가 어차피 돌리므로 추가 비용은 trace 수집분뿐이다.
      // 중복교전 히트맵(includeHeat)은 소비처가 없어 요청하지 않는다.
      KJ.compute.run('desPair', { cfg: computeCfg, tracePair: true }, function (stage) {
        if (generation !== computeGeneration) return;
        setStatus(stage === 'comparison-des' ? '비교 체계 DES 계산 중…' : '현재 체계 DES 계산 중…');
      }).then(function (pair) {
        if (generation !== computeGeneration) return;
        var res = pair.current;
        var elapsed = now() - t0;

        _nodeIdx = null; _linkIdx = null;  // 배치·플래그가 바뀌면 색인도 다시 만든다
        // 결심 감사 이벤트를 위협 id로 묶어 둔다(좌=As-Is·우=To-Be 고정).
        var auditsCur = pair.currentAudits || [], auditsOth = pair.otherAudits || [];
        run = {
          cfg: cfg, res: res, resOther: pair.other, otherMode: pair.otherMode,
          audits: cfg.mode === 'asis'
            ? { asis: groupAudits(auditsCur), tobe: groupAudits(auditsOth) }
            : { asis: groupAudits(auditsOth), tobe: groupAudits(auditsCur) },
          elapsedMs: elapsed, execution: pair.execution,
          nodeMeta: {}, threats: buildThreats(res),
          modalRendered: false
        };
        setComputeNotice(pair.execution, cfg.dep !== 'legacy');
        res.nodes.forEach(function (n) { run.nodeMeta[n.id] = n; });

        // 병목 하이라이트를 이번 DES 실행 결과로 갱신 (해석 근사 아님)
        KJ.mapView.render(currentState, { nodes: res.nodes });

        // 자동 Monte Carlo는 결과 모달의 신뢰구간 섹션 전용이었다. 그 섹션을 내리면서
        // 함께 걷어낸다 — 아무도 보지 않는 30~200복제를 백그라운드로 돌릴 이유가 없다.
        // 통계가 필요하면 [Monte Carlo] 탭이 자체 러너로 수행한다.
        setStatus('DES 완료 — 결과 보기에서 시간·노드 활성화를 확인하세요.');

        el('sim-results').disabled = false;
        btn.disabled = false; btn.textContent = '↺ 다시 실행';

        buildThreatLog();

        if (KJ.mapView.isFallback()) {
          // 폐쇄망: 애니메이션 생략, 로그는 전체 타임라인으로 정적 표시 후 결과 모달
          updateThreatLog(cfg.dur);
          setStatus('지도 라이브러리 부재 — 애니메이션 생략, 결과만 표시합니다.');
          self.showResults();
          return;
        }
        buildLayers(cfg.mode);
        anim.t = 0; anim.done = false;
        anim.speed = parseFloat(el('sim-speed').value) || 30;
        var playBtn = el('sim-play');
        playBtn.disabled = false;
        setStatus('위협궤적 재생 중 (' + run.threats.length + '건 추적, ×' + anim.speed + ')');
        play();
      }).catch(function (err) {
        if (generation !== computeGeneration) return;
        btn.disabled = false; btn.textContent = '▶ 시뮬레이션 시작';
        setStatus('DES 계산 실패: ' + err.message);
      });
    },

    /** ⏯ 재생/일시멈춤 토글 (재생 종료 후에는 처음부터 다시 재생) */
    togglePlay: function () {
      if (!run || KJ.mapView.isFallback()) return;
      if (anim.playing) {
        pause();
        setStatus('일시멈춤 — ' + fmtTime(anim.t) + ' 시점');
      } else {
        if (anim.done) { anim.t = 0; anim.done = false; } // 다시 재생
        setStatus('재생 중 (×' + anim.speed + ')');
        play();
      }
    },

    /** 📊 결과 보기 (재생 중이어도 즉시) */
    showResults: function () {
      if (!run) return;
      pause();
      el('result-modal').classList.remove('hidden');
      // 내용이 실행 직후 확정되는 값(시간·노드 활성화)뿐이라 한 번만 그리면 된다.
      if (!run.modalRendered) renderModal();
    },

    hideResults: function () {
      el('result-modal').classList.add('hidden');
      // 재생이 끝나지 않았으면 이어서 재생
      if (run && !anim.done && !KJ.mapView.isFallback()) play();
    },

    setSpeed: function (v) { anim.speed = parseFloat(v) || 30; },

    /**
     * seed/시간 입력 변경 시 안내 — 실행은 [▶/↺] 버튼을 눌러야 시작되는 설계이므로,
     * 이미 실행 결과가 떠 있는 상태에서 값을 바꾸면 "재실행 필요"를 명시해
     * "바꿔도 반영이 안 된다"는 오해를 방지한다.
     */
    notePendingConfig: function () {
      if (run) {
        setStatus('⚙ seed/시간 변경됨 — [↺ 다시 실행]을 눌러야 새 설정이 반영됩니다.');
      } else {
        setStatus('설정 입력됨 — [▶ 시뮬레이션 시작]을 누르면 이 seed/시간으로 실행됩니다.');
      }
    },

    toggleRings: function (v) { KJ.mapView.setRingsVisible(v); },
    toggleLinks: function (v) { KJ.mapView.setLinksVisible(v); },

    /** 탭 이탈·재실행 시 정리 (rAF 누수 방지) */
    stop: function () {
      computeGeneration++;
      if (KJ.compute) KJ.compute.terminate();
      pause();
      if (layers && layers.group) {
        var map = KJ.mapView.getMap();
        if (map && map.hasLayer(layers.group)) map.removeLayer(layers.group);
      }
      layers = null;
      tlog.els = {};
      var panel = el('threat-log');
      if (panel) panel.classList.add('hidden');
      var body = el('tlog-body');
      if (body) body.innerHTML = '';
      var playBtn = el('sim-play');
      if (playBtn) { playBtn.disabled = true; playBtn.textContent = '⏸ 일시멈춤'; }
      setComputeNotice('idle');
    },

    onLeave: function () { pause(); },

    /** [분석] 탭 항적 병렬 로그와 공유하는 표시 규약 — 단계 라벨·위협 색을 한 곳에서 정의한다
     *  (분석 탭은 자체 desPair 결과를 쓰므로 실행 결과 자체는 공유하지 않는다). */
    stageLabel: stageLabel,
    threatColor: function (type) { return THREAT_COLOR[type] || '#f00'; }
  };

  function setStatus(msg) { var s = el('sim-status'); if (s) s.textContent = msg; }
  function setComputeNotice(mode, highResolution) {
    var notice = el('sim-compute-mode');
    if (!notice) return;
    notice.className = 'sim-compute-mode';
    if (mode === 'web-worker') {
      notice.classList.add('worker');
      notice.textContent = '계산 모드: Web Worker — 지도·결과 UI와 분리 실행';
    } else if (mode === 'main-thread-fallback') {
      notice.classList.add('fallback');
      notice.textContent = '계산 모드: 메인 스레드 폴백 — 자동 MC 생략. FULL은 ./scripts/serve.sh 실행 권장';
    } else if (mode === 'checking') {
      notice.textContent = '계산 실행 경로 확인 중…';
    } else {
      notice.textContent = highResolution ? '고해상도 배치: Worker 실행 권장' : '계산 모드: 실행 전';
    }
  }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // ── trace → 애니메이션용 위협 목록 ──
  // 동시 다발(burst)처럼 같은 축선·같은 시각에 발생한 위협이 정확히 겹쳐 보이지 않도록,
  // 위협 ID 기반 결정론적 수직 오프셋(±0.06° 이내 개념 산개)을 부여한다.
  // Phase A 정밀화: 4개 축선에 여러 위협 유형이 뭉쳐 보이는 문제를, 유형 인덱스 기반
  // 결정론적 진입 오프셋(seed 무관, ID·유형에서 파생)으로 추가 분산한다 — 개념 산개 표시일 뿐
  // 실제 발사원점·경로가 아니다(burst 산개 로직과 동일 방식).
  function buildThreats(res) {
    var typeKeys = Object.keys(KJ.THREAT_TYPES);
    return (res.threatTraces || []).map(function (tr, idx) {
      var tt = KJ.threatType(tr.type);
      var lane = (idx % 7) - 3; // -3..3
      var typeLane = typeKeys.indexOf(tr.type) - (typeKeys.length - 1) / 2; // 유형별 고정 산개
      return {
        id: tr.id, type: tr.type, axis: tr.axis, typeName: tt.name,
        spawnT: tr.spawnT, exitT: tr.exitT, outcome: tr.outcome, dwellSec: tt.dwellSec,
        stages: tr.stages,
        offLat: lane * 0.02 + typeLane * 0.008, offLon: lane * 0.015 + typeLane * 0.006
      };
    });
  }

  // ── Leaflet 애니메이션 레이어 (canvas 렌더러 — 규모별 적응형 프레임률) ──
  function buildLayers(mode) {
    var map = KJ.mapView.getMap();
    if (!map) return;
    var renderer = L.canvas({ padding: 0.3 });
    var group = L.layerGroup().addTo(map);
    layers = { renderer: renderer, group: group, threatMarkers: {}, nodeRings: {} };

    // 노드 재고 링 (재고/용량 비율에 따라 굵기·색 갱신)
    Object.keys(run.nodeMeta).forEach(function (id) {
      var n = KJ.nodeById(id, runCatalog());
      if (!n) return;
      var ring = L.circleMarker(n.coord, {
        renderer: renderer, radius: 14, fill: false,
        color: '#e05545', weight: 0, opacity: 0.9, interactive: false
      });
      group.addLayer(ring);
      layers.nodeRings[id] = ring;
    });

    // 위협 마커 (실행당 1회 생성, 프레임마다 위치·투명도만 갱신)
    run.threats.forEach(function (th) {
      var entry = KJ.axisPosition(th.axis, 0, th.target); // ADR-063: 산포 ON이면 위협별 착탄점
      if (!entry) return;
      var m = L.circleMarker(entry, {
        renderer: renderer, radius: 5,
        color: '#0008', weight: 1,
        fillColor: THREAT_COLOR[th.type] || '#f00', fillOpacity: 0, opacity: 0
      });
      m.bindTooltip(th.typeName + ' (' + th.axis + ') ' + th.id + ' — 클릭: 항적 로그');
      m.on('click', function () { toggleLogRow(th.id, true); }); // 마커 클릭 → 로그 펼침
      group.addLayer(m);
      layers.threatMarkers[th.id] = m;
    });
  }

  // ── 재생 루프 ──
  // 표시 탭에서는 rAF(60fps), 탭이 숨겨지면 rAF가 정지하므로 타이머로 대체해
  // 벽시계 dt 기준으로 계속 진행한다(복귀 시 자연스럽게 이어짐).
  function play() {
    if (!run) return;
    anim.playing = true; anim.lastTs = null;
    anim.lastRenderWall = 0; anim.lastRingWall = 0;
    syncPlayBtn();
    loop();
  }
  function pause() {
    anim.playing = false;
    if (anim.raf) { cancelAnimationFrame(anim.raf); anim.raf = null; }
    if (anim.timer) { clearTimeout(anim.timer); anim.timer = null; }
    syncPlayBtn();
  }
  function syncPlayBtn() {
    var b = el('sim-play');
    if (!b) return;
    b.textContent = anim.playing ? '⏸ 일시멈춤' : (anim.done ? '↻ 다시 재생' : '▶ 재생');
  }
  function scheduleNext() {
    if (typeof document !== 'undefined' && document.hidden) {
      anim.timer = setTimeout(function () { loop(); }, 120);
    } else {
      anim.raf = requestAnimationFrame(loop);
    }
  }
  function loop(ts) {
    if (!anim.playing) return;
    if (anim.lastTs == null) anim.lastTs = ts || now();
    var cur = ts || now();
    var dt = (cur - anim.lastTs) / 1000;
    anim.lastTs = cur;
    anim.t += dt * anim.speed;
    if (anim.t >= run.cfg.dur) {
      anim.t = run.cfg.dur;
      renderFrame(anim.t, cur, true);
      updateThreatLog(anim.t);
      pause();
      anim.done = true;
      syncPlayBtn();
      setStatus('재생 종료 — 결과창을 표시합니다.');
      KJ.simView.showResults(); // 요구: 시뮬레이션 종료 시 결과창
      return;
    }
    // FULL 배치에서는 수백 개 Leaflet 객체를 매 rAF마다 갱신하지 않는다. 시간 진행은
    // rAF로 유지하되 화면 그리기만 10fps, legacy/LEGACY_HIRES는 30fps로 제한한다.
    var objectCount = run.threats.length + Object.keys(run.nodeMeta).length;
    var renderEveryMs = objectCount > 160 ? 100 : 33;
    if (cur - anim.lastRenderWall >= renderEveryMs) {
      anim.lastRenderWall = cur;
      renderFrame(anim.t, cur, false);
    }
    scheduleNext();
  }

  var FADE_SEC = 6;
  function renderFrame(t, wallNow, force) {
    if (!run || !layers) return;
    // 위협 위치·가시성
    run.threats.forEach(function (th) {
      var m = layers.threatMarkers[th.id];
      if (!m) return;
      if (t < th.spawnT) {
        if (m._kjStyleKey !== 'hidden') {
          m.setStyle({ opacity: 0, fillOpacity: 0 });
          m._kjStyleKey = 'hidden';
        }
        return;
      }
      if (th.exitT != null && t >= th.exitT + FADE_SEC) {
        if (m._kjStyleKey !== 'hidden') {
          m.setStyle({ opacity: 0, fillOpacity: 0 });
          m._kjStyleKey = 'hidden';
        }
        return;
      }
      var endT = th.exitT != null ? th.exitT : Math.min(t, th.spawnT + th.dwellSec);
      var clampT = Math.min(t, endT);
      var progress = (clampT - th.spawnT) / th.dwellSec;
      var pos = KJ.axisPosition(th.axis, progress, th.target); // ADR-063
      if (pos) m.setLatLng([pos[0] + th.offLat, pos[1] + th.offLon]);
      var op = 1;
      if (th.exitT != null && t > th.exitT) op = Math.max(0, 1 - (t - th.exitT) / FADE_SEC);
      var killed = th.outcome === 'killed' && th.exitT != null && t >= th.exitT;
      var styleKey = (killed ? 'k:' : 'a:') + op.toFixed(2);
      if (m._kjStyleKey !== styleKey) {
        m.setStyle({
          opacity: op * 0.9, fillOpacity: op * 0.9,
          color: killed ? '#7dd982' : '#0008', weight: killed ? 2 : 1
        });
        m._kjStyleKey = styleKey;
      }
    });
    // 노드 재고는 위치보다 천천히 변하므로 4Hz로 제한하고, 시각 등급이 바뀔 때만
    // Leaflet setStyle을 호출한다.
    if (force || wallNow - anim.lastRingWall >= 250) {
      anim.lastRingWall = wallNow;
      var series = run.res.nodeSeries || {};
      Object.keys(run.nodeMeta).forEach(function (id) {
        var ring = layers.nodeRings[id];
        if (!ring) return;
        var meta = run.nodeMeta[id];
        var n = countAt(series[id], t);
        var ratio = meta.K > 0 ? n / meta.K : 0;
        var level = ratio >= 0.9 ? 'critical' : (ratio >= 0.7 ? 'warn' : (n > 0 ? 'busy' : 'idle'));
        if (ring._kjLevel === level) return;
        ring._kjLevel = level;
        ring.setStyle({
          weight: level === 'critical' ? 4 : (level === 'warn' ? 2.5 : (level === 'busy' ? 1 : 0)),
          color: level === 'critical' ? '#ff2d1a' : (level === 'warn' ? '#e05545' : '#f0a020')
        });
      });
    }
    // 진행 표시
    el('sim-clock').textContent = fmtTime(t) + ' / ' + fmtTime(run.cfg.dur);
    el('sim-progress-bar').style.width = (t / run.cfg.dur * 100).toFixed(1) + '%';
    // 항적 로그 갱신 (스로틀 250ms — 300행 텍스트 갱신을 매 프레임 하지 않음)
    var wall = now();
    if (wall - tlog.lastUpdate > 250) {
      tlog.lastUpdate = wall;
      updateThreatLog(t);
    }
  }

  // ── 위협 항적 로그 (지도 좌상단 패널) ──────────────────────────────────────
  // 실행당 1회 DOM을 만들고(항적별 행 + 접힌 단계 목록), 재생 중에는 텍스트/클래스만
  // 갱신한다. 행 헤더 클릭(또는 지도 마커 클릭)으로 해당 항적의 9단계 로그를 펼친다.

  function buildThreatLog() {
    var panel = el('threat-log'), body = el('tlog-body');
    if (!panel || !body) return;
    tlog.els = {};
    var frag = document.createDocumentFragment();
    run.threats.forEach(function (th) {
      var row = document.createElement('div');
      row.className = 'tlog-row';
      row.style.display = 'none'; // spawn 전에는 숨김
      var hdr = document.createElement('div');
      hdr.className = 'tlog-hdr';
      hdr.innerHTML =
        '<span class="tlog-dot" style="background:' + (THREAT_COLOR[th.type] || '#f00') + '"></span>' +
        '<span class="tlog-name">' + esc(th.id) + ' <i>(' + esc(th.axis) + ')</i></span>' +
        '<span class="tlog-stage">—</span>' +
        '<span class="tlog-badge badge badge-idle">진행중</span>';
      var list = document.createElement('ul');
      list.className = 'tlog-stages';
      list.style.display = 'none';
      var lis = th.stages.map(function (s) {
        var li = document.createElement('li');
        li.textContent = fmtTime(s.t) + ' · ' + stageLabel(s.name);
        li.className = 'tlog-future';
        list.appendChild(li);
        return { el: li, t: s.t };
      });
      hdr.addEventListener('click', function () { toggleLogRow(th.id); });
      row.appendChild(hdr); row.appendChild(list);
      frag.appendChild(row);
      tlog.els[th.id] = {
        row: row, list: list, lis: lis, th: th,
        stageEl: hdr.querySelector('.tlog-stage'),
        badgeEl: hdr.querySelector('.tlog-badge'),
        lastIdx: -1, lastBadge: ''
      };
    });
    body.innerHTML = '';
    body.appendChild(frag);
    panel.classList.remove('hidden');
    var title = el('tlog-title');
    if (title) title.textContent = '🛰 위협 항적 로그 (추적 ' + run.threats.length + '건' +
      (run.res.traceTruncated ? ', 상한 절삭' : '') + ')';
  }

  /** 항적 로그 행 펼침/접힘. force=true면 무조건 펼치고 스크롤 */
  function toggleLogRow(tid, force) {
    var e = tlog.els[tid];
    if (!e) return;
    var open = e.list.style.display !== 'none';
    if (force && open) { e.row.scrollIntoView({ block: 'nearest' }); return; }
    e.list.style.display = open && !force ? 'none' : 'block';
    e.row.classList.toggle('open', e.list.style.display !== 'none');
    if (force) e.row.scrollIntoView({ block: 'nearest' });
    refreshLogRow(e, anim.t);
  }

  /** 시각 t 기준 해당 행의 현재 단계·뱃지·단계목록 상태 갱신 */
  function refreshLogRow(e, t) {
    var th = e.th;
    // 현재 단계: t 이하 마지막 단계
    var idx = -1;
    for (var i = 0; i < th.stages.length; i++) {
      if (th.stages[i].t <= t) idx = i; else break;
    }
    if (idx !== e.lastIdx) {
      e.lastIdx = idx;
      e.stageEl.textContent = idx >= 0 ? stageLabel(th.stages[idx].name) : '—';
      // 펼쳐진 목록의 진행 표시
      if (e.list.style.display !== 'none') {
        e.lis.forEach(function (li, j) {
          li.el.className = j < idx ? 'tlog-done' : (j === idx ? 'tlog-current' : 'tlog-future');
        });
      }
    } else if (e.list.style.display !== 'none' && e.lis.length && e.lis[Math.max(idx, 0)]) {
      // 방금 펼친 경우 클래스 재적용
      e.lis.forEach(function (li, j) {
        li.el.className = j < idx ? 'tlog-done' : (j === idx ? 'tlog-current' : 'tlog-future');
      });
    }
    // 뱃지: 진행중 / 격추 / 요격 실패
    var badge = '진행중', cls = 'badge badge-idle';
    if (th.exitT != null && t >= th.exitT) {
      if (th.outcome === 'killed') { badge = '격추'; cls = 'badge badge-ok'; }
      else { badge = '요격 실패'; cls = 'badge badge-bad'; }
    }
    if (badge !== e.lastBadge) {
      e.lastBadge = badge;
      e.badgeEl.textContent = badge;
      e.badgeEl.className = 'tlog-badge ' + cls;
    }
  }

  function updateThreatLog(t) {
    if (!run) return;
    var visible = 0;
    Object.keys(tlog.els).forEach(function (tid) {
      var e = tlog.els[tid];
      var show = t >= e.th.spawnT;
      var disp = show ? '' : 'none';
      if (e.row.style.display !== disp) e.row.style.display = disp;
      if (!show) return;
      visible++;
      refreshLogRow(e, t);
    });
  }

  // ── 결과 모달 ──
  // 이 화면은 **일부러 최소한만** 보여준다. 종전에는 격추·누수·병목·MC 신뢰구간 등
  // 정량 지표를 한꺼번에 띄웠는데, 그 수치들은 분석 계층을 전면 개편하는 동안
  // 근거가 흔들릴 수 있어 화면에서 내렸다. 남긴 것은 **해석이 필요 없는 사실** 둘뿐이다:
  //   ① 시간 — 시뮬레이션 안에서 흐른 시간과 계산에 걸린 실제 시간
  //   ② 노드 활성화 — 어떤 장비가 실제로 한 번이라도 일을 했는가
  // 문구는 초등학생도 읽을 수 있는 말로 쓴다(전문용어는 괄호로 원어를 덧붙인다).

  /** 초 → "N분 N초" (사람이 읽는 말). 0초면 "0초". */
  function plainDuration(sec) {
    var s = Math.max(0, Math.round(sec));
    var m = Math.floor(s / 60), r = s % 60;
    if (m === 0) return r + '초';
    if (r === 0) return m + '분';
    return m + '분 ' + r + '초';
  }

  /** 노드 종류를 쉬운 우리말로. */
  function plainCategory(cat) {
    if (cat === 'c2') return '지휘소';
    if (cat === 'shooter') return '요격 부대';
    if (cat === 'sensor') return '레이더';
    return cat;
  }

  // ── As-Is ↔ To-Be 항적 병렬 대조 ──
  // CRN(공통난수) 설계상 두 모드의 위협 집단(ID·발생시각·축선)은 **같다**. 따라서 같은 ID끼리
  // 1:1로 놓을 수 있고, **판정이 갈린 항적이 곧 지휘 구조가 만든 차이**다.
  // 색은 보조 수단일 뿐이며 아이콘·글자로도 같은 정보를 준다(색만으로 뜻을 싣지 않는다).

  /** trace.outcome → 판정 객체. 엔진 정본: 'killed' | 'leaked:<코드>' | null(관측 종료 미해결).
   *  ⚠️ 라벨 등록은 **보고서용**이다(ADR 원문·실험보고서와 같은 용어를 쓴다). */
  function outcomeOf(tr) {
    if (!tr) return { kind: 'absent', label: '해당 없음' };
    if (tr.outcome === 'killed') return { kind: 'killed', label: '격추' };
    if (typeof tr.outcome === 'string' && tr.outcome.indexOf('leaked:') === 0) {
      var code = tr.outcome.slice(7);
      var meta = KJ.leakTaxonomy(code);
      return { kind: 'leaked', code: code, label: meta.label, structural: !!meta.structural };
    }
    return { kind: 'open', label: '미해결(관측 종료)' };
  }
  function outcomeBadge(o) {
    if (o.kind === 'killed') return '<span class="badge badge-ok">격추</span>';
    if (o.kind === 'leaked') return '<span class="badge badge-bad">' + esc(o.label) + '</span>';
    if (o.kind === 'open') return '<span class="badge badge-idle">미해결</span>';
    return '<span class="badge badge-idle">—</span>';
  }

  /** 같은 위협에 대한 As-Is↔To-Be 판정 변화 분류. */
  function divergenceOf(oa, ob) {
    if (oa.kind === ob.kind) {
      return oa.kind === 'killed' ? { key: 'same', label: '동일 (양측 격추)', cls: 'dv-same' }
        : oa.kind === 'leaked' ? (oa.code === ob.code
          ? { key: 'same', label: '동일 (양측 실패)', cls: 'dv-same' }
          : { key: 'same', label: '양측 실패 (사유 변화)', cls: 'dv-same' })
        : { key: 'same', label: '동일 (미해결)', cls: 'dv-same' };
    }
    if (ob.kind === 'killed') return { key: 'gain', label: '개선 (To-Be 격추)', cls: 'dv-gain' };
    if (oa.kind === 'killed') return { key: 'loss', label: '악화 (To-Be 실패)', cls: 'dv-loss' };
    return { key: 'other', label: '변화 (미해결 ↔ 실패)', cls: 'dv-other' };
  }

  /**
   * 단계 이름의 **종류 키**. 엔진의 단계명은 `책임C2:KAMD_OPS(global)`·`교전명령#3`처럼
   * 뒤에 노드 id·일련번호가 붙는데, 그 부분은 모드마다 당연히 다르다(As-Is는 KAMD_OPS,
   * To-Be는 IAOC). 전체 문자열로 맞대면 **거의 모든 줄이 "다름"으로 칠해져 색이 뜻을 잃는다.**
   * 그래서 `:`·`#` 앞의 종류만 키로 삼아 같은 단계끼리 맞대고, 내용 차이는 따로 표시한다.
   */
  function stageKey(name) { return String(name).split(':')[0].split('#')[0]; }

  /**
   * 두 항적의 단계 목록을 맞대어 줄 단위로 차이를 표시한다. 같은 종류의 단계를 등장
   * 순서(k번째)로 짝지어 네 가지로 분류한다:
   *   - 짝 없음            → 'only'  ＋ 이쪽에서만 일어난 일
   *   - 짝 있고 내용 다름  → 'diff'  ◆ 같은 단계인데 맡은 곳이 다름
   *   - 짝 있고 시각차 ≥1초 → 'shift' ⏱ 같은 일인데 시점이 다름 (Δ 표기)
   *   - 그 외              → 'same'  회색
   * 위협 하나당 단계 수가 수십 개라 단순 O(n) 매칭으로 충분하다.
   */
  function stageIndex(tr) {
    var map = {};
    ((tr && tr.stages) || []).forEach(function (s) {
      var k = stageKey(s.name);
      (map[k] = map[k] || []).push(s);
    });
    return map;
  }
  function diffStageList(tr, otherTr) {
    if (!tr) return '<ul class="alog-stages"><li class="bn-none">이 모드에 대응 항적 없음</li></ul>';
    if (!tr.stages || !tr.stages.length) return '<ul class="alog-stages"><li class="bn-none">기록된 단계 없음</li></ul>';
    var otherMap = stageIndex(otherTr), seen = {};
    return '<ul class="alog-stages">' + tr.stages.map(function (s) {
      var key = stageKey(s.name);
      var k = (seen[key] = (seen[key] || 0) + 1) - 1;
      var mate = otherMap[key] && otherMap[key].length > k ? otherMap[key][k] : null;
      var cls = 'sd-same', mark = '', tip = '';
      if (!mate) {
        cls = 'sd-only';
        mark = '<span class="sd-mark">＋</span>';
        tip = '해당 계통에만 존재하는 단계';
      } else if (mate.name !== s.name) {
        cls = 'sd-diff';
        mark = '<span class="sd-mark">◆</span>';
        tip = '담당 노드 상이 — 반대 계통: ' + stageLabel(mate.name);
      } else if (Math.abs(s.t - mate.t) >= 1) {
        var dt = s.t - mate.t;
        cls = 'sd-shift';
        mark = '<span class="sd-mark">⏱</span><span class="sd-dt">' +
          (dt > 0 ? '+' : '−') + Math.abs(dt).toFixed(0) + '초</span>';
        tip = '동일 단계, 시각 차이 (반대 계통 ' + fmtTime(mate.t) + ')';
      }
      return '<li class="' + cls + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' +
        '<span class="alog-t">' + fmtTime(s.t) + '</span> ' +
        esc(stageLabel(s.name)) + mark + '</li>';
    }).join('') + '</ul>';
  }

  // ── 참여 노드 타임라인 ──
  // 「분절된 구조 vs 통합 구조」를 **모양으로** 보여준다. As-Is는 승인·협조 홉을 순차로 밟아
  // 막대가 계단처럼 길게 늘어지고, To-Be는 같은 일이 겹쳐 일어나 짧게 끝난다.
  // ⚠️ 이 그림이 뒷받침하는 주장은 **시간**이다. "통합하면 더 많은 사수를 고려한다"는 주장은
  //    주축에서 성립하지 않는다(ADR-073 §발견 — 주축 사수 풀은 두 구조가 동일). 그래서
  //    축(scope)을 읽어 아래 축별 주석을 붙인다 — 반증을 숨기지 않는 것이 이 화면의 조건이다.

  var _nodeIdx = null;
  /**
   * 단계 이름에서 노드를 찾기 위한 색인.
   * ⚠️ 엔진은 노드를 **두 가지 방식**으로 적는다: 센서·포대는 노드 id 그대로
   * (`SENSOR_ACR_E`·`BATTERY_BAT_E1`), C2는 **typeId**(`KAMD_OPS`·`IAOC`·`MCRC`·`ICC`).
   * 그래서 두 키를 모두 색인한다 — id만 보면 지휘소 행이 통째로 빠진다(실제로 그랬다).
   * typeId가 여러 노드에 걸리면(ICC W1·W2) 개별 노드를 특정할 수 없으므로 typeId를
   * 한 행으로 묶고 라벨도 typeId로 둔다 — 없는 정보를 지어내지 않는다.
   */
  function nodeIndex() {
    if (_nodeIdx) return _nodeIdx;
    var cat = runCatalog();
    var byType = {};
    _nodeIdx = { map: {}, keys: [] };
    ((cat && cat.nodes) || []).forEach(function (n) {
      _nodeIdx.map[n.id] = { key: n.id, name: n.name || n.id, category: n.category };
      if (n.typeId) (byType[n.typeId] = byType[n.typeId] || []).push(n);
    });
    Object.keys(byType).forEach(function (tid) {
      if (_nodeIdx.map[tid]) return;                 // id와 충돌하면 id 우선
      var group = byType[tid];
      _nodeIdx.map[tid] = {
        key: tid, category: group[0].category,
        name: group.length === 1 ? (group[0].name || tid) : tid
      };
    });
    // 긴 키부터 찾아야 부분일치 오검출을 막는다(BAT_E1 ⊂ BATTERY_BAT_E1).
    _nodeIdx.keys = Object.keys(_nodeIdx.map).sort(function (x, y) { return y.length - x.length; });
    return _nodeIdx;
  }

  /** 단계 이름에 등장하는 노드 키들(중복 제거). 긴 키부터 소거해 부분일치를 피한다. */
  function nodesInStage(name) {
    var idx = nodeIndex(), rest = String(name), found = [];
    for (var i = 0; i < idx.keys.length; i++) {
      var k = idx.keys[i];
      if (rest.indexOf(k) !== -1) { found.push(k); rest = rest.split(k).join(' '); }
    }
    return found;
  }

  /** 한 항적의 노드 참여 구간·주요 사건·책임 C2(scope)를 뽑는다. */
  function participationOf(tr) {
    if (!tr || !tr.stages || !tr.stages.length) return null;
    var idx = nodeIndex(), byNode = {}, marks = [], c2 = null;
    tr.stages.forEach(function (s) {
      var kind = s.name.indexOf('발사:') === 0 || s.name.indexOf('자위권발사:') === 0 ? 'fire'
        : s.name.indexOf('BDA:HIT') === 0 ? 'hit'
        : s.name.indexOf('BDA:MISS') === 0 ? 'miss'
        : s.name.indexOf('누수:') === 0 ? 'leak' : null;
      if (kind) marks.push({ t: s.t, kind: kind });
      if (s.name.indexOf('책임C2:') === 0 && !c2) {
        var m = /\(([^)]+)\)/.exec(s.name);
        c2 = { id: (nodesInStage(s.name)[0] || null), scope: m ? m[1] : null };
      }
      nodesInStage(s.name).forEach(function (id) {
        var b = byNode[id] || (byNode[id] = { id: id, first: s.t, last: s.t, n: 0 });
        if (s.t < b.first) b.first = s.t;
        if (s.t > b.last) b.last = s.t;
        b.n++;
      });
    });
    var ORDER = { sensor: 0, c2: 1, shooter: 2 };
    var rows = Object.keys(byNode).map(function (id) {
      var meta = idx.map[id] || { key: id, name: id, category: 'c2' };
      return { id: id, name: meta.name, category: meta.category,
        first: byNode[id].first, last: byNode[id].last, n: byNode[id].n };
    }).sort(function (x, y) {
      var ox = ORDER[x.category] === undefined ? 9 : ORDER[x.category];
      var oy = ORDER[y.category] === undefined ? 9 : ORDER[y.category];
      return ox !== oy ? ox - oy : (x.first - y.first);
    });
    return { rows: rows, marks: marks, c2: c2, endT: tr.exitT != null ? tr.exitT : tr.stages[tr.stages.length - 1].t };
  }

  // ── C2 계통 다이어그램 (항적별 · 상태에 따라 점등) ──
  // 타임라인이 **얼마나 걸렸나**를 보여준다면, 이 그림은 **누가 누구를 거쳤나**를 보여준다.
  // 분절(As-Is)은 센서→하위C2→상위C2→사수로 홉이 늘어지고, 통합(To-Be)은 IAOC 한 점으로 모인다.
  //
  // ⚠️ 간선은 **카탈로그에 실제로 존재하는 링크만** 그린다. 항적 단계가 시간상 인접하다는
  //    이유로 선을 그으면 모델에 없는 연결을 지어내는 것이다 — 그 선을 보고 "이렇게
  //    연결돼 있구나"라고 읽을 것이기 때문이다. 링크가 없으면 선도 없다.

  var _linkIdx = null;
  function linkIndex() {
    if (_linkIdx) return _linkIdx;
    var cat = runCatalog();
    _linkIdx = {};
    ((cat && cat.links) || []).forEach(function (l) {
      (_linkIdx[l.from] = _linkIdx[l.from] || {})[l.to] = l.kind || 'coord';
    });
    return _linkIdx;
  }

  /**
   * 참여 노드 키(id 또는 typeId)를 **카탈로그 노드 id**로 확정한다.
   * typeId가 여러 노드에 걸리면(ICC W1·W2) 어느 것인지 항적만으로는 알 수 없다 —
   * 그때는 다른 참여 노드와 실제 링크가 있는 후보를 고르고, 그래도 못 고르면
   * typeId를 그대로 둔 채 **간선 없이** 표시한다(없는 연결을 만들지 않는다).
   */
  function resolveConcrete(part) {
    var cat = runCatalog(), all = (cat && cat.nodes) || [], links = linkIndex();
    var byType = {};
    all.forEach(function (n) { if (n.typeId) (byType[n.typeId] = byType[n.typeId] || []).push(n); });
    var byId = {};
    all.forEach(function (n) { byId[n.id] = n; });

    var direct = {}, pending = [];
    part.rows.forEach(function (r) {
      if (byId[r.id]) { direct[r.id] = r; return; }
      var group = byType[r.id] || [];
      if (group.length === 1) { direct[group[0].id] = { id: group[0].id, name: group[0].name, category: group[0].category, first: r.first, last: r.last }; return; }
      pending.push({ row: r, group: group });
    });
    pending.forEach(function (p) {
      var pick = p.group.find(function (n) {
        return Object.keys(direct).some(function (o) {
          return (links[n.id] && links[n.id][o]) || (links[o] && links[o][n.id]);
        });
      });
      if (pick) direct[pick.id] = { id: pick.id, name: pick.name, category: pick.category, first: p.row.first, last: p.row.last };
      else direct[p.row.id] = { id: p.row.id, name: p.row.name, category: p.row.category, first: p.row.first, last: p.row.last, abstract: true };
    });
    return Object.keys(direct).map(function (k) { return direct[k]; });
  }

  var EDGE_COLOR = { report: '#3d8bd9', coord: '#a06ed2', command: '#3d8b40', status: '#6b7a8d' };

  /** 한 모드의 C2 계통 다이어그램(SVG). 열 배치는 고정이라 좌우를 그대로 겹쳐 읽을 수 있다. */
  function diagramBlock(title, part, respScope) {
    if (!part) return '<div class="cdg-block"><h4>' + esc(title) + '</h4>' +
      '<div class="bn-none">대응 항적 없음</div></div>';
    var nodes = resolveConcrete(part), links = linkIndex();
    // 교전명령은 상급 C2 → **ECS** → 포대로 간다. 항적은 `사수선정·표적할당:IAOC→BATTERY_…`
    // 처럼 양 끝만 적어 중간 ECS 홉이 빠지고, 그러면 사수가 선 없이 떠 버린다.
    // 카탈로그에 1홉 경로가 실재할 때만 그 중간 노드를 **점선·속 빈 원**으로 보완하고
    // "항적 기록에는 없음"으로 표시한다 — 연결을 지어내는 게 아니라 모델이 가진 경로를 밝힌다.
    var have = {};
    nodes.forEach(function (n) { have[n.id] = true; });
    var cat = runCatalog(), allNodes = (cat && cat.nodes) || [];
    var byIdAll = {};
    allNodes.forEach(function (n) { byIdAll[n.id] = n; });
    // ⚠️ part.c2.id는 항적이 적은 **typeId**(`IAOC`)일 수 있다. 링크 색인은 노드 id
    //    (`C2_IAOC_IAOC`)로 되어 있으므로 여기서 실제 id로 환산한다 — 안 하면 책임 C2
    //    강조도, 센서 직결 집계도, 경로 보완도 전부 조용히 빗나간다(실제로 0/7로 나왔다).
    var respKey = part.c2 && part.c2.id;
    var respId = null;
    if (respKey) {
      if (byIdAll[respKey] && have[respKey]) respId = respKey;
      else {
        var hit = nodes.find(function (n) {
          return n.id === respKey || (byIdAll[n.id] && byIdAll[n.id].typeId === respKey);
        });
        respId = hit ? hit.id : null;
      }
    }
    if (respId && have[respId]) {
      nodes.filter(function (n) { return n.category === 'shooter'; }).forEach(function (sh) {
        if (links[respId] && links[respId][sh.id]) return;                 // 직접 링크가 있으면 불필요
        var mid = Object.keys(links[respId] || {}).find(function (m) {
          return links[m] && links[m][sh.id] && !have[m];
        });
        if (!mid || !byIdAll[mid]) return;
        have[mid] = true;
        nodes.push({ id: mid, name: byIdAll[mid].name || mid, category: byIdAll[mid].category,
          first: sh.first, last: sh.first, bridge: true });
      });
    }
    var COL = { sensor: 0, c2: 1, shooter: 2 };
    var cols = [[], [], []];
    nodes.forEach(function (n) {
      var c = COL[n.category]; if (c === undefined) c = 1;
      cols[c].push(n);
    });
    cols.forEach(function (list) { list.sort(function (a, b) { return a.first - b.first; }); });

    var W = 330, PAD = 8, colX = [58, 165, 285];
    var rowH = 26, maxRows = Math.max(1, cols[0].length, cols[1].length, cols[2].length);
    var H = PAD * 2 + maxRows * rowH;
    var posOf = {};
    cols.forEach(function (list, ci) {
      var offset = (maxRows - list.length) / 2;
      list.forEach(function (n, i) {
        posOf[n.id] = { x: colX[ci], y: PAD + (offset + i) * rowH + rowH / 2, node: n };
      });
    });

    // 간선 — 카탈로그에 실제 존재하는 링크만.
    var edges = '';
    nodes.forEach(function (a) {
      nodes.forEach(function (b) {
        if (a.id === b.id) return;
        var kind = links[a.id] && links[a.id][b.id];
        if (!kind) return;
        var pa = posOf[a.id], pb = posOf[b.id];
        if (!pa || !pb || pa.x === pb.x) return;      // 같은 열끼리는 생략(가독성)
        // 간선은 **뒤쪽 노드가 켜질 때** 함께 켜진다.
        var t = Math.max(a.first, b.first);
        edges += '<line class="cdg-edge" data-t="' + t + '" x1="' + pa.x + '" y1="' + pa.y +
          '" x2="' + pb.x + '" y2="' + pb.y + '" stroke="' + (EDGE_COLOR[kind] || '#6b7a8d') +
          '" stroke-width="1.4"' + (kind === 'coord' ? ' stroke-dasharray="3 3"' : '') +
          '><title>' + esc(a.name + ' → ' + b.name + ' (' + kind + ')') + '</title></line>';
      });
    });

    var circles = nodes.map(function (n) {
      var p = posOf[n.id];
      var isResp = respId && n.id === respId;
      var short = n.name.length > 13 ? n.name.slice(0, 12) + '…' : n.name;
      return '<g class="cdg-node cdg-' + esc(n.category) + (isResp ? ' cdg-resp' : '') +
        (n.bridge ? ' cdg-bridge' : '') + '" data-t="' + n.first + '">' +
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (isResp ? 8 : 6) + '"></circle>' +
        '<text x="' + p.x + '" y="' + (p.y - 10) + '" text-anchor="middle">' + esc(short) + '</text>' +
        '<title>' + esc(n.name + (n.bridge ? ' · 경로상 노드(항적 기록에는 없음)' : ' · 최초 관여 ' + fmtTime(n.first))) +
        '</title></g>';
    }).join('');

    // 센서가 책임 C2에 실제로 보고 링크를 갖는 비율 — 흩어진 점이 "렌더 오류"가 아니라
    // **관측 결과**임을 숫자로 못박는다.
    var sensors = nodes.filter(function (n) { return n.category === 'sensor'; });
    var linkedSensors = respId ? sensors.filter(function (n) {
      return (links[n.id] && links[n.id][respId]) || (links[respId] && links[respId][n.id]);
    }).length : 0;
    return '<div class="cdg-block"><h4>' + esc(title) +
      '<span class="cdg-count">노드 ' + nodes.length +
      (sensors.length ? ' · 센서 ' + linkedSensors + '/' + sensors.length + ' 가 책임 C2와 직결' : '') +
      '</span>' +
      (respScope ? '<span class="cdg-scope">' + esc(respScope) + '</span>' : '') + '</h4>' +
      '<svg class="cdg-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      edges + circles + '</svg></div>';
  }

  /** 항적별 C2 계통 다이어그램 — 좌 As-Is · 우 To-Be. 재생헤드 시각에 따라 점등된다. */
  function diagramHtml(pa, pb) {
    if (!pa && !pb) return '';
    return '<div class="cdg-wrap">' +
      diagramBlock('As-Is 분절형', pa, pa && pa.c2 ? 'scope=' + pa.c2.scope : '') +
      diagramBlock('To-Be 통합형', pb, pb && pb.c2 ? 'scope=' + pb.c2.scope : '') +
      '<div class="cdg-legend">실선 파랑 = 항적보고 · 점선 보라 = 협조 · 실선 초록 = 교전명령 · ' +
      '굵은 원 = 책임 C2. <b>카탈로그에 실제로 있는 링크만 그립니다</b>(시간상 인접해도 링크가 없으면 선도 없음).</div>' +
      '</div>';
  }

  // ── 결심 순간 해부 (ADR-073 결심 감사 + ADR-074 그림자 평가·교전창) ──
  // 다이어그램이 「누가 보였나」, 타임라인이 「얼마나 걸렸나」를 말한다면 여기는
  // 「그래서 무엇을 놓고 골랐고, 그 선택이 최선이었나」를 말한다.
  //
  // ⚠️ 이 절이 지켜야 할 정직성 세 가지:
  //  1) 표본에서 빠졌거나 결심 자체가 없었으면 **빈칸으로 두지 않고 그 사실을 적는다.**
  //  2) regret이 null이면 0이 아니라 **미측정**이다(USFK 독립 축 — ADR-036/074).
  //  3) 시야 폭(visibleUnitCount)이 두 모드에서 같으면 그대로 보여 준다 —
  //     주축에서 후보 풀이 동일하다는 ADR-073 반증이 화면에서 확인돼야 한다.

  /** 위협 id → 그 위협의 결심 감사 이벤트 배열(시간순). */
  function groupAudits(list) {
    var by = {};
    (list || []).forEach(function (e) { (by[e.threatId] = by[e.threatId] || []).push(e); });
    Object.keys(by).forEach(function (k) {
      by[k].sort(function (a, b) { return a.t - b.t; });
    });
    return by;
  }

  function fmtScore(v) { return (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(4); }

  /** 후보 카드 한 장. 선택·전역최적을 배지로 구분한다. */
  function candidateCard(c, chosenId, bestId) {
    var isChosen = c.unitId === chosenId, isBest = c.unitId === bestId;
    return '<li class="dca-cand' + (isChosen ? ' dca-chosen' : '') + (isBest ? ' dca-best' : '') + '">' +
      '<span class="dca-unit">' + esc(c.unitId) + '<i>' + esc(c.unitType || '') + '</i></span>' +
      '<span class="dca-score">' + fmtScore(c.score) + '</span>' +
      '<span class="dca-attrs">Pk ' + (c.pk != null ? Number(c.pk).toFixed(2) : '—') +
      ' · ' + (c.rangeKm != null ? Number(c.rangeKm).toFixed(0) + 'km' : '—') +
      ' · 잔탄 ' + (c.ammoRatio != null ? Math.round(c.ammoRatio * 100) + '%' : '—') +
      ' · 부하 ' + (c.load != null ? Math.round(c.load * 100) + '%' : '—') + '</span>' +
      '<span class="dca-tags">' +
      (isChosen ? '<b class="dca-tag-chosen">선택</b>' : '') +
      (isBest ? '<b class="dca-tag-best">★ 전역최적</b>' : '') +
      '</span></li>';
  }

  /** 한 모드의 결심 해부 블록. 결심이 없으면 그 사실을 명시한다. */
  function anatomyBlock(title, audits, tr) {
    if (!audits || !audits.length) {
      var why = !tr ? '이 모드에 대응 항적이 없습니다.'
        : (tr.outcome === 'killed'
          ? '결심 감사 기록이 없습니다(자위권 발사 등 후보 명단을 거치지 않은 경로일 수 있습니다).'
          : '<b>결심에 도달하지 못했습니다</b> — 후보를 놓고 고르는 단계까지 가지 못했습니다.');
      return '<div class="dca-block"><h4>' + esc(title) + '</h4>' +
        '<div class="bn-none">' + why + '</div></div>';
    }
    var d = audits[0];   // 최초 결심(재교전이 있으면 첫 결심을 대표로 본다)
    var cands = (d.candidates || []).slice().sort(function (a, b) { return b.score - a.score; });
    var regretTxt = d.regret == null
      ? '<b class="dca-na">미측정</b>'
      : (d.regret > 0 ? '<b class="dca-loss">' + fmtScore(d.regret) + '</b>' : '<b class="dca-ok">0 (최적 선택)</b>');
    var marginTxt = d.engagementWindowMargin == null
      ? '<b class="dca-na">미측정</b>'
      : (d.engagementWindowMargin >= 0
        ? '<b class="dca-ok">+' + Math.round(d.engagementWindowMargin) + '초 여유</b>'
        : '<b class="dca-loss">' + Math.round(d.engagementWindowMargin) + '초 초과</b>');
    var reasons = Object.keys(d.infeasibleReasons || {}).map(function (k) {
      return esc(k) + ' ' + d.infeasibleReasons[k];
    }).join(' · ');

    return '<div class="dca-block"><h4>' + esc(title) +
      '<span class="dca-when">결심 ' + fmtTime(d.t) + '</span></h4>' +
      '<table class="dca-facts"><tbody>' +
      '<tr><th>결심자</th><td>' + esc(d.commanderId || '—') +
      ' <i>(' + esc(d.commanderAxis || '—') + ' · ' + esc(d.commanderScope || '—') + ')</i></td></tr>' +
      '<tr><th>C2 시야 폭</th><td>' + (d.visibleUnitCount != null ? d.visibleUnitCount + '문' : '—') +
      ' <i>이 결심자가 볼 수 있었던 발사대</i></td></tr>' +
      '<tr><th>실현가능 후보</th><td>' + (d.candidateCount != null ? d.candidateCount + '문' : '—') +
      (reasons ? ' <i>탈락: ' + reasons + '</i>' : '') + '</td></tr>' +
      '<tr><th>선택 손실 (regret)</th><td>' + regretTxt +
      (d.globalBestUnitId ? ' <i>전역최적 ' + esc(d.globalBestUnitId) + ' ' + fmtScore(d.globalBestScore) + '</i>' : '') +
      '</td></tr>' +
      '<tr><th>교전창 여유</th><td>' + marginTxt +
      (d.engagementWindowCloseT != null ? ' <i>마감 ' + fmtTime(d.engagementWindowCloseT) + '</i>' : '') +
      '</td></tr>' +
      '</tbody></table>' +
      (cands.length
        ? '<ul class="dca-cands">' + cands.map(function (c) {
          return candidateCard(c, d.chosenUnitId, d.globalBestUnitId);
        }).join('') + '</ul>'
        : '<div class="bn-none">후보 명단이 비어 있습니다.</div>') +
      '</div>';   // ⚠️ .dca-block 닫기 — 빠뜨리면 To-Be 블록이 As-Is 안에 중첩돼
                  //    두 블록의 표가 겹쳐 읽히고(뒤 값이 이김) 후보 카드도 합쳐진다.
  }

  /** 결심 순간 해부 — 좌 As-Is · 우 To-Be. */
  function anatomyHtml(threatId, ta, tb) {
    if (!run.audits) return '';
    var aa = run.audits.asis[threatId], ab = run.audits.tobe[threatId];
    if ((!aa || !aa.length) && (!ab || !ab.length)) {
      return '<div class="dca-wrap"><div class="note">이 항적은 두 모드 모두 결심 감사 기록이 없습니다 ' +
        '(결심 미도달 또는 표본 제외).</div></div>';
    }
    var note = '';
    if (aa && aa.length && ab && ab.length && aa[0].visibleUnitCount === ab[0].visibleUnitCount) {
      note = '<div class="note dca-note">⚠️ 두 모드의 <b>C2 시야 폭이 같습니다</b>(' +
        aa[0].visibleUnitCount + '문) — 이 항적에서 통합의 이득은 <b>후보가 늘어서가 아닙니다</b>. ' +
        'ADR-073 §발견(주축 사수 풀 동일)이 화면에서 확인되는 지점입니다.</div>';
    }
    return '<div class="dca-wrap">' +
      anatomyBlock('As-Is 분절형', aa, ta) +
      anatomyBlock('To-Be 통합형', ab, tb) +
      note +
      '<div class="dca-legend">점수는 개념 가중치(C2-WTA-*)의 합성이라 <b>단위가 없습니다</b> — ' +
      '크기가 아니라 <b>순위와 일치 여부</b>로 읽으십시오. regret은 「전역최적 점수 − 실제선택 점수」이며, ' +
      '전 자산이 다 보였다면 골랐을 최고점과의 차이입니다(USFK 독립 축은 제외 — ADR-036).</div>' +
      '</div>';
  }

  var MARK_ICON = { fire: '▲', hit: '●', miss: '○', leak: '✕' };
  var MARK_TIP = { fire: '발사', hit: 'BDA 명중', miss: 'BDA 빗나감', leak: '요격 실패' };

  /** 한 모드의 타임라인 블록. t0~t1은 두 모드 공통 축이라 좌우를 그대로 겹쳐 읽을 수 있다. */
  function timelineBlock(title, part, t0, span) {
    if (!part) return '<div class="ptl-block"><h4>' + esc(title) + '</h4>' +
      '<div class="bn-none">대응 항적 없음</div></div>';
    var pos = function (t) { return ((t - t0) / span * 100).toFixed(2); };
    var rows = part.rows.map(function (r) {
      var left = pos(r.first), w = Math.max(0.6, (r.last - r.first) / span * 100);
      return '<div class="ptl-row">' +
        '<div class="ptl-label ptl-' + esc(r.category) + '" title="' + esc(r.id) + '">' +
        esc(r.name) + '</div>' +
        '<div class="ptl-track">' +
        '<div class="ptl-bar ptl-' + esc(r.category) + '" style="left:' + left + '%;width:' + w.toFixed(2) + '%"' +
        ' title="' + esc(r.name + ' · ' + fmtTime(r.first) + '~' + fmtTime(r.last) + ' · 관여 ' + r.n + '회') + '"></div>' +
        '</div></div>';
    }).join('');
    var marks = part.marks.map(function (m) {
      return '<span class="ptl-mark ptl-mark-' + m.kind + '" style="left:' + pos(m.t) + '%"' +
        ' title="' + esc(MARK_TIP[m.kind] + ' · ' + fmtTime(m.t)) + '">' + MARK_ICON[m.kind] + '</span>';
    }).join('');
    return '<div class="ptl-block"><h4>' + esc(title) +
      '<span class="ptl-end">종료 ' + fmtTime(part.endT) + '</span></h4>' +
      rows +
      '<div class="ptl-row ptl-marks"><div class="ptl-label"></div>' +
      '<div class="ptl-track">' + marks + '<div class="ptl-playhead"></div></div></div>' +
      '</div>';
  }

  /** 축(scope) 주석 — ADR-073 반증을 화면에서 명시한다. */
  function axisNote(pa, pb) {
    var sa = pa && pa.c2 ? pa.c2.scope : null;
    if (sa === 'self_battery') {
      return '<div class="note ptl-axis ptl-axis-local">이 항적은 <b>국지방공 축(군단 AOC)</b>이 맡았습니다 — ' +
        '이 축은 <b>자기 포대만 관측</b>합니다(<code>scope=self_battery</code>). ' +
        '통합 시 <b>관측 범위가 실제로 넓어지는 구간</b>이며, 선택 손실(regret)이 줄어드는 것도 이 축입니다(ADR-073).</div>';
    }
    return '<div class="note ptl-axis">이 항적은 <b>주축</b>이 맡았습니다' +
      (pa && pa.c2 && pa.c2.id ? ' (As-Is ' + esc(pa.c2.id) + ' → To-Be ' + esc((pb && pb.c2 && pb.c2.id) || '—') + ')' : '') +
      '. ⚠️ <b>주축의 사수 후보 풀은 두 구조가 동일합니다</b>(ADR-073 §발견 — 「명단이 좁아 차선을 고른다」 가설은 ' +
      '주축에서 반증됐습니다). 따라서 아래 그림에서 읽어야 할 차이는 <b>후보 수가 아니라 시간</b>입니다.</div>';
  }

  /** 참여 노드 타임라인 — 같은 시간축 위에 As-Is/To-Be를 위아래로 놓는다. */
  function timelineHtml(ta, tb, uid) {
    var pa = participationOf(ta), pb = participationOf(tb);
    if (!pa && !pb) return '';
    var lo = [], hi = [];
    [ta, tb].forEach(function (t) {
      if (t && t.stages && t.stages.length) {
        lo.push(t.stages[0].t);
        hi.push(t.stages[t.stages.length - 1].t);
      }
    });
    var t0 = Math.min.apply(null, lo), t1 = Math.max.apply(null, hi);
    var span = Math.max(1, t1 - t0);
    // 눈금 — 5개 내외로 균등 분할(초 단위 반올림).
    var ticks = '';
    for (var k = 0; k <= 4; k++) {
      var tt = t0 + span * k / 4;
      ticks += '<span class="ptl-tick" style="left:' + (k / 4 * 100).toFixed(2) + '%">' + fmtTime(tt) + '</span>';
    }
    return '<div class="ptl-wrap" data-uid="' + esc(uid) + '" data-t0="' + t0 + '" data-span="' + span + '">' +
      axisNote(pa, pb) +
      diagramHtml(pa, pb) +
      anatomyHtml(uid, ta, tb) +
      '<div class="ptl-head">' +
      '<button type="button" class="ptl-play">▶ 동시 재생</button>' +
      '<span class="ptl-legend"><i class="ptl-sensor"></i>레이더<i class="ptl-c2"></i>지휘소<i class="ptl-shooter"></i>요격부대' +
      '<b>▲</b>발사 <b>●</b>명중 <b>✕</b>요격 실패</span>' +
      '</div>' +
      '<div class="ptl-row ptl-axisrow"><div class="ptl-label"></div><div class="ptl-track">' + ticks + '</div></div>' +
      timelineBlock('As-Is 분절형', pa, t0, span) +
      timelineBlock('To-Be 통합형', pb, t0, span) +
      '</div>';
  }

  /** ▶ 동시 재생 — 두 블록의 재생헤드를 같은 시간축으로 함께 움직인다.
   *  좌우가 같은 축이라 To-Be가 **먼저 끝나는 것**이 그대로 체감된다. */
  function bindTimelinePlay(scope) {
    Array.prototype.forEach.call((scope || document).querySelectorAll('.ptl-play'), function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', function () {
        var wrap = btn.closest('.ptl-wrap');
        var heads = wrap.querySelectorAll('.ptl-playhead');
        var bars = wrap.querySelectorAll('.ptl-bar');
        var marks = wrap.querySelectorAll('.ptl-mark');
        if (wrap._raf) cancelAnimationFrame(wrap._raf);
        if (wrap._guard) clearTimeout(wrap._guard);
        var DUR = 2600, t0 = now(), done = false;
        // 다이어그램 점등 — 타임라인과 **같은 재생헤드**가 몰기 때문에 두 그림이 항상 같은
        // 시각을 가리킨다(따로 돌면 어느 쪽을 믿어야 할지 알 수 없다).
        var domain0 = parseFloat(wrap.getAttribute('data-t0')) || 0;
        var domainSpan = parseFloat(wrap.getAttribute('data-span')) || 1;
        var lit = wrap.querySelectorAll('.cdg-node, .cdg-edge');
        var cdg = wrap.querySelector('.cdg-wrap');
        if (cdg) cdg.classList.add('cdg-playing');   // 재생 중에만 소등 상태를 쓴다
        Array.prototype.forEach.call(bars, function (b) { b.classList.add('ptl-dim'); });
        Array.prototype.forEach.call(marks, function (m) { m.classList.add('ptl-dim'); });
        Array.prototype.forEach.call(lit, function (n) { n.classList.remove('cdg-on'); });
        btn.disabled = true;

        /** 최종 상태로 확정 — 애니메이션이 끝났든 중단됐든 화면은 항상 여기로 수렴한다. */
        function finish() {
          if (done) return;
          done = true;
          if (wrap._raf) { cancelAnimationFrame(wrap._raf); wrap._raf = null; }
          clearTimeout(wrap._guard); wrap._guard = null;
          Array.prototype.forEach.call(bars, function (b) { b.classList.remove('ptl-dim'); });
          Array.prototype.forEach.call(marks, function (m) { m.classList.remove('ptl-dim'); });
          Array.prototype.forEach.call(lit, function (n) { n.classList.add('cdg-on'); });
          if (cdg) cdg.classList.remove('cdg-playing');   // 정지 화면은 항상 전부 켜짐
          Array.prototype.forEach.call(heads, function (h) { h.style.opacity = 0; });
          btn.disabled = false;
        }
        // ⚠️ rAF는 탭이 화면에 없으면 멈춘다(백그라운드 throttle). 그때 rAF만 믿으면
        // 막대가 흐린 채·버튼이 비활성인 채로 **영구히 굳는다**(실측). 타이머로 확정한다.
        wrap._guard = setTimeout(finish, DUR + 400);

        (function step() {
          if (done) return;
          var p = Math.min(1, (now() - t0) / DUR);
          var pctX = (p * 100).toFixed(2) + '%';
          Array.prototype.forEach.call(heads, function (h) { h.style.left = pctX; h.style.opacity = 1; });
          Array.prototype.forEach.call(bars, function (b) {
            if (parseFloat(b.style.left) <= p * 100) b.classList.remove('ptl-dim');
          });
          Array.prototype.forEach.call(marks, function (m) {
            if (parseFloat(m.style.left) <= p * 100) m.classList.remove('ptl-dim');
          });
          var tNow = domain0 + domainSpan * p;
          Array.prototype.forEach.call(lit, function (n) {
            n.classList.toggle('cdg-on', parseFloat(n.getAttribute('data-t')) <= tNow);
          });
          if (p < 1) wrap._raf = requestAnimationFrame(step);
          else finish();
        })();
      });
    });
  }

  // 병렬 대조 필터 (모달을 다시 열어도 선택 유지)
  var compareFilter = 'diff';

  /** 결과 모달 ④ — 같은 위협이 두 지휘 방식에서 어떻게 달랐는지 나란히 본다. */
  function threatCompareSection() {
    var a = run.cfg.mode === 'asis' ? run.res : run.resOther;   // 좌 = 항상 As-Is
    var b = run.cfg.mode === 'asis' ? run.resOther : run.res;   // 우 = 항상 To-Be
    if (!a || !b) return '';
    var ta = (a && a.threatTraces) || [], tb = (b && b.threatTraces) || [];
    if (!ta.length && !tb.length) {
      return '<h3>4. 두 방식이 어떻게 달랐나요?</h3>' +
        '<div class="bn-none">이 설정에서 생성된 위협 항적이 없습니다.</div>';
    }

    var byIdB = {};
    tb.forEach(function (tr) { byIdB[tr.id] = tr; });
    var seen = {};
    var rows = ta.map(function (tr) { seen[tr.id] = 1; return { id: tr.id, a: tr, b: byIdB[tr.id] || null }; });
    // 대응이 깨진 항적(설계상 없어야 함)도 숨기지 않는다 — 모델 결함 신호다.
    tb.forEach(function (tr) { if (!seen[tr.id]) rows.push({ id: tr.id, a: null, b: tr }); });

    var tally = { gain: 0, loss: 0, other: 0, same: 0 };
    rows.forEach(function (r) {
      r.oa = outcomeOf(r.a); r.ob = outcomeOf(r.b);
      r.dv = divergenceOf(r.oa, r.ob);
      tally[r.dv.key]++;
    });
    var unpaired = rows.filter(function (r) { return !r.a || !r.b; }).length;

    var html = '<h3>4. 위협 항적 병렬 대조 — As-Is ↔ To-Be</h3>' +
      '<p>동일 seed 결정론 DES 1복제에서 <b>같은 위협이 두 지휘구조를 각각 통과한 경로</b>를 ' +
      '나란히 놓은 로그입니다. 공통난수(CRN) 설계상 두 실행의 위협 집단(ID·발생시각·축선)은 ' +
      '동일하므로, <b>판정이 갈린 항적이 곧 C2 구조가 만든 차이</b>입니다.</p>' +
      '<div class="cmp-tally">' +
      '<span class="dv-gain">개선 <b>' + tally.gain + '</b></span>' +
      '<span class="dv-loss">악화 <b>' + tally.loss + '</b></span>' +
      (tally.other ? '<span class="dv-other">변화 <b>' + tally.other + '</b></span>' : '') +
      '<span class="dv-same">동일 <b>' + tally.same + '</b></span>' +
      '<span class="cmp-total">추적 ' + rows.length + '건</span></div>';

    if (a.traceTruncated || b.traceTruncated) {
      html += '<div class="note">⚠️ 추적 상한(300건) 절삭 — 아래 목록은 <b>표본</b>입니다.</div>';
    }
    if (unpaired) {
      html += '<div class="note">⚠️ 두 모드에서 대응되지 않는 항적 ' + unpaired + '건 — ' +
        'CRN(공통난수) 설계상 위협 집단은 모드와 무관하게 같아야 합니다. 대응 실패는 모델 결함 신호입니다.</div>';
    }

    var FILTERS = [
      { key: 'diff', label: '판정이 갈린 항적', n: tally.gain + tally.loss + tally.other },
      { key: 'gain', label: '개선', n: tally.gain },
      { key: 'loss', label: '악화', n: tally.loss },
      { key: 'all', label: '전체', n: rows.length }
    ];
    html += '<div class="alog-filters">' + FILTERS.map(function (f) {
      return '<button type="button" class="alog-filter' + (compareFilter === f.key ? ' is-on' : '') +
        '" data-filter="' + f.key + '">' + esc(f.label) + ' <b>' + f.n + '</b></button>';
    }).join('') + '</div>';

    var shown = rows.filter(function (r) {
      if (compareFilter === 'all') return true;
      if (compareFilter === 'diff') return r.dv.key !== 'same';
      return r.dv.key === compareFilter;
    });
    if (!shown.length) {
      return html + '<div class="bn-none">이 조건에 해당하는 항적이 없습니다.</div>';
    }

    html += '<div class="alog-legend">' +
      '<span>좌 <b>As-Is 분절형</b></span><span>우 <b>To-Be 통합형</b></span>' +
      '<span class="sd-key sd-only"><span class="sd-mark">＋</span> 해당 계통에만 존재</span>' +
      '<span class="sd-key sd-diff"><span class="sd-mark">◆</span> 담당 노드 상이</span>' +
      '<span class="sd-key sd-shift"><span class="sd-mark">⏱</span> 시각 차이</span>' +
      '<span class="sd-key sd-same">회색 = 동일</span></div>';

    html += shown.map(function (r) {
      var ref = r.a || r.b;
      return '<details class="alog-row ' + r.dv.cls + '-row">' +
        '<summary class="alog-hdr">' +
        '<span class="tlog-dot" style="background:' + THREAT_COLOR[ref.type] + '"></span>' +
        '<span class="alog-id">' + esc(r.id) + ' <i>(' + esc(ref.axis) + ')</i></span>' +
        '<span class="alog-time">' + fmtTime(ref.spawnT) + ' 침투</span>' +
        '<span class="alog-pair">' + outcomeBadge(r.oa) +
        '<span class="alog-arrow">→</span>' + outcomeBadge(r.ob) + '</span>' +
        '<span class="alog-dv ' + r.dv.cls + '">' + esc(r.dv.label) + '</span>' +
        '</summary>' +
        timelineHtml(r.a, r.b, r.id) +
        '<div class="alog-cols">' +
        '<div class="alog-col"><h4>As-Is 분절형</h4>' + diffStageList(r.a, r.b) + '</div>' +
        '<div class="alog-col"><h4>To-Be 통합형</h4>' + diffStageList(r.b, r.a) + '</div>' +
        '</div></details>';
    }).join('');
    return html;
  }

  /** 필터 버튼은 섹션만 다시 그린다(모달 전체 재렌더 방지 — 열어 둔 항목이 닫히지 않게). */
  function bindCompareFilters() {
    var box = el('sim-compare-section');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.alog-filter'), function (btn) {
      btn.addEventListener('click', function () {
        compareFilter = btn.getAttribute('data-filter');
        box.innerHTML = threatCompareSection();
        bindCompareFilters();
        bindTimelinePlay(box);
      });
    });
  }

  function renderModal() {
    if (!run) return;
    var cfg = run.cfg;
    var modeName = cfg.mode === 'asis' ? 'As-Is 분절형(지금 방식)' : 'To-Be 통합형(바뀐 방식)';
    var nodes = run.res.nodes.slice();
    var activeNodes = nodes.filter(function (n) { return n.arrivals > 0; });
    var html = '';

    // ① 무엇을 돌렸는지 — 결과를 읽기 전에 알아야 하는 전제.
    // 기술적인 설정 문자열(contextLabel)은 감사에 필요하므로 버리지 않고 맨 아래로 내린다.
    html += '<h3>1. 무엇을 돌려 봤나요?</h3>' +
      '<table><tbody>' +
      '<tr><th>상황</th><td>' + esc(KJ.scenarioById(cfg.sc).name) + '</td></tr>' +
      '<tr><th>지휘 방식</th><td>' + esc(modeName) + '</td></tr>' +
      '<tr><th>적이 오는 양</th><td>보통의 ' + esc(Number(cfg.x).toFixed(1)) + '배</td></tr>' +
      '<tr><th>무작위 번호 (seed)</th><td>' + esc(String(cfg.seed)) +
      ' — 이 번호가 같으면 몇 번을 다시 돌려도 결과가 똑같이 나와요</td></tr>' +
      '</tbody></table>';

    // ② 시간 — 가상 시간과 실제 계산 시간은 다른 것이다(헷갈리기 쉬운 지점)
    html += '<h3>2. 시간이 얼마나 걸렸나요?</h3><div class="stat-grid">' +
      statCard('시뮬레이션 속에서 흐른 시간', plainDuration(cfg.dur)) +
      statCard('컴퓨터가 계산하는 데 걸린 시간', (run.elapsedMs / 1000).toFixed(1) + '초') +
      statCard('컴퓨터가 처리한 사건 수', run.res.eventCount.toLocaleString() + '번') +
      '</div>' +
      '<div class="note">위의 두 시간은 서로 다른 시간이에요. <b>첫 번째</b>는 이야기 속에서 흐른 시간이고 ' +
      '(예: 30분짜리 상황), <b>두 번째</b>는 그 30분을 컴퓨터가 계산해 내는 데 실제로 걸린 시간이에요. ' +
      '<b>사건</b>은 "레이더가 무언가를 봤다", "명령이 도착했다"처럼 시뮬레이션 안에서 일어난 일 하나하나를 말해요.</div>';

    // ③ 노드 활성화 — "한 번이라도 일이 들어왔는가"만 본다(부하·성능 판단이 아니다)
    html += '<h3>3. 어떤 장비가 움직였나요?</h3>' +
      '<p>이번 시뮬레이션에 등장한 지휘소·요격 부대는 모두 <b>' + nodes.length + '곳</b>이고, ' +
      '그중 <b>' + activeNodes.length + '곳</b>이 실제로 한 번이라도 일을 했어요. ' +
      '나머지 ' + (nodes.length - activeNodes.length) + '곳은 이번 상황에서는 할 일이 없었어요.</p>';

    var rows = nodes.sort(function (a, b) {
      var aa = a.arrivals > 0 ? 0 : 1, bb = b.arrivals > 0 ? 0 : 1;
      if (aa !== bb) return aa - bb;                       // 움직인 것부터
      if (a.category !== b.category) return a.category < b.category ? -1 : 1;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    }).map(function (n) {
      var on = n.arrivals > 0;
      return '<tr><td>' + esc(n.name) + '</td>' +
        '<td>' + esc(plainCategory(n.category)) + '</td>' +
        '<td>' + (on ? '<b class="node-on">● 움직였어요</b>' : '<span class="node-off">○ 안 움직였어요</span>') +
        '</td></tr>';
    }).join('');

    html += '<table><thead><tr><th>장비 이름</th><th>종류</th><th>움직였나요?</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="3" class="bn-none">움직인 장비가 없어요.</td></tr>') +
      '</tbody></table>';

    // ④ 두 지휘 방식의 항적 병렬 대조 (필터로 다시 그리므로 전용 컨테이너에 담는다)
    html += '<section id="sim-compare-section">' + threatCompareSection() + '</section>';

    html += '<div class="note">여기 나오는 숫자는 공개 자료로 만든 <b>연구용 가상 값</b>이에요. 실제 군사 자료가 아니에요. ' +
      '격추 수·요격 실패율 같은 자세한 분석은 화면을 새로 만드는 중이라 지금은 보여주지 않아요.</div>';

    // 감사용 원문 설정 — 위의 쉬운 말 표가 줄인 정보(배치·충실도·모델 조건 토글)를 그대로 남긴다.
    html += '<details class="run-config-detail"><summary>자세한 설정 (어른용)</summary>' +
      '<div class="analysis-context">' + esc(contextLabel(cfg)) + '</div></details>';

    el('modal-body').innerHTML = html;
    run.modalRendered = true;
    bindCompareFilters();
    bindTimelinePlay(el('modal-body'));
    if (KJ.tableSort) KJ.tableSort.attachAll(el('modal-body')); // 표 열 정렬 유지
  }

  function statCard(label, val, cls) {
    return '<div class="stat-card' + (cls ? ' stat-' + cls : '') + '">' +
      '<div class="stat-val">' + esc(val) + '</div>' +
      '<div class="stat-label">' + esc(label) + '</div></div>';
  }

  // seed/dur 입력을 사용자가 만진 뒤에는 re-render가 값을 덮어쓰지 않음
  document.addEventListener('DOMContentLoaded', function () {
    var seedEl = el('sim-seed'), durEl = el('sim-dur');
    if (seedEl) seedEl.addEventListener('input', function () { inputTouched.seed = true; });
    if (durEl) durEl.addEventListener('input', function () { inputTouched.dur = true; });
    // 항적 로그 패널 접기/펼치기
    var col = el('tlog-collapse');
    if (col) col.addEventListener('click', function () {
      var body = el('tlog-body');
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      col.textContent = hidden ? '▾' : '▸';
    });
  });
})();
