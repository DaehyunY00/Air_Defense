/**
 * K-JAMDS 시뮬레이터 — 요격체계 세분화(Fire-Unit Layer) 데이터 (WP1, ADR-010)
 *
 * 디스클레이머: 모든 수치는 공개자료(OSINT) 기반 정책연구용 추정값이며 실제 편성·배치가 아님.
 * 좌표는 예외 없이 도시 수준 개념좌표(coordNote 필수) — 실제 부대·포대 위치를 특정/암시하지 않음.
 * 근거·출처·등급은 docs/params.md(WPN-ICC/ECS/MFR/TEL-*)·docs/laydown-sources.md 참조.
 *
 * ── 계층 모델(features.fireUnitLayer ON일 때만 활성) ──
 *   [상위 C2: KAMDOC/AOC-1C/JAOC-CD — 변경 없음]
 *      │ command
 *      ▼
 *   ICC (대대급 사격지휘소, category 'c2', kind 'fire-direction')
 *      │ command (예하 포대 지정)
 *      ▼
 *   포대(Battery, category 'battery') = { ECS 콘솔 큐 + MFR 채널 + TEL[] }
 *      · ECS : 포대 사격통제 큐(M/M/c)
 *      · MFR : 동시 추적·조사 채널(실질 동시교전 상한) + 섹터모드 + 자체탐지(WP2)
 *      · TEL : 발사대별 장전 발수(readyRoundsPerTel) + 재장전(reloadSec)
 *
 * ── 대체 관계(legacyOf) ──
 *   집계 shooter(MDU-L·MDU-M·MSAM-1C·SHORAD-1C·SHORAD-CD)를 포대 인스턴스 집합으로 대체한다.
 *   FTR(기동 공중자산)·SM2-E/W(함정)는 battery화하지 않고 집계 유지(판단: ADR-010 "선택지").
 *   canEngage·pk·costPerShotM·wtaSuit·reserveFloor는 legacyOf 노드에서 상속(제약 상속 보장) —
 *   신궁·천마 계열(SHORAD)의 탄도탄 불가가 전 포대 인스턴스에 자동 상속된다(§1 절대규칙 2).
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  // ── 링크 프로토타입(links.js와 동일 개념값 재사용) ──
  var DL = { type: 'datalink', delaySec: 2, paramRef: 'C2-DL-DLY-01' };
  var KVMF = { type: 'kvmf', delaySec: 30, paramRef: 'C2-KVMF-DLY-01' };

  /**
   * 포대 인스턴스 생성기. legacyOf 노드에서 능력·pk·비용·적합도·제약을 상속하고 포대 고유 구성만 덧댄다.
   * @param spec { id, name, legacyOf, iccId, tier, coverage, coord, coordNote, mfr, ecs, tels, engageOverride }
   */
  function battery(spec) {
    var leg = KJ.nodeById(spec.legacyOf);
    if (!leg) throw new Error('fire-units: 알 수 없는 legacyOf ' + spec.legacyOf);
    var readyTotal = (spec.tels.count || 0) * (spec.tels.readyRoundsPerTel || 0);
    // 교전창(window) 필터용 대표 소요시간 = MFR 조사점유 + ECS 처리(As-Is) + 홉 여유(개념)
    var leadBudget = (spec.mfr.illumTimeSec || 0) + ((spec.ecs.serviceTimeSec && spec.ecs.serviceTimeSec.asis) || 0) + 8;
    var eng = {
      channels: spec.mfr.channels,
      engageTimeSec: leadBudget,
      // 상속: pk·비용·재고보존은 legacyOf에서. 재고(magazine)는 발사대 물리(Σ readyRounds)로 재정의.
      pk: leg.engage.pk,
      costPerShotM: leg.engage.costPerShotM,
      costRef: leg.engage.costRef,
      magazine: readyTotal, magRef: 'WPN-TEL-01'
    };
    if (leg.engage.reserveFloor) eng.reserveFloor = leg.engage.reserveFloor; // 고위협 보존 상속(To-Be)
    if (spec.engageOverride) for (var k in spec.engageOverride) eng[k] = spec.engageOverride[k];
    return {
      id: spec.id, name: spec.name, category: 'battery',
      legacyOf: spec.legacyOf, icc: spec.iccId, parentC2Ref: leg.controlledBy,
      tier: spec.tier, coverage: spec.coverage.slice(),
      coord: spec.coord, coordNote: spec.coordNote,
      // 제약·능력 상속(신궁·천마 탄도탄 불가 등) — canEngage는 legacyOf 그대로(변경 금지)
      canEngage: leg.canEngage,
      wtaSuit: leg.wtaSuit,
      // controlledBy: coordCheck·WTA 호환을 위해 상위 C2(legacyOf 통제계통) 유지. 실제 명령 경로는 icc 경유.
      controlledBy: { asis: leg.controlledBy.asis.slice(), tobe: leg.controlledBy.tobe.slice() },
      constraintRefs: leg.constraintRefs ? leg.constraintRefs.slice() : undefined,
      ecs: spec.ecs,
      mfr: spec.mfr,
      tels: spec.tels,
      engage: eng,
      modes: spec.modes // 생략 시 공통
    };
  }

  /** ICC(대대급 사격지휘) 노드 — category 'c2', fireKind 'fire-direction'. 상위 C2가 통제. */
  function icc(spec) {
    return {
      id: spec.id, name: spec.name, category: 'c2', service: spec.service, echelon: 'tactical',
      fireKind: 'fire-direction', isICC: true,
      coord: spec.coord, coordNote: spec.coordNote,
      role: spec.role,
      controlledBy: spec.controlledBy, // 상위 C2 (command 상위 홉)
      queue: { servers: spec.servers, serviceTimeSec: spec.serviceTimeSec, capacity: spec.capacity, paramRef: 'C2-ICC-SVC-01' }
    };
  }

  // ══════════════════════ ICC (대대급 사격지휘소) ══════════════════════
  var ICCS = [
    // 탄도탄 대응 대대(L-SAM·MD)는 사격지휘가 준자동(짧은 서비스) — 탄도 체공창(90s)이 좁기 때문.
    // 값은 근거 C(유사 체계 유추), 스윕 대상(params.md C2-ICC-SVC-01).
    icc({ id: 'ICC-LSAM', name: 'L-SAM 대대 사격지휘소 (ICC·개념)', service: 'af',
      coord: [36.80, 127.15], coordNote: '중부권 도시 수준 개념좌표(상층 MD 대대)',
      role: '상층 탄도탄 요격 대대 사격지휘. 예하 L-SAM 포대 배정.', controlledBy: { asis: ['KAMDOC'], tobe: ['KAMDOC'] },
      servers: 2, serviceTimeSec: { asis: 8, tobe: 4 }, capacity: 20 }),
    icc({ id: 'ICC-MDUM', name: '중거리 MD 대대 사격지휘소 (ICC·개념)', service: 'af',
      coord: [37.15, 127.07], coordNote: '수도권 남부 도시 수준 개념좌표(하층 MD 대대)',
      role: '하층 탄도탄·항공 요격 대대 사격지휘. 예하 천궁-II/PAC-3 포대 배정.', controlledBy: { asis: ['KAMDOC'], tobe: ['KAMDOC'] },
      servers: 2, serviceTimeSec: { asis: 8, tobe: 4 }, capacity: 20 }),
    icc({ id: 'ICC-MSAM1C', name: '군단 중거리방공 대대 사격지휘소 (ICC·개념)', service: 'army',
      coord: [37.60, 126.78], coordNote: '군단권역 도시 수준 개념좌표',
      role: '군단 중거리방공 대대 사격지휘. 예하 천궁 포대 배정.', controlledBy: { asis: ['AOC-1C'], tobe: ['AOC-1C'] },
      servers: 2, serviceTimeSec: { asis: 22, tobe: 10 }, capacity: 15 }),
    icc({ id: 'ICC-SH1C', name: '군단 단거리방공 대대 사격지휘소 (ICC·개념)', service: 'army',
      coord: [37.72, 126.80], coordNote: '고양·파주권 도시 수준 개념좌표',
      role: '군단 단거리방공 대대 사격지휘(신궁·천마·비호·벌컨). 예하 SHORAD 포대 배정.', controlledBy: { asis: ['AOC-1C'], tobe: ['AOC-1C'] },
      servers: 2, serviceTimeSec: { asis: 20, tobe: 10 }, capacity: 15 }),
    icc({ id: 'ICC-SHCD', name: '수방사 단거리방공 대대 사격지휘소 (ICC·개념)', service: 'army',
      coord: [37.58, 126.95], coordNote: '서울 도시 수준 개념좌표',
      role: '수도권 단거리방공 대대 사격지휘. 예하 SHORAD 포대 배정.', controlledBy: { asis: ['JAOC-CD'], tobe: ['JAOC-CD'] },
      servers: 2, serviceTimeSec: { asis: 20, tobe: 10 }, capacity: 12 })
  ];

  // 개념 ECS 구성(공통 프로토타입) — 근거 C(유사 체계 유추), 스윕 대상(params.md C2-ECS-SVC-01)
  // MD 포대 ECS는 탄도 대응 준자동(짧은 콘솔 처리). SHORAD는 약간 김(수동 조준 성격).
  var ECS_MD = { servers: 2, serviceTimeSec: { asis: 6, tobe: 3 }, capacity: 10 };
  var ECS_SHORAD = { servers: 2, serviceTimeSec: { asis: 8, tobe: 4 }, capacity: 8 };

  // ══════════════════════ 포대(Battery) — 개념 laydown(무공백 목표) ══════════════════════
  var BATTERIES = [
    // ── 상층(upper) L-SAM: MDU-L 대체. 탄도탄 전용·섹터 지향. 2개 포대로 전 축선 탄도 커버 ──
    battery({ id: 'MDU-L-BTY-1', name: 'L-SAM 포대 #1 (개념)', legacyOf: 'MDU-L', iccId: 'ICC-LSAM',
      tier: 'upper', coverage: ['west', 'central', 'seoul'],
      coord: [36.82, 127.10], coordNote: '중부권 도시 수준 개념좌표',
      mfr: { channels: 3, illumTimeSec: 40, sectorMode: 'ballistic-sector', detects: ['srbm', 'mrl_large'], detectProb: { value: 0.9, paramRef: 'SEN-MFR-PD-01' }, rangeKm: 150, paramRef: 'WPN-MFR-CH-01' },
      ecs: ECS_MD, tels: { count: 2, readyRoundsPerTel: 6, reloadSec: 1800, paramRef: 'WPN-TEL-01' } }),
    battery({ id: 'MDU-L-BTY-2', name: 'L-SAM 포대 #2 (개념)', legacyOf: 'MDU-L', iccId: 'ICC-LSAM',
      tier: 'upper', coverage: ['central', 'east', 'seoul'],
      coord: [36.90, 127.60], coordNote: '중부 내륙 도시 수준 개념좌표',
      mfr: { channels: 3, illumTimeSec: 40, sectorMode: 'ballistic-sector', detects: ['srbm', 'mrl_large'], detectProb: { value: 0.9, paramRef: 'SEN-MFR-PD-01' }, rangeKm: 150, paramRef: 'WPN-MFR-CH-01' },
      ecs: ECS_MD, tels: { count: 2, readyRoundsPerTel: 6, reloadSec: 1800, paramRef: 'WPN-TEL-01' } }),

    // ── 중층(mid) 천궁-II/PAC-3: MDU-M 대체. 탄도+항공(360 모드). 2개 포대 ──
    battery({ id: 'MDU-M-BTY-1', name: '천궁-II/PAC-3 포대 #1 (개념)', legacyOf: 'MDU-M', iccId: 'ICC-MDUM',
      tier: 'mid', coverage: ['west', 'seoul'],
      coord: [37.10, 126.95], coordNote: '수도권 남서부 도시 수준 개념좌표',
      mfr: { channels: 4, illumTimeSec: 45, sectorMode: '360', detects: ['srbm', 'mrl_large', 'cruise', 'fighter'], detectProb: { value: 0.85, paramRef: 'SEN-MFR-PD-01' }, rangeKm: 40, paramRef: 'WPN-MFR-CH-01' },
      ecs: ECS_MD, tels: { count: 3, readyRoundsPerTel: 8, reloadSec: 1500, paramRef: 'WPN-TEL-01' } }),
    battery({ id: 'MDU-M-BTY-2', name: '천궁-II/PAC-3 포대 #2 (개념)', legacyOf: 'MDU-M', iccId: 'ICC-MDUM',
      tier: 'mid', coverage: ['central', 'seoul'],
      coord: [37.20, 127.20], coordNote: '수도권 남부 도시 수준 개념좌표',
      mfr: { channels: 4, illumTimeSec: 45, sectorMode: '360', detects: ['srbm', 'mrl_large', 'cruise', 'fighter'], detectProb: { value: 0.85, paramRef: 'SEN-MFR-PD-01' }, rangeKm: 40, paramRef: 'WPN-MFR-CH-01' },
      ecs: ECS_MD, tels: { count: 3, readyRoundsPerTel: 8, reloadSec: 1500, paramRef: 'WPN-TEL-01' } }),

    // ── 중층(mid) 군단 천궁: MSAM-1C 대체. 항공 전용(탄도 불가). 1개 포대 ──
    battery({ id: 'MSAM-1C-BTY-1', name: '군단 천궁 포대 #1 (개념)', legacyOf: 'MSAM-1C', iccId: 'ICC-MSAM1C',
      tier: 'mid', coverage: ['west', 'seoul', 'central'],
      coord: [37.60, 126.80], coordNote: '군단권역 도시 수준 개념좌표',
      mfr: { channels: 2, illumTimeSec: 90, sectorMode: '360', detects: ['fighter', 'cruise', 'ac_low', 'heli'], detectProb: { value: 0.8, paramRef: 'SEN-MFR-PD-01' }, rangeKm: 40, paramRef: 'WPN-MFR-CH-01' },
      ecs: ECS_MD, tels: { count: 3, readyRoundsPerTel: 8, reloadSec: 1500, paramRef: 'WPN-TEL-01' } }),

    // ── 하층(low) SHORAD 군단: SHORAD-1C 대체. 저고도. 탄도 불가(신궁·천마 제약 상속). 2개 포대 ──
    battery({ id: 'SHORAD-1C-BTY-1', name: '군단 단거리방공 포대 #1 (개념)', legacyOf: 'SHORAD-1C', iccId: 'ICC-SH1C',
      tier: 'low', coverage: ['west', 'seoul'],
      coord: [37.72, 126.82], coordNote: '고양·파주권 도시 수준 개념좌표',
      mfr: { channels: 4, illumTimeSec: 60, sectorMode: '360', detects: ['uav_small', 'ac_low', 'heli', 'cruise'], detectProb: { value: 0.55, paramRef: 'SEN-MFR-PD-01' }, rangeKm: 7, paramRef: 'WPN-MFR-CH-01' },
      ecs: ECS_SHORAD, tels: { count: 4, readyRoundsPerTel: 8, reloadSec: 900, paramRef: 'WPN-TEL-01' } }),
    battery({ id: 'SHORAD-1C-BTY-2', name: '군단 단거리방공 포대 #2 (개념)', legacyOf: 'SHORAD-1C', iccId: 'ICC-SH1C',
      tier: 'low', coverage: ['west'],
      coord: [37.66, 126.86], coordNote: '고양권 도시 수준 개념좌표',
      mfr: { channels: 4, illumTimeSec: 60, sectorMode: '360', detects: ['uav_small', 'ac_low', 'heli', 'cruise'], detectProb: { value: 0.55, paramRef: 'SEN-MFR-PD-01' }, rangeKm: 7, paramRef: 'WPN-MFR-CH-01' },
      ecs: ECS_SHORAD, tels: { count: 4, readyRoundsPerTel: 8, reloadSec: 900, paramRef: 'WPN-TEL-01' } }),

    // ── 하층(low) SHORAD 수방사: SHORAD-CD 대체. 서울 점방어. 탄도 불가. 1개 포대 ──
    battery({ id: 'SHORAD-CD-BTY-1', name: '수방사 단거리방공 포대 #1 (개념)', legacyOf: 'SHORAD-CD', iccId: 'ICC-SHCD',
      tier: 'low', coverage: ['seoul'],
      coord: [37.56, 126.98], coordNote: '서울 도시 수준 개념좌표',
      mfr: { channels: 4, illumTimeSec: 60, sectorMode: '360', detects: ['uav_small', 'ac_low', 'heli', 'cruise'], detectProb: { value: 0.55, paramRef: 'SEN-MFR-PD-01' }, rangeKm: 7, paramRef: 'WPN-MFR-CH-01' },
      ecs: ECS_SHORAD, tels: { count: 3, readyRoundsPerTel: 8, reloadSec: 900, paramRef: 'WPN-TEL-01' } })
  ];

  KJ.FIRE_UNITS = ICCS.concat(BATTERIES);

  // ── FIRE_LINKS: 상위 C2 → ICC(command) · ICC → 포대(command). fireUnitLayer ON일 때만 참조. ──
  var FIRE_LINKS = [];
  ICCS.forEach(function (ic) {
    var up = ic.controlledBy.asis[0];
    // 상위 C2 → ICC: MD 계열(KAMDOC)은 데이터링크, 육군 계열(AOC/JAOC)은 As-Is KVMF·To-Be 데이터링크
    var isArmy = ic.service === 'army';
    FIRE_LINKS.push({ from: up, to: ic.id, kind: 'command', comm: { asis: isArmy ? KVMF : DL, tobe: DL } });
  });
  BATTERIES.forEach(function (b) {
    var isArmy = KJ.nodeById(b.legacyOf).service === 'army';
    FIRE_LINKS.push({ from: b.icc, to: b.id, kind: 'command', comm: { asis: isArmy ? KVMF : DL, tobe: DL } });
  });
  KJ.FIRE_LINKS = FIRE_LINKS;

  /** 모드 활성 fire-unit(ICC+battery). modes 미지정이면 공통. */
  KJ.fireUnitsInMode = function (mode) {
    return KJ.FIRE_UNITS.filter(function (u) { return !u.modes || u.modes.indexOf(mode) !== -1; });
  };

  // KJ.nodeById 확장 — 활성 여부와 무관하게 fire-unit id도 해석(엔진 _node 폴백·leakTaxonomy·링크).
  // OFF 실행은 fire-unit id를 절대 참조하지 않으므로 결과 불변(추가 항목은 조회에만 존재).
  var _origById = KJ.nodeById;
  KJ.nodeById = function (id) {
    return _origById(id) || KJ.FIRE_UNITS.find(function (u) { return u.id === id; }) || null;
  };

  /**
   * fire-unit 데이터 정합 검증(작업지시서 §3-2):
   *  (a) 모든 battery.canEngage === legacyOf.canEngage (제약 상속)
   *  (b) Σ readyRounds ≤ legacy magazine (이중계상 금지)
   *  (c) 신궁·천마 계열(SHORAD) battery 탄도탄 불가 유지
   *  (d) 전 battery coord에 '개념' coordNote 존재
   * @returns { ok, errors[] }
   */
  KJ.validateFireUnits = function () {
    var errors = [];
    var readyByLegacy = {};
    BATTERIES.forEach(function (b) {
      var leg = _origById(b.legacyOf);
      // (a) 제약 상속
      if (leg) {
        Object.keys(leg.canEngage).forEach(function (k) {
          if (b.canEngage[k] !== leg.canEngage[k]) errors.push('(a) ' + b.id + ' canEngage.' + k + ' ≠ legacyOf');
        });
      }
      // (c) SHORAD(신궁·천마) 탄도 불가
      if (b.legacyOf.indexOf('SHORAD') === 0) {
        if (b.canEngage.srbm !== false || b.canEngage.mrl_large !== false)
          errors.push('(c) ' + b.id + ' 신궁·천마 계열 탄도탄 불가 위반');
      }
      // (d) 개념 coordNote
      if (!Array.isArray(b.coord) || b.coord.length !== 2 || typeof b.coordNote !== 'string' || b.coordNote.indexOf('개념') === -1)
        errors.push('(d) ' + b.id + ' 개념 coordNote 누락');
      readyByLegacy[b.legacyOf] = (readyByLegacy[b.legacyOf] || 0) + (b.tels.count || 0) * (b.tels.readyRoundsPerTel || 0);
    });
    // (b) Σ readyRounds ≤ legacy magazine
    Object.keys(readyByLegacy).forEach(function (lid) {
      var leg = _origById(lid);
      var mag = leg && leg.engage && leg.engage.magazine;
      if (isFinite(mag) && readyByLegacy[lid] > mag)
        errors.push('(b) ' + lid + ' ΣreadyRounds ' + readyByLegacy[lid] + ' > magazine ' + mag);
    });
    return { ok: errors.length === 0, errors: errors };
  };

  /**
   * 커버리지 매트릭스 검증(§3-3-3): 모든 (축선 × 위협 altBand)에 대해 그 위협을 canEngage+coverage
   * 하는 활성 shooter(집계 shooter 유지분 + battery)가 1개 이상 존재하는지. 의도된 공백은 allow 목록.
   * @param mode 'asis'|'tobe'
   * @returns { ok, gaps[] }
   */
  KJ.checkCoverageMatrix = function (mode) {
    var axes = Object.keys(KJ.AXES);
    var types = Object.keys(KJ.THREAT_TYPES);
    // ON 활성 shooter 집합 = (집계 shooter 중 대체 안 된 것) + battery
    var replaced = {};
    KJ.fireUnitsInMode(mode).forEach(function (u) { if (u.legacyOf) replaced[u.legacyOf] = true; });
    var aggr = KJ.nodesInMode(mode).filter(function (n) { return n.category === 'shooter' && !replaced[n.id]; });
    var bats = KJ.fireUnitsInMode(mode).filter(function (u) { return u.category === 'battery'; });
    var shooters = aggr.concat(bats);
    // 의도된 공백 허용 목록(사유 주석): 현재 시나리오·laydown에서 실제 공백은 없음. 향후 확장 대비 구조만.
    var ALLOW = {}; // 예: 'uav_small@east': '중부·동부 무인기 전용 SHORAD 부재 — FTR 백스톱으로 커버됨'
    var gaps = [];
    types.forEach(function (ty) {
      axes.forEach(function (ax) {
        var covered = shooters.some(function (s) {
          if (!s.canEngage[ty]) return false;
          if (s.coverage && s.coverage.indexOf(ax) === -1) return false;
          if (s.category === 'battery' && s.mfr && s.mfr.sectorMode === 'ballistic-sector') {
            if (KJ.threatType(ty).altBand !== 'ballistic') return false;
          }
          return true;
        });
        if (!covered && !ALLOW[ty + '@' + ax]) gaps.push(ty + '@' + ax);
      });
    });
    return { ok: gaps.length === 0, gaps: gaps };
  };

  // ── 프리셋(작업지시서 §1 규칙 3) — 최대 충실도 실행용 ──
  // 두 신규 플래그(fireUnitLayer·selfDefense)와 재고·보존을 켠 조합. 기본 실행은 여전히 전부 OFF.
  KJ.PRESETS = KJ.PRESETS || {};
  KJ.PRESETS.highFidelity = {
    fireUnitLayer: true, selfDefense: true, magazine: true, reserveFloor: true
  };
})();
