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
   * 모드별 협조 그래프를 한 번만 만든다. 이전 구현은 root 쌍마다 전체 링크 배열을 다시
   * 훑으며 양방향 최단경로를 계산해 FULL/SC3 한 번에 수만 회의 그래프 탐색이 발생했다.
   * 아래 인접목록 + source별 Dijkstra 메모는 같은 정의를 O(root × (V+E)) 수준으로 줄인다.
   *
   * 원칙적으로 kind='coord' 링크만 따르되, JAMDC2/IAOC fusion 허브의 report 유입과
   * coord 유출은 기존과 동일하게 협조경로로 인정한다.
   */
  function coordinationGraph(mode, catalog) {
    var links = catalog ? catalog.links : KJ.LINKS;
    var fusionId = catalog && catalog.roles ? catalog.roles.fusionC2 : 'JAMDC2';
    var adjacency = {};
    links.forEach(function (l) {
      if (!l.comm[mode]) return;
      var isFusionHop = l.to === fusionId || l.from === fusionId;
      if (l.kind !== 'coord' && !isFusionHop) return;
      (adjacency[l.from] = adjacency[l.from] || []).push({
        to: l.to, delaySec: l.comm[mode].delaySec
      });
    });
    return adjacency;
  }

  /** 양의 링크 지연에 대한 단일-source Dijkstra. 그래프가 작아 단순 frontier가 더 가볍다. */
  function shortestFrom(source, adjacency) {
    var best = {}, frontier = [{ id: source, d: 0 }];
    best[source] = 0;
    while (frontier.length) {
      var minIdx = 0;
      for (var i = 1; i < frontier.length; i++) {
        if (frontier[i].d < frontier[minIdx].d) minIdx = i;
      }
      var cur = frontier.splice(minIdx, 1)[0];
      if (cur.d !== best[cur.id]) continue;
      (adjacency[cur.id] || []).forEach(function (edge) {
        var nd = cur.d + edge.delaySec;
        if (best[edge.to] === undefined || nd < best[edge.to]) {
          best[edge.to] = nd;
          frontier.push({ id: edge.to, d: nd });
        }
      });
    }
    return best;
  }

  function minCoordDelay(a, b, distances) {
    var d1 = distances[a] && distances[a][b];
    var d2 = distances[b] && distances[b][a];
    if (d1 === undefined) return d2 === undefined ? null : d2;
    if (d2 === undefined) return d1;
    return Math.min(d1, d2);
  }

  /**
   * 시나리오·모드에서 축선별 중복교전 위험도를 계산.
   * @returns { axes: [{axis,label,raw,score,details:[{type,typeName,riskPairs,totalPairs,weight}]}], maxRaw }
   */
  KJ.computeOverlapHeat = function (scenario, mode, intensity, modelConfig) {
    intensity = intensity || 1;
    var catalog = KJ.resolveModelCatalog ? KJ.resolveModelCatalog(modelConfig || {}) : null;
    var nodes = KJ.nodesInMode(mode, catalog);
    var adjacency = coordinationGraph(mode, catalog);
    var rootsByType = {}, distances = {}, pairRiskByType = {};

    function rootsFor(type) {
      if (Object.prototype.hasOwnProperty.call(rootsByType, type)) return rootsByType[type];
      var roots = [];
      nodes.forEach(function (n) {
        if (n.category !== 'shooter' || !n.canEngage[type] || !n.controlledBy ||
            !(n.controlledBy[mode] || []).length) return;
        var root = n.controlledBy[mode][0];
        if (roots.indexOf(root) === -1) roots.push(root);
      });
      roots.forEach(function (root) {
        if (!distances[root]) distances[root] = shortestFrom(root, adjacency);
      });
      rootsByType[type] = roots;
      return roots;
    }

    function pairRisk(type) {
      if (Object.prototype.hasOwnProperty.call(pairRiskByType, type)) return pairRiskByType[type];
      var roots = rootsFor(type), tt = KJ.threatType(type);
      var riskPairs = 0, totalPairs = 0;
      for (var i = 0; i < roots.length; i++) {
        for (var j = i + 1; j < roots.length; j++) {
          totalPairs++;
          var d = minCoordDelay(roots[i], roots[j], distances);
          if (d === null || d >= tt.dwellSec * COORD_RISK_FRACTION) riskPairs++;
        }
      }
      pairRiskByType[type] = { riskPairs: riskPairs, totalPairs: totalPairs };
      return pairRiskByType[type];
    }

    var results = AXIS_KEYS.map(function (axis) {
      var entries = scenario.mix.filter(function (m) { return m.axis === axis; });
      var raw = 0, details = [];
      entries.forEach(function (entry) {
        var tt = KJ.threatType(entry.type);
        var risk = pairRisk(entry.type);
        if (risk.riskPairs > 0) {
          var weight = KJ.entryRate(entry) * intensity; // burst 항목은 등가 λ 개념값
          raw += weight * risk.riskPairs;
          details.push({
            type: entry.type, typeName: tt.name,
            riskPairs: risk.riskPairs, totalPairs: risk.totalPairs, weight: weight
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
