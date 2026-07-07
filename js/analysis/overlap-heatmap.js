/**
 * K-JAMDS 시뮬레이터 — 축선별 중복교전 위험도 히트맵 (Phase 4)
 *
 * "히트맵: AOR 경계 개념지도 위 중복교전 밀도 — 이원화 C2의 공간적 문제 표현"(계획서 4절)를
 * 시나리오·모드 데이터에서 도출한다. 특정 축선을 하드코딩으로 "위험"이라 표시하지 않는다 —
 * 시나리오의 위협 구성(어떤 축선에 어떤 위협이 얼마나)과 현재 모드의 C2 링크 지연에서
 * 계산한다. 시나리오·모드·강도를 바꾸면 히트맵도 함께 바뀐다.
 *
 * 정의: 어떤 위협클래스를 교전 가능한 무기체계가 서로 다른 통제계통(controlledBy 루트)에
 * 속해 있고, 그 두 계통이 coord 링크로 서로 "제때" 협조할 수 없으면(=협조 왕복 지연이
 * 위협의 dwellSec 대비 충분히 길면, 임계 0.5×dwellSec) — 두 계통이 사실상 독립적으로
 * 교전을 결정할 수 있어 중복교전·책임공백 위험이 생긴다. 위험 판정된 조합 수 × 시나리오
 * 부하(λ)를 축선별로 합산한 값이 위험도 raw 점수이며, 축선 간 상대비교를 위해 정규화한다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var AXIS_KEYS = ['west', 'central', 'east', 'seoul'];
  var COORD_RISK_FRACTION = 0.5; // 협조지연이 dwellSec의 이 비율 이상이면 "제때 협조 불가"로 판정

  /**
   * fromId → toId 로 가는 협조경로 지연 합의 최단경로 (BFS). 도달 불가면 null.
   * 원칙적으로 kind='coord' 링크만 따라가지만, JAMDC2(Track Fusion) 허브는 예외로 둔다:
   * DES 엔진(sim-engine.js _afterC2)에서 각 C2에 도착한 항적은 kind='report' 링크로
   * JAMDC2에 유입되어 융합·WTA된 뒤 kind='coord' 링크로 각 C2에 재전파된다 — 즉 실제로는
   * report 유입 + coord 유출 조합이 곧 "통합 협조"다. 이 허브 특례가 없으면 To-Be에서도
   * JAMDC2를 경유한 협조가 전혀 인정되지 않아 K-JAMDS의 실제 개선 효과가 드러나지 않는다.
   */
  function coordDelay(fromId, toId, mode) {
    if (fromId === toId) return 0;
    var queue = [fromId], best = {};
    best[fromId] = 0;
    while (queue.length) {
      var cur = queue.shift();
      KJ.LINKS.forEach(function (l) {
        if (l.from !== cur || !l.comm[mode]) return;
        var isCoordKind = l.kind === 'coord';
        var isFusionHop = l.to === 'JAMDC2' || cur === 'JAMDC2'; // 허브 유입/유출 특례
        if (!isCoordKind && !isFusionHop) return;
        var nd = best[cur] + l.comm[mode].delaySec;
        if (best[l.to] === undefined || nd < best[l.to]) {
          best[l.to] = nd;
          queue.push(l.to);
        }
      });
    }
    return best[toId] !== undefined ? best[toId] : null;
  }

  /** 두 노드 간 최단 협조지연(양방향 중 짧은 쪽). 둘 다 도달 불가면 null */
  function minCoordDelay(a, b, mode) {
    var d1 = coordDelay(a, b, mode), d2 = coordDelay(b, a, mode);
    if (d1 === null) return d2;
    if (d2 === null) return d1;
    return Math.min(d1, d2);
  }

  /**
   * 시나리오·모드에서 축선별 중복교전 위험도를 계산.
   * @returns { axes: [{axis,label,raw,score,details:[{type,typeName,riskPairs,totalPairs,weight}]}], maxRaw }
   */
  KJ.computeOverlapHeat = function (scenario, mode, intensity) {
    intensity = intensity || 1;
    var nodes = KJ.nodesInMode(mode);
    var results = AXIS_KEYS.map(function (axis) {
      var entries = scenario.mix.filter(function (m) { return m.axis === axis; });
      var raw = 0, details = [];
      entries.forEach(function (entry) {
        var tt = KJ.threatType(entry.type);
        var shooters = nodes.filter(function (n) {
          return n.category === 'shooter' && n.canEngage[entry.type] &&
            n.controlledBy && (n.controlledBy[mode] || []).length > 0;
        });
        var roots = [];
        shooters.forEach(function (sh) {
          var r = sh.controlledBy[mode][0];
          if (roots.indexOf(r) === -1) roots.push(r);
        });
        var riskPairs = 0, totalPairs = 0;
        for (var i = 0; i < roots.length; i++) {
          for (var j = i + 1; j < roots.length; j++) {
            totalPairs++;
            var d = minCoordDelay(roots[i], roots[j], mode);
            if (d === null || d >= tt.dwellSec * COORD_RISK_FRACTION) riskPairs++;
          }
        }
        if (riskPairs > 0) {
          var weight = KJ.entryRate(entry) * intensity; // burst 항목은 등가 λ 개념값
          raw += weight * riskPairs;
          details.push({
            type: entry.type, typeName: tt.name,
            riskPairs: riskPairs, totalPairs: totalPairs, weight: weight
          });
        }
      });
      return { axis: axis, label: (KJ.AXES && KJ.AXES[axis] ? KJ.AXES[axis].label : axis), raw: raw, details: details };
    });
    var maxRaw = Math.max.apply(null, results.map(function (r) { return r.raw; })) || 1;
    results.forEach(function (r) { r.score = r.raw / maxRaw; });
    return { axes: results, maxRaw: maxRaw };
  };
})();
