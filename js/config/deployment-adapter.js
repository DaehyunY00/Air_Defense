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
    type: 'voice', delaySec: 180,
    dist: Object.freeze({ kind: 'triangular', min: 90, mode: 180, max: 270 }),
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

  function axesFor(pos, rangeKm) {
    var axes = KJ.AXES || {};
    return Object.keys(axes).filter(function (key) {
      return distancePointSegmentKm(pos, axes[key]) <= rangeKm;
    });
  }

  function boolMap(keys, eligible) {
    var out = {};
    THREAT_KEYS.forEach(function (k) { out[k] = !!eligible && keys.indexOf(k) !== -1; });
    return out;
  }

  function c2Service(type) {
    var p = type.processing;
    var sys = (p.system[0] + p.system[1]) / 2;
    return sys + p.operator.mid;
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

  function buildDeploymentCatalog(id) {
    if (cache[id]) return cache[id];
    var deployment = KJ.deploymentById(id);
    if (!deployment) throw new Error('Unknown high-resolution deployment: ' + id);

    var nodes = [], links = [], nodeMap = {};
    var c2ByType = {}, c2ByPos = {}, ecsByBattery = {};
    var positions = deployment.positions;

    deployment.c2Nodes.forEach(function (decl) {
      var type = KJ.C2_TYPES[decl.typeId];
      if (!type) throw new Error(id + ': unknown C2 type ' + decl.typeId);
      var pos = positions[decl.posKey];
      var svc = c2Service(type);
      var node = {
        id: decl.id, instanceId: decl.id, typeId: decl.typeId,
        name: decl.instanceLabel || type.name,
        category: 'c2', service: decl.forceOwner === 'USFK' ? 'usfk' : 'joint',
        echelon: type.tier, coord: [pos.lat, pos.lon], coordNote: pos.coordNote,
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
      var rangeKm = maxRange(type.ranges.detect);
      var node = {
        id: decl.id, instanceId: decl.id, typeId: decl.typeId,
        name: type.name + ' (' + decl.posKey + ')', category: 'sensor',
        service: decl.forceOwner === 'USFK' ? 'usfk' : 'joint', echelon: 'sensor',
        coord: [pos.lat, pos.lon], coordNote: pos.coordNote,
        role: type.role + ' · 개념 기하 탐지·화력통제 상태',
        detects: type.detectableThreats.slice(), coverage: axesFor(pos, rangeKm),
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
        echelon: 'battery', coord: [pos.lat, pos.lon], coordNote: pos.coordNote,
        role: '원본 책임 C2·PIP·발사대 자원 모델 실행',
        coverage: axesFor(pos, rangeKm),
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
      sensorNodes(['GREEN_PINE_B', 'GREEN_PINE_C']).forEach(function (s) { addLink(links, s.id, kamdoc.id, 'report', LONG, DL_FAST, 'korean_kamd'); });
      iccs.forEach(function (icc) {
        addLink(links, kamdoc.id, icc.id, 'coord', LONG, DL_FAST, 'korean_kamd');
        // The legacy decision stage searches from the reporting/controller C2
        // upward to the approval role.  Preserve the same physical ICC link in
        // both directions; without this return edge every MFR→ECS main track
        // terminates as responsibility_gap before the shooter can be tasked.
        addLink(links, icc.id, kamdoc.id, 'coord', LONG, DL_FAST, 'korean_kamd');
      });
    }
    if (mcrc) {
      sensorNodes(['FPS117']).forEach(function (s) { addLink(links, s.id, mcrc.id, 'report', LONG, DL_FAST, 'korean_mcrc'); });
      iccs.forEach(function (icc) {
        addLink(links, mcrc.id, icc.id, 'coord', LONG, DL_FAST, 'korean_mcrc');
        addLink(links, icc.id, mcrc.id, 'coord', LONG, DL_FAST, 'korean_mcrc');
      });
      // As-Is 군단 AOC는 MCRC 공중항적과 자체 국지레이더 항적을 C2A에서
      // 함께 접수한다. 항적 전파는 16초 개념 데이터링크, 반대 방향의 교전현황은
      // 제한형 음성/VTC 메시지로 분리해 정보의 비대칭을 보존한다.
      localAds.forEach(function (aoc) {
        addLink(links, mcrc.id, aoc.id, 'report', LONG, DL_FAST, 'mcrc_to_corps_aoc_track');
        addLink(links, aoc.id, mcrc.id, 'status', VOICE_STATUS, DL_FAST, 'corps_aoc_engagement_status');
      });
    }
    sensorNodes(['TPS880K']).forEach(function (s) {
      var owner = c2ForPos(s.localAdPosKey);
      if (mcrc) addLink(links, s.id, mcrc.id, 'report', LONG, DL_FAST, 'korean_mcrc');
      if (owner) addLink(links, s.id, owner.id, 'report', INTERNAL, DL_FAST, 'abt_local');
    });

    deployment.batteries.forEach(function (b) {
      var shooterNode = nodeMap[b.id];
      var ecs = ecsByBattery[b.id];
      var sensor = b.mfrSensorPosKey ? nodeMap['SENSOR_' + b.mfrSensorPosKey] : null;
      var upper = c2ForPos(b.commandC2PosKey || b.iccPosKey || b.localAdPosKey);
      if (sensor && ecs) addLink(links, sensor.id, ecs.id, 'report', INTERNAL, DL_FAST, 'battery_mfr');
      if (upper && ecs) {
        var upAsIs = (b.c2Axis === 'LOCAL_AD' || b.forceOwner === 'USFK') ? INTERNAL : SHORT;
        addLink(links, ecs.id, upper.id, 'coord', upAsIs, DL_FAST, b.c2Axis || 'korean');
        addLink(links, upper.id, ecs.id, 'coord', upAsIs, DL_FAST, b.c2Axis || 'korean');
      }
      if (ecs && shooterNode) addLink(links, ecs.id, shooterNode.id, 'command', INTERNAL, INTERNAL, b.c2Axis || 'battery');
    });

    // Root loss in the original model changes the commander to each surviving
    // ICC.  Give the same surveillance picture to those ICC roots; this is a
    // reporting path, not cross-ICC engagement-state sharing.
    if (!kamdoc) {
      sensorNodes(['GREEN_PINE_B', 'GREEN_PINE_C']).forEach(function (s) {
        iccs.forEach(function (icc) { addLink(links, s.id, icc.id, 'report', LONG, DL_FAST, 'korean_kamd'); });
      });
    }
    if (!mcrc) {
      sensorNodes(['FPS117', 'TPS880K']).forEach(function (s) {
        iccs.forEach(function (icc) { addLink(links, s.id, icc.id, 'report', LONG, DL_FAST, 'korean_mcrc'); });
      });
    }

    if (iaoc) {
      nodes.filter(function (n) { return n.category === 'sensor' && n.forceOwner !== 'USFK'; }).forEach(function (s) {
        addLink(links, s.id, iaoc.id, 'report', null, DL_FAST, 'killweb');
      });
      nodes.filter(function (n) { return n.category === 'c2' && n.id !== iaoc.id && n.forceOwner !== 'USFK'; }).forEach(function (c) {
        addLink(links, c.id, iaoc.id, 'report', null, DL_FAST, 'killweb');
        addLink(links, iaoc.id, c.id, 'coord', null, DL_FAST, 'killweb');
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
    cache[id] = catalog;
    return catalog;
  }

  KJ.LEGACY_CATALOG = Object.freeze({
    id: 'legacy', deployment: null, nodes: KJ.NODES, links: KJ.LINKS,
    nodeMap: null, roles: Object.freeze({ fusionC2: 'JAMDC2', KAMDOC: 'KAMDOC', MCRC: 'MCRC', KAOC: 'KAOC' }),
    compatibilityMode: null
  });
  KJ.buildDeploymentCatalog = buildDeploymentCatalog;
  KJ.resolveModelCatalog = function (config) {
    config = config || {};
    var features = config.features || {};
    if (features.highResolutionDeployment !== true) return KJ.LEGACY_CATALOG;
    return buildDeploymentCatalog(config.deploymentId || 'HANBANDO_MINI_NORMAL');
  };
  KJ.resolveRoleId = function (id, catalog) {
    catalog = catalog || KJ.LEGACY_CATALOG;
    return catalog.roles && Object.prototype.hasOwnProperty.call(catalog.roles, id)
      ? catalog.roles[id] : id;
  };
  KJ.nodeById = function (id, catalog) {
    catalog = catalog || KJ.LEGACY_CATALOG;
    if (catalog.nodeMap) return catalog.nodeMap[id] || null;
    return catalog.nodes.find(function (n) { return n.id === id; }) || null;
  };
  KJ.nodesInMode = function (mode, catalog) {
    catalog = catalog || KJ.LEGACY_CATALOG;
    return catalog.nodes.filter(function (n) { return !n.modes || n.modes.indexOf(mode) !== -1; });
  };
  KJ.linksInMode = function (mode, catalog) {
    catalog = catalog || KJ.LEGACY_CATALOG;
    return catalog.links.filter(function (l) { return !!l.comm[mode]; });
  };
})();
