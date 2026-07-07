/**
 * K-JAMDS 시뮬레이터 — 위협 유형 정의 (Phase 1)
 *
 * 위협 클래스 키는 노드의 detects/canEngage 키와 일치해야 함.
 * detectFactor: 센서 스캔당 탐지 용이성(0~1 개념값). 낮을수록 재탐지·항적소실 반복
 *   → 분석 모듈에서 항적 재생성 부하 배수(1/detectFactor 상한 적용)로 반영.
 * approvalLevel: As-Is에서 교전승인이 요구되는 상위 제대(병목 후보를 '고정'하는 것이 아니라
 *   승인 경로에 부하를 부과할 뿐이며, 실제 병목 여부는 시나리오 부하 분석으로 도출됨).
 * dwellSec: 위협이 요격 가능 공역에 머무는 시간 창(개념값, 초). 이 시간 내 격추하지 못하면
 *   누수(leak)로 처리 — DES 엔진(Phase 2)의 교전기회 상실 판정에 사용. 탄도탄은 비행시간이
 *   짧아 창이 좁고(승인 지연이 곧 요격기회 상실), 저속 무인기는 창이 넓다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  KJ.THREAT_TYPES = {
    uav_small: {
      key: 'uav_small', name: '소형 무인기 (2m급)',
      speedKmh: 100, altBand: 'low', dwellSec: 900,
      detectFactor: 0.4, paramRef: 'THR-UAV-RCS-01',
      approvalLevel: { asis: 'KAOC', tobe: null },
      note: '2022.12.26 침투 사건 모사. 저탐지·항적소실 반복. To-Be는 사전승인 자동교전(위협별 자동화 차등).'
    },
    ac_low: {
      key: 'ac_low', name: '저속 침투기 (AN-2급)',
      speedKmh: 180, altBand: 'low', dwellSec: 600,
      detectFactor: 0.6, paramRef: 'THR-AN2-RCS-01',
      approvalLevel: { asis: 'KAOC', tobe: 'MCRC' }
    },
    heli: {
      key: 'heli', name: '헬기 (저고도 침투)',
      speedKmh: 250, altBand: 'low', dwellSec: 420,
      detectFactor: 0.7, paramRef: 'THR-HELI-RCS-01',
      approvalLevel: { asis: 'KAOC', tobe: 'MCRC' }
    },
    fighter: {
      key: 'fighter', name: '전투기',
      speedKmh: 900, altBand: 'medium', dwellSec: 180,
      detectFactor: 0.9, paramRef: 'SEN-ACR-PD-01',
      approvalLevel: { asis: 'KAOC', tobe: 'MCRC' }
    },
    cruise: {
      key: 'cruise', name: '순항미사일',
      speedKmh: 800, altBand: 'low', dwellSec: 120,
      detectFactor: 0.5, paramRef: 'THR-CM-RCS-01',
      approvalLevel: { asis: 'MCRC', tobe: null },
      note: 'To-Be: Human-on-the-loop 자동교전 대상.'
    },
    srbm: {
      key: 'srbm', name: '단거리 탄도미사일 (KN-23급)',
      speedKmh: 6000, altBand: 'ballistic', dwellSec: 90,
      detectFactor: 0.95, paramRef: 'SEN-GPR-PD-01',
      approvalLevel: { asis: 'KAMDOC', tobe: null },
      note: '비행시간 수분 이내 — 승인 지연이 곧 요격기회 상실. To-Be 사전승인 자동교전.'
    },
    mrl_large: {
      key: 'mrl_large', name: '초대형 방사포 (KN-25급)',
      speedKmh: 5000, altBand: 'ballistic', dwellSec: 80,
      detectFactor: 0.9, paramRef: 'THR-KN25-RNG-01',
      approvalLevel: { asis: 'KAMDOC', tobe: null },
      note: '발사간격 약 20초 연발 — 포화 유발 위협.'
    }
  };

  KJ.threatType = function (key) { return KJ.THREAT_TYPES[key] || null; };
})();
