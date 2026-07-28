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
  var MAX_IADS_SHOTS = 2;   // native shoot-look-shoot: 표적당 전 축 합산 최대 발사수
  // Phase 5(⑨, pkCorrelated): 동일 표적 재교전 상관계수 ρ. 종전 모델은 매 발사 pk를 독립 추출해
  // 재교전이 항상 누적 격추확률을 끌어올린다(1−(1−pk)^n) — 2022.12.26 무인기 5대 전량 미격추 같은
  // "체계적 실패(기하·ECM·표적특성이 발사 간 공유)"를 재현 못 한다. ρ=공유잠재(frailty) 가중.
  // ρ=0 → 독립(legacy와 동일 평균), ρ=1 → 완전상관(재교전 무의미). 근거 등급 C → 기본 OFF.
  var PK_CORR_RHO = 0.7;
  // Phase 6(⑨, salvo): 연발(동시 다발 발사) 교전당 요격탄 수. 종전은 교전당 1발 후 BDA(shoot-look-shoot)
  // — 체공창이 짧으면 재교전 시간이 없어 놓친다(누수 사유 missed·no_engage_window). 연발은 단일 패스에서
  // 누적 pk=1−(1−pk)^k로 격추율↑, 대신 요격탄 k발 소모로 비용교환비↓. 교리 선택(결함 아님) → 기본 OFF.
  var SALVO_SIZE = 2;
  // 자원최적화 Step 1(costAwareWta): 비용 인식 WTA 가중치 W. score에 비용항 ((1−W)+W·costFit) 곱.
  // costFit = min(1, 위협가치/요격탄가) — 위협보다 비싼 요격탄일수록 낮음. W=0이면 현행과 동일(되돌리기).
  // KJADS 원칙 5-1(대응수단 계층화·고가유도탄 보존) 구현. W는 스윕으로 결정(ADR-007).
  var COST_WTA_WEIGHT = 0.5;
  var HIGH_VALUE_COST_M = 5; // 고가 유도탄 임계($M) — L-SAM($8M)만 해당. 보존율 지표 분자 기준.
  var SCARCITY_THRESH = 0.3; // Step 3(thresholdReweight): 재고비율이 이 값 미만이면 WTA 점수 감쇠 시작.
  var SHOOTER_QUEUE_MULT = 2; // 무기 대기실 = 교전채널 × 배수 (M/M/c/K, K=c*mult)
  // ⑧ 교전창 실현가능성 여유계수 — 명령링크지연+교전소요(engageTimeSec 평균)이 잔여 체공창의
  // 이 비율 이하일 때만 후보로 인정. 1.0 = 결정론(평균 ≤ 잔여). 교전시간은 지수분포라 평균이
  // 창 안에 들어와도 실현의 절반은 초과하므로, 확률적 여유(<1.0)를 둘지는 STOP 판단 대상(기본 1.0).
  var ENGAGE_WINDOW_MARGIN = 1.0;

  // 병목 판정 임계값 (Phase 1과 동일 기준: 계획서 ENV-RHO-THRESH-01)
  var RHO_WARN = 0.7, RHO_BOTTLENECK = 0.9;

  // ── 정밀화 Phase B-2: 부하 기반 중앙↔분권 동적 전환 임계 (C2-DELEG-THRESH-01) ──
  // 승인권자 노드가 [전 결심서버 점유(busy≥c) AND 대기열 길이 ≥ c×배수]로 관측되면
  // 그 결심을 하위/자동으로 위임(분권 전환)한다. To-Be는 COP 공유·자동화 전제로 조기
  // 전환(대기 c×1), As-Is는 수동 절차 탓에 대기가 서버수의 4배로 누적되어야 전환(느림/준부재).
  // 하드코딩된 병목이 아니라 부하의 함수: 시나리오·강도가 낮으면 어느 모드에서도 전환이
  // 일어나지 않는다(회귀로 고정).
  var DELEG_QUEUE_MULT = { asis: 4, tobe: 1 };
  // 저가 포화위협 부분집합(무인기·방사포) — exchangeSat 분자·분모 계정용 (ADR-002)
  var SAT_THREATS = { uav_small: true, mrl_large: true };

  /**
   * 작업 종류(kind)별 통계 버킷을 지연 생성해 반환. (Phase: track/approval 부하 분리)
   * C2 서버풀은 ③④⑤ 항적처리(track: _onC2Arrive/_onFusionArrive)와 ⑥⑦ 승인처리
   * (approval: _onApproveArrive)에 공유되므로 노드 단위 통계만으로는 두 부하가 섞여
   * "승인 노드의 ρ가 ③④⑤ 카드에 표시"되는 결함이 생긴다. kind 태그로 분해해 각 카드가
   * 자기 단계만 측정하게 한다. shooter는 engage 한 종류뿐이다. 순수 관측 — rng 소비·이벤트
   * 순서·기존 노드 통계(ns.arrivals/busyTime/drops/Wq)에 영향을 주지 않는다(추가만).
   */
  function bucket(ns, kind) {
    var b = ns.byKind[kind];
    if (!b) b = ns.byKind[kind] = { arrivals: 0, completions: 0, drops: 0, busyTime: 0, waitAccum: 0, waitCount: 0 };
    return b;
  }

  function iadsThreatCategory(type) {
    return type === 'srbm' || type === 'mrl_large' ? 'ballistic' : 'abt';
  }

  /** 군단 AOC C2A 우선순위: 위협군과 잔여 방어시간을 함께 반영한다. */
  function iadsThreatPriority(threat, at) {
    var rank = { srbm: 7, mrl_large: 6, cruise: 5, fighter: 4, ac_low: 3, heli: 2, uav_small: 1 };
    var remaining = Math.max(0, threat.spawnT + threat.dwellSec - at);
    return (rank[threat.type] || 0) * 1000000 + Math.max(0, 100000 - remaining);
  }

  function haversineKm(a, b) {
    var rad = Math.PI / 180, R = 6371;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var q = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var ground = 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
    var dz = ((b.altKm || 0) - (a.altKm || 0));
    return Math.sqrt(ground * ground + dz * dz);
  }

  function iadsThreatPosition(threat, at) {
    var progress = Math.max(0, Math.min(1, (at - threat.spawnT) / threat.dwellSec));
    // ADR-063: threat.target(산포 착탄점)이 있으면 그 점을 종점으로 쓴다. 없으면 축선 표적점.
    var ll = KJ.axisPosition(threat.axis, progress, threat.target);
    var cat = iadsThreatCategory(threat.type);
    var altKm;
    if (threat._iadsPhysical && KJ.IADS) {
      var axis = KJ.AXES[threat.axis];
      var distanceKm = threat._iadsAxisDistanceKm;
      if (!Number.isFinite(distanceKm) && axis) {
        var endPt = threat.target || axis.target;
        distanceKm = haversineKm(
          { lat: axis.entry[0], lon: axis.entry[1], altKm: 0 },
          { lat: endPt[0], lon: endPt[1], altKm: 0 });
        threat._iadsAxisDistanceKm = distanceKm;
      }
      altKm = KJ.IADS.threatPhysics(threat.type, progress, distanceKm).altitude / 1000;
    } else if (cat === 'ballistic') {
      var apex = threat.type === 'srbm' ? 70 : 45;
      altKm = Math.max(0, apex * Math.sin(Math.PI * progress));
    } else {
      var band = KJ.threatType(threat.type).altBand;
      altKm = band === 'medium' ? 10 : 0.1;
    }
    return { lat: ll[0], lon: ll[1], altKm: altKm };
  }

  /**
   * @param {object} cfg { scenario, mode, intensity, seed, endTimeSec }
   */
  function Simulation(cfg) {
    this.scenario = cfg.scenario;
    this.mode = cfg.mode;
    this.catalog = KJ.resolveModelCatalog
      ? KJ.resolveModelCatalog(cfg)
      : { id: 'legacy', nodes: KJ.NODES, links: KJ.LINKS,
          roles: { fusionC2: 'JAMDC2', KAMDOC: 'KAMDOC', MCRC: 'MCRC', KAOC: 'KAOC' } };
    // ADR-061: legacy 배치·compat 충실도 폐기 — 고해상도 iads-c2가 유일한 정본 경로다.
    if (cfg.features && cfg.features.highResolutionDeployment === false) {
      throw new Error('legacy 배치는 폐기되었다(ADR-061) — 고해상도 배치 6종만 지원');
    }
    if (cfg.modelFidelity && cfg.modelFidelity !== 'iads-c2') {
      throw new Error('compat 충실도는 폐기되었다(ADR-061) — modelFidelity는 iads-c2 하나다');
    }
    this.highResolutionDeployment = true;
    this.nativeIads = true;
    this.modelFidelity = 'iads-c2';
    if (!KJ.IADS || !KJ.createIadsEventQueue) {
      throw new Error('IADS_C2 module kernel is not loaded; use the module worker over HTTP (또는 단일본의 IIFE 커널)');
    }
    this.iadsSensorPhysics = true;
    this.jammingLevel = Math.max(0, Math.min(1, Number(cfg.jammingLevel) || 0));
    this.ecmActive = cfg.ecmActive === true;
    this.iadsSensorStats = this.iadsSensorPhysics
      ? { scans: 0, gated: 0, detections: 0, tracks: 0, fireControl: 0, losses: 0 }
      : null;
    this.iadsCorrelationStates = {};
    this.iadsOrderSeq = 0;
    this.engagementSeq = 0;
    this.deploymentId = this.highResolutionDeployment ? this.catalog.id : null;
    this.fusionC2Id = this.catalog.roles ? this.catalog.roles.fusionC2 : 'JAMDC2';
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
    // ⑨ 기능 플래그(feat/stage9-bda) — 모든 신규 거동은 켜고 끌 수 있어야 한다(되돌리기 가능성).
    // 전부 false로 주면 stage9 이전(legacy)과 완전히 동일한 결과를 낸다(tests/reengage 되돌리기 어서션).
    // 기본값: 문서화된 값 배선(pkByShooter)·회귀안전 지표(leakCost)·절단보정(censorFix)·taxonomy
    // 정합(timeoutSplit)은 ON. 근거 약하고 결론을 움직이는 것(pkCorrelated·salvo)은 기본 OFF(ADR).
    var f = cfg.features || {};
    function ff(k, dflt) { return f[k] !== undefined ? !!f[k] : dflt; }
    this.features = {
      pkByShooter: ff('pkByShooter', true),   // Phase 1: 무기별 요격확률 배선(문서값)
      leakCost: ff('leakCost', true),          // Phase 2: 누수 피해 보상 지표(별도 신설, exchange 불변)
      censorFix: ff('censorFix', true),        // Phase 3: 종료 절단 보정(분모)
      timeoutSplit: ff('timeoutSplit', true),  // Phase 4: timeout:c2/engage 분해 + overflow:shooter 재분류
      pkCorrelated: ff('pkCorrelated', false), // Phase 5: 재교전 pk 상관(근거 약함 — 기본 OFF)
      salvo: ff('salvo', false),               // Phase 6: 연발(범위 확대 — 기본 OFF)
      // 통합 Gate 2(되돌리기): W6 센서 Pd 융합을 런타임 토글. OFF면 통합 이전(0468f10) 탐지식
      //   p = min(1, detectFactor × mult.detect)로 복귀 — 센서 Pd·모드별 융합을 무시.
      //   탐지 계층 그리기 수는 동일(스캔당 raw 1회)이라 이 계층에선 bit-clean 되돌리기.
      //   ⚠️ 전체 bit-exact 복원은 CRN(arrRng 분리)이 도착 스트림을 바꿔 불가 — 감사문서 G2 참조.
      sensorPdFusion: ff('sensorPdFusion', true),
      // ── 자원 최적화(KJADS 원칙 5) — 정의상 To-Be만 개선. 반증실험(costAwareWtaAsis) 필수 ──
      costAwareWta: ff('costAwareWta', true),       // Step 1: 비용 인식 WTA(To-Be) — 스윕 후 기본 ON(등급 B)
      costAwareWtaAsis: ff('costAwareWtaAsis', false), // 반증 실험 전용(As-Is에도 적용) — 항상 기본 OFF
      magazine: ff('magazine', false),               // Step 2: 유도탄 재고 — 근거 C, 기본 OFF
      reserveFloor: ff('reserveFloor', false),        // Step 2: 보존 최소수량(magazine 의존) — 기본 OFF
      thresholdReweight: ff('thresholdReweight', false) // Step 3: 임계 재가중 — 기본 OFF
    };
    // 명령 계층 내부 플래그는 legacy `global.features` wire shape에 넣지 않는다(Phase 0 SHA 보존).
    // 비상교전 교리는 별도 명시 플래그 없이는 활성화하지 않아 "명령 부재=자동 발사"가 되지 않는다.
    this.commandLifecycle = ff('commandLifecycle', this.modelFidelity === 'iads-c2');
    this.commandReceptionQueue = ff('commandReceptionQueue', this.modelFidelity === 'iads-c2');
    this.emergencyEngagement = ff('emergencyEngagement', false);
    // ADR-056: To-Be 통합 축(KILL_WEB)이 군단 AOC 교전현황을 소비하는가. OFF면 As-Is의 MCRC만
    // 소비한다(=수정 전과 bit-exact). ON이어도 As-Is 결과는 변하지 않는다(KILL_WEB 축은 To-Be 전용).
    this.unifiedEngagementState = ff('unifiedEngagementState', false);
    // ADR-057: 링크 의미론 codex 정합 — 센서→C2는 보고 주기(reportingPeriod), C2↔C2는 전송
    // 지연(codex shortRange 1초). 실제 분기는 어댑터의 변형 카탈로그가 수행한다(캐시 분리).
    this.linkSemanticsV2 = ff('linkSemanticsV2', false);
    // ADR-058: 승인 계선 이식 — As-Is LOCAL_AD 축(군단 AOC)의 교전이 승인권자(KAOC→MCRC)
    // 협조 홉 + 승인 서비스(kind='approval')를 거친다. 동적 권한위임(DELEG_QUEUE_MULT)·
    // automation 3단계 차등 포함. approvalChainTobe는 반증 전용 — To-Be에도 As-Is 계선 강제.
    this.approvalChain = ff('approvalChain', false);
    this.approvalChainTobe = ff('approvalChainTobe', false);
    // ADR-059: native WTA 모드 차등 — As-Is는 COP 부재로 무기별 적합도(pk·PIP) 비교가 불가하다는
    // 이론을 사수 선정에 이식. To-Be는 현행 물리 점수식 + 비용 인식(탄도 위협 한정).
    // nativeWtaCostAsis는 반증 전용(As-Is에도 비용항 적용 — 선례 costAwareWtaAsis).
    this.nativeWtaMode = ff('nativeWtaMode', false);
    this.nativeWtaCostAsis = ff('nativeWtaCostAsis', false);
    // ADR-063: 표적권역 산포 — 종전에는 같은 축선의 모든 위협이 정확히 같은 한 점으로 향해
    // seed를 바꿔도 착탄점이 불변이었다. ON이면 위협마다 표적권역(disk) 안에서 착탄점을 뽑는다.
    // 반경은 features.targetSpreadKm로 스윕 가능(기본 THREAT-TARGET-DISP-01 = 15km, 등급 C).
    this.threatTargetDispersion = ff('threatTargetDispersion', false);
    this.targetSpreadKm = (typeof f.targetSpreadKm === 'number' && f.targetSpreadKm >= 0)
      ? f.targetSpreadKm : (KJ.THREAT_TARGET_SPREAD_KM || 0);
    // OFF wire shape은 기존 결과와 bit-exact로 유지한다. ON일 때만 결과 features에 노출.
    if (this.highResolutionDeployment) this.features.highResolutionDeployment = true;
    if (this.unifiedEngagementState) this.features.unifiedEngagementState = true;
    if (this.linkSemanticsV2) this.features.linkSemanticsV2 = true;
    if (this.approvalChain) this.features.approvalChain = true;
    if (this.approvalChainTobe) this.features.approvalChainTobe = true;
    if (this.nativeWtaMode) this.features.nativeWtaMode = true;
    if (this.nativeWtaCostAsis) this.features.nativeWtaCostAsis = true;
    if (this.threatTargetDispersion) {
      this.features.threatTargetDispersion = true;
      this.features.targetSpreadKm = this.targetSpreadKm;
    }
    // Step 1: 비용 가중치 W(0~1). features.costWtaWeight 숫자로 재정의(스윕), 없으면 문서 기본.
    this.costWtaWeight = (typeof f.costWtaWeight === 'number') ? Math.max(0, Math.min(1, f.costWtaWeight)) : COST_WTA_WEIGHT;
    // Step 2: 재고 스윕용 균일 override(모든 무기 동일 magazine). 없으면 노드별 magazine 사용.
    this.magazineSize = (typeof f.magazineSize === 'number') ? f.magazineSize : null;
    // Phase 5: 상관계수 ρ(0~1). features.pkCorrelation 숫자로 재정의 가능(민감도 스윕용), 없으면 문서 기본.
    this.pkCorrRho = (typeof f.pkCorrelation === 'number') ? Math.max(0, Math.min(1, f.pkCorrelation)) : PK_CORR_RHO;
    // Phase 6: 연발 발수 k(≥1 정수). features.salvoSize로 재정의, 없으면 문서 기본. salvo OFF면 미사용(k=1).
    this.salvoSize = (typeof f.salvoSize === 'number' && f.salvoSize >= 1) ? Math.round(f.salvoSize) : SALVO_SIZE;
    // Native IADS는 종전 MISS마다 체공창 종료까지 무제한 재발사했다. 교리 선언
    // shoot-look-shoot에 맞춰 전 C2 축 합산 표적당 최대 2발을 기본으로 한다.
    this.iadsMaxShots = (typeof f.iadsMaxShots === 'number' && f.iadsMaxShots >= 1)
      ? Math.round(f.iadsMaxShots) : MAX_IADS_SHOTS;
    // 공통난수(CRN, `claude/c2-simulation-review` 검토 이식): 난수 스트림을 도착·처리로 분리한다.
    //  · rng    — 처리 무작위성(탐지 판정·서비스시간·요격확률·링크지연 분포·중복교전 등)
    //  · arrRng — 위협 도착간격(시나리오 그 자체) 전용. seed에서 독립 파생(황금비 해시)해
    //             모드(asis/tobe)와 무관하게 동일 도착 스케줄(시각·유형·축선·수)을 생성한다.
    // 덕분에 동일 seed에서 As-Is와 To-Be가 "같은 위협"을 마주하고, 두 형상 차이가 서로 다른
    // 위협표본이 아니라 오직 C2 구조 차이에서만 비롯됨을 보장한다(공통난수 분산감소·짝지은 비교).
    this.rng = KJ.makeRng(this.seed);
    this.arrRng = KJ.makeRng((Math.imul(this.seed ^ 0x9E3779B9, 0x85EBCA6B) >>> 0));
    //  · dispRng — ADR-063 표적 산포 전용. 도착·처리 스트림과 분리해, 산포를 켜도 다른
    //    도메인의 난수 소비 순서가 바뀌지 않게 한다(OFF에서는 한 번도 뽑지 않는다).
    //    arrRng와 같은 이유로 모드 무관 파생 — As-Is/To-Be가 동일 착탄점 집합을 마주한다.
    this.dispRng = KJ.makeRng((Math.imul(this.seed ^ 0x632BE5AB, 0xC2B2AE35) >>> 0));
    this.heap = this.iadsSensorPhysics ? KJ.createIadsEventQueue() : new KJ.MinHeap();
    this.now = 0;
    this.seq = 0;
    this.threatSeq = 0;
    this.nodeState = {};
    this.linkStat = {};   // "from>to" -> {count, delaySec, type, kind}
    this._geometryWindowCache = {}; // shooter x threat x axis counterfactual PIP window cache
    this.global = {
      spawned: 0, detected: 0, engaged: 0, killed: 0, leaked: 0,
      reachedC2: 0, everEngaged: 0,
      leakReasons: {}, timeToKill: [], timeToEngage: [],
      // Phase 2(⑥⑦): 수평 교전협조·중복교전 관측 (As-Is 팬아웃 계통 간 조율)
      // coordAttempts: 중복항적 계통이 교전 가능해 협조 판정이 일어난 횟수
      // deconflicted: 잔여 체공창 내 협조 성립(중복 회피) / coordGaps: 협조 실패(책임공백)
      // duplicateEngagements: 협조 실패로 두 계통이 각각 교전한 건수(요격탄 이중 소모)
      coordAttempts: 0, deconflicted: 0, coordGaps: 0, duplicateEngagements: 0,
      commanderAssignments: {}, realDuplicateEngagements: 0,
      // 군단 AOC C2A 정보상태: MCRC+국지항적 접수/융합과 제한형 교전현황 공유.
      trackFusion: { reportsReceived: 0, fusedTracks: 0, multiSourceTracks: 0, prioritizedTracks: 0 },
      trackQuality: { correct: 0, mis: 0, failed: 0, stale: 0, identified: 0 },
      c2Orders: {
        created: 0, received: 0, acknowledged: 0, committed: 0, fired: 0,
        hit: 0, miss: 0, released: 0, expired: 0, cancelled: 0,
        expiryByReason: {}, fireByCause: {}
      },
      statusSharing: {
        sent: 0, delivered: 0, dropped: 0, stale: 0, queued: 0,
        queueWaitSec: 0, deconflicted: 0, duplicatesDueToStaleState: 0
      },
      // 고해상도 실패 분류 v2: 최종 주원인과 과정 중 관측된 기여원인을 분리한다.
      // 결과 wire shape 보존을 위해 highResolutionDeployment에서만 외부에 노출한다.
      failurePrimary: {}, failureContributors: {}, failureFamilies: {},
      failureStructurality: { structural: 0, conditional: 0, nonstructural: 0, unknown: 0 },
      // Phase 1(⑨): 문서화된 pk가 없어 legacy 폴백이 발동한 (무기×위협) 조합 기록
      pkFallback: {}, censored: 0,
      // Phase 7(⑨): 요격탄 발사 수(교전당 발사수 = shotsFired/everEngaged). salvo·재교전으로 교전당
      // 1발을 넘을 수 있음을 드러낸다(종전엔 교전=1발 암묵 가정이라 발사 부담이 안 보였다).
      shotsFired: 0,
      // 자원최적화 Step 1: 고가 유도탄(MDU-L 계열) 소모액 · 교전한 위협가치 합(격추 무관).
      //  · 고가유도탄 보존율 = 1 − highValueInterceptM/interceptM (KJADS 5-1 직접 지표)
      //  · 위협등급 대비 요격탄 단가 비율 = interceptM/engagedThreatValueM (쏜 것 전부, 격추 여부 무관)
      highValueInterceptM: 0, engagedThreatValueM: 0
    };
    // Phase B-2: 동적 권한위임(분권 전환) 관측 상태 — 전환 시점·횟수·노드별 분포
    this.deleg = { count: 0, firstT: null, byNode: {} };
    // Phase B/D: 결심 지연(MoP) — 탐지→최초 교전명령 소요의 집계 (trace 무관 항상 수집)
    this.decisionDelaySum = 0;
    this.decisionDelayCount = 0;
    this.coordDelaySum = 0;   // 1B: 결심지연 중 coord 협조 홉 지연 몫(잔여=C2 처리·승인 대기)
    // Phase D: 비용교환비(MoFE) — 개념 요격탄 소모비용 / 격추 위협가치 (백만 USD 개념)
    // sat*는 저가 포화위협(장사정포·소형무인기) 부분집합. 전부 개념값(WPN/THR-*-COST-01).
    this.cost = { interceptM: 0, killedThreatM: 0, interceptSatM: 0, killedThreatSatM: 0,
      duplicateInterceptM: 0,  // Phase 2(⑥⑦): 중복교전 이중 소모 요격탄 비용
      leakedThreatM: 0, leakedThreatSatM: 0 };  // Phase 2(⑨): 누수 위협 가치(defenseEfficiency 분모, leakCost)
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
    // C2 분석용 구조화 이벤트. 일반 DES/MC에서는 완전히 비활성화해 기존 wire shape와
    // 성능을 보존하고, 결과 화면의 paired DES에서만 Worker가 활성화한다.
    this.c2Analysis = cfg.c2Analysis === true;
    this.c2EventCap = Math.max(1000, Number(cfg.c2EventCap) || 50000);
    this.c2Events = [];
    this.c2EventsTruncated = false;

    this._initNodes();
    if (this.nativeIads) this._initIadsResources();
  }

  Simulation.prototype._nodesInMode = function () {
    return KJ.nodesInMode(this.mode, this.catalog);
  };

  Simulation.prototype._nodeById = function (id) {
    return KJ.nodeById(id, this.catalog);
  };

  Simulation.prototype._resolveRole = function (id) {
    return KJ.resolveRoleId ? KJ.resolveRoleId(id, this.catalog) : id;
  };

  Simulation.prototype._initNodes = function () {
    var self = this, mode = this.mode;
    this._nodesInMode().forEach(function (n) {
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
        waitAccum: 0, waitCount: 0, maxInSystem: 0,
        // Phase: kind별 부하 분리 관측 — busyByKind는 현재 서비스 중인 서버의 kind별 개수
        // (Σ busyByKind === busy 불변). byKind는 kind별 누적 통계(bucket() 지연 생성).
        busyByKind: {}, byKind: {},
        // 자원최적화 Step 2(magazine): 유도탄 재고. OFF면 Infinity(소모 무제한=현행). ON이면 노드
        // magazine(또는 features.magazineSize 균일 override). ammoDepletedT=첫 소진 시각, reserveTriggers=보존 발동수.
        ammo: (n.category === 'shooter' && self.features.magazine)
          ? (typeof self.magazineSize === 'number' ? self.magazineSize : ((n.engage && n.engage.magazine) || Infinity))
          : Infinity,
        magazine0: (n.category === 'shooter') ? (typeof self.magazineSize === 'number' ? self.magazineSize : ((n.engage && n.engage.magazine) || Infinity)) : Infinity,
        ammoDepletedT: null, reserveTriggers: 0
      };
      if (self.trace) self.nodeSeries[n.id] = [];
    });
  };

  /** Per-launcher ammunition/reload and active engagement state for native IADS. */
  Simulation.prototype._initIadsResources = function () {
    this.iadsResources = {};
    this.iadsStatusChannels = {};
    var self = this;
    this._nodesInMode().filter(function (n) { return n.category === 'shooter'; }).forEach(function (n) {
      var count = Math.max(1, Number(n.launcherConfig && n.launcherConfig.launcherCount) || 1);
      var total = Math.max(0, Number(n.engage && n.engage.magazine) || 0);
      var base = Math.floor(total / count), extra = total % count;
      var launchers = [];
      for (var i = 0; i < count; i++) {
        var cap = base + (i < extra ? 1 : 0);
        launchers.push({ id: n.id + ':L' + (i + 1), capacity: cap, remaining: cap, reloadCompleteAt: null });
      }
      self.iadsResources[n.id] = {
        active: 0,
        maxSimultaneous: Math.max(1, Number(n.engage && n.engage.channels) || 1),
        reloadSec: Math.max(0, Number(n.reloadConfig && n.reloadConfig.durationSec) || 900),
        launchers: launchers,
        initialAmmo: total,
        shots: 0, completions: 0, commandArrivals: 0, capacityBlocks: 0,
        activeTime: 0, lastT: 0, peakActive: 0
      };
    });
    this.catalog.links.filter(function (l) { return l.kind === 'status' && l.comm[self.mode]; }).forEach(function (l) {
      var comm = l.comm[self.mode], key = l.from + '>' + l.to;
      self.iadsStatusChannels[key] = {
        key: key, link: l, comm: comm, busy: 0, queue: [],
        servers: Math.max(1, Number(comm.messageServers) || 1),
        capacity: Math.max(1, Number(comm.messageCapacity) || 4),
        freshnessSec: Math.max(1, Number(comm.freshnessSec) || 300)
      };
    });
  };

  /** native 사수의 실제 동시교전 점유 적분. 기존 nodeState M/M/c 통계를 우회하는 경로를 보완한다. */
  Simulation.prototype._advanceIadsResource = function (resource, t) {
    if (!resource) return;
    resource.activeTime += resource.active * Math.max(0, t - resource.lastT);
    resource.lastT = t;
  };

  /** 실패 후보를 항적에 누적한다. 동일 코드는 횟수와 최초/최종 시각만 보존해 메모리를 제한한다. */
  Simulation.prototype._recordFailureEvidence = function (threat, code, detail) {
    if (!threat || !code) return;
    threat._failureEvidence = threat._failureEvidence || {};
    var ev = threat._failureEvidence[code];
    if (!ev) ev = threat._failureEvidence[code] = { count: 0, firstT: this.now, lastT: this.now, detail: detail || null };
    ev.count++;
    ev.lastT = this.now;
    if (!ev.detail && detail) ev.detail = detail;
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

  /** 분석 이벤트 기록은 선택적·결정론적이며 시뮬레이션 동역학/RNG에 관여하지 않는다. */
  Simulation.prototype._metricEvent = function (type, t, threat, detail) {
    if (!this.c2Analysis) return;
    if (this.c2Events.length >= this.c2EventCap) {
      this.c2EventsTruncated = true;
      return;
    }
    var event = { type: type, t: +t, threatId: threat && threat.id ? threat.id : null };
    if (detail) Object.keys(detail).forEach(function (key) { event[key] = detail[key]; });
    this.c2Events.push(event);
  };

  /** C2 작업 이벤트 공통 필드. 항적 갱신시각은 관측만 하며 RNG·동역학에는 관여하지 않는다. */
  Simulation.prototype._c2JobMetricDetail = function (nsId, job) {
    var detail = { nodeId: nsId, kind: job.kind, jobId: job.jobId || null };
    var track = job.track;
    if (track) {
      var updates = (track.sources || []).map(function (source) { return source.lastUpdateAt; })
        .filter(Number.isFinite);
      detail.trackReceivedAt = Number.isFinite(track.receivedAt) ? track.receivedAt : null;
      detail.trackLastUpdateAt = updates.length ? Math.max.apply(null, updates) : null;
      detail.trackSourceCount = (track.sources || []).length;
      detail.trackFused = !!track.fused;
      detail.commanderAxis = job.commander && job.commander.axis;
      detail.threatCategory = job.threat ? iadsThreatCategory(job.threat.type) : null;
    }
    return detail;
  };

  // ── 스케줄러 ──
  Simulation.prototype.schedule = function (t, pri, type, data) {
    this.heap.push({ t: t, pri: pri, seq: this.seq++, type: type, data: data });
  };

  Simulation.prototype._link = function (fromId, toId, kind) {
    var l = this.catalog.links.find(function (x) {
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
      // kind별 busyTime도 동일한 시간가중 적분으로 누적 → Σ_kind busyTime === ns.busyTime 보존
      // (종료시각 시점에 서비스 중인 작업의 부분 점유까지 정확히 귀속됨). 완료시점 합산이 아니라
      // 적분으로 계산하는 이유: 종료 미완료 서비스가 있어도 합 보존이 부동소수까지 정확해야 하기 때문.
      var bbk = ns.busyByKind;
      for (var k in bbk) { if (bbk[k] > 0) bucket(ns, k).busyTime += bbk[k] * dt; }
      ns.lastT = t;
    }
  };

  /** 작업을 노드에 투입. 서버 여유→즉시 서비스, 대기실 여유→큐, 초과(K)→드롭(누수). */
  Simulation.prototype._nodeArrive = function (nsId, t, job, onDone) {
    var ns = this.nodeState[nsId];
    if (!ns) return 'missing';
    var disposition;
    this._advance(ns, t);
    if (ns.node.category === 'c2') {
      this._metricEvent('C2_ARRIVED', t, job.threat, this._c2JobMetricDetail(nsId, job));
    }
    ns.arrivals++;
    var bk = bucket(ns, job.kind); bk.arrivals++;
    var inSystem = ns.busy + ns.queue.length;
    if (ns.busy < ns.c) {
      ns.busy++;
      ns.busyByKind[job.kind] = (ns.busyByKind[job.kind] || 0) + 1;
      ns.waitAccum += 0; ns.waitCount++;
      bk.waitAccum += 0; bk.waitCount++;   // 즉시 서비스 = 대기 0 (kind별 Wq 표본에도 계상)
      this._startService(ns, t, job, onDone);
      disposition = 'started';
    } else if (inSystem < ns.K) {
      var queued = { job: job, onDone: onDone, enqT: t };
      if (job.kind === 'iads_track' && typeof job.priority === 'number') {
        var at = ns.queue.findIndex(function (q) {
          return q.job.kind === 'iads_track' && (Number(q.job.priority) || 0) < job.priority;
        });
        if (at < 0) ns.queue.push(queued); else ns.queue.splice(at, 0, queued);
      } else {
        ns.queue.push(queued);
      }
      disposition = 'queued';
    } else {
      ns.drops++; bk.drops++;     // M/M/c/K 포화 → 항적/교전기회 상실
      if (ns.node.category === 'c2') {
        this._metricEvent('C2_DROPPED', t, job.threat, this._c2JobMetricDetail(nsId, job));
      }
      // Native IADS may have several mutually unaware ICC/USFK branches for the
      // same real threat.  Saturating one branch must not kill the other branch.
      var branchLocalFailure = job.kind === 'iads_track' || job.kind === 'directive_reception' ||
        (job.kind === 'approval' && this.nativeIads); // ADR-058: native 다계통 — 한 축의 승인 드롭이 전 계통을 죽이지 않는다
      if (!branchLocalFailure) job.threat.pipelineDead = true;
      if (!branchLocalFailure && !job.threat.leakReason) job.threat.leakReason = 'overflow:' + nsId;
      disposition = 'dropped';
    }
    ns.maxInSystem = Math.max(ns.maxInSystem, ns.busy + ns.queue.length);
    this._sample(nsId, t);
    return disposition;
  };

  Simulation.prototype._startService = function (ns, t, job, onDone) {
    if (job.onServiceStart) job.onServiceStart(t, job);
    if (ns.node.category === 'c2') {
      this._metricEvent('C2_PROCESSING', t, job.threat, this._c2JobMetricDetail(ns.node.id, job));
    } else if (job.kind === 'engage') {
      // 중복교전 ghost는 id가 없어 threatId=null로 기록됐고, c2-report가 threatId 없는
      // 발사를 버려 legacy 중복교전이 "동시 중복교전 위협" 집계에서 누락되던 결함 수정 —
      // 실제 위협(_real)로 귀속한다. ghost는 설계상 BDA·명령 수명주기가 없으므로(격추/누수는
      // 주 계통 소유) duplicate 플래그를 달아, 소비 측(c2-report)이 중복 판정에만 쓰고
      // 원인 분포·교전공백 구간에서는 제외하도록 한다.
      var fireDetail = {
        shooterId: ns.node.id,
        cause: job.launchCause || job.threat._commandCause || 'unattributed',
        directiveId: job.directiveId || null,
        engagementId: job.engagementId || null
      };
      if (job.threat._dup) fireDetail.duplicate = true;
      this._metricEvent('ENGAGEMENT_FIRED', t,
        job.threat._dup ? job.threat._real : job.threat, fireDetail);
    }
    var svc = this.rng.exponential(ns.mean);   // ← RNG 소비: kind 분리와 무관하게 draw 1회 유지
    this.schedule(t + svc, PRI.SERVICE_END, 'SERVICE_END', { nsId: ns.node.id, job: job, onDone: onDone });
  };

  Simulation.prototype._onServiceEnd = function (t, d) {
    var ns = this.nodeState[d.nsId];
    this._advance(ns, t);
    if (ns.node.category === 'c2') {
      this._metricEvent('C2_DONE', t, d.job.threat, this._c2JobMetricDetail(d.nsId, d.job));
    }
    ns.busy--;
    if (ns.busyByKind[d.job.kind] > 0) ns.busyByKind[d.job.kind]--; // kind별 서버 점유 해제
    ns.completions++;
    bucket(ns, d.job.kind).completions++;
    // 다음 대기 작업 인출 — 이미 공역이탈(누수)·폐기된 항적은 건너뜀(track abandonment/reneging).
    // 포화 노드가 이미 떠난 항적에 유령 서비스 부하를 계상하지 않도록 한다.
    while (ns.queue.length > 0) {
      var nx = ns.queue.shift();
      if (!nx.job.threat.alive || nx.job.threat.pipelineDead) continue; // 재고에서 폐기
      if (Number.isFinite(nx.job.validUntil) && t > nx.job.validUntil) {
        ns.drops++;
        bucket(ns, nx.job.kind).drops++;
        if (ns.node.category === 'c2') {
          var expiredDetail = this._c2JobMetricDetail(ns.node.id, nx.job);
          expiredDetail.reason = 'queue_deadline';
          this._metricEvent('C2_DROPPED', t, nx.job.threat, expiredDetail);
        }
        if (nx.job.onAbandon) nx.job.onAbandon(t, nx.job);
        continue;
      }
      ns.busy++;
      ns.busyByKind[nx.job.kind] = (ns.busyByKind[nx.job.kind] || 0) + 1;
      ns.waitAccum += (t - nx.enqT); ns.waitCount++;
      var nbk = bucket(ns, nx.job.kind);
      nbk.waitAccum += (t - nx.enqT); nbk.waitCount++;
      this._startService(ns, t, nx.job, nx.onDone);
      break;
    }
    this._sample(d.nsId, t);
    if (d.onDone) d.onDone(t, d.job);
  };

  // ── 파이프라인 ──

  Simulation.prototype._iadsShortestPath = function (fromId, toId, kinds) {
    if (fromId === toId) return [];
    var mode = this.mode, links = this.catalog.links, allowed = {};
    (kinds || ['report', 'coord', 'command']).forEach(function (k) { allowed[k] = true; });
    var dist = {}, prev = {}, seen = {};
    dist[fromId] = 0;
    while (true) {
      var cur = null, best = Infinity;
      Object.keys(dist).forEach(function (id) {
        if (seen[id]) return;
        if (dist[id] < best || (dist[id] === best && (cur === null || id < cur))) { cur = id; best = dist[id]; }
      });
      if (cur === null) return null;
      if (cur === toId) {
        var out = [], at = toId;
        while (prev[at]) { out.unshift(prev[at]); at = prev[at].from; }
        return out;
      }
      seen[cur] = true;
      links.forEach(function (l) {
        if (l.from !== cur || !allowed[l.kind] || !l.comm[mode]) return;
        var nd = best + l.comm[mode].delaySec;
        if (!(l.to in dist) || nd < dist[l.to] ||
            (nd === dist[l.to] && prev[l.to] && l.from < prev[l.to].from)) {
          dist[l.to] = nd; prev[l.to] = l;
        }
      });
    }
  };

  Simulation.prototype._resolveIadsCommanders = function (threat) {
    var self = this;
    var nodes = this._nodesInMode(), shooters = nodes.filter(function (n) { return n.category === 'shooter'; });
    var c2s = nodes.filter(function (n) { return n.category === 'c2'; });
    var category = iadsThreatCategory(threat.type);
    var korean = shooters.filter(function (n) { return n.forceOwner === 'ROK'; });
    var local = shooters.filter(function (n) { return n.forceOwner === 'ROK_LOCAL_AD'; });
    var usfk = shooters.filter(function (n) { return n.forceOwner === 'USFK'; });
    var out = [];
    function c2ByType(typeId) { return c2s.find(function (n) { return n.typeId === typeId; }) || null; }
    function add(node, scope, batteries, axis) {
      var capable = batteries.filter(function (b) {
        return self._iadsCanEngage(b, threat) && (!b.coverage || !b.coverage.length || b.coverage.indexOf(threat.axis) !== -1);
      });
      if (node && capable.length) out.push({ id: node.id, typeId: node.typeId, scope: scope, batteryIds: capable.map(function (b) { return b.id; }), axis: axis });
    }

    if (this.mode === 'tobe') {
      add(c2ByType('IAOC'), 'global', korean, 'KILL_WEB');
    } else {
      var root = c2ByType(category === 'ballistic' ? 'KAMD_OPS' : 'MCRC');
      if (root) {
        add(root, 'global', korean, category === 'ballistic' ? 'KAMD' : 'MCRC');
      } else {
        var iccs = c2s.filter(function (n) { return n.typeId === 'ICC'; });
        iccs.forEach(function (icc) {
          add(icc, 'icc', korean.filter(function (b) { return b.iccC2Id === icc.id; }),
            category === 'ballistic' ? 'KAMD' : 'MCRC');
        });
        if (!iccs.length) {
          korean.forEach(function (b) {
            var ecs = nodes.find(function (n) { return n.id === b.ecsC2Id; });
            add(ecs, 'self_battery', [b], 'ECS');
          });
        }
      }
    }

    if (category === 'abt') {
      var localGroups = {};
      local.forEach(function (b) { if (b.localAdC2Id) (localGroups[b.localAdC2Id] = localGroups[b.localAdC2Id] || []).push(b); });
      Object.keys(localGroups).forEach(function (id) {
        add(nodes.find(function (n) { return n.id === id; }), 'self_battery', localGroups[id], 'LOCAL_AD');
      });
    }

    ['USFK_THAAD', 'USFK_PATRIOT'].forEach(function (axis) {
      var bs = usfk.filter(function (b) { return b.c2Axis === axis; });
      var typeId = axis === 'USFK_THAAD' ? 'USFK_THAAD_C2' : 'USFK_PATRIOT_C2';
      add(c2ByType(typeId), 'global', bs, axis);
    });
    return out;
  };

  Simulation.prototype._iadsCanEngage = function (shooter, threat) {
    if (!shooter || !threat) return false;
    if (!this.iadsSensorPhysics) return !!(shooter.canEngage && shooter.canEngage[threat.type]);
    var type = KJ.SHOOTER_TYPES[shooter.typeId];
    var allowed = type && type.iadsEngageableThreats;
    return Array.isArray(allowed) && allowed.indexOf(threat.type) !== -1;
  };

  Simulation.prototype._iadsReportBundle = function (threat, commander) {
    var self = this, candidates = [], mcrcId = this.catalog.roles && this.catalog.roles.MCRC;
    var reportSensors = (threat._sensors || []).filter(function (sensor) {
      if (!self.iadsSensorPhysics) return true;
      var track = threat._sensorTracks && threat._sensorTracks[sensor.id];
      return track && KJ.IADS.trackFreshness(track, self.now, 120).fresh;
    });
    reportSensors.forEach(function (sensor) {
      if (commander.axis.indexOf('USFK') === 0 && sensor.forceOwner !== 'USFK') return;
      if (commander.axis !== 'LOCAL_AD' && commander.axis.indexOf('USFK') !== 0 && sensor.forceOwner === 'USFK') return;
      var path = self._iadsShortestPath(sensor.id, commander.id, ['report', 'coord']);
      if (path === null) return;
      var trackReport = null;
      if (self.iadsSensorPhysics) {
        trackReport = KJ.IADS.createTrackReport({
          physicalTrack: threat._sensorTracks[sensor.id], simTime: self.now, maxAgeSeconds: 120,
          cache: self.iadsCorrelationStates, seed: self.seed, sensorId: sensor.id,
          sensorTypeId: sensor.typeId, threatId: threat.id,
          architecture: self.mode === 'tobe' ? 'killweb' : 'linear'
        });
        if (!trackReport) {
          self.global.trackQuality.failed++;
          threat._iadsCorrelationFailedAt = self.now;
          return;
        }
        self.global.trackQuality[trackReport.correlationType]++;
      }
      var delay = path.reduce(function (sum, l) { return sum + l.comm[self.mode].delaySec; }, 0);
      var viaMcrc = !!mcrcId && path.some(function (l) { return l.from === mcrcId || l.to === mcrcId; });
      candidates.push({ sensorId: sensor.id, sensorTypeId: sensor.typeId, path: path, delay: delay,
        sourceClass: viaMcrc ? 'mcrc' : 'local', trackReport: trackReport });
    });
    candidates.sort(function (a, b) { return a.delay - b.delay || (a.sensorId < b.sensorId ? -1 : 1); });
    if (!candidates.length) return null;
    // 군단 AOC는 최속 국지항적과 MCRC 유래 공중항적을 각 1개씩 선택해
    // 동일 항적으로 상관·융합한다. 기타 책임 C2는 최속 1개 보고경로를 사용한다.
    var selected;
    if (commander.axis === 'LOCAL_AD') {
      var local = candidates.find(function (x) { return x.sourceClass === 'local'; });
      var mcrc = candidates.find(function (x) { return x.sourceClass === 'mcrc'; });
      selected = [local, mcrc].filter(Boolean);
    } else {
      selected = [candidates[0]];
    }
    return { reports: selected, nominalDelay: selected.reduce(function (m, x) { return Math.max(m, x.delay); }, 0) };
  };

  // 기존 내부/테스트 호환: 대표 보고경로만 반환.
  Simulation.prototype._iadsReportPath = function (threat, commander) {
    var bundle = this._iadsReportBundle(threat, commander);
    return bundle && bundle.reports.length ? bundle.reports[0] : null;
  };

  Simulation.prototype._routeIadsDetected = function (threat, t) {
    var self = this, commanders = this._resolveIadsCommanders(threat);
    threat._iadsPlans = threat._iadsPlans || [];
    threat._iadsCommanderKeys = threat._iadsCommanderKeys || {};
    threat._iadsCommandersById = threat._iadsCommandersById || {};
    threat._c2TrackLedger = threat._c2TrackLedger || {};
    threat._eligibleShooterIds = threat._eligibleShooterIds || {};
    if (!commanders.length) {
      threat.leakReason = 'no_responsible_c2';
      this._recordFailureEvidence(threat, 'no_responsible_c2', { type: threat.type, axis: threat.axis });
      return;
    }
    commanders.forEach(function (commander) {
      commander.batteryIds.forEach(function (id) { threat._eligibleShooterIds[id] = true; });
      var key = commander.id + '|' + commander.scope + '|' + commander.axis;
      if (threat._iadsCommanderKeys[key]) return;
      var report = self._iadsReportBundle(threat, commander);
      if (!report) return;
      threat._iadsCommanderKeys[key] = true;
      threat._iadsCorrelationFailedAt = null;
      threat._iadsCommandersById[commander.id] = commander;
      var delay = 0, sources = [];
      report.reports.forEach(function (entry) {
        var pathDelay = 0;
        entry.path.forEach(function (l) {
          pathDelay += self._linkDelay(l.comm[self.mode]);
          self._recordLink(l.from, l.to, l.comm[self.mode], l.kind);
        });
        delay = Math.max(delay, pathDelay);
        sources.push({ sensorId: entry.sensorId, sensorTypeId: entry.sensorTypeId,
          sourceClass: entry.sourceClass, arrivedAt: t + pathDelay,
          state: entry.trackReport && entry.trackReport.state,
          lastUpdateAt: entry.trackReport && entry.trackReport.lastUpdateAt,
          staleness: entry.trackReport && entry.trackReport.staleness,
          confidence: entry.trackReport && entry.trackReport.confidence,
          correlationType: entry.trackReport && entry.trackReport.correlationType,
          identity: entry.trackReport && entry.trackReport.identity });
      });
      var fused = self.iadsSensorPhysics ? KJ.IADS.fuseTrackReports(sources) : { fused: sources.length > 1 };
      threat._c2TrackLedger[commander.id] = Object.assign({}, fused, {
        sources: sources, receivedAt: t + delay, priority: iadsThreatPriority(threat, t + delay),
        freshUntil: t + delay + 120
      });
      self.global.trackFusion.reportsReceived += sources.length;
      self.global.trackFusion.fusedTracks++;
      if (sources.length > 1) self.global.trackFusion.multiSourceTracks++;
      self.global.trackFusion.prioritizedTracks++;
      self._mark(threat, '책임C2:' + commander.typeId + '(' + commander.scope + ')', t);
      self.schedule(t + delay, PRI.LINK_ARRIVE, 'IADS_C2_ARRIVE', {
        threat: threat, commander: commander, track: threat._c2TrackLedger[commander.id]
      });
    });
    if (!Object.keys(threat._iadsCommanderKeys).length) {
      if (this.iadsSensorPhysics && threat._iadsCorrelationFailedAt != null) {
        threat.leakReason = 'correlation_failed';
        threat._nextIadsCorrelationRetry = Math.floor(t / KJ.IADS.CORRELATION_RETRY_SECONDS + 1) * KJ.IADS.CORRELATION_RETRY_SECONDS;
        this._recordFailureEvidence(threat, 'correlation_failed', { commanderCount: commanders.length });
      } else {
        threat.leakReason = 'no_report_path';
        this._recordFailureEvidence(threat, 'no_report_path', { commanderCount: commanders.length });
      }
    }
  };

  /** 1 탐지: 축선·클래스 커버 센서 선별 후 첫 스캔 예약 */
  Simulation.prototype._beginDetect = function (threat, t) {
    var mode = this.mode, type = threat.type, axis = threat.axis, physical = this.iadsSensorPhysics;
    var sensors = this._nodesInMode().filter(function (n) {
      return n.category === 'sensor' &&
        n.detects.indexOf(type) !== -1 && (physical || n.coverage.indexOf(axis) !== -1);
    });
    if (sensors.length === 0) { threat.leakReason = 'no_sensor'; return; } // 탐지 공백
    threat._sensors = sensors;
    if (this.iadsSensorPhysics) {
      threat._sensorTracks = {};
      sensors.forEach(function (sensor) {
        var track = KJ.IADS.createTrackState();
        track.rng = KJ.IADS.deriveStream(this.seed, KJ.IADS.RNG_DOMAIN.SENSOR_SCAN, threat.id, sensor.id);
        threat._sensorTracks[sensor.id] = track;
      }, this);
      this.schedule(t + KJ.IADS.SENSOR_SCAN_CADENCE_SECONDS, PRI.DETECT, 'IADS_SENSOR_SCAN', { threat: threat });
      return;
    }
    this.schedule(t + SCAN_SEC, PRI.DETECT, 'DETECT', { threat: threat });
  };

  /** IADS_C2 sensor layer: per-sensor geometry/SNR/RCS state with domain RNG. */
  Simulation.prototype._onIadsSensorScan = function (t, d) {
    var threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    var dt = KJ.IADS.SENSOR_SCAN_CADENCE_SECONDS;
    var pos = iadsThreatPosition(threat, t);
    var progress = Math.max(0, Math.min(1, (t - threat.spawnT) / threat.dwellSec));
    var physical = KJ.IADS.threatPhysics(threat.type, progress);
    var target = {
      type: threat.type,
      position: { lon: pos.lon, lat: pos.lat, alt: pos.altKm * 1000 },
      rcs: physical.rcs,
      ecmFactor: threat.ecmActive ? physical.ecmFactor : 0
    };
    var acquiredNow = false;
    (threat._sensors || []).forEach(function (sensor) {
      var track = threat._sensorTracks[sensor.id];
      if (!track) return;
      var type = KJ.SENSOR_TYPES[sensor.typeId];
      var pFinal = KJ.IADS.computeScanPFinal({
        id: sensor.id,
        position: sensor.position || { lon: sensor.coord[1], lat: sensor.coord[0], alt: 0 },
        azimuthCenter: 0
      }, target, type, { jammingLevel: this.jammingLevel });
      this.iadsSensorStats.scans++;
      if (pFinal == null) this.iadsSensorStats.gated++;
      else pFinal = Math.max(0, Math.min(0.99, pFinal * this.mult.detect));
      var before = track.state;
      var stepped = KJ.IADS.stepSensorTrack(track, pFinal, dt, track.rng, t);
      var transitionEvent = KJ.IADS.advanceTransitions(track, type, t, threat.type);
      var eventName = transitionEvent || stepped.event;
      if (before === KJ.IADS.SENSOR_STATE.UNDETECTED && track.state !== before) acquiredNow = true;
      if (eventName === 'SENSOR_DETECTED') this.iadsSensorStats.detections++;
      else if (eventName === 'SENSOR_TRACKED') this.iadsSensorStats.tracks++;
      else if (eventName === 'SENSOR_FIRE_CONTROL') this.iadsSensorStats.fireControl++;
      else if (eventName === 'SENSOR_TRACK_LOST' || eventName === 'SENSOR_FC_DEGRADED') this.iadsSensorStats.losses++;
      if (eventName && threat._trace) this._mark(threat, eventName + ':' + sensor.id, t);
    }, this);

    if (!threat.detected && Object.keys(threat._sensorTracks).some(function (id) {
      return threat._sensorTracks[id].state !== KJ.IADS.SENSOR_STATE.UNDETECTED;
    })) {
      threat.detected = true;
      threat._detectT = t;
      this.global.detected++;
      this._mark(threat, '탐지', t);
      this._metricEvent('SENSOR_DETECTED', t, threat, { source: 'iads-physics' });
      acquiredNow = true;
    }
    var noCommanderTrack = !threat._iadsCommanderKeys || !Object.keys(threat._iadsCommanderKeys).length;
    var retryCorrelation = threat.detected && noCommanderTrack && threat.leakReason === 'correlation_failed' &&
      t >= (threat._nextIadsCorrelationRetry || Infinity);
    if (threat.detected && (acquiredNow || retryCorrelation)) {
      this._routeIadsDetected(threat, t);
      if (threat._iadsCommanderKeys && Object.keys(threat._iadsCommanderKeys).length &&
          (threat.leakReason === 'no_report_path' || threat.leakReason === 'correlation_failed')) {
        threat.leakReason = null;
      }
    }
    if (t + dt < threat.spawnT + threat.dwellSec) {
      this.schedule(t + dt, PRI.DETECT, 'IADS_SENSOR_SCAN', { threat: threat });
    }
  };

  Simulation.prototype._linkDelay = function (comm) {
    var base = comm.delaySec;
    if (comm.dist) {
      if (comm.dist.kind === 'triangular') base = this.rng.triangular(comm.dist.min, comm.dist.mode, comm.dist.max);
      else if (comm.dist.kind === 'uniform') base = this.rng.uniform(comm.dist.min, comm.dist.max);
      else if (comm.dist.kind === 'lognormal') base = this.rng.lognormal(comm.dist.mean, comm.dist.stddev);
      else if (comm.dist.kind === 'normal') base = this.rng.normal(comm.dist.mean, comm.dist.stddev);
    }
    base = Math.max(0, base);
    if (this.iadsSensorPhysics && this.jammingLevel > 0) {
      base += base * this.jammingLevel * (.5 + this.rng.raw());
    }
    return base * this.mult.delay;
  };

  Simulation.prototype._onDetected = function (threat, t) {
    // ADR-061: legacy 9단계 파이프라인 폐기 — native 경로만 남는다.
    this._routeIadsDetected(threat, t);
  };

  Simulation.prototype._onDupEngageEnd = function (t, shooterId, type) {
    var shooter = this._nodeById(shooterId);
    var shot = (shooter.engage && shooter.engage.costPerShotM) || 0;
    this.cost.interceptM += shot;
    this.cost.duplicateInterceptM += shot;
    if (SAT_THREATS[type]) this.cost.interceptSatM += shot;
  };

  Simulation.prototype._onIadsC2Arrive = function (t, d) {
    var self = this, threat = d.threat, commander = d.commander;
    if (!threat.alive || threat.pipelineDead || !this.nodeState[commander.id]) return;
    var track = d.track || { sources: [], fused: false, priority: iadsThreatPriority(threat, t) };
    if (this.iadsSensorPhysics && (track.freshUntil < t || track.sources.every(function (source) {
      return !Number.isFinite(source.lastUpdateAt) || t - source.lastUpdateAt > 120;
    }))) {
      this.global.trackQuality.stale++;
      this._mark(threat, '항적폐기:STALE:' + commander.typeId, t);
      return;
    }
    this._mark(threat, '항적정보접수:' + commander.typeId + '(' + track.sources.length + '출처)', t);
    var reportUpdates = (track.sources || []).map(function (source) { return source.lastUpdateAt; })
      .filter(Number.isFinite);
    this._metricEvent('TRACK_REPORT_RECEIVED', t, threat, {
      reportId: 'REPORT_' + threat.id + '_' + commander.id,
      nodeId: commander.id,
      commanderAxis: commander.axis,
      threatCategory: iadsThreatCategory(threat.type),
      trackReceivedAt: Number.isFinite(track.receivedAt) ? track.receivedAt : t,
      trackLastUpdateAt: reportUpdates.length ? Math.max.apply(null, reportUpdates) : null,
      trackSourceCount: (track.sources || []).length,
      trackFused: !!track.fused
    });
    this._mark(threat, '항적융합:' + commander.typeId + (track.fused ? '(MCRC+국지)' : '(단일출처)'), t);
    this._mark(threat, '위협우선순위:' + commander.typeId + '/' + Math.floor(track.priority), t);
    this._nodeArrive(commander.id, t, {
      threat: threat, kind: 'iads_track', commander: commander, priority: track.priority, track: track,
      jobId: 'TRACK_' + threat.id + '_' + commander.id
    }, function (done, job) {
      if (!job.threat._countedC2) { job.threat._countedC2 = true; self.global.reachedC2++; }
      if (self.iadsSensorPhysics) {
        var architecture = self.mode === 'tobe' ? 'killweb' : 'linear';
        track.sources.forEach(function (source) {
          KJ.IADS.overrideCorrelationCorrect(self.iadsCorrelationStates, source.sensorId, threat.id, architecture);
          source.correlationType = KJ.IADS.TRACK_CORRELATION.CORRECT;
          source.identity = KJ.IADS.TRACK_IDENTITY.HOSTILE;
        });
        track.correlationType = KJ.IADS.TRACK_CORRELATION.CORRECT;
        track.identity = KJ.IADS.TRACK_IDENTITY.HOSTILE;
        self.global.trackQuality.identified++;
        self._mark(job.threat, '식별확정:' + commander.typeId, done);
      }
      self.global.commanderAssignments[commander.typeId] = (self.global.commanderAssignments[commander.typeId] || 0) + 1;
      self._mark(job.threat, '위협판단·표적할당준비:' + commander.typeId, done);
      self._iadsDecide(job.threat, done, commander);
    });
  };

  Simulation.prototype._iadsRefreshLaunchers = function (shooterId, t) {
    var resource = this.iadsResources[shooterId];
    if (!resource) return;
    resource.launchers.forEach(function (l) {
      if (l.reloadCompleteAt !== null && l.reloadCompleteAt <= t) {
        l.remaining = l.capacity;
        l.reloadCompleteAt = null;
      }
    });
  };

  Simulation.prototype._iadsAmmo = function (shooterId, t) {
    this._iadsRefreshLaunchers(shooterId, t);
    var r = this.iadsResources[shooterId];
    return r ? r.launchers.reduce(function (sum, l) { return sum + (l.reloadCompleteAt === null ? l.remaining : 0); }, 0) : 0;
  };

  Simulation.prototype._iadsFireControlState = function (shooter, threat, t) {
    if (!shooter.mfrSensorId) return { ready: true, readyAt: t, state: 'FIRE_CONTROL' };
    if (this.iadsSensorPhysics) {
      var physicalTrack = threat._sensorTracks && threat._sensorTracks[shooter.mfrSensorId];
      var state = physicalTrack ? physicalTrack.state : KJ.IADS.SENSOR_STATE.UNDETECTED;
      var freshness = KJ.IADS.trackFreshness(physicalTrack, t, 3);
      return {
        ready: state === KJ.IADS.SENSOR_STATE.FIRE_CONTROL && freshness.fresh,
        readyAt: t + KJ.IADS.SENSOR_SCAN_CADENCE_SECONDS,
        state: state,
        staleness: freshness.age,
        confidence: freshness.confidence
      };
    }
    var sensor = this._nodeById(shooter.mfrSensorId);
    var spec = sensor && KJ.SENSOR_TYPES[sensor.typeId];
    if (!sensor || !spec) return { ready: false, readyAt: t + 1, state: 'UNDETECTED' };
    var compatRanges = spec.compatibilityRanges || spec.ranges;
    var fcRange = compatRanges && compatRanges.fireControl;
    if (!fcRange) return { ready: false, readyAt: t + 1, state: 'TRACKED' };
    var firstInside = null;
    for (var at = threat.spawnT; at <= t; at += 1) {
      var pos = iadsThreatPosition(threat, at);
      if (haversineKm({ lat: sensor.coord[0], lon: sensor.coord[1], altKm: 0 }, pos) <= fcRange) { firstInside = at; break; }
    }
    if (firstInside === null) return { ready: false, readyAt: t + 1, state: 'UNDETECTED' };
    var tr = spec.transitionTime || {};
    var fcAt = firstInside + (Number(tr.detectToTrack) || 0) + (Number(tr.trackToFireControl) || 0);
    return { ready: t >= fcAt, readyAt: fcAt, state: t >= fcAt ? 'FIRE_CONTROL' : 'TRACKED' };
  };

  /** ADR-059: 비용 인식 항 ((1−W)+W·costFit), costFit=min(1, 위협가치/요격탄가). legacy Step 1과
   *  동일 정의·동일 국한(탄도 altBand 한정 — C2-COST-WTA-01 계열 근거 승계). W=costWtaWeight. */
  Simulation.prototype._iadsCostTerm = function (shooter, ev, threat) {
    var tt = KJ.threatType(threat.type);
    if ((tt.altBand || null) !== 'ballistic') return 1;
    var cps = (ev.missile && ev.missile.costPerShot) || (shooter.engage && shooter.engage.costPerShotM) || 0;
    var costFit = cps > 0 ? Math.min(1, (tt.unitCostM || 0) / cps) : 1;
    var W = this.costWtaWeight;
    return (1 - W) + W * costFit;
  };

  Simulation.prototype._iadsEvaluate = function (shooter, threat, t) {
    if (!this._iadsCanEngage(shooter, threat)) return { feasible: false, reason: 'no_missile_for_threat' };
    var resource = this.iadsResources[shooter.id];
    if (!resource) return { feasible: false, reason: 'not_operational' };
    var ammo = this._iadsAmmo(shooter.id, t);
    if (ammo <= 0) {
      var nextReload = resource.launchers.reduce(function (m, l) {
        return l.reloadCompleteAt !== null ? Math.min(m, l.reloadCompleteAt) : m;
      }, Infinity);
      return { feasible: false, reason: 'ammo_depleted', readyAt: nextReload };
    }
    if (resource.active >= resource.maxSimultaneous) return { feasible: false, reason: 'capacity_full', readyAt: t + 1 };

    var fc = this._iadsFireControlState(shooter, threat, t);
    if (!fc.ready) return { feasible: false, reason: 'no_fire_control', readyAt: Math.max(t + 1, fc.readyAt) };

    var missiles = shooter.engage.missiles || {}, shooterPos = { lat: shooter.coord[0], lon: shooter.coord[1], altKm: 0 };
    var remaining = Math.max(0, threat.spawnT + threat.dwellSec - t), best = null, earliest = Infinity;
    if (!this.iadsSensorPhysics) {
      Object.keys(missiles).forEach(function (missileType) {
        var m = missiles[missileType], compat = m.compatibility || {};
        if (compat.enabled === false) return;
        var env = compat.engagementEnvelope || m.engagementEnvelope;
        var compatSpeed = compat.missileSpeed || m.missileSpeed;
        for (var dt = 1; dt <= Math.min(300, Math.floor(remaining)); dt++) {
          var pos = iadsThreatPosition(threat, t + dt);
          var range = haversineKm(shooterPos, pos), alt = pos.altKm;
          if (range < env.Rmin || range > env.Rmax || alt < env.Hmin || alt > env.Hmax) continue;
          var flyout = range * 1000 / compatSpeed;
          if (flyout > dt) continue;
          var wait = Math.max(0, dt - flyout - 3);
          var candidate = {
            feasible: wait <= 0.000001, reason: wait > 0 ? 'too_early' : null,
            readyAt: t + wait, missileType: missileType, missile: m,
            pip: { position: pos, timeToReach: dt, flyout: flyout, rangeKm: range },
            pk: Math.max(0, Math.min(0.99, ((m.pssekTable && m.pssekTable.default) || 0.75) * this.mult.pk)),
            ammo: ammo, fcState: fc.state
          };
          if (wait < earliest) { earliest = wait; best = candidate; }
          break;
        }
      }, this);
      return best || { feasible: false, reason: 'no_feasible_pip', readyAt: remaining > 1 ? t + 1 : Infinity };
    }
    var canonicalType = KJ.IADS.canonicalThreatType(threat.type);
    Object.keys(missiles).forEach(function (missileType) {
      var m = missiles[missileType], table = m.pssekTable || {};
      var detailed = Object.keys(table).some(function (key) { return key !== 'default'; });
      if (detailed && !table[canonicalType]) return;
      var pip = KJ.IADS.findEarliestPip({
        now: t, remainingSeconds: remaining, missile: m,
        positionAt: function (at) { return iadsThreatPosition(threat, at); },
        rangeTo: function (position) { return haversineKm(shooterPos, position); }
      });
      if (!pip) return;
      var launchWait = pip.timeToReach - pip.flyout - 3;
      var nextPos = iadsThreatPosition(threat, Math.min(threat.spawnT + threat.dwellSec, t + 1));
      var aspect = KJ.IADS.classifyAspect(shooterPos, iadsThreatPosition(threat, t), nextPos);
      var basePk = KJ.IADS.lookupPssek(table, threat.type, pip.rangeKm, aspect);
      if (basePk == null) return;
      var mfr = shooter.mfrSensorId ? this._nodeById(shooter.mfrSensorId) : null;
      var mfrType = mfr && KJ.SENSOR_TYPES[mfr.typeId];
      var threatPhysical = KJ.IADS.threatPhysics(threat.type,
        Math.max(0, Math.min(1, (t - threat.spawnT) / threat.dwellSec)), threat._iadsAxisDistanceKm);
      var correctedPk = KJ.IADS.applyEngagementProbabilityCorrections(basePk, {
        jammingLevel: this.jammingLevel,
        jammingSusceptibility: mfrType ? mfrType.jammingSusceptibility : .5,
        ecmActive: threat.ecmActive,
        ecmFactor: threatPhysical.ecmFactor,
        pkMultiplier: this.mult.pk
      });
      var candidate = {
        feasible: launchWait <= 0, reason: launchWait > 0 ? 'too_early' : null,
        readyAt: t + Math.max(0, launchWait), missileType: missileType, missile: m,
        pip: pip, aspect: aspect,
        pk: correctedPk,
        ammo: ammo, fcState: fc.state, trackStaleness: fc.staleness
      };
      if (m.fuelTime && pip.flyout > m.fuelTime) {
        candidate.feasible = false; candidate.reason = 'fuel_insufficient'; candidate.readyAt = Infinity;
      }
      if (candidate.pk < KJ.IADS.MIN_ENGAGEMENT_PK) {
        candidate.feasible = false; candidate.reason = 'pk_too_low'; candidate.readyAt = Infinity;
      }
      var rank = candidate.feasible ? -1 : Math.max(0, launchWait);
      if (rank < earliest) { earliest = rank; best = candidate; }
    }, this);
    return best || { feasible: false, reason: 'no_feasible_pip', readyAt: remaining > 1 ? t + 1 : Infinity };
  };

  Simulation.prototype._iadsCreatePlan = function (commander, shooterId, t, threat, options) {
    options = options || {};
    var id = 'ORDER_' + (++this.iadsOrderSeq);
    var plan;
    if (this.iadsSensorPhysics) {
      plan = KJ.IADS.createEngagementOrder(id, commander, shooterId, t, {
        threatId: threat && threat.id,
        targetEcsId: options.targetEcsId,
        authorityLevel: commander && commander.typeId,
        delegationLevel: options.delegationLevel,
        launchCause: options.launchCause,
        trackLastUpdateAt: options.trackLastUpdateAt,
        trackReceivedAt: options.trackReceivedAt,
        validUntil: options.validUntil,
        engagementId: 'ENG_' + (++this.engagementSeq)
      });
    } else {
      plan = {
        id: id, directiveId: id, threatId: threat && threat.id,
        commander: commander, shooterId: shooterId, createdAt: t,
        issuedByC2Id: commander && commander.id,
        targetEcsId: options.targetEcsId || null,
        authorityLevel: commander && commander.typeId,
        delegationLevel: options.delegationLevel || null,
        launchCause: options.launchCause || 'commanded',
        trackLastUpdateAt: Number.isFinite(options.trackLastUpdateAt) ? options.trackLastUpdateAt : null,
        trackReceivedAt: Number.isFinite(options.trackReceivedAt) ? options.trackReceivedAt : null,
        validUntil: options.validUntil == null ? null : options.validUntil,
        engagementId: 'ENG_' + (++this.engagementSeq),
        released: false, resolved: false, fired: false
      };
    }
    if (this.commandLifecycle) {
      this._metricEvent('DIRECTIVE_CREATED', t, threat, {
        directiveId: plan.directiveId, directiveType: 'ENGAGE',
        issuedByC2Id: commander && commander.id, targetEcsId: plan.targetEcsId || null,
        targetBatteryId: shooterId, authorityLevel: plan.authorityLevel || (commander && commander.typeId),
        delegationLevel: plan.delegationLevel || null, cause: plan.launchCause,
        validUntil: plan.validUntil, engagementId: plan.engagementId
      });
    }
    return plan;
  };

  Simulation.prototype._iadsTransitionPlan = function (plan, state, t, claimState, reason) {
    if (this.iadsSensorPhysics) KJ.IADS.transitionOrder(plan, state, t, claimState, reason);
    else {
      if (claimState === 'fired' || claimState === 'bda_pending') plan.fired = true;
      if (claimState === 'released' || state === 'released') plan.released = true;
      if (state === 'hit' || state === 'miss' || state === 'cancelled' || state === 'expired') {
        plan.resolved = true; plan.released = true;
      }
      if (state === 'expired') plan.expiryReason = reason || 'unknown';
      if (state === 'cancelled') plan.cancellationReason = reason || 'unknown';
    }
    if (this.commandLifecycle) {
      var eventType = {
        in_transit: 'DIRECTIVE_SENT',
        received: 'DIRECTIVE_RECEIVED',
        acknowledged: 'DIRECTIVE_PROCESSING',
        active: 'DIRECTIVE_ACTIVE',
        expired: 'DIRECTIVE_EXPIRED',
        cancelled: 'DIRECTIVE_CANCELLED'
      }[state];
      if (eventType) {
        this._metricEvent(eventType, t, { id: plan.threatId }, {
          directiveId: plan.directiveId, directiveType: plan.directiveType || 'ENGAGE',
          issuedByC2Id: plan.issuedByC2Id || (plan.commander && plan.commander.id),
          targetEcsId: plan.targetEcsId || null, targetBatteryId: plan.shooterId,
          authorityLevel: plan.authorityLevel || (plan.commander && plan.commander.typeId),
          delegationLevel: plan.delegationLevel || null, cause: plan.launchCause,
          reason: reason || null, validUntil: plan.validUntil,
          engagementId: plan.engagementId
        });
      }
    }
    return plan;
  };

  Simulation.prototype._iadsActivePlan = function (plan) {
    return this.iadsSensorPhysics ? KJ.IADS.isActiveClaim(plan) : !(plan.released || plan.resolved);
  };

  Simulation.prototype._iadsPlanBlocks = function (threat, commander) {
    var self = this;
    return (threat._iadsPlans || []).some(function (p) {
      if (!self._iadsActivePlan(p)) return false;
      if (p.commander.axis !== commander.axis) return false; // ROK↔USFK/local axes do not share engagement state.
      if (commander.scope === 'global') return true;
      if (commander.scope === 'icc') return p.commander.id === commander.id;
      return p.commander.id === commander.id;
    });
  };

  Simulation.prototype._iadsSharedLocalEngagement = function (threat, commander, t) {
    if (!commander) return null;
    // ADR-056: 군단 AOC 교전현황의 소비처. As-Is는 MCRC(공중위협 상급 C2)만 소비한다.
    // To-Be의 상급 C2는 axis='KILL_WEB'(IAOC)라 종전 조건이 항상 false였고, 그 결과
    // To-Be는 2초/무손실로 전달받은 교전현황을 한 번도 소비하지 않았다(중복교전이 As-Is보다
    // 많아지는 결함 — paired MC 30 seed로 확정). unifiedEngagementState ON이면 통합 COP가
    // 국지방공 교전상태를 본다는 해석으로 KILL_WEB 축도 같은 상태를 소비한다.
    var consumes = commander.axis === 'MCRC' ||
      (this.unifiedEngagementState && commander.axis === 'KILL_WEB');
    if (!consumes) return null;
    var states = threat._engagementStatusBySender || {}, best = null;
    Object.keys(states).forEach(function (id) {
      var s = states[id];
      if ((s.phase !== 'assigned' && s.phase !== 'fired') || s.freshUntil < t) return;
      if (!best || s.receivedAt > best.receivedAt) best = s;
    });
    return best;
  };

  Simulation.prototype._startIadsStatus = function (channel, msg, t) {
    channel.busy++;
    msg.startedAt = t;
    this.global.statusSharing.queueWaitSec += Math.max(0, t - msg.createdAt);
    this._recordLink(channel.link.from, channel.link.to, channel.comm, 'status');
    this.schedule(t + this._linkDelay(channel.comm), PRI.LINK_ARRIVE, 'IADS_STATUS_ARRIVE', {
      channelKey: channel.key, message: msg
    });
  };

  /** 군단 AOC 교전현황을 제한형 음성/VTC 채널로 MCRC에 전파. */
  Simulation.prototype._sendIadsStatus = function (threat, commander, phase, t) {
    if (!commander || commander.axis !== 'LOCAL_AD' || !this.iadsStatusChannels) return;
    var mcrcId = this.catalog.roles && this.catalog.roles.MCRC;
    var channel = this.iadsStatusChannels[commander.id + '>' + mcrcId];
    if (!channel) return;
    var msg = { threat: threat, from: commander.id, to: mcrcId, phase: phase, createdAt: t };
    this.global.statusSharing.sent++;
    if (channel.busy < channel.servers) {
      this._startIadsStatus(channel, msg, t);
    } else if (channel.busy + channel.queue.length < channel.capacity) {
      channel.queue.push(msg);
      this.global.statusSharing.queued++;
    } else {
      this.global.statusSharing.dropped++;
      this._mark(threat, '교전현황드롭:' + commander.id + '→MCRC/' + phase, t);
    }
  };

  Simulation.prototype._onIadsStatusArrive = function (t, d) {
    var channel = this.iadsStatusChannels[d.channelKey], msg = d.message;
    if (!channel) return;
    channel.busy = Math.max(0, channel.busy - 1);
    this.global.statusSharing.delivered++;
    var age = t - msg.createdAt;
    if (age > channel.freshnessSec) this.global.statusSharing.stale++;
    msg.threat._engagementStatusBySender = msg.threat._engagementStatusBySender || {};
    msg.threat._engagementStatusBySender[msg.from] = {
      from: msg.from, phase: msg.phase, createdAt: msg.createdAt, receivedAt: t,
      freshUntil: t + channel.freshnessSec, ageAtReceipt: age
    };
    this._mark(msg.threat, '교전현황수신:MCRC←' + msg.from + '/' + msg.phase, t);
    if (msg.phase === 'released' && msg.threat.alive) {
      var commander = msg.threat._iadsCommandersById && msg.threat._iadsCommandersById[msg.to];
      // ADR-056: To-Be에서는 수신 노드(MCRC 역할)가 책임 C2가 아니므로 id 조회가 빗나간다.
      // 플래그 ON이면 통합 축(KILL_WEB) 책임 C2가 국지방공 해제를 받아 재교전을 잇는다(As-Is 대칭).
      if (!commander && this.unifiedEngagementState && msg.threat._iadsCommandersById) {
        var byId = msg.threat._iadsCommandersById, ids = Object.keys(byId);
        for (var ci = 0; ci < ids.length; ci++) {
          if (byId[ids[ci]].axis === 'KILL_WEB') { commander = byId[ids[ci]]; break; }
        }
      }
      if (commander) this._scheduleIadsRetry(msg.threat, commander, t + 0.5);
    }
    if (channel.queue.length) this._startIadsStatus(channel, channel.queue.shift(), t);
  };

  Simulation.prototype._scheduleIadsRetry = function (threat, commander, at) {
    if (!threat.alive) return;
    var latest = threat.spawnT + threat.dwellSec;
    at = Math.max(this.now + 0.5, Number.isFinite(at) ? at : this.now + 1);
    if (at >= latest) return;
    threat._iadsRetryAt = threat._iadsRetryAt || {};
    var key = commander.id + '|' + commander.axis;
    if (threat._iadsRetryAt[key] !== undefined && threat._iadsRetryAt[key] <= at) return;
    threat._iadsRetryAt[key] = at;
    this.schedule(at, PRI.ARRIVE_NODE, 'IADS_RETRY', { threat: threat, commander: commander, key: key });
  };

  /** native IADS의 누적 증거에서 최종 주원인을 결정한다. 단계명이 아니라 반사실적 해결수단 기준이다. */
  Simulation.prototype._terminalIadsFailure = function (threat, fallback) {
    var ev = threat._failureEvidence || {};
    if (threat.leakReason === 'no_responsible_c2' || ev.no_responsible_c2) return 'no_responsible_c2';
    if (threat.leakReason === 'no_report_path' || ev.no_report_path) return 'no_report_path';
    if (threat.leakReason === 'correlation_failed' || ev.correlation_failed) return 'correlation_failed';
    if (threat.tries > 0) return threat.leakReason || 'timeout:engage';
    if (ev.ammo_depleted) return 'ammo_depleted';
    if (ev.capacity_full) return 'capacity_full';
    if (ev.no_fire_control) return 'no_fire_control';
    if (ev.fuel_insufficient) return 'fuel_insufficient';
    if (ev.pk_too_low) return 'pk_too_low';
    if (ev.no_missile_for_threat) return 'no_capable_weapon';
    if (ev.no_feasible_pip) {
      return threat._hadIadsPlan || ev.too_early ? 'window_lost_due_to_c2' : 'engagement_geometry_gap';
    }
    if (ev.too_early) return 'window_lost_due_to_c2';
    return fallback || threat.leakReason || 'timeout:c2';
  };

  /** 탄약·채널·FC를 정상화한 반사실에서 전 비행창 중 PIP가 한 번이라도 가능한지 검사한다. */
  Simulation.prototype._iadsGeometryWindow = function (shooter, threat) {
    if (!this._iadsCanEngage(shooter, threat)) return null;
    var cacheKey = shooter.id + '|' + threat.type + '|' + threat.axis + '|' + threat.dwellSec;
    var cached = this._geometryWindowCache[cacheKey];
    if (cached !== undefined) {
      return cached === null ? null : {
        firstFire: threat.spawnT + cached.firstFire,
        lastFire: threat.spawnT + cached.lastFire
      };
    }
    var missiles = shooter.engage.missiles || {};
    var shooterPos = { lat: shooter.coord[0], lon: shooter.coord[1], altKm: 0 };
    var firstFire = Infinity, lastFire = -Infinity;
    for (var elapsed = 1; elapsed <= Math.floor(threat.dwellSec); elapsed++) {
      var pos = iadsThreatPosition(threat, threat.spawnT + elapsed);
      var keys = Object.keys(missiles);
      for (var i = 0; i < keys.length; i++) {
        var m = missiles[keys[i]], compat = m.compatibility || {};
        if (!this.iadsSensorPhysics && compat.enabled === false) continue;
        var env = !this.iadsSensorPhysics && compat.engagementEnvelope ? compat.engagementEnvelope : m.engagementEnvelope;
        var speed = !this.iadsSensorPhysics && compat.missileSpeed ? compat.missileSpeed : m.missileSpeed;
        var range = haversineKm(shooterPos, pos), alt = pos.altKm;
        if (range < env.Rmin || range > env.Rmax || alt < env.Hmin || alt > env.Hmax) continue;
        var flyout = range * 1000 / speed;
        if (flyout <= elapsed) {
          var fireAt = elapsed - flyout;
          firstFire = Math.min(firstFire, fireAt);
          lastFire = Math.max(lastFire, fireAt);
        }
      }
    }
    var relative = Number.isFinite(firstFire) ? { firstFire: firstFire, lastFire: lastFire } : null;
    this._geometryWindowCache[cacheKey] = relative;
    return relative === null ? null : {
      firstFire: threat.spawnT + relative.firstFire,
      lastFire: threat.spawnT + relative.lastFire
    };
  };

  /** 종료 시 주원인: 구조→능력→자원→시간 반사실 순서로 실제 해결수단을 판별한다. */
  Simulation.prototype._classifyNativeExitFailure = function (threat, fallback) {
    var ev = threat._failureEvidence || {};
    if (threat.leakReason === 'no_responsible_c2' || ev.no_responsible_c2) return 'no_responsible_c2';
    if (threat.leakReason === 'no_report_path' || ev.no_report_path) return 'no_report_path';
    if (threat.leakReason === 'correlation_failed' || ev.correlation_failed) return 'correlation_failed';
    if (threat.tries > 0) return threat.leakReason === 'missed' ? 'missed' : 'timeout:engage';
    if (ev.fuel_insufficient) return 'fuel_insufficient';
    if (ev.pk_too_low) return 'pk_too_low';

    var eligibleIds = threat._eligibleShooterIds || {};
    var capable = this._nodesInMode().filter(function (n) {
      return n.category === 'shooter' && eligibleIds[n.id] && this._iadsCanEngage(n, threat);
    }, this);
    if (!capable.length) return 'no_capable_weapon';
    var geometryWindows = capable.map(function (n) {
      var window = this._iadsGeometryWindow(n, threat);
      return window ? { shooter: n, window: window } : null;
    }, this).filter(Boolean);
    if (!geometryWindows.length) return 'engagement_geometry_gap';
    var geometry = geometryWindows.map(function (x) { return x.shooter; });

    var armed = geometry.filter(function (n) { return this._iadsAmmo(n.id, this.now) > 0; }, this);
    if (!armed.length) return 'ammo_depleted';
    var available = armed.filter(function (n) {
      var r = this.iadsResources[n.id];
      return r && r.active < r.maxSimultaneous;
    }, this);
    if (!available.length) return 'capacity_full';
    var fireControlled = available.filter(function (n) { return this._iadsFireControlState(n, threat, this.now).ready; }, this);
    var latestFire = geometryWindows.reduce(function (m, x) { return Math.max(m, x.window.lastFire); }, -Infinity);
    if (threat._windowLostAtFire || (threat._firstIadsDecisionT != null && threat._firstIadsDecisionT > latestFire + 3)) {
      return 'window_lost_due_to_c2';
    }
    if (!fireControlled.length) return 'no_fire_control';
    return fallback || 'timeout:c2';
  };

  Simulation.prototype._iadsDecide = function (threat, t, commander) {
    if (!threat.alive || threat.pipelineDead) return;
    if (threat._firstIadsDecisionT == null) threat._firstIadsDecisionT = t;
    if (threat.tries >= this.iadsMaxShots) {
      if (!threat.leakReason) threat.leakReason = 'missed';
      return;
    }
    var shared = this._iadsSharedLocalEngagement(threat, commander, t);
    if (shared) {
      this.global.coordAttempts++;
      this.global.deconflicted++;
      this.global.statusSharing.deconflicted++;
      this._mark(threat, '교전중복해소:MCRC/' + shared.from + '/' + shared.phase, t);
      this._scheduleIadsRetry(threat, commander, shared.freshUntil + 0.5);
      return;
    }
    // ADR-056(역방향): 통합 COP는 양방향이다 — 국지방공(군단 AOC)도 통합 축(KILL_WEB)의
    // 교전을 데이터링크 지연(C2-DL-DLY-01 대표 2초) 후에 본다. As-Is에는 이 가시성이 없다
    // (국지방공은 MCRC 교전을 보지 못함 — 정보 비대칭 보존). 진단 실측: ON 순방향만으로는
    // 잔여 중복이 전부 역방향(KILL_WEB 선발사 → 군단 AOC 후발사)이었다.
    if (this.unifiedEngagementState && commander.axis === 'LOCAL_AD') {
      var copDelay = 2; // C2-DL-DLY-01 datalink 대표 지연(기존 등록 파라미터 재사용)
      var visiblePlan = (threat._iadsPlans || []).find(function (p) {
        return p.commander.axis === 'KILL_WEB' && this._iadsActivePlan(p) &&
          (t - p.createdAt) >= copDelay;
      }, this);
      if (visiblePlan) {
        this.global.coordAttempts++;
        this.global.deconflicted++;
        this.copDeconflicted = (this.copDeconflicted || 0) + 1;
        this._mark(threat, '교전중복해소:COP/' + visiblePlan.issuedByC2Id, t);
        this._scheduleIadsRetry(threat, commander, t + copDelay + 0.5);
        return;
      }
    }
    if (this._iadsPlanBlocks(threat, commander)) {
      this.global.coordAttempts++;
      this.global.deconflicted++;
      return;
    }
    // ADR-058: 승인 계선 — 계획 수립 전에 승인권한을 해소한다. LOCAL_AD 축(ROK 국지방공)에만
    // 적용된다: 다른 한국군 축은 승인권자가 자기 자신으로 해소되어 홉이 없고(§0-(6) 실측),
    // USFK 축은 ADR-036(권한 자동 통합 금지)에 따라 계선 자체를 적용하지 않는다.
    if (this.approvalChain && commander.axis === 'LOCAL_AD') {
      var gate = this._iadsApprovalGate(threat, commander, t);
      if (gate === 'wait' || gate === 'blocked') return;
      // 'granted'/'skip' → 기존 경로 계속
    }
    var self = this, candidates = [], nextAt = Infinity, reasons = {};
    commander.batteryIds.forEach(function (id) {
      var shooter = self._nodeById(id);
      var ev = self._iadsEvaluate(shooter, threat, t);
      if (ev.feasible) {
        var r = self.iadsResources[id], ammoRatio = r.initialAmmo ? ev.ammo / r.initialAmmo : 0;
        var load = r.maxSimultaneous ? r.active / r.maxSimultaneous : 1;
        var priority = Number(shooter.shooterPriority) || 9;
        if (self.nativeWtaMode && self.mode === 'asis') {
          // ADR-059 As-Is: COP 부재 — 무기별 pk·PIP(교전 포락선 적합도)를 비교할 수단이 없다.
          // 관측 가능한 것(자기 탄약·자기 부하)만으로 선택한다. 물리 실현가능성 필터(_iadsEvaluate의
          // canEngage·봉투·FC 게이트)는 선행 적용됨 — 선호 순서만 바뀐다.
          ev.score = ammoRatio * (1 - load) - priority * 0.000001;
          if (self.nativeWtaCostAsis) ev.score *= self._iadsCostTerm(shooter, ev, threat); // 반증 전용
        } else if (self.nativeWtaMode) {
          // ADR-059 To-Be: 현행 물리 점수식 + 비용 인식((1−W)+W·costFit, 탄도 위협 한정 —
          // legacy Step 1의 국한 논리 승계: 고가 낭비는 탄도(하층/상층 요격탄 선택)에서만 발생).
          ev.score = (ev.pk * ammoRatio * (1 - load) / Math.max(1, ev.pip.rangeKm) - priority * 0.000001) *
            self._iadsCostTerm(shooter, ev, threat);
        } else {
          ev.score = ev.pk * ammoRatio * (1 - load) / Math.max(1, ev.pip.rangeKm) - priority * 0.000001;
        }
        ev.shooter = shooter;
        candidates.push(ev);
      } else {
        reasons[ev.reason] = (reasons[ev.reason] || 0) + 1;
        self._recordFailureEvidence(threat, ev.reason, { commanderId: commander.id, shooterId: id });
        if (ev.reason === 'capacity_full' && self.iadsResources[id]) self.iadsResources[id].capacityBlocks++;
        if (Number.isFinite(ev.readyAt)) nextAt = Math.min(nextAt, ev.readyAt);
      }
    });
    candidates.sort(function (a, b) { return b.score - a.score || (a.shooter.id < b.shooter.id ? -1 : 1); });
    if (!candidates.length) {
      if (Number.isFinite(nextAt)) this._scheduleIadsRetry(threat, commander, nextAt);
      else if (!threat.leakReason) threat.leakReason = this._terminalIadsFailure(threat,
        reasons.no_missile_for_threat ? 'no_capable_weapon' : 'no_shooter');
      return;
    }
    var chosen = candidates[0], path = this._iadsShortestPath(commander.id, chosen.shooter.id, ['coord', 'command']);
    if (path === null) {
      if (!threat.leakReason) threat.leakReason = 'responsibility_gap';
      this._metricEvent('RESPONSIBILITY_UNRESOLVED', t, threat, {
        commanderId: commander.id, shooterId: chosen.shooter.id, reason: 'no_command_path'
      });
      return;
    }
    var ledger = threat._c2TrackLedger && threat._c2TrackLedger[commander.id];
    var updates = ledger ? (ledger.sources || []).map(function (source) { return source.lastUpdateAt; })
      .filter(Number.isFinite) : [];
    var lastUpdateAt = updates.length ? Math.max.apply(null, updates) : null;
    var cause = 'commanded', delegationLevel = null;
    if (commander.axis === 'MCRC') cause = 'mcrc_commanded';
    else if (commander.scope === 'icc') { cause = 'delegated_icc'; delegationLevel = 'ICC'; }
    else if (commander.scope === 'self_battery') {
      cause = commander.axis === 'LOCAL_AD' ? 'autonomous' : 'delegated_ecs';
      delegationLevel = 'ECS';
    }
    var geometryWindow = this._iadsGeometryWindow(chosen.shooter, threat);
    if (this.emergencyEngagement && commander.axis === 'LOCAL_AD' && geometryWindow &&
        geometryWindow.lastFire - t <= 30) {
      cause = 'emergency';
    }
    var plan = this._iadsCreatePlan(commander, chosen.shooter.id, t, threat, {
      targetEcsId: chosen.shooter.ecsC2Id || null,
      delegationLevel: delegationLevel,
      launchCause: cause,
      trackLastUpdateAt: lastUpdateAt,
      trackReceivedAt: ledger && ledger.receivedAt,
      validUntil: geometryWindow ? geometryWindow.lastFire + 3 : null
    });
    threat._iadsPlans.push(plan);
    this.global.c2Orders.created++;
    threat._hadIadsPlan = true;
    threat._commandCause = cause; // 구 trace/UI 호환. 실제 발사 귀속은 plan.launchCause가 권위값.
    this._metricEvent('COMMAND_DECIDED', t, threat, {
      nodeId: commander.id, shooterId: chosen.shooter.id, cause: cause,
      directiveId: plan.directiveId, engagementId: plan.engagementId,
      authorityLevel: plan.authorityLevel, delegationLevel: plan.delegationLevel,
      commanderAxis: commander.axis, threatCategory: iadsThreatCategory(threat.type),
      trackLastUpdateAt: lastUpdateAt,
      trackReceivedAt: ledger && Number.isFinite(ledger.receivedAt) ? ledger.receivedAt : null,
      trackAgeSec: Number.isFinite(lastUpdateAt) ? Math.max(0, t - lastUpdateAt) : null,
      trackSourceCount: ledger ? (ledger.sources || []).length : 0,
      trackFused: !!(ledger && ledger.fused)
    });
    this._mark(threat, '사수선정·표적할당:' + commander.typeId + '→' + chosen.shooter.id, t);
    this._mark(threat, '자체교전승인:' + commander.typeId, t);
    this._sendIadsStatus(threat, commander, 'assigned', t);
    var delay = 0;
    path.forEach(function (l) {
      delay += self._linkDelay(l.comm[self.mode]);
      self._recordLink(l.from, l.to, l.comm[self.mode], l.kind);
    });
    this._iadsTransitionPlan(plan, 'in_transit', t);
    this.schedule(t + delay, PRI.LINK_ARRIVE, 'IADS_FIRE', { threat: threat, commander: commander, shooterId: chosen.shooter.id, plan: plan });
  };

  Simulation.prototype._onIadsRetry = function (t, d) {
    if (d.threat._iadsRetryAt) delete d.threat._iadsRetryAt[d.key];
    this._iadsDecide(d.threat, t, d.commander);
  };

  /**
   * ADR-058: 승인 계선 게이트 — legacy `_decision`의 이식.
   * 반환: 'skip'(계선 비대상) | 'granted'(승인 완료/불필요/위임) | 'wait'(홉·서비스 진행 중)
   *       | 'blocked'(협조 경로 부재 → responsibility_gap 확정).
   * 정책 조회는 c2-policy 모듈(KJ.IADS)을 쓰고, 모듈이 없는 compat 실행에서는 동일 데이터
   * (threats.js automation/approvalLevel)를 직접 읽는 동치 폴백을 쓴다.
   */
  Simulation.prototype._iadsApprovalGate = function (threat, commander, t) {
    var key = commander.id + '|' + commander.axis;
    threat._iadsApproval = threat._iadsApproval || {};
    var st = threat._iadsApproval[key];
    if (st === 'granted' || st === 'delegated') return 'granted';
    if (st === 'pending') return 'wait';
    if (st === 'blocked' || st === 'dropped') return 'blocked';
    var tt = KJ.threatType(threat.type);
    var counterfactual = this.approvalChainTobe;
    var policy = (KJ.IADS && KJ.IADS.approvalPolicy)
      ? KJ.IADS.approvalPolicy(tt, this.mode, counterfactual)
      : (function (mode) {
          var pm = counterfactual && mode === 'tobe' ? 'asis' : mode;
          return { auto: tt.automation ? tt.automation[pm] || null : null,
                   approvalRole: tt.approvalLevel ? tt.approvalLevel[pm] || null : null,
                   policyMode: pm };
        })(this.mode);
    var approvalId = policy.approvalRole ? this._resolveRole(policy.approvalRole) : null;
    // 사전승인 자동교전 / 승인권자 부재 / 자기 자신 승인 → 홉·서비스 없음 (legacy 동치)
    if (policy.auto === 'auto-preauth' || !approvalId || approvalId === commander.id || !this.nodeState[approvalId]) {
      threat._iadsApproval[key] = 'granted';
      return 'granted';
    }
    // B-2: 부하 기반 동적 권한위임 — legacy DELEG_QUEUE_MULT(asis 4/tobe 1) 승계.
    // 임계는 정책 모드 기준(반증 실행에서는 asis 임계) — c2-policy.delegationThreshold와 동치.
    var apprNs = this.nodeState[approvalId];
    if (apprNs.busy >= apprNs.c &&
        apprNs.queue.length >= apprNs.c * DELEG_QUEUE_MULT[policy.policyMode]) {
      this.deleg.count++;
      if (this.deleg.firstT === null) this.deleg.firstT = t;
      this.deleg.byNode[approvalId] = (this.deleg.byNode[approvalId] || 0) + 1;
      this._mark(threat, '권한위임:' + approvalId, t);
      threat._iadsApproval[key] = 'delegated';
      return 'granted';
    }
    if (policy.auto === 'human-on-loop') {
      // 감독하 자동교전: 협조 홉 생략, 승인권자 서비스만 (legacy 동치)
      threat._iadsApproval[key] = 'pending';
      this._mark(threat, '감독승인개시:' + approvalId, t);
      this.schedule(t, PRI.LINK_ARRIVE, 'IADS_APPROVE_ARRIVE',
        { threat: threat, commander: commander, appr: approvalId, key: key });
      return 'wait';
    }
    // human-in-loop: coord 협조 홉(다익스트라 최소지연) → 승인 서비스
    var path = this._iadsShortestPath(commander.id, approvalId, ['coord']);
    if (path === null) {
      if (!threat.leakReason) threat.leakReason = 'responsibility_gap';
      this._recordFailureEvidence(threat, 'responsibility_gap',
        { commanderId: commander.id, approvalId: approvalId, reason: 'no_coordination_path' });
      this._metricEvent('RESPONSIBILITY_UNRESOLVED', t, threat, {
        fromC2Id: commander.id, toC2Id: approvalId, reason: 'no_coordination_path'
      });
      threat._iadsApproval[key] = 'blocked';
      return 'blocked';
    }
    var self = this, delay = 0;
    path.forEach(function (l) {
      delay += self._linkDelay(l.comm[self.mode]);
      self._recordLink(l.from, l.to, l.comm[self.mode], 'coord');
    });
    // 결심지연 분해(legacy 1B 동치): coord 협조 홉 몫 누적 → meanCoordDelaySec
    threat._coordDelay = (threat._coordDelay || 0) + delay;
    threat._iadsApproval[key] = 'pending';
    this._mark(threat, '협조개시:' + commander.id + '→' + approvalId, t);
    this.schedule(t + delay, PRI.LINK_ARRIVE, 'IADS_APPROVE_ARRIVE',
      { threat: threat, commander: commander, appr: approvalId, key: key });
    return 'wait';
  };

  Simulation.prototype._onIadsApproveArrive = function (t, d) {
    var self = this, threat = d.threat;
    if (!threat.alive || threat.pipelineDead) return;
    var disp = this._nodeArrive(d.appr, t, { threat: threat, kind: 'approval' }, function (t2, job) {
      self._mark(job.threat, '승인완료:' + d.appr, t2);
      job.threat._iadsApproval[d.key] = 'granted';
      self._iadsDecide(job.threat, t2, d.commander);
    });
    if (disp === 'dropped') {
      // native 다계통 구조: 승인 요청 드롭은 해당 축(LOCAL_AD)의 교전 기회 상실로 한정한다
      // (_nodeArrive의 approval branch-local 처리). 실패 증거로 계상.
      threat._iadsApproval[d.key] = 'dropped';
      this._recordFailureEvidence(threat, 'approval_dropped',
        { commanderId: d.commander.id, approvalId: d.appr });
    }
  };

  Simulation.prototype._onIadsFire = function (t, d) {
    var threat = d.threat, plan = d.plan, shooter = this._nodeById(d.shooterId);
    if (!threat.alive || plan.released || plan.resolved) return;
    var resource = this.iadsResources[shooter.id];
    if (!d.receptionComplete && this.commandReceptionQueue &&
        plan.targetEcsId && this.nodeState[plan.targetEcsId]) {
      var self = this;
      this._iadsTransitionPlan(plan, 'received', t);
      this.global.c2Orders.received++;
      var disposition = this._nodeArrive(plan.targetEcsId, t, {
        threat: threat,
        kind: 'directive_reception',
        jobId: plan.directiveId,
        directiveId: plan.directiveId,
        validUntil: plan.validUntil,
        onServiceStart: function (startedAt) {
          self._iadsTransitionPlan(plan, 'acknowledged', startedAt);
          self.global.c2Orders.acknowledged++;
        },
        onAbandon: function (abandonedAt) {
          if (plan.released || plan.resolved) return;
          self._iadsTransitionPlan(plan, 'expired', abandonedAt, 'released', 'queue_deadline');
          self.global.c2Orders.expired++;
          self.global.c2Orders.released++;
          self.global.c2Orders.expiryByReason.queue_deadline =
            (self.global.c2Orders.expiryByReason.queue_deadline || 0) + 1;
          self._recordFailureEvidence(threat, 'window_lost_due_to_c2', {
            commanderId: d.commander.id, shooterId: shooter.id, phase: 'directive-queue'
          });
          self._sendIadsStatus(threat, d.commander, 'released', abandonedAt);
          self._scheduleIadsRetry(threat, d.commander, abandonedAt + 0.5);
        }
      }, function (done) {
        if (!threat.alive || plan.released || plan.resolved) {
          if (!plan.resolved) {
            self._iadsTransitionPlan(plan, 'cancelled', done, 'released', 'threat_resolved_before_activation');
            self.global.c2Orders.cancelled++;
            self.global.c2Orders.released++;
          }
          return;
        }
        self._iadsTransitionPlan(plan, 'active', done);
        self._onIadsFire(done, Object.assign({}, d, { receptionComplete: true }));
      });
      if (disposition === 'dropped') {
        this._iadsTransitionPlan(plan, 'expired', t, 'released', 'queue_capacity');
        this.global.c2Orders.expired++;
        this.global.c2Orders.released++;
        this.global.c2Orders.expiryByReason.queue_capacity =
          (this.global.c2Orders.expiryByReason.queue_capacity || 0) + 1;
        this._recordFailureEvidence(threat, 'capacity_full', {
          commanderId: d.commander.id, shooterId: shooter.id, phase: 'directive-queue'
        });
        this._sendIadsStatus(threat, d.commander, 'released', t);
        this._scheduleIadsRetry(threat, d.commander, t + 0.5);
      }
      return;
    }
    if (!d.receptionComplete) {
      this._iadsTransitionPlan(plan, 'received', t);
      this.global.c2Orders.received++;
      this._iadsTransitionPlan(plan, 'acknowledged', t);
      this.global.c2Orders.acknowledged++;
      this._iadsTransitionPlan(plan, 'active', t);
    }
    if (resource) resource.commandArrivals++;
    if (Number.isFinite(plan.validUntil) && t > plan.validUntil) {
      this._iadsTransitionPlan(plan, 'expired', t, 'released', 'window_closed');
      this.global.c2Orders.expired++;
      this.global.c2Orders.released++;
      this.global.c2Orders.expiryByReason.window_closed =
        (this.global.c2Orders.expiryByReason.window_closed || 0) + 1;
      this._recordFailureEvidence(threat, 'window_lost_due_to_c2', {
        commanderId: d.commander.id, shooterId: shooter.id, phase: 'directive-arrival'
      });
      this._sendIadsStatus(threat, d.commander, 'released', t);
      return;
    }
    if (this.iadsSensorPhysics && shooter.mfrSensorId) {
      KJ.IADS.overrideCorrelationCorrect(this.iadsCorrelationStates, shooter.mfrSensorId, threat.id,
        this.mode === 'tobe' ? 'killweb' : 'linear');
    }
    var shared = this._iadsSharedLocalEngagement(threat, d.commander, t);
    if (shared) {
      this._iadsTransitionPlan(plan, 'cancelled', t, 'released', 'coordination_deconflicted');
      this.global.c2Orders.cancelled++;
      this.global.c2Orders.released++;
      this.global.coordAttempts++;
      this.global.deconflicted++;
      this.global.statusSharing.deconflicted++;
      this._mark(threat, '사격직전중복해소:MCRC/' + shared.from, t);
      this._scheduleIadsRetry(threat, d.commander, shared.freshUntil + 0.5);
      return;
    }
    // 서로 독립인 ROK/local/USFK plan이 같은 시각에 생성돼도 실제 발사는 표적당 교리 상한을
    // 공유한다. 상한을 넘는 plan은 탄약을 소모하지 않고 해제한다.
    if (threat.tries >= this.iadsMaxShots) {
      this._iadsTransitionPlan(plan, 'expired', t, 'released', 'shot_limit');
      this.global.c2Orders.expired++;
      this.global.c2Orders.expiryByReason.shot_limit =
        (this.global.c2Orders.expiryByReason.shot_limit || 0) + 1;
      this.global.c2Orders.released++;
      this._sendIadsStatus(threat, d.commander, 'released', t);
      if (!threat.leakReason) threat.leakReason = 'missed';
      return;
    }
    var ev = this._iadsEvaluate(shooter, threat, t);
    if (!ev.feasible) {
      this._recordFailureEvidence(threat, ev.reason, { commanderId: d.commander.id, shooterId: shooter.id, phase: 'fire-command' });
      if (ev.reason === 'no_feasible_pip') threat._windowLostAtFire = true;
      if (resource && ev.reason === 'capacity_full') resource.capacityBlocks++;
      this._iadsTransitionPlan(plan, 'released', t, 'released');
      this.global.c2Orders.released++;
      this._sendIadsStatus(threat, d.commander, 'released', t);
      this._scheduleIadsRetry(threat, d.commander, ev.readyAt || t + 1);
      return;
    }
    var launcher = resource.launchers.filter(function (l) { return l.reloadCompleteAt === null && l.remaining > 0; })
      .sort(function (a, b) { return b.remaining - a.remaining || (a.id < b.id ? -1 : 1); })[0];
    if (!launcher) {
      this._iadsTransitionPlan(plan, 'released', t, 'released');
      this.global.c2Orders.released++;
      this._sendIadsStatus(threat, d.commander, 'released', t);
      this._scheduleIadsRetry(threat, d.commander, t + 1);
      return;
    }

    var otherFiredPlan = (threat._iadsPlans || []).find(function (p) { return p !== plan && p.fired && !p.resolved; });
    var otherFired = !!otherFiredPlan;
    if (otherFired) {
      this.global.coordAttempts++;
      this.global.coordGaps++;
      this._metricEvent('COORDINATION_FAILED', t, threat, {
        phase: 'fire_commit', commanderAxis: d.commander.axis,
        otherCommanderAxis: otherFiredPlan.commander.axis, reason: 'stale_or_unshared_engagement_state'
      });
      this.global.duplicateEngagements++;
      this.global.realDuplicateEngagements++;
      var axes = [d.commander.axis, otherFiredPlan.commander.axis];
      if (axes.indexOf('MCRC') !== -1 && axes.indexOf('LOCAL_AD') !== -1) {
        this.global.statusSharing.duplicatesDueToStaleState++;
      }
    }
    this._iadsTransitionPlan(plan, 'committed', t);
    this.global.c2Orders.committed++;
    this._iadsTransitionPlan(plan, 'executing', t, 'fired');
    this.global.c2Orders.fired++;
    var fireControlTrack = shooter.mfrSensorId && threat._sensorTracks
      ? threat._sensorTracks[shooter.mfrSensorId] : null;
    var fireControlTrackAge = fireControlTrack && Number.isFinite(fireControlTrack.lastUpdateAt)
      ? Math.max(0, t - fireControlTrack.lastUpdateAt) : null;
    this._metricEvent('ENGAGEMENT_FIRED', t, threat, {
      shooterId: shooter.id,
      launcherId: launcher.id,
      cause: plan.launchCause || 'commanded',
      directiveId: plan.directiveId,
      engagementId: plan.engagementId,
      authorityLevel: plan.authorityLevel,
      delegationLevel: plan.delegationLevel,
      commanderAxis: d.commander.axis,
      threatCategory: iadsThreatCategory(threat.type),
      trackLastUpdateAt: plan.trackLastUpdateAt,
      trackReceivedAt: plan.trackReceivedAt,
      trackAgeSec: Number.isFinite(plan.trackLastUpdateAt) ? Math.max(0, t - plan.trackLastUpdateAt) : null,
      fireControlTrackAgeSec: fireControlTrackAge,
      fireControlState: fireControlTrack && fireControlTrack.state,
      fireControlConfidence: fireControlTrack && fireControlTrack.confidence
    });
    this.global.c2Orders.fireByCause[plan.launchCause || 'unattributed'] =
      (this.global.c2Orders.fireByCause[plan.launchCause || 'unattributed'] || 0) + 1;
    this._sendIadsStatus(threat, d.commander, 'fired', t);
    this._advanceIadsResource(resource, t);
    resource.active++;
    resource.peakActive = Math.max(resource.peakActive, resource.active);
    resource.shots++;
    launcher.remaining--;
    if (launcher.remaining === 0 && launcher.capacity > 0) {
      launcher.reloadCompleteAt = t + resource.reloadSec;
      this.schedule(launcher.reloadCompleteAt, PRI.SERVICE_END, 'IADS_RELOAD', { shooterId: shooter.id, launcherId: launcher.id });
    }

    this.global.engaged++;
    this.global.shotsFired++;
    if (!threat._countedEngaged) {
      threat._countedEngaged = true;
      this.global.everEngaged++;
      this.global.engagedThreatValueM += KJ.threatType(threat.type).unitCostM || 0;
      this.global.timeToEngage.push(t - threat.spawnT);
      if (threat._detectT != null) {
        this.decisionDelaySum += t - threat._detectT; this.decisionDelayCount++;
        this.coordDelaySum += (threat._coordDelay || 0); // ADR-058: 협조 홉 몫(OFF에서는 항상 0)
      }
    }
    var cps = (ev.missile && ev.missile.costPerShot) || (shooter.engage && shooter.engage.costPerShotM) || 0;
    this.cost.interceptM += cps;
    if (otherFired) this.cost.duplicateInterceptM += cps;
    if (SAT_THREATS[threat.type]) this.cost.interceptSatM += cps;
    // 고가유도탄 보존율 분자 — legacy _onEngageEnd에만 배선되어 native 실행에서 항상 100%로
    // 나오던 결함 수정. 임계·정의는 legacy와 동일(HIGH_VALUE_COST_M, KJADS 5-1).
    if (cps >= HIGH_VALUE_COST_M) this.global.highValueInterceptM += cps;
    threat.tries++;
    var hit = this.rng.raw() < ev.pk;
    this._mark(threat, '발사:' + shooter.id + '/' + launcher.id + '/PIP' + ev.pip.rangeKm.toFixed(1) + 'km', t);
    this._iadsTransitionPlan(plan, 'bda_pending', t, 'bda_pending');
    this.schedule(t + ev.pip.flyout, PRI.SERVICE_END, 'IADS_BDA', {
      threat: threat, commander: d.commander, shooterId: shooter.id, plan: plan,
      hit: hit, pk: ev.pk, launcherId: launcher.id
    });
  };

  Simulation.prototype._onIadsBda = function (t, d) {
    var threat = d.threat, plan = d.plan, resource = this.iadsResources[d.shooterId];
    if (resource) {
      this._advanceIadsResource(resource, t);
      resource.active = Math.max(0, resource.active - 1);
      resource.completions++;
    }
    if (!threat.alive) {
      this._iadsTransitionPlan(plan, 'released', t, 'released');
      this.global.c2Orders.released++;
      return;
    }
    if (d.hit) {
      this._iadsTransitionPlan(plan, 'hit', t, 'hit');
      this.global.c2Orders.hit++;
      this.global.c2Orders.released++;
      threat.alive = false; threat.killed = true;
      this.global.killed++;
      this.global.timeToKill.push(t - threat.spawnT);
      var value = KJ.threatType(threat.type).unitCostM || 0;
      this.cost.killedThreatM += value;
      if (SAT_THREATS[threat.type]) this.cost.killedThreatSatM += value;
      this._mark(threat, 'BDA:HIT:' + d.shooterId, t);
      this._metricEvent('INTERCEPT_HIT', t, threat, {
        shooterId: d.shooterId, directiveId: plan.directiveId, engagementId: plan.engagementId
      });
      this._sendIadsStatus(threat, d.commander, 'resolved_hit', t);
      if (threat._trace) { threat._trace.exitT = t; threat._trace.outcome = 'killed'; }
    } else {
      this._iadsTransitionPlan(plan, 'miss', t, 'miss');
      this.global.c2Orders.miss++;
      this.global.c2Orders.released++;
      this._mark(threat, 'BDA:MISS:' + d.shooterId, t);
      this._metricEvent('INTERCEPT_MISS', t, threat, {
        shooterId: d.shooterId, directiveId: plan.directiveId, engagementId: plan.engagementId
      });
      this._sendIadsStatus(threat, d.commander, 'released', t);
      if (threat.tries < this.iadsMaxShots) this._scheduleIadsRetry(threat, d.commander, t + 0.5);
      else if (!threat.leakReason) threat.leakReason = 'missed';
    }
  };

  Simulation.prototype._onIadsReload = function (t, d) {
    this._iadsRefreshLaunchers(d.shooterId, t);
  };

  Simulation.prototype._pk = function (shooter, threat) {
    if (!this.features.pkByShooter) return this._pkLegacy(shooter, threat);
    var spec = shooter.engage && shooter.engage.pk;
    var dist = (spec && spec.byThreat && spec.byThreat[threat.type]) || (spec && spec.default);
    if (!dist) {
      // params.md에 문서화된 pk 없음 → legacy 폴백(현행 위협별 값) + 조합 기록(값 지어내지 않음).
      this.global.pkFallback[shooter.id + '×' + threat.type] = (this.global.pkFallback[shooter.id + '×' + threat.type] || 0) + 1;
      return this._pkLegacy(shooter, threat);
    }
    var pk = this.rng.triangular(dist.min, dist.mode, dist.max);
    return Math.max(0, Math.min(1, pk * this.mult.pk));
  };

  /** legacy 요격확률(stage9 이전 동작). pkByShooter=false 또는 문서값 부재 시 사용 — 되돌리기 경로. */
  Simulation.prototype._pkLegacy = function (shooter, threat) {
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
    // ADR-063: 표적권역 산포 — ON일 때만 전용 스트림에서 2개 뽑아 착탄점을 정한다.
    // OFF면 threat.target이 undefined이고 위치 계산은 종전처럼 축선 표적점을 쓴다(bit-exact).
    var impact = this.threatTargetDispersion
      ? KJ.axisImpactPoint(entry.axis, this.dispRng.raw(), this.dispRng.raw(), this.targetSpreadKm)
      : null;
    var threat = {
      id: entry.type + '#' + this.threatSeq, type: entry.type, axis: entry.axis,
      target: impact || undefined,
      spawnT: t, dwellSec: tt.dwellSec, alive: true, killed: false,
      detected: false, pipelineDead: false, tries: 0, leakReason: null,
      _frailty: null, // Phase 5(pkCorrelated): 표적별 공유 잠재(재교전 상관) — ON일 때 최초 교전에서 지연 추출
      _trace: null, _countedC2: false, _countedEngaged: false, _detectT: null, _coordDelay: 0,
      _failureEvidence: {}, _hadIadsPlan: false,
      _iadsPhysical: this.iadsSensorPhysics, ecmActive: this.iadsSensorPhysics && this.ecmActive,
      _iadsAxisDistanceKm: null
    };
    this._metricEvent('THREAT_SPAWNED', t, threat, { threatType: threat.type, axis: threat.axis });
    if (this.trace) {
      if (this.threatTraces.length < this.traceCap) {
        threat._trace = {
          id: threat.id, type: threat.type, axis: threat.axis,
          spawnT: t, exitT: null, outcome: null, stages: [{ name: '생성', t: t }]
        };
        // ADR-063: 산포 ON일 때만 착탄점을 trace에 노출한다(지도 애니메이션·검증용).
        if (impact) threat._trace.target = impact;
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
      var next = t + this.arrRng.exponential(1 / ratePerSec); // 도착 전용 스트림(CRN) — 모드 불변
      if (next <= this.endTime) this.schedule(next, PRI.SPAWN, 'SPAWN', { entry: entry });
    }
  };

  Simulation.prototype._recordFinalFailure = function (threat, reason) {
    var tax = KJ.leakTaxonomy(reason);
    this.global.failurePrimary[reason] = (this.global.failurePrimary[reason] || 0) + 1;
    var family = tax.family || 'unknown';
    var structurality = tax.structurality || (tax.structural ? 'structural' : 'nonstructural');
    this.global.failureFamilies[family] = (this.global.failureFamilies[family] || 0) + 1;
    this.global.failureStructurality[structurality] = (this.global.failureStructurality[structurality] || 0) + 1;
    Object.keys(threat._failureEvidence || {}).forEach(function (code) {
      if (code === reason) return;
      this.global.failureContributors[code] = (this.global.failureContributors[code] || 0) + 1;
    }, this);
    if (threat._trace) {
      threat._trace.failure = {
        primaryCause: reason,
        contributors: Object.keys(threat._failureEvidence || {}).filter(function (code) { return code !== reason; }),
        family: family, structurality: structurality
      };
    }
  };

  Simulation.prototype._onExit = function (t, d) {
    var threat = d.threat;
    if (!threat.alive) return; // 이미 격추
    threat.alive = false;
    if (this.nativeIads) {
      (threat._iadsPlans || []).forEach(function (plan) {
        if (!plan.fired && !plan.released && !plan.resolved) {
          this._iadsTransitionPlan(plan, 'cancelled', t, 'released', 'threat_exited_before_activation');
          this.global.c2Orders.cancelled++;
          this.global.c2Orders.released++;
        }
      }, this);
    }
    this.global.leaked++;
    // Phase 4(⑨, timeoutSplit): timeout을 tries로 분해. tries===0(한 번도 교전 못 함)=timeout:c2
    // (앞단 C2·협조가 시간을 소진 → 구조적), tries>0(교전했으나 체공창 소진)=timeout:engage(교전·BDA
    // 단계 물리 한계 → 비구조). 동일 물리 현상이 구조/비구조로 뭉뚱그려지던 결함(사실 e) 해소.
    var fallbackReason = threat.leakReason ||
      (!threat.detected ? 'not_detected'
        : (this.features.timeoutSplit ? (threat.tries > 0 ? 'timeout:engage' : 'timeout:c2') : 'timeout'));
    var reason = this.nativeIads ? this._classifyNativeExitFailure(threat, fallbackReason) : fallbackReason;
    // Phase 2: 협조 실패(책임공백)를 겪은 항적이 결국 누수하면, 일반 사유(명중실패·처리지연)보다
    // 구조적 원인(responsibility_gap)이 근본 원인이다 → 사유 승격(死 코드 부활, taxonomy 정합).
    if (threat._hadCoordGap && (reason === 'missed' || reason.indexOf('timeout') === 0)) reason = 'responsibility_gap';
    this.global.leakReasons[reason] = (this.global.leakReasons[reason] || 0) + 1;
    if (this.c2Analysis) {
      var evidenceCodes = Object.keys(threat._failureEvidence || {});
      var hadGeometryWindow = false;
      if (this.nativeIads) {
        var eligible = threat._eligibleShooterIds || {};
        hadGeometryWindow = this._nodesInMode().some(function (node) {
          return node.category === 'shooter' && eligible[node.id] &&
            !!this._iadsGeometryWindow(node, threat);
        }, this);
      }
      this._metricEvent('THREAT_LEAKED', t, threat, {
        reason: reason,
        detected: !!threat.detected,
        tries: threat.tries,
        hadDirective: !!threat._hadIadsPlan,
        hadGeometryWindow: hadGeometryWindow,
        failureContributors: evidenceCodes
      });
    }
    if (this.nativeIads) this._recordFinalFailure(threat, reason);
    // Phase 2(⑨, leakCost): 누수 위협의 가치를 계상 → defenseEfficiency 분모. 순수 관측(rng·이벤트 불변).
    // "안 쏘면 exchange=0 최적"의 함정을 반전: 누수가 많으면 방어효율이 낮아진다.
    if (this.features.leakCost) {
      var lv = KJ.threatType(threat.type).unitCostM || 0;
      this.cost.leakedThreatM += lv;
      if (SAT_THREATS[threat.type]) this.cost.leakedThreatSatM += lv;
    }
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
      var first = self.arrRng.exponential(1 / ratePerSec); // 도착 전용 스트림(CRN) — 모드 불변
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
    // trace 마감(CRN 검토 이식): 관측창 종료 시점에도 결말(격추/누수)이 미확정인 항적은
    // "진행중" 마커로 종결한다. exitT는 설정하지 않아(=null 유지) 누수로 오분류되지 않는다.
    if (this.trace) {
      this.threatTraces.forEach(function (tr) {
        if (tr.exitT === null) tr.stages.push({ name: '관측종료(진행중)', t: self.endTime });
      });
    }
    return this._results();
  };

  Simulation.prototype._dispatch = function (ev) {
    switch (ev.type) {
      case 'SPAWN': this._spawn(ev.t, ev.data); break;
      case 'IADS_SENSOR_SCAN': this._onIadsSensorScan(ev.t, ev.data); break;
      case 'IADS_C2_ARRIVE': this._onIadsC2Arrive(ev.t, ev.data); break;
      case 'IADS_RETRY': this._onIadsRetry(ev.t, ev.data); break;
      case 'IADS_FIRE': this._onIadsFire(ev.t, ev.data); break;
      case 'IADS_BDA': this._onIadsBda(ev.t, ev.data); break;
      case 'IADS_RELOAD': this._onIadsReload(ev.t, ev.data); break;
      case 'IADS_STATUS_ARRIVE': this._onIadsStatusArrive(ev.t, ev.data); break;
      case 'IADS_APPROVE_ARRIVE': this._onIadsApproveArrive(ev.t, ev.data); break;
      case 'SERVICE_END': this._onServiceEnd(ev.t, ev.data); break;
      case 'EXIT': this._onExit(ev.t, ev.data); break;
    }
  };

  // ── 결과·병목 도출 ──
  Simulation.prototype._results = function () {
    var self = this, T = this.endTime;
    if (this.nativeIads) {
      Object.keys(this.iadsResources).forEach(function (id) { self._advanceIadsResource(self.iadsResources[id], T); });
    }
    var nodes = Object.keys(this.nodeState).map(function (id) {
      var ns = self.nodeState[id];
      var ir = self.nativeIads && self.iadsResources[id] ? self.iadsResources[id] : null;
      var rho = ir ? ir.activeTime / (ir.maxSimultaneous * T) : ns.busyTime / (ns.c * T);
      var Lq = ns.qTime / T;
      var Wq = ns.waitCount ? ns.waitAccum / ns.waitCount : 0;
      var observedArrivals = ir ? ir.commandArrivals : ns.arrivals;
      var observedDrops = ir ? ir.capacityBlocks : ns.drops;
      var level = 'idle';
      if (observedArrivals > 0) {
        if (observedDrops > 0) level = 'saturated';
        else if (rho >= RHO_BOTTLENECK) level = 'bottleneck';
        else if (rho >= RHO_WARN) level = 'warn';
        else level = 'normal';
      }
      // ── kind별 분해(track/approval/engage) — 기존 필드는 전체 합계로 그대로 유지, 추가만 ──
      // C2 서버풀이 ③④⑤(track)과 ⑥⑦(approval)에 공유되므로, 카드가 자기 단계만 보게 하려면
      // 노드 통계를 kind로 쪼갠 값이 필요하다. 부재 kind는 0(빈 버킷)으로 노출한다.
      // native 고해상도는 항적처리를 kind='iads_track', 명령수신을 'directive_reception'으로
      // 태깅한다. 3종만 노출하면 고해상도 실행에서 ③④⑤ 카드의 ρ/Wq/드롭이 전부 0으로 보여
      // 병목 진단이 무력화된다(노드 ρ는 0.9인데 분해값은 0). 고해상도에서만 키를 추가해
      // legacy wire shape(Phase 0 SHA)는 그대로 보존한다.
      var kindKeys = self.highResolutionDeployment
        ? ['track', 'approval', 'engage', 'iads_track', 'directive_reception']
        : ['track', 'approval', 'engage'];
      var rhoByKind = {}, arrivalsByKind = {}, dropsByKind = {}, WqByKind = {};
      kindKeys.forEach(function (k) {
        var b = ns.byKind[k];
        rhoByKind[k] = b ? b.busyTime / (ns.c * T) : 0;
        arrivalsByKind[k] = b ? b.arrivals : 0;
        dropsByKind[k] = b ? b.drops : 0;
        WqByKind[k] = (b && b.waitCount) ? b.waitAccum / b.waitCount : 0;
      });
      var nodeResult = {
        id: id, name: ns.node.name, category: ns.node.category,
        c: ns.c, K: ns.K, meanSec: ns.mean,
        arrivals: observedArrivals,
        completions: ir ? ir.completions : ns.completions,
        drops: observedDrops,
        rho: rho, Lq: Lq, Wq: Wq, maxInSystem: ns.maxInSystem, level: level,
        rhoByKind: rhoByKind, arrivalsByKind: arrivalsByKind,
        dropsByKind: dropsByKind, WqByKind: WqByKind,
        // 자원최적화 Step 2: 잔여 유도탄 비율·첫 소진 시각·보존 발동 횟수(magazine ON일 때만 유의).
        ammo: self.nativeIads && self.iadsResources[id] ? self._iadsAmmo(id, T) : (isFinite(ns.ammo) ? ns.ammo : null),
        ammoRatio: self.nativeIads && self.iadsResources[id]
          ? (self.iadsResources[id].initialAmmo > 0 ? self._iadsAmmo(id, T) / self.iadsResources[id].initialAmmo : 0)
          : ((isFinite(ns.ammo) && isFinite(ns.magazine0) && ns.magazine0 > 0) ? ns.ammo / ns.magazine0 : null),
        ammoDepletedT: ns.ammoDepletedT, reserveTriggers: ns.reserveTriggers
      };
      if (ir) {
        nodeResult.shots = ir.shots;
        nodeResult.peakActive = ir.peakActive;
        nodeResult.maxSimultaneous = ir.maxSimultaneous;
        nodeResult.capacityBlocks = ir.capacityBlocks;
      }
      return nodeResult;
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
            (r.capacityBlocks > 0 ? ' · 용량차단 ' + r.capacityBlocks + '건 — 동시교전 채널 초과' :
              (r.drops > 0 ? ' · 드롭(포화손실) ' + r.drops + '건 — 처리용량 초과' :
              ' · 평균대기 ' + r.Wq.toFixed(1) + '초 — 임계 초과')
            )
        });
      }
    });
    links.forEach(function (r) {
      if (r.isCommBottleneck) {
        bottlenecks.push({
          kind: 'link', severity: 2, id: r.from + '→' + r.to,
          name: (self._nodeById(r.from) ? self._nodeById(r.from).name : r.from) + ' → ' +
            (self._nodeById(r.to) ? self._nodeById(r.to).name : r.to),
          detail: r.type + ' 지연 ' + r.delaySec + '초 × ' + r.perMin.toFixed(2) + '건/분'
        });
      }
    });
    // 고해상도는 주원인 taxonomy의 structural 전체를 공백 병목으로 승격한다.
    // legacy/OFF는 Phase 0 wire hash 보존을 위해 종전 3종 gapMap을 그대로 사용한다.
    var legacyGapMap = { no_sensor: '탐지 공백', no_shooter: '교전수단 부재(제약)', responsibility_gap: '책임공백(협조경로 부재)' };
    Object.keys(this.global.leakReasons).forEach(function (reason) {
      var tax = KJ.leakTaxonomy(reason);
      var include = self.highResolutionDeployment ? tax.structural : !!legacyGapMap[reason];
      if (include) {
        bottlenecks.push({
          kind: 'gap', severity: 3, id: reason,
          name: self.highResolutionDeployment ? tax.label : legacyGapMap[reason],
          detail: self.highResolutionDeployment
            ? '누수 ' + self.global.leakReasons[reason] + '건 (' + tax.family + ' · ' + tax.structurality + ')'
            : '누수 ' + self.global.leakReasons[reason] + '건 (구조적 원인)'
        });
      }
    });
    bottlenecks.sort(function (a, b) { return b.severity - a.severity; });

    var ttk = this.global.timeToKill;
    var meanTTK = ttk.length ? ttk.reduce(function (s, x) { return s + x; }, 0) / ttk.length : 0;
    var tte = this.global.timeToEngage;
    var meanTTE = tte.length ? tte.reduce(function (s, x) { return s + x; }, 0) / tte.length : 0;
    // Phase 3(⑨, censorFix): 종료 절단 보정. censoredRaw = 종료시각까지 미해결(격추·누수 아님)한
    // 위협 = spawned − killed − leaked(잔존). 이들은 관측창에 잘려 EXIT가 안 뜬 것인데 spawned(분모)에
    // 남아 격추율·누수율을 체계적으로 왜곡한다(①단계 탐지율 절단과 같은 뿌리). 순수 보고 변경 —
    // 시뮬레이션 동역학·rng·이벤트 불변. flow 보존(spawned ≥ killed+leaked)은 그대로 유지된다.
    var censoredRaw = Math.max(0, this.global.spawned - this.global.killed - this.global.leaked);
    var censored = this.features.censorFix ? censoredRaw : 0;
    this.global.censored = censored;
    var denom = this.global.spawned - censored; // censorFix ON → killed+leaked(해결분), OFF → spawned(legacy)
    var spawnedDenom = this.global.spawned;
    var resolvedDenom = this.global.killed + this.global.leaked;

    var resultConfig = {
        scenario: this.scenario.id, mode: this.mode,
        intensity: this.intensity, seed: this.seed, endTimeSec: this.endTime
      };
    if (this.highResolutionDeployment) {
      resultConfig.deploymentId = this.deploymentId;
      resultConfig.compatibilityMode = this.catalog.compatibilityMode;
    }
    if (this.iadsSensorPhysics) {
      resultConfig.modelFidelity = this.modelFidelity;
      resultConfig.modelRevision = KJ.IADS.MODEL_REVISION;
      resultConfig.jammingLevel = this.jammingLevel;
      resultConfig.ecmActive = this.ecmActive;
    }
    var result = {
      config: resultConfig,
      eventCount: this.eventCount,
      nodes: nodes, links: links, bottlenecks: bottlenecks,
      global: {
        spawned: this.global.spawned, detected: this.global.detected,
        engaged: this.global.engaged, killed: this.global.killed, leaked: this.global.leaked,
        reachedC2: this.global.reachedC2, everEngaged: this.global.everEngaged,
        leakReasons: this.global.leakReasons,
        // 절단 보정(censorFix): 분모 = spawned − censored. OFF면 censored=0 → 종전과 동일(killed/spawned).
        killRate: denom ? this.global.killed / denom : 0,
        leakRate: denom ? this.global.leaked / denom : 0,
        censored: censored, censoredRaw: censoredRaw, // 절단 위협 수(보정 적용분 · 원시 관측분)
        meanTimeToKillSec: meanTTK,
        // Phase 7(⑨): meanTTK는 "격추 성공분에만" 조건화된 평균 → 생존자 편향(survivor bias). To-Be가
        // As-Is가 놓치던 어려운(느린) 표적까지 격추하면 meanTTK가 오히려 커져 "느려 보이는" 선택효과가
        // 생긴다. 조건 분모(killed 수)를 함께 노출해 조건부 평균임을 드러낸다(As-Is↔To-Be 단순비교 경고).
        meanTimeToKillN: ttk.length, // meanTTK가 평균 낸 표본 수(=격추 성공 수) — 생존자 편향 가시화
        // Phase 7(⑨): 교전당 발사수 = 총 발사수/최초교전 표적수. salvo·재교전으로 1발을 넘는 발사 부담을 노출.
        shotsFired: this.global.shotsFired,
        shotsPerEngagement: this.global.everEngaged ? this.global.shotsFired / this.global.everEngaged : 0,
        // 자원최적화 Step 1: 고가유도탄 보존율(MoFE, KJADS 5-1 직접지표) = 1 − 고가($≥5M)소모/전체소모.
        // 높을수록 고가 자산 보존. · 위협등급 대비 요격탄 단가 비율 = 총요격탄가/교전위협가치(격추 무관).
        highValuePreservation: this.cost.interceptM > 0
          ? 1 - this.global.highValueInterceptM / this.cost.interceptM : 1,
        interceptPerThreatValue: this.global.engagedThreatValueM > 0
          ? this.cost.interceptM / this.global.engagedThreatValueM : null,
        highValueInterceptM: this.global.highValueInterceptM,
        engagedThreatValueM: this.global.engagedThreatValueM,
        // 교전지연(MoP): 생성→최초 교전명령 평균(초) — 탐지 잠복+결심 포함 end-to-end (CRN 검토 이식)
        meanTimeToEngageSec: meanTTE,
        // 결심 지연(MoP): 탐지→최초 교전명령 평균(초) — 협조/승인/위임 지연 포함
        meanDecisionDelaySec: this.decisionDelayCount
          ? this.decisionDelaySum / this.decisionDelayCount : 0,
        // 1B: 결심지연 중 coord 협조 홉 지연 평균(동일 분모). 잔여(결심지연−협조)=C2 처리·승인 대기·서비스.
        // "As-Is 지연=음성 협조 탓"이 절반만 맞고 나머지는 승인권자 대기행렬임을 분해해 보여준다(사실 g).
        meanCoordDelaySec: this.decisionDelayCount
          ? this.coordDelaySum / this.decisionDelayCount : 0,
        // 동적 권한위임(분권 전환) 관측: 전환 횟수·최초 전환 시각·승인노드별 분포 (B-2)
        delegation: {
          count: this.deleg.count, firstT: this.deleg.firstT, byNode: this.deleg.byNode
        },
        // Phase 2(⑥⑦): 교전협조 관측. coordAttempts=협조 판정 발생, deconflicted=협조 성립(중복 회피),
        // coordGaps=협조 실패(책임공백), duplicateEngagements=중복교전(요격탄 이중 소모) 건수.
        coordination: this.highResolutionDeployment ? Object.assign({
          attempts: this.global.coordAttempts, deconflicted: this.global.deconflicted,
          gaps: this.global.coordGaps, duplicates: this.global.duplicateEngagements,
          realDuplicates: this.global.realDuplicateEngagements,
          trackFusion: this.global.trackFusion,
          statusSharing: this.global.statusSharing
          // ADR-056: 역방향 COP 해소 카운터 — ON일 때만 노출(OFF wire shape 불변)
        }, this.unifiedEngagementState ? { copDeconflicted: this.copDeconflicted || 0 } : {}) : {
          attempts: this.global.coordAttempts, deconflicted: this.global.deconflicted,
          gaps: this.global.coordGaps, duplicates: this.global.duplicateEngagements
        },
        // Phase 1(⑨): 문서 pk 폴백 발동 조합(무기×위협) — censored는 절단 보정 블록에서 이미 노출
        pkFallback: this.global.pkFallback,
        features: this.features,
        // 비용교환비(MoFE, 백만 USD 개념): exchange = 소모 요격탄 비용 / 격추 위협가치
        // (>1이면 아군이 더 비싼 자원을 소모). sat*는 저가 포화위협(무인기·방사포) 부분집합
        cost: {
          interceptM: this.cost.interceptM,
          killedThreatM: this.cost.killedThreatM,
          exchange: this.cost.killedThreatM > 0 ? this.cost.interceptM / this.cost.killedThreatM : null,
          interceptSatM: this.cost.interceptSatM,
          killedThreatSatM: this.cost.killedThreatSatM,
          exchangeSat: this.cost.killedThreatSatM > 0 ? this.cost.interceptSatM / this.cost.killedThreatSatM : null,
          // Phase 2(⑥⑦): 중복교전으로 이중 소모된 요격탄 비용(책임공백의 MoFE 비용). interceptM에 이미 포함됨.
          duplicateInterceptM: this.cost.duplicateInterceptM,
          // Phase 2(⑨, leakCost): 방어효율 = 격추 위협가치 / (격추 + 누수 위협가치) — "방어한 가치 비율".
          // exchange의 "안 쏘면 최적" 함정을 반전(안 쏘면 격추 0 → 0=최악). exchange는 불변(회귀 안전).
          leakedThreatM: this.cost.leakedThreatM,
          defenseEfficiency: this.features.leakCost && (this.cost.killedThreatM + this.cost.leakedThreatM) > 0
            ? this.cost.killedThreatM / (this.cost.killedThreatM + this.cost.leakedThreatM) : null,
          defenseEfficiencySat: this.features.leakCost && (this.cost.killedThreatSatM + this.cost.leakedThreatSatM) > 0
            ? this.cost.killedThreatSatM / (this.cost.killedThreatSatM + this.cost.leakedThreatSatM) : null
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
    if (this.highResolutionDeployment) {
      result.global.commanderAssignments = this.global.commanderAssignments;
      result.global.failureSummary = {
        primary: this.global.failurePrimary,
        contributors: this.global.failureContributors,
        byFamily: this.global.failureFamilies,
        byStructurality: this.global.failureStructurality,
        structuralPrimary: this.global.failureStructurality.structural || 0,
        conditionalPrimary: this.global.failureStructurality.conditional || 0
      };
    }
    if (this.iadsSensorPhysics) {
      result.global.sensorPhysics = this.iadsSensorStats;
      result.global.trackQuality = this.global.trackQuality;
      result.global.c2Orders = this.global.c2Orders;
    }
    if (this.trace) {
      result.threatTraces = this.threatTraces;
      result.nodeSeries = this.nodeSeries;
      result.traceTruncated = this.traceTruncated;
      result.nodeSeriesTruncated = this.nodeSeriesTruncated;
    }
    if (this.c2Analysis) {
      // 비교 가능한 명시적 분모 지표. 기본 API wire shape는 보존하고 분석 실행에서만 확장한다.
      result.global.killRateSpawn = spawnedDenom ? this.global.killed / spawnedDenom : 0;
      result.global.leakRateSpawn = spawnedDenom ? this.global.leaked / spawnedDenom : 0;
      result.global.censoredRate = spawnedDenom ? censoredRaw / spawnedDenom : 0;
      result.global.killRateResolved = resolvedDenom ? this.global.killed / resolvedDenom : 0;
      result.global.leakRateResolved = resolvedDenom ? this.global.leaked / resolvedDenom : 0;
      result.c2Events = this.c2Events;
      result.c2EventsTruncated = this.c2EventsTruncated;
    }
    return result;
  };
  KJ.Simulation = Simulation;
  KJ.DELEG_QUEUE_MULT = DELEG_QUEUE_MULT;  // 감사/스윕용 노출 (속성 변경 시 엔진이 즉시 참조 — 기본 asis4/tobe1)

  // ── 정밀화 Phase C: 요격 실패(누수) 원인 코드 → 병목 분류(taxonomy) ──
  // 엔진이 태깅하는 leakReason 코드의 정본 분류. UI(대조표·타임라인·분석 탭 파이프라인)와
  // 회귀 테스트가 공유한다. group은 구조적 병목 축(어느 계층의 실패인가), structural은
  // C2 구조 개선(To-Be)으로 줄어야 하는 원인인지(명중실패 같은 순수 종말 성능과 구분),
  // stage는 9단계 파이프라인 중 이 실패가 발생하는 단계(분석 탭 매핑과 동일 정본)를 뜻한다.
  KJ.LEAK_TAXONOMY = {
    // structurality: structural=구조 개입이 필요, conditional=반복/지속성 증거 필요,
    // nonstructural=확률·자원·물리 종말, unknown=원인 미분해. structural boolean은 UI 집계 호환 파생값.
    not_detected: { label: '센서 보유 후 확률적 미탐지', group: '탐지 성능', family: 'stochastic', structurality: 'nonstructural', structural: false, stage: '① 탐지' },
    no_sensor: { label: '탐지 공백(센서·커버리지 부재)', group: '탐지 공백', family: 'architecture', structurality: 'structural', structural: true, stage: '① 탐지' },
    no_responsible_c2: { label: '책임 C2·권한 부재', group: '책임 공백', family: 'architecture', structurality: 'structural', structural: true, stage: '②~⑦ 책임·결심' },
    no_report_path: { label: '책임 C2로의 보고경로 부재', group: '항적 비융합·보고경로 부재', family: 'architecture', structurality: 'structural', structural: true, stage: '② 추적생성' },
    correlation_failed: { label: '항적 상관·식별 실패', group: '항적 품질', family: 'stochastic', structurality: 'nonstructural', structural: false, stage: '②~④ 상관·식별' },
    responsibility_gap: { label: '책임공백(협조·명령경로 부재)', group: '책임 공백', family: 'architecture', structurality: 'structural', structural: true, stage: '⑥⑦ 결심·협조' },
    overflow: { label: '처리용량 포화', group: '처리 포화', family: 'capacity', structurality: 'conditional', structural: false, stage: '③④⑤ C2 / ⑧ 교전' }, // 'overflow:<노드>' 접두 코드
    no_shooter: { label: '교전가능 수단 부재', group: '교전수단 공백', family: 'capability', structurality: 'structural', structural: true, stage: '⑧ 교전명령' },
    no_capable_weapon: { label: '위협 호환 무기 부재', group: '교전수단 공백', family: 'capability', structurality: 'structural', structural: true, stage: '⑧ 사수선정' },
    engagement_geometry_gap: { label: '전 교전창 PIP·기하 미형성', group: '교전기하 공백', family: 'capability', structurality: 'structural', structural: true, stage: '⑧ PIP·교전' },
    window_lost_due_to_c2: { label: 'C2 지연으로 PIP·교전창 상실', group: '결심·교전창 상실', family: 'architecture', structurality: 'structural', structural: true, stage: '⑥~⑧ 결심·교전' },
    no_fire_control: { label: '화력통제 상태 미형성', group: '추적·화력통제', family: 'capability', structurality: 'conditional', structural: false, stage: '②~⑧ 추적·교전' },
    fuel_insufficient: { label: '요격탄 PIP 도달 연료 부족', group: '교전 운동학', family: 'kinematic', structurality: 'nonstructural', structural: false, stage: '⑧ PIP·교전' },
    pk_too_low: { label: '보정 후 최소 교전확률 미달', group: '요격 성능', family: 'stochastic', structurality: 'nonstructural', structural: false, stage: '⑧ PSSEK·교전' },
    capacity_full: { label: '동시교전 채널 포화', group: '교전 처리용량', family: 'capacity', structurality: 'conditional', structural: false, stage: '⑧ 교전' },
    ammo_depleted: { label: '요격탄 소진·재장전 대기', group: '자원·군수', family: 'resource', structurality: 'nonstructural', structural: false, stage: '⑧ 교전' },
    not_operational: { label: '사수 비가용', group: '자원·생존', family: 'resource', structurality: 'conditional', structural: false, stage: '⑧ 교전' },
    no_feasible_pip: { label: 'PIP 미형성(미분해 호환코드)', group: '원인 미분해', family: 'unknown', structurality: 'unknown', structural: false, stage: '⑧ PIP·교전' },
    // Phase 1(⑧): 능력 있는 무기는 있으나 잔여 체공창 내 교전 완료 불가(명령링크+engageTimeSec > 잔여 dwell).
    // structural은 STOP 판단 대상 — 잠정 false(무기 교전소요가 애초에 체공창보다 길면 C2와 무관하다는
    // 보수적 가정). true로 볼 여지: 앞 단계 C2 지연이 창을 소진시킨 경우(C2 통합으로 개선 가능).
    no_engage_window: { label: '교전창 부족(체공창 내 교전 완료 불가)', group: '교전창 제약', family: 'kinematic', structurality: 'conditional', structural: false, stage: '⑧ 교전명령' },
    // 자원최적화 Step 2(magazine): 요격탄 소진. no_shooter(능력)·no_engage_window(시간)와 같은 계열
    // = 비구조(C2 통합으로 유도탄 수량이 늘어나지는 않는다 — 재장전·재고는 별개 물류 과제).
    no_ammo: { label: '요격탄 소진', group: '자원·군수', family: 'resource', structurality: 'nonstructural', structural: false, stage: '⑧ 교전명령' },
    missed: { label: '명중 실패(기회소진)', group: '명중 실패', family: 'stochastic', structurality: 'nonstructural', structural: false, stage: '⑨ BDA' },
    timeout: { label: '처리지연 초과(원인 미분해)', group: '처리지연 초과', family: 'unknown', structurality: 'unknown', structural: false, stage: '⑨ 종합' },
    // Phase 4(⑨): timeout 분해. c2=교전 미개시(앞단 지연 → 구조적) / engage=교전 중 체공창 소진
    // (교전·BDA 물리 한계 → 비구조, ⑧ no_engage_window와 동일 기준: 이미 교전 시도했나).
    'timeout:c2': { label: 'C2 지연 초과(세부원인 미분해)', group: '처리지연 초과', family: 'capacity', structurality: 'conditional', structural: false, stage: '②~⑦ 파이프라인' },
    'timeout:engage': { label: '체공창 소진(교전 중)', group: '체공창 소진', family: 'kinematic', structurality: 'nonstructural', structural: false, stage: '⑧⑨ 교전·BDA' }
  };

  /**
   * leakReason 코드(‘overflow:<노드>’ 접두 포함)를 taxonomy 항목으로 해석.
   * overflow는 포화된 노드의 카테고리에 따라 발생 단계를 C2 처리(③④⑤)와
   * 교전명령(⑧)으로 정밀화한다.
   */
  KJ.leakTaxonomy = function (code, evidence) {
    var resolved;
    if (KJ.LEAK_TAXONOMY[code]) resolved = KJ.LEAK_TAXONOMY[code];
    if (code && code.indexOf('overflow:') === 0) {
      var base = KJ.LEAK_TAXONOMY.overflow;
      var node = KJ.nodeById(code.slice(9));
      var isShooter = node && node.category === 'shooter';
      // 용량 포화는 C2/shooter 모두 conditional. paired-seed 지속성 증거 전에는 구조로 단정하지 않는다.
      var stage = isShooter ? '⑧ 교전명령' : '③④⑤ C2 처리';
      resolved = { label: base.label + '(' + code.slice(9) + ')', group: isShooter ? '교전채널 포화' : base.group,
        family: 'capacity', structurality: 'conditional', structural: false, stage: stage };
    }
    if (!resolved) resolved = { label: String(code), group: '원인 미분해', family: 'unknown', structurality: 'unknown', structural: false, stage: '—' };
    // 조건부 실패는 단일 실행에서 구조로 단정하지 않는다. paired-seed 반복 또는
    // 구조 개입 반사실에서 지속성이 증명된 경우에만 구조적으로 승격한다.
    if (resolved.structurality === 'conditional' && evidence &&
        (evidence.persistentAcrossSeeds === true || evidence.architectureCounterfactual === true)) {
      return Object.assign({}, resolved, { structurality: 'structural', structural: true });
    }
    return resolved;
  };

  KJ.classifyFailure = KJ.leakTaxonomy;

  /** 편의 실행기: 단일 복제(replication) 실행. Phase 3 Monte Carlo가 이를 다수 집계한다. */
  KJ.runDES = function (cfg) { return new Simulation(cfg).run(); };
})();
