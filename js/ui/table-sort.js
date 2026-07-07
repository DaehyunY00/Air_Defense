/**
 * K-JAMDS 시뮬레이터 — 공용 표 열 정렬 유틸
 *
 * 모든 <table>의 <th> 클릭으로 <tbody> 행을 정렬한다 (오름/내림 토글).
 *  - 숫자 우선: 셀 텍스트에서 %, s, 초, 콤마, ±, ×, ρ=, ≈ 등을 제거하고 수치를 추출.
 *    '∞'는 +Infinity, 값이 없는 셀('—' 등)은 항상 맨 아래로 보낸다.
 *  - 숫자 추출 실패가 과반이면 문자열(localeCompare 'ko') 정렬로 대체.
 *  - 헤더는 정적(thead) 요소라 tbody가 innerHTML로 재렌더되어도 리스너가 유지된다.
 *    attach는 멱등(dataset 플래그)이라 렌더 후 attachAll을 반복 호출해도 안전.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  /** 셀 텍스트 → 정렬용 수치 (실패 시 null) */
  function numOf(text) {
    var t = text.trim();
    if (!t || t === '—' || t === '-') return null;
    if (t.indexOf('∞') !== -1 || t.indexOf('≥1') === 0) return Infinity;
    // "12,345", "48%", "215초", "40s", "×1.5", "±0.99%p", "≈250km", "[3.2, 4.1]" 등에서 첫 수치 추출
    var m = t.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  function sortTable(table, colIdx, dir) {
    var tbody = table.tBodies[0];
    if (!tbody) return;
    var rows = Array.prototype.slice.call(tbody.rows);
    // colspan 안내행(빈 상태 메시지 등)은 정렬에서 제외하고 맨 아래 유지
    var dataRows = rows.filter(function (r) { return r.cells.length > colIdx; });
    var restRows = rows.filter(function (r) { return r.cells.length <= colIdx; });

    var vals = dataRows.map(function (r) {
      var txt = r.cells[colIdx].textContent;
      return { row: r, num: numOf(txt), str: txt.trim() };
    });
    var numeric = vals.filter(function (v) { return v.num !== null; }).length >= vals.length / 2;

    vals.sort(function (a, b) {
      if (numeric) {
        var an = a.num === null ? -Infinity : a.num;
        var bn = b.num === null ? -Infinity : b.num;
        if (an !== bn) return dir * (an - bn);
        return a.str.localeCompare(b.str, 'ko');
      }
      return dir * a.str.localeCompare(b.str, 'ko');
    });
    // null(값 없음) 셀은 방향과 무관하게 맨 아래
    if (numeric) {
      var withVal = vals.filter(function (v) { return v.num !== null; });
      var noVal = vals.filter(function (v) { return v.num === null; });
      vals = withVal.concat(noVal);
    }

    var frag = document.createDocumentFragment();
    vals.forEach(function (v) { frag.appendChild(v.row); });
    restRows.forEach(function (r) { frag.appendChild(r); });
    tbody.appendChild(frag);
    syncAlign(table);
  }

  /**
   * 숫자 열 헤더 정렬(오른쪽) 동기화.
   * 각 열의 tbody 셀 과반이 우측정렬 데이터(class="num")면 해당 <th>에도 'num'을 부여해
   * 헤더 텍스트와 값이 같은(오른쪽) 축에 정렬되게 한다 — 헤더는 좌측, 값은 우측이라
   * 어긋나 보이던 문제 해결. tbody가 innerHTML로 재렌더된 뒤 호출해야 반영된다.
   */
  function syncAlign(table) {
    var thead = table.tHead, tbody = table.tBodies[0];
    if (!thead || !thead.rows.length || !tbody || !tbody.rows.length) return;
    var ths = thead.rows[thead.rows.length - 1].cells;
    for (var c = 0; c < ths.length; c++) {
      var numCount = 0, total = 0;
      for (var r = 0; r < tbody.rows.length; r++) {
        var cell = tbody.rows[r].cells[c];
        if (!cell || cell.colSpan > 1) continue; // 안내행(colspan) 제외
        total++;
        if (cell.classList.contains('num')) numCount++;
      }
      if (total > 0 && numCount >= total / 2) ths[c].classList.add('num');
      else ths[c].classList.remove('num');
    }
  }

  /** 단일 표에 정렬 바인딩 (멱등) */
  function attach(table) {
    if (table.dataset.sortable === '1') return;
    var thead = table.tHead;
    if (!thead || !thead.rows.length) return;
    table.dataset.sortable = '1';
    // 다행(多行) 헤더는 마지막 행 기준 (현재 표들은 전부 1행)
    var ths = thead.rows[thead.rows.length - 1].cells;
    Array.prototype.forEach.call(ths, function (th, idx) {
      th.classList.add('th-sort');
      th.title = '클릭하여 정렬';
      th.addEventListener('click', function () {
        var dir = th.dataset.dir === 'desc' ? 1 : -1; // 첫 클릭은 내림차순
        Array.prototype.forEach.call(ths, function (o) {
          delete o.dataset.dir;
          o.classList.remove('sorted-asc', 'sorted-desc');
        });
        th.dataset.dir = dir === 1 ? 'asc' : 'desc';
        th.classList.add(dir === 1 ? 'sorted-asc' : 'sorted-desc');
        sortTable(table, idx, dir);
      });
    });
  }

  KJ.tableSort = {
    attach: attach,
    syncAlign: syncAlign,
    /** root 하위 모든 표에 정렬 바인딩 + 숫자열 헤더 정렬 동기화 */
    attachAll: function (root) {
      (root || document).querySelectorAll('table').forEach(function (t) {
        attach(t); syncAlign(t);
      });
    }
  };

  // 정적 표(병목 분석·MC·근거자료 탭)는 로드 시 일괄 바인딩
  document.addEventListener('DOMContentLoaded', function () {
    KJ.tableSort.attachAll(document);
  });
})();
