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
 *
 * ── 발사권역·사거리 정합(정밀화 Phase A) ──
 * rangeBandKm: 공개자료 기반 개념 사거리대 {min,max} (실제 제원 아님 — docs/params.md THR-*-RNG-*).
 * originZones: 이 위협이 발사될 수 있는 개념 발사권역 태그 목록. axes.js의 축선별
 *   launchZones와 대조해 "축선 배분이 사거리·발사권역과 모순되지 않는지"를
 *   KJ.checkAxisThreatFit(axes.js)가 검증한다(회귀 어서션 포함).
 *   태그: 'dmz'(DMZ 인접 근거리) | 'coastal'(서해·연안) | 'deep'(종심).
 *   ※ 전부 개념 권역이며 실제 발사원점·배치 자료가 아님.
 *
 * ── 위협별 자동화 차등(정밀화 Phase B-3, C2-AUTO-LEVEL-01) ──
 * automation: {asis, tobe} — 결심 단계의 인간개입 수준(구 note 텍스트를 엔진 플래그로 승격).
 *   'human-in-loop' : 승인권자(approvalLevel)까지 coord 협조경로 + 승인 처리 필요 (As-Is 기본)
 *   'human-on-loop' : 감독하 자동교전 — 승인 처리(서비스)는 남되 coord 협조경로 홉 생략
 *                     (COP 공유 전제). approvalLevel이 null이면 감독만 하고 홉 없음
 *   'auto-preauth'  : 사전승인 자동교전 — 결심 홉 자체 생략 (구 approval=null 우회의 일반화)
 * 엔진 _decision이 이 플래그를 참조한다. 부하 기반 동적 권한위임(B-2)과는 별개 축.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  KJ.THREAT_TYPES = {
    uav_small: {
      key: 'uav_small', name: '소형 무인기 (2m급)',
      speedKmh: 100, altBand: 'low', dwellSec: 900,
      detectFactor: 0.4, paramRef: 'THR-UAV-RCS-01',
      rangeBandKm: { min: 50, max: 300 }, originZones: ['dmz', 'coastal'], rangeRef: 'THR-UAV-RNG-01',
      approvalLevel: { asis: 'KAOC', tobe: null },
      automation: { asis: 'human-in-loop', tobe: 'auto-preauth' },
      note: '2022.12.26 침투 사건 모사. 저탐지·항적소실 반복. To-Be는 사전승인 자동교전(위협별 자동화 차등).'
    },
    ac_low: {
      key: 'ac_low', name: '저속 침투기 (AN-2급)',
      speedKmh: 180, altBand: 'low', dwellSec: 600,
      detectFactor: 0.6, paramRef: 'THR-AN2-RCS-01',
      rangeBandKm: { min: 100, max: 900 }, originZones: ['dmz', 'coastal'], rangeRef: 'THR-AN2-RNG-01',
      approvalLevel: { asis: 'KAOC', tobe: 'MCRC' },
      automation: { asis: 'human-in-loop', tobe: 'human-on-loop' }
    },
    heli: {
      key: 'heli', name: '헬기 (저고도 침투)',
      speedKmh: 250, altBand: 'low', dwellSec: 420,
      detectFactor: 0.7, paramRef: 'THR-HELI-RCS-01',
      rangeBandKm: { min: 50, max: 500 }, originZones: ['dmz', 'coastal'], rangeRef: 'THR-HELI-RNG-01',
      approvalLevel: { asis: 'KAOC', tobe: 'MCRC' },
      automation: { asis: 'human-in-loop', tobe: 'human-on-loop' }
    },
    fighter: {
      key: 'fighter', name: '전투기',
      speedKmh: 900, altBand: 'medium', dwellSec: 180,
      detectFactor: 0.9, paramRef: 'SEN-ACR-PD-01',
      rangeBandKm: { min: 200, max: 1500 }, originZones: ['dmz', 'coastal', 'deep'], rangeRef: 'THR-FTR-RNG-01',
      approvalLevel: { asis: 'KAOC', tobe: 'MCRC' },
      automation: { asis: 'human-in-loop', tobe: 'human-on-loop' }
    },
    cruise: {
      key: 'cruise', name: '순항미사일',
      speedKmh: 800, altBand: 'low', dwellSec: 120,
      detectFactor: 0.5, paramRef: 'THR-CM-RCS-01',
      rangeBandKm: { min: 150, max: 2000 }, originZones: ['dmz', 'coastal', 'deep'], rangeRef: 'THR-CM-RNG-01',
      approvalLevel: { asis: 'MCRC', tobe: null },
      automation: { asis: 'human-in-loop', tobe: 'human-on-loop' },
      note: 'To-Be: Human-on-the-loop 자동교전 대상.'
    },
    srbm: {
      key: 'srbm', name: '단거리 탄도미사일 (KN-23급)',
      speedKmh: 6000, altBand: 'ballistic', dwellSec: 90,
      detectFactor: 0.95, paramRef: 'SEN-GPR-PD-01',
      rangeBandKm: { min: 400, max: 690 }, originZones: ['deep'], rangeRef: 'THR-KN23-RNG-01',
      approvalLevel: { asis: 'KAMDOC', tobe: null },
      automation: { asis: 'human-in-loop', tobe: 'auto-preauth' },
      note: '비행시간 수분 이내 — 승인 지연이 곧 요격기회 상실. To-Be 사전승인 자동교전. 종심 발사→광역 표적(저각 발사 시 단축 가능, rangeBandKm.min은 정합검증 미사용).'
    },
    mrl_large: {
      key: 'mrl_large', name: '초대형 방사포 (KN-25급)',
      speedKmh: 5000, altBand: 'ballistic', dwellSec: 80,
      detectFactor: 0.9, paramRef: 'THR-KN25-RNG-01',
      rangeBandKm: { min: 350, max: 400 }, originZones: ['deep'], rangeRef: 'THR-KN25-RNG-01',
      approvalLevel: { asis: 'KAMDOC', tobe: null },
      automation: { asis: 'human-in-loop', tobe: 'auto-preauth' },
      note: '발사간격 약 20초 연발 — 포화 유발 위협. 중거리 종심 발사권역.'
    }
  };

  KJ.threatType = function (key) { return KJ.THREAT_TYPES[key] || null; };
})();
