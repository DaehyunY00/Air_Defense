/**
 * K-JAMDS 시뮬레이터 — DES 시뮬레이션 탭 UI (Phase 2)
 *
 * 이산사건 시뮬레이션 엔진(engine/sim-engine.js)을 브라우저에서 단일 복제(replication)로
 * 구동하고 관측 통계·도출 병목을 표시한다. Monte Carlo 다중복제·수렴판정은 Phase 3.
 * 시각화 애니메이션(궤적·Gantt·Sankey)은 Phase 4.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function el(id) { return document.getElementById(id); }

  var LEVEL_BADGE = {
    idle: '<span class="badge badge-idle">유휴</span>',
    normal: '<span class="badge badge-ok">정상</span>',
    warn: '<span class="badge badge-warn">주의 ρ≥0.7</span>',
    bottleneck: '<span class="badge badge-bad">병목 ρ≥0.9</span>',
    saturated: '<span class="badge badge-crit">포화(드롭)</span>'
  };
  var KIND_ICON = { node: '⬛', link: '🔗', gap: '⚠️' };
  var LEAK_LABEL = {
    not_detected: '미탐지', no_sensor: '탐지 공백(센서 부재)', no_report_path: '보고경로 부재',
    responsibility_gap: '책임공백(협조경로 부재)', no_shooter: '교전수단 부재(제약)',
    missed: '요격 실패(기회소진)', timeout: '처리지연 초과(공역이탈)'
  };

  var lastResult = null;

  KJ.desPanel = {
    /** 상태로부터 컨트롤 동기화 후, 이전 결과가 있으면 렌더 */
    render: function (state) {
      el('des-seed').value = state.seed;
      el('des-dur').value = state.dur;
      el('des-context').textContent =
        KJ.scenarioById(state.sc).name + ' · ' +
        (state.mode === 'asis' ? 'As-Is 분절형' : 'To-Be K-JAMDS') +
        ' · 강도 ×' + Number(state.x).toFixed(1);
      if (lastResult) this._renderResult(lastResult);
    },

    /** 실행 버튼 → 현재 시나리오/모드/강도 + 패널 seed/dur로 단일 복제 실행 */
    run: function (state) {
      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      var res = KJ.runDES({
        scenario: KJ.scenarioById(state.sc), mode: state.mode,
        intensity: state.x, seed: state.seed, endTimeSec: state.dur
      });
      // 동일 seed로 반대 모드도 실행해 비교 (As-Is ↔ To-Be)
      var other = state.mode === 'asis' ? 'tobe' : 'asis';
      var resOther = KJ.runDES({
        scenario: KJ.scenarioById(state.sc), mode: other,
        intensity: state.x, seed: state.seed, endTimeSec: state.dur
      });
      res._other = resOther; res._otherMode = other;
      res._elapsedMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
      lastResult = res;
      this._renderResult(res);
    },

    _renderResult: function (res) {
      var g = res.global, o = res._other.global;
      var mode = res.config.mode;
      var modeName = mode === 'asis' ? 'As-Is' : 'To-Be';
      var otherName = res._otherMode === 'asis' ? 'As-Is' : 'To-Be';

      // ── 결과 요약 카드 ──
      function pct(x) { return (x * 100).toFixed(0) + '%'; }
      el('des-summary').innerHTML =
        card('생성 위협', g.spawned + '건') +
        card('탐지', g.detected + '건') +
        card('격추', g.killed + '건 (' + pct(g.killRate) + ')') +
        card('누수', g.leaked + '건 (' + pct(g.leakRate) + ')', g.leakRate > 0.3 ? 'crit' : '') +
        card('평균 격추시간', g.meanTimeToKillSec.toFixed(0) + '초') +
        card('처리 이벤트', res.eventCount.toLocaleString() + '건');

      // ── 모드 비교 ──
      el('des-compare').innerHTML =
        '<table><thead><tr><th>지표</th><th>' + modeName + ' (현재)</th><th>' + otherName +
        ' (동일 seed)</th><th>차이</th></tr></thead><tbody>' +
        cmpRow('격추율', g.killRate, o.killRate, true) +
        cmpRow('누수율', g.leakRate, o.leakRate, false) +
        '<tr><td>도출 병목 수</td><td class="num">' + res.bottlenecks.length +
        '</td><td class="num">' + res._other.bottlenecks.length + '</td><td class="num">' +
        signed(res.bottlenecks.length - res._other.bottlenecks.length) + '</td></tr>' +
        '</tbody></table>' +
        '<div class="note">동일 시나리오·강도·seed에서 체계 모드만 바꿔 비교. To-Be가 As-Is 대비 ' +
        '누수율을 낮추는 구간이 K-JAMDS 투자정당화의 핵심(계획서 Recommendations 6).</div>';

      // ── 도출 병목 ──
      el('des-bottlenecks').innerHTML = res.bottlenecks.length
        ? '<ul>' + res.bottlenecks.map(function (b) {
          return '<li class="bn-item bn-sev' + b.severity + '">' + KIND_ICON[b.kind] +
            ' <b>' + esc(b.name) + '</b><br><span class="bn-detail">' + esc(b.detail) + '</span></li>';
        }).join('') + '</ul>'
        : '<div class="bn-none">이 실행에서 도출된 병목 없음 (강도·시나리오·seed를 바꿔보세요 — 병목은 부하의 함수)</div>';

      // ── 누수 사유 ──
      var reasons = Object.keys(g.leakReasons);
      el('des-leak').innerHTML = reasons.length
        ? reasons.sort(function (a, b) { return g.leakReasons[b] - g.leakReasons[a]; })
          .map(function (r) {
            return '<span class="leak-chip">' + esc(LEAK_LABEL[r] || r) + ': <b>' +
              g.leakReasons[r] + '</b></span>';
          }).join(' ')
        : '<span class="bn-none">누수 없음</span>';

      // ── 노드 관측 통계 (ρ 내림차순) ──
      el('des-node-body').innerHTML = res.nodes.slice()
        .filter(function (n) { return n.arrivals > 0; })
        .sort(function (a, b) { return b.rho - a.rho; })
        .map(function (n) {
          var bar = Math.min(100, n.rho * 100);
          return '<tr class="row-' + n.level + '">' +
            '<td>' + esc(n.name) + '</td>' +
            '<td>' + (n.category === 'c2' ? 'C2' : '교전') + '</td>' +
            '<td class="num">' + n.arrivals + '</td>' +
            '<td class="num">' + n.completions + '</td>' +
            '<td class="num">' + (n.drops > 0 ? '<b style="color:#ff9a8d">' + n.drops + '</b>' : '0') + '</td>' +
            '<td><div class="rho-bar"><div class="rho-fill lv-' + n.level +
            '" style="width:' + bar + '%"></div><span>' + n.rho.toFixed(2) + '</span></div></td>' +
            '<td class="num">' + n.Wq.toFixed(1) + 's</td>' +
            '<td class="num">' + n.maxInSystem + '</td>' +
            '<td>' + LEVEL_BADGE[n.level] + '</td></tr>';
        }).join('') ||
        '<tr><td colspan="9" class="bn-none">C2·무기 노드에 도달한 항적이 없습니다.</td></tr>';

      el('des-meta').textContent =
        'seed=' + res.config.seed + ' · 시뮬레이션 ' + res.config.endTimeSec + '초 · 처리 ' +
        res.eventCount.toLocaleString() + '이벤트 · 벽시계 ' + (res._elapsedMs || 0).toFixed(0) + 'ms · ' +
        '동일 seed·config는 항상 동일 결과(결정론적).';
    }
  };

  function card(label, val, cls) {
    return '<div class="stat-card' + (cls ? ' stat-' + cls : '') + '">' +
      '<div class="stat-val">' + esc(val) + '</div>' +
      '<div class="stat-label">' + esc(label) + '</div></div>';
  }
  function signed(n) { return (n > 0 ? '+' : '') + n; }
  function cmpRow(label, cur, oth, higherBetter) {
    var d = cur - oth;
    var good = higherBetter ? d > 0 : d < 0;
    var cls = Math.abs(d) < 0.001 ? '' : (good ? 'cmp-good' : 'cmp-bad');
    return '<tr><td>' + label + '</td>' +
      '<td class="num">' + (cur * 100).toFixed(0) + '%</td>' +
      '<td class="num">' + (oth * 100).toFixed(0) + '%</td>' +
      '<td class="num ' + cls + '">' + (d >= 0 ? '+' : '') + (d * 100).toFixed(0) + '%p</td></tr>';
  }
})();
