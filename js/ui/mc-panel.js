/**
 * K-JAMDS 시뮬레이터 — Monte Carlo 탭 UI (Phase 3)
 *
 * DES 다중복제 결과의 신뢰구간·수렴판정, As-Is↔To-Be 통계적 유의성 비교, ±20% 민감도
 * 토네이도를 렌더한다. 계산은 analysis/mc-runner.js. 계산 부하가 있으므로 실행 버튼 클릭 시
 * 버튼 상태를 바꾸고 다음 프레임에 계산해 UI가 먼저 응답하도록 한다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function pp(x) { return (x * 100).toFixed(2) + '%p'; }

  var METRIC_META = {
    killRate: { label: '격추율', fmt: pct, kind: 'rate' },
    leakRate: { label: '요격 실패율', fmt: pct, kind: 'rate' },
    detectRate: { label: '탐지율', fmt: pct, kind: 'rate' },
    meanTimeToKillSec: { label: '평균 격추시간', fmt: function (x) { return x.toFixed(0) + '초'; }, kind: 'sec' },
    bottleneckCount: { label: '도출 병목 수', fmt: function (x) { return x.toFixed(2) + '개'; }, kind: 'count' }
  };

  var last = null;
  var lastState = null; // 임계 전환점 버튼(패널 내 자체 바인딩)이 클릭 시점 상태를 참조

  KJ.mcPanel = {
    render: function (state) {
      lastState = state;
      el('mc-seed').value = state.seed;
      el('mc-dur').value = state.dur;
      el('mc-context').textContent =
        KJ.scenarioById(state.sc).name + ' · ' +
        (state.mode === 'asis' ? 'As-Is 분절형' : 'To-Be K-JAMDS') +
        ' · 강도 ×' + Number(state.x).toFixed(1);
      if (last) this._renderResult(last);
    },

    run: function (state) {
      var btn = el('mc-run');
      btn.disabled = true; btn.textContent = '⏳ Monte Carlo 실행 중...';
      var maxReps = Math.max(30, Math.min(2000, parseInt(el('mc-maxreps').value, 10) || 500));
      var tol = Math.max(0.001, (parseFloat(el('mc-tol').value) || 1) / 100);
      var self = this;
      // 다음 프레임에 계산 → 버튼 상태가 먼저 그려짐
      setTimeout(function () {
        var t0 = now();
        var base = { scenario: KJ.scenarioById(state.sc), intensity: state.x, seed: state.seed, endTimeSec: state.dur };
        var cur = KJ.runMonteCarlo(Object.assign({ mode: state.mode }, base), { minReps: 30, maxReps: maxReps, tol: tol });
        var otherMode = state.mode === 'asis' ? 'tobe' : 'asis';
        var oth = KJ.runMonteCarlo(Object.assign({ mode: otherMode }, base), { minReps: 30, maxReps: maxReps, tol: tol });
        var sens = KJ.sensitivitySweep(Object.assign({ mode: state.mode }, base), { reps: Math.min(60, maxReps), deltaPct: 0.2 });
        last = { cur: cur, oth: oth, otherMode: otherMode, mode: state.mode, sens: sens, elapsed: now() - t0 };
        self._renderResult(last);
        btn.disabled = false; btn.textContent = '▶ Monte Carlo 실행';
      }, 30);
    },

    _renderResult: function (res) {
      var cur = res.cur, oth = res.oth;
      var modeName = res.mode === 'asis' ? 'As-Is' : 'To-Be';
      var otherName = res.otherMode === 'asis' ? 'As-Is' : 'To-Be';

      // ── 수렴 상태 ──
      var lr = cur.metrics.leakRate;
      el('mc-converge').innerHTML =
        '<div class="mc-conv ' + (cur.converged ? 'conv-ok' : 'conv-no') + '">' +
        (cur.converged
          ? '✅ 수렴: ' + cur.convergedAt + '회 복제에서 요격 실패율 95% 신뢰구간 반폭 ≤ 허용오차 ' + pp(cur.tol)
          : '⚠️ 미수렴: 상한 ' + cur.reps + '회까지 허용오차 ' + pp(cur.tol) + ' 미달 (반폭 ' + pp(lr.ci) + ')') +
        '</div>' +
        '<div class="note">' + modeName + ' · ' + cur.reps + '회 복제 · 각 복제 독립 시드(baseSeed=' +
        cur.config.seed + ' 파생) · 벽시계 ' + (res.elapsed || 0).toFixed(0) + 'ms</div>';

      // ── 지표별 통계 (현재 모드) ──
      el('mc-metrics-body').innerHTML = Object.keys(METRIC_META).map(function (k) {
        var m = cur.metrics[k], meta = METRIC_META[k];
        return '<tr><td>' + meta.label + '</td>' +
          '<td class="num">' + meta.fmt(m.mean) + '</td>' +
          '<td class="num">± ' + (meta.kind === 'rate' ? pp(m.ci) : (m.ci != null ? m.ci.toFixed(2) : '—')) + '</td>' +
          '<td class="num">[' + (m.lo != null ? meta.fmt(Math.max(0, m.lo)) : '—') + ', ' +
          (m.hi != null ? meta.fmt(m.hi) : '—') + ']</td>' +
          '<td class="num">' + m.n + '</td></tr>';
      }).join('');

      // ── As-Is ↔ To-Be 유의성 비교 ──
      el('mc-compare').innerHTML = this._compareTable(cur, oth, modeName, otherName);

      // ── 민감도 토네이도 ──
      el('mc-tornado').innerHTML = this._tornado(res.sens);
      el('mc-tornado-note').textContent =
        '기준 요격 실패율 ' + pct(res.sens.base) + ' 대비, 각 인자를 ±' + (res.sens.deltaPct * 100).toFixed(0) +
        '% 스케일했을 때의 요격 실패율 변동(' + res.sens.reps + '회 복제 평균). 스윙이 큰 인자가 요격 실패율을 가장 좌우 — ' +
        '개선 우선순위 근거(계획서 V&V 민감도분석).';
      if (KJ.tableSort) KJ.tableSort.attachAll(el('panel-mc')); // 숫자열 헤더 우측정렬 동기화
    },

    _compareTable: function (cur, oth, curName, othName) {
      function row(key) {
        var meta = METRIC_META[key];
        var a = cur.metrics[key], b = oth.metrics[key];
        var overlap = a.lo <= b.hi && b.lo <= a.hi;
        var better;
        if (key === 'leakRate' || key === 'meanTimeToKillSec' || key === 'bottleneckCount') better = cur.metrics[key].mean < oth.metrics[key].mean;
        else better = cur.metrics[key].mean > oth.metrics[key].mean;
        var sig = overlap ? '<span class="badge badge-idle">유의차 없음</span>'
          : '<span class="badge badge-ok">유의(95% CI 비중첩)</span>';
        return '<tr><td>' + meta.label + '</td>' +
          '<td class="num">' + meta.fmt(a.mean) + ' ± ' + (meta.kind === 'rate' ? pp(a.ci) : (a.ci != null ? a.ci.toFixed(2) : '—')) + '</td>' +
          '<td class="num">' + meta.fmt(b.mean) + ' ± ' + (meta.kind === 'rate' ? pp(b.ci) : (b.ci != null ? b.ci.toFixed(2) : '—')) + '</td>' +
          '<td>' + sig + '</td></tr>';
      }
      return '<table><thead><tr><th>지표</th><th>' + curName + ' (현재)</th><th>' + othName +
        '</th><th>통계적 유의성</th></tr></thead><tbody>' +
        ['killRate', 'leakRate', 'detectRate', 'meanTimeToKillSec', 'bottleneckCount'].map(row).join('') +
        '</tbody></table>' +
        '<div class="note">동일 시나리오·강도·baseSeed에서 체계 모드만 교체해 각각 독립 복제. 95% 신뢰구간이 ' +
        '겹치지 않으면 두 체계의 차이가 표본변동으로 설명되지 않는(통계적으로 유의한) 개선임을 뜻한다.</div>';
    },

    _tornado: function (sens) {
      var vals = [];
      sens.rows.forEach(function (r) { vals.push(r.low, r.high); });
      vals.push(sens.base);
      var max = Math.max.apply(null, vals) * 1.05 || 1;
      function x(v) { return (v / max * 100).toFixed(1); }
      var basePos = x(sens.base);
      var bars = sens.rows.map(function (r) {
        var lo = Math.min(r.low, r.high), hi = Math.max(r.low, r.high);
        // 왼쪽(개선) = 파랑, 오른쪽(악화) = 빨강 기준선 대비
        return '<div class="tor-row">' +
          '<div class="tor-label">' + esc(r.label) + '</div>' +
          '<div class="tor-track">' +
          '<div class="tor-base" style="left:' + basePos + '%"></div>' +
          '<div class="tor-bar" style="left:' + x(lo) + '%;width:' + (x(hi) - x(lo)) + '%"></div>' +
          '</div>' +
          '<div class="tor-swing">' + pp(r.swing) + '</div></div>';
      }).join('');
      return '<div class="tor-head"><span>인자</span><span>요격 실패율 변동 (기준선 ▎ ' + pct(sens.base) +
        ')</span><span>스윙</span></div>' + bars;
    }
  };

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // ── 임계 전환점 (Phase 5, 계획서 Recommendations 6) ──────────────────────────
  // 강도 스윕에서 As-Is/To-Be 요격 실패율 곡선과 ρ>0.9 임계 돌파점을 SVG 라인차트로 제시.
  // 계산은 analysis/transition.js (결정론적 — 동일 시나리오·seed → 동일 곡선).

  function runTransition() {
    if (!lastState) return;
    var btn = el('mc-transition-run');
    btn.disabled = true; btn.textContent = '⏳ 스윕 실행 중 (11점 × 2모드 × 20복제)...';
    var state = lastState;
    setTimeout(function () {
      var t0 = now();
      var r = KJ.analyzeTransition(KJ.scenarioById(state.sc), {
        reps: 20, seed: state.seed, endTimeSec: Math.min(state.dur, 1800)
      });
      renderTransition(r, state, now() - t0);
      btn.disabled = false; btn.textContent = '▶ 임계 전환점 스윕 실행';
    }, 30);
  }

  function renderTransition(r, state, elapsedMs) {
    var W = 760, H = 300, PAD = { l: 52, r: 16, t: 14, b: 34 };
    var xs = r.points.map(function (p) { return p.x; });
    var xMin = xs[0], xMax = xs[xs.length - 1];
    var yMax = Math.min(1, Math.max.apply(null, r.points.map(function (p) {
      return Math.max(p.asis.leakRate, p.tobe.leakRate);
    })) * 1.15);
    function px(x) { return PAD.l + (x - xMin) / (xMax - xMin) * (W - PAD.l - PAD.r); }
    function py(y) { return H - PAD.b - (y / yMax) * (H - PAD.t - PAD.b); }
    function poly(key) {
      return r.points.map(function (p) {
        return px(p.x).toFixed(1) + ',' + py(p[key].leakRate).toFixed(1);
      }).join(' ');
    }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px">';
    // 격자·축 라벨
    for (var g = 0; g <= 4; g++) {
      var yv = yMax * g / 4;
      svg += '<line x1="' + PAD.l + '" y1="' + py(yv) + '" x2="' + (W - PAD.r) + '" y2="' + py(yv) +
        '" stroke="#2e3947" stroke-width="1"/>' +
        '<text x="' + (PAD.l - 6) + '" y="' + (py(yv) + 3) + '" font-size="10" fill="#8a97a8" text-anchor="end">' +
        (yv * 100).toFixed(0) + '%</text>';
    }
    r.points.forEach(function (p) {
      svg += '<text x="' + px(p.x) + '" y="' + (H - PAD.b + 14) + '" font-size="10" fill="#8a97a8" text-anchor="middle">' +
        p.x.toFixed(2).replace(/\.?0+$/, '') + '×</text>';
    });
    // 임계 돌파 수직선 + 임계 이후 음영
    if (r.rho09CrossX !== null) {
      svg += '<rect x="' + px(r.rho09CrossX) + '" y="' + PAD.t + '" width="' +
        (W - PAD.r - px(r.rho09CrossX)) + '" height="' + (H - PAD.t - PAD.b) +
        '" fill="#ff2d1a" opacity="0.06"/>' +
        '<line x1="' + px(r.rho09CrossX) + '" y1="' + PAD.t + '" x2="' + px(r.rho09CrossX) +
        '" y2="' + (H - PAD.b) + '" stroke="#ff2d1a" stroke-width="1.5" stroke-dasharray="5 4"/>' +
        '<text x="' + (px(r.rho09CrossX) + 5) + '" y="' + (PAD.t + 12) +
        '" font-size="10" fill="#ff8d80">ρ≥0.9 임계 돌파 (×' + r.rho09CrossX + ')</text>';
    }
    // 곡선 + 점
    svg += '<polyline points="' + poly('asis') + '" fill="none" stroke="#e05545" stroke-width="2.5"/>';
    svg += '<polyline points="' + poly('tobe') + '" fill="none" stroke="#3d8b40" stroke-width="2.5"/>';
    r.points.forEach(function (p) {
      svg += '<circle cx="' + px(p.x) + '" cy="' + py(p.asis.leakRate) + '" r="3.5" fill="#e05545">' +
        '<title>As-Is ×' + p.x + ': 요격 실패율 ' + pct(p.asis.leakRate) + ' (±' + pp(p.asis.leakCI) +
        '), C2 최대 ρ=' + p.asis.maxC2Rho.toFixed(2) + '</title></circle>' +
        '<circle cx="' + px(p.x) + '" cy="' + py(p.tobe.leakRate) + '" r="3.5" fill="#3d8b40">' +
        '<title>To-Be ×' + p.x + ': 요격 실패율 ' + pct(p.tobe.leakRate) + ' (±' + pp(p.tobe.leakCI) + ')</title></circle>';
    });
    // 최대 격차 마커
    if (r.maxGapX !== null) {
      var mp = r.points.find(function (p) { return p.x === r.maxGapX; });
      svg += '<line x1="' + px(r.maxGapX) + '" y1="' + py(mp.asis.leakRate) + '" x2="' + px(r.maxGapX) +
        '" y2="' + py(mp.tobe.leakRate) + '" stroke="#f0a020" stroke-width="2"/>' +
        '<text x="' + (px(r.maxGapX) + 6) + '" y="' + ((py(mp.asis.leakRate) + py(mp.tobe.leakRate)) / 2 + 3) +
        '" font-size="10" fill="#ffcf70">최대 격차 ' + pp(r.maxGap) + '</text>';
    }
    svg += '</svg>';

    el('mc-transition').innerHTML =
      '<div class="tl-legend" style="margin:6px 0">' +
      '<span><span class="sw" style="background:#e05545"></span>As-Is 요격 실패율</span>' +
      '<span><span class="sw" style="background:#3d8b40"></span>To-Be 요격 실패율</span>' +
      '<span>가로축: 위협 강도 배수 · 점 툴팁: 95% CI·C2 최대 ρ</span></div>' + svg;

    el('mc-transition-note').textContent =
      esc(KJ.scenarioById(state.sc).name) + ' 기준 — ' +
      (r.rho09CrossX !== null
        ? 'As-Is C2 최대 이용률이 강도 ×' + r.rho09CrossX + '에서 임계(ρ=0.9)를 돌파. ' +
          '임계 이전 평균 개선폭 ' + pp(r.preGapMean) + ' → 임계 이후 ' + pp(r.postGapMean) +
          '로 확대(최대 ' + pp(r.maxGap) + ' @ ×' + r.maxGapX + '). ' +
          '포화 구간에서 통합 C2(Track Fusion·자동 WTA·데이터링크)의 가치가 비선형적으로 커진다는 것이 핵심 논증.'
        : '전 스윕 구간에서 As-Is C2 최대 ρ<0.9 — 이 시나리오는 처리용량 임계에 도달하지 않음(전환점은 시나리오의 함수).') +
      ' [' + r.reps + '복제/점 · ' + (elapsedMs / 1000).toFixed(1) + 's · seed=' + r.seed + ' 결정론적]';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = el('mc-transition-run');
    if (btn) btn.addEventListener('click', runTransition);
  });
})();
