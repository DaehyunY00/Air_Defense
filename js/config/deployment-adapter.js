/**
 * High-resolution deployment adapter.
 *
 * It keeps the legacy node/link wire shape for the UI and queue metrics, while
 * also exposing the C2 ownership, battery MFR, missile envelope and launcher
 * declarations consumed by the high-resolution IADS execution path.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var THREAT_KEYS = ['uav_small', 'ac_low', 'heli', 'fighter', 'cruise', 'srbm', 'mrl_large'];
  var DL_FAST = Object.freeze({ type: 'datalink', delaySec: 2, paramRef: 'C2-DL-DLY-01' });
  var INTERNAL = Object.freeze({ type: 'internal', delaySec: 1, paramRef: 'IADS-LINK-INTERNAL-01' });
  var SHORT = Object.freeze({ type: 'datalink', delaySec: 4, paramRef: 'IADS-LINK-SHORT-01' });
  var LONG = Object.freeze({ type: 'datalink', delaySec: 16, paramRef: 'IADS-LINK-LONG-01' });
  // ADR-080: 분포를 균등(10,30) → 정규(평균 20, σ5)로 교체 — ±2σ가 종전 구간과 일치한다.
  // 절차 지연은 "10~30초 사이 아무 값이나 같은 확률"보다 대표값 부근에 몰리는 게 자연스럽다.
  // 음수 꼬리는 엔진이 0으로 절단한다(_linkDelay의 Math.max(0, ·)).
  var VOICE = Object.freeze({
    type: 'voice', delaySec: 20,
    dist: Object.freeze({ kind: 'normal', mean: 20, stddev: 5 }),
    paramRef: 'C2-VOICE-COORD-01'
  });
  // 군단 AOC→MCRC 교전현황 공유. 음성/VTC 1개 채널이 현재 처리 중
  // 메시지를 포함해 최대 4건만 수용한다. 수치는 정책연구용 개념값(등급 C).
  // ADR-082: Tri(90,180,270)(평균 180) → Normal(135, σ22.5)(±2σ = 90~180).
  // 형태는 음성 협조(ADR-080)와 같은 논리 — 절차 지연은 대표값 부근에 몰린다.
  // ⚠️ **대표값이 180 → 135로 25% 내려간다.** 이 채널만 유한 용량(1채널·4건)이라
  // 지연이 곧 서비스율이고 드롭률로 증폭되므로, 형태 정리가 아니라 실질 변경이다.
  // 12 seed 쌍체에서 대표값 유지안(180, σ45)과 **통계적으로 구분되지 않아**
  // 사전 등록한 선택 규칙에 따라 이쪽을 택했다(ADR-082 §측정).
  var VOICE_STATUS = Object.freeze({
    type: 'voice-vtc', delaySec: 135,
    dist: Object.freeze({ kind: 'normal', mean: 135, stddev: 22.5 }),
    messageServers: 1, messageCapacity: 4, freshnessSec: 300,
    paramRef: 'C2-ENG-STATUS-01', confidence: 'C'
  });
  // ADR-079 — As-Is 육군 군단 AOC ↔ 공군 MCRC 교신 수단은 **음성과 문자(서버 채팅)**다.
  // 종전에는 공중항적 중계를 데이터링크 1초로 두었는데(ADR-057이 근거 불명인 16초를 codex
  // 값으로 환원하며 그리 됐다), 육↔공 사이에 실시간 항적 데이터링크가 있다는 전제가 된다.
  // 실제로는 사람이 채팅창에 적어 넘기므로 그 전제가 성립하지 않는다.
  // ⚠️ 대표값은 정책연구용 개념값(등급 C)이다 — 음성 협조 20초와 음성/VTC 180초 사이에
  //    놓았다. 타이핑·확인 왕복이 있어 음성 협조보다 느리고, 비동기라 VTC보다는 빠르다.
  //    근거 문헌이 없으므로 결과를 인용할 때 이 값이 가정임을 함께 밝혀야 한다.
  // ADR-082: Tri(20,45,120) → Normal(45, σ7.5)(±2σ = 30~60).
  // ⚠️ 최빈값은 45로 같지만 **평균이 61.7 → 45초로 27% 내려간다** — 삼각분포가
  // 오른쪽으로 길게 치우쳐 있었기 때문이다(평균 = (20+45+120)/3). 즉 이것도
  // 형태 정리가 아니라 실질적인 속도 향상이며, 긴 꼬리(최대 120초)를 잘라내는 것이
  // 실제 절차를 더 잘 표현하는지에 대한 근거는 없다(등급 C 유지).
  var CHAT_TRACK = Object.freeze({
    type: 'chat', delaySec: 45,
    dist: Object.freeze({ kind: 'normal', mean: 45, stddev: 7.5 }),
    paramRef: 'C2-CHAT-TRACK-01', confidence: 'C'
  });
  // ADR-081 — 방공C2A 사이 **상급 경유** 항적 공유(KVMF 계통).
  //
  // 확인된 것: KVMF는 육군 지상전술데이터링크 표준(MND-STD-0016, 2012)이고 방공C2A에
  //   실제 적용된다. 방공C2A 전력화로 작전 반응시간이 3분+ → 30초로 줄었다고 공표됐다.
  // 확인 못 한 것: **두 방공C2A 간 직접 peer 연동**의 근거는 찾지 못했다. 방공C2A는
  //   군단/사단 지역을 묶고, 상급 정보는 지상전술C4I(ATCIS)·위성 전군방공경보 계통에서
  //   받는 구조다. 그래서 peer 직결이 아니라 **상급 경유 계선**으로 둔다.
  //
  // ⚠️ 두 가지 한계를 값 자체에 새겨 둔다(등급 C):
  //  ① 30초는 **링크 지연이 아니라 체계 전체의 작전 반응시간**이다. 성격이 다른 값을
  //     옮겨 쓰는 것이므로, 이 계선의 지연을 "전선 성능"으로 읽으면 안 된다.
  //  ② 중간 상급 노드를 **두지 않고** 왕복을 한 간선으로 축약했다. 노드를 두면 그 큐
  //     파라미터(서버 수·서비스시간)를 지어내야 하는데 근거가 없다. 엔진에서 경유 노드는
  //     어차피 큐를 갖지 않으므로(ICC 실측 — 링크 488통과 · 큐 도착 0건) 축약해도
  //     동역학은 같다. 그림에서 peer 직결로 **보이는** 것이 이 축약의 대가다.
  var KVMF_LATERAL = Object.freeze({
    type: 'kvmf-relay', delaySec: 30,
    paramRef: 'C2-KVMF-LATERAL-01', confidence: 'C'
  });
  var cache = {};

  function freezeAll(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.keys(o).forEach(function (k) { freezeAll(o[k]); });
    return Object.freeze(o);
  }

  function maxRange(value) {
    if (typeof value === 'number') return value;
    if (!value || typeof value !== 'object') return 0;
    return Object.keys(value).reduce(function (m, k) {
      return Math.max(m, typeof value[k] === 'number' ? value[k] : 0);
    }, 0);
  }

  function distancePointSegmentKm(pos, axis) {
    var a = axis.entry, b = axis.target;
    var lat0 = (pos.lat + a[0] + b[0]) / 3 * Math.PI / 180;
    function xy(coord) {
      return { x: coord[1] * 111.32 * Math.cos(lat0), y: coord[0] * 111.32 };
    }
    var p = xy([pos.lat, pos.lon]), p0 = xy(a), p1 = xy(b);
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    var den = dx * dx + dy * dy;
    var t = den ? ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / den : 0;
    t = Math.max(0, Math.min(1, t));
    var x = p0.x + t * dx, y = p0.y + t * dy;
    return Math.hypot(p.x - x, p.y - y);
  }

  // ADR-064: coverage는 KJ.AXES에서 **파생**되므로, 남부 축선을 정의하는 것만으로 기존 자산의
  // coverage가 바뀐다(종전 [] = 무제한 → ['southcentral',...] = 남부 전용). 그러면 플래그 OFF
  // 결과까지 달라지므로, 남부 축선은 변형 카탈로그에서만 포함한다(linkSemanticsV2·approvalChain과 동일 패턴).
  function axesFor(pos, rangeKm, includeSouthern) {
    var axes = KJ.AXES || {};
    var southern = KJ.SOUTHERN_AXIS_KEYS || [];
    return Object.keys(axes).filter(function (key) {
      if (!includeSouthern && southern.indexOf(key) !== -1) return false;
      return distancePointSegmentKm(pos, axes[key]) <= rangeKm;
    });
  }

  function boolMap(keys, eligible) {
    var out = {};
    THREAT_KEYS.forEach(function (k) { out[k] = !!eligible && keys.indexOf(k) !== -1; });
    return out;
  }

  // ADR-058 동반 스윕: 운용자 처리시간 성분(high/mid/low)을 변형 카탈로그로 선택.
  // 기본 'mid'(종전과 동일 — bit-exact). IADS-C2-COMPAT-01 operator 값(등급 C) 민감도 분리용.
  function c2Service(type, operatorLevel) {
    var p = type.processing;
    var sys = (p.system[0] + p.system[1]) / 2;
    var op = p.operator[operatorLevel || 'mid'];
    return sys + (typeof op === 'number' ? op : p.operator.mid);
  }

  function c2Capacity(type) {
    var mult = type.tier === 'command' ? 10 : (type.tier === 'battalion' ? 5 : 2);
    return type.simultaneousCapacity * mult;
  }

  function addLink(links, from, to, kind, asis, tobe, axis) {
    if (!from || !to || from === to) return;
    var comm = {};
    if (asis) comm.asis = asis;
    if (tobe) comm.tobe = tobe;
    links.push({ from: from, to: to, kind: kind, comm: comm, axis: axis || null });
  }

  // ADR-057(linkSemanticsV2): IADS_codex ADR-014 정합 — As-Is 센서→C2는 "일률 지연"이 아니라
  // 그 센서의 보고 주기(reportingPeriod)가 정보 나이를 지배한다. 1단계 근사로
  // "센서별 고정 지연 = reportingPeriod"를 적용한다(톱니 신선도는 후속 과제 — ADR-057 §한계).
  // To-Be(킬웹)는 codex 판정대로 IFCN 1초가 지배한다("킬웹 보고주기 전부 1s") — 아래 IFCN 참조.
  function reportCycleComm(typeId) {
    var t = (KJ.SENSOR_TYPES || {})[typeId];
    var rp = t && Number.isFinite(t.reportingPeriod) ? t.reportingPeriod : 1;
    return Object.freeze({ type: 'report-cycle', delaySec: rp, paramRef: 'IADS-LINK-RP-01' });
  }
  // C2↔C2 전송 지연 — codex LINK_DELAYS.shortRange 1초로 환원(구 SHORT 4초·LONG 16초의
  // 조정 근거를 저장소 어디에서도 찾지 못함 — "조정 근거 불명 — codex 값으로 환원").
  var C2_TRANSFER = Object.freeze({ type: 'datalink', delaySec: 1, paramRef: 'IADS-LINK-SHORT-01' });
  // To-Be(킬웹) 측 — codex LINK_DELAYS.ifcn 1초: "Kill Web 모든 링크 (ADR-014: 킬웹 보고주기
  // 전부 1s)". 킬웹에서는 IFCN 네트워크가 융합 항적을 1초 주기로 밀어내므로 센서 자체 주기가
  // 아니라 네트워크 주기가 정보 나이를 지배한다는 것이 codex 정본의 판정이다.
  var IFCN = Object.freeze({ type: 'ifcn', delaySec: 1, paramRef: 'IADS-LINK-IFCN-01' });

  function buildDeploymentCatalog(id, opts) {
    var v2 = !!(opts && opts.linkSemanticsV2);
    var appr = !!(opts && opts.approvalChain);
    var southern = !!(opts && opts.southernAxes); // ADR-064
    var parity = !!(opts && opts.sensorReportParity); // ADR-067
    var opLevel = (opts && opts.c2OperatorLevel) || null; // 'high'|'low' (null=mid, 종전 동일)
    var kvmf = !!(opts && opts.kvmfLateral); // ADR-081
    var cacheKey = id + (v2 ? '|linkV2' : '') + (appr ? '|appr' : '') +
      (southern ? '|south' : '') + (parity ? '|rp' : '') + (opLevel ? '|op:' + opLevel : '') +
      (kvmf ? '|kvmf' : '');
    if (cache[cacheKey]) return cache[cacheKey];
    var deployment = KJ.deploymentById(id);
    if (!deployment) throw new Error('Unknown high-resolution deployment: ' + id);

    var nodes = [], links = [], nodeMap = {};
    var c2ByType = {}, c2ByPos = {}, ecsByBattery = {};
    var positions = deployment.positions;

    deployment.c2Nodes.forEach(function (decl) {
      var type = KJ.C2_TYPES[decl.typeId];
      if (!type) throw new Error(id + ': unknown C2 type ' + decl.typeId);
      var pos = positions[decl.posKey];
      var svc = c2Service(type, opLevel);
      var node = {
        id: decl.id, instanceId: decl.id, typeId: decl.typeId,
        name: decl.instanceLabel || type.name,
        category: 'c2', service: decl.forceOwner === 'USFK' ? 'usfk' : 'joint',
        echelon: type.tier, coord: [pos.lat, pos.lon], position: { lon: pos.lon, lat: pos.lat, alt: pos.alt || 0 }, coordNote: pos.coordNote,
        role: type.commandScope + ' · 위협종류/생존상태 책임 C2' +
          (decl.typeId === 'ARMY_LOCAL_AD' ? ' · MCRC+국지레이더 항적융합·자체 자동할당' : ''),
        queue: {
          servers: type.simultaneousCapacity,
          serviceTimeSec: { asis: svc, tobe: svc },
          capacity: c2Capacity(type), paramRef: type.paramRef
        },
        c2Axis: decl.c2Axis || null, forceOwner: decl.forceOwner || 'ROK',
        architectureRole: decl.typeId === 'ARMY_LOCAL_AD' ? 'CORPS_AOC_C2A' : null,
        batteryId: decl.batteryId || null,
        // ADR-078: 조율층은 IAOC 하나다. 종전에는 EOC(교전운영센터)를 나란히 뒀는데 실행에서
        // 도착 0건의 유령 노드였다 — 선언·연결·표시만 되고 아무 일도 하지 않았다. 교전 운영
        // (표적할당·우선순위·발사·격추·잔량 통합)은 IAOC의 기능으로 흡수하고 노드를 지웠다.
        modes: decl.typeId === 'IAOC' ? ['tobe'] : undefined,
        confidence: decl.confidence, sourceNote: decl.sourceNote
      };
      nodes.push(node); nodeMap[node.id] = node;
      (c2ByType[decl.typeId] = c2ByType[decl.typeId] || []).push(node);
      c2ByPos[decl.posKey] = node;
      if (decl.batteryId) ecsByBattery[decl.batteryId] = node;
    });

    deployment.sensors.forEach(function (decl) {
      var type = KJ.SENSOR_TYPES[decl.typeId];
      if (!type) throw new Error(id + ': unknown sensor type ' + decl.typeId);
      var pos = positions[decl.posKey];
      var rangeKm = maxRange((type.compatibilityRanges || type.ranges).detect);
      var node = {
        id: decl.id, instanceId: decl.id, typeId: decl.typeId,
        name: type.name + ' (' + decl.posKey + ')', category: 'sensor',
        service: decl.forceOwner === 'USFK' ? 'usfk' : 'joint', echelon: 'sensor',
        coord: [pos.lat, pos.lon], position: { lon: pos.lon, lat: pos.lat, alt: pos.alt || 0 }, coordNote: pos.coordNote,
        role: type.role + ' · 개념 기하 탐지·화력통제 상태',
        detects: type.detectableThreats.slice(), coverage: axesFor(pos, rangeKm, southern),
        detectProb: { value: type.detectionProbability, paramRef: type.paramRef },
        rangeKm: rangeKm, rangeNote: '원본 개념 사거리의 정적 축선 호환 투영',
        c2Axis: decl.c2Axis || null, forceOwner: decl.forceOwner || 'ROK',
        localAdPosKey: decl.localAdPosKey || null,
        confidence: decl.confidence, sourceNote: decl.sourceNote
      };
      nodes.push(node); nodeMap[node.id] = node;
    });

    deployment.batteries.forEach(function (decl) {
      var type = KJ.SHOOTER_TYPES[decl.shooterTypeId];
      if (!type) throw new Error(id + ': unknown shooter type ' + decl.shooterTypeId);
      var pos = positions[decl.posKey];
      var missileRanges = Object.keys(type.missiles).map(function (k) {
        return type.missiles[k].engagementEnvelope.Rmax;
      });
      var rangeKm = Math.max.apply(null, missileRanges);
      // The native IADS resolver partitions ROK, local-AD and USFK axes before
      // WTA.  USFK assets therefore remain independent without being disabled.
      var eligible = true;
      var controller = ecsByBattery[decl.id];
      var icc = decl.iccPosKey ? c2ByPos[decl.iccPosKey] : null;
      var localAd = decl.localAdPosKey ? c2ByPos[decl.localAdPosKey] : null;
      var node = {
        id: decl.id, instanceId: decl.id, typeId: decl.shooterTypeId,
        name: type.name + ' (' + decl.posKey + ')', category: 'shooter',
        service: decl.forceOwner === 'USFK' ? 'usfk' : (decl.forceOwner === 'ROK_LOCAL_AD' ? 'army' : 'af'),
        echelon: 'battery', coord: [pos.lat, pos.lon], position: { lon: pos.lon, lat: pos.lat, alt: pos.alt || 0 }, coordNote: pos.coordNote,
        role: '원본 책임 C2·PIP·발사대 자원 모델 실행',
        coverage: axesFor(pos, rangeKm, southern),
        controlledBy: { asis: controller ? [controller.id] : [], tobe: controller ? [controller.id] : [] },
        canEngage: boolMap(type.engageableThreats, eligible),
        wtaSuit: type.compatibility.wtaSuit,
        engage: {
          rangeKm: rangeKm,
          channels: decl.maxSimultaneous,
          engageTimeSec: type.compatibility.engageTimeSec,
          pk: { default: { kind: 'triangular', min: type.compatibility.pk, mode: type.compatibility.pk, max: type.compatibility.pk }, paramRef: type.paramRef },
          costPerShotM: type.compatibility.costPerShotM,
          costRef: type.paramRef,
          magazine: Object.keys(decl.totalRounds || {}).reduce(function (sum, k) { return sum + decl.totalRounds[k]; }, 0),
          missiles: type.missiles,
          doctrine: 'shoot-look-shoot'
        },
        quantity: decl.quantity, launcherConfig: decl.launcherConfig, reloadConfig: decl.reloadConfig,
        c2Axis: decl.c2Axis || null, forceOwner: decl.forceOwner || 'ROK',
        ecsC2Id: controller ? controller.id : null,
        iccC2Id: icc ? icc.id : null,
        localAdC2Id: localAd ? localAd.id : null,
        mfrSensorId: decl.mfrSensorPosKey ? 'SENSOR_' + decl.mfrSensorPosKey : null,
        totalRounds: decl.totalRounds || {},
        shooterPriority: type.priority,
        confidence: decl.confidence, sourceNote: decl.sourceNote
      };
      nodes.push(node); nodeMap[node.id] = node;
    });

    var kamdoc = (c2ByType.KAMD_OPS || [])[0] || null;
    var mcrc = (c2ByType.MCRC || [])[0] || null;
    var iaoc = (c2ByType.IAOC || [])[0] || null;
    var iccs = c2ByType.ICC || [];
    var localAds = c2ByType.ARMY_LOCAL_AD || [];

    function sensorNodes(typeIds) {
      return nodes.filter(function (n) { return n.category === 'sensor' && typeIds.indexOf(n.typeId) !== -1; });
    }
    function c2ForPos(key) { return key ? c2ByPos[key] || null : null; }

    /**
     * ADR-067 — 센서 발신 `report` 링크의 **To-Be 측** 지연.
     *
     * 보고 주기는 센서 물리이므로 양 모드 공통이어야 한다. 종전에는 To-Be만 IFCN 1초로 덮여
     * 같은 레이더가 To-Be에서 최대 16배 빨리 보고했다. codex `ifcn:1`("킬웹 보고주기 전부 1s")의
     * 논거는 융합 신선도인데, 엔진이 이미 센서별 보고 경로 중 **최속 경로를 고르므로**
     * (sim-engine.js `_iadsReportBundle` — candidates.sort(delay) → candidates[0]) 그 이득은
     * 링크 구조에서 자연 발생한다. 일괄 1초는 이중 계상이며, 단일 센서만 보는 표적에는
     * 융합 논거 자체가 없다. 정본 이탈 사유는 ADR-067·params.md IADS-LINK-IFCN-01에 기록.
     *
     * ⚠️ C2 발신 `report`(MCRC→군단 AOC 항적 중계·킬웹 C2→IAOC)는 C2↔C2이므로 대상이 아니다.
     */
    function sensorReportTobe(typeId) {
      if (!v2) return DL_FAST;
      return parity ? reportCycleComm(typeId) : IFCN;
    }

    if (kamdoc) {
      sensorNodes(['GREEN_PINE_B', 'GREEN_PINE_C']).forEach(function (s) { addLink(links, s.id, kamdoc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, sensorReportTobe(s.typeId), 'korean_kamd'); });
      iccs.forEach(function (icc) {
        addLink(links, kamdoc.id, icc.id, 'coord', v2 ? C2_TRANSFER : LONG, v2 ? IFCN : DL_FAST, 'korean_kamd');
        // The legacy decision stage searches from the reporting/controller C2
        // upward to the approval role.  Preserve the same physical ICC link in
        // both directions; without this return edge every MFR→ECS main track
        // terminates as responsibility_gap before the shooter can be tasked.
        addLink(links, icc.id, kamdoc.id, 'coord', v2 ? C2_TRANSFER : LONG, v2 ? IFCN : DL_FAST, 'korean_kamd');
      });
    }
    if (mcrc) {
      sensorNodes(['FPS117']).forEach(function (s) { addLink(links, s.id, mcrc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, sensorReportTobe(s.typeId), 'korean_mcrc'); });
      iccs.forEach(function (icc) {
        addLink(links, mcrc.id, icc.id, 'coord', v2 ? C2_TRANSFER : LONG, v2 ? IFCN : DL_FAST, 'korean_mcrc');
        addLink(links, icc.id, mcrc.id, 'coord', v2 ? C2_TRANSFER : LONG, v2 ? IFCN : DL_FAST, 'korean_mcrc');
      });
      // As-Is 군단 AOC는 MCRC 공중항적과 자체 국지레이더 항적을 C2A에서
      // 함께 접수한다. 항적 전파는 16초 개념 데이터링크, 반대 방향의 교전현황은
      // 제한형 음성/VTC 메시지로 분리해 정보의 비대칭을 보존한다.
      //
      // ADR-078: 이 세 링크는 **As-Is 전용**이다(tobe 측 comm = null → linksInMode에서 제외).
      // To-Be의 구조 변화가 바로 "MCRC↔군단 AOC 직결 음성 협조 → IAOC 중심 데이터링크"인데,
      // 종전에는 같은 선의 tobe comm만 2초로 바꿔 두어 **경로는 그대로 두고 속도만** 빨라졌다.
      // 그러면 조율층을 신설한 의미가 거동에 나타나지 않고, [C2 구조] 탭 To-Be 그림에는
      // 옛 직결선과 IAOC 허브가 동시에 그려져 무엇이 달라졌는지 대비되지 않는다.
      // To-Be 대체 경로는 아래 `if (iaoc)` 블록이 깐다(군단 AOC ↔ IAOC).
      localAds.forEach(function (aoc) {
        // ADR-079: 공중항적 중계는 데이터링크가 아니라 **문자(서버 채팅)**다. linkSemanticsV2
        // 여부와 무관하다 — v2는 전선(데이터링크) 지연의 codex 정합이지, 사람이 채팅으로
        // 넘기는 절차에는 적용할 대상이 없다(음성 협조를 v2 대칭화에서 뺀 것과 같은 이유).
        addLink(links, mcrc.id, aoc.id, 'report', CHAT_TRACK, null, 'mcrc_to_corps_aoc_track');
        addLink(links, aoc.id, mcrc.id, 'status', VOICE_STATUS, null, 'corps_aoc_engagement_status');
        // ADR-058(approvalChain): 승인 협조 채널 — 교전현황(status) 채널과 의도적으로 분리.
        // As-Is VOICE(대표 20초·정규 20,σ5 — ADR-080)는 링크(전선) 성능이 아니라 **음성/VTC 협조
        // 절차 지연**(교전의사 선언·책임구역 확인·중복 회피 협상)이다. 따라서 linkSemanticsV2가
        // 켜져도 As-Is 측은 codex 정합(1초) 대상이 아니다 — codex는 육↔공 협조 절차를
        // 모델링하지 않아 참고 정본이 없다(C2-VOICE-COORD-01 비고 참조).
        if (appr) addLink(links, aoc.id, mcrc.id, 'coord', VOICE, null, 'corps_aoc_approval');
        // ADR-080: 방공C2A가 융합한 국지항적의 **상행 전파**도 문자다 — 하행(mcrc_to_corps_
        // aoc_track)과 같은 매체·같은 지연. 종전에는 국지레이더가 MCRC로 직보(4초)해서 이
        // 계선이 필요 없어 보였는데, 그 직보 자체가 실제보다 후한 가정이었다(아래 참조).
        addLink(links, aoc.id, mcrc.id, 'report', CHAT_TRACK, null, 'corps_aoc_track_share');
      });
    }

    // ── ADR-081: 방공C2A ↔ 방공C2A 상급 경유 항적 공유(KVMF 계통) ──
    //
    // 2022-12-26 사건의 공식 지적은 **1군단과 수도방위사령부 간 항적 정보 공유 지연**이었다.
    // 그런데 모델에는 두 방공C2A를 잇는 계선이 **한 가닥도 없었다** — 서로의 국지 그림을
    // 보려면 공군 MCRC를 왕복해야 해서(상행 문자 45초 + 하행 문자 45초 = 90초), 실패
    // 자체는 우연히 재현되지만 그 경로가 **육군 계통을 거치지 않는** 이상한 모양이었다.
    // 육군은 자기 데이터링크(KVMF)를 갖고 있고 방공C2A가 그것을 쓴다.
    //
    // **양 모드에 깐다.** KVMF는 육군 자체 망이라 통합 지휘소가 생겨도 사라질 이유가 없다.
    // 다만 To-Be에서는 두 방공C2A가 조율층을 1초씩 두 번 거쳐(2초) 이미 묶여 있어
    // 30초 계선은 최단경로 경쟁에서 **항상 진다** — 그래서 To-Be 동역학은 불변일 것으로
    // 예측하고, 그 예측을 재기준선 서명으로 검증한다(To-Be bit-exact = 채택 조건).
    //
    // kind는 `report`다 — 이 계선이 나르는 것은 항적이지 지휘가 아니다. `_iadsReportBundle`이
    // 보고 경로 탐색(['report','coord'])에서 이 간선을 쓰게 되어, 각 방공C2A가 상대 권역의
    // 국지레이더 그림을 90초가 아니라 30초에 받는다.
    if (kvmf) {
      localAds.forEach(function (from) {
        localAds.forEach(function (to) {
          if (from.id === to.id) return;
          addLink(links, from.id, to.id, 'report', KVMF_LATERAL, KVMF_LATERAL, 'corps_aoc_kvmf_lateral');
        });
      });
    }
    // ADR-080: 국지방공레이더(TPS880K)는 육군 자산이다. As-Is에서 공군 MCRC로의 직접
    // 데이터링크 보고(종전 4초)는 공개근거가 없고, 2022-12 무인기 사건의 공식 교훈
    // (1군단 레이더가 최초 포착했으나 전파 지연 — 육군이 본 것을 공군이 제때 못 봄)과
    // 정면으로 어긋난다. 그 직보가 있으면 이 실패 모드가 모델에서 구조적으로 불가능해져
    // As-Is에 유리한 숨은 가정이 된다. As-Is 국지항적은 관할 방공C2A로만 자동 보고되고,
    // MCRC는 위의 문자 전파(corps_aoc_track_share, 45초)로 늦게 본다.
    // To-Be 측은 통합망 배포이므로 종전 직결을 유지한다 — 이 변경의 서명은
    // 「As-Is만 이동·To-Be bit-exact」다(ADR-079와 같은 방향의 하드 체크).
    function nearestLocalAd(s) {
      var best = null, bd = Infinity;
      localAds.forEach(function (a) {
        var dLat = a.coord[0] - s.coord[0];
        var dLon = (a.coord[1] - s.coord[1]) * Math.cos(s.coord[0] * Math.PI / 180);
        var d = dLat * dLat + dLon * dLon;
        if (d < bd) { bd = d; best = a; }
      });
      return best;
    }
    sensorNodes(['TPS880K']).forEach(function (s) {
      var organic = c2ForPos(s.localAdPosKey);           // 편제 소속(배치 선언에 명시)
      var owner = organic || nearestLocalAd(s);          // 비편제는 최근접 권역 관할(개념 배정)
      if (mcrc) addLink(links, s.id, mcrc.id, 'report', null, sensorReportTobe(s.typeId), 'korean_mcrc');
      if (owner) {
        // 편제 2대는 양 모드 보고 유지(종전과 동일). 비편제 6대(legacy 이식 산물)는
        // **As-Is에서만** 관할 방공C2A로 보고 — To-Be에 새 링크를 깔면 To-Be가 움직여
        // 변경 서명(To-Be bit-exact)이 흐려지고, To-Be는 어차피 IAOC 직결로 같은 그림을 본다.
        addLink(links, s.id, owner.id, 'report', v2 ? reportCycleComm(s.typeId) : INTERNAL,
          organic ? sensorReportTobe(s.typeId) : null, 'abt_local');
      }
    });

    deployment.batteries.forEach(function (b) {
      var shooterNode = nodeMap[b.id];
      var ecs = ecsByBattery[b.id];
      var sensor = b.mfrSensorPosKey ? nodeMap['SENSOR_' + b.mfrSensorPosKey] : null;
      var upper = c2ForPos(b.commandC2PosKey || b.iccPosKey || b.localAdPosKey);
      if (sensor && ecs) addLink(links, sensor.id, ecs.id, 'report', v2 ? reportCycleComm(sensor.typeId) : INTERNAL, sensorReportTobe(sensor.typeId), 'battery_mfr');
      if (upper && ecs) {
        var upAsIs = v2 ? C2_TRANSFER : ((b.c2Axis === 'LOCAL_AD' || b.forceOwner === 'USFK') ? INTERNAL : SHORT);
        addLink(links, ecs.id, upper.id, 'coord', upAsIs, v2 ? IFCN : DL_FAST, b.c2Axis || 'korean');
        addLink(links, upper.id, ecs.id, 'coord', upAsIs, v2 ? IFCN : DL_FAST, b.c2Axis || 'korean');
      }
      if (ecs && shooterNode) addLink(links, ecs.id, shooterNode.id, 'command', INTERNAL, INTERNAL, b.c2Axis || 'battery');
    });

    // Root loss in the original model changes the commander to each surviving
    // ICC.  Give the same surveillance picture to those ICC roots; this is a
    // reporting path, not cross-ICC engagement-state sharing.
    if (!kamdoc) {
      sensorNodes(['GREEN_PINE_B', 'GREEN_PINE_C']).forEach(function (s) {
        iccs.forEach(function (icc) { addLink(links, s.id, icc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, sensorReportTobe(s.typeId), 'korean_kamd'); });
      });
    }
    if (!mcrc) {
      sensorNodes(['FPS117', 'TPS880K']).forEach(function (s) {
        iccs.forEach(function (icc) { addLink(links, s.id, icc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, sensorReportTobe(s.typeId), 'korean_mcrc'); });
      });
    }

    if (iaoc) {
      // ADR-078 — IAOC는 MCRC·KAMDOC를 **대체하는** 노드가 아니라 그 **상위 제대**다.
      //
      // 센서는 조율층으로 **직결**한다(킬웹 IFCN 전제 — 정보 배포는 직렬 계선을 타지 않는다).
      // 도메인 제대(MCRC·KAMDOC)는 이 배포를 **동시에** 받아 자기 도메인 항적을 처리한다 —
      // 엔진의 `_fanoutDomainEchelon`이 그 병렬 통보를 넣는다. 직렬 중계가 아니므로
      // 조율층의 결심 시각은 제대 큐에 걸리지 않는다("거치되 시간은 그대로").
      nodes.filter(function (n) {
        return n.category === 'sensor' && n.forceOwner !== 'USFK';
      }).forEach(function (s) {
        addLink(links, s.id, iaoc.id, 'report', null, sensorReportTobe(s.typeId), 'killweb');
      });
      nodes.filter(function (n) { return n.category === 'c2' && n.id !== iaoc.id && n.forceOwner !== 'USFK'; }).forEach(function (c) {
        addLink(links, c.id, iaoc.id, 'report', null, v2 ? IFCN : DL_FAST, 'killweb');
        addLink(links, iaoc.id, c.id, 'coord', null, v2 ? IFCN : DL_FAST, 'killweb');
        // 상행 협조(승인 요청 등)도 조율층으로 향한다. As-Is의 군단 AOC→MCRC 음성 협조를
        // 대체하는 계선이며, 이게 없으면 To-Be에서 `_iadsApprovalGate`의 coord 경로 탐색이
        // 상급을 찾지 못한다(현재 To-Be는 전부 human-on-loop이라 닿지 않지만, 계선을
        // 반쪽만 두면 다음에 조용히 responsibility_gap이 난다).
        addLink(links, c.id, iaoc.id, 'coord', null, v2 ? IFCN : DL_FAST, 'killweb');
      });
      // 군단 AOC 교전현황은 To-Be에서 조율층이 받는다(As-Is 음성/VTC → 데이터링크).
      // 종전에는 도착 건수 0인 MCRC 앞으로 보내고 IAOC가 꺼내 읽는 모양이었다(ADR-056 우회).
      localAds.forEach(function (aoc) {
        addLink(links, aoc.id, iaoc.id, 'status', null, v2 ? IFCN : DL_FAST, 'corps_aoc_engagement_status');
      });
    }

    // ⚠️ resolveRoleId는 **등록되지 않은 키를 그대로 반환한다**. 그 값은 nodeId가 아니므로
    //    엔진의 `!this.nodeState[approvalId]` 가드(sim-engine.js)에 걸려 "승인 불필요"로
    //    조용히 처리된다 — 승인 단계가 사라지는데 실행은 성공한다. 그래서 데이터(threats.js)가
    //    쓰는 역할 이름은 **빠짐없이 여기 있어야** 한다. approval-authority.test.mjs가 잠근다.
    var roles = {
      fusionC2: iaoc ? iaoc.id : null,
      // ADR-077: 합동방공C2 조율층. fusionC2와 같은 노드를 가리키는 별칭이다 — 데이터가
      // 'fusionC2'(내부 배선 이름) 대신 편제 이름으로 승인권자를 적을 수 있게 한다.
      // KAOC/MCRC가 이미 같은 노드를 두 이름으로 가리키는 것과 같은 방식.
      IAOC: iaoc ? iaoc.id : null,
      KAMDOC: kamdoc ? kamdoc.id : null,
      MCRC: mcrc ? mcrc.id : null,
      KAOC: mcrc ? mcrc.id : (kamdoc ? kamdoc.id : null),
      corpsAocs: localAds.map(function (n) { return n.id; })
    };
    var catalog = freezeAll({
      id: id, deployment: deployment, nodes: nodes, links: links,
      nodeMap: nodeMap, roles: roles,
      compatibilityMode: 'native-iads-c2-engagement-v1',
      nativeCounts: {
        positions: Object.keys(deployment.positions).length,
        sensors: deployment.sensors.length,
        batteries: deployment.batteries.length,
        c2Nodes: deployment.c2Nodes.length,
        ecs: deployment.c2Nodes.filter(function (n) { return n.typeId === 'ECS'; }).length,
        shorad: deployment.batteries.filter(function (b) { return b.shooterTypeId === 'BIHO' || b.shooterTypeId === 'CHUNMA'; }).length
      }
    });
    cache[cacheKey] = catalog;
    return catalog;
  }

  // ADR-061: KJ.LEGACY_CATALOG 폐기 — 고해상도 카탈로그만 존재한다.
  KJ.buildDeploymentCatalog = buildDeploymentCatalog;
  KJ.resolveModelCatalog = function (config) {
    config = config || {};
    var features = config.features || {};
    // ADR-055: MINI 폐기 이후의 기본 고해상도 배치. LEGACY_HIRES는 legacy와 자산 편성이
    // 같아, 배치 ID를 생략한 호출이 legacy 결과와 가장 가까운 편성을 보게 된다.
    // ADR-057: linkSemanticsV2 ON이면 codex ADR-014 정합 링크 변형 카탈로그를 쓴다(캐시 분리).
    return buildDeploymentCatalog(config.deploymentId || 'HANBANDO_LEGACY_NORMAL',
      // ADR-066: 기본 ON 전환 — 엔진 기본값과 반드시 일치해야 한다(`=== true`로 두면 features에
      // 키가 없는 호출에서 엔진은 ON인데 카탈로그는 구 링크값인 조용한 불일치가 생긴다).
      { linkSemanticsV2: features.linkSemanticsV2 !== false,
        // ADR-058: 승인 계선용 coord 링크는 변형 카탈로그에서만 생성(OFF wire shape 불변).
        // ADR-065: 기본 ON 전환 — 엔진 기본값과 반드시 일치해야 한다. `=== true`로 두면
        // features에 키가 없는 호출에서 엔진은 승인 계선 ON인데 카탈로그에는 coord 링크가
        // 없는 불일치가 생긴다. 명시적 false만 끈다.
        approvalChain: features.approvalChain !== false || features.approvalChainTobe === true,
        // ADR-064·065: 남부 종심 축선 — coverage 파생 포함 여부(명시적 false만 제외)
        southernAxes: features.southernAxes !== false,
        // ADR-067: 센서→C2 보고 주기 양 모드 공통(기본 ON — 엔진 기본값과 정합)
        sensorReportParity: features.sensorReportParity !== false,
        // ADR-081: 방공C2A 간 상급 경유 항적 공유(KVMF) — 기본 ON. 엔진 기본값과 반드시
        // 일치해야 한다(다른 기본 ON 플래그와 같은 이유 — 명시적 false만 끈다).
        kvmfLateral: features.kvmfLateral !== false,
        // ADR-058 동반 스윕: 운용자 처리시간 high/mid/low (기본 mid — 종전 동일)
        c2OperatorLevel: features.c2OperatorLevel === 'high' || features.c2OperatorLevel === 'low'
          ? features.c2OperatorLevel : null });
  };
  KJ.resolveRoleId = function (id, catalog) {
    catalog = catalog || buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', {});
    return catalog.roles && Object.prototype.hasOwnProperty.call(catalog.roles, id)
      ? catalog.roles[id] : id;
  };
  KJ.nodeById = function (id, catalog) {
    catalog = catalog || buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', {});
    if (catalog.nodeMap) return catalog.nodeMap[id] || null;
    return catalog.nodes.find(function (n) { return n.id === id; }) || null;
  };
  KJ.nodesInMode = function (mode, catalog) {
    catalog = catalog || buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', {});
    return catalog.nodes.filter(function (n) { return !n.modes || n.modes.indexOf(mode) !== -1; });
  };
  KJ.linksInMode = function (mode, catalog) {
    catalog = catalog || buildDeploymentCatalog('HANBANDO_LEGACY_NORMAL', {});
    return catalog.links.filter(function (l) { return !!l.comm[mode]; });
  };
})();
