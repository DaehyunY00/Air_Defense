/**
 * K-JAMDS 시뮬레이터 — 시나리오 정의
 *
 * 시나리오는 KJADS 구축안 문서의 "1. 문제점 및 현실태"가 제시한 3가지 문제 상황을
 * 1:1로 재현한다 (문제 상황 1·2·3 → SC1·SC2·SC3).
 *
 * 병목은 여기서 지정하지 않는다. 시나리오는 위협 도착률(λ)·축선·구성만 정의하고,
 * 병목 노드/링크는 analysis/bottleneck.js·engine/sim-engine.js 가
 * [시나리오 부하 × C2 토폴로지 × 모드]로부터 도출한다.
 *
 * mix 항목 형식:
 *  - { type, axis, ratePerMin }            : 포아송 연속 도착 스트림 (λ 건/분)
 *  - { type, axis, burst, atSec, equivRatePerMin } : 일회성 동시 다발 침투
 *      · burst    : atSec 시점에 동시 발생하는 위협 수 (강도 배수로 반올림 스케일)
 *      · equivRatePerMin : 해석 모듈(M/M/c 정상상태 근사)용 등가 도착률 개념값
 *        (burst를 위협 체공창(dwellSec) 수준 시간창에 균등 살포한 근사)
 *  - { ..., wave: { onSec, offSec, mult } } : 파상(비정상 포아송) 도착 — ON 구간 동안
 *      도착률이 ratePerMin×mult로 상승, OFF 구간은 ratePerMin. 주기 = onSec+offSec,
 *      t=0부터 ON으로 시작. thinning(간축법)으로 표본화(ENV-WAVE-01, 재현성 유지).
 *
 * 시나리오 선택 필드 (Phase 7):
 *  - falseTracks: { ratePerMin }  : 오경보(클러터: 조류·풍선·비협조 민간기 오인) 트랙
 *      발생률. 오경보 트랙도 식별·위협평가 서버 용량을 소모(2022.12.26 "새떼 오인" 부하
 *      재현, ENV-FT-RATE-01). 격추/누수 통계에는 불산입, 강도 배수 적용.
 *  - outages: [{ from, to, kind, fromSec, toSec }] : 통신 링크 두절 창(Degraded Mode,
 *      C2-OUTAGE-01). 두절 중 협조경로 상실 시 엔진이 권한위임(fallback)으로 전환.
 * UI의 강도 슬라이더(intensity 0.5x~3.0x)가 전체 λ·burst에 곱해진다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  KJ.SCENARIOS = [
    {
      id: 'sc1',
      name: 'SC1 · 교전 중복·책임 공백 (책임구역 경계 침투)',
      problem: '문제 상황 1',
      description: '동일 침투 항공기·헬기가 수도군단 AOC·공군 미사일방어부대·수방사 JAOC의 ' +
        '책임구역 경계 부근으로 접근하는 상황. 타 부대 교전 현황을 가시화할 수 없어 교전 책임 ' +
        '경계가 불명확해지고, 음성 VTC 협조 의존으로 신속한 조율이 불가능한 중복교전·책임공백 ' +
        '위험을 관찰한다.',
      basis: 'KJADS 구축안 문제 상황 1 (교전 중복 및 책임 공백)',
      // 다양화: 저속기·헬기·무인기·순항미사일 4개 위협클래스 × 서부/수도권 경계 축선.
      // 모두 육(AOC·JAOC)·공(MCRC)·해(이지스) 복수 통제계통이 동시에 교전 가능한
      // 클래스로 구성해 "경계 부근 중복교전·책임공백" 목적을 보존한다.
      // KAOC 승인 부하 합계는 저부하로 유지(전환점 대조군: 전 스윕 구간 ρ<0.9).
      mix: [
        { type: 'ac_low', axis: 'west', ratePerMin: 0.25 },
        { type: 'ac_low', axis: 'seoul', ratePerMin: 0.15 },
        { type: 'heli', axis: 'west', ratePerMin: 0.15 },
        { type: 'heli', axis: 'seoul', ratePerMin: 0.1 },
        { type: 'uav_small', axis: 'west', ratePerMin: 0.15 },
        { type: 'uav_small', axis: 'seoul', ratePerMin: 0.1 },
        { type: 'cruise', axis: 'west', ratePerMin: 0.25 }
      ],
      // 경계 침투 상황의 미식별·오인 트랙(민간 경항공기·조류 등) — 식별 부하 유발
      falseTracks: { ratePerMin: 0.5, paramRef: 'ENV-FT-RATE-01' },
      defaultMode: 'asis'
    },
    {
      id: 'sc2',
      name: 'SC2 · 소형 무인기 동시 남파 (무인기 대응 실패)',
      problem: '문제 상황 2',
      description: '소형 무인기 8대 동시 남파(2022.12.26 확대 재현). 저고도·저속·소형 RCS ' +
        '표적이 탐지 후 반복 소실되는 현상과, 이군종 센서 간 데이터 융합·공통 상황인식(COP) ' +
        '부재, 무인기 전용 대응체계 미정립이 결합된 대응 실패 구조를 관찰한다.',
      basis: 'KJADS 구축안 문제 상황 2 (무인기 대응 실패); 합참 국회보고(2022.12.27)',
      // 다양화: 1차 남파 8대(문서 명세, t=60s) + 2차 남파 6대(t=900s) + 서부·수도권·
      // 중부 3개 축선 산발 침투 스트림. 전 객체가 소형 무인기(uav_small)로,
      // "저고도·저속·저RCS 반복 소실 + 저요격확률" 목적을 보존한다.
      mix: [
        { type: 'uav_small', axis: 'west', burst: 5, atSec: 60, equivRatePerMin: 0.33 },
        { type: 'uav_small', axis: 'seoul', burst: 3, atSec: 60, equivRatePerMin: 0.2 },
        { type: 'uav_small', axis: 'west', burst: 4, atSec: 900, equivRatePerMin: 0.27 },
        { type: 'uav_small', axis: 'central', burst: 2, atSec: 900, equivRatePerMin: 0.13 },
        { type: 'uav_small', axis: 'west', ratePerMin: 0.3 },
        { type: 'uav_small', axis: 'seoul', ratePerMin: 0.2 },
        { type: 'uav_small', axis: 'central', ratePerMin: 0.15 }
      ],
      // 2022.12.26 실증: "새떼·풍선 오인" 다수 — 저피탐 소형표적 혼재 시 오경보 부하 최대
      falseTracks: { ratePerMin: 1.0, paramRef: 'ENV-FT-RATE-01' },
      defaultMode: 'asis'
    },
    {
      id: 'sc3',
      name: 'SC3 · 전략적 섞어쏘기 (복합 동시 포화)',
      problem: '문제 상황 3',
      description: '전투기·무인기·TBM(전술탄도미사일)·방사포가 동시에 공격해오는 복합 동시 ' +
        '위협 상황. 방공 처리 용량의 임계치(ρ≥0.9)를 초과하는 구간에서 As-Is 대비 To-Be ' +
        '개선폭을 정량화하는 핵심 시나리오 — 복합 위협 동시 대응 체계 부재, 자산 현황 실시간 ' +
        '동기화 미비, 지휘관 처리 용량 초과라는 구조적 문제를 재현한다.',
      basis: 'KJADS 구축안 문제 상황 3 (전략적 섞어쏘기); KN-25 발사간격 약 20초(THR-KN25-RNG-01)',
      mix: [
        { type: 'srbm', axis: 'central', ratePerMin: 1.5 },
        // 방사포는 연발 사격 특성상 파상(비정상 포아송) 도착 — 평균 λ는 종전과 동일한
        // 3.0/분(= (60×6 + 120×1.5)/180)이되, ON 구간에 집중되는 배치성 부하를 재현.
        { type: 'mrl_large', axis: 'east', ratePerMin: 1.5, wave: { onSec: 60, offSec: 120, mult: 4 } },
        { type: 'uav_small', axis: 'west', ratePerMin: 1.0 },
        { type: 'uav_small', axis: 'seoul', ratePerMin: 0.5 },
        { type: 'fighter', axis: 'west', ratePerMin: 0.8 }
      ],
      falseTracks: { ratePerMin: 0.5, paramRef: 'ENV-FT-RATE-01' },
      defaultMode: 'asis'
    },
    {
      id: 'sc4',
      name: 'SC4 · C2 통신 두절·분권 전환 (Degraded Mode)',
      problem: '문제 상황 4 (KJADS 원칙 6: 강건성·복원력)',
      description: '교전협조의 핵심인 육↔공 협조 링크가 전자전·장비 고장 등으로 일정 시간 ' +
        '두절되는 상황(300~1,200초 창). 협조경로 상실 시 상위 승인 대기가 불가능해지고, ' +
        '엔진은 권한위임 지연(개념값 45초) 후 현장 통제소가 자체 승인하는 분권(fallback) ' +
        '모드로 전환한다. 중앙-분권 전환 빈도·지연과 두절 창 전후의 누수율 변화를 관찰해 ' +
        'To-Be(우회 경로 보유)의 복원력을 정량 비교한다.',
      basis: 'KJADS 6대 설계 원칙 중 원칙 6 (Degraded Mode·Fallback C2·중앙-분권-자율 전환)',
      mix: [
        { type: 'ac_low', axis: 'west', ratePerMin: 0.3 },
        { type: 'heli', axis: 'west', ratePerMin: 0.2 },
        { type: 'heli', axis: 'seoul', ratePerMin: 0.15 },
        { type: 'uav_small', axis: 'west', ratePerMin: 0.25 },
        { type: 'uav_small', axis: 'seoul', ratePerMin: 0.15 },
        { type: 'fighter', axis: 'west', ratePerMin: 0.4 }
      ],
      falseTracks: { ratePerMin: 0.5, paramRef: 'ENV-FT-RATE-01' },
      // 두절 창: 육→공 협조 링크(As-Is 음성 VTC / To-Be 데이터링크) 동시 두절.
      // To-Be는 JAMDC2 경유 우회 협조경로가 살아 있어 영향이 작다(복원력 비교 목적).
      outages: [
        { from: 'AOC-1C', to: 'MCRC', kind: 'coord', fromSec: 300, toSec: 1200, paramRef: 'C2-OUTAGE-01' },
        { from: 'JAOC-CD', to: 'MCRC', kind: 'coord', fromSec: 300, toSec: 1200, paramRef: 'C2-OUTAGE-01' }
      ],
      defaultMode: 'asis'
    }
  ];

  KJ.scenarioById = function (id) {
    return KJ.SCENARIOS.find(function (s) { return s.id === id; }) || KJ.SCENARIOS[0];
  };

  /** mix 항목의 등가 도착률(건/분): 연속 스트림은 ratePerMin, burst는 equivRatePerMin 개념값 */
  KJ.entryRate = function (entry) {
    return entry.ratePerMin || entry.equivRatePerMin || 0;
  };
})();
