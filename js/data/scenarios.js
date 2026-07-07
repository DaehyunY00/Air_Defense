/**
 * K-JAMDS 시뮬레이터 — 시나리오 정의 (Phase 1)
 *
 * 병목은 여기서 지정하지 않는다. 시나리오는 위협 도착률(λ)·축선·구성만 정의하고,
 * 병목 노드/링크는 analysis/bottleneck.js 가 [시나리오 부하 × C2 토폴로지 × 모드]로부터
 * 분석적으로 도출한다. λ 단위: 건/분 (포아송 도착 가정, THR-DRONE-ARR-01).
 *
 * mix: [{ type: 위협클래스, axis: 'west'|'central'|'east'|'seoul', ratePerMin: λ }]
 * UI의 강도 슬라이더(intensity 0.5x~3.0x)가 전체 λ에 곱해진다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  KJ.SCENARIOS = [
    {
      id: 'sc1',
      name: 'SC1 · 소형 무인기 침투 (2022.12.26 재현)',
      description: '북한 소형 무인기 5대의 서부·수도권 축선 침투 재현. 저탐지 표적의 항적소실 반복과 육·공군 협조 지연이 어떻게 상호작용하는지 관찰.',
      basis: '합참 국회보고(2022.12.27, 연합뉴스·VOA); 한반도선진화재단 분석',
      mix: [
        { type: 'uav_small', axis: 'west', ratePerMin: 0.5 },
        { type: 'uav_small', axis: 'seoul', ratePerMin: 0.3 }
      ],
      defaultMode: 'asis'
    },
    {
      id: 'sc2',
      name: 'SC2 · 탄도탄 단독 공격',
      description: 'KN-23급 SRBM 위주의 탄도탄 공격. KAMDOC 중심 단일 체계 처리 — 이원화 병목 없이 순수 처리용량을 관찰하는 대조군.',
      basis: '공개 탄도탄 시험발사 보도 기반 개념 설정',
      mix: [
        { type: 'srbm', axis: 'central', ratePerMin: 1.0 },
        { type: 'srbm', axis: 'east', ratePerMin: 0.5 }
      ],
      defaultMode: 'asis'
    },
    {
      id: 'sc3',
      name: 'SC3 · 복합 섞어쏘기 포화공격',
      description: 'SRBM + KN-25 연발 + 소형 무인기 + 전투기 동시 복합위협. 이용률 ρ>0.9 임계 초과 구간에서 As-Is 대비 To-Be 개선폭을 정량화하는 핵심 시나리오.',
      basis: 'KN-25 발사간격 약 20초(THR-KN25-RNG-01); 복합위협 포아송 도착 가정',
      mix: [
        { type: 'srbm', axis: 'central', ratePerMin: 1.5 },
        { type: 'mrl_large', axis: 'east', ratePerMin: 3.0 },
        { type: 'uav_small', axis: 'west', ratePerMin: 1.0 },
        { type: 'uav_small', axis: 'seoul', ratePerMin: 0.5 },
        { type: 'fighter', axis: 'west', ratePerMin: 0.5 },
        { type: 'cruise', axis: 'west', ratePerMin: 0.8 }
      ],
      defaultMode: 'asis'
    },
    {
      id: 'sc4',
      name: 'SC4 · 서해축 순항미사일·무인기 혼합',
      description: '서해 저고도 축선의 순항미사일·무인기 혼합 침투. 저고도 탐지 공백과 해상(이지스)·지상(군단)·공중(E-737) 센서 간 항적융합 유무의 효과 관찰.',
      basis: '저고도 순항미사일 위협 공개 보도 기반 개념 설정',
      mix: [
        { type: 'cruise', axis: 'west', ratePerMin: 1.2 },
        { type: 'uav_small', axis: 'west', ratePerMin: 0.8 },
        { type: 'heli', axis: 'west', ratePerMin: 0.3 }
      ],
      defaultMode: 'asis'
    },
    {
      id: 'sc5',
      name: 'SC5 · 저강도 평시 (기준선)',
      description: '평시 수준의 산발적 항적. 모든 노드가 정상 이용률에 머무는 기준선 — 병목이 "고정된 속성"이 아니라 부하의 함수임을 보이는 대조군.',
      basis: '개념 설정 (저강도 λ)',
      mix: [
        { type: 'fighter', axis: 'east', ratePerMin: 0.1 },
        { type: 'uav_small', axis: 'west', ratePerMin: 0.05 }
      ],
      defaultMode: 'asis'
    }
  ];

  KJ.scenarioById = function (id) {
    return KJ.SCENARIOS.find(function (s) { return s.id === id; }) || KJ.SCENARIOS[0];
  };
})();
