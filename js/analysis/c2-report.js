/**
 * C2 중심 순수 분석기.
 *
 * DES가 선택적으로 남긴 구조화 이벤트를 소비해 엔진을 다시 실행하거나 RNG를
 * 소비하지 않고 킬체인 지연, C2 대기행렬, 누출 귀속, 중복교전 및 병목 증거를
 * 파생한다. UI에는 원시 이벤트 대신 이 요약만 전달할 수 있다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var WINDOW_SEC = 60;
  var RHO_WARN = 0.7;
  var RHO_BOTTLENECK = 0.9;

  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function first(oldValue, value) { return oldValue == null ? value : Math.min(oldValue, value); }
  function ratio(a, b) { return b > 0 ? a / b : null; }
  function round(v) { return finite(v) ? +v.toFixed(6) : null; }

  function quantiles(values) {
    var a = values.filter(finite).slice().sort(function (x, y) { return x - y; });
    function q(p) {
      if (!a.length) return null;
      if (a.length === 1) return round(a[0]);
      var at = (a.length - 1) * p;
      var lo = Math.floor(at), hi = Math.ceil(at), w = at - lo;
      return round(a[lo] * (1 - w) + a[hi] * w);
    }
    var mean = a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null;
    return { n: a.length, mean: round(mean), p10: q(0.1), p50: q(0.5), p90: q(0.9), min: q(0), max: q(1) };
  }

  function peakUtilization(intervals, capacity, duration) {
    if (!(capacity > 0) || !(duration >= WINDOW_SEC) || !intervals.length) return null;
    var windows = {};
    intervals.forEach(function (interval) {
      var cursor = Math.max(0, interval[0]);
      var endAt = Math.min(duration, interval[1]);
      while (cursor < endAt) {
        var w = Math.floor(cursor / WINDOW_SEC);
        var end = Math.min(endAt, (w + 1) * WINDOW_SEC);
        windows[w] = (windows[w] || 0) + end - cursor;
        cursor = end;
      }
    });
    var best = 0, bestStart = null;
    Object.keys(windows).forEach(function (key) {
      var w = Number(key);
      if ((w + 1) * WINDOW_SEC > duration) return;
      var rho = windows[key] / (capacity * WINDOW_SEC);
      if (rho > best) { best = rho; bestStart = w * WINDOW_SEC; }
    });
    return { value: round(best), windowSec: WINDOW_SEC, windowStartSec: bestStart };
  }

  function recommendation(node, attributedLeaks) {
    if (node.drops > 0) return '처리용량·대기실·자동화 변경을 동일 seed로 반사실 검증';
    if (node.peakRho != null && node.peakRho >= RHO_BOTTLENECK && node.rho < RHO_BOTTLENECK) {
      return '평균 증설보다 파상부하 분산·동적 위임·우선순위 정책을 우선 검증';
    }
    if (attributedLeaks > 0) return '대기시간·명령경로·책임권한을 분리해 누출 귀속 원인을 재검증';
    return '현재 실행의 임무결과 영향은 미확인 — 강도 스윕과 paired 반복으로 지속성 확인';
  }

  KJ.buildC2Analysis = function (events, result) {
    events = Array.isArray(events) ? events : [];
    result = result || { global: {}, nodes: [], config: {} };
    var threats = {};
    var c2Records = {};
    var nodeRecords = {};
    var firesByThreat = {};
    var decisionCause = {};
    var fireCause = {};
    var directives = {};
    var commandDiagnostics = { coordinationFailed: 0, responsibilityUnresolved: 0 };

    function threat(id) {
      if (!threats[id]) threats[id] = {
        spawn: null, detect: null, decision: null, fire: null, kill: null, leak: null,
        c2: {}, fires: [], results: [], decisions: [], reports: [], leakEvent: null
      };
      return threats[id];
    }
    function node(id) {
      if (!nodeRecords[id]) nodeRecords[id] = [];
      return nodeRecords[id];
    }
    function c2Record(threatId, nodeId, jobId) {
      var key = jobId || (threatId + '\u0000' + nodeId);
      if (!c2Records[key]) {
        c2Records[key] = {
          threatId: threatId, nodeId: nodeId, jobId: jobId || null,
          arrivedAt: null, processingAt: null, doneAt: null, droppedAt: null, kind: null
        };
        node(nodeId).push(c2Records[key]);
        // 동일 위협이 한 C2 노드에서 항적 처리와 명령 수신 등 여러 job을 거칠 수 있다.
        // nodeId만 키로 쓰면 마지막 job이 앞선 대기/처리 증거를 덮어쓰므로 복합키를 보존한다.
        threat(threatId).c2[key] = c2Records[key];
      }
      return c2Records[key];
    }

    events.forEach(function (event) {
      if (!event || !finite(event.t) || typeof event.type !== 'string') return;
      var tr = event.threatId ? threat(event.threatId) : null;
      var rec;
      if (event.type === 'THREAT_SPAWNED' && tr) tr.spawn = first(tr.spawn, event.t);
      else if (event.type === 'SENSOR_DETECTED' && tr) tr.detect = first(tr.detect, event.t);
      else if (event.type === 'COMMAND_DECIDED' && tr) {
        tr.decision = first(tr.decision, event.t);
        var cause = event.cause || 'unattributed';
        decisionCause[cause] = (decisionCause[cause] || 0) + 1;
        tr.decisions.push(event);
      } else if (event.type === 'ENGAGEMENT_FIRED' && tr) {
        tr.fire = first(tr.fire, event.t);
        tr.fires.push(event);
        cause = event.cause || 'unattributed';
        fireCause[cause] = (fireCause[cause] || 0) + 1;
        if (!firesByThreat[event.threatId]) firesByThreat[event.threatId] = [];
        firesByThreat[event.threatId].push(event);
      } else if (event.type === 'INTERCEPT_HIT' && tr) {
        tr.kill = first(tr.kill, event.t);
        tr.results.push(event);
      } else if (event.type === 'INTERCEPT_MISS' && tr) {
        tr.results.push(event);
      } else if (event.type === 'THREAT_LEAKED' && tr) {
        tr.leak = first(tr.leak, event.t);
        tr.leakEvent = tr.leakEvent || event;
      } else if (event.type === 'TRACK_REPORT_RECEIVED' && tr) {
        tr.reports.push(event);
      } else if (event.type === 'C2_ARRIVED' && event.threatId && event.nodeId) {
        rec = c2Record(event.threatId, event.nodeId, event.jobId);
        rec.arrivedAt = first(rec.arrivedAt, event.t);
        rec.kind = event.kind || rec.kind;
      } else if (event.type === 'C2_PROCESSING' && event.threatId && event.nodeId) {
        rec = c2Record(event.threatId, event.nodeId, event.jobId);
        rec.processingAt = first(rec.processingAt, event.t);
        rec.kind = event.kind || rec.kind;
      } else if (event.type === 'C2_DONE' && event.threatId && event.nodeId) {
        rec = c2Record(event.threatId, event.nodeId, event.jobId);
        rec.doneAt = first(rec.doneAt, event.t);
      } else if (event.type === 'C2_DROPPED' && event.threatId && event.nodeId) {
        rec = c2Record(event.threatId, event.nodeId, event.jobId);
        rec.droppedAt = first(rec.droppedAt, event.t);
      } else if (event.type.indexOf('DIRECTIVE_') === 0 && event.directiveId) {
        var dir = directives[event.directiveId] || {
          directiveId: event.directiveId, threatId: event.threatId,
          createdAt: null, sentAt: null, receivedAt: null, processingAt: null,
          activeAt: null, expiredAt: null, cancelledAt: null, cause: event.cause || null,
          expiryReason: null
        };
        directives[event.directiveId] = dir;
        if (event.type === 'DIRECTIVE_CREATED') dir.createdAt = first(dir.createdAt, event.t);
        else if (event.type === 'DIRECTIVE_SENT') dir.sentAt = first(dir.sentAt, event.t);
        else if (event.type === 'DIRECTIVE_RECEIVED') dir.receivedAt = first(dir.receivedAt, event.t);
        else if (event.type === 'DIRECTIVE_PROCESSING') dir.processingAt = first(dir.processingAt, event.t);
        else if (event.type === 'DIRECTIVE_ACTIVE') dir.activeAt = first(dir.activeAt, event.t);
        else if (event.type === 'DIRECTIVE_EXPIRED') {
          dir.expiredAt = first(dir.expiredAt, event.t);
          dir.expiryReason = event.reason || 'unknown';
        } else if (event.type === 'DIRECTIVE_CANCELLED') dir.cancelledAt = first(dir.cancelledAt, event.t);
      } else if (event.type === 'COORDINATION_FAILED') {
        commandDiagnostics.coordinationFailed++;
      } else if (event.type === 'RESPONSIBILITY_UNRESOLVED') {
        commandDiagnostics.responsibilityUnresolved++;
      }
    });

    var spawned = 0, detected = 0, decided = 0, firedThreats = 0, killed = 0, leaked = 0;
    var delay = {
      spawnToDetect: [], detectToDecision: [], decisionToFire: [], fireToKill: [], spawnToKill: []
    };
    Object.keys(threats).forEach(function (id) {
      var tr = threats[id];
      if (tr.spawn != null) spawned++;
      if (tr.detect != null) detected++;
      if (tr.decision != null) decided++;
      if (tr.fire != null) firedThreats++;
      if (tr.kill != null) killed++;
      if (tr.leak != null) leaked++;
      if (tr.spawn != null && tr.detect != null) delay.spawnToDetect.push(tr.detect - tr.spawn);
      if (tr.detect != null && tr.decision != null) delay.detectToDecision.push(tr.decision - tr.detect);
      if (tr.decision != null && tr.fire != null) delay.decisionToFire.push(tr.fire - tr.decision);
      if (tr.fire != null && tr.kill != null) delay.fireToKill.push(tr.kill - tr.fire);
      if (tr.spawn != null && tr.kill != null) delay.spawnToKill.push(tr.kill - tr.spawn);
    });

    var attribution = {
      queued: 0, processing: 0, afterC2Done: 0, noC2Contact: 0,
      queuedByNode: {}, processingByNode: {}, afterC2DoneByNode: {}
    };
    Object.keys(threats).forEach(function (id) {
      var tr = threats[id];
      if (tr.leak == null) return;
      var records = Object.keys(tr.c2).map(function (nodeId) { return tr.c2[nodeId]; });
      var chosen = null, state = null;
      records.forEach(function (rec) {
        if (rec.processingAt != null && rec.processingAt <= tr.leak &&
            (rec.doneAt == null || rec.doneAt > tr.leak)) {
          if (state !== 'processing') { state = 'processing'; chosen = rec; }
        } else if (state !== 'processing' && rec.arrivedAt != null && rec.arrivedAt <= tr.leak &&
                   rec.processingAt == null) {
          if (state !== 'queued') { state = 'queued'; chosen = rec; }
        } else if (!state && rec.doneAt != null && rec.doneAt <= tr.leak) {
          state = 'afterC2Done'; chosen = rec;
        }
      });
      if (!state) state = 'noC2Contact';
      attribution[state]++;
      if (chosen && state === 'queued') {
        attribution.queuedByNode[chosen.nodeId] = (attribution.queuedByNode[chosen.nodeId] || 0) + 1;
      } else if (chosen && state === 'processing') {
        attribution.processingByNode[chosen.nodeId] = (attribution.processingByNode[chosen.nodeId] || 0) + 1;
      } else if (chosen && state === 'afterC2Done') {
        attribution.afterC2DoneByNode[chosen.nodeId] = (attribution.afterC2DoneByNode[chosen.nodeId] || 0) + 1;
      }
    });

    var resultNodes = {};
    (result.nodes || []).forEach(function (n) { resultNodes[n.id] = n; });
    var duration = Number(result.config && result.config.endTimeSec) || 0;
    var loadNodes = {};
    Object.keys(nodeRecords).sort().forEach(function (nodeId) {
      var records = nodeRecords[nodeId];
      var waits = [], services = [], intervals = [];
      var started = 0, completions = 0, drops = 0, terminatedInQueue = 0, stillWaitingAtEnd = 0;
      records.forEach(function (rec) {
        var tr = threats[rec.threatId];
        if (rec.processingAt != null) {
          started++;
          if (rec.arrivedAt != null) waits.push(rec.processingAt - rec.arrivedAt);
          var endAt = rec.doneAt == null ? duration : rec.doneAt;
          if (endAt >= rec.processingAt) intervals.push([rec.processingAt, endAt]);
        }
        if (rec.doneAt != null && rec.processingAt != null) {
          completions++;
          services.push(rec.doneAt - rec.processingAt);
        }
        if (rec.droppedAt != null) drops++;
        if (rec.processingAt == null && rec.droppedAt == null) {
          if (tr && (tr.kill != null || tr.leak != null)) terminatedInQueue++;
          else stillWaitingAtEnd++;
        }
      });
      var base = resultNodes[nodeId] || {};
      var peak = peakUtilization(intervals, base.c, duration);
      loadNodes[nodeId] = {
        arrivals: records.length,
        started: started,
        completions: completions,
        drops: Math.max(drops, Number(base.drops) || 0),
        censoredProcessing: Math.max(0, started - completions),
        neverProcessed: Math.max(0, records.length - started - drops),
        queueOutcome: {
          served: completions,
          censoredProcessing: Math.max(0, started - completions),
          terminatedInQueue: terminatedInQueue,
          stillWaitingAtEnd: stillWaitingAtEnd,
          dropped: drops
        },
        queueWait: quantiles(waits),
        serviceTime: quantiles(services),
        capacity: base.c == null ? null : base.c,
        rho: finite(base.rho) ? round(base.rho) : null,
        peakRho: peak ? peak.value : null,
        peakWindowStartSec: peak ? peak.windowStartSec : null,
        attributedLeaks: (attribution.queuedByNode[nodeId] || 0) +
          (attribution.processingByNode[nodeId] || 0)
      };
    });

    var duplicateThreats = 0, concurrent = 0, sequential = 0;
    Object.keys(firesByThreat).forEach(function (id) {
      var fires = firesByThreat[id].slice().sort(function (a, b) { return a.t - b.t; });
      var shooters = {};
      fires.forEach(function (fire) { shooters[fire.shooterId || 'unknown'] = true; });
      if (Object.keys(shooters).length < 2) return;
      duplicateThreats++;
      var results = threats[id].results.slice().sort(function (a, b) { return a.t - b.t; });
      var firstResolution = results.length ? results[0].t : Infinity;
      if (fires[1].t <= firstResolution) concurrent++; else sequential++;
    });

    // ── 명령 수명주기 ──
    var directiveList = Object.keys(directives).map(function (id) { return directives[id]; });
    var expiryByReason = {}, directiveDelay = { createdToReceived: [], receivedToActive: [], createdToActive: [] };
    var directiveSummary = {
      available: directiveList.length > 0,
      created: 0, sent: 0, received: 0, processing: 0, active: 0, expired: 0, cancelled: 0
    };
    directiveList.forEach(function (dir) {
      if (dir.createdAt != null) directiveSummary.created++;
      if (dir.sentAt != null) directiveSummary.sent++;
      if (dir.receivedAt != null) directiveSummary.received++;
      if (dir.processingAt != null) directiveSummary.processing++;
      if (dir.activeAt != null) directiveSummary.active++;
      if (dir.expiredAt != null) {
        directiveSummary.expired++;
        expiryByReason[dir.expiryReason || 'unknown'] = (expiryByReason[dir.expiryReason || 'unknown'] || 0) + 1;
      }
      if (dir.cancelledAt != null) directiveSummary.cancelled++;
      if (dir.createdAt != null && dir.receivedAt != null) directiveDelay.createdToReceived.push(dir.receivedAt - dir.createdAt);
      if (dir.receivedAt != null && dir.activeAt != null) directiveDelay.receivedToActive.push(dir.activeAt - dir.receivedAt);
      if (dir.createdAt != null && dir.activeAt != null) directiveDelay.createdToActive.push(dir.activeAt - dir.createdAt);
    });
    directiveSummary.activationRate = ratio(directiveSummary.active, directiveSummary.created);
    directiveSummary.expiryRate = ratio(directiveSummary.expired, directiveSummary.created);
    directiveSummary.expiryByReason = expiryByReason;
    directiveSummary.delays = {
      createdToReceived: quantiles(directiveDelay.createdToReceived),
      receivedToActive: quantiles(directiveDelay.receivedToActive),
      createdToActive: quantiles(directiveDelay.createdToActive)
    };

    // ── 항적 신선도 ──
    var decisionAges = [], fireAges = [], detectToReport = [], agesByAxis = {}, agesByCategory = {};
    var decisionWithAge = 0, staleDecisions = 0;
    Object.keys(threats).forEach(function (id) {
      var tr = threats[id];
      tr.decisions.forEach(function (event) {
        var age = finite(event.trackAgeSec) ? event.trackAgeSec
          : (finite(event.trackLastUpdateAt) ? event.t - event.trackLastUpdateAt : null);
        if (!finite(age) || age < 0) return;
        decisionAges.push(age); decisionWithAge++;
        if (age > 120) staleDecisions++;
        var axis = event.commanderAxis || 'unknown';
        var category = event.threatCategory || 'unknown';
        (agesByAxis[axis] = agesByAxis[axis] || []).push(age);
        (agesByCategory[category] = agesByCategory[category] || []).push(age);
      });
      tr.fires.forEach(function (event) {
        var age = finite(event.fireControlTrackAgeSec) ? event.fireControlTrackAgeSec
          : (finite(event.trackAgeSec) ? event.trackAgeSec : null);
        if (finite(age) && age >= 0) fireAges.push(age);
      });
      if (tr.detect != null && tr.reports.length) {
        var firstReport = tr.reports.reduce(function (best, event) { return Math.min(best, event.t); }, Infinity);
        if (finite(firstReport) && firstReport >= tr.detect) detectToReport.push(firstReport - tr.detect);
      }
    });
    var byAxis = {}, byCategory = {};
    Object.keys(agesByAxis).forEach(function (key) { byAxis[key] = quantiles(agesByAxis[key]); });
    Object.keys(agesByCategory).forEach(function (key) { byCategory[key] = quantiles(agesByCategory[key]); });
    var totalDecisions = Object.keys(threats).reduce(function (sum, id) { return sum + threats[id].decisions.length; }, 0);
    var trackFreshness = {
      available: decisionWithAge > 0,
      decisionTrackAge: quantiles(decisionAges),
      fireControlTrackAge: quantiles(fireAges),
      detectToReport: quantiles(detectToReport),
      byAxis: byAxis,
      byThreatCategory: byCategory,
      staleDecisionCount: staleDecisions,
      staleDecisionRate: ratio(staleDecisions, decisionWithAge),
      coverage: { decisions: totalDecisions, withAge: decisionWithAge, ratio: ratio(decisionWithAge, totalDecisions) },
      note: '결심 age는 C2 ledger 마지막 갱신 기준(120초), 발사 age는 가용 시 MFR FC 트랙 기준'
    };

    // ── 비상·자위권 결과와 교전 공백 ──
    var emergency = { total: 0, hit: 0, miss: 0, unresolved: 0 };
    var selfDefense = { total: 0, hit: 0, miss: 0, unresolved: 0 };
    var gap = { preFire: [], betweenEngagements: [], beforeLeak: [], neverEngagedLeaked: 0, gapsClosedByEmergency: 0 };
    function resultForFire(tr, fire) {
      if (fire.engagementId) {
        var exact = tr.results.find(function (event) { return event.engagementId === fire.engagementId; });
        if (exact) return exact;
      }
      return tr.results.find(function (event) {
        return event.t >= fire.t && (!fire.shooterId || event.shooterId === fire.shooterId);
      }) || null;
    }
    Object.keys(threats).forEach(function (id) {
      var tr = threats[id], sortedFires = tr.fires.slice().sort(function (a, b) { return a.t - b.t; });
      sortedFires.forEach(function (fire) {
        if (fire.cause !== 'emergency' && fire.cause !== 'self_defense') return;
        var bucket = fire.cause === 'emergency' ? emergency : selfDefense;
        bucket.total++;
        var resolved = resultForFire(tr, fire);
        if (!resolved) bucket.unresolved++;
        else if (resolved.type === 'INTERCEPT_HIT') bucket.hit++;
        else bucket.miss++;
      });
      if (tr.detect == null) return;
      if (!sortedFires.length) {
        if (tr.leak != null) {
          gap.neverEngagedLeaked++;
          gap.beforeLeak.push(tr.leak - tr.detect);
        }
        return;
      }
      var intervals = sortedFires.map(function (fire) {
        var resolved = resultForFire(tr, fire);
        var end = resolved ? resolved.t : (tr.kill != null ? tr.kill : (tr.leak != null ? tr.leak : duration));
        return { start: fire.t, end: Math.max(fire.t, end), emergency: fire.cause === 'emergency' };
      }).sort(function (a, b) { return a.start - b.start; });
      var merged = [];
      intervals.forEach(function (interval) {
        var last = merged[merged.length - 1];
        if (last && interval.start <= last.end) {
          last.end = Math.max(last.end, interval.end);
        } else {
          merged.push({ start: interval.start, end: interval.end, emergency: interval.emergency });
        }
      });
      var firstGap = merged[0].start - tr.detect;
      if (firstGap >= 0) {
        gap.preFire.push(firstGap);
        if (firstGap > 0 && merged[0].emergency) gap.gapsClosedByEmergency++;
      }
      for (var gi = 1; gi < merged.length; gi++) {
        var between = merged[gi].start - merged[gi - 1].end;
        if (between > 0) {
          gap.betweenEngagements.push(between);
          if (merged[gi].emergency) gap.gapsClosedByEmergency++;
        }
      }
      if (tr.leak != null) {
        var tail = tr.leak - merged[merged.length - 1].end;
        if (tail > 0) gap.beforeLeak.push(tail);
      }
    });

    // ── 교전 기회 손실: 실제 기하학 창이 있었으나 발사 0으로 누출된 위협을 1회 집계 ──
    var opportunity = { available: false, eligibleThreats: 0, lostThreats: 0, byReason: {}, byContributor: {} };
    Object.keys(threats).forEach(function (id) {
      var tr = threats[id], leakEvent = tr.leakEvent;
      var eligible = tr.decisions.length > 0 || !!(leakEvent && leakEvent.hadGeometryWindow);
      if (eligible) {
        opportunity.available = true;
        opportunity.eligibleThreats++;
      }
      if (!leakEvent || !leakEvent.hadGeometryWindow || tr.fires.length > 0) return;
      opportunity.lostThreats++;
      var reason = leakEvent.reason || 'unknown';
      opportunity.byReason[reason] = (opportunity.byReason[reason] || 0) + 1;
      (leakEvent.failureContributors || []).forEach(function (code) {
        opportunity.byContributor[code] = (opportunity.byContributor[code] || 0) + 1;
      });
    });
    opportunity.lossRate = ratio(opportunity.lostThreats, opportunity.eligibleThreats);
    opportunity.note = '실제 PIP 기하학 창이 존재했지만 발사 0으로 누출된 위협을 위협당 1회 집계';

    var evidence = [];
    Object.keys(loadNodes).forEach(function (nodeId) {
      var n = loadNodes[nodeId];
      var level = n.drops > 0 || n.rho >= RHO_BOTTLENECK || n.peakRho >= RHO_BOTTLENECK
        ? 'bottleneck' : (n.rho >= RHO_WARN || n.peakRho >= RHO_WARN ? 'warn' : 'normal');
      if (level === 'normal' && n.attributedLeaks === 0) return;
      evidence.push({
        nodeId: nodeId,
        level: level,
        rho: n.rho,
        peakRho: n.peakRho,
        queueP90Sec: n.queueWait.p90,
        drops: n.drops,
        attributedLeaks: n.attributedLeaks,
        recommendation: recommendation(n, n.attributedLeaks)
      });
    });
    evidence.sort(function (a, b) {
      return (b.attributedLeaks - a.attributedLeaks) ||
        ((b.peakRho || b.rho || 0) - (a.peakRho || a.rho || 0)) ||
        (a.nodeId < b.nodeId ? -1 : 1);
    });

    var commandTotal = Object.keys(fireCause).reduce(function (sum, key) { return sum + fireCause[key]; }, 0);
    return {
      available: events.length > 0,
      eventCount: events.length,
      truncated: !!result.c2EventsTruncated,
      denominators: {
        spawned: result.global.spawned || spawned,
        resolved: (result.global.killed || 0) + (result.global.leaked || 0),
        censored: result.global.censoredRaw || 0
      },
      pipelineFunnel: {
        spawned: spawned, detected: detected, decided: decided,
        fired: firedThreats, killed: killed, leaked: leaked
      },
      killchainDelays: {
        spawnToDetect: quantiles(delay.spawnToDetect),
        detectToDecision: quantiles(delay.detectToDecision),
        decisionToFire: quantiles(delay.decisionToFire),
        fireToKill: quantiles(delay.fireToKill),
        spawnToKill: quantiles(delay.spawnToKill)
      },
      c2Load: {
        thresholds: { warn: RHO_WARN, bottleneck: RHO_BOTTLENECK, peakWindowSec: WINDOW_SEC },
        nodes: loadNodes
      },
      c2Attribution: {
        totalLeaks: leaked,
        byState: attribution,
        queuedOrProcessingRatio: ratio(attribution.queued + attribution.processing, leaked),
        note: '누출 시점의 마지막 C2 상태 귀속이며 단일 실행 인과 증명은 아님'
      },
      duplicateEngagement: {
        engagedThreats: Object.keys(firesByThreat).length,
        duplicateThreats: duplicateThreats,
        ratio: ratio(duplicateThreats, Object.keys(firesByThreat).length),
        concurrent: concurrent,
        sequential: sequential
      },
      c2Command: {
        total: commandTotal,
        byCause: fireCause,
        decisionByCause: decisionCause,
        directives: directiveSummary,
        coordinationFailures: commandDiagnostics.coordinationFailed,
        responsibilityUnresolved: commandDiagnostics.responsibilityUnresolved
      },
      emergencyFire: {
        total: emergency.total,
        ratio: ratio(emergency.total, commandTotal),
        outcomes: emergency
      },
      selfDefenseFire: {
        total: selfDefense.total,
        ratio: ratio(selfDefense.total, commandTotal),
        outcomes: selfDefense
      },
      trackFreshness: trackFreshness,
      lostOpportunity: opportunity,
      engagementGap: {
        available: detected > 0,
        preFire: quantiles(gap.preFire),
        betweenEngagements: quantiles(gap.betweenEngagements),
        beforeLeak: quantiles(gap.beforeLeak),
        neverEngagedLeaked: gap.neverEngagedLeaked,
        gapsClosedByEmergency: gap.gapsClosedByEmergency,
        note: '실제 SENSOR_DETECTED 이후 요격탄 비행구간 합집합 밖의 공백'
      },
      bottleneckEvidence: evidence,
      measurement: {
        detection: '실제 SENSOR_DETECTED 이벤트',
        availability: events.length > 0,
        note: '원시 이벤트는 Worker 내부에서 요약 후 폐기 가능; 미계측을 0으로 위장하지 않음'
      }
    };
  };
})();
