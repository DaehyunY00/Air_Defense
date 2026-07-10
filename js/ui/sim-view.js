/**
 * K-JAMDS 시뮬레이터 — 통합 시뮬레이션 뷰 (실행 → 지도 시각화 → 결과창)
 *
 * 사용 흐름(요구 반영):
 *  1) [시뮬레이션 시작] → DES(trace)를 즉시 실행하고, 동일 seed 반대 모드 DES와
 *     Monte Carlo(양 모드)를 백그라운드로 수행한다.
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
  // 요격 실패(구 '누수') 세부 사유 — 전체 개념이 '요격 실패'이므로 missed는 '명중 실패'로 구분
  var LEAK_LABEL = {
    not_detected: '미탐지', no_sensor: '탐지 공백(센서 부재)', no_report_path: '보고경로 부재',
    responsibility_gap: '책임공백(협조경로 부재)', no_shooter: '교전수단 부재(제약)',
    missed: '명중 실패(기회소진)', timeout: '처리지연 초과(공역이탈)'
  };
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
    if (name === '융합경유') return '③ JAMDC2 융합 경유';
    if (name === '융합처리완료') return '④⑤ 융합·AI식별·WTA (JAMDC2)';
    if (name.indexOf('협조개시:') === 0) return '⑥⑦ 결심·교전협조 (' + name.slice(5) + ')';
    if (name.indexOf('승인완료:') === 0) return '⑥ 교전승인 (' + name.slice(5) + ')';
    if (name.indexOf('교전명령#') === 0) return '⑧ ' + name;
    if (name.indexOf('격추성공#') === 0) return '⑨ BDA: 격추 ✔';
    if (name.indexOf('교전실패#') === 0) return '⑨ BDA: ' + name;
    if (name.indexOf('누수:') === 0) return '✖ 요격 실패: ' + leakLabel(name.slice(3));
    return name;
  }

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
  var run = null;   // { cfg, res, resOther, threats, nodeMeta, mc:{asis,tobe,pending} }
  var anim = { playing: false, t: 0, speed: 30, lastTs: null, raf: null, done: false };
  var layers = null; // { canvasRenderer, threatMarkers:{}, nodeRings:{}, group }
  var currentState = null;
  var inputTouched = { seed: false, dur: false };
  var tlog = { els: {}, lastUpdate: 0 }; // 위협 항적 로그 패널 상태 (실행당 재구성)

  function contextLabel(cfg) {
    return KJ.scenarioById(cfg.sc).name + ' · ' +
      (cfg.mode === 'asis' ? 'As-Is 분절형' : 'To-Be 통합형') +
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
      var seed = Math.max(0, Math.floor(parseFloat(el('sim-seed').value) || 0));
      var dur = Math.min(7200, Math.max(60, Math.floor(parseFloat(el('sim-dur').value) || 1800)));
      var cfg = { sc: state.sc, mode: state.mode, x: state.x, seed: seed, dur: dur };
      var btn = el('sim-run');
      btn.disabled = true; btn.textContent = '⏳ DES 실행 중...';
      setStatus('DES 실행 중 (trace 모드)...');

      setTimeout(function () {
        var scenario = KJ.scenarioById(cfg.sc);
        var t0 = now();
        var res = KJ.runDES({
          scenario: scenario, mode: cfg.mode, intensity: cfg.x,
          seed: cfg.seed, endTimeSec: cfg.dur, trace: true, traceCap: 300
        });
        var other = cfg.mode === 'asis' ? 'tobe' : 'asis';
        var resOther = KJ.runDES({
          scenario: scenario, mode: other, intensity: cfg.x,
          seed: cfg.seed, endTimeSec: cfg.dur
        });
        var elapsed = now() - t0;

        run = {
          cfg: cfg, res: res, resOther: resOther, otherMode: other,
          elapsedMs: elapsed, nodeMeta: {}, threats: buildThreats(res),
          mc: { pending: true, asis: null, tobe: null }
        };
        res.nodes.forEach(function (n) { run.nodeMeta[n.id] = n; });

        // 병목 하이라이트를 이번 DES 실행 결과로 갱신 (해석 근사 아님)
        KJ.mapView.render(currentState, { nodes: res.nodes });

        // 백그라운드 Monte Carlo (양 모드, 수렴판정) — 요구: "백그라운드에서 DES·MC 수행"
        setStatus('백그라운드 Monte Carlo 수렴 중...');
        setTimeout(function () {
          var mcOpts = { minReps: 30, maxReps: 200, tol: 0.01, primary: 'leakRate' };
          run.mc.asis = KJ.runMonteCarlo({ scenario: scenario, mode: 'asis', intensity: cfg.x, seed: cfg.seed, endTimeSec: cfg.dur }, mcOpts);
          run.mc.tobe = KJ.runMonteCarlo({ scenario: scenario, mode: 'tobe', intensity: cfg.x, seed: cfg.seed, endTimeSec: cfg.dur }, mcOpts);
          run.mc.pending = false;
          setStatus(anim.playing ? '재생 중 — MC 수렴 완료 (' + run.mc.asis.reps + '·' + run.mc.tobe.reps + '복제)' : 'MC 수렴 완료');
          renderModalIfOpen();
        }, 60);

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
      }, 30);
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
      renderModal();
    },

    hideResults: function () {
      el('result-modal').classList.add('hidden');
      // 재생이 끝나지 않았으면 이어서 재생
      if (run && !anim.done && !KJ.mapView.isFallback()) play();
    },

    setSpeed: function (v) { anim.speed = parseFloat(v) || 30; },

    toggleRings: function (v) { KJ.mapView.setRingsVisible(v); },

    /** 탭 이탈·재실행 시 정리 (rAF 누수 방지) */
    stop: function () {
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
    },

    onLeave: function () { pause(); }
  };

  function setStatus(msg) { var s = el('sim-status'); if (s) s.textContent = msg; }
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

  // ── Leaflet 애니메이션 레이어 (canvas 렌더러 — 300 마커 60fps) ──
  function buildLayers(mode) {
    var map = KJ.mapView.getMap();
    if (!map) return;
    var renderer = L.canvas({ padding: 0.3 });
    var group = L.layerGroup().addTo(map);
    layers = { renderer: renderer, group: group, threatMarkers: {}, nodeRings: {} };

    // 노드 재고 링 (재고/용량 비율에 따라 굵기·색 갱신)
    Object.keys(run.nodeMeta).forEach(function (id) {
      var n = KJ.nodeById(id);
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
      var entry = KJ.axisPosition(th.axis, 0);
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
      renderFrame(anim.t);
      updateThreatLog(anim.t);
      pause();
      anim.done = true;
      syncPlayBtn();
      setStatus('재생 종료 — 결과창을 표시합니다.');
      KJ.simView.showResults(); // 요구: 시뮬레이션 종료 시 결과창
      return;
    }
    renderFrame(anim.t);
    scheduleNext();
  }

  var FADE_SEC = 6;
  function renderFrame(t) {
    if (!run || !layers) return;
    // 위협 위치·가시성
    run.threats.forEach(function (th) {
      var m = layers.threatMarkers[th.id];
      if (!m) return;
      if (t < th.spawnT) {
        if (m.options.opacity !== 0) m.setStyle({ opacity: 0, fillOpacity: 0 });
        return;
      }
      var endT = th.exitT != null ? th.exitT : Math.min(t, th.spawnT + th.dwellSec);
      var clampT = Math.min(t, endT);
      var progress = (clampT - th.spawnT) / th.dwellSec;
      var pos = KJ.axisPosition(th.axis, progress);
      if (pos) m.setLatLng([pos[0] + th.offLat, pos[1] + th.offLon]);
      var op = 1;
      if (th.exitT != null && t > th.exitT) op = Math.max(0, 1 - (t - th.exitT) / FADE_SEC);
      var killed = th.outcome === 'killed' && th.exitT != null && t >= th.exitT;
      m.setStyle({
        opacity: op * 0.9, fillOpacity: op * 0.9,
        color: killed ? '#7dd982' : '#0008', weight: killed ? 2 : 1
      });
    });
    // 노드 재고 링
    var series = run.res.nodeSeries || {};
    Object.keys(run.nodeMeta).forEach(function (id) {
      var ring = layers.nodeRings[id];
      if (!ring) return;
      var meta = run.nodeMeta[id];
      var n = countAt(series[id], t);
      var ratio = meta.K > 0 ? n / meta.K : 0;
      ring.setStyle({
        weight: ratio >= 0.9 ? 4 : (ratio >= 0.7 ? 2.5 : (n > 0 ? 1 : 0)),
        color: ratio >= 0.9 ? '#ff2d1a' : (ratio >= 0.7 ? '#e05545' : '#f0a020')
      });
    });
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
  function renderModalIfOpen() {
    if (!el('result-modal').classList.contains('hidden')) renderModal();
  }

  function renderModal() {
    if (!run) return;
    var g = run.res.global, o = run.resOther.global;
    var modeName = run.cfg.mode === 'asis' ? 'As-Is 분절형' : 'To-Be 통합형';
    var otherName = run.otherMode === 'asis' ? 'As-Is 분절형' : 'To-Be 통합형';
    var html = '';

    html += '<div class="analysis-context">' + esc(contextLabel(run.cfg)) +
      ' · 시뮬레이션 ' + run.cfg.dur + '초 · 처리 ' + run.res.eventCount.toLocaleString() +
      '이벤트 · 벽시계 ' + run.elapsedMs.toFixed(0) + 'ms (결정론적 재현 가능)</div>';

    // ① 결과 요약
    html += '<h3>결과 요약 (' + esc(modeName) + ')</h3><div class="stat-grid">' +
      statCard('생성 위협', g.spawned + '건') +
      statCard('탐지', g.detected + '건') +
      statCard('격추', g.killed + '건 (' + pct(g.killRate) + ')') +
      statCard('요격 실패', g.leaked + '건 (' + pct(g.leakRate) + ')', g.leakRate > 0.3 ? 'crit' : '') +
      statCard('평균 격추시간', g.meanTimeToKillSec.toFixed(0) + '초') +
      statCard('도출 병목', run.res.bottlenecks.length + '건') + '</div>';

    // ② As-Is ↔ To-Be 좌·우 직관 비교 (현재 모드와 무관하게 좌=As-Is, 우=To-Be로 고정)
    var asisG = run.cfg.mode === 'asis' ? g : o;
    var tobeG = run.cfg.mode === 'asis' ? o : g;
    var asisRes = run.cfg.mode === 'asis' ? run.res : run.resOther;
    var tobeRes = run.cfg.mode === 'asis' ? run.resOther : run.res;
    html += '<h3>As-Is ↔ To-Be 정량 비교 (좌: 분절형 · 우: 통합형, 동일 seed)</h3>' +
      vsCompare(asisG, tobeG, asisRes, tobeRes);

    // ③ Monte Carlo 95% CI (백그라운드)
    html += '<h3>Monte Carlo 95% 신뢰구간 (백그라운드 다중복제)</h3>';
    if (run.mc.pending) {
      html += '<div class="bn-none">⏳ 백그라운드 수렴 중 — 완료되면 자동 갱신됩니다.</div>';
    } else {
      var ma = run.mc.asis.metrics.leakRate, mb = run.mc.tobe.metrics.leakRate;
      var overlapCI = ma.lo <= mb.hi && mb.lo <= ma.hi;
      html += '<table><thead><tr><th>모드</th><th>요격 실패율 평균</th><th>95% CI</th><th>복제수</th></tr></thead><tbody>' +
        '<tr><td>As-Is</td><td class="num">' + (ma.mean * 100).toFixed(1) + '%</td><td class="num">±' +
        (ma.ci * 100).toFixed(2) + '%p</td><td class="num">' + ma.n + '</td></tr>' +
        '<tr><td>To-Be</td><td class="num">' + (mb.mean * 100).toFixed(1) + '%</td><td class="num">±' +
        (mb.ci * 100).toFixed(2) + '%p</td><td class="num">' + mb.n + '</td></tr></tbody></table>' +
        '<div class="note">' + (overlapCI
          ? '두 CI가 겹칩니다 — 이 조건에서 차이는 표본변동으로 설명될 수 있습니다.'
          : '✅ 두 95% CI 비중첩 — To-Be 개선이 표본변동으로 설명되지 않는 유의한 차이입니다.') + '</div>';
    }

    // ④ 도출된 병목
    html += '<h3>🔎 도출된 병목 (관측 통계 기반)</h3>';
    html += run.res.bottlenecks.length
      ? '<ul class="modal-bn">' + run.res.bottlenecks.map(function (b) {
        return '<li class="bn-item bn-sev' + b.severity + '">' + KIND_ICON[b.kind] +
          ' <b>' + esc(b.name) + '</b><br><span class="bn-detail">' + esc(b.detail) + '</span></li>';
      }).join('') + '</ul>'
      : '<div class="bn-none">이 실행에서 도출된 병목 없음 (병목은 부하의 함수 — 강도·시나리오를 바꿔보세요)</div>';

    // ⑤ 요격 실패 사유
    var reasons = Object.keys(g.leakReasons);
    html += '<h3>요격 실패 사유 분해</h3><div class="leak-row">' + (reasons.length
      ? reasons.sort(function (a, b) { return g.leakReasons[b] - g.leakReasons[a]; })
        .map(function (r) {
          return '<span class="leak-chip">' + esc(leakLabel(r)) + ': <b>' + g.leakReasons[r] + '</b></span>';
        }).join(' ')
      : '<span class="bn-none">요격 실패 없음</span>') + '</div>';

    // ⑥ 단계별 흐름 (funnel)
    var f = run.res.flow;
    var stages = [
      { label: '생성', n: f.spawned }, { label: '탐지', n: f.detected },
      { label: 'C2 도달', n: f.reachedC2 }, { label: '교전 개시', n: f.everEngaged },
      { label: '격추', n: f.killed }
    ];
    var maxN = f.spawned || 1;
    html += '<h3>단계별 흐름 (생성→탐지→C2→교전→격추)</h3>' + stages.map(function (s, i) {
      var w = (s.n / maxN * 100).toFixed(1);
      var loss = i > 0 ? stages[i - 1].n - s.n : 0;
      return '<div class="pb-funnel-row"><div class="pb-funnel-label">' + s.label + '</div>' +
        '<div class="pb-funnel-track"><div class="pb-funnel-bar" style="width:' + w + '%"></div>' +
        '<span>' + s.n + '건</span></div>' +
        (loss > 0 ? '<span class="pb-loss">−' + loss + '</span>' : '<span class="pb-loss"></span>') + '</div>';
    }).join('');

    // ⑦ 중복교전 위험 (As-Is ↔ To-Be, 축선별)
    var scenario = KJ.scenarioById(run.cfg.sc);
    var ha = KJ.computeOverlapHeat(scenario, 'asis', run.cfg.x);
    var hb = KJ.computeOverlapHeat(scenario, 'tobe', run.cfg.x);
    html += '<h3>축선별 중복교전 위험 (As-Is ↔ To-Be)</h3>' +
      '<div class="pb-heat-legend"><span class="sw" style="background:#e05545"></span>As-Is ' +
      '<span class="sw" style="background:#3d8b40"></span>To-Be</div>' +
      ha.axes.map(function (axA, i) {
        var axB = hb.axes[i];
        var maxRaw = Math.max(axA.raw, axB.raw, 0.001);
        return '<div class="pb-heat-row"><div class="pb-heat-label">' + esc(axA.label) + '</div>' +
          '<div class="pb-heat-bars">' +
          '<div class="pb-heat-bar asis" style="width:' + (axA.raw / maxRaw * 100).toFixed(0) + '%"></div>' +
          '<div class="pb-heat-bar tobe" style="width:' + (axB.raw / maxRaw * 100).toFixed(0) + '%"></div>' +
          '</div><div class="pb-heat-vals">' + axA.raw.toFixed(1) + ' → ' + axB.raw.toFixed(1) + '</div></div>';
      }).join('');

    // ⑧ 노드 관측 통계
    html += '<h3>노드 관측 통계 (ρ 내림차순)</h3>' +
      '<table><thead><tr><th>노드</th><th>구분</th><th>도착</th><th>완료</th><th>드롭</th>' +
      '<th>관측 ρ</th><th>평균대기</th><th>판정</th></tr></thead><tbody>' +
      (run.res.nodes.slice().filter(function (n) { return n.arrivals > 0; })
        .sort(function (a, b) { return b.rho - a.rho; })
        .map(function (n) {
          var bar = Math.min(100, n.rho * 100);
          return '<tr class="row-' + n.level + '"><td>' + esc(n.name) + '</td>' +
            '<td>' + (n.category === 'c2' ? 'C2' : '교전') + '</td>' +
            '<td class="num">' + n.arrivals + '</td><td class="num">' + n.completions + '</td>' +
            '<td class="num">' + (n.drops > 0 ? '<b style="color:#ff9a8d">' + n.drops + '</b>' : '0') + '</td>' +
            '<td><div class="rho-bar"><div class="rho-fill lv-' + n.level + '" style="width:' + bar +
            '%"></div><span>' + n.rho.toFixed(2) + '</span></div></td>' +
            '<td class="num">' + n.Wq.toFixed(1) + 's</td>' +
            '<td>' + LEVEL_BADGE[n.level] + '</td></tr>';
        }).join('') ||
        '<tr><td colspan="8" class="bn-none">C2·무기 노드에 도달한 항적이 없습니다.</td></tr>') +
      '</tbody></table>';

    html += '<div class="note">모든 수치는 공개자료 기반 정책연구용 개념값이며 실제 작전자료가 아닙니다. ' +
      '정밀 검토는 [병목 분석]·[Monte Carlo] 탭(민감도 토네이도·임계 전환점 포함)을 이용하세요.</div>';

    el('modal-body').innerHTML = html;
    if (KJ.tableSort) KJ.tableSort.attachAll(el('modal-body')); // 모달 표도 열 정렬 지원
  }

  function leakLabel(r) {
    if (LEAK_LABEL[r]) return LEAK_LABEL[r];
    if (r.indexOf('overflow:') === 0) return '포화손실(' + r.slice(9) + ')';
    return r;
  }
  function statCard(label, val, cls) {
    return '<div class="stat-card' + (cls ? ' stat-' + cls : '') + '">' +
      '<div class="stat-val">' + esc(val) + '</div>' +
      '<div class="stat-label">' + esc(label) + '</div></div>';
  }
  function signed(n) { return (n > 0 ? '+' : '') + n; }

  /**
   * As-Is(좌)↔To-Be(우) 좌·우 발산형 시각 비교 블록.
   * 각 지표를 중앙 라벨 기준으로 왼쪽(As-Is, 적색)·오른쪽(To-Be, 초록) 막대로 마주보게 그려
   * 어느 쪽이 크고 얼마나 개선됐는지 한눈에 보이게 한다.
   */
  function vsCompare(asisG, tobeG, asisRes, tobeRes) {
    var rows = [
      { label: '요격 실패율', a: asisG.leakRate, b: tobeG.leakRate, kind: 'rate', lower: true, max: 1 },
      { label: '격추율', a: asisG.killRate, b: tobeG.killRate, kind: 'rate', lower: false, max: 1 },
      { label: '평균 격추시간', a: asisG.meanTimeToKillSec, b: tobeG.meanTimeToKillSec, kind: 'sec', lower: true },
      { label: '도출 병목 수', a: asisRes.bottlenecks.length, b: tobeRes.bottlenecks.length, kind: 'cnt', lower: true }
    ];
    function fmt(v, kind) {
      if (kind === 'rate') return (v * 100).toFixed(0) + '%';
      if (kind === 'sec') return v.toFixed(0) + '초';
      return v + '건';
    }
    function deltaText(d, kind) {
      var av = Math.abs(d);
      if (kind === 'rate') return (av * 100).toFixed(0) + '%p';
      if (kind === 'sec') return av.toFixed(0) + '초';
      return av + '건';
    }
    var body = rows.map(function (r) {
      var max = r.max || Math.max(r.a, r.b, 1e-9);
      var aw = Math.min(100, r.a / max * 100), bw = Math.min(100, r.b / max * 100);
      var d = r.b - r.a;                       // To-Be − As-Is
      var improved = r.lower ? d < 0 : d > 0;
      var same = Math.abs(d) < (r.kind === 'cnt' ? 0.5 : 1e-9);
      // 화살표 = 값 변화 방향(▲증가·▼감소), 색·라벨 = 개선/악화 (지표별 좋은 방향이 다름)
      var arrow = same ? '=' : (d > 0 ? '▲' : '▼');
      var dcls = same ? 'vs-flat' : (improved ? 'vs-good' : 'vs-bad');
      var deltaLabel = same ? '동일' : (arrow + ' ' + deltaText(d, r.kind) + (improved ? ' 개선' : ' 악화'));
      return '<div class="vs-row">' +
        '<div class="vs-val asis">' + fmt(r.a, r.kind) + '</div>' +
        '<div class="vs-track l"><div class="vs-fill asis" style="width:' + aw.toFixed(0) + '%"></div></div>' +
        '<div class="vs-mid"><div class="vs-metric">' + esc(r.label) + '</div>' +
        '<div class="vs-delta ' + dcls + '">' + deltaLabel + '</div></div>' +
        '<div class="vs-track r"><div class="vs-fill tobe" style="width:' + bw.toFixed(0) + '%"></div></div>' +
        '<div class="vs-val tobe">' + fmt(r.b, r.kind) + '</div>' +
        '</div>';
    }).join('');
    return '<div class="vs-block">' +
      '<div class="vs-headrow"><div class="vs-side asis">◀ As-Is 분절형</div>' +
      '<div class="vs-side-mid">지표</div>' +
      '<div class="vs-side tobe">To-Be 통합형 ▶</div></div>' +
      body +
      '<div class="note">막대 길이 = 값의 상대 크기(요격 실패율·격추율은 0~100%, 나머지는 두 값 중 최대 기준). ' +
      '가운데 화살표 초록 ▼/▲ = To-Be가 개선된 방향.</div></div>';
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
