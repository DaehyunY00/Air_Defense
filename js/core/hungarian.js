/**
 * K-JAMDS 시뮬레이터 — 헝가리안(Kuhn–Munkres) 최소비용 할당 (Phase 7)
 *
 * To-Be Kill-Web 엔진의 배치 WTA(무기-표적 최적 할당)에 사용한다.
 * 정적 WTA의 1:1 할당 완화형은 할당문제(assignment problem)로 정식화되어
 * 헝가리안 알고리즘 O(n³)으로 최적해를 얻는다 — 수십 표적 규모 실시간 결심주기에 충분.
 * (근거: Kline·Ahner·Hill 2019 WTA 서베이(Computers & OR), Ahuja et al. 2007(Oper. Res.) —
 *  docs/params.md WTA-HUNG-01)
 *
 * 구현: 포텐셜 기반 최단증가경로(JV 스타일, e-maxx 정식화). 행 ≤ 열이 되도록
 * 내부에서 전치·더미 열 패딩을 처리하므로 임의의 직사각 비용행렬을 받는다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var BIG = 1e15; // 더미(할당 불가) 비용 — 실비용 합보다 항상 크게

  /**
   * 최소비용 할당.
   * @param {number[][]} cost  rows×cols 비용행렬 (유한값; 할당 불가 셀은 KJ.hungarian.INF 사용)
   * @returns {number[]} assign  assign[row] = 배정된 col, 배정 불가(더미)면 -1
   */
  function hungarian(cost) {
    var rows = cost.length;
    if (rows === 0) return [];
    var cols = cost[0].length;
    var transposed = rows > cols;
    var a = cost;
    if (transposed) { // 행 ≤ 열 보장 (전치)
      a = [];
      for (var j = 0; j < cols; j++) {
        a.push(cost.map(function (r) { return r[j]; }));
      }
      var t = rows; rows = cols; cols = t;
    }

    // 1-indexed 포텐셜·매칭 배열 (e-maxx 정식화)
    var n = rows, m = cols;
    var u = new Array(n + 1).fill(0);
    var v = new Array(m + 1).fill(0);
    var p = new Array(m + 1).fill(0);   // p[j] = 열 j에 매칭된 행 (0 = 없음)
    var way = new Array(m + 1).fill(0);

    for (var i = 1; i <= n; i++) {
      p[0] = i;
      var j0 = 0;
      var minv = new Array(m + 1).fill(Infinity);
      var used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        var i0 = p[j0], delta = Infinity, j1 = -1;
        for (var j = 1; j <= m; j++) {
          if (used[j]) continue;
          var cur = a[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        var j2 = way[j0];
        p[j0] = p[j2];
        j0 = j2;
      } while (j0);
    }

    var assignRow = new Array(n).fill(-1);
    for (var jj = 1; jj <= m; jj++) {
      if (p[jj] > 0) assignRow[p[jj] - 1] = jj - 1;
    }
    // BIG 셀에 강제 배정된 행은 실질 배정 불가 → -1
    for (var r = 0; r < n; r++) {
      if (assignRow[r] >= 0 && a[r][assignRow[r]] >= BIG) assignRow[r] = -1;
    }

    if (!transposed) return assignRow;
    // 전치 복원: assignRow는 [원래 col] → 원래 row. 원래 rows 크기로 역매핑.
    var out = new Array(cost.length).fill(-1);
    assignRow.forEach(function (origRow, origCol) {
      if (origRow >= 0) out[origRow] = origCol;
    });
    return out;
  }

  hungarian.INF = BIG;
  KJ.hungarian = hungarian;
})();
