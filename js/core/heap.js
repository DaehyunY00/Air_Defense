/**
 * K-JAMDS 시뮬레이터 — 이벤트 큐용 이진 최소힙 (Phase 2)
 *
 * DES 이벤트 큐를 배열 기반 이진 최소힙으로 구현 (계획서 4절: JS에서 O(log n) 삽입/추출로 충분).
 * 정렬키는 (시각 t, 우선순위 pri, 삽입순서 seq) 3중 — 동시성(동일 t) 문제를 우선순위와
 * 삽입순서로 결정론적으로 해소한다. seq 덕분에 seed 고정 시 이벤트 처리순서가 완전 재현된다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  function less(a, b) {
    if (a.t !== b.t) return a.t < b.t;
    if (a.pri !== b.pri) return a.pri < b.pri;
    return a.seq < b.seq;
  }

  function MinHeap() { this.a = []; }

  MinHeap.prototype.size = function () { return this.a.length; };

  MinHeap.prototype.push = function (item) {
    var a = this.a;
    a.push(item);
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (less(a[i], a[p])) { var t = a[i]; a[i] = a[p]; a[p] = t; i = p; }
      else break;
    }
  };

  MinHeap.prototype.pop = function () {
    var a = this.a;
    if (a.length === 0) return null;
    var top = a[0];
    var last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      var i = 0, n = a.length;
      while (true) {
        var l = 2 * i + 1, r = 2 * i + 2, m = i;
        if (l < n && less(a[l], a[m])) m = l;
        if (r < n && less(a[r], a[m])) m = r;
        if (m === i) break;
        var t = a[i]; a[i] = a[m]; a[m] = t; i = m;
      }
    }
    return top;
  };

  MinHeap.prototype.peek = function () { return this.a.length ? this.a[0] : null; };

  KJ.MinHeap = MinHeap;
})();
