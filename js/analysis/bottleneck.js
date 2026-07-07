/**
 * K-JAMDS 시뮬레이터 — 시나리오 기반 병목 도출 모듈 (Phase 1: 정상상태 해석적 근사)
 *
 * 설계 원칙: 병목은 데이터에 고정(hard-code)하지 않는다.
 * [시나리오 위협 부하 λ] × [모드별 C2 토폴로지(nodes/links)] × [노드 처리용량(M/M/c)]로부터
 * 부하를 그래프에 전파시켜 이용률 ρ·대기시간 Wq·통신지연·커버리지 공백을 계산하고,
 * 임계값 초과 지점을 병목으로 "도출"한다. 시나리오·강도·모드가 바뀌면 병목 위치도 바뀐다.
 *
 * Phase 1 한계(명시): 정상상태 M/M/c 근사(Erlang-C). Phase 2에서 DES(이산사건 시뮬레이션),
 * Phase 3에서 Monte Carlo 분포샘플링으로 대체·보강된다.
 *
 * 부하 전파 규칙(개념 모델, docs/params.md 근거):
 *  1. 탐지: 축선(axis)·위협클래스가 맞는 센서가 위협을 탐지. 저탐지 위협은 항적소실→재탐지
 *     반복으로 항적 생성 부하가 배가된다: dup = min(2.5, 1/detectFactor).
 *  2. 보고: 센서의 report 링크를 따라 C2에 항적처리 부하 유입.
 *     - As-Is(융합 부재): 같은 위협을 본 센서 수만큼 각 C2에 중복 항적 부하 (Track Fusion 미비).
 *     - To-Be(JAMDC2 융합): C2별 부하는 융합 단일항적(λ)로 캡, 융합 워크로드는 JAMDC2에 집중.
 *       항적 연속성 향상으로 dup_tobe = 1 + (dup-1)*0.3.
 *  3. 협조/승인: 항적 보유 C2가 교전승인권자(approvalLevel)까지 coord 최단경로로 협조
 *     (As-Is 육→공 음성 180s 경로가 여기서 부하를 받음). 승인권자에는 교전결심 부하 λ 추가.
 *     To-Be의 사전승인 자동교전(approval=null)은 협조·결심 홉 자체가 생략.
 *  4. 교전: canEngage가 참인 무기체계에 교전 부하 균등 배분(Phase 1 단순 WTA).
 *     제약: 신궁·천마(SHORAD)는 탄도탄 canEngage=false → 배분 자체가 불가.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  // 병목 판정 임계값 (MetricGate 등 큐잉 문헌: ρ>0.9 경고신호)
  var RHO_WARN = 0.7;
  var RHO_BOTTLENECK = 0.9;
  var COMM_BOTTLENECK_SEC = 60;
  // 통신병목 판정: 지연 자체가 아니라 [유통량 × 지연] = 전달 중 체류 항적 수(Little's Law)가
  // 상시 1건 이상일 때. 저강도에서는 음성 링크도 병목이 아니게 되어, 병목이 부하의 함수가 된다.
  var COMM_INTRANSIT_MIN = 1.0;

  /** Erlang-C: 서버 c개, 제공부하 a=λ/μ 일 때 대기확률 */
  function erlangC(a, c) {
    if (a >= c) return 1;
    var sum = 1, term = 1;
    for (var k = 1; k < c; k++) {
      term *= a / k;
      sum += term;
    }
    var termC = term * (a / c);
    var last = termC / (1 - a / c);
    return last / (sum + last);
  }

  function dupFactor(threat, mode) {
    var d = Math.min(2.5, 1 / Math.max(threat.detectFactor, 0.01));
    if (mode === 'tobe') d = 1 + (d - 1) * 0.3; // Track Fusion에 의한 항적 연속성 향상
    return d;
  }

  /**
   * 시나리오 부하 분석 실행.
   * @param {object} scenario  KJ.SCENARIOS 항목
   * @param {'asis'|'tobe'} mode
   * @param {number} intensity 전체 λ 배수 (0.5~3.0)
   * @returns 분석 결과 (nodes/links/gaps/timelines/bottlenecks)
   */
  KJ.analyzeScenario = function (scenario, mode, intensity) {
    intensity = intensity || 1;
    var nodes = KJ.nodesInMode(mode);
    var links = KJ.linksInMode(mode);
    var nodeLoad = {};   // nodeId -> λ (건/분)
    var linkFlow = {};   // linkIndex -> λ (건/분)
    var gaps = [];
    var timelines = [];

    function addNode(id, v) { nodeLoad[id] = (nodeLoad[id] || 0) + v; }
    function addLink(l, v) {
      var i = KJ.LINKS.indexOf(l);
      linkFlow[i] = (linkFlow[i] || 0) + v;
    }
    function outLinks(id, kinds) {
      return links.filter(function (l) {
        return l.from === id && kinds.indexOf(l.kind) !== -1;
      });
    }

    scenario.mix.forEach(function (entry) {
      var threat = KJ.threatType(entry.type);
      // burst 항목은 equivRatePerMin 개념값으로 정상상태 근사 (KJ.entryRate)
      var lam = KJ.entryRate(entry) * intensity;
      var dup = dupFactor(threat, mode);

      // 1) 탐지 — 축선·위협클래스에 맞는 센서 선별
      var sensors = nodes.filter(function (n) {
        return n.category === 'sensor' &&
          n.detects.indexOf(entry.type) !== -1 &&
          n.coverage.indexOf(entry.axis) !== -1;
      });
      if (sensors.length === 0) {
        gaps.push({
          kind: 'coverage', type: entry.type, axis: entry.axis,
          reason: '해당 축선에서 이 위협을 탐지할 수 있는 센서가 없음 (탐지 공백)'
        });
        return;
      }

      // 2) 보고 — C2 항적처리 부하 유입
      var loadedC2 = {}; // 이 위협 항적을 보유하게 된 C2 → 유입량
      sensors.forEach(function (s) {
        outLinks(s.id, ['report']).forEach(function (l) {
          var flow = lam * dup;
          addLink(l, flow);
          loadedC2[l.to] = (loadedC2[l.to] || 0) + flow;
        });
      });

      if (mode === 'tobe') {
        // Track Fusion: JAMDC2가 전 센서 유입을 융합 처리, 각 C2 처리부하는 단일 융합항적으로 캡
        var totalInflow = 0;
        Object.keys(loadedC2).forEach(function (id) { totalInflow += loadedC2[id]; });
        if (KJ.nodeById('JAMDC2')) {
          addNode('JAMDC2', totalInflow);
          // C2 → JAMDC2 보고 링크 플로우 반영
          Object.keys(loadedC2).forEach(function (id) {
            outLinks(id, ['report']).forEach(function (l) {
              if (l.to === 'JAMDC2') addLink(l, loadedC2[id]);
            });
          });
        }
        Object.keys(loadedC2).forEach(function (id) {
          loadedC2[id] = Math.min(loadedC2[id], lam * dup);
        });
      }
      Object.keys(loadedC2).forEach(function (id) { addNode(id, loadedC2[id]); });

      // 3) 협조/승인 — 항적 보유 C2가 교전승인권자까지 coord 최단경로(BFS)로 협조.
      //    모든 상향 링크에 부하를 살포하지 않고 실제 협조 경로에만 부하를 싣는다.
      //    To-Be 사전승인 자동교전(approval=null)은 협조·결심 홉 자체가 생략된다.
      var approvalId = threat.approvalLevel ? threat.approvalLevel[mode] : null;
      if (approvalId && KJ.nodeById(approvalId)) {
        Object.keys(loadedC2).forEach(function (srcId) {
          var path = coordPath(srcId, approvalId, links);
          if (!path) return;
          var flow = loadedC2[srcId];
          path.forEach(function (l) {
            addLink(l, flow);
            addNode(l.to, flow);
          });
        });
        addNode(approvalId, lam); // 교전결심 부하 (승인권자)
      }

      // 4) 교전 — canEngage 무기체계에 균등 배분 (제약조건이 배분 대상을 결정)
      var shooters = nodes.filter(function (n) {
        return n.category === 'shooter' && n.canEngage[entry.type];
      });
      if (shooters.length === 0) {
        gaps.push({
          kind: 'engagement', type: entry.type, axis: entry.axis,
          reason: '교전 가능한 무기체계가 없음 (예: 탄도탄에 대한 단거리방공무기 교전 불가 제약)'
        });
      } else {
        var share = lam / shooters.length;
        shooters.forEach(function (sh) {
          addNode(sh.id, share);
          (sh.controlledBy[mode] || []).forEach(function (c2id) {
            links.forEach(function (l) {
              if (l.kind === 'command' && l.from === c2id && l.to === sh.id) addLink(l, share);
            });
          });
        });
      }

      // 타임라인 추정 (탐지→교전, 대기시간 제외한 경로 지연 합 — Phase 2 DES에서 정밀화)
      timelines.push(buildTimeline(entry, threat, lam, sensors, shooters, links, mode));
    });

    // ── 노드 지표 계산 (M/M/c) ──
    var nodeResults = nodes.filter(function (n) { return n.category !== 'sensor'; })
      .map(function (n) {
        var lam = nodeLoad[n.id] || 0;
        var c, svcSec;
        if (n.category === 'c2') {
          c = n.queue.servers;
          svcSec = n.queue.serviceTimeSec[mode];
        } else { // shooter: 교전채널을 서버로
          c = n.engage.channels;
          svcSec = n.engage.engageTimeSec;
        }
        var mu = 60 / svcSec;            // 서버 1개 처리율 (건/분)
        var a = lam / mu;                // 제공부하
        var rho = a / c;
        var res = {
          id: n.id, name: n.name, category: n.category,
          lambda: lam, servers: c, serviceSec: svcSec, rho: rho,
          Wq: 0, Lq: 0, level: 'normal', overflow: false
        };
        if (lam <= 0) { res.level = 'idle'; return res; }
        if (rho >= 1) {
          res.level = 'saturated';
          res.Wq = Infinity; res.Lq = Infinity;
          res.overflow = true;
        } else {
          var pw = erlangC(a, c);
          res.Lq = pw * rho / (1 - rho);
          res.Wq = res.Lq / lam * 60;    // 초 단위
          if (rho >= RHO_BOTTLENECK) res.level = 'bottleneck';
          else if (rho >= RHO_WARN) res.level = 'warn';
          if (n.category === 'c2' && isFinite(n.queue.capacity)) {
            res.overflow = res.Lq > n.queue.capacity * 0.8;
          }
        }
        return res;
      });

    // ── 링크 지표 (통신지연 병목) ──
    var linkResults = [];
    Object.keys(linkFlow).forEach(function (i) {
      var l = KJ.LINKS[i];
      var comm = l.comm[mode];
      if (!comm) return;
      linkResults.push({
        from: l.from, to: l.to, kind: l.kind,
        type: comm.type, delaySec: comm.delaySec,
        flow: linkFlow[i],
        isCommBottleneck: comm.delaySec >= COMM_BOTTLENECK_SEC &&
          (linkFlow[i] * comm.delaySec / 60) >= COMM_INTRANSIT_MIN,
        note: l.note || ''
      });
    });

    // ── 병목 종합 (심각도순 도출) ──
    var bottlenecks = [];
    nodeResults.forEach(function (r) {
      if (r.level === 'saturated' || r.level === 'bottleneck') {
        bottlenecks.push({
          kind: 'node', severity: r.level === 'saturated' ? 3 : 2,
          id: r.id, name: r.name,
          detail: '이용률 ρ=' + (isFinite(r.rho) ? r.rho.toFixed(2) : '∞') +
            (r.level === 'saturated'
              ? ' — 처리용량 초과(불안정), 대기열 무한 성장·표적 누수 발생'
              : ' — 임계(0.9) 초과, 수요 소폭 증가에도 대기시간 비선형 폭증')
        });
      }
    });
    linkResults.forEach(function (r) {
      if (r.isCommBottleneck) {
        bottlenecks.push({
          kind: 'link', severity: 2,
          id: r.from + '→' + r.to,
          name: KJ.nodeById(r.from).name + ' → ' + KJ.nodeById(r.to).name,
          detail: r.type + ' 전달지연 ' + r.delaySec + '초 × 유통량 ' +
            r.flow.toFixed(2) + '건/분' + (r.note ? ' — ' + r.note : '')
        });
      }
    });
    gaps.forEach(function (g) {
      bottlenecks.push({
        kind: 'gap', severity: g.kind === 'engagement' ? 3 : 2,
        id: g.type + '@' + g.axis,
        name: KJ.threatType(g.type).name + ' (' + g.axis + ' 축선)',
        detail: g.reason
      });
    });
    bottlenecks.sort(function (a, b) { return b.severity - a.severity; });

    return {
      scenario: scenario.id, mode: mode, intensity: intensity,
      nodes: nodeResults, links: linkResults, gaps: gaps,
      timelines: timelines, bottlenecks: bottlenecks
    };
  };

  /** srcId → targetId 로 가는 coord 링크 최단경로(BFS, 방향성 존중). 도달 불가/동일 노드면 null */
  function coordPath(srcId, targetId, links) {
    if (srcId === targetId) return null;
    var queue = [srcId];
    var cameBy = {}; // nodeId -> 도달에 사용한 링크
    cameBy[srcId] = null;
    while (queue.length) {
      var cur = queue.shift();
      var outs = links.filter(function (l) { return l.from === cur && l.kind === 'coord'; });
      for (var i = 0; i < outs.length; i++) {
        var l = outs[i];
        if (l.to in cameBy) continue;
        cameBy[l.to] = l;
        if (l.to === targetId) {
          var path = [];
          var at = targetId;
          while (cameBy[at]) { path.unshift(cameBy[at]); at = cameBy[at].from; }
          return path;
        }
        queue.push(l.to);
      }
    }
    return null;
  }

  /** 위협 1건의 탐지→교전 단계별 지연 추정 (경로 고정지연 합, 대기시간은 노드표 참조) */
  function buildTimeline(entry, threat, lam, sensors, shooters, links, mode) {
    var stages = [];
    // 보고 지연: 센서 report 링크 중 최소 지연 경로(최선 센서) 기준
    var reportDelays = [];
    sensors.forEach(function (s) {
      links.forEach(function (l) {
        if (l.from === s.id && l.kind === 'report') reportDelays.push(l.comm[mode].delaySec);
      });
    });
    var report = reportDelays.length ? Math.min.apply(null, reportDelays) : 0;
    stages.push({ name: '탐지·보고', sec: report });

    // 협조 지연: As-Is 육군 센서 최초탐지 시 육→공 coord 음성 경로 발생 여부
    var armyFirst = sensors.some(function (s) { return s.service === 'army'; });
    var afAlso = sensors.some(function (s) { return s.service !== 'army'; });
    var coordSec = 0;
    if (armyFirst && !afAlso) {
      var coordDelays = links.filter(function (l) {
        return l.kind === 'coord' && KJ.nodeById(l.from).service === 'army';
      }).map(function (l) { return l.comm[mode].delaySec; });
      coordSec = coordDelays.length ? Math.min.apply(null, coordDelays) : 0;
    }
    stages.push({ name: '협조/융합', sec: mode === 'tobe' ? Math.min(coordSec, 2) : coordSec });

    // 결심 (승인 홉: 서비스타임 1건분 개념치)
    var approvalId = threat.approvalLevel ? threat.approvalLevel[mode] : null;
    var apr = approvalId && KJ.nodeById(approvalId)
      ? KJ.nodeById(approvalId).queue.serviceTimeSec[mode] : 0;
    stages.push({ name: '결심/승인', sec: apr || 0 });

    // 교전명령 + 교전
    var cmd = 0, eng = 0;
    if (shooters.length) {
      var cmdDelays = [];
      shooters.forEach(function (sh) {
        links.forEach(function (l) {
          if (l.kind === 'command' && l.to === sh.id) cmdDelays.push(l.comm[mode].delaySec);
        });
      });
      cmd = cmdDelays.length ? Math.min.apply(null, cmdDelays) : 0;
      eng = Math.min.apply(null, shooters.map(function (sh) { return sh.engage.engageTimeSec; }));
    }
    stages.push({ name: '교전명령', sec: cmd });
    stages.push({ name: '교전/요격', sec: eng });

    var total = stages.reduce(function (s, st) { return s + st.sec; }, 0);
    return {
      type: entry.type, typeName: threat.name, axis: entry.axis,
      lambda: lam, stages: stages, totalSec: total,
      engageable: shooters.length > 0
    };
  }
})();
