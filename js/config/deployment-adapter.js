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
  var VOICE = Object.freeze({
    type: 'voice', delaySec: 20,
    dist: Object.freeze({ kind: 'uniform', min: 10, max: 30 }),
    paramRef: 'C2-VOICE-COORD-01'
  });
  // 군단 AOC→MCRC 교전현황 공유. 음성/VTC 1개 채널이 현재 처리 중
  // 메시지를 포함해 최대 4건만 수용한다. 수치는 정책연구용 개념값(등급 C).
  var VOICE_STATUS = Object.freeze({
    type: 'voice-vtc', delaySec: 180,
    dist: Object.freeze({ kind: 'triangular', min: 90, mode: 180, max: 270 }),
    messageServers: 1, messageCapacity: 4, freshnessSec: 300,
    paramRef: 'C2-ENG-STATUS-01', confidence: 'C'
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
    var opLevel = (opts && opts.c2OperatorLevel) || null; // 'high'|'low' (null=mid, 종전 동일)
    var cacheKey = id + (v2 ? '|linkV2' : '') + (appr ? '|appr' : '') +
      (southern ? '|south' : '') + (opLevel ? '|op:' + opLevel : '');
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
        modes: decl.typeId === 'IAOC' || decl.typeId === 'EOC' ? ['tobe'] : undefined,
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

    if (kamdoc) {
      sensorNodes(['GREEN_PINE_B', 'GREEN_PINE_C']).forEach(function (s) { addLink(links, s.id, kamdoc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, v2 ? IFCN : DL_FAST, 'korean_kamd'); });
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
      sensorNodes(['FPS117']).forEach(function (s) { addLink(links, s.id, mcrc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, v2 ? IFCN : DL_FAST, 'korean_mcrc'); });
      iccs.forEach(function (icc) {
        addLink(links, mcrc.id, icc.id, 'coord', v2 ? C2_TRANSFER : LONG, v2 ? IFCN : DL_FAST, 'korean_mcrc');
        addLink(links, icc.id, mcrc.id, 'coord', v2 ? C2_TRANSFER : LONG, v2 ? IFCN : DL_FAST, 'korean_mcrc');
      });
      // As-Is 군단 AOC는 MCRC 공중항적과 자체 국지레이더 항적을 C2A에서
      // 함께 접수한다. 항적 전파는 16초 개념 데이터링크, 반대 방향의 교전현황은
      // 제한형 음성/VTC 메시지로 분리해 정보의 비대칭을 보존한다.
      localAds.forEach(function (aoc) {
        addLink(links, mcrc.id, aoc.id, 'report', v2 ? C2_TRANSFER : LONG, v2 ? IFCN : DL_FAST, 'mcrc_to_corps_aoc_track');
        addLink(links, aoc.id, mcrc.id, 'status', VOICE_STATUS, v2 ? IFCN : DL_FAST, 'corps_aoc_engagement_status');
        // ADR-058(approvalChain): 승인 협조 채널 — 교전현황(status) 채널과 의도적으로 분리.
        // As-Is VOICE(대표 20초·Uniform(10,30))는 링크(전선) 성능이 아니라 **음성/VTC 협조
        // 절차 지연**(교전의사 선언·책임구역 확인·중복 회피 협상)이다. 따라서 linkSemanticsV2가
        // 켜져도 As-Is 측은 codex 정합(1초) 대상이 아니다 — codex는 육↔공 협조 절차를
        // 모델링하지 않아 참고 정본이 없다(C2-VOICE-COORD-01 비고 참조).
        // To-Be 측은 킬웹 네트워크를 따른다(v2 ON이면 IFCN 1초, OFF면 DL_FAST 2초).
        if (appr) addLink(links, aoc.id, mcrc.id, 'coord', VOICE, v2 ? IFCN : DL_FAST, 'corps_aoc_approval');
      });
    }
    sensorNodes(['TPS880K']).forEach(function (s) {
      var owner = c2ForPos(s.localAdPosKey);
      if (mcrc) addLink(links, s.id, mcrc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, v2 ? IFCN : DL_FAST, 'korean_mcrc');
      if (owner) addLink(links, s.id, owner.id, 'report', v2 ? reportCycleComm(s.typeId) : INTERNAL, v2 ? IFCN : DL_FAST, 'abt_local');
    });

    deployment.batteries.forEach(function (b) {
      var shooterNode = nodeMap[b.id];
      var ecs = ecsByBattery[b.id];
      var sensor = b.mfrSensorPosKey ? nodeMap['SENSOR_' + b.mfrSensorPosKey] : null;
      var upper = c2ForPos(b.commandC2PosKey || b.iccPosKey || b.localAdPosKey);
      if (sensor && ecs) addLink(links, sensor.id, ecs.id, 'report', v2 ? reportCycleComm(sensor.typeId) : INTERNAL, v2 ? IFCN : DL_FAST, 'battery_mfr');
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
        iccs.forEach(function (icc) { addLink(links, s.id, icc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, v2 ? IFCN : DL_FAST, 'korean_kamd'); });
      });
    }
    if (!mcrc) {
      sensorNodes(['FPS117', 'TPS880K']).forEach(function (s) {
        iccs.forEach(function (icc) { addLink(links, s.id, icc.id, 'report', v2 ? reportCycleComm(s.typeId) : LONG, v2 ? IFCN : DL_FAST, 'korean_mcrc'); });
      });
    }

    if (iaoc) {
      nodes.filter(function (n) { return n.category === 'sensor' && n.forceOwner !== 'USFK'; }).forEach(function (s) {
        addLink(links, s.id, iaoc.id, 'report', null, v2 ? IFCN : DL_FAST, 'killweb');
      });
      nodes.filter(function (n) { return n.category === 'c2' && n.id !== iaoc.id && n.forceOwner !== 'USFK'; }).forEach(function (c) {
        addLink(links, c.id, iaoc.id, 'report', null, v2 ? IFCN : DL_FAST, 'killweb');
        addLink(links, iaoc.id, c.id, 'coord', null, v2 ? IFCN : DL_FAST, 'killweb');
      });
    }

    var roles = {
      fusionC2: iaoc ? iaoc.id : null,
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
