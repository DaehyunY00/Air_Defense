/**
 * K-JAMDS 시뮬레이터 — 재생·시각화 탭 (Phase 4)
 *
 * DES trace 실행(engine/sim-engine.js의 trace:true) 결과를 requestAnimationFrame으로 재생한다.
 *  - 위협궤적 애니메이션: 축선 진입점→표적권역(js/data/axes.js) 선형보간, SVG 원 마커
 *  - 대기열 실시간 막대 + 노드 링: nodeSeries를 이진탐색해 현재 재생시각의 재고/용량 비율
 *  - Gantt 타임라인: 위협별 9단계 스테이지 타임스탬프를 구간 막대로 표시
 *  - 흐름도(Sankey형 funnel): 전체 결과(result.flow, 표본 아님)의 단계별 손실
 *  - 히트맵: 축선별 중복교전 위험도(analysis/overlap-heatmap.js)를 미니맵에 오버레이
 *
 * 성능: 마커 DOM 엘리먼트는 실행당 1회만 생성(최대 traceCap개)하고, 매 프레임은 속성만
 * 갱신한다(innerHTML 재작성 없음) — 60fps 목표를 위해 필수적인 설계.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var W = 900, H = 560;
  var FADE_SEC = 5; // 격추/누수 후 마커 페이드아웃 시간
  var SERVICE_COLOR = { af: '#2e6fd8', army: '#3d8b40', navy: '#00838f', joint: '#7b1fa2' };
  var THREAT_COLOR = {
    uav_small: '#ffd166', ac_low: '#ffd166', heli: '#ffd166',
    fighter: '#4ecdc4', cruise: '#ef476f', srbm: '#ff2d1a', mrl_large: '#ff8c42'
  };
  var STAGE_CATS = [
    [/^생성/, null], // 시작점, 구간 아님
    [/^탐지$/, 'detect'],
    [/^C2도착/, 'report'],
    [/^(C2처리완료|융합경유|융합처리완료)/, 'process'],
    [/^(협조개시|승인완료)/, 'coord'],
    [/^교전명령/, 'engage_cmd'],
    [/^(격추성공|교전실패)/, 'engage_result'],
    [/^누수/, 'leak']
  ];
  var CAT_COLOR = {
    detect: '#2e6fd8', report: '#7b1fa2', process: '#f0a020',
    coord: '#d32f2f', engage_cmd: '#00838f', engage_result: '#3d8b40', leak: '#666'
  };
  var CAT_LABEL = {
    detect: '탐지', report: '보고전달', process: 'C2처리', coord: '협조/승인',
    engage_cmd: '교전명령', engage_result: '교전결과', leak: '누수'
  };

  function categoryOf(name) {
    for (var i = 0; i < STAGE_CATS.length; i++) {
      if (STAGE_CATS[i][0].test(name)) return STAGE_CATS[i][1];
    }
    return 'other';
  }

  /** series(t 오름차순) 중 t 이하 최신 표본의 n 반환 (이진탐색) */
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

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ── 모듈 상태 ──
  var data = null;         // buildData() 결과 (실행 1회당 갱신)
  var els = null;          // DOM 엘리먼트 캐시 (실행 1회당 재생성)
  var pb = { playing: false, t: 0, speed: 1, lastTs: null, raf: null, dragging: false, selected: null, urlSyncAt: 0 };
  var currentState = null;
  // 사용자가 입력을 만진 뒤에는 re-render가 값을 되돌리지 않음 (리뷰 발견 4 수정)
  var inputTouched = { seed: false, dur: false };

  function contextLabel(cfg) {
    return KJ.scenarioById(cfg.sc).name + ' · ' +
      (cfg.mode === 'asis' ? 'As-Is 분절형' : 'To-Be K-JAMDS') +
      ' · 강도 ×' + Number(cfg.x).toFixed(1);
  }

  KJ.playbackPanel = {
    render: function (state) {
      currentState = state;
      if (!inputTouched.seed) el('pb-seed').value = state.seed;
      if (!inputTouched.dur) el('pb-dur').value = Math.min(state.dur, 900);
      // 실행 데이터가 있으면 그 실행 시점 설정을 표시 — 이후 컨트롤 변경으로
      // 라벨만 바뀌어 재생 데이터와 어긋나던 문제 수정 (리뷰 발견 3)
      if (data) {
        el('pb-context').textContent = contextLabel(data.runCfg) + ' (실행 기준)';
        // 딥링크 t= 복원 (데이터가 이미 있으면 해당 시각으로 이동, 정지 상태로 1프레임 렌더)
        if (state.t && state.t !== pb.t && !pb.playing) {
          pb.t = Math.min(state.t, data.dur);
          renderFrame(pb.t);
          syncTransportUI();
        }
      } else {
        el('pb-context').textContent = contextLabel(state);
        renderEmpty();
      }
    },

    run: function (state) {
      var btn = el('pb-run');
      btn.disabled = true; btn.textContent = '⏳ 재생용 정밀 실행 중...';
      var reqDur = Math.max(60, Math.min(900, parseInt(el('pb-dur').value, 10) || 600));
      var seed = Math.max(0, Math.floor(parseFloat(el('pb-seed').value) || 0));
      setTimeout(function () {
        this.pause();
        var result = KJ.runDES({
          scenario: KJ.scenarioById(state.sc), mode: state.mode, intensity: state.x,
          seed: seed, endTimeSec: reqDur, trace: true, traceCap: 300
        });
        data = buildData(result, state, reqDur);
        data.runCfg = { sc: state.sc, mode: state.mode, x: state.x, seed: seed, dur: reqDur };
        el('pb-context').textContent = contextLabel(data.runCfg) + ' (실행 기준)';
        buildStaticMap(state.mode);
        buildGanttRows();
        renderFunnel();
        renderHeatmap();
        pb.t = 0; pb.playing = false; pb.selected = null;
        el('pb-scrub').max = reqDur;
        el('pb-scrub').value = 0;
        renderFrame(0);
        syncTransportUI();
        btn.disabled = false; btn.textContent = '▶ 정밀 재생 실행';
      }.bind(this), 30);
    },

    play: function () {
      if (!data) return;
      pb.playing = true; pb.lastTs = null;
      el('pb-play').textContent = '⏸ 일시정지';
      loop();
    },

    pause: function () {
      pb.playing = false;
      if (pb.raf) { cancelAnimationFrame(pb.raf); pb.raf = null; }
      var btn = el('pb-play'); if (btn) btn.textContent = '▶ 재생';
    },

    togglePlay: function () { if (pb.playing) this.pause(); else this.play(); },

    setSpeed: function (v) { pb.speed = parseFloat(v) || 1; },

    scrub: function (v) {
      if (!data) return;
      pb.t = Math.max(0, Math.min(data.dur, parseFloat(v) || 0));
      renderFrame(pb.t);
    },

    dragStart: function () { pb.dragging = true; this.pause(); },
    dragEnd: function () { pb.dragging = false; },

    setGanttFilter: function (f) { buildGanttRows(f); },

    /** 탭 이탈 시 호출 — rAF 누수 방지 */
    onLeave: function () { this.pause(); }
  };

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'); // 속성값 삽입 대비 인용부호 포함 (리뷰 발견 5)
  }

  function renderEmpty() {
    el('pb-queues').innerHTML = '<div class="bn-none">먼저 "정밀 재생 실행"을 눌러 재생 데이터를 생성하세요.</div>';
    el('pb-funnel').innerHTML = '';
    el('pb-gantt').innerHTML = '';
    el('pb-heatmap').innerHTML = '';
    var svg = el('pb-svg'); if (svg) svg.innerHTML = '';
  }

  // ── 데이터 구성 ──
  function buildData(result, state, dur) {
    var scenario = KJ.scenarioById(state.sc);
    var threats = result.threatTraces.map(function (tr) {
      var cp = { spawn: tr.spawnT, detect: null, c2: null, engage: null };
      tr.stages.forEach(function (s) {
        var cat = categoryOf(s.name);
        if (cat === 'detect' && cp.detect === null) cp.detect = s.t;
        else if (cat === 'process' && cp.c2 === null) cp.c2 = s.t;
        else if (cat === 'engage_cmd' && cp.engage === null) cp.engage = s.t;
      });
      var tt = KJ.threatType(tr.type);
      return {
        id: tr.id, type: tr.type, axis: tr.axis, spawnT: tr.spawnT,
        exitT: tr.exitT, outcome: tr.outcome, dwellSec: tt.dwellSec,
        typeName: tt.name, stages: tr.stages, cp: cp
      };
    });
    var nodeMeta = {};
    result.nodes.forEach(function (n) { nodeMeta[n.id] = n; });
    return {
      result: result, threats: threats, nodeMeta: nodeMeta,
      nodeSeries: result.nodeSeries || {}, dur: dur, mode: state.mode,
      traceTruncated: !!result.traceTruncated,
      nodeSeriesTruncated: !!result.nodeSeriesTruncated
    };
  }

  // ── 정적 미니맵 구성 (실행당 1회, 노드/히트 배경) ──
  function buildStaticMap(mode) {
    var svg = el('pb-svg');
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var gHeat = ns('g'); gHeat.setAttribute('id', 'pb-heat-g');
    var gLinks = ns('g'); gLinks.setAttribute('opacity', '0.35');
    var gNodes = ns('g'); gNodes.setAttribute('id', 'pb-nodes-g');
    var gThreats = ns('g'); gThreats.setAttribute('id', 'pb-threats-g');
    svg.appendChild(gHeat); svg.appendChild(gLinks); svg.appendChild(gNodes); svg.appendChild(gThreats);

    // 배경 축선 히트 원 (실행 시점 설정 기준 — 이후 컨트롤 변경과 무관하게 재생 데이터와 정합)
    var cfg = data.runCfg;
    var heat = KJ.computeOverlapHeat(KJ.scenarioById(cfg.sc), mode, cfg.x);
    els = { threatEls: {}, nodeEls: {}, heatEls: {} };
    heat.axes.forEach(function (a) {
      var ax = KJ.AXES[a.axis];
      if (!ax) return;
      var p = KJ.geo.project(ax.entry, W, H);
      var c = ns('circle');
      c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', 42);
      c.setAttribute('fill', '#ff3b30'); c.setAttribute('opacity', (a.score * 0.55).toFixed(2));
      var t = ns('title'); t.textContent = ax.label + ' 중복교전 위험 raw=' + a.raw.toFixed(2);
      c.appendChild(t);
      gHeat.appendChild(c);
      els.heatEls[a.axis] = c;
    });

    // 링크 배경(연한 회색 선, 참고용)
    KJ.linksInMode(mode).forEach(function (l) {
      var from = KJ.nodeById(l.from), to = KJ.nodeById(l.to);
      if (!from || !to) return;
      var a = KJ.geo.project(from.coord, W, H), b = KJ.geo.project(to.coord, W, H);
      var line = ns('line');
      line.setAttribute('x1', a[0]); line.setAttribute('y1', a[1]);
      line.setAttribute('x2', b[0]); line.setAttribute('y2', b[1]);
      line.setAttribute('stroke', '#5a6b80'); line.setAttribute('stroke-width', '1');
      gLinks.appendChild(line);
    });

    // 노드 마커 (라이브 링으로 재고/용량 비율 표시)
    KJ.nodesInMode(mode).forEach(function (n) {
      var p = KJ.geo.project(n.coord, W, H);
      var g = ns('g');
      var ring = ns('circle');
      ring.setAttribute('cx', p[0]); ring.setAttribute('cy', p[1]); ring.setAttribute('r', 12);
      ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#e05545');
      ring.setAttribute('stroke-width', '0'); g.appendChild(ring);
      var shape;
      if (n.category === 'sensor') {
        shape = ns('circle');
        shape.setAttribute('cx', p[0]); shape.setAttribute('cy', p[1]); shape.setAttribute('r', 5);
      } else if (n.category === 'c2') {
        shape = ns('rect');
        shape.setAttribute('x', p[0] - 5); shape.setAttribute('y', p[1] - 5);
        shape.setAttribute('width', 10); shape.setAttribute('height', 10);
      } else {
        shape = ns('polygon');
        shape.setAttribute('points', p[0] + ',' + (p[1] - 6) + ' ' + (p[0] - 6) + ',' + (p[1] + 5) + ' ' + (p[0] + 6) + ',' + (p[1] + 5));
      }
      shape.setAttribute('fill', SERVICE_COLOR[n.service] || '#888');
      g.appendChild(shape);
      var label = ns('text');
      label.setAttribute('x', p[0]); label.setAttribute('y', p[1] + 18);
      label.setAttribute('font-size', '8'); label.setAttribute('fill', '#cfd8e3');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = n.id;
      g.appendChild(label);
      var title = ns('title'); title.textContent = n.name;
      g.appendChild(title);
      gNodes.appendChild(g);
      els.nodeEls[n.id] = { ring: ring };
    });

    // 위협 마커 (trace 표본, 최대 300개 — 실행당 1회 생성 후 프레임마다 속성만 갱신)
    data.threats.forEach(function (th) {
      var c = ns('circle');
      c.setAttribute('r', 4);
      c.setAttribute('fill', THREAT_COLOR[th.type] || '#fff');
      c.setAttribute('opacity', '0');
      var t = ns('title'); t.textContent = th.typeName + ' (' + th.axis + ') ' + th.id;
      c.appendChild(t);
      c.style.cursor = 'pointer';
      c.addEventListener('click', function () {
        pb.selected = th.id;
        highlightGanttRow(th.id);
      });
      gThreats.appendChild(c);
      els.threatEls[th.id] = c;
    });
  }

  function ns(tag) { return document.createElementNS(SVG_NS, tag); }

  // ── 프레임 렌더 (재생 루프에서 매 틱 호출, 60fps 목표 — DOM 생성 없이 속성만 갱신) ──
  function renderFrame(t) {
    if (!data || !els) return;

    // 위협 위치/가시성
    data.threats.forEach(function (th) {
      var elC = els.threatEls[th.id];
      if (!elC) return;
      if (t < th.spawnT) { elC.setAttribute('opacity', '0'); return; }
      var endT = th.exitT != null ? th.exitT : Math.min(t, th.spawnT + th.dwellSec);
      var clampT = Math.min(t, endT);
      var progress = (clampT - th.spawnT) / th.dwellSec;
      var pos = KJ.axisPosition(th.axis, progress);
      var p = KJ.geo.project(pos, W, H);
      elC.setAttribute('cx', p[0]); elC.setAttribute('cy', p[1]);
      var opacity = 1;
      if (th.exitT != null && t > th.exitT) {
        opacity = Math.max(0, 1 - (t - th.exitT) / FADE_SEC);
      }
      elC.setAttribute('opacity', opacity.toFixed(2));
      elC.setAttribute('r', th.id === pb.selected ? 7 : 4);
      elC.setAttribute('stroke', th.id === pb.selected ? '#fff' : 'none');
      elC.setAttribute('stroke-width', th.id === pb.selected ? '2' : '0');
    });

    // 노드 라이브 링(재고/용량 비율) + 대기열 막대
    var queueHtml = [];
    // 시계열 절삭 경고 표출 (리뷰 발견 2: 절삭 시 이후 시각의 재고가 stale — 숨기지 않음)
    if (data.nodeSeriesTruncated) {
      queueHtml.push('<div class="bn-item bn-sev2" style="grid-column:1/-1">⚠️ 노드 시계열 표본 상한 도달 — ' +
        '절삭 이후 시각의 재고 표시가 실제보다 오래된 값일 수 있습니다.</div>');
    }
    Object.keys(data.nodeMeta).forEach(function (id) {
      var meta = data.nodeMeta[id];
      var n = countAt(data.nodeSeries[id], t);
      var ratio = meta.K > 0 ? n / meta.K : 0;
      var nodeEl = els.nodeEls[id];
      if (nodeEl) {
        var strokeW = ratio >= 0.9 ? 4 : (ratio >= 0.7 ? 2.5 : 0);
        var color = ratio >= 0.9 ? '#ff2d1a' : '#e05545';
        nodeEl.ring.setAttribute('stroke-width', strokeW);
        nodeEl.ring.setAttribute('stroke', color);
      }
      var lv = ratio >= 0.9 ? 'saturated' : (ratio >= 0.7 ? 'bottleneck' : (n > 0 ? 'normal' : 'idle'));
      queueHtml.push(
        '<div class="pb-qcard">' +
        '<div class="pb-qname">' + esc(meta.name) + '</div>' +
        '<div class="rho-bar"><div class="rho-fill lv-' + lv + '" style="width:' +
        Math.min(100, ratio * 100).toFixed(0) + '%"></div>' +
        '<span>' + n + '/' + meta.K + '</span></div></div>'
      );
    });
    el('pb-queues').innerHTML = queueHtml.join('');

    updateTimeLabel();
  }

  function updateTimeLabel() {
    if (!data) return;
    el('pb-time').textContent = fmtTime(pb.t) + ' / ' + fmtTime(data.dur);
    if (!pb.dragging) el('pb-scrub').value = pb.t;
  }

  function syncTransportUI() {
    el('pb-play').textContent = pb.playing ? '⏸ 일시정지' : '▶ 재생';
    updateTimeLabel();
  }

  // ── 재생 루프 ──
  function loop(ts) {
    if (!pb.playing) return;
    if (pb.lastTs == null) pb.lastTs = ts || now();
    var cur = ts || now();
    var dt = (cur - pb.lastTs) / 1000;
    pb.lastTs = cur;
    pb.t += dt * pb.speed;
    if (pb.t >= data.dur) {
      pb.t = data.dur;
      renderFrame(pb.t);
      KJ.playbackPanel.pause();
      return;
    }
    renderFrame(pb.t);
    // 딥링크 t= 동기화 (스로틀 500ms, 히스토리 오염 없이 replaceState만 — 전체 재렌더 유발 안 함)
    if (cur - pb.urlSyncAt > 500) {
      pb.urlSyncAt = cur;
      currentState.t = Math.round(pb.t);
      KJ.router.apply(currentState);
    }
    pb.raf = requestAnimationFrame(loop);
  }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // ── Gantt ──
  var ganttFilter = 'all';
  function buildGanttRows(filter) {
    if (filter) ganttFilter = filter;
    if (!data) return;
    var list = data.threats.filter(function (th) {
      if (ganttFilter === 'killed') return th.outcome === 'killed';
      if (ganttFilter === 'leaked') return th.outcome && th.outcome.indexOf('leaked') === 0;
      return true;
    }).slice(0, 60);

    var rows = list.map(function (th) {
      var endT = th.exitT != null ? th.exitT : th.spawnT + th.dwellSec;
      var total = endT - th.spawnT;
      var segs = [];
      for (var i = 1; i < th.stages.length; i++) {
        var prev = th.stages[i - 1], curr = th.stages[i];
        var cat = categoryOf(curr.name);
        // 방어적 클램프: 단계 시각을 [spawnT, endT]로 제한 (엔진의 exitT 이후 _mark 차단과 이중 안전장치)
        var t1 = Math.min(Math.max(prev.t, th.spawnT), endT);
        var t2 = Math.min(Math.max(curr.t, th.spawnT), endT);
        var w = total > 0 ? Math.max(0, t2 - t1) / total * 100 : 0;
        segs.push('<div class="pb-seg" style="width:' + w.toFixed(2) + '%;background:' +
          (CAT_COLOR[cat] || '#555') + '" title="' + esc(CAT_LABEL[cat] || curr.name) + ' ' +
          (t2 - t1).toFixed(1) + 's"></div>');
      }
      var badge = th.outcome === 'killed' ? '<span class="badge badge-ok">격추</span>' :
        (th.outcome && th.outcome.indexOf('leaked') === 0 ? '<span class="badge badge-bad">누수</span>' :
          '<span class="badge badge-idle">진행중</span>');
      return '<div class="pb-gantt-row" data-tid="' + th.id + '">' +
        '<div class="pb-gantt-label">' + esc(th.typeName) + ' <span class="tl-axis">(' + esc(th.axis) + ')</span> ' + badge + '</div>' +
        '<div class="pb-gantt-bar">' + segs.join('') + '</div>' +
        '<div class="pb-gantt-total">' + total.toFixed(0) + 's</div></div>';
    }).join('');

    // 참고: 전역 재생 커서는 각 행이 자기 지속시간으로 정규화되어 있어 의미가 없으므로 제거 (리뷰 발견 6)
    el('pb-gantt').innerHTML = '<div class="pb-gantt-wrap">' + rows + '</div>';
    el('pb-gantt').querySelectorAll('.pb-gantt-row').forEach(function (row) {
      row.addEventListener('click', function () {
        pb.selected = row.dataset.tid;
        highlightGanttRow(pb.selected);
        renderFrame(pb.t);
      });
    });
    var note = el('pb-gantt-note');
    note.textContent = '표본(추적 ' + data.threats.length + '건' +
      (data.traceTruncated ? ', 상한 절삭됨 — 전체는 흐름도 참조' : '') + ') 중 ' + list.length + '건 표시.';
    highlightGanttRow(pb.selected);
  }

  function highlightGanttRow(id) {
    document.querySelectorAll('.pb-gantt-row').forEach(function (r) {
      r.classList.toggle('selected', r.dataset.tid === id);
    });
  }

  // ── 흐름도 (Sankey형 funnel) — 전체 결과(result.flow) 기준, 표본 아님 ──
  function renderFunnel() {
    var f = data.result.flow;
    var stages = [
      { label: '생성', n: f.spawned },
      { label: '탐지', n: f.detected },
      { label: 'C2 도달', n: f.reachedC2 },
      { label: '교전 개시', n: f.everEngaged },
      { label: '격추', n: f.killed }
    ];
    var max = f.spawned || 1;
    var rows = stages.map(function (s, i) {
      var w = (s.n / max * 100).toFixed(1);
      var lossLabel = '';
      if (i > 0) {
        var lost = stages[i - 1].n - s.n;
        if (lost > 0) lossLabel = '<span class="pb-loss">−' + lost + '</span>';
      }
      return '<div class="pb-funnel-row">' +
        '<div class="pb-funnel-label">' + s.label + '</div>' +
        '<div class="pb-funnel-track"><div class="pb-funnel-bar" style="width:' + w + '%"></div>' +
        '<span>' + s.n + '건</span></div>' + lossLabel + '</div>';
    }).join('');
    var leakRows = Object.keys(f.leakReasons).sort(function (a, b) { return f.leakReasons[b] - f.leakReasons[a]; })
      .map(function (r) { return '<span class="leak-chip">' + esc(leakLabel(r)) + ': <b>' + f.leakReasons[r] + '</b></span>'; })
      .join(' ');
    el('pb-funnel').innerHTML = rows +
      '<div class="note" style="margin-top:8px">누수 ' + f.leaked + '건 사유: ' + (leakRows || '없음') +
      '</div><div class="note">전체 ' + f.spawned + '건 기준(표본 아님). 격추까지 도달 못한 나머지는 진행중·드롭·누수.</div>';
  }
  var LEAK_LABEL = {
    not_detected: '미탐지', no_sensor: '탐지 공백', no_report_path: '보고경로 부재',
    responsibility_gap: '책임공백', no_shooter: '교전수단 부재', missed: '요격 실패', timeout: '처리지연 초과'
  };
  function leakLabel(r) {
    if (LEAK_LABEL[r]) return LEAK_LABEL[r];
    if (r.indexOf('overflow:') === 0) return '포화손실(' + r.slice(9) + ')';
    return r;
  }

  // ── 히트맵 (As-Is ↔ To-Be 비교, 축선별) ──
  function renderHeatmap() {
    var cfg = data.runCfg; // 실행 시점 설정 기준 (리뷰 발견 3)
    var scenario = KJ.scenarioById(cfg.sc);
    var a = KJ.computeOverlapHeat(scenario, 'asis', cfg.x);
    var b = KJ.computeOverlapHeat(scenario, 'tobe', cfg.x);
    var rows = a.axes.map(function (axA, i) {
      var axB = b.axes[i];
      var maxRaw = Math.max(axA.raw, axB.raw, 0.001);
      return '<div class="pb-heat-row">' +
        '<div class="pb-heat-label">' + esc(axA.label) + '</div>' +
        '<div class="pb-heat-bars">' +
        '<div class="pb-heat-bar asis" style="width:' + (axA.raw / maxRaw * 100).toFixed(0) + '%" title="As-Is raw=' + axA.raw.toFixed(2) + '"></div>' +
        '<div class="pb-heat-bar tobe" style="width:' + (axB.raw / maxRaw * 100).toFixed(0) + '%" title="To-Be raw=' + axB.raw.toFixed(2) + '"></div>' +
        '</div><div class="pb-heat-vals">' + axA.raw.toFixed(1) + ' → ' + axB.raw.toFixed(1) + '</div></div>';
    }).join('');
    el('pb-heatmap').innerHTML =
      '<div class="pb-heat-legend"><span class="sw" style="background:#e05545"></span>As-Is ' +
      '<span class="sw" style="background:#3d8b40"></span>To-Be (막대: 상대 중복교전 위험도)</div>' + rows;
    el('pb-heatmap-note').textContent =
      '중복교전 위험도 = 동일 위협클래스를 교전 가능한 서로 다른 통제계통이 협조지연 내에 ' +
      '제때 협조할 수 없는 조합 수 × 시나리오 부하(λ). 지도 위 빨간 원(실행 시점 모드)도 동일 값을 표시.';
  }

  // 사용자 입력 추적: 만진 뒤에는 re-render가 seed/dur 값을 덮어쓰지 않음 (리뷰 발견 4)
  document.addEventListener('DOMContentLoaded', function () {
    var seedEl = el('pb-seed'), durEl = el('pb-dur');
    if (seedEl) seedEl.addEventListener('input', function () { inputTouched.seed = true; });
    if (durEl) durEl.addEventListener('input', function () { inputTouched.dur = true; });
  });
})();
