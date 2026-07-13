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

  // ── 정밀화 Phase B-2: 부하 기반 중앙↔분권 동적 전환 임계 (C2-DELEG-THRESH-01) ──
  // 승인권자 노드가 [전 결심서버 점유(busy≥c) AND 대기열 길이 ≥ c×배수]로 관측되면
  // 그 결심을 하위/자동으로 위임(분권 전환)한다. To-Be는 COP 공유·자동화 전제로 조기
  // 전환(대기 c×1), As-Is는 수동 절차 탓에 대기가 서버수의 4배로 누적되어야 전환(느림/준부재).
  // 하드코딩된 병목이 아니라 부하의 함수: 시나리오·강도가 낮으면 어느 모드에서도 전환이
  // 일어나지 않는다(회귀로 고정).
  var DELEG_QUEUE_MULT = { asis: 4, tobe: 1 };

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
    // Phase B-2: 동적 권한위임(분권 전환) 관측 상태 — 전환 시점·횟수·노드별 분포
    this.deleg = { count: 0, firstT: null, byNode: {} };
    // Phase B/D: 결심 지연(MoP) — 탐지→최초 교전명령 소요의 집계 (trace 무관 항상 수집)
    this.decisionDelaySum = 0;
    this.decisionDelayCount = 0;
    // Phase D: 비용교환비(MoFE) — 개념 요격탄 소모비용 / 격추 위협가치 (백만 USD 개념)
    // sat*는 저가 포화위협(장사정포·소형무인기) 부분집합. 전부 개념값(WPN/THR-*-COST-01).
    this.cost = { interceptM: 0, killedThreatM: 0, interceptSatM: 0, killedThreatSatM: 0 };
    this.eventCount = 0;
    this.log = [];        // 표본 이벤트 로그(앞부분만 보존)

    // ── Phase 4 재생용 trace (옵트인, 기본 false — 기존 동작·통계에 영향 없음) ──
    // 항적별 9단계 타임스탬프(Gantt)와 노드별 재고 시계열(대기열 애니메이션)을 기록한다.
    // Phase 4-B: 재획득 dup(항적소실→재획득 시 새 항적 재생성). 기본 off. 근거 없는 배수(1/detectFactor)
    // 이중계상 위험이라 기본 경로에서 켜지 않는다 — 켜려면 배수가 아닌 이벤트로 구현해야 함(범위 밖·미구현).
    this.dupReacquire = !!cfg.dupReacquire;
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

  /**
   * 스캔 1회당 탐지확률 — [센서 고유 Pd] × [위협 고유 탐지난이도] × [민감도 배수]를
   * per-sensor로 계산한 뒤 모드별 융합 규칙으로 결합한다 (SEN-FUSION-01).
   *   pᵢ = clamp(sensorPd_i × threat.detectFactor × mult.detect, 0, 1)
   *   As-Is (비융합) : p = maxᵢ(pᵢ)          — 자군 최선의 단일 센서 성능이 곧 체계 성능
   *   To-Be (융합)   : p = 1 − Πᵢ(1 − pᵢ)     — 다출처 센서 병렬 결합(Any Sensor)
   * 의미론: nodes[].detectProb.value = 센서 고유 스캔당 탐지확률(표준 표적 기준),
   *         threats[].detectFactor = 위협 고유 탐지난이도 계수(저RCS·저고도 등, 0~1).
   * 민감도 배수(mult.detect)는 결합 *전*(per-sensor)에 곱한다 — 결합 후 곱하면 스윕 의미가 달라짐.
   * value 누락 센서는 폴백 Pd=1.0 (데이터 누락이 조용한 0 탐지가 되지 않도록). 발동 시 STEP5 보고.
   * RNG는 소비하지 않는다(호출부가 단일 draw로 판정 — 스캔당 정확히 1회 유지).
   */
  Simulation.prototype._scanProb = function (threat) {
    var tt = KJ.threatType(threat.type);
    var md = this.mult.detect;
    var sensors = threat._sensors || [];
    var ps = sensors.map(function (s) {
      var pd = (s.detectProb && typeof s.detectProb.value === 'number')
        ? s.detectProb.value : 1.0;                       // value 누락 시 안전 폴백
      return Math.max(0, Math.min(1, pd * tt.detectFactor * md));
    });
    if (!ps.length) return 0;
    if (this.mode === 'tobe') {
      // 다출처 융합(Any Sensor): 센서 병렬 결합
      return 1 - ps.reduce(function (acc, p) { return acc * (1 - p); }, 1);
    }
    // 비융합(As-Is): 최선의 단일 센서만
    return Math.max.apply(null, ps);
  };

  Simulation.prototype._onDetect = function (t, d) {
    var threat = d.threat;
    if (!threat.alive || threat.detected || threat.pipelineDead) return;
    var p = this._scanProb(threat); // per-scan 탐지확률: 센서 Pd × 위협 난이도, 모드별 융합
    if (this.rng.raw() < p) {
      threat.detected = true;
      threat._detectT = t; // 결심 지연(MoP) 기준 시각
      this.global.detected++;
      this._mark(threat, '탐지', t);
      this._onDetected(threat, t);
    } else {
      // 항적 소실 → 재획득 시도 (공역 이탈 전까지 반복, EXIT가 상한)
      this.schedule(t + SCAN_SEC, PRI.DETECT, 'DETECT', { threat: threat });
    }
  };

  /**
   * 링크 1건 전달 지연(초) — comm.dist가 있으면 분포 샘플링, 없으면 대표값(delaySec).
   * mult.delay(민감도 배수)는 항상 곱한다. RNG는 dist가 있을 때만 소비(스캔당/홉당 1회).
   * ※ 경로 "선택"(argmin·coordPath BFS)은 항상 대표값 delaySec으로 하고, 여기서는
   *   실제 전달 "시각"만 샘플링한다 — 비결정론적 경로 선택을 피하기 위함(재현성).
   */
  Simulation.prototype._linkDelay = function (comm) {
    var base = comm.delaySec;
    if (comm.dist) {
      if (comm.dist.kind === 'triangular') base = this.rng.triangular(comm.dist.min, comm.dist.mode, comm.dist.max);
      else if (comm.dist.kind === 'lognormal') base = this.rng.lognormal(comm.dist.mean, comm.dist.stddev);
      else if (comm.dist.kind === 'normal') base = this.rng.normal(comm.dist.mean, comm.dist.stddev);
    }
    return Math.max(0, base) * this.mult.delay;
  };

  /**
   * 중복 항적(dup) 프록시(ghost) — C2 서버 부하만 소비하는 유령 작업. 실제 위협을 참조만 한다.
   * alive를 getter로 두어 실제 위협이 격추/누수되면 ghost도 alive=false → 큐에서 자동 reneging
   * (_onServiceEnd의 죽은 작업 스킵 재사용). ghost 드롭은 ns.drops에 계상되나 EXIT 이벤트가
   * 없어 global.leaked에는 절대 반영되지 않는다(보존 항등식 유지).
   */
  function makeGhost(real) {
    return {
      type: real.type, _dup: true, _real: real,
      pipelineDead: false, leakReason: null,
      get alive() { return real.alive; }
    };
  }

  /** 2 추적생성: 최속 보고경로로 담당 C2에 항적 전달 (To-Be는 직결 센서면 JAMDC2 직행) */
  Simulation.prototype._onDetected = function (threat, t) {
    var self = this;
    // To-Be 다출처 Plug-in 직결(Phase 3): 센서→JAMDC2 직결 링크를 가진 센서가 하나라도 있으면
    // 담당 C2를 건너뛰고 JAMDC2로 직행한다(FUSION_ARRIVE). argmin에 섞지 않는 명시적 우선 규칙 —
    // 직결/담당C2 모두 2s라 tiebreak가 자의적으로 갈리는 것을 피한다. 근거: KJADS "P→F 전환"
    // (다출처 plot 수신·융합 → 기존 체계 사각지대의 신규 항적 F 생성). 담당 C2 포화가 융합을
    // 막지 못하게 한다. detects/커버리지·탐지 확률(①)은 불변 — 여기는 "탐지 후 어디로"의 문제.
    if (this.mode === 'tobe' && this.nodeState['JAMDC2']) {
      var dbest = null;
      threat._sensors.forEach(function (s) {
        KJ.LINKS.forEach(function (l) {
          if (l.from === s.id && l.to === 'JAMDC2' && l.kind === 'report' && l.comm.tobe) {
            var dd = l.comm.tobe.delaySec;
            if (!dbest || dd < dbest.delay || (dd === dbest.delay && l.from < dbest.from)) {
              dbest = { delay: dd, comm: l.comm.tobe, from: l.from };
            }
          }
        });
      });
      if (dbest) {
        this._recordLink(dbest.from, 'JAMDC2', dbest.comm, 'report');
        this._mark(threat, '직결→JAMDC2', t);
        this.schedule(t + this._linkDelay(dbest.comm), PRI.LINK_ARRIVE, 'FUSION_ARRIVE', { threat: threat });
        return;
      }
    }
    // 담당 C2 후보 수집 (C2별 최속 report 링크, 동점 시 센서 id 사전순 — 데이터 순서 의존성 제거).
    var targets = {}; // c2Id -> { delay, comm, from }
    threat._sensors.forEach(function (s) {
      KJ.LINKS.forEach(function (l) {
        if (l.from === s.id && l.to !== 'JAMDC2' && l.kind === 'report' && l.comm[self.mode]) {
          var d = l.comm[self.mode].delaySec;
          var cur = targets[l.to];
          if (!cur || d < cur.delay || (d === cur.delay && l.from < cur.from)) {
            targets[l.to] = { delay: d, comm: l.comm[self.mode], from: l.from };
          }
        }
      });
    });
    var ids = Object.keys(targets);
    if (!ids.length) { threat.leakReason = 'no_report_path'; return; }
    ids.sort(function (a, b) { return targets[a].delay - targets[b].delay || (a < b ? -1 : 1); });
    // 주 항적: 최속 C2 — 하위 단계(⑥⑦⑧)를 구동한다.
    var main = targets[ids[0]];
    this._recordLink(main.from, ids[0], main.comm, 'report');
    this.schedule(t + this._linkDelay(main.comm), PRI.LINK_ARRIVE, 'C2_ARRIVE', { threat: threat, c2: ids[0] });
    // 중복 항적(Phase 4, As-Is 전용): 나머지 커버 C2 전부에 팬아웃. Track Fusion 부재로 같은 표적이
    // 각 군 C2에 별개 항적으로 생성되는 KJADS GAP 1을 모사한다. 이들은 C2 서버 부하만 소비하고
    // 하위 단계는 구동하지 않는다(프록시 ghost). To-Be는 팬아웃하지 않는다 — JAMDC2 Track Fusion이
    // dup을 흡수(직결 없는 위협도 주 항적 1건만). 재획득 dup(config.dupReacquire)은 기본 off·별개 과제.
    if (this.mode === 'asis') {
      for (var i = 1; i < ids.length; i++) {
        var dup = targets[ids[i]];
        this._recordLink(dup.from, ids[i], dup.comm, 'report');
        this._mark(threat, '중복항적→' + ids[i], t);
        this.schedule(t + this._linkDelay(dup.comm), PRI.LINK_ARRIVE, 'C2_ARRIVE_DUP',
          { threat: makeGhost(threat), c2: ids[i] });
      }
    }
  };

  /** 중복 항적 C2 도착(As-Is): C2 서버 부하만 소비, 하위 단계(⑥⑦⑧) 미구동 */
  Simulation.prototype._onC2ArriveDup = function (t, d) {
    var threat = d.threat; // ghost
    if (!threat.alive || threat.pipelineDead) return;
    this._nodeArrive(d.c2, t, { threat: threat }, function () { /* 부하만 소비 — onDone 무연산 */ });
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
      var delay = comm ? this._linkDelay(comm) : 0;
      if (comm) this._recordLink(c2Id, 'JAMDC2', comm, 'report');
      this._mark(threat, '융합경유', t);
      this.schedule(t + delay, PRI.LINK_ARRIVE, 'FUSION_ARRIVE', { threat: threat });
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

  /**
   * 6·7 결심·교전협조/권한위임.
   * 정밀화 Phase B-3: 위협별 자동화 차등 플래그(threats.js automation, C2-AUTO-LEVEL-01)를
   * 참조해 결심 홉을 생략/단축한다 — 구 approval=null 우회의 일반화.
   *  - auto-preauth : 결심 홉 생략(사전승인 자동교전)
   *  - human-on-loop: 승인 처리(서비스)는 수행하되 coord 협조경로 홉 생략(COP 감독)
   *  - human-in-loop: 승인권자까지 coord 최단경로 홉 + 승인 처리(As-Is 기본)
   * 정밀화 Phase B-2: 승인권자 노드가 임계(DELEG_THRESH, 모드별) 이상 혼잡하면 결심을
   * 하위/자동으로 동적 위임(중앙→분권 전환)하고 전환 시점·횟수를 기록한다.
   */
  Simulation.prototype._decision = function (threat, t, controlC2) {
    var tt = KJ.threatType(threat.type);
    var auto = tt.automation ? tt.automation[this.mode] : null;
    var approvalId = tt.approvalLevel ? tt.approvalLevel[this.mode] : null;
    if (auto === 'auto-preauth' || !approvalId || approvalId === controlC2 || !this.nodeState[approvalId]) {
      this._doEngage(threat, t);       // 승인 불필요(사전승인 자동교전) 또는 동일 노드 승인
      return;
    }
    // B-2: 부하 기반 동적 권한위임 — 승인권자의 관측 대기열이 임계 초과 시 분권 전환
    var apprNs = this.nodeState[approvalId];
    if (apprNs.busy >= apprNs.c &&
        apprNs.queue.length >= apprNs.c * DELEG_QUEUE_MULT[this.mode]) {
      this.deleg.count++;
      if (this.deleg.firstT === null) this.deleg.firstT = t;
      this.deleg.byNode[approvalId] = (this.deleg.byNode[approvalId] || 0) + 1;
      this._mark(threat, '권한위임:' + approvalId, t);
      this._doEngage(threat, t);
      return;
    }
    if (auto === 'human-on-loop') {
      // 감독하 자동교전: 협조경로 홉 생략, 승인권자 처리만 수행
      this._mark(threat, '감독승인개시:' + approvalId, t);
      this.schedule(t, PRI.LINK_ARRIVE, 'APPROVE_ARRIVE', { threat: threat, appr: approvalId });
      return;
    }
    var path = coordPath(controlC2, approvalId, this.mode);
    if (!path) { threat.leakReason = 'responsibility_gap'; return; } // 책임공백(협조 경로 부재)
    var self = this, delay = 0;
    path.forEach(function (l) {
      delay += self._linkDelay(l.comm[self.mode]); // 홉별 실제 전달시각 샘플링(경로는 대표값으로 이미 선택됨)
      self._recordLink(l.from, l.to, l.comm[self.mode], 'coord');
    });
    this._mark(threat, '협조개시:' + controlC2 + '→' + approvalId, t);
    this.schedule(t + delay, PRI.LINK_ARRIVE, 'APPROVE_ARRIVE', { threat: threat, appr: approvalId });
  };

  Simulation.prototype._onApproveArrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    this._nodeArrive(d.appr, t, { threat: threat }, function (tt2, job) {
      self._mark(job.threat, '승인완료:' + d.appr, tt2);
      self._doEngage(job.threat, tt2);
    });
  };

  /**
   * 8 교전명령: WTA로 무기 선택 → 명령 링크 → 교전채널 투입.
   * 정밀화 Phase B-1 — 모드별 WTA 차등:
   *  - As-Is : COP 부재로 무기별 적합도 비교가 불가 — 관측 가능한 최소부하 선택(기존 동작).
   *  - To-Be : Best-Shooter 적합도 점수 = wtaSuit[위협 고도대역](개념 가중, C2-WTA-SUIT-01)
   *            × 잔여 교전용량(0.25+0.75×(1-충전율)). 동점은 노드 id 사전순(결정론).
   * canEngage 제약(신궁·천마 탄도탄 배제 등)은 두 모드 모두에서 항상 우선 필터다.
   */
  Simulation.prototype._doEngage = function (threat, t) {
    if (!threat.alive || threat.pipelineDead) return;
    var mode = this.mode, type = threat.type;
    var shooters = KJ.nodesInMode(mode).filter(function (n) {
      return n.category === 'shooter' && n.canEngage[type] &&
        n.controlledBy && (n.controlledBy[mode] || []).length > 0;
    });
    if (shooters.length === 0) { threat.leakReason = 'no_shooter'; return; } // 교전 불가(제약)
    var self = this, best = null;
    if (mode === 'tobe') {
      var altBand = KJ.threatType(type).altBand;
      shooters.forEach(function (sh) {
        var ns = self.nodeState[sh.id];
        var remain = ns ? Math.max(0, 1 - (ns.busy + ns.queue.length) / ns.K) : 1;
        var suit = sh.wtaSuit ? (sh.wtaSuit[altBand] || 0) : 1;
        var score = suit * (0.25 + 0.75 * remain);
        if (!best || score > best.score ||
            (score === best.score && sh.id < best.sh.id)) best = { sh: sh, score: score };
      });
    } else {
      shooters.forEach(function (sh) {
        var ns = self.nodeState[sh.id];
        var load = ns ? (ns.busy + ns.queue.length) : 0;
        if (!best || load < best.load) best = { sh: sh, load: load };
      });
    }
    var shooter = best.sh;
    var controlC2 = shooter.controlledBy[mode][0];
    var comm = this._link(controlC2, shooter.id, 'command');
    var delay = comm ? this._linkDelay(comm) : 0;
    if (comm) this._recordLink(controlC2, shooter.id, comm, 'command');
    this.global.engaged++;
    if (!threat._countedEngaged) {
      threat._countedEngaged = true;
      this.global.everEngaged++;
      // 결심 지연(MoP): 탐지→최초 교전명령 (협조/승인/위임 지연이 모두 포함됨)
      if (threat._detectT != null) {
        this.decisionDelaySum += (t - threat._detectT);
        this.decisionDelayCount++;
      }
    }
    this._mark(threat, '교전명령#' + (threat.tries + 1) + ':' + shooter.id, t);
    this.schedule(t + delay, PRI.LINK_ARRIVE, 'SHOOTER_ARRIVE', { threat: threat, shooter: shooter.id });
  };

  Simulation.prototype._onShooterArrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    this._nodeArrive(d.shooter, t, { threat: threat }, function (tt2, job) {
      self._onEngageEnd(tt2, job.threat, d.shooter);
    });
  };

  // 비용교환비의 '저가 포화위협' 부분집합 (계획서: 장사정포·UAV 대응 소모 비용)
  var SAT_THREATS = { uav_small: true, mrl_large: true };

  /** 9 BDA: 요격확률 판정 → 실패 시 재교전 피드백(폐루프) */
  Simulation.prototype._onEngageEnd = function (t, threat, shooterId) {
    if (!threat.alive) return;
    var shooter = KJ.nodeById(shooterId);
    threat.tries++;
    // Phase D: 교전 시도 1회 = 요격탄 1발 소모(개념) — 비용교환비(MoFE) 집계
    var shot = (shooter.engage && shooter.engage.costPerShotM) || 0;
    this.cost.interceptM += shot;
    if (SAT_THREATS[threat.type]) this.cost.interceptSatM += shot;
    var pk = this._pk(shooter, threat);
    if (this.rng.raw() < pk) {
      threat.alive = false; threat.killed = true;
      this.global.killed++;
      this.global.timeToKill.push(t - threat.spawnT);
      var tv = KJ.threatType(threat.type).unitCostM || 0;
      this.cost.killedThreatM += tv;
      if (SAT_THREATS[threat.type]) this.cost.killedThreatSatM += tv;
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
      _trace: null, _countedC2: false, _countedEngaged: false, _detectT: null
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
    // 다음 도착 (포아송: 지수 도착간격) — burst 전용 항목(ratePerMin 부재)은 후속 도착 없음
    var ratePerSec = ((entry.ratePerMin || 0) * this.intensity) / 60;
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
      // 일회성 동시 다발(burst) — 문제 상황 2 "무인기 8대 동시 남파" 유형.
      // 강도 배수로 반올림 스케일(강도 0 → 0대), 동시 이벤트는 (t, pri, seq)로 결정론 해소.
      if (entry.burst) {
        var n = Math.round(entry.burst * self.intensity);
        var at = entry.atSec || 0;
        for (var i = 0; i < n; i++) {
          if (at <= self.endTime) self.schedule(at, PRI.SPAWN, 'SPAWN', { entry: entry });
        }
      }
      var ratePerSec = ((entry.ratePerMin || 0) * self.intensity) / 60;
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
      case 'C2_ARRIVE_DUP': this._onC2ArriveDup(ev.t, ev.data); break;
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
        meanTimeToKillSec: meanTTK,
        // 결심 지연(MoP): 탐지→최초 교전명령 평균(초) — 협조/승인/위임 지연 포함
        meanDecisionDelaySec: this.decisionDelayCount
          ? this.decisionDelaySum / this.decisionDelayCount : 0,
        // 동적 권한위임(분권 전환) 관측: 전환 횟수·최초 전환 시각·승인노드별 분포 (B-2)
        delegation: {
          count: this.deleg.count, firstT: this.deleg.firstT, byNode: this.deleg.byNode
        },
        // 비용교환비(MoFE, 백만 USD 개념): exchange = 소모 요격탄 비용 / 격추 위협가치
        // (>1이면 아군이 더 비싼 자원을 소모). sat*는 저가 포화위협(무인기·방사포) 부분집합
        cost: {
          interceptM: this.cost.interceptM,
          killedThreatM: this.cost.killedThreatM,
          exchange: this.cost.killedThreatM > 0 ? this.cost.interceptM / this.cost.killedThreatM : null,
          interceptSatM: this.cost.interceptSatM,
          killedThreatSatM: this.cost.killedThreatSatM,
          exchangeSat: this.cost.killedThreatSatM > 0 ? this.cost.interceptSatM / this.cost.killedThreatSatM : null
        }
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

  // ── 정밀화 Phase C: 요격 실패(누수) 원인 코드 → 병목 분류(taxonomy) ──
  // 엔진이 태깅하는 leakReason 코드의 정본 분류. UI(대조표·타임라인·분석 탭 파이프라인)와
  // 회귀 테스트가 공유한다. group은 구조적 병목 축(어느 계층의 실패인가), structural은
  // C2 구조 개선(To-Be)으로 줄어야 하는 원인인지(명중실패 같은 순수 종말 성능과 구분),
  // stage는 9단계 파이프라인 중 이 실패가 발생하는 단계(분석 탭 매핑과 동일 정본)를 뜻한다.
  KJ.LEAK_TAXONOMY = {
    not_detected: { label: '미탐지', group: '탐지 공백', structural: true, stage: '① 탐지' },
    no_sensor: { label: '탐지 공백(센서 부재)', group: '탐지 공백', structural: true, stage: '① 탐지' },
    no_report_path: { label: '보고경로 부재(항적 비융합)', group: '항적 비융합·보고경로 부재', structural: true, stage: '② 추적생성' },
    responsibility_gap: { label: '책임공백(협조경로 부재)', group: '책임 공백', structural: true, stage: '⑥⑦ 결심·협조' },
    overflow: { label: '포화손실', group: '처리 포화', structural: true, stage: '③④⑤ C2 / ⑧ 교전' }, // 'overflow:<노드>' 접두 코드
    no_shooter: { label: '교전수단 부재(제약)', group: '교전수단 제약', structural: false, stage: '⑧ 교전명령' },
    missed: { label: '명중 실패(기회소진)', group: '명중 실패', structural: false, stage: '⑨ BDA' },
    timeout: { label: '처리지연 초과(공역이탈)', group: '처리지연 초과', structural: true, stage: '⑨ 종합' }
  };

  /**
   * leakReason 코드(‘overflow:<노드>’ 접두 포함)를 taxonomy 항목으로 해석.
   * overflow는 포화된 노드의 카테고리에 따라 발생 단계를 C2 처리(③④⑤)와
   * 교전명령(⑧)으로 정밀화한다.
   */
  KJ.leakTaxonomy = function (code) {
    if (KJ.LEAK_TAXONOMY[code]) return KJ.LEAK_TAXONOMY[code];
    if (code && code.indexOf('overflow:') === 0) {
      var base = KJ.LEAK_TAXONOMY.overflow;
      var node = KJ.nodeById(code.slice(9));
      var stage = node && node.category === 'shooter' ? '⑧ 교전명령' : '③④⑤ C2 처리';
      return { label: base.label + '(' + code.slice(9) + ')', group: base.group, structural: base.structural, stage: stage };
    }
    return { label: String(code), group: '기타', structural: false, stage: '—' };
  };

  /** 편의 실행기: 단일 복제(replication) 실행. Phase 3 Monte Carlo가 이를 다수 집계한다. */
  KJ.runDES = function (cfg) { return new Simulation(cfg).run(); };
})();
