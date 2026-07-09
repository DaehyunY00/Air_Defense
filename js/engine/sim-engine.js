/**
 * K-JAMDS 시뮬레이터 — 이산사건 시뮬레이션(DES) 엔진 (Phase 2 핵심, Phase 7 고도화)
 *
 * Phase 1의 정상상태 M/M/c 해석 근사(analysis/bottleneck.js)를 실제 이벤트 구동 시뮬레이션으로
 * 대체·보강한다. 개별 위협 객체를 생성해 9단계 C2 파이프라인에 흘려보내고, 각 노드를
 * 유한용량 서버풀로 처리하며, 관측 통계(이용률·대기열·대기시간·드롭·격추/누수)를 수집한다.
 *
 * ── 9단계 C2 파이프라인 (계획서 Key Findings 1: 협조/권한위임·재교전 피드백 보완형) ──
 *   1 탐지(Detect)         : 센서 스캔, 저탐지 위협은 항적소실→재획득 반복
 *   2 추적생성(Track)      : 보고 링크 지연 후 C2 도착 (두절 시 재시도)
 *   3 식별(Identify)       ┐ C2 서버 처리 — 오경보(클러터) 트랙도 동일 용량 소모
 *   4 위협평가(TE)         ├ (Phase 7: 서비스시간 로그정규 — 인간 결심시간의 우편향 반영)
 *   5 무기-표적할당(WTA)   ┘ To-Be는 JAMDC2 배치 WTA(헝가리안) — Kill-Web 최적 할당
 *   6 결심(Decision)       : 교전승인권자 — As-Is는 상위 제대 승인 필요
 *   7 교전협조/권한위임    : 육↔공 coord 홉. 링크 두절 시 권한위임(fallback) 분권 전환
 *   8 교전/요격명령(Engage): 명령 링크 지연 후 무기 교전채널 처리, 재고(inventory) 소모
 *   9 BDA                  : 요격확률 판정 → 실패 시 재교전 피드백(폐루프, 상한 내)
 *
 * ── Phase 7 모델 고도화 (선행연구 조사 반영, 근거: docs/params.md Phase 7 절) ──
 *   · 결심시간 분포: C2 노드 서비스시간을 지수→로그정규(CV=0.5 개념값)로 교체.
 *     인간 결심·과제시간의 표준 우편향 모델(C2-SVC-DIST-01). cfg.serviceDist='exp'로
 *     해석해(M/M/c Erlang-C) 교차검증 모드 지원(tests/analytic.test.js).
 *   · 비선점 우선순위 큐: 위협 우선순위(1 탄도탄 … 4 소형무인기, 5 클러터) 순 처리.
 *     포화 시 저우선 표적 대기 폭증을 관측(THR-PRI-01). cfg.discipline='fifo' 지원.
 *   · 오경보(클러터) 처리 부하: 시나리오 falseTracks 스트림이 식별·위협평가 서버 용량을
 *     소모(2022.12.26 "새떼 오인" 재현). 격추/누수 통계 불산입(ENV-FT-RATE-01).
 *   · 재고 임계치 관리(원칙 5): 무기 재고 상태변수 + 20% 예비율 정책 — 예비율 이하이면
 *     저우선 위협 교전 보류(inventory_denied), 0이면 교전 불가(WPN-INV-01/RSV-01).
 *   · Degraded Mode(원칙 6): 시나리오 outages 창 동안 링크 불가용. 협조경로 상실 시
 *     권한위임 지연(45초 개념값) 후 분권 자체승인으로 전환, 전환 횟수·지연 집계(C2-OUTAGE-01).
 *   · 파상 도착: mix 항목 wave(ON/OFF 구간별 도착률)를 thinning으로 표본화 — 연발 사격의
 *     배치성 부하 재현(ENV-WAVE-01).
 *   · To-Be 배치 WTA: JAMDC2가 결심주기(4초)마다 대기 표적을 모아 [표적×무기채널] 비용
 *     행렬(1-Pk 기대값·부하·명령지연)을 헝가리안 O(n³)으로 최적 할당(WTA-HUNG-01).
 *     As-Is는 기존 탐욕(최소부하) 유지 — 분절 체계의 국지 결정을 표현.
 *
 * ── 설계 원칙(요구 반영): 병목은 고정이 아니라 시나리오에서 도출 ──
 *   병목 노드/링크/공백은 어디에도 하드코딩되지 않는다. [시나리오 도착률 × 모드별 토폴로지 ×
 *   서버풀 용량]으로 이벤트가 전개된 결과의 관측 통계(ρ≥임계, 드롭>0, 누수 등)에서 도출된다.
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
  var SHOOTER_QUEUE_MULT = 2; // 무기 대기실 = 교전채널 × 배수 (유한용량, K=c*mult)

  // 병목 판정 임계값 (Phase 1과 동일 기준: 계획서 ENV-RHO-THRESH-01)
  var RHO_WARN = 0.7, RHO_BOTTLENECK = 0.9;

  // ── Phase 7 상수 (근거: docs/params.md Phase 7 절 — 모두 정책연구용 개념값) ──
  var C2_LOGN_CV = 0.5;          // C2 결심시간 로그정규 변동계수 (C2-SVC-DIST-01, C급 개념값)
  var FT_PRIORITY = 5;           // 오경보(클러터) 트랙의 큐 우선순위 (실위협보다 후순위)
  var FT_ESCALATE = { asis: 0.3, tobe: 0.1 }; // 오경보 상위보고(정밀조사) 확률 (ENV-FT-ESC-01)
  var INV_RESERVE_FRAC = 0.2;    // 재고 예비율 — 이하이면 저우선 교전 보류 (WPN-INV-RSV-01)
  var INV_RESERVE_MAXPRI = 2;    // 예비율 이하에서 교전 허용되는 최대 우선순위(1·2 = 시간임계)
  var FALLBACK_DELEG_SEC = 45;   // 협조경로 두절 시 권한위임 전환 지연 (C2-FALLBACK-DLY-01)
  var WTA_EPOCH_SEC = 4;         // To-Be 배치 WTA 결심주기 (WTA-EPOCH-01)

  /**
   * @param {object} cfg { scenario, mode, intensity, seed, endTimeSec,
   *                       serviceDist?('lognormal'|'exp'), discipline?('priority'|'fifo'),
   *                       wtaBatch?(bool), mult?, trace? }
   */
  function Simulation(cfg) {
    this.scenario = cfg.scenario;
    this.mode = cfg.mode;
    this.intensity = cfg.intensity === undefined ? 1 : cfg.intensity; // 강도 0 허용
    this.seed = cfg.seed === undefined ? 1 : (cfg.seed >>> 0); // seed 0 보존
    this.endTime = cfg.endTimeSec || 1800;
    // Phase 7 모델 옵션 (기본: 고도화 사양. 'exp'/'fifo'는 해석해 교차검증용)
    this.serviceDist = cfg.serviceDist || 'lognormal';
    this.discipline = cfg.discipline || 'priority';
    this.wtaBatch = cfg.wtaBatch !== false;
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
    this.ftSeq = 0;
    this.nodeState = {};
    this.linkStat = {};   // "from>to" -> {count, delaySec, type, kind}
    this.outages = this.scenario.outages || [];
    this.global = {
      spawned: 0, detected: 0, engaged: 0, killed: 0, leaked: 0,
      reachedC2: 0, everEngaged: 0,
      leakReasons: {}, timeToKill: [],
      falseTracks: { spawned: 0, dismissed: 0, escalated: 0 },
      fallback: { count: 0, delaySec: 0 }
    };
    this.wtaBuffer = [];
    this._wtaScheduled = false;
    this.eventCount = 0;
    this.log = [];        // 표본 이벤트 로그(앞부분만 보존)

    // ── Phase 4 재생용 trace (옵트인, 기본 false — 기존 동작·통계에 영향 없음) ──
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
      var c, mean, K, inv = null;
      if (n.category === 'c2') {
        c = n.queue.servers;
        mean = n.queue.serviceTimeSec[mode];
        K = isFinite(n.queue.capacity) ? n.queue.capacity : c + 50;
      } else { // shooter
        c = n.engage.channels;
        mean = n.engage.engageTimeSec;
        K = c * SHOOTER_QUEUE_MULT;
        if (n.engage.inventory != null) inv = n.engage.inventory; // 재고 상태변수 (원칙 5)
      }
      self.nodeState[n.id] = {
        node: n, c: c, mean: mean * self.mult.service, K: K,
        // 서비스시간 분포: C2 결심은 로그정규(우편향), 교전채널 점유는 지수 유지
        dist: (n.category === 'c2' && self.serviceDist === 'lognormal') ? 'lognormal' : 'exp',
        inv: inv, invStart: inv, invDenied: 0,
        busy: 0, queue: [], lastT: 0,
        busyTime: 0, qTime: 0,
        arrivals: 0, completions: 0, drops: 0,
        waitAccum: 0, waitCount: 0, maxInSystem: 0,
        waitByPri: {} // 우선순위 클래스별 대기 통계 {pri: {n, sum}}
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

  /**
   * 위협 trace에 단계 이벤트 기록 (trace 대상이 아니면 무연산).
   * trace가 이미 종결(exitT 설정 = 격추/누수 확정)된 뒤의 기록은 차단한다 —
   * 공역이탈한 위협의 잔여 서버 완료 콜백이 exitT 이후 단계를 추가해
   * Gantt 구간 합이 100%를 초과하던 결함의 근본 수정 (Phase 5 리뷰 발견).
   * 격추 마크는 exitT 설정 직전에 호출되므로 정상 기록된다.
   */
  Simulation.prototype._mark = function (threat, name, t) {
    if (threat._trace && threat._trace.exitT === null) {
      threat._trace.stages.push({ name: name, t: t });
    }
  };

  // ── 스케줄러 ──
  Simulation.prototype.schedule = function (t, pri, type, data) {
    this.heap.push({ t: t, pri: pri, seq: this.seq++, type: type, data: data });
  };

  /** 링크 두절(outage) 창 확인 — 시나리오 outages에 해당 시각이 포함되면 불가용 */
  Simulation.prototype._linkUp = function (l, t) {
    for (var i = 0; i < this.outages.length; i++) {
      var o = this.outages[i];
      if (o.from === l.from && o.to === l.to && (!o.kind || o.kind === l.kind) &&
          t >= o.fromSec && t < o.toSec) return false;
    }
    return true;
  };

  Simulation.prototype._link = function (fromId, toId, kind, t) {
    var self = this;
    var l = KJ.LINKS.find(function (x) {
      return x.from === fromId && x.to === toId &&
        (kind ? x.kind === kind : true) && x.comm[self.mode] &&
        (t === undefined || self._linkUp(x, t));
    });
    return l ? l.comm[this.mode] : null;
  };

  Simulation.prototype._recordLink = function (fromId, toId, comm, kind) {
    var key = fromId + '>' + toId;
    var s = this.linkStat[key];
    if (!s) s = this.linkStat[key] = { from: fromId, to: toId, count: 0, delaySec: comm.delaySec, type: comm.type, kind: kind };
    s.count++;
  };

  // ── 노드 서버풀 (유한용량 c서버, 비선점 우선순위 규율) ──
  Simulation.prototype._advance = function (ns, t) {
    var dt = t - ns.lastT;
    if (dt > 0) {
      ns.busyTime += ns.busy * dt;
      ns.qTime += ns.queue.length * dt;
      ns.lastT = t;
    }
  };

  /** 작업의 큐 우선순위 클래스 (1 탄도탄 … 4 소형무인기, 5 클러터) */
  Simulation.prototype._priOf = function (threat) {
    if (threat.isFalse) return FT_PRIORITY;
    var tt = KJ.threatType(threat.type);
    return (tt && tt.priority) || 3;
  };

  Simulation.prototype._recordWait = function (ns, pri, wait) {
    ns.waitAccum += wait; ns.waitCount++;
    var w = ns.waitByPri[pri];
    if (!w) w = ns.waitByPri[pri] = { n: 0, sum: 0 };
    w.n++; w.sum += wait;
  };

  /**
   * 작업을 노드에 투입. 서버 여유→즉시 서비스, 대기실 여유→큐 삽입, 초과(K)→드롭(누수).
   * 큐 삽입은 비선점 우선순위 규율(우선순위 오름차순, 동순위 FCFS) — discipline='fifo'면 후미.
   */
  Simulation.prototype._nodeArrive = function (nsId, t, job, onDone) {
    var ns = this.nodeState[nsId];
    if (!ns) return;
    this._advance(ns, t);
    ns.arrivals++;
    var pri = this._priOf(job.threat);
    var inSystem = ns.busy + ns.queue.length;
    if (ns.busy < ns.c) {
      ns.busy++;
      this._recordWait(ns, pri, 0);
      this._startService(ns, t, job, onDone);
    } else if (inSystem < ns.K) {
      var entry = { job: job, onDone: onDone, enqT: t, pri: pri };
      if (this.discipline === 'priority') {
        // 우선순위 오름차순 삽입 (동순위는 도착순 유지 — 안정 삽입)
        var idx = ns.queue.length;
        while (idx > 0 && ns.queue[idx - 1].pri > pri) idx--;
        ns.queue.splice(idx, 0, entry);
      } else {
        ns.queue.push(entry);
      }
    } else {
      ns.drops++;                 // 유한용량 포화 → 항적/교전기회 상실
      job.threat.pipelineDead = true;
      if (!job.threat.isFalse && !job.threat.leakReason) job.threat.leakReason = 'overflow:' + nsId;
    }
    ns.maxInSystem = Math.max(ns.maxInSystem, ns.busy + ns.queue.length);
    this._sample(nsId, t);
  };

  Simulation.prototype._startService = function (ns, t, job, onDone) {
    // C2 결심시간은 로그정규(우편향, CV=C2_LOGN_CV), 교전채널은 지수 (C2-SVC-DIST-01)
    var svc = ns.dist === 'lognormal'
      ? this.rng.lognormal(ns.mean, C2_LOGN_CV * ns.mean)
      : this.rng.exponential(ns.mean);
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
      this._recordWait(ns, nx.pri, t - nx.enqT);
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

  /** 2 추적생성: 최속 '가용' 보고경로로 담당 C2에 항적 전달 (두절 시 다음 스캔에 재시도) */
  Simulation.prototype._onDetected = function (threat, t) {
    var self = this, best = null, structural = false;
    threat._sensors.forEach(function (s) {
      KJ.LINKS.forEach(function (l) {
        if (l.from === s.id && l.kind === 'report' && l.comm[self.mode]) {
          structural = true;
          if (!self._linkUp(l, t)) return; // 두절 창 — 이 경로는 지금 불가용
          var d = l.comm[self.mode].delaySec;
          if (!best || d < best.delay) best = { c2: l.to, delay: d, comm: l.comm[self.mode], from: s.id };
        }
      });
    });
    if (!best) {
      if (!structural) { threat.leakReason = 'no_report_path'; return; } // 구조적 공백
      // 전 경로 두절 — 항적 보고 실패, 다음 스캔 주기에 재시도 (Degraded Mode)
      threat.detected = false;
      this.schedule(t + SCAN_SEC, PRI.DETECT, 'DETECT', { threat: threat });
      return;
    }
    this._recordLink(best.from, best.c2, best.comm, 'report');
    this.schedule(t + best.delay * this.mult.delay, PRI.LINK_ARRIVE, 'C2_ARRIVE', { threat: threat, c2: best.c2 });
  };

  /** 3·4·5 식별·위협평가·WTA: C2(또는 To-Be JAMDC2) 서버 처리 */
  Simulation.prototype._onC2Arrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    if (threat.isFalse) { // 오경보 트랙: 식별·위협평가 용량만 소모 후 기각/상위보고
      this._nodeArrive(d.c2, t, { threat: threat }, function (tt2, job) {
        self._afterFalseTrack(tt2, job.threat, d.c2);
      });
      return;
    }
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
      var comm = this._link(c2Id, 'JAMDC2', 'report', t) || this._link(c2Id, 'JAMDC2', null, t);
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

  /** 오경보 트랙 후처리: 확률적 상위보고(정밀조사 부하) 또는 기각 (ENV-FT-ESC-01) */
  Simulation.prototype._afterFalseTrack = function (t, ft, c2Id) {
    if (ft.pipelineDead) return;
    var self = this;
    var pEsc = FT_ESCALATE[this.mode] || 0;
    if (!ft._escalated && this.rng.raw() < pEsc) {
      ft._escalated = true;
      this.global.falseTracks.escalated++;
      // 상위 노드(As-Is: KAOC / To-Be: JAMDC2)에서 정밀조사 서비스 1회 추가 소모
      var upper = this.mode === 'tobe' ? 'JAMDC2' : 'KAOC';
      if (this.nodeState[upper] && upper !== c2Id) {
        var comm = this._link(c2Id, upper, 'coord', t) || this._link(c2Id, upper, null, t);
        var delay = comm ? comm.delaySec : 0;
        if (comm) this._recordLink(c2Id, upper, comm, 'coord');
        this.schedule(t + delay * this.mult.delay, PRI.LINK_ARRIVE, 'FT_ESCALATE', { threat: ft, c2: upper });
        return;
      }
    }
    this.global.falseTracks.dismissed++; // 기각 — 시스템에서 제거
  };

  Simulation.prototype._onFtEscalate = function (t, d) {
    var self = this, ft = d.threat;
    if (ft.pipelineDead) return;
    this._nodeArrive(d.c2, t, { threat: ft }, function () {
      self.global.falseTracks.dismissed++; // 정밀조사 후 기각
    });
  };

  /** 6·7 결심·교전협조/권한위임: As-Is는 승인권자까지 coord 최단경로 홉.
   *  협조경로가 두절(outage)로 상실되면 권한위임 지연 후 분권 자체승인(fallback, 원칙 6). */
  Simulation.prototype._decision = function (threat, t, controlC2) {
    var tt = KJ.threatType(threat.type);
    var approvalId = tt.approvalLevel ? tt.approvalLevel[this.mode] : null;
    if (!approvalId || approvalId === controlC2 || !this.nodeState[approvalId]) {
      this._doEngage(threat, t);       // 승인 불필요(자동교전) 또는 동일 노드 승인
      return;
    }
    var path = coordPath(controlC2, approvalId, this.mode, this, t);
    if (!path) {
      // 구조적 경로 자체가 없으면 책임공백, 있는데 두절이면 권한위임(fallback) 전환
      var structural = coordPath(controlC2, approvalId, this.mode, null, 0);
      if (!structural) { threat.leakReason = 'responsibility_gap'; return; }
      this.global.fallback.count++;
      this.global.fallback.delaySec += FALLBACK_DELEG_SEC;
      this._mark(threat, '권한위임(분권전환):' + controlC2, t);
      this.schedule(t + FALLBACK_DELEG_SEC, PRI.LINK_ARRIVE, 'FALLBACK_ENGAGE', { threat: threat });
      return;
    }
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

  // ── 8 교전명령: WTA ──

  /** 요격확률 삼각분포 파라미터 (min, mode, max) — 표본(_pk)·기대값(_pkMean) 공용 */
  Simulation.prototype._pkParams = function (shooter, threat) {
    if (threat.type === 'uav_small') return { min: 0.1, mode: 0.3, max: 0.5 };
    if (threat.type === 'srbm' || threat.type === 'mrl_large') return { min: 0.6, mode: 0.75, max: 0.9 };
    return { min: 0.6, mode: 0.8, max: 0.9 };
  };

  /** 요격확률 표본(개념값). 소형 무인기는 저효율(2022.12.26 격추실패 반영). */
  Simulation.prototype._pk = function (shooter, threat) {
    var p = this._pkParams(shooter, threat);
    var pk = this.rng.triangular(p.min, p.mode, p.max);
    return Math.max(0, Math.min(1, pk * this.mult.pk)); // 민감도 배수 적용, [0,1] 클램프
  };

  /** 요격확률 기대값 (삼각분포 평균) — 배치 WTA 비용행렬용 (표본 아님, 결정론) */
  Simulation.prototype._pkMean = function (shooter, threat) {
    var p = this._pkParams(shooter, threat);
    var mean = (p.min + p.mode + p.max) / 3;
    return Math.max(0, Math.min(1, mean * this.mult.pk));
  };

  /**
   * 위협에 대한 교전 가능 무기 후보.
   * @returns { structural: 제약(canEngage·통제) 충족 후보, eligible: 재고 정책까지 충족 }
   * 재고 정책(원칙 5): 재고 0 → 제외, 재고 ≤ 예비율 → 시간임계(pri≤2) 위협만 허용.
   */
  Simulation.prototype._shooterCandidates = function (threat) {
    var self = this, mode = this.mode, type = threat.type;
    var structural = KJ.nodesInMode(mode).filter(function (n) {
      return n.category === 'shooter' && n.canEngage[type] &&
        n.controlledBy && (n.controlledBy[mode] || []).length > 0;
    });
    var pri = this._priOf(threat);
    var eligible = structural.filter(function (sh) {
      var ns = self.nodeState[sh.id];
      if (!ns || ns.inv === null) return true; // 재고 미정의 무기(무제한 개념)
      if (ns.inv <= 0) return false;
      if (ns.inv <= Math.ceil(ns.invStart * INV_RESERVE_FRAC) && pri > INV_RESERVE_MAXPRI) return false;
      return true;
    });
    return { structural: structural, eligible: eligible };
  };

  /** 선택된 무기로 교전명령 발령: 재고 커밋 → 명령 링크 지연 → 교전채널 투입 */
  Simulation.prototype._dispatchEngage = function (threat, t, shooter) {
    var ns = this.nodeState[shooter.id];
    if (ns && ns.inv !== null) ns.inv--; // 할당 즉시 요격자산 1발 커밋 (재교전은 추가 소모)
    var controlC2 = shooter.controlledBy[this.mode][0];
    var comm = this._link(controlC2, shooter.id, 'command', t);
    var delay = comm ? comm.delaySec : 0;
    if (comm) this._recordLink(controlC2, shooter.id, comm, 'command');
    this.global.engaged++;
    if (!threat._countedEngaged) { threat._countedEngaged = true; this.global.everEngaged++; }
    this._mark(threat, '교전명령#' + (threat.tries + 1) + ':' + shooter.id, t);
    this.schedule(t + delay * this.mult.delay, PRI.LINK_ARRIVE, 'SHOOTER_ARRIVE', { threat: threat, shooter: shooter.id });
  };

  /**
   * 교전 개시. As-Is: 탐욕(최소부하) 즉시 선택 — 분절 체계의 국지 결정.
   * To-Be: JAMDC2 배치 WTA 버퍼에 적재, 결심주기(WTA_EPOCH_SEC)마다 헝가리안 최적 할당.
   */
  Simulation.prototype._doEngage = function (threat, t) {
    if (!threat.alive || threat.pipelineDead) return;
    var cand = this._shooterCandidates(threat);
    if (cand.structural.length === 0) { threat.leakReason = 'no_shooter'; return; } // 교전 불가(제약)
    if (cand.eligible.length === 0) {  // 재고 소진/예비율 보류 (원칙 5 임계치 관리)
      threat.leakReason = 'inventory_denied';
      for (var i = 0; i < cand.structural.length; i++) { // 첫 구조적 후보에 보류 집계
        var s = this.nodeState[cand.structural[i].id];
        if (s) { s.invDenied++; break; }
      }
      return;
    }
    if (this.mode === 'tobe' && this.wtaBatch && KJ.hungarian && this.nodeState['JAMDC2']) {
      this.wtaBuffer.push(threat);
      if (!this._wtaScheduled) {
        this._wtaScheduled = true;
        this.schedule(t + WTA_EPOCH_SEC, PRI.LINK_ARRIVE, 'WTA_EPOCH', {});
      }
      return;
    }
    // As-Is 탐욕: 현재 부하(처리+대기) 최소 무기 선택
    var self = this, best = null;
    cand.eligible.forEach(function (sh) {
      var ns = self.nodeState[sh.id];
      var load = ns ? (ns.busy + ns.queue.length) : 0;
      if (!best || load < best.load) best = { sh: sh, load: load };
    });
    this._dispatchEngage(threat, t, best.sh);
  };

  /**
   * To-Be 배치 WTA 결심주기: 버퍼의 표적들을 [표적 × 무기채널 슬롯] 비용행렬로 구성해
   * 헝가리안 최적 할당. 비용 = (1-Pk기대값) + 0.2×부하율 + 명령지연/600 (WTA-HUNG-01).
   * 미할당 표적은 다음 주기로 이월(체공창 내), 만료 표적은 EXIT가 누수 처리.
   */
  Simulation.prototype._onWtaEpoch = function (t) {
    var self = this;
    this._wtaScheduled = false;
    var items = this.wtaBuffer.filter(function (th) {
      return th.alive && !th.pipelineDead && !th.leakReason;
    });
    this.wtaBuffer = [];
    if (items.length === 0) return;

    // 열(무기 슬롯) 구성: 각 무기별 여유용량(K - 재계)만큼 슬롯 개방 (상한: 표적 수)
    var shooters = {};
    items.forEach(function (th) {
      self._shooterCandidates(th).eligible.forEach(function (sh) { shooters[sh.id] = sh; });
    });
    var cols = [];
    Object.keys(shooters).sort().forEach(function (id) { // 정렬 — 결정론 보장
      var ns = self.nodeState[id];
      var free = ns ? Math.max(0, ns.K - (ns.busy + ns.queue.length)) : 0;
      var slots = Math.min(free, items.length);
      if (ns && ns.inv !== null) slots = Math.min(slots, Math.max(0, ns.inv));
      for (var k = 0; k < slots; k++) cols.push(shooters[id]);
    });

    var carry = [];
    if (cols.length > 0) {
      var INF = KJ.hungarian.INF;
      var cost = items.map(function (th) {
        var elig = {};
        self._shooterCandidates(th).eligible.forEach(function (sh) { elig[sh.id] = true; });
        return cols.map(function (sh) {
          if (!elig[sh.id]) return INF;
          var ns = self.nodeState[sh.id];
          var util = ns ? (ns.busy + ns.queue.length) / ns.K : 0;
          var controlC2 = sh.controlledBy[self.mode][0];
          var comm = self._link(controlC2, sh.id, 'command', t);
          var delayCost = (comm ? comm.delaySec : 0) / 600;
          return (1 - self._pkMean(sh, th)) + 0.2 * util + delayCost;
        });
      });
      var assign = KJ.hungarian(cost);
      items.forEach(function (th, i) {
        if (assign[i] >= 0) self._dispatchEngage(th, t, cols[assign[i]]);
        else carry.push(th);
      });
    } else {
      carry = items;
    }
    // 미할당 표적 이월 — 체공창 소진 표적은 EXIT가 정리
    carry.forEach(function (th) {
      if (t < th.spawnT + th.dwellSec) self.wtaBuffer.push(th);
    });
    if (this.wtaBuffer.length > 0 && !this._wtaScheduled) {
      this._wtaScheduled = true;
      this.schedule(t + WTA_EPOCH_SEC, PRI.LINK_ARRIVE, 'WTA_EPOCH', {});
    }
  };

  Simulation.prototype._onShooterArrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    this._nodeArrive(d.shooter, t, { threat: threat }, function (tt2, job) {
      self._onEngageEnd(tt2, job.threat, d.shooter);
    });
  };

  /** 9 BDA: 요격확률 판정 → 실패 시 재교전 피드백(폐루프, shoot-look-shoot) */
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
      this._doEngage(threat, t);          // 재교전 (잔여 체공창 내 다단계 DWTA)
    } else if (!threat.leakReason) {
      threat.leakReason = 'missed';       // 요격 실패(기회 소진)
      this._mark(threat, '교전실패#' + threat.tries + '(기회소진)', t);
    }
  };

  // ── 발생·이탈 ──

  /**
   * 다음 도착 예약. 파상(wave) 항목은 thinning(간축법)으로 비정상 포아송을 표본화:
   * 최대율 M으로 후보를 뽑고 현재 구간 도착률 r(t)/M 확률로 채택 (ENV-WAVE-01, 결정론).
   */
  Simulation.prototype._scheduleNextArrival = function (entry, t) {
    var base = ((entry.ratePerMin || 0) * this.intensity) / 60;
    if (base <= 0) return;
    var next;
    if (entry.wave && entry.wave.onSec > 0) {
      var w = entry.wave, period = w.onSec + (w.offSec || 0);
      var mult = Math.max(1, w.mult || 1);
      var maxRate = base * mult;
      var tt = t;
      for (;;) {
        tt += this.rng.exponential(1 / maxRate);
        if (tt > this.endTime) return; // 창 밖 — 예약 불필요
        var phase = period > 0 ? tt % period : 0;
        var rate = phase < w.onSec ? base * mult : base;
        if (this.rng.raw() <= rate / maxRate) { next = tt; break; }
      }
    } else {
      next = t + this.rng.exponential(1 / base);
    }
    if (next <= this.endTime) this.schedule(next, PRI.SPAWN, 'SPAWN', { entry: entry });
  };

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
    // 다음 도착 (포아송/파상) — burst 전용 항목(ratePerMin 부재)은 후속 도착 없음
    this._scheduleNextArrival(entry, t);
  };

  /** 오경보(클러터) 트랙 발생: 커버 축선의 임의 센서 → 보고경로 → C2 식별 부하 */
  Simulation.prototype._spawnFalseTrack = function (t) {
    var self = this;
    var ft = this.scenario.falseTracks;
    if (!ft) return;
    // 임의 센서 선택 (보고 링크 보유 센서 중, 결정론적 순서에서 rng로 선택)
    var sensors = KJ.nodesInMode(this.mode).filter(function (n) {
      if (n.category !== 'sensor') return false;
      return KJ.LINKS.some(function (l) { return l.from === n.id && l.kind === 'report' && l.comm[self.mode]; });
    });
    if (sensors.length > 0) {
      var s = sensors[Math.floor(this.rng.raw() * sensors.length) % sensors.length];
      var best = null;
      KJ.LINKS.forEach(function (l) {
        if (l.from === s.id && l.kind === 'report' && l.comm[self.mode] && self._linkUp(l, t)) {
          var d = l.comm[self.mode].delaySec;
          if (!best || d < best.delay) best = { c2: l.to, delay: d, comm: l.comm[self.mode], from: s.id };
        }
      });
      if (best) {
        this.ftSeq++;
        this.global.falseTracks.spawned++;
        var track = {
          id: 'FT#' + this.ftSeq, isFalse: true, type: 'clutter', axis: null,
          alive: true, killed: false, detected: true, pipelineDead: false,
          tries: 0, leakReason: null, _trace: null, _escalated: false
        };
        this._recordLink(best.from, best.c2, best.comm, 'report');
        this.schedule(t + best.delay * this.mult.delay, PRI.LINK_ARRIVE, 'C2_ARRIVE', { threat: track, c2: best.c2 });
      }
    }
    // 다음 오경보 도착 (포아송, 강도 배수 적용)
    var rate = (ft.ratePerMin * this.intensity) / 60;
    if (rate > 0) {
      var next = t + this.rng.exponential(1 / rate);
      if (next <= this.endTime) this.schedule(next, PRI.SPAWN, 'FT_SPAWN', {});
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
      // 일회성 동시 다발(burst) — 문제 상황 2 "무인기 8대 동시 남파" 유형.
      // 강도 배수로 반올림 스케일(강도 0 → 0대), 동시 이벤트는 (t, pri, seq)로 결정론 해소.
      if (entry.burst) {
        var n = Math.round(entry.burst * self.intensity);
        var at = entry.atSec || 0;
        for (var i = 0; i < n; i++) {
          if (at <= self.endTime) self.schedule(at, PRI.SPAWN, 'SPAWN', { entry: entry });
        }
      }
      self._scheduleNextArrival(entry, 0);
    });
    // 오경보(클러터) 스트림 최초 도착 예약
    if (this.scenario.falseTracks && (this.scenario.falseTracks.ratePerMin || 0) * this.intensity > 0) {
      var ftRate = (this.scenario.falseTracks.ratePerMin * this.intensity) / 60;
      var firstFt = this.rng.exponential(1 / ftRate);
      if (firstFt <= this.endTime) this.schedule(firstFt, PRI.SPAWN, 'FT_SPAWN', {});
    }

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
      case 'FT_SPAWN': this._spawnFalseTrack(ev.t); break;
      case 'DETECT': this._onDetect(ev.t, ev.data); break;
      case 'C2_ARRIVE': this._onC2Arrive(ev.t, ev.data); break;
      case 'FUSION_ARRIVE': this._onFusionArrive(ev.t, ev.data); break;
      case 'FT_ESCALATE': this._onFtEscalate(ev.t, ev.data); break;
      case 'APPROVE_ARRIVE': this._onApproveArrive(ev.t, ev.data); break;
      case 'FALLBACK_ENGAGE': if (ev.data.threat.alive && !ev.data.threat.pipelineDead) this._doEngage(ev.data.threat, ev.t); break;
      case 'WTA_EPOCH': this._onWtaEpoch(ev.t); break;
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
      var waitByPri = {};
      Object.keys(ns.waitByPri).forEach(function (p) {
        var w = ns.waitByPri[p];
        waitByPri[p] = { n: w.n, meanWaitSec: w.n ? w.sum / w.n : 0 };
      });
      return {
        id: id, name: ns.node.name, category: ns.node.category,
        c: ns.c, K: ns.K, meanSec: ns.mean, dist: ns.dist,
        arrivals: ns.arrivals, completions: ns.completions, drops: ns.drops,
        rho: rho, Lq: Lq, Wq: Wq, maxInSystem: ns.maxInSystem, level: level,
        waitByPri: waitByPri,
        invStart: ns.invStart, invLeft: ns.inv, invDenied: ns.invDenied
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
    var gapMap = {
      no_sensor: '탐지 공백', no_shooter: '교전수단 부재(제약)',
      responsibility_gap: '책임공백(협조경로 부재)', inventory_denied: '요격자산 재고 고갈(원칙 5 임계)'
    };
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

    // 우선순위 클래스별 대기 종합 (C2 노드 합산) — 포화 시 저우선 대기 폭증 관측용
    var priorityWait = {};
    nodes.forEach(function (n) {
      if (n.category !== 'c2') return;
      Object.keys(n.waitByPri).forEach(function (p) {
        var w = n.waitByPri[p];
        var acc = priorityWait[p] || (priorityWait[p] = { n: 0, sum: 0 });
        acc.n += w.n; acc.sum += w.meanWaitSec * w.n;
      });
    });
    Object.keys(priorityWait).forEach(function (p) {
      var a = priorityWait[p];
      priorityWait[p] = { n: a.n, meanWaitSec: a.n ? a.sum / a.n : 0 };
    });

    var result = {
      config: {
        scenario: this.scenario.id, mode: this.mode,
        intensity: this.intensity, seed: this.seed, endTimeSec: this.endTime,
        serviceDist: this.serviceDist, discipline: this.discipline, wtaBatch: this.wtaBatch
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
        meanTimeToKillSec: meanTTK,
        falseTracks: this.global.falseTracks,
        fallback: {
          count: this.global.fallback.count,
          meanDelaySec: this.global.fallback.count ? this.global.fallback.delaySec / this.global.fallback.count : 0
        }
      },
      priorityWait: priorityWait,
      inventory: nodes.filter(function (n) { return n.category === 'shooter' && n.invStart != null; })
        .map(function (n) {
          return { id: n.id, name: n.name, start: n.invStart, left: n.invLeft, used: n.invStart - n.invLeft, denied: n.invDenied };
        }),
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

  /**
   * srcId → targetId coord 링크 최단경로(BFS, 방향성 존중). 도달 불가면 null.
   * sim·t가 주어지면 두절(outage) 링크를 제외한 '가용' 경로만 탐색한다 (Degraded Mode).
   */
  function coordPath(srcId, targetId, mode, sim, t) {
    if (srcId === targetId) return null;
    var queue = [srcId], cameBy = {};
    cameBy[srcId] = null;
    while (queue.length) {
      var cur = queue.shift();
      var outs = KJ.LINKS.filter(function (l) {
        return l.from === cur && l.kind === 'coord' && l.comm[mode] &&
          (!sim || sim._linkUp(l, t));
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
