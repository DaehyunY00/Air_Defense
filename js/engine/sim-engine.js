/**
 * K-JAMDS 시뮬레이터 — 이산사건 시뮬레이션(DES) 엔진 (Phase 2, 핵심)
 *
 * Phase 1의 정상상태 M/M/c 해석 근사(analysis/bottleneck.js)를 실제 이벤트 구동 시뮬레이션으로
 * 대체·보강한다. 개별 위협 객체를 생성해 9단계 C2 파이프라인에 흘려보내고, 각 노드를
 * M/M/c/K 서버풀로 처리하며, 관측 통계(이용률·대기열·대기시간·드롭·격추/누수)를 수집한다.
 *
 * ── 9단계 C2 파이프라인 (계획서 Key Findings 1: 협조/권한위임·재교전 피드백 보완형) ──
 *   1 탐지(Detect)         : 센서 스캔, 저탐지 위협은 항적소실→재획득 반복
 *   2 추적생성(Track)      : 보고 링크 지연 후 C2 도착
 *   3 식별(Identify)       ┐
 *   4 위협평가(TE)         ├ C2 서버 처리(서비스시간) — To-Be는 JAMDC2 융합 노드에서 수행
 *   5 무기-표적할당(WTA)   ┘
 *   6 결심(Decision)       : 교전승인권자 — As-Is는 상위 제대 승인 필요
 *   7 교전협조/권한위임    : 육↔공 coord 홉(As-Is 음성 지연·중복교전의 원천)
 *   8 교전/요격명령(Engage): 명령 링크 지연 후 무기 교전채널(M/M/c) 처리
 *   9 BDA                  : 요격확률 판정 → 실패 시 재교전 피드백(폐루프, 상한 내)
 *
 * ── 설계 원칙(요구 반영): 병목은 고정이 아니라 시나리오에서 도출 ──
 *   병목 노드/링크/공백은 어디에도 하드코딩되지 않는다. [시나리오 도착률 × 모드별 토폴로지 ×
 *   M/M/c/K 용량]으로 이벤트가 전개된 결과의 관측 통계(ρ≥임계, 드롭>0, 누수 등)에서 도출된다.
 *   시나리오·강도·모드·seed가 바뀌면 병목 위치와 정도가 함께 바뀐다.
 *
 * ── 재현성 ──
 *   모든 무작위성은 seed 기반 Mulberry32(core/rng.js)에서만 나오고, 이벤트 동시성은
 *   (t, 우선순위, 삽입순서)로 결정론적으로 해소되므로, 동일 config는 동일 결과를 낸다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  // 이벤트 우선순위: 동일 시각에서 처리 순서 (작을수록 먼저).
  // 서비스 완료를 먼저 해소 → 도착 → 탐지 → 신규발생 → 마지막에 공역이탈(누수 판정).
  var PRI = {
    SERVICE_END: 1, ARRIVE_NODE: 2, LINK_ARRIVE: 2,
    DETECT: 3, SPAWN: 4, EXIT: 5
  };

  var SCAN_SEC = 10;        // 센서 스캔 주기(개념값) — 탐지 재시도 간격
  var MAX_ENGAGE_TRIES = 3; // BDA 실패 시 재교전 상한(무한 폐루프 방지)
  var SHOOTER_QUEUE_MULT = 2; // 무기 대기실 = 교전채널 × 배수 (M/M/c/K, K=c*mult)

  // 병목 판정 임계값 (Phase 1과 동일 기준: 계획서 ENV-RHO-THRESH-01)
  var RHO_WARN = 0.7, RHO_BOTTLENECK = 0.9;

  /**
   * @param {object} cfg { scenario, mode, intensity, seed, endTimeSec }
   */
  function Simulation(cfg) {
    this.scenario = cfg.scenario;
    this.mode = cfg.mode;
    this.intensity = cfg.intensity === undefined ? 1 : cfg.intensity; // 강도 0 허용
    this.seed = cfg.seed === undefined ? 1 : (cfg.seed >>> 0); // seed 0 보존
    this.endTime = cfg.endTimeSec || 1800;
    // 민감도 스윕용 파라미터 배수(기본 1). 서비스시간·통신지연·탐지확률·요격확률을
    // 전역 스케일링해 ±20% 스윕 등에 사용 (Phase 3 mc-runner). 근거: 계획서 V&V 민감도분석.
    var m = cfg.mult || {};
    this.mult = {
      service: m.service || 1, delay: m.delay || 1,
      detect: m.detect || 1, pk: m.pk || 1
    };
    this.rng = KJ.makeRng(this.seed);
    this.heap = new KJ.MinHeap();
    this.now = 0;
    this.seq = 0;
    this.threatSeq = 0;
    this.nodeState = {};
    this.linkStat = {};   // "from>to" -> {count, delaySec, type, kind}
    this.global = {
      spawned: 0, detected: 0, engaged: 0, killed: 0, leaked: 0,
      reachedC2: 0, everEngaged: 0,
      leakReasons: {}, timeToKill: []
    };
    this.eventCount = 0;
    this.log = [];        // 표본 이벤트 로그(앞부분만 보존)

    // ── Phase 4 재생용 trace (옵트인, 기본 false — 기존 동작·통계에 영향 없음) ──
    // 항적별 9단계 타임스탬프(Gantt)와 노드별 재고 시계열(대기열 애니메이션)을 기록한다.
    this.trace = !!cfg.trace;
    this.traceCap = cfg.traceCap || 300;       // 추적할 위협 수 상한(메모리 보호)
    this.nodeSeriesCap = cfg.nodeSeriesCap || 20000; // 전 노드 합산 샘플 수 상한
    this.threatTraces = [];
    this.nodeSeries = {};
    this._seriesCount = 0;
    this.traceTruncated = false;
    this.nodeSeriesTruncated = false;

    this._initNodes();
  }

  Simulation.prototype._initNodes = function () {
    var self = this, mode = this.mode;
    KJ.nodesInMode(mode).forEach(function (n) {
      if (n.category === 'sensor') return;
      var c, mean, K;
      if (n.category === 'c2') {
        c = n.queue.servers;
        mean = n.queue.serviceTimeSec[mode];
        K = isFinite(n.queue.capacity) ? n.queue.capacity : c + 50;
      } else { // shooter
        c = n.engage.channels;
        mean = n.engage.engageTimeSec;
        K = c * SHOOTER_QUEUE_MULT;
      }
      self.nodeState[n.id] = {
        node: n, c: c, mean: mean * self.mult.service, K: K,
        busy: 0, queue: [], lastT: 0,
        busyTime: 0, qTime: 0,
        arrivals: 0, completions: 0, drops: 0,
        waitAccum: 0, waitCount: 0, maxInSystem: 0
      };
      if (self.trace) self.nodeSeries[n.id] = [];
    });
  };

  /** 노드 재고(재계 중+대기) 시계열 샘플 기록 (trace 모드 전용, 상한 초과 시 절삭·플래그) */
  Simulation.prototype._sample = function (nsId, t) {
    if (!this.trace) return;
    if (this._seriesCount >= this.nodeSeriesCap) { this.nodeSeriesTruncated = true; return; }
    var ns = this.nodeState[nsId];
    this.nodeSeries[nsId].push({ t: t, n: ns.busy + ns.queue.length });
    this._seriesCount++;
  };

  /** 위협 trace에 단계 이벤트 기록 (trace 대상이 아니면 무연산) */
  Simulation.prototype._mark = function (threat, name, t) {
    if (threat._trace) threat._trace.stages.push({ name: name, t: t });
  };

  // ── 스케줄러 ──
  Simulation.prototype.schedule = function (t, pri, type, data) {
    this.heap.push({ t: t, pri: pri, seq: this.seq++, type: type, data: data });
  };

  Simulation.prototype._link = function (fromId, toId, kind) {
    var l = KJ.LINKS.find(function (x) {
      return x.from === fromId && x.to === toId &&
        (kind ? x.kind === kind : true) && x.comm[this.mode];
    }, this);
    return l ? l.comm[this.mode] : null;
  };

  Simulation.prototype._recordLink = function (fromId, toId, comm, kind) {
    var key = fromId + '>' + toId;
    var s = this.linkStat[key];
    if (!s) s = this.linkStat[key] = { from: fromId, to: toId, count: 0, delaySec: comm.delaySec, type: comm.type, kind: kind };
    s.count++;
  };

  // ── 노드 서버풀(M/M/c/K) ──
  Simulation.prototype._advance = function (ns, t) {
    var dt = t - ns.lastT;
    if (dt > 0) {
      ns.busyTime += ns.busy * dt;
      ns.qTime += ns.queue.length * dt;
      ns.lastT = t;
    }
  };

  /** 작업을 노드에 투입. 서버 여유→즉시 서비스, 대기실 여유→큐, 초과(K)→드롭(누수). */
  Simulation.prototype._nodeArrive = function (nsId, t, job, onDone) {
    var ns = this.nodeState[nsId];
    if (!ns) return;
    this._advance(ns, t);
    ns.arrivals++;
    var inSystem = ns.busy + ns.queue.length;
    if (ns.busy < ns.c) {
      ns.busy++;
      ns.waitAccum += 0; ns.waitCount++;
      this._startService(ns, t, job, onDone);
    } else if (inSystem < ns.K) {
      ns.queue.push({ job: job, onDone: onDone, enqT: t });
    } else {
      ns.drops++;                 // M/M/c/K 포화 → 항적/교전기회 상실
      job.threat.pipelineDead = true;
      if (!job.threat.leakReason) job.threat.leakReason = 'overflow:' + nsId;
    }
    ns.maxInSystem = Math.max(ns.maxInSystem, ns.busy + ns.queue.length);
    this._sample(nsId, t);
  };

  Simulation.prototype._startService = function (ns, t, job, onDone) {
    var svc = this.rng.exponential(ns.mean);
    this.schedule(t + svc, PRI.SERVICE_END, 'SERVICE_END', { nsId: ns.node.id, job: job, onDone: onDone });
  };

  Simulation.prototype._onServiceEnd = function (t, d) {
    var ns = this.nodeState[d.nsId];
    this._advance(ns, t);
    ns.busy--;
    ns.completions++;
    // 다음 대기 작업 인출 — 이미 공역이탈(누수)·폐기된 항적은 건너뜀(track abandonment/reneging).
    // 포화 노드가 이미 떠난 항적에 유령 서비스 부하를 계상하지 않도록 한다.
    while (ns.queue.length > 0) {
      var nx = ns.queue.shift();
      if (!nx.job.threat.alive || nx.job.threat.pipelineDead) continue; // 재고에서 폐기
      ns.busy++;
      ns.waitAccum += (t - nx.enqT); ns.waitCount++;
      this._startService(ns, t, nx.job, nx.onDone);
      break;
    }
    this._sample(d.nsId, t);
    if (d.onDone) d.onDone(t, d.job);
  };

  // ── 파이프라인 ──

  /** 1 탐지: 축선·클래스 커버 센서 선별 후 첫 스캔 예약 */
  Simulation.prototype._beginDetect = function (threat, t) {
    var mode = this.mode, type = threat.type, axis = threat.axis;
    var sensors = KJ.nodesInMode(mode).filter(function (n) {
      return n.category === 'sensor' &&
        n.detects.indexOf(type) !== -1 && n.coverage.indexOf(axis) !== -1;
    });
    if (sensors.length === 0) { threat.leakReason = 'no_sensor'; return; } // 탐지 공백
    threat._sensors = sensors;
    this.schedule(t + SCAN_SEC, PRI.DETECT, 'DETECT', { threat: threat });
  };

  Simulation.prototype._onDetect = function (t, d) {
    var threat = d.threat;
    if (!threat.alive || threat.detected || threat.pipelineDead) return;
    var tt = KJ.threatType(threat.type);
    var p = Math.min(1, tt.detectFactor * this.mult.detect); // per-scan 탐지확률(민감도 배수 적용)
    if (this.rng.raw() < p) {
      threat.detected = true;
      this.global.detected++;
      this._mark(threat, '탐지', t);
      this._onDetected(threat, t);
    } else {
      // 항적 소실 → 재획득 시도 (공역 이탈 전까지 반복, EXIT가 상한)
      this.schedule(t + SCAN_SEC, PRI.DETECT, 'DETECT', { threat: threat });
    }
  };

  /** 2 추적생성: 최속 보고경로로 담당 C2에 항적 전달 */
  Simulation.prototype._onDetected = function (threat, t) {
    var self = this, best = null;
    threat._sensors.forEach(function (s) {
      KJ.LINKS.forEach(function (l) {
        if (l.from === s.id && l.kind === 'report' && l.comm[self.mode]) {
          var d = l.comm[self.mode].delaySec;
          if (!best || d < best.delay) best = { c2: l.to, delay: d, comm: l.comm[self.mode], from: s.id };
        }
      });
    });
    if (!best) { threat.leakReason = 'no_report_path'; return; }
    this._recordLink(best.from, best.c2, best.comm, 'report');
    this.schedule(t + best.delay * this.mult.delay, PRI.LINK_ARRIVE, 'C2_ARRIVE', { threat: threat, c2: best.c2 });
  };

  /** 3·4·5 식별·위협평가·WTA: C2(또는 To-Be JAMDC2) 서버 처리 */
  Simulation.prototype._onC2Arrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    this._mark(threat, 'C2도착:' + d.c2, t);
    this._nodeArrive(d.c2, t, { threat: threat }, function (tt2, job) {
      if (!job.threat._countedC2) { job.threat._countedC2 = true; self.global.reachedC2++; }
      self._mark(job.threat, 'C2처리완료:' + d.c2, tt2);
      self._afterC2(tt2, job.threat, d.c2);
    });
  };

  Simulation.prototype._afterC2 = function (t, threat, c2Id) {
    if (!threat.alive || threat.pipelineDead) return;
    var self = this;
    // To-Be: 다중센서 융합·AI 식별·무기배정을 JAMDC2에서 집중 수행
    if (this.mode === 'tobe' && KJ.nodeById('JAMDC2') && this.nodeState['JAMDC2'] && c2Id !== 'JAMDC2') {
      var comm = this._link(c2Id, 'JAMDC2', 'report') || this._link(c2Id, 'JAMDC2', null);
      var delay = comm ? comm.delaySec : 0;
      if (comm) this._recordLink(c2Id, 'JAMDC2', comm, 'report');
      this._mark(threat, '융합경유', t);
      this.schedule(t + delay * this.mult.delay, PRI.LINK_ARRIVE, 'FUSION_ARRIVE', { threat: threat });
      return;
    }
    this._decision(threat, t, c2Id);
  };

  Simulation.prototype._onFusionArrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    this._nodeArrive('JAMDC2', t, { threat: threat }, function (tt2, job) {
      if (!job.threat._countedC2) { job.threat._countedC2 = true; self.global.reachedC2++; }
      self._mark(job.threat, '융합처리완료', tt2);
      // To-Be는 사전승인 자동교전(approval=null)이 대부분 → 결심 홉 없이 바로 교전
      self._decision(job.threat, tt2, 'JAMDC2');
    });
  };

  /** 6·7 결심·교전협조/권한위임: As-Is는 승인권자까지 coord 최단경로 홉 */
  Simulation.prototype._decision = function (threat, t, controlC2) {
    var tt = KJ.threatType(threat.type);
    var approvalId = tt.approvalLevel ? tt.approvalLevel[this.mode] : null;
    if (!approvalId || approvalId === controlC2 || !this.nodeState[approvalId]) {
      this._doEngage(threat, t);       // 승인 불필요(자동교전) 또는 동일 노드 승인
      return;
    }
    var path = coordPath(controlC2, approvalId, this.mode);
    if (!path) { threat.leakReason = 'responsibility_gap'; return; } // 책임공백(협조 경로 부재)
    var self = this, delay = 0;
    path.forEach(function (l) {
      delay += l.comm[self.mode].delaySec;
      self._recordLink(l.from, l.to, l.comm[self.mode], 'coord');
    });
    this._mark(threat, '협조개시:' + controlC2 + '→' + approvalId, t);
    this.schedule(t + delay * this.mult.delay, PRI.LINK_ARRIVE, 'APPROVE_ARRIVE', { threat: threat, appr: approvalId });
  };

  Simulation.prototype._onApproveArrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    this._nodeArrive(d.appr, t, { threat: threat }, function (tt2, job) {
      self._mark(job.threat, '승인완료:' + d.appr, tt2);
      self._doEngage(job.threat, tt2);
    });
  };

  /** 8 교전명령: WTA로 무기 선택(최소부하) → 명령 링크 → 교전채널 투입 */
  Simulation.prototype._doEngage = function (threat, t) {
    if (!threat.alive || threat.pipelineDead) return;
    var mode = this.mode, type = threat.type;
    var shooters = KJ.nodesInMode(mode).filter(function (n) {
      return n.category === 'shooter' && n.canEngage[type] &&
        n.controlledBy && (n.controlledBy[mode] || []).length > 0;
    });
    if (shooters.length === 0) { threat.leakReason = 'no_shooter'; return; } // 교전 불가(제약)
    var self = this, best = null;
    shooters.forEach(function (sh) {
      var ns = self.nodeState[sh.id];
      var load = ns ? (ns.busy + ns.queue.length) : 0;
      if (!best || load < best.load) best = { sh: sh, load: load };
    });
    var shooter = best.sh;
    var controlC2 = shooter.controlledBy[mode][0];
    var comm = this._link(controlC2, shooter.id, 'command');
    var delay = comm ? comm.delaySec : 0;
    if (comm) this._recordLink(controlC2, shooter.id, comm, 'command');
    this.global.engaged++;
    if (!threat._countedEngaged) { threat._countedEngaged = true; this.global.everEngaged++; }
    this._mark(threat, '교전명령#' + (threat.tries + 1) + ':' + shooter.id, t);
    this.schedule(t + delay * this.mult.delay, PRI.LINK_ARRIVE, 'SHOOTER_ARRIVE', { threat: threat, shooter: shooter.id });
  };

  Simulation.prototype._onShooterArrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    this._nodeArrive(d.shooter, t, { threat: threat }, function (tt2, job) {
      self._onEngageEnd(tt2, job.threat, d.shooter);
    });
  };

  /** 9 BDA: 요격확률 판정 → 실패 시 재교전 피드백(폐루프) */
  Simulation.prototype._onEngageEnd = function (t, threat, shooterId) {
    if (!threat.alive) return;
    var shooter = KJ.nodeById(shooterId);
    threat.tries++;
    var pk = this._pk(shooter, threat);
    if (this.rng.raw() < pk) {
      threat.alive = false; threat.killed = true;
      this.global.killed++;
      this.global.timeToKill.push(t - threat.spawnT);
      this._mark(threat, '격추성공#' + threat.tries, t);
      if (threat._trace) { threat._trace.exitT = t; threat._trace.outcome = 'killed'; }
    } else if (threat.tries < MAX_ENGAGE_TRIES && t < threat.spawnT + threat.dwellSec) {
      this._mark(threat, '교전실패#' + threat.tries, t);
      this._doEngage(threat, t);          // 재교전
    } else if (!threat.leakReason) {
      threat.leakReason = 'missed';       // 요격 실패(기회 소진)
      this._mark(threat, '교전실패#' + threat.tries + '(기회소진)', t);
    }
  };

  /** 요격확률(개념값). 소형 무인기는 저효율(2022.12.26 격추실패 반영). */
  Simulation.prototype._pk = function (shooter, threat) {
    var pk;
    if (threat.type === 'uav_small') pk = this.rng.triangular(0.1, 0.3, 0.5);
    else if (shooter.category === 'shooter' && (threat.type === 'srbm' || threat.type === 'mrl_large'))
      pk = this.rng.triangular(0.6, 0.75, 0.9);
    else pk = this.rng.triangular(0.6, 0.8, 0.9);
    return Math.max(0, Math.min(1, pk * this.mult.pk)); // 민감도 배수 적용, [0,1] 클램프
  };

  // ── 발생·이탈 ──
  Simulation.prototype._spawn = function (t, d) {
    var entry = d.entry;
    var tt = KJ.threatType(entry.type);
    this.threatSeq++;
    this.global.spawned++;
    var threat = {
      id: entry.type + '#' + this.threatSeq, type: entry.type, axis: entry.axis,
      spawnT: t, dwellSec: tt.dwellSec, alive: true, killed: false,
      detected: false, pipelineDead: false, tries: 0, leakReason: null,
      _trace: null, _countedC2: false, _countedEngaged: false
    };
    if (this.trace) {
      if (this.threatTraces.length < this.traceCap) {
        threat._trace = {
          id: threat.id, type: threat.type, axis: threat.axis,
          spawnT: t, exitT: null, outcome: null, stages: [{ name: '생성', t: t }]
        };
        this.threatTraces.push(threat._trace);
      } else {
        this.traceTruncated = true;
      }
    }
    this.schedule(t + threat.dwellSec, PRI.EXIT, 'EXIT', { threat: threat });
    this._beginDetect(threat, t);
    // 다음 도착 (포아송: 지수 도착간격)
    var ratePerSec = (entry.ratePerMin * this.intensity) / 60;
    if (ratePerSec > 0) {
      var next = t + this.rng.exponential(1 / ratePerSec);
      if (next <= this.endTime) this.schedule(next, PRI.SPAWN, 'SPAWN', { entry: entry });
    }
  };

  Simulation.prototype._onExit = function (t, d) {
    var threat = d.threat;
    if (!threat.alive) return; // 이미 격추
    threat.alive = false;
    this.global.leaked++;
    var reason = threat.leakReason || (threat.detected ? 'timeout' : 'not_detected');
    this.global.leakReasons[reason] = (this.global.leakReasons[reason] || 0) + 1;
    if (threat._trace) {
      threat._trace.exitT = t;
      threat._trace.outcome = 'leaked:' + reason;
      threat._trace.stages.push({ name: '누수:' + reason, t: t });
    }
  };

  // ── 실행 ──
  Simulation.prototype.run = function () {
    var self = this;
    // 각 위협 스트림 최초 도착 예약
    this.scenario.mix.forEach(function (entry) {
      var ratePerSec = (entry.ratePerMin * self.intensity) / 60;
      if (ratePerSec <= 0) return;
      var first = self.rng.exponential(1 / ratePerSec);
      if (first <= self.endTime) self.schedule(first, PRI.SPAWN, 'SPAWN', { entry: entry });
    });

    while (this.heap.size() > 0) {
      var ev = this.heap.pop();
      if (ev.t > this.endTime) break;
      this.now = ev.t;
      this.eventCount++;
      if (this.log.length < 200) this.log.push({ t: +ev.t.toFixed(2), type: ev.type });
      this._dispatch(ev);
    }
    // 통계 마감: 모든 노드 상태를 종료시각까지 진행
    Object.keys(this.nodeState).forEach(function (id) {
      self._advance(self.nodeState[id], self.endTime);
    });
    return this._results();
  };

  Simulation.prototype._dispatch = function (ev) {
    switch (ev.type) {
      case 'SPAWN': this._spawn(ev.t, ev.data); break;
      case 'DETECT': this._onDetect(ev.t, ev.data); break;
      case 'C2_ARRIVE': this._onC2Arrive(ev.t, ev.data); break;
      case 'FUSION_ARRIVE': this._onFusionArrive(ev.t, ev.data); break;
      case 'APPROVE_ARRIVE': this._onApproveArrive(ev.t, ev.data); break;
      case 'SHOOTER_ARRIVE': this._onShooterArrive(ev.t, ev.data); break;
      case 'SERVICE_END': this._onServiceEnd(ev.t, ev.data); break;
      case 'EXIT': this._onExit(ev.t, ev.data); break;
    }
  };

  // ── 결과·병목 도출 ──
  Simulation.prototype._results = function () {
    var self = this, T = this.endTime;
    var nodes = Object.keys(this.nodeState).map(function (id) {
      var ns = self.nodeState[id];
      var rho = ns.busyTime / (ns.c * T);
      var Lq = ns.qTime / T;
      var Wq = ns.waitCount ? ns.waitAccum / ns.waitCount : 0;
      var level = 'idle';
      if (ns.arrivals > 0) {
        if (ns.drops > 0) level = 'saturated';
        else if (rho >= RHO_BOTTLENECK) level = 'bottleneck';
        else if (rho >= RHO_WARN) level = 'warn';
        else level = 'normal';
      }
      return {
        id: id, name: ns.node.name, category: ns.node.category,
        c: ns.c, K: ns.K, meanSec: ns.mean,
        arrivals: ns.arrivals, completions: ns.completions, drops: ns.drops,
        rho: rho, Lq: Lq, Wq: Wq, maxInSystem: ns.maxInSystem, level: level
      };
    });

    var links = Object.keys(this.linkStat).map(function (k) {
      var s = self.linkStat[k];
      var perMin = s.count / (T / 60);
      var inTransit = perMin * s.delaySec / 60; // Little's Law: 전달 중 평균 체류 항적
      return {
        from: s.from, to: s.to, kind: s.kind, type: s.type,
        delaySec: s.delaySec, count: s.count, perMin: perMin,
        isCommBottleneck: s.delaySec >= 60 && inTransit >= 1
      };
    });

    // 병목 종합 (관측 통계에서 도출, 심각도순)
    var bottlenecks = [];
    nodes.forEach(function (r) {
      if (r.level === 'saturated' || r.level === 'bottleneck') {
        bottlenecks.push({
          kind: 'node', severity: r.level === 'saturated' ? 3 : 2,
          id: r.id, name: r.name,
          detail: '관측 ρ=' + r.rho.toFixed(2) +
            (r.drops > 0 ? ' · 드롭(포화손실) ' + r.drops + '건 — 처리용량 초과' :
              ' · 평균대기 ' + r.Wq.toFixed(1) + '초 — 임계 초과')
        });
      }
    });
    links.forEach(function (r) {
      if (r.isCommBottleneck) {
        bottlenecks.push({
          kind: 'link', severity: 2, id: r.from + '→' + r.to,
          name: KJ.nodeById(r.from).name + ' → ' + KJ.nodeById(r.to).name,
          detail: r.type + ' 지연 ' + r.delaySec + '초 × ' + r.perMin.toFixed(2) + '건/분'
        });
      }
    });
    // 누수 사유 중 구조적 원인(공백)을 병목으로 승격
    var gapMap = { no_sensor: '탐지 공백', no_shooter: '교전수단 부재(제약)', responsibility_gap: '책임공백(협조경로 부재)' };
    Object.keys(this.global.leakReasons).forEach(function (reason) {
      if (gapMap[reason]) {
        bottlenecks.push({
          kind: 'gap', severity: 3, id: reason,
          name: gapMap[reason], detail: '누수 ' + self.global.leakReasons[reason] + '건 (구조적 원인)'
        });
      }
    });
    bottlenecks.sort(function (a, b) { return b.severity - a.severity; });

    var ttk = this.global.timeToKill;
    var meanTTK = ttk.length ? ttk.reduce(function (s, x) { return s + x; }, 0) / ttk.length : 0;

    var result = {
      config: {
        scenario: this.scenario.id, mode: this.mode,
        intensity: this.intensity, seed: this.seed, endTimeSec: this.endTime
      },
      eventCount: this.eventCount,
      nodes: nodes, links: links, bottlenecks: bottlenecks,
      global: {
        spawned: this.global.spawned, detected: this.global.detected,
        engaged: this.global.engaged, killed: this.global.killed, leaked: this.global.leaked,
        reachedC2: this.global.reachedC2, everEngaged: this.global.everEngaged,
        leakReasons: this.global.leakReasons,
        killRate: this.global.spawned ? this.global.killed / this.global.spawned : 0,
        leakRate: this.global.spawned ? this.global.leaked / this.global.spawned : 0,
        meanTimeToKillSec: meanTTK
      },
      // 단계별 흐름 카운트 (Sankey/funnel용) — trace 없이도 항상 제공(집계 카운터라 저비용)
      flow: {
        spawned: this.global.spawned, detected: this.global.detected,
        reachedC2: this.global.reachedC2, everEngaged: this.global.everEngaged,
        killed: this.global.killed, leaked: this.global.leaked,
        leakReasons: this.global.leakReasons
      },
      logSample: this.log.slice(0, 40)
    };
    if (this.trace) {
      result.threatTraces = this.threatTraces;
      result.nodeSeries = this.nodeSeries;
      result.traceTruncated = this.traceTruncated;
      result.nodeSeriesTruncated = this.nodeSeriesTruncated;
    }
    return result;
  };

  /** srcId → targetId coord 링크 최단경로(BFS, 방향성 존중). 도달 불가면 null */
  function coordPath(srcId, targetId, mode) {
    if (srcId === targetId) return null;
    var queue = [srcId], cameBy = {};
    cameBy[srcId] = null;
    while (queue.length) {
      var cur = queue.shift();
      var outs = KJ.LINKS.filter(function (l) {
        return l.from === cur && l.kind === 'coord' && l.comm[mode];
      });
      for (var i = 0; i < outs.length; i++) {
        var l = outs[i];
        if (l.to in cameBy) continue;
        cameBy[l.to] = l;
        if (l.to === targetId) {
          var path = [], at = targetId;
          while (cameBy[at]) { path.unshift(cameBy[at]); at = cameBy[at].from; }
          return path;
        }
        queue.push(l.to);
      }
    }
    return null;
  }

  KJ.Simulation = Simulation;

  /** 편의 실행기: 단일 복제(replication) 실행. Phase 3 Monte Carlo가 이를 다수 집계한다. */
  KJ.runDES = function (cfg) { return new Simulation(cfg).run(); };
})();
