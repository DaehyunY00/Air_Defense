/**
 * K-JAMDS 시뮬레이터 — 탭 패널 렌더러 (Phase 1)
 * 시나리오 / 병목 분석 / 근거자료 탭. 모든 병목 표시는 KJ.analyzeScenario 결과에서 도출.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }

  var LEVEL_BADGE = {
    idle: '<span class="badge badge-idle">유휴</span>',
    normal: '<span class="badge badge-ok">정상</span>',
    warn: '<span class="badge badge-warn">주의 ρ≥0.7</span>',
    bottleneck: '<span class="badge badge-bad">병목 ρ≥0.9</span>',
    saturated: '<span class="badge badge-crit">포화 ρ≥1</span>'
  };
  var KIND_ICON = { node: '⬛', link: '🔗', gap: '⚠️' };

  KJ.panels = {
    /** 병목 분석 탭: 분석 결과 전체 렌더 */
    renderAnalysis: function (state, analysis) {
      var sc = KJ.scenarioById(state.sc);

      // ── 병목 종합 (시나리오에서 도출) ──
      var bn = analysis.bottlenecks.length
        ? analysis.bottlenecks.map(function (b) {
          return '<li class="bn-item bn-sev' + b.severity + '">' +
            KIND_ICON[b.kind] + ' <b>' + esc(b.name) + '</b><br>' +
            '<span class="bn-detail">' + esc(b.detail) + '</span></li>';
        }).join('')
        : '<li class="bn-none">현재 시나리오·강도·모드에서 도출된 병목 없음 ' +
          '(병목은 고정값이 아니라 부하의 함수 — 강도를 높이거나 시나리오를 바꿔보세요)</li>';
      el('bottleneck-summary').innerHTML =
        '<div class="analysis-context">' + esc(sc.name) + ' · ' +
        (state.mode === 'asis' ? 'As-Is (분절형)' : 'To-Be (K-JAMDS 통합형)') +
        ' · 강도 ×' + state.x.toFixed(1) + '</div><ul>' + bn + '</ul>';

      // ── 노드 이용률 표 (ρ 내림차순) ──
      var rows = analysis.nodes.slice().sort(function (a, b) {
        var ra = isFinite(a.rho) ? a.rho : 99, rb = isFinite(b.rho) ? b.rho : 99;
        return rb - ra;
      }).map(function (r) {
        var bar = Math.min(100, (isFinite(r.rho) ? r.rho : 1.2) * 100);
        return '<tr class="row-' + r.level + '">' +
          '<td>' + esc(r.name) + '</td>' +
          '<td>' + (r.category === 'c2' ? 'C2' : '교전') + '</td>' +
          '<td class="num">' + r.lambda.toFixed(2) + '</td>' +
          '<td class="num">' + r.servers + '</td>' +
          '<td class="num">' + r.serviceSec + 's</td>' +
          '<td><div class="rho-bar"><div class="rho-fill lv-' + r.level +
          '" style="width:' + bar + '%"></div>' +
          '<span>' + (isFinite(r.rho) ? r.rho.toFixed(2) : '≥1') + '</span></div></td>' +
          '<td class="num">' + (isFinite(r.Wq) ? r.Wq.toFixed(1) + 's' : '∞') + '</td>' +
          '<td>' + LEVEL_BADGE[r.level] + '</td></tr>';
      }).join('');
      el('node-table-body').innerHTML = rows;

      // ── 통신 링크 표 ──
      var lrows = analysis.links.slice().sort(function (a, b) {
        return (b.delaySec * b.flow) - (a.delaySec * a.flow);
      }).map(function (r) {
        return '<tr' + (r.isCommBottleneck ? ' class="row-bottleneck"' : '') + '>' +
          '<td>' + esc(KJ.nodeById(r.from).name) + ' → ' + esc(KJ.nodeById(r.to).name) + '</td>' +
          '<td>' + esc(r.type) + '</td>' +
          '<td class="num">' + r.delaySec + 's</td>' +
          '<td class="num">' + r.flow.toFixed(2) + '</td>' +
          '<td>' + (r.isCommBottleneck
            ? '<span class="badge badge-bad">통신병목</span>'
            : '<span class="badge badge-ok">정상</span>') + '</td></tr>';
      }).join('');
      el('link-table-body').innerHTML = lrows;

      // ── 위협별 타임라인 (탐지→교전 고정지연 추정) ──
      var tl = analysis.timelines.map(function (t) {
        var total = Math.max(t.totalSec, 1);
        var segs = t.stages.map(function (s, i) {
          var w = (s.sec / total * 100).toFixed(1);
          return '<div class="tl-seg tl-' + i + '" style="width:' + w + '%" title="' +
            esc(s.name) + ' ' + s.sec + '초"></div>';
        }).join('');
        return '<div class="tl-row">' +
          '<div class="tl-label">' + esc(t.typeName) + ' <span class="tl-axis">(' +
          esc(t.axis) + ')</span></div>' +
          '<div class="tl-bar">' + segs + '</div>' +
          '<div class="tl-total">' + (t.engageable ? '≈' + Math.round(t.totalSec) + '초' :
            '<span class="badge badge-crit">교전 불가</span>') + '</div></div>';
      }).join('');
      el('timeline-rows').innerHTML = tl ||
        '<div class="bn-none">시나리오에 위협이 없습니다.</div>';

      el('analysis-note').textContent =
        '※ Phase 1 정상상태 M/M/c(Erlang-C) 해석적 근사입니다. 타임라인은 대기시간을 제외한 ' +
        '경로 고정지연 합이며, Phase 2(DES)·Phase 3(Monte Carlo)에서 확률분포 기반으로 정밀화됩니다.';
      if (KJ.tableSort) KJ.tableSort.attachAll(el('panel-analysis')); // 숫자열 헤더 우측정렬 동기화
    },

    /** 근거자료 탭: 제약 어서션 + 파라미터 문서 링크 */
    renderData: function () {
      var checks = KJ.runConstraintChecks();
      el('constraint-list').innerHTML = checks.map(function (c) {
        return '<li class="' + (c.pass ? 'chk-pass' : 'chk-fail') + '">' +
          (c.pass ? '✅' : '❌') + ' <b>[' + c.id + '] ' + esc(c.name) + '</b>' +
          '<div class="chk-detail">' + esc(c.detail) + '</div></li>';
      }).join('');

      var nodeRows = KJ.NODES.map(function (n) {
        var refs = [];
        if (n.queue && n.queue.paramRef) refs.push(n.queue.paramRef);
        if (n.detectProb && n.detectProb.paramRef) refs.push(n.detectProb.paramRef);
        if (n.engage && n.engage.pk && n.engage.pk.paramRef) refs.push(n.engage.pk.paramRef);
        if (n.rangeRef) refs.push(n.rangeRef);
        (n.constraintRefs || []).forEach(function (r) { refs.push(r); });
        var km = n.category === 'sensor' ? n.rangeKm
          : (n.engage ? n.engage.rangeKm : null);
        return '<tr><td>' + esc(n.id) + '</td><td>' + esc(n.name) + '</td>' +
          '<td>' + n.category + '</td>' +
          '<td>' + (n.modes ? n.modes.join(',') : 'asis, tobe') + '</td>' +
          '<td class="num">' + (km ? '≈' + km + 'km' : '—') + '</td>' +
          '<td class="refs">' + refs.map(esc).join('<br>') + '</td></tr>';
      }).join('');
      el('inventory-body').innerHTML = nodeRows;
      if (KJ.tableSort) KJ.tableSort.attachAll(el('panel-data'));
    }
  };
})();
