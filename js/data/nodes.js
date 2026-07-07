/**
 * K-JAMDS C2 병목 분석 시뮬레이터 — 노드 데이터 정의 (Phase 1)
 *
 * 디스클레이머: 모든 수치·좌표는 공개자료 기반 정책연구용 개념값이며 실제 작전자료가 아님.
 * 모든 좌표는 도시 수준 개념좌표임(coordNote 필수).
 *
 * 노드 카테고리:
 *  - c2      : 지휘통제 노드 (대기행렬 서버로 모델링: servers c, serviceTimeSec μ⁻¹, capacity K)
 *  - sensor  : 탐지·추적 센서 (detects: 탐지 가능 위협 클래스, coverage: 담당 축선)
 *  - shooter : 교전 무기체계 (canEngage: 위협 클래스별 교전 가능 여부 — 제약조건 포함)
 *
 * modes: 노드가 존재하는 시나리오 모드. 생략 시 ['asis','tobe'] 공통.
 * queue.serviceTimeSec: 항적 1건 처리시간(초). asis/tobe 구분. 신뢰도 등급은 docs/params.md 참조.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  KJ.NODES = [
    // ══════════════════════ C2 노드 ══════════════════════
    {
      id: 'KAOC', name: '한국항공우주작전본부 (KAOC)',
      category: 'c2', service: 'joint', echelon: 'theater',
      coord: [36.96, 127.02], coordNote: '평택·오산권 도시 수준 개념좌표',
      role: '전구 항공우주작전 최상위 지휘. 방공작전 전반 감독, 공역통제·교전규칙 승인.',
      queue: {
        servers: 3,
        serviceTimeSec: { asis: 40, tobe: 15 },
        capacity: 30,
        paramRef: 'C2-KAOC-SVC-01'
      }
    },
    {
      id: 'MCRC', name: '중앙방공통제소 (MCRC)',
      category: 'c2', service: 'af', echelon: 'operational',
      coord: [37.00, 127.05], coordNote: '오산권 도시 수준 개념좌표',
      role: 'KADIZ 전역 공중감시·식별·통제. 항공기·순항미사일·무인기 항적 처리 및 요격기 통제.',
      queue: {
        servers: 4,
        serviceTimeSec: { asis: 30, tobe: 12 },
        capacity: 40,
        paramRef: 'C2-MCRC-SVC-01'
      }
    },
    {
      id: 'KAMDOC', name: 'KAMD작전센터 (KAMDOC)',
      category: 'c2', service: 'af', echelon: 'operational',
      coord: [36.92, 127.08], coordNote: '오산권 도시 수준 개념좌표',
      role: '대탄도탄 작전 지휘(구 KTMO-Cell). 탄도탄 항적 처리·요격무기 배정. THAAD 연동은 모델링하지 않음.',
      queue: {
        servers: 3,
        serviceTimeSec: { asis: 25, tobe: 10 },
        capacity: 30,
        paramRef: 'C2-KAMDOC-SVC-01'
      }
    },
    {
      id: 'AOC-1C', name: '군단 방공상황실 (1군단 AOC)',
      category: 'c2', service: 'army', echelon: 'tactical',
      coord: [37.66, 126.83], coordNote: '고양권 도시 수준 개념좌표',
      role: '군단 국지방공 지휘(ADC2A). 예하 중·단거리 방공무기 통제. As-Is에서 MCRC와 데이터링크 미연동.',
      queue: {
        servers: 2,
        serviceTimeSec: { asis: 45, tobe: 15 },
        capacity: 15,
        paramRef: 'C2-AOC-SVC-01'
      }
    },
    {
      id: 'JAOC-CD', name: '수방사 합동방공상황실 (JAOC)',
      category: 'c2', service: 'army', echelon: 'tactical',
      coord: [37.50, 127.00], coordNote: '서울 도시 수준 개념좌표',
      role: '수도권 방공작전 지휘. 수도 핵심시설 방호, 예하 단거리 방공무기 통제.',
      queue: {
        servers: 2,
        serviceTimeSec: { asis: 40, tobe: 15 },
        capacity: 15,
        paramRef: 'C2-AOC-SVC-01'
      }
    },
    {
      id: 'JAMDC2', name: '합동방공지휘통제 (JAMDC2 · Track Fusion)',
      category: 'c2', service: 'joint', echelon: 'operational',
      coord: [36.96, 127.12], coordNote: '오산권 도시 수준 개념좌표 (To-Be 개념 노드)',
      role: 'To-Be K-JAMDS 핵심: 다중센서 항적융합(Track Fusion) → AI 기반 식별·분류 → 무기 배정(Any Sensor, Best Shooter).',
      modes: ['tobe'],
      fusion: true,
      queue: {
        servers: 6,
        serviceTimeSec: { tobe: 8 },
        capacity: 60,
        paramRef: 'C2-JAMDC2-SVC-01'
      }
    },

    // ══════════════════════ 센서 (관제부대 포함) ══════════════════════
    {
      id: 'JASP-W', name: '합동대공감시소 (서부축)',
      category: 'sensor', service: 'joint', echelon: 'tactical',
      coord: [37.76, 126.78], coordNote: '파주권 도시 수준 개념좌표',
      role: '육안·광학 관측 기반 대공감시. 저고도 침투 항적 음성보고.',
      detects: ['uav_small', 'ac_low', 'heli', 'cruise'],
      coverage: ['west', 'seoul'],
      detectProb: { paramRef: 'SEN-JASP-PD-01' }
    },
    {
      id: 'ACR-E', name: '방공관제레이더 (동부축)',
      category: 'sensor', service: 'af', echelon: 'operational',
      coord: [37.75, 128.90], coordNote: '강릉권 도시 수준 개념좌표',
      role: '중·고고도 광역 방공관제레이더. MCRC에 항적 자동 전송.',
      detects: ['fighter', 'ac_low', 'cruise', 'heli'],
      coverage: ['east', 'central'],
      detectProb: { paramRef: 'SEN-ACR-PD-01' }
    },
    {
      id: 'ACR-W', name: '방공관제레이더 (서부축)',
      category: 'sensor', service: 'af', echelon: 'operational',
      coord: [37.45, 126.60], coordNote: '인천권 도시 수준 개념좌표',
      role: '중·고고도 광역 방공관제레이더. MCRC에 항적 자동 전송.',
      detects: ['fighter', 'ac_low', 'cruise', 'heli'],
      coverage: ['west', 'seoul'],
      detectProb: { paramRef: 'SEN-ACR-PD-01' }
    },
    {
      id: 'LAR-C', name: '저고도 탐지레이더 (중부축)',
      category: 'sensor', service: 'af', echelon: 'tactical',
      coord: [38.15, 127.31], coordNote: '철원권 도시 수준 개념좌표',
      role: '전방(철원권) 저고도 침투 항적 탐지 전용 레이더. 전방축선 담당, 수도권 종심은 미담당.',
      detects: ['uav_small', 'ac_low', 'heli', 'cruise'],
      coverage: ['central'],
      detectProb: { paramRef: 'SEN-LAR-PD-01' }
    },
    {
      id: 'LLR-1C', name: '국지방공레이더 (1군단)',
      category: 'sensor', service: 'army', echelon: 'tactical',
      coord: [37.70, 126.86], coordNote: '고양권 도시 수준 개념좌표',
      role: '군단 국지방공레이더(TPS-880K급 개념). 2022.12.26 무인기 최초 포착 주체. As-Is에서 항적이 국가방공체계에 미통합.',
      detects: ['uav_small', 'ac_low', 'heli'],
      coverage: ['west', 'seoul'],
      detectProb: { paramRef: 'THR-UAV-RCS-01' }
    },
    {
      id: 'LLR-CD', name: '국지방공레이더 (수방사)',
      category: 'sensor', service: 'army', echelon: 'tactical',
      coord: [37.55, 126.97], coordNote: '서울 도시 수준 개념좌표',
      role: '수도권 국지방공레이더. JAOC에 항적 전송.',
      detects: ['uav_small', 'ac_low', 'heli'],
      coverage: ['seoul'],
      detectProb: { paramRef: 'THR-UAV-RCS-01' }
    },
    {
      id: 'E737', name: 'E-737 항공통제기 (피스아이)',
      category: 'sensor', service: 'af', echelon: 'operational',
      coord: [37.20, 127.90], coordNote: '중부 내륙 상공 개념 궤도점 (도시 수준)',
      role: '공중조기경보통제기. 광역 하향탐지, Link-16으로 MCRC·KAOC에 항적 전파. 2m급 소형 무인기는 저RCS·지상클러터로 탐지 제한(SEN-E737-PD-01).',
      detects: ['fighter', 'ac_low', 'cruise', 'heli'],
      coverage: ['west', 'central', 'east', 'seoul'],
      detectProb: { paramRef: 'SEN-E737-PD-01' }
    },
    {
      id: 'GPR', name: '탄도탄 감시레이더 (그린파인)',
      category: 'sensor', service: 'af', echelon: 'operational',
      coord: [36.64, 127.49], coordNote: '충청권 도시 수준 개념좌표',
      role: '탄도탄 조기경보 전용 레이더. KAMDOC에 탄도탄 항적 전송.',
      detects: ['srbm', 'mrl_large'],
      coverage: ['west', 'central', 'east'],
      detectProb: { paramRef: 'SEN-GPR-PD-01' }
    },
    {
      id: 'AEGIS-E', name: '이지스함 레이더 (동해)',
      category: 'sensor', service: 'navy', echelon: 'operational',
      coord: [37.80, 129.60], coordNote: '동해상 개념 초계구역 (도시 수준)',
      role: 'SPY-1D(V) 레이더. 탄도탄·항공 항적 탐지, Link-16 전파. SM-2 모기지.',
      detects: ['srbm', 'mrl_large', 'fighter', 'cruise'],
      coverage: ['east', 'central'],
      detectProb: { paramRef: 'SEN-SPY1-PD-01' }
    },
    {
      id: 'AEGIS-W', name: '이지스함 레이더 (서해)',
      category: 'sensor', service: 'navy', echelon: 'operational',
      coord: [36.80, 125.80], coordNote: '서해상 개념 초계구역 (도시 수준)',
      role: 'SPY-1D(V) 레이더. 탄도탄·항공 항적 탐지, Link-16 전파. SM-2 모기지.',
      detects: ['srbm', 'mrl_large', 'fighter', 'cruise'],
      coverage: ['west', 'seoul'],
      detectProb: { paramRef: 'SEN-SPY1-PD-01' }
    },

    // ══════════════════════ 무기체계 (Shooter) ══════════════════════
    {
      id: 'FTR', name: '전투기 (KF-16·F-15K·KF-21 보라매)',
      category: 'shooter', service: 'af', echelon: 'operational',
      coord: [36.99, 127.88], coordNote: '중부 공군기지권 도시 수준 개념좌표',
      role: '요격기 긴급출격(스크램블)·초계. 공중 위협 교전. KF-21은 국산 4.5세대 보라매(인도수출형 F-21 아님).',
      controlledBy: { asis: ['MCRC'], tobe: ['MCRC'] },
      canEngage: { fighter: true, ac_low: true, heli: true, cruise: true, uav_small: true, srbm: false, mrl_large: false },
      engage: { channels: 4, engageTimeSec: 300, pk: { paramRef: 'WPN-FTR-PK-01' } }
    },
    {
      id: 'SHORAD-1C', name: '단거리방공무기 (1군단: 신궁·천마·비호·벌컨)',
      category: 'shooter', service: 'army', echelon: 'tactical',
      coord: [37.72, 126.80], coordNote: '고양·파주권 도시 수준 개념좌표',
      role: '군단 저고도 방공. 제약: KP-SAM(신궁)·천마(K-31)는 탄도탄 요격 불가. 벌컨 유효고도 2km 한계.',
      controlledBy: { asis: ['AOC-1C'], tobe: ['AOC-1C'] },
      canEngage: { fighter: true, ac_low: true, heli: true, cruise: true, uav_small: true, srbm: false, mrl_large: false },
      engage: { channels: 6, engageTimeSec: 60, pk: { paramRef: 'WPN-SHORAD-PK-01' } },
      constraintRefs: ['WPN-SHIN-CON-01', 'C2-VULCAN-CEIL-01']
    },
    {
      id: 'SHORAD-CD', name: '단거리방공무기 (수방사)',
      category: 'shooter', service: 'army', echelon: 'tactical',
      coord: [37.58, 126.95], coordNote: '서울 도시 수준 개념좌표',
      role: '수도권 저고도 방공(신궁·벌컨·드론건 개념). 탄도탄 요격 불가 제약 동일.',
      controlledBy: { asis: ['JAOC-CD'], tobe: ['JAOC-CD'] },
      canEngage: { fighter: true, ac_low: true, heli: true, cruise: true, uav_small: true, srbm: false, mrl_large: false },
      engage: { channels: 4, engageTimeSec: 60, pk: { paramRef: 'WPN-SHORAD-PK-01' } },
      constraintRefs: ['WPN-SHIN-CON-01']
    },
    {
      id: 'MSAM-1C', name: '중거리 방공무기 (군단권역: 천궁 계열)',
      category: 'shooter', service: 'army', echelon: 'tactical',
      coord: [37.60, 126.78], coordNote: '군단권역 도시 수준 개념좌표',
      role: '군단 AOC 통제 중거리 방공(개념). 항공기·순항미사일 대응.',
      controlledBy: { asis: ['AOC-1C'], tobe: ['AOC-1C'] },
      canEngage: { fighter: true, ac_low: true, heli: true, cruise: true, uav_small: false, srbm: false, mrl_large: false },
      engage: { channels: 2, engageTimeSec: 90, pk: { paramRef: 'WPN-MSAM2-PK-01' } }
    },
    {
      id: 'MDU-M', name: '미사일방어부대 (중거리: 천궁-II·PAC-3)',
      category: 'shooter', service: 'af', echelon: 'operational',
      coord: [37.15, 127.07], coordNote: '수도권 남부 도시 수준 개념좌표',
      role: '하층 탄도탄 요격(요격고도 15–20km급) 및 항공 위협 대응.',
      controlledBy: { asis: ['KAMDOC'], tobe: ['KAMDOC'] },
      canEngage: { fighter: true, ac_low: false, heli: false, cruise: true, uav_small: false, srbm: true, mrl_large: true },
      engage: { channels: 4, engageTimeSec: 45, pk: { paramRef: 'WPN-MSAM2-PK-01' } }
    },
    {
      id: 'MDU-L', name: '미사일방어부대 (장거리: L-SAM)',
      category: 'shooter', service: 'af', echelon: 'operational',
      coord: [36.80, 127.15], coordNote: '중부권 도시 수준 개념좌표',
      role: '상층 탄도탄 요격(요격고도 40–70km 개념값).',
      controlledBy: { asis: ['KAMDOC'], tobe: ['KAMDOC'] },
      canEngage: { fighter: false, ac_low: false, heli: false, cruise: false, uav_small: false, srbm: true, mrl_large: true },
      engage: { channels: 3, engageTimeSec: 40, pk: { paramRef: 'WPN-LSAM-PK-01' } }
    },
    {
      id: 'SM2-E', name: 'SM-2 (동해 이지스함)',
      category: 'shooter', service: 'navy', echelon: 'operational',
      coord: [37.75, 129.55], coordNote: '동해상 개념 초계구역 (도시 수준)',
      role: '함대공 요격. 항공기·순항미사일 대응(대탄도탄 요격은 모델링 제외).',
      controlledBy: { asis: ['MCRC'], tobe: ['MCRC'] },
      canEngage: { fighter: true, ac_low: true, heli: true, cruise: true, uav_small: false, srbm: false, mrl_large: false },
      engage: { channels: 2, engageTimeSec: 50, pk: { paramRef: 'WPN-SM2-PK-01' } }
    },
    {
      id: 'SM2-W', name: 'SM-2 (서해 이지스함)',
      category: 'shooter', service: 'navy', echelon: 'operational',
      coord: [36.75, 125.85], coordNote: '서해상 개념 초계구역 (도시 수준)',
      role: '함대공 요격. 항공기·순항미사일 대응(대탄도탄 요격은 모델링 제외).',
      controlledBy: { asis: ['MCRC'], tobe: ['MCRC'] },
      canEngage: { fighter: true, ac_low: true, heli: true, cruise: true, uav_small: false, srbm: false, mrl_large: false },
      engage: { channels: 2, engageTimeSec: 50, pk: { paramRef: 'WPN-SM2-PK-01' } }
    }
  ];

  KJ.nodeById = function (id) {
    return KJ.NODES.find(function (n) { return n.id === id; }) || null;
  };

  KJ.nodesInMode = function (mode) {
    return KJ.NODES.filter(function (n) {
      return !n.modes || n.modes.indexOf(mode) !== -1;
    });
  };
})();
