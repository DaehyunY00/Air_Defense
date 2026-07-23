(function () {
  'use strict';
  window.KJ = window.KJ || {};
  const KM_PER_DEG_LAT = KJ.KM_PER_DEG_LAT;
  const sampleMdlDefensePoints = KJ.sampleMdlDefensePoints;
/**
 * config/deployments.js — Phase 4.1 단계 2 재구성 (handoff §2.1 버그 1번)
 *
 * 본 파일 = 배치 좌표 + 자산 선언 단일 권위.
 * Phase 4.1 단계 2 (2026-05-27): CURRENT_DEMO / STRESS_TEST / HANBANDO_DEMO 폐기.
 * 신규 3 시나리오 = HANBANDO_MINI (같은 배치 + 본사장 활성화 토글) — 4 상황 매트릭스 시연용.
 *
 * 배치 목록:
 *  - DEPLOYMENT_HANBANDO_MINI_NORMAL       (상황 A: KAMDOC + MCRC 둘 다 정상)
 *  - DEPLOYMENT_HANBANDO_MINI_MCRC_DOWN    (상황 B: KAMDOC 정상 + MCRC 부재)
 *  - DEPLOYMENT_HANBANDO_MINI_KAMDOC_DOWN  (상황 C: KAMDOC 부재 + MCRC 정상)
 *
 * 본질:
 *  - positions / batteries / sensors = 단일 출처 공유 (같은 배치)
 *  - c2Nodes 만 분기 (본사장 활성화 토글로 4 상황 시연)
 *  - Phase 4.2 진입 시 HANBANDO_FULL 3 시나리오 (1여단 영남/호남 추가) 동일 패턴으로 확장
 *
 * 형식:
 *  - 모든 객체 Object.freeze (불변)
 *  - lon/lat = WGS84 도(°), alt = 해수면 기준 m
 *  - batteries[i] = { shooterTypeId, posKey, mfrSensorTypeId, mfrSensorPosKey, maxSimultaneous, totalRounds, iccPosKey }
 *  - sensors[i]   = { typeId, posKey, radarRangeKm, radarColor }
 *  - c2Nodes[i]   = { typeId, posKey, showNetworkNode, instanceLabel? }
 *
 * 단일 권위: phase4.1-bugfix-handoff.md §2.1 + PROJECT_CONTEXT.md 상황 매트릭스 + ADR-028 / ADR-029
 */

// ADR-049 SHORAD 벨트: 방어측 배치 전용 고정밀 MDL 궤적 (잎 모듈 — import 순환 없음).

// ════════════════════════════════════════════════════════════════
// HANBANDO_MINI 공통 데이터 (positions + batteries + sensors)
// ════════════════════════════════════════════════════════════════
//
// 본 데이터는 NORMAL / MCRC_DOWN / KAMDOC_DOWN 3 시나리오가 모두 공유 (단일 출처).
// 변경 시 3 시나리오 모두 영향.

const HANBANDO_MINI_POSITIONS = Object.freeze({
  // 공통 C2 / 조기경보
  KAMD_OPS:   { lon: 127.07, lat: 36.99, alt: 100 }, // 평택 오산 (ADR-022 §16.1)
  MCRC:       { lon: 127.0297, lat: 37.0903, alt: 50 }, // 오산 (ROK AF MCRC 공개)
  ICC:        { lon: 127.05, lat: 37.05, alt: 100 }, // sim 단일 (backward compat)
  ECS:        { lon: 127.03, lat: 37.08, alt: 100 }, // sim 단일
  GREEN_PINE: { lon: 127.0,  lat: 36.0,  alt: 200 },
  FPS117:     { lon: 127.50, lat: 36.50, alt: 300 },
  TPS880K:    { lon: 127.20, lat: 37.30, alt: 80  },
  // ADR-024 다중 ICC (2여단 충청·강원 + 3여단 수도권, ADR-022 §16.1 단일 권위)
  ICC_BRIGADE_2: { lon: 127.13, lat: 36.92, alt: 80 }, // 충남 천안 성환 (2여단)
  ICC_BRIGADE_3: { lon: 126.90, lat: 37.47, alt: 80 }, // 서울 금천구 (3여단)
  // N 클러스터: 수도권 3여단 산하 5 포대 (LSAM 1 + 천궁-II 3 + PAC-3 1)
  LSAM_BAT_N1: { lon: 126.95, lat: 37.55, alt: 150 }, // 안양/성남 권역
  C2_BAT_N1:   { lon: 127.00, lat: 37.40, alt: 150 },
  C2_BAT_N2:   { lon: 127.10, lat: 37.50, alt: 150 },
  C2_BAT_N3:   { lon: 127.20, lat: 37.35, alt: 150 },
  PAC3_BAT_N1: { lon: 127.20, lat: 37.20, alt: 100 },
  // S 클러스터: 충청·강원 2여단 산하 3 포대 (LSAM 강원평창 1 + 천궁-II 충청 2)
  LSAM_BAT_PYEONGCHANG: { lon: 128.50, lat: 37.50, alt: 250 }, // 강원 평창 (2여단)
  C2_BAT_S1:   { lon: 127.30, lat: 36.65, alt: 150 },
  C2_BAT_S2:   { lon: 126.90, lat: 36.60, alt: 150 },
  // ── 포대별 자기 MFR (단계 1 박제, handoff §2.2) ─────────
  // 본질: 사수마다 자기 레이더 = ADR-024 ECS 패턴 정합. 포대 BAT 위치에서 ~500m 옆 별도 좌표.
  LSAM_MFR_N1:          { lon: 126.955, lat: 37.555, alt: 180 },
  LSAM_MFR_PYEONGCHANG: { lon: 128.505, lat: 37.505, alt: 280 },
  MSAM_MFR_N1:          { lon: 127.005, lat: 37.405, alt: 160 },
  MSAM_MFR_N2:          { lon: 127.105, lat: 37.505, alt: 160 },
  MSAM_MFR_N3:          { lon: 127.205, lat: 37.355, alt: 160 },
  MSAM_MFR_S1:          { lon: 127.305, lat: 36.655, alt: 160 },
  MSAM_MFR_S2:          { lon: 126.905, lat: 36.605, alt: 160 },
  PATRIOT_MFR_N1:       { lon: 127.205, lat: 37.205, alt: 120 },
  SRBM_ORIGIN: { lon: 127.0,  lat: 39.5,  alt: 0 },
  SRBM_TARGET: { lon: 127.03, lat: 37.0,  alt: 0 },
});

const HANBANDO_MINI_BATTERIES = Object.freeze([
  // N 클러스터: 3여단 수도권 (5 포대) — mfrSensorPosKey = 포대별 unique MFR (단계 1)
  Object.freeze({ shooterTypeId: 'LSAM',       posKey: 'LSAM_BAT_N1', mfrSensorTypeId: 'LSAM_MFR',     mfrSensorPosKey: 'LSAM_MFR_N1',     maxSimultaneous: 10, totalRounds: { ABM: 12, AAM: 12 }, iccPosKey: 'ICC_BRIGADE_3' }),
  Object.freeze({ shooterTypeId: 'CHEONGUNG2', posKey: 'C2_BAT_N1',   mfrSensorTypeId: 'MSAM_MFR',     mfrSensorPosKey: 'MSAM_MFR_N1',     maxSimultaneous: 10, totalRounds: { ABM: 16, AAM: 16 }, iccPosKey: 'ICC_BRIGADE_3' }),
  Object.freeze({ shooterTypeId: 'CHEONGUNG2', posKey: 'C2_BAT_N2',   mfrSensorTypeId: 'MSAM_MFR',     mfrSensorPosKey: 'MSAM_MFR_N2',     maxSimultaneous: 10, totalRounds: { ABM: 16, AAM: 16 }, iccPosKey: 'ICC_BRIGADE_3' }),
  Object.freeze({ shooterTypeId: 'CHEONGUNG2', posKey: 'C2_BAT_N3',   mfrSensorTypeId: 'MSAM_MFR',     mfrSensorPosKey: 'MSAM_MFR_N3',     maxSimultaneous: 10, totalRounds: { ABM: 16, AAM: 16 }, iccPosKey: 'ICC_BRIGADE_3' }),
  Object.freeze({ shooterTypeId: 'PAC3',       posKey: 'PAC3_BAT_N1', mfrSensorTypeId: 'PATRIOT_RADAR', mfrSensorPosKey: 'PATRIOT_MFR_N1',  maxSimultaneous: 9,  totalRounds: { ABM: 72 },           iccPosKey: 'ICC_BRIGADE_3' }),
  // S 클러스터: 2여단 충청·강원 (3 포대)
  Object.freeze({ shooterTypeId: 'LSAM',       posKey: 'LSAM_BAT_PYEONGCHANG', mfrSensorTypeId: 'LSAM_MFR', mfrSensorPosKey: 'LSAM_MFR_PYEONGCHANG', maxSimultaneous: 10, totalRounds: { ABM: 12, AAM: 12 }, iccPosKey: 'ICC_BRIGADE_2' }),
  Object.freeze({ shooterTypeId: 'CHEONGUNG2', posKey: 'C2_BAT_S1',   mfrSensorTypeId: 'MSAM_MFR',     mfrSensorPosKey: 'MSAM_MFR_S1',     maxSimultaneous: 10, totalRounds: { ABM: 16, AAM: 16 }, iccPosKey: 'ICC_BRIGADE_2' }),
  Object.freeze({ shooterTypeId: 'CHEONGUNG2', posKey: 'C2_BAT_S2',   mfrSensorTypeId: 'MSAM_MFR',     mfrSensorPosKey: 'MSAM_MFR_S2',     maxSimultaneous: 10, totalRounds: { ABM: 16, AAM: 16 }, iccPosKey: 'ICC_BRIGADE_2' }),
]);

const HANBANDO_MINI_SENSORS = Object.freeze([
  Object.freeze({ typeId: 'GREEN_PINE_B',  posKey: 'GREEN_PINE', radarRangeKm: 900, radarColor: '#44cc44' }),
  // 포대별 자기 MFR (typeId 동일, posKey 만 unique = 포대별 인스턴스)
  Object.freeze({ typeId: 'LSAM_MFR',      posKey: 'LSAM_MFR_N1',          radarRangeKm: 310, radarColor: '#00aaff' }),
  Object.freeze({ typeId: 'LSAM_MFR',      posKey: 'LSAM_MFR_PYEONGCHANG', radarRangeKm: 310, radarColor: '#00aaff' }),
  Object.freeze({ typeId: 'MSAM_MFR',      posKey: 'MSAM_MFR_N1',          radarRangeKm: 100, radarColor: '#ff66cc' }),
  Object.freeze({ typeId: 'MSAM_MFR',      posKey: 'MSAM_MFR_N2',          radarRangeKm: 100, radarColor: '#ff66cc' }),
  Object.freeze({ typeId: 'MSAM_MFR',      posKey: 'MSAM_MFR_N3',          radarRangeKm: 100, radarColor: '#ff66cc' }),
  Object.freeze({ typeId: 'MSAM_MFR',      posKey: 'MSAM_MFR_S1',          radarRangeKm: 100, radarColor: '#ff66cc' }),
  Object.freeze({ typeId: 'MSAM_MFR',      posKey: 'MSAM_MFR_S2',          radarRangeKm: 100, radarColor: '#ff66cc' }),
  Object.freeze({ typeId: 'PATRIOT_RADAR', posKey: 'PATRIOT_MFR_N1',       radarRangeKm: 180, radarColor: '#ffaa00' }),
  Object.freeze({ typeId: 'FPS117',        posKey: 'FPS117',               radarRangeKm: 470, radarColor: '#88ccff' }),
  Object.freeze({ typeId: 'TPS880K',       posKey: 'TPS880K',              radarRangeKm: 40,  radarColor: '#ccff88' }),
]);

// c2Nodes 공통 부분 (ICC × 2 + ECS × 8 + Kill-web 추상화). 3 시나리오 모두 동일.
// KAMDOC / MCRC entry 는 시나리오별로 토글됨.
const HANBANDO_MINI_C2_BASE = Object.freeze([
  // ADR-024 다중 ICC (2여단 + 3여단)
  Object.freeze({ typeId: 'ICC', posKey: 'ICC_BRIGADE_2', showNetworkNode: true, instanceLabel: 'ICC 2여단' }),
  Object.freeze({ typeId: 'ICC', posKey: 'ICC_BRIGADE_3', showNetworkNode: true, instanceLabel: 'ICC 3여단' }),
  // 포대별 ECS × 8 (N 클러스터 5 + S 클러스터 3)
  Object.freeze({ typeId: 'ECS', posKey: 'LSAM_BAT_N1', showNetworkNode: true, instanceLabel: 'ECS L-SAM N1' }),
  Object.freeze({ typeId: 'ECS', posKey: 'C2_BAT_N1',   showNetworkNode: true, instanceLabel: 'ECS 천궁 N1' }),
  Object.freeze({ typeId: 'ECS', posKey: 'C2_BAT_N2',   showNetworkNode: true, instanceLabel: 'ECS 천궁 N2' }),
  Object.freeze({ typeId: 'ECS', posKey: 'C2_BAT_N3',   showNetworkNode: true, instanceLabel: 'ECS 천궁 N3' }),
  Object.freeze({ typeId: 'ECS', posKey: 'PAC3_BAT_N1', showNetworkNode: true, instanceLabel: 'ECS PAC-3 N1' }),
  Object.freeze({ typeId: 'ECS', posKey: 'LSAM_BAT_PYEONGCHANG', showNetworkNode: true, instanceLabel: 'ECS L-SAM 평창' }),
  Object.freeze({ typeId: 'ECS', posKey: 'C2_BAT_S1',   showNetworkNode: true, instanceLabel: 'ECS 천궁 S1' }),
  Object.freeze({ typeId: 'ECS', posKey: 'C2_BAT_S2',   showNetworkNode: true, instanceLabel: 'ECS 천궁 S2' }),
  // Kill-web 추상화 (Phase 4 first-class 분리 예정, 시각 중복 방지)
  Object.freeze({ typeId: 'IAOC', posKey: 'KAMD_OPS', showNetworkNode: false }),
  Object.freeze({ typeId: 'EOC',  posKey: 'ICC',      showNetworkNode: false }),
]);

// KAMDOC entry (탄도탄 본사장) — NORMAL / MCRC_DOWN 에 포함, KAMDOC_DOWN 에서 제외
const KAMDOC_ENTRY = Object.freeze({
  typeId: 'KAMD_OPS', posKey: 'KAMD_OPS', showNetworkNode: true, instanceLabel: 'KAMD_OPS',
});

// MCRC entry (비행기 본사장) — NORMAL / KAMDOC_DOWN 에 포함, MCRC_DOWN 에서 제외
const MCRC_ENTRY = Object.freeze({
  typeId: 'MCRC', posKey: 'MCRC', showNetworkNode: true, instanceLabel: 'MCRC 중앙방공통제소',
});



// ════════════════════════════════════════════════════════════════
// HANBANDO_FULL 공통 데이터 (Phase 4.2 진입 — ADR-022 §16 + ADR-036 THAAD)
// ════════════════════════════════════════════════════════════════
// 본 배치는 공개/추정 좌표를 함께 담는 선언 데이터다. 엔진은 lon/lat/alt 만 소비하고,
// confidence/sourceNote 는 guard test·항법 문서가 읽는 메타로 둔다.

const HANBANDO_FULL_POSITIONS = ({
  KAMD_OPS: { lon: 127.07, lat: 36.99, alt: 100, confidence: 'public', sourceNote: 'ADR-022 §16.1 평택 오산' },
  MCRC: { lon: 127.07, lat: 36.99, alt: 80, confidence: 'public', sourceNote: 'ADR-022 §16.1 평택 오산' },
  ICC_BRIGADE_1: { lon: 128.65, lat: 35.86, alt: 100, confidence: 'public', sourceNote: 'ADR-022 §16.1 대구 수성' },
  ICC_BRIGADE_2: { lon: 127.13, lat: 36.92, alt: 80, confidence: 'public', sourceNote: 'ADR-022 §16.1 천안 성환' },
  ICC_BRIGADE_3: { lon: 126.90, lat: 37.47, alt: 80, confidence: 'public', sourceNote: 'ADR-022 §16.1 서울 금천' },
  USFK_THAAD_C2: { lon: 127.07, lat: 36.99, alt: 80, confidence: 'public', sourceNote: 'ADR-036 USFK THAAD 독립축 C2 — 35th ADA 오산 대표 노드' },
  USFK_PATRIOT_C2: { lon: 127.03, lat: 37.09, alt: 80, confidence: 'public', sourceNote: '35th ADA / USFK Patriot command representative node at Osan' },
  ARMY_WEST_FRONT_AD: { lon: 126.80, lat: 37.80, alt: 80, confidence: 'estimated', sourceNote: '2026-07-06 검수 2차: 구 좌표(126.70, 37.84)가 탄현면 앞 임진강·한강 합수부 수역 — 파주 내륙(월롱/파주읍)으로 이동' },
  ARMY_CENTRAL_FRONT_AD: { lon: 127.45, lat: 38.12, alt: 100, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 연천·철원·화천 중부전방 국지방공 대표 노드' },
  ARMY_EAST_FRONT_AD: { lon: 128.25, lat: 38.18, alt: 120, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 양구·서화·고성·강릉 동부전방 국지방공 대표 노드' },
  ARMY_CAPITAL_AD: { lon: 126.98, lat: 37.55, alt: 80, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 서울 수도방위 국지방공 대표 노드' },
  MARINE_NW_AD: { lon: 124.71, lat: 37.97, alt: 80, confidence: 'public', sourceNote: 'ADR-022 §16.3 서북도서 백령' },
  IAOC: { lon: 127.07, lat: 36.99, alt: 90, confidence: 'public', sourceNote: 'Kill-web 추상 C2' },
  EOC: { lon: 127.13, lat: 36.92, alt: 90, confidence: 'public', sourceNote: 'Kill-web 추상 C2' },

  GREEN_PINE_CHUNGNAM: { lon: 126.85, lat: 36.40, alt: 450, confidence: 'estimated', sourceNote: 'ADR-022 §16.3 충남 Block-B 산악 추정' },
  GREEN_PINE_CHUNGBUK: { lon: 127.70, lat: 36.70, alt: 500, confidence: 'estimated', sourceNote: 'ADR-022 §16.3 충북 Block-B 산악 추정' },
  GREEN_PINE_BUSAN: { lon: 129.18, lat: 35.18, alt: 600, confidence: 'public', sourceNote: 'ADR-022 §16.3 부산 장산 Block-C' },
  GREEN_PINE_JEONNAM: { lon: 127.10, lat: 34.85, alt: 500, confidence: 'estimated', sourceNote: 'ADR-022 §16.3 전남 Block-C 보성·고흥 권역' },

  FPS117_BAENGNYEONG: { lon: 124.71, lat: 37.97, alt: 300, confidence: 'public', sourceNote: 'ADR-022 §16.3 백령도' },
  FPS117_ULLEUNG: { lon: 130.87, lat: 37.50, alt: 450, confidence: 'public', sourceNote: 'ADR-022 §16.3 울릉도' },
  FPS117_JEJU: { lon: 126.53, lat: 33.36, alt: 1500, confidence: 'public', sourceNote: 'ADR-022 §16.3 제주 한라' },
  FPS117_GANGWON_N: { lon: 128.45, lat: 38.10, alt: 900, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_GANGWON_S: { lon: 128.65, lat: 37.65, alt: 900, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_GYEONGGI: { lon: 127.30, lat: 37.85, alt: 600, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_CHUNGBUK: { lon: 127.75, lat: 36.95, alt: 750, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_CHUNGNAM: { lon: 126.80, lat: 36.55, alt: 500, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_JEONBUK: { lon: 127.55, lat: 35.75, alt: 800, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_JEONNAM_W: { lon: 126.60, lat: 34.80, alt: 650, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_JEONNAM_E: { lon: 127.55, lat: 34.95, alt: 650, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_GYEONGBUK_N: { lon: 128.90, lat: 36.85, alt: 900, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_GYEONGBUK_S: { lon: 128.70, lat: 35.95, alt: 900, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_GYEONGNAM: { lon: 128.20, lat: 35.35, alt: 700, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_BUSAN: { lon: 129.05, lat: 35.25, alt: 550, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },
  FPS117_ULSAN: { lon: 129.25, lat: 35.55, alt: 600, confidence: 'estimated', sourceNote: '본토 12기 산악 추정' },

  TPS880K_YEONPYEONG: { lon: 125.70, lat: 37.66, alt: 80, confidence: 'public', sourceNote: 'Phase 4.2 rebalance: 서북도서 연평도 fixed/public 대표 노드' },
  TPS880K_BAENGNYEONG: { lon: 124.71, lat: 37.97, alt: 80, confidence: 'public', sourceNote: 'Phase 4.2 rebalance: 서북도서 백령도 fixed/public 대표 노드' },
  TPS880K_GANGHWA: { lon: 126.33, lat: 37.69, alt: 100, confidence: 'estimated', sourceNote: 'Phase 4.2 coverage rebalance: 강화군 삼산면/석모도 gap-filler 대표 노드' },
  TPS880K_PAJU: { lon: 126.78, lat: 37.82, alt: 120, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 파주 전방 gap-filler 대표 노드' },
  TPS880K_YEONCHEON: { lon: 127.05, lat: 38.10, alt: 120, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 연천 전방 gap-filler 대표 노드' },
  TPS880K_CHEORWON: { lon: 127.31, lat: 38.14, alt: 140, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 철원 전방 gap-filler 대표 노드' },
  TPS880K_HWACHEON: { lon: 127.45, lat: 38.08, alt: 180, confidence: 'estimated', sourceNote: 'Phase 4.2 coverage rebalance: 화천 서측 DMZ gap-filler 대표 노드' },
  TPS880K_YANGGU: { lon: 127.72, lat: 38.08, alt: 220, confidence: 'estimated', sourceNote: 'Phase 4.2 coverage rebalance: 양구 서측 DMZ gap-filler 대표 노드' },
  TPS880K_SEOHWA: { lon: 128.02, lat: 38.20, alt: 220, confidence: 'estimated', sourceNote: 'Phase 4.2 coverage rebalance: 서화면 서측 DMZ gap-filler 대표 노드' },
  TPS880K_GOSEONG: { lon: 128.47, lat: 38.38, alt: 160, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 고성 동해안 전방 gap-filler 대표 노드' },
  TPS880K_GANGNEUNG: { lon: 128.95, lat: 37.75, alt: 120, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 강릉 동해안 측면 gap-filler 대표 노드' },
  TPS880K_SEOUL: { lon: 126.98, lat: 37.55, alt: 80, confidence: 'estimated', sourceNote: 'Phase 4.2 rebalance: 서울 수도권 gap-filler 대표 노드' },

  LSAM_SOUTH: { lon: 128.445, lat: 35.900, alt: 220, confidence: 'estimated', sourceNote: 'Phase 4.2 correction: L-SAM 남부 포대 하빈면 대표 노드' },
  LSAM_MID_NORTH: { lon: 128.50, lat: 37.50, alt: 250, confidence: 'estimated', sourceNote: 'ADR-022 §16.2 L-SAM 2여단 평창 권역' },
  LSAM_CAPITAL: { lon: 127.10, lat: 37.30, alt: 150, confidence: 'estimated', sourceNote: 'ADR-022 §16.2 L-SAM 3여단 안양·성남 권역' },
  LSAM_MFR_SOUTH: { lon: 128.450, lat: 35.905, alt: 240, confidence: 'estimated', sourceNote: '포대별 L-SAM MFR near 하빈면' },
  LSAM_MFR_MID_NORTH: { lon: 128.505, lat: 37.505, alt: 280, confidence: 'estimated', sourceNote: '포대별 L-SAM MFR' },
  LSAM_MFR_CAPITAL: { lon: 127.105, lat: 37.305, alt: 170, confidence: 'estimated', sourceNote: '포대별 L-SAM MFR' },

  PAC3_BUSAN: { lon: 128.938, lat: 35.179, alt: 80, confidence: 'public', sourceNote: 'ADR-037 김해국제공항 대표 노드로 PAC 부산 재배치' },
  PAC3_CHEONAN: { lon: 127.113, lat: 37.445, alt: 80, confidence: 'public', sourceNote: 'ADR-037 서울공항 대표 노드로 PAC 천안 재배치; ICC 3여단' },
  PAC3_DANGJIN: { lon: 126.486, lat: 36.704, alt: 80, confidence: 'public', sourceNote: 'ADR-037 서산 공군기지 대표 노드로 PAC 당진 재배치' },
  PAC3_CHUNGJU: { lon: 127.961, lat: 37.438, alt: 120, confidence: 'public', sourceNote: 'Phase 4.2 correction: 충주시 검단리 쪽 PAC-3를 원주공항 대표 노드로 이동' },
  PAC3_CHEONGJU: { lon: 127.50, lat: 36.71, alt: 80, confidence: 'public', sourceNote: 'ADR-022 §16.2 PAC 청주' },
  PAC3_WONJU: { lon: 127.888, lat: 37.029, alt: 120, confidence: 'estimated', sourceNote: 'ADR-037 금가면 공군기지 대표 노드로 PAC 원주 재배치' },
  PAC3_GANGNEUNG: { lon: 128.95, lat: 37.75, alt: 120, confidence: 'public', sourceNote: 'ADR-022 §16.2 PAC 강릉' },
  PAC3_BUKAKSAN: { lon: 126.98, lat: 37.60, alt: 250, confidence: 'estimated', sourceNote: 'ADR-022 §16.2 PAC 북악산' },
  PATRIOT_MFR_BUSAN: { lon: 128.943, lat: 35.184, alt: 90, confidence: 'public', sourceNote: '포대별 Patriot radar near 김해' },
  PATRIOT_MFR_CHEONAN: { lon: 127.118, lat: 37.450, alt: 90, confidence: 'public', sourceNote: '포대별 Patriot radar near 서울공항' },
  PATRIOT_MFR_DANGJIN: { lon: 126.491, lat: 36.709, alt: 90, confidence: 'public', sourceNote: '포대별 Patriot radar near 서산' },
  PATRIOT_MFR_CHUNGJU: { lon: 127.966, lat: 37.443, alt: 130, confidence: 'public', sourceNote: '포대별 Patriot radar near 원주공항' },
  PATRIOT_MFR_CHEONGJU: { lon: 127.505, lat: 36.715, alt: 90, confidence: 'public', sourceNote: '포대별 Patriot radar' },
  PATRIOT_MFR_WONJU: { lon: 127.893, lat: 37.034, alt: 130, confidence: 'estimated', sourceNote: '포대별 Patriot radar near 금가면' },
  PATRIOT_MFR_GANGNEUNG: { lon: 128.955, lat: 37.755, alt: 130, confidence: 'public', sourceNote: '포대별 Patriot radar' },
  PATRIOT_MFR_BUKAKSAN: { lon: 126.985, lat: 37.605, alt: 260, confidence: 'estimated', sourceNote: '포대별 Patriot radar' },

  USFK_PATRIOT_OSAN: { lon: 127.03, lat: 37.09, alt: 70, confidence: 'public', sourceNote: 'USFK Patriot representative node: Osan Air Base / 35th ADA public location' },
  USFK_PATRIOT_HUMPHREYS: { lon: 127.03, lat: 36.97, alt: 50, confidence: 'public', sourceNote: 'USFK Patriot representative node: Camp Humphreys / Pyeongtaek public location' },
  USFK_PATRIOT_KUNSAN: { lon: 126.62, lat: 35.90, alt: 40, confidence: 'public', sourceNote: 'USFK Patriot representative node: Kunsan Air Base public location' },
  USFK_PATRIOT_CASEY: { lon: 127.06, lat: 37.92, alt: 120, confidence: 'public', sourceNote: 'USFK Patriot representative node: Camp Casey / Dongducheon public location' },
  USFK_PATRIOT_CAMP_WALKER: { lon: 128.590, lat: 35.837, alt: 70, confidence: 'public', sourceNote: 'USFK Patriot representative node: Camp Walker / Daegu public location' },
  PATRIOT_MFR_USFK_OSAN: { lon: 127.035, lat: 37.095, alt: 80, confidence: 'public', sourceNote: 'USFK Patriot radar representative node near Osan' },
  PATRIOT_MFR_USFK_HUMPHREYS: { lon: 127.035, lat: 36.975, alt: 60, confidence: 'public', sourceNote: 'USFK Patriot radar representative node near Humphreys' },
  PATRIOT_MFR_USFK_KUNSAN: { lon: 126.625, lat: 35.905, alt: 50, confidence: 'public', sourceNote: 'USFK Patriot radar representative node near Kunsan' },
  PATRIOT_MFR_USFK_CASEY: { lon: 127.065, lat: 37.925, alt: 130, confidence: 'public', sourceNote: 'USFK Patriot radar representative node near Casey' },
  PATRIOT_MFR_USFK_CAMP_WALKER: { lon: 128.595, lat: 35.842, alt: 80, confidence: 'public', sourceNote: 'USFK Patriot radar representative node near Camp Walker' },

  THAAD_SEONGJU: { lon: 128.18, lat: 36.13, alt: 350, confidence: 'public', sourceNote: 'ADR-022 §16.2 성주 소성리 / ADR-036 USFK 독립축' },
  AN_TPY2_SEONGJU: { lon: 128.185, lat: 36.135, alt: 360, confidence: 'public', sourceNote: 'ADR-022 §16.2 AN/TPY-2 성주' },

  SRBM_ORIGIN: { lon: 127.0, lat: 39.5, alt: 0, confidence: 'scenario', sourceNote: '기본 SRBM 발사원점' },
  SRBM_TARGET: { lon: 127.03, lat: 37.0, alt: 0, confidence: 'scenario', sourceNote: '기본 SRBM 표적' },
});

const msam = (key, lon, lat, brigade, legacy = false, sourceNote = null) => Object.freeze({
  posKey: key,
  mfrKey: `${key}_MFR`,
  pos: { lon, lat, alt: 130, confidence: 'estimated', sourceNote: sourceNote ?? `ADR-022 §16.2 천궁${legacy ? '-I' : '-II'} ${brigade}여단 추정` },
  mfr: { lon: lon + 0.005, lat: lat + 0.005, alt: 150, confidence: 'estimated', sourceNote: sourceNote ? `포대별 MSAM MFR near ${sourceNote}` : '포대별 MSAM MFR' },
  brigade,
  typeId: legacy ? 'CHEONGUNG1' : 'CHEONGUNG2',
});

const HANBANDO_FULL_MSAM_SITES = Object.freeze([
  msam('MSAM2_ANDONG', 128.354, 36.631, 1, false, 'ADR-037 예천 공항 대표 노드'),
  msam('MSAM2_DAEGU', 128.637, 35.894, 1, false, 'ADR-037 대구공항 대표 노드'),
  msam('MSAM2_BUSAN', 128.070, 35.088, 1, false, 'ADR-037 사천공항 대표 노드'),
  msam('MSAM2_ULSAN', 129.352, 35.593, 1, false, 'ADR-037 울산공항 대표 노드'),
  msam('MSAM2_POHANG', 129.420, 35.987, 1, false, 'ADR-037 포항경주공항 대표 노드'),
  msam('MSAM2_GWANGJU', 126.808, 35.126, 1, false, 'ADR-037 광주공항 대표 노드'),
  msam('MSAM2_YEOSU', 127.616, 34.842, 1, false, 'ADR-037 여수공항 대표 노드'),
  msam('MSAM2_MOKPO', 126.379, 34.758, 1, false, 'ADR-037 목포공항 대표 노드'),
  msam('MSAM2_CHEONAN', 127.200, 36.620, 2, false, 'ADR-037 천안-세종 중간 대표 노드'),
  msam('MSAM2_DANGJIN', 126.65, 36.90, 2),
  msam('MSAM2_CHEONGJU', 126.943, 37.399, 3, false, 'Phase 4.2 correction: 수도군단사령부 바로 위 학우봉 대표 노드'),
  msam('MSAM2_CHUNGJU', 127.813, 37.864, 2, false, 'Phase 4.2 correction: 춘천시 대룡산 대표 노드'),
  msam('MSAM2_WONJU', 127.240, 36.309, 2, false, 'ADR-037 계룡대 대표 노드'),
  msam('MSAM2_GANGNEUNG', 128.663, 35.175, 1, false, 'Phase 4.2 correction: 진해 603봉 대표 노드'),
  msam('MSAM2_SOKCHO', 128.598, 38.142, 2, false, 'ADR-037 속초공항 대표 노드'),
  msam('MSAM2_GIMPO', 126.72, 37.62, 3),
  msam('MSAM2_INCHEON', 126.450, 37.460, 3, false, 'ADR-037 인천국제공항 대표 노드'),
  msam('MSAM2_SUWON', 127.00, 37.25, 3),
  msam('MSAM2_ICHEON', 127.45, 37.27, 3),
  msam('MSAM2_YEONCHEON', 127.159, 37.683, 3, false, 'Phase 4.2 correction: 남양주 율석리 대표 노드'),
  msam('MSAM2_BAENGNYEONG', 124.710, 37.970, 3, false, 'ADR-037 백령도 서북도서 대표 노드'),
  msam('MSAM2_YEONPYEONG', 125.700, 37.660, 3, false, 'ADR-037 연평도 서북도서 대표 노드'),
]);

for (const site of HANBANDO_FULL_MSAM_SITES) {
  HANBANDO_FULL_POSITIONS[site.posKey] = Object.freeze(site.pos);
  HANBANDO_FULL_POSITIONS[site.mfrKey] = Object.freeze(site.mfr);
}

// ── ADR-049 — 천마·비호 중대(6대) 노드 재편 + 차량 개별 관리 ───────────────────────
// 6대=1노드(중대) 가정: 비호 167대→28노드(6×27+5), 천마 100대→17노드(6×16+4). 총 대수(167/100) 보존.
// 각 노드는 차량 수만큼 발사대(batteryConfig.launchers.AAM=차량수)를 가지며, 차량별 탄약(비호4/천마8)·
// 재장전(ADR-048)·동시교전(가용차량×차량당동시교전, ADR-049)이 개별 관리된다.
//
// 배치 (ADR-049 배치 결함 수정, 2026-07-06 사용자 브라우저 검수):
//   구 구현은 옛 12개 포대 앵커(분계선보다 10~25km 남쪽) 직선 보간이라 (1) 한강하구 중립수역
//   구간(126.49~126.70E)에서 강화-파주 직선 위도(37.77~37.79)가 중립수역/북측 개풍 연안에 찍히고,
//   (2) 전체가 실제 분계선 곡선이 아니며, (3) 동단 128.40E/38.22N 이 실제 동부 접경(고성 명파리
//   38.61N)을 못 덮었다. 수정:
//   - 고정밀 MDL 궤적 단일 권위 = geo-mdl.js (잎 모듈, import 순환 없음). scenarios.js 의
//     MDL_POLYLINE(위협 원점용, 사용자 시각 검증 완료)은 별개 권위 — 건드리지 않는다.
//   - 본 벨트 = 경도 126.75(문산/파주 서측)→128.36(고성) 구간에서 MDL 궤적의 **호길이 등간격**
//     표본을 뜨고 분계선 남쪽 수직 오프셋 9km(비호/천마 교차 ±0.004° lat 유지).
//   - 한강하구 구간(경도 < 126.75)은 보간 금지 — 남안 육지 수동 앵커 2개(강화 본섬/김포반도)에
//     서쪽 끝 노드들을 배정(중립수역 대안 감시 취지: 수역 건너 감시·대응 자산을 남안 육지에 둔다).
const SHORAD_BELT_LON_WEST = 126.75;   // 문산/파주 서측 (본 벨트 서단)
const SHORAD_BELT_LON_EAST = 128.36;   // 고성 명파리 (본 벨트 동단)
// 9km (2026-07-06 검수 2차: 궤적 근사 오차 ±3~5km 를 흡수할 안전 여유 — 6km 로는 동부에서
// DMZ 띠 침범이 재발했다. 가드 테스트 최소 남측 이격 4km 와 함께 이중 방어.)
const SHORAD_BELT_SOUTH_OFFSET_KM = 9; // 분계선 남쪽 수직 오프셋
const SHORAD_COMPANY_VEHICLES = 6;     // 6대 = 1중대 = 1노드
const SHORAD_TOTAL_VEHICLES = Object.freeze({ BIHO: 167, CHUNMA: 100 });

// 한강하구 중립수역 남안 육지 수동 앵커 (서→동). 보간 금지 구간(lon < 126.75)의 서쪽 끝 노드 배정처.
const SHORAD_ESTUARY_ANCHORS = Object.freeze([
  Object.freeze({ lon: 126.45, lat: 37.71, label: '강화 본섬 남안' }),
  Object.freeze({ lon: 126.62, lat: 37.66, label: '김포반도' }),
]);

// 총 대수를 6대 단위로 분할(마지막 노드는 잔여). 예: 167→[6×27,5], 100→[6×16,4].
function partitionCompanyVehicles(total, perNode = SHORAD_COMPANY_VEHICLES) {
  const nodes = [];
  let remaining = total;
  while (remaining > 0) {
    nodes.push(Math.min(perNode, remaining));
    remaining -= perNode;
  }
  return nodes;
}

// 유형별 노드 배치: 서쪽 끝 2개 = 한강하구 남안 수동 앵커, 나머지 = 본 벨트 MDL 호길이 등간격
// (분계선 남쪽 9km). latOffset 으로 비호/천마 교차(±0.004°).
function makeShoradCompanySites(shooterTypeId, latOffset, koreanName) {
  const vehiclesPerNode = partitionCompanyVehicles(SHORAD_TOTAL_VEHICLES[shooterTypeId]);
  const estuaryCount = SHORAD_ESTUARY_ANCHORS.length;
  const beltCount = vehiclesPerNode.length - estuaryCount;
  const beltPoints = sampleMdlDefensePoints(SHORAD_BELT_LON_WEST, SHORAD_BELT_LON_EAST, beltCount);
  return vehiclesPerNode.map((vehicles, idx) => {
    let lon;
    let lat;
    let estuary = false;
    if (idx < estuaryCount) {
      const anchor = SHORAD_ESTUARY_ANCHORS[idx];
      lon = Number(anchor.lon.toFixed(4));
      lat = Number((anchor.lat + latOffset).toFixed(4));
      estuary = true;
    } else {
      const p = beltPoints[idx - estuaryCount];
      lon = Number(p.lon.toFixed(4));
      lat = Number((p.lat - SHORAD_BELT_SOUTH_OFFSET_KM / KM_PER_DEG_LAT + latOffset).toFixed(4));
    }
    return { shooterTypeId, posKey: `${shooterTypeId}_CO${idx + 1}`, lon, lat, vehicles, koreanName, estuary };
  });
}

const SHORAD_COMPANY_SITES_RAW = [
  ...makeShoradCompanySites('BIHO', -0.004, '비호'),   // 28노드 (하구 앵커 2 + 벨트 26)
  ...makeShoradCompanySites('CHUNMA', 0.004, '천마'),  // 17노드 (하구 앵커 2 + 벨트 15)
];

// ICC 15/15/15 — 전체 45노드를 경도 오름차순 3등분(지리 연속 + 노드 수 균일).
//   서/중/동 전방 ICC(ARMY_WEST/CENTRAL/EAST_FRONT_AD)에 균일 배정.
const SHORAD_ICC_BAND_SIZE = Math.ceil(SHORAD_COMPANY_SITES_RAW.length / 3);
const SHORAD_LOCAL_AD_BY_POSKEY = (() => {
  const sorted = [...SHORAD_COMPANY_SITES_RAW].sort(
    (a, b) => a.lon - b.lon || (a.posKey < b.posKey ? -1 : 1),
  );
  const map = new Map();
  sorted.forEach((site, rank) => {
    const iccPosKey = rank < SHORAD_ICC_BAND_SIZE ? 'ARMY_WEST_FRONT_AD'
      : rank < 2 * SHORAD_ICC_BAND_SIZE ? 'ARMY_CENTRAL_FRONT_AD'
      : 'ARMY_EAST_FRONT_AD';
    map.set(site.posKey, iccPosKey);
  });
  return map;
})();

const HANBANDO_FULL_LOCAL_AD_SHORAD_SITES = Object.freeze(SHORAD_COMPANY_SITES_RAW.map(site => Object.freeze({
  shooterTypeId: site.shooterTypeId,
  posKey: site.posKey,
  localAdPosKey: SHORAD_LOCAL_AD_BY_POSKEY.get(site.posKey),
  lon: site.lon,
  lat: site.lat,
  quantity: site.vehicles,
  sourceNote: site.estuary
    ? `ADR-049 ${site.koreanName} 중대(${site.vehicles}대) 한강하구 남안 육지 수동 앵커 노드 (중립수역 대안 감시 — 보간 금지 구간)`
    : `ADR-049 ${site.koreanName} 중대(${site.vehicles}대) MDL 남측 6km 호길이 등간격 벨트 노드 (geo-mdl 궤적)`,
})));

for (const site of HANBANDO_FULL_LOCAL_AD_SHORAD_SITES) {
  HANBANDO_FULL_POSITIONS[site.posKey] = Object.freeze({
    lon: site.lon,
    lat: site.lat,
    alt: 80,
    confidence: 'estimated',
    sourceNote: site.sourceNote,
  });
}
Object.freeze(HANBANDO_FULL_POSITIONS);

const iccForBrigade = (brigade) => `ICC_BRIGADE_${brigade}`;

const HANBANDO_FULL_TPS880K_LOCAL_AD = Object.freeze({
  TPS880K_YEONPYEONG: 'MARINE_NW_AD',
  TPS880K_BAENGNYEONG: 'MARINE_NW_AD',
  TPS880K_GANGHWA: 'ARMY_WEST_FRONT_AD',
  TPS880K_PAJU: 'ARMY_WEST_FRONT_AD',
  TPS880K_YEONCHEON: 'ARMY_CENTRAL_FRONT_AD',
  TPS880K_CHEORWON: 'ARMY_CENTRAL_FRONT_AD',
  TPS880K_HWACHEON: 'ARMY_CENTRAL_FRONT_AD',
  TPS880K_YANGGU: 'ARMY_EAST_FRONT_AD',
  TPS880K_SEOHWA: 'ARMY_EAST_FRONT_AD',
  TPS880K_GOSEONG: 'ARMY_EAST_FRONT_AD',
  TPS880K_GANGNEUNG: 'ARMY_EAST_FRONT_AD',
  TPS880K_SEOUL: 'ARMY_CAPITAL_AD',
});

const HANBANDO_FULL_USFK_PATRIOT_SITES = Object.freeze([
  ['USFK_PATRIOT_OSAN', 'PATRIOT_MFR_USFK_OSAN'],
  ['USFK_PATRIOT_HUMPHREYS', 'PATRIOT_MFR_USFK_HUMPHREYS'],
  ['USFK_PATRIOT_KUNSAN', 'PATRIOT_MFR_USFK_KUNSAN'],
  ['USFK_PATRIOT_CASEY', 'PATRIOT_MFR_USFK_CASEY'],
  ['USFK_PATRIOT_CAMP_WALKER', 'PATRIOT_MFR_USFK_CAMP_WALKER'],
]);

const HANBANDO_FULL_LSAM_BATTERIES = Object.freeze([
  Object.freeze({ shooterTypeId: 'LSAM', posKey: 'LSAM_SOUTH', mfrSensorTypeId: 'LSAM_MFR', mfrSensorPosKey: 'LSAM_MFR_SOUTH', maxSimultaneous: 10, totalRounds: { ABM: 12, AAM: 12 }, iccPosKey: 'ICC_BRIGADE_1', confidence: 'estimated' }),
  Object.freeze({ shooterTypeId: 'LSAM', posKey: 'LSAM_MID_NORTH', mfrSensorTypeId: 'LSAM_MFR', mfrSensorPosKey: 'LSAM_MFR_MID_NORTH', maxSimultaneous: 10, totalRounds: { ABM: 12, AAM: 12 }, iccPosKey: 'ICC_BRIGADE_2', confidence: 'estimated' }),
  Object.freeze({ shooterTypeId: 'LSAM', posKey: 'LSAM_CAPITAL', mfrSensorTypeId: 'LSAM_MFR', mfrSensorPosKey: 'LSAM_MFR_CAPITAL', maxSimultaneous: 10, totalRounds: { ABM: 12, AAM: 12 }, iccPosKey: 'ICC_BRIGADE_3', confidence: 'estimated' }),
]);

const HANBANDO_FULL_MSAM_BATTERIES = Object.freeze(HANBANDO_FULL_MSAM_SITES.map(site => Object.freeze({
  shooterTypeId: site.typeId,
  posKey: site.posKey,
  mfrSensorTypeId: 'MSAM_MFR',
  mfrSensorPosKey: site.mfrKey,
  maxSimultaneous: site.typeId === 'CHEONGUNG1' ? 6 : 10,
  totalRounds: site.typeId === 'CHEONGUNG1' ? { AAM: 16 } : { ABM: 16, AAM: 16 },
  iccPosKey: iccForBrigade(site.brigade),
  confidence: 'estimated',
})));

const HANBANDO_FULL_PAC3_BATTERIES = Object.freeze([
  ['PAC3_BUSAN', 'PATRIOT_MFR_BUSAN', 1],
  ['PAC3_CHEONAN', 'PATRIOT_MFR_CHEONAN', 3],
  ['PAC3_DANGJIN', 'PATRIOT_MFR_DANGJIN', 2],
  ['PAC3_CHUNGJU', 'PATRIOT_MFR_CHUNGJU', 2],
  ['PAC3_CHEONGJU', 'PATRIOT_MFR_CHEONGJU', 2],
  ['PAC3_WONJU', 'PATRIOT_MFR_WONJU', 2],
  ['PAC3_GANGNEUNG', 'PATRIOT_MFR_GANGNEUNG', 2],
  ['PAC3_BUKAKSAN', 'PATRIOT_MFR_BUKAKSAN', 3],
].map(([posKey, mfrKey, brigade]) => Object.freeze({
  shooterTypeId: 'PAC3',
  posKey,
  mfrSensorTypeId: 'PATRIOT_RADAR',
  mfrSensorPosKey: mfrKey,
  maxSimultaneous: 9,
  totalRounds: { ABM: 72 },
  iccPosKey: iccForBrigade(brigade),
  confidence: HANBANDO_FULL_POSITIONS[posKey].confidence,
})));

const HANBANDO_FULL_THAAD_BATTERIES = Object.freeze([
  Object.freeze({
    shooterTypeId: 'THAAD',
    posKey: 'THAAD_SEONGJU',
    mfrSensorTypeId: 'AN_TPY2',
    mfrSensorPosKey: 'AN_TPY2_SEONGJU',
    maxSimultaneous: 6,
    totalRounds: { ABM: 48 },
    // ADR-036: THAAD 는 KAMD ICC 산하가 아니라 USFK_THAAD C2 축. iccPosKey 를 비워 한국군 ICC 매핑을 피한다.
    iccPosKey: null,
    commandC2PosKey: 'USFK_THAAD_C2',
    c2Axis: 'USFK_THAAD',
    forceOwner: 'USFK',
    confidence: 'public',
  }),
]);

const HANBANDO_FULL_USFK_PATRIOT_BATTERIES = Object.freeze(
  HANBANDO_FULL_USFK_PATRIOT_SITES.map(([posKey, mfrKey]) => Object.freeze({
    shooterTypeId: 'USFK_PAC3',
    posKey,
    mfrSensorTypeId: 'PATRIOT_RADAR',
    mfrSensorPosKey: mfrKey,
    maxSimultaneous: 9,
    totalRounds: { ABM: 72 },
    iccPosKey: null,
    commandC2PosKey: 'USFK_PATRIOT_C2',
    c2Axis: 'USFK_PATRIOT',
    forceOwner: 'USFK',
    confidence: HANBANDO_FULL_POSITIONS[posKey].confidence,
    sourceNote: HANBANDO_FULL_POSITIONS[posKey].sourceNote,
  })),
);

// ──────────────────────────────────────────────────────────────────
// SHORAD 노드 = 중대(차량 집합) + 차량(발사대) 개별 관리 (ADR-049)
// 각 BIHO/CHUNMA 노드(중대)는 site.quantity 대의 차량을 담으며, 차량 각각이 발사대(TEL) 1대다.
//   batteryConfig.launchers.AAM = 차량 수 → BatteryEntity 가 차량 수만큼 발사대를 만든다.
//   차량별 탄약(비호 4/천마 8 = roundsPerLauncher)·재장전(ADR-048)·동시교전(가용차량×perVehicleConcurrency,
//   ADR-049 동적 maxSimultaneous)이 개별 관리된다.
// 단일차량(발사대) 권위 제원 = weapon-data.js SHOOTER_TYPES.{BIHO,CHUNMA}.battery
//   (launchers{AAM:1}/roundsPerLauncher/perVehicleConcurrency). 아래는 배치 계층에서 그 per-vehicle
//   제원을 노드 차량 수만큼 발사대로 스케일한 미러(수치는 weapon-data 와 정합).
// totalRounds/maxSimultaneous 는 만재(full) 기준선(HUD/로스터 baseline)이며, 런타임 유효 동시교전은
//   BatteryEntity.maxSimultaneous getter 가 가용 차량 수 기준으로 동적 산정한다.
const SHORAD_PER_VEHICLE_SPEC = Object.freeze({
  BIHO:   Object.freeze({ roundsPerLauncher: 4, perVehicleConcurrency: 4 }),
  CHUNMA: Object.freeze({ roundsPerLauncher: 8, perVehicleConcurrency: 8 }),
});

const HANBANDO_FULL_LOCAL_AD_SHORAD_BATTERIES = Object.freeze(
  HANBANDO_FULL_LOCAL_AD_SHORAD_SITES.map(site => {
    const perVehicle = SHORAD_PER_VEHICLE_SPEC[site.shooterTypeId];
    const vehicles = site.quantity;   // 노드 차량 수 = 발사대 수
    return Object.freeze({
      shooterTypeId: site.shooterTypeId,
      posKey: site.posKey,
      mfrSensorTypeId: null,
      mfrSensorPosKey: null,
      // 만재 기준선: 발사대 수 × 차량당 탄약/동시교전 (런타임은 가용 차량 기준 동적).
      maxSimultaneous: perVehicle.perVehicleConcurrency * vehicles,
      totalRounds: Object.freeze({ AAM: perVehicle.roundsPerLauncher * vehicles }),
      // 노드 차량 수만큼 발사대(=차량)를 스케일 — 차량별 탄약·재장전·동시교전 개별 관리.
      batteryConfig: Object.freeze({
        mfr: null,
        launchers: Object.freeze({ AAM: vehicles }),
        roundsPerLauncher: perVehicle.roundsPerLauncher,
        perVehicleConcurrency: perVehicle.perVehicleConcurrency,
        reloadDurationSec: 900,
      }),
      iccPosKey: null,
      commandC2PosKey: site.localAdPosKey,
      c2Axis: 'LOCAL_AD',
      forceOwner: 'ROK_LOCAL_AD',
      localAdPosKey: site.localAdPosKey,
      quantity: site.quantity,
      confidence: 'estimated',
      sourceNote: site.sourceNote,
    });
  }),
);

const HANBANDO_FULL_BATTERIES = Object.freeze([
  ...HANBANDO_FULL_LSAM_BATTERIES,
  ...HANBANDO_FULL_MSAM_BATTERIES,
  ...HANBANDO_FULL_PAC3_BATTERIES,
  ...HANBANDO_FULL_LOCAL_AD_SHORAD_BATTERIES,
  ...HANBANDO_FULL_THAAD_BATTERIES,
  ...HANBANDO_FULL_USFK_PATRIOT_BATTERIES,
]);

const HANBANDO_FULL_SENSORS = Object.freeze([
  Object.freeze({ typeId: 'GREEN_PINE_B', posKey: 'GREEN_PINE_CHUNGNAM', radarRangeKm: 900, radarColor: '#44cc44', confidence: 'estimated' }),
  Object.freeze({ typeId: 'GREEN_PINE_B', posKey: 'GREEN_PINE_CHUNGBUK', radarRangeKm: 900, radarColor: '#44cc44', confidence: 'estimated' }),
  Object.freeze({ typeId: 'GREEN_PINE_C', posKey: 'GREEN_PINE_BUSAN', radarRangeKm: 900, radarColor: '#33ff88', confidence: 'public' }),
  Object.freeze({ typeId: 'GREEN_PINE_C', posKey: 'GREEN_PINE_JEONNAM', radarRangeKm: 900, radarColor: '#33ff88', confidence: 'estimated' }),
  ...[
    'FPS117_BAENGNYEONG', 'FPS117_ULLEUNG', 'FPS117_JEJU', 'FPS117_GANGWON_N',
    'FPS117_GANGWON_S', 'FPS117_GYEONGGI', 'FPS117_CHUNGBUK', 'FPS117_CHUNGNAM',
    'FPS117_JEONBUK', 'FPS117_JEONNAM_W', 'FPS117_JEONNAM_E', 'FPS117_GYEONGBUK_N',
    'FPS117_GYEONGBUK_S', 'FPS117_GYEONGNAM', 'FPS117_BUSAN', 'FPS117_ULSAN',
  ].map(posKey => Object.freeze({ typeId: 'FPS117', posKey, radarRangeKm: 470, radarColor: '#88ccff', confidence: HANBANDO_FULL_POSITIONS[posKey].confidence })),
  ...Object.entries(HANBANDO_FULL_TPS880K_LOCAL_AD)
    .map(([posKey, localAdPosKey]) => Object.freeze({
      typeId: 'TPS880K',
      posKey,
      radarRangeKm: 40,
      radarColor: '#ccff88',
      confidence: HANBANDO_FULL_POSITIONS[posKey].confidence,
      sourceNote: HANBANDO_FULL_POSITIONS[posKey].sourceNote,
      localAdPosKey,
    })),
  ...['LSAM_MFR_SOUTH', 'LSAM_MFR_MID_NORTH', 'LSAM_MFR_CAPITAL']
    .map(posKey => Object.freeze({ typeId: 'LSAM_MFR', posKey, radarRangeKm: 310, radarColor: '#00aaff', confidence: 'estimated' })),
  ...HANBANDO_FULL_MSAM_SITES.map(site => Object.freeze({ typeId: 'MSAM_MFR', posKey: site.mfrKey, radarRangeKm: 100, radarColor: '#ff66cc', confidence: 'estimated' })),
  ...['PATRIOT_MFR_BUSAN', 'PATRIOT_MFR_CHEONAN', 'PATRIOT_MFR_DANGJIN', 'PATRIOT_MFR_CHUNGJU', 'PATRIOT_MFR_CHEONGJU', 'PATRIOT_MFR_WONJU', 'PATRIOT_MFR_GANGNEUNG', 'PATRIOT_MFR_BUKAKSAN']
    .map(posKey => Object.freeze({ typeId: 'PATRIOT_RADAR', posKey, radarRangeKm: 180, radarColor: '#ffaa00', confidence: HANBANDO_FULL_POSITIONS[posKey].confidence })),
  ...HANBANDO_FULL_USFK_PATRIOT_SITES
    .map(([, posKey]) => Object.freeze({
      typeId: 'PATRIOT_RADAR',
      posKey,
      radarRangeKm: 180,
      radarColor: '#ffcc44',
      confidence: HANBANDO_FULL_POSITIONS[posKey].confidence,
      sourceNote: HANBANDO_FULL_POSITIONS[posKey].sourceNote,
      c2Axis: 'USFK_PATRIOT',
      forceOwner: 'USFK',
    })),
  Object.freeze({ typeId: 'AN_TPY2', posKey: 'AN_TPY2_SEONGJU', radarRangeKm: 600, radarColor: '#cc66ff', confidence: 'public', c2Axis: 'USFK_THAAD', forceOwner: 'USFK' }),
]);

const HANBANDO_FULL_C2_BASE = Object.freeze([
  Object.freeze({ typeId: 'ICC', posKey: 'ICC_BRIGADE_1', showNetworkNode: true, instanceLabel: 'ICC 1여단' }),
  Object.freeze({ typeId: 'ICC', posKey: 'ICC_BRIGADE_2', showNetworkNode: true, instanceLabel: 'ICC 2여단' }),
  Object.freeze({ typeId: 'ICC', posKey: 'ICC_BRIGADE_3', showNetworkNode: true, instanceLabel: 'ICC 3여단' }),
  Object.freeze({ typeId: 'USFK_THAAD_C2', posKey: 'USFK_THAAD_C2', showNetworkNode: true, instanceLabel: 'USFK THAAD C2', c2Axis: 'USFK_THAAD', forceOwner: 'USFK' }),
  Object.freeze({ typeId: 'USFK_PATRIOT_C2', posKey: 'USFK_PATRIOT_C2', showNetworkNode: true, instanceLabel: 'USFK Patriot C2', c2Axis: 'USFK_PATRIOT', forceOwner: 'USFK' }),
  Object.freeze({ typeId: 'ARMY_LOCAL_AD', posKey: 'ARMY_WEST_FRONT_AD', showNetworkNode: true, instanceLabel: '육군 서부전방 군단 AOC/C2A' }),
  Object.freeze({ typeId: 'ARMY_LOCAL_AD', posKey: 'ARMY_CENTRAL_FRONT_AD', showNetworkNode: true, instanceLabel: '육군 중부전방 군단 AOC/C2A' }),
  Object.freeze({ typeId: 'ARMY_LOCAL_AD', posKey: 'ARMY_EAST_FRONT_AD', showNetworkNode: true, instanceLabel: '육군 동부전방 군단 AOC/C2A' }),
  Object.freeze({ typeId: 'ARMY_LOCAL_AD', posKey: 'ARMY_CAPITAL_AD', showNetworkNode: true, instanceLabel: '수방사 AOC/C2A' }),
  Object.freeze({ typeId: 'ARMY_LOCAL_AD', posKey: 'MARINE_NW_AD', showNetworkNode: true, instanceLabel: '해병 서북도서 방공 AOC/C2A' }),
  ...HANBANDO_FULL_BATTERIES.map(b => Object.freeze({
    typeId: 'ECS',
    posKey: b.posKey,
    showNetworkNode: true,
    instanceLabel: `ECS ${b.shooterTypeId} ${b.posKey}`,
  })),
  Object.freeze({ typeId: 'IAOC', posKey: 'IAOC', showNetworkNode: false }),
  Object.freeze({ typeId: 'EOC', posKey: 'EOC', showNetworkNode: false }),
]);

const KAMDOC_FULL_ENTRY = Object.freeze({
  typeId: 'KAMD_OPS', posKey: 'KAMD_OPS', showNetworkNode: true, instanceLabel: 'KAMD_OPS',
});

const MCRC_FULL_ENTRY = Object.freeze({
  typeId: 'MCRC', posKey: 'MCRC', showNetworkNode: true, instanceLabel: 'MCRC 중앙방공통제소',
});

const RAW_DEPLOYMENT_HANBANDO_FULL_NORMAL = Object.freeze({
  id: 'HANBANDO_FULL_NORMAL',
  name: '한반도 본 배치 — 정상',
  description: 'Phase 4.2: 2030 가정 본 배치. KAMDOC + MCRC 정상, THAAD는 ADR-036 USFK 독립축.',
  positions: HANBANDO_FULL_POSITIONS,
  batteries: HANBANDO_FULL_BATTERIES,
  sensors: HANBANDO_FULL_SENSORS,
  c2Nodes: Object.freeze([KAMDOC_FULL_ENTRY, MCRC_FULL_ENTRY, ...HANBANDO_FULL_C2_BASE]),
});

const RAW_DEPLOYMENT_HANBANDO_FULL_MCRC_DOWN = Object.freeze({
  id: 'HANBANDO_FULL_MCRC_DOWN',
  name: '한반도 본 배치 — MCRC 무력화',
  description: 'Phase 4.2: 본 배치 상황 B. KAMDOC 정상 + MCRC 부재, THAAD는 USFK 독립축.',
  positions: HANBANDO_FULL_POSITIONS,
  batteries: HANBANDO_FULL_BATTERIES,
  sensors: HANBANDO_FULL_SENSORS,
  c2Nodes: Object.freeze([KAMDOC_FULL_ENTRY, ...HANBANDO_FULL_C2_BASE]),
});

const RAW_DEPLOYMENT_HANBANDO_FULL_KAMDOC_DOWN = Object.freeze({
  id: 'HANBANDO_FULL_KAMDOC_DOWN',
  name: '한반도 본 배치 — KAMDOC 무력화',
  description: 'Phase 4.2: 본 배치 상황 C. KAMDOC 부재 + MCRC 정상, THAAD는 USFK 독립축.',
  positions: HANBANDO_FULL_POSITIONS,
  batteries: HANBANDO_FULL_BATTERIES,
  sensors: HANBANDO_FULL_SENSORS,
  c2Nodes: Object.freeze([MCRC_FULL_ENTRY, ...HANBANDO_FULL_C2_BASE]),
});

// ════════════════════════════════════════════════════════════════
// 시나리오 1: DEPLOYMENT_HANBANDO_MINI_NORMAL (상황 A)
// ════════════════════════════════════════════════════════════════
// 탄도탄 본사장 + 비행기 본사장 둘 다 정상. 측정 본체 = dual-mission 이중지휘 비효율.
const RAW_DEPLOYMENT_HANBANDO_MINI_NORMAL = Object.freeze({
  id: 'HANBANDO_MINI_NORMAL',
  name: '한반도 미니 — 정상',
  description: '상황 A: KAMDOC + MCRC 둘 다 정상. 8 포대 + 다중 ICC. dual-mission 이중지휘 측정.',
  positions: HANBANDO_MINI_POSITIONS,
  batteries: HANBANDO_MINI_BATTERIES,
  sensors: HANBANDO_MINI_SENSORS,
  c2Nodes: Object.freeze([KAMDOC_ENTRY, MCRC_ENTRY, ...HANBANDO_MINI_C2_BASE]),
});

// ════════════════════════════════════════════════════════════════
// 시나리오 2: DEPLOYMENT_HANBANDO_MINI_MCRC_DOWN (상황 B)
// ════════════════════════════════════════════════════════════════
// 비행기 본사장(MCRC) 부재 → 각 권역 ICC 가 비행기 위협 직접 판단.
// 측정 본체 = ABT cross-ICC 중복교전 자연 발현.
const RAW_DEPLOYMENT_HANBANDO_MINI_MCRC_DOWN = Object.freeze({
  id: 'HANBANDO_MINI_MCRC_DOWN',
  name: '한반도 미니 — MCRC 무력화',
  description: '상황 B: KAMDOC 정상 + MCRC 부재. ABT 위협 = 각 ICC 권역 독립 → cross-ICC 중복교전 측정.',
  positions: HANBANDO_MINI_POSITIONS,
  batteries: HANBANDO_MINI_BATTERIES,
  sensors: HANBANDO_MINI_SENSORS,
  c2Nodes: Object.freeze([KAMDOC_ENTRY, ...HANBANDO_MINI_C2_BASE]),
});

// ════════════════════════════════════════════════════════════════
// 시나리오 3: DEPLOYMENT_HANBANDO_MINI_KAMDOC_DOWN (상황 C)
// ════════════════════════════════════════════════════════════════
// 탄도탄 본사장(KAMDOC) 부재 → 각 권역 ICC 가 탄도탄 위협 직접 판단.
// 측정 본체 = ballistic cross-ICC 중복교전 자연 발현. Phase 4.4 노드파괴 시연.
const RAW_DEPLOYMENT_HANBANDO_MINI_KAMDOC_DOWN = Object.freeze({
  id: 'HANBANDO_MINI_KAMDOC_DOWN',
  name: '한반도 미니 — KAMDOC 무력화',
  description: '상황 C: KAMDOC 부재 + MCRC 정상. ballistic 위협 = 각 ICC 권역 독립 → cross-ICC 중복교전 측정.',
  positions: HANBANDO_MINI_POSITIONS,
  batteries: HANBANDO_MINI_BATTERIES,
  sensors: HANBANDO_MINI_SENSORS,
  c2Nodes: Object.freeze([MCRC_ENTRY, ...HANBANDO_MINI_C2_BASE]),
});

// ════════════════════════════════════════════════════════════════
// DEPLOYMENTS — 레지스트리 (index.html 토글)
// ════════════════════════════════════════════════════════════════
// Phase 4.2 진입: HANBANDO_MINI 3종 + HANBANDO_FULL 3종.


  var positionMemo = new WeakMap();
  var batteryMemo = new WeakMap();
  var sensorMemo = new WeakMap();

  function freezeAll(o) {
    if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.keys(o).forEach(function (k) { freezeAll(o[k]); });
    return Object.freeze(o);
  }

  function normalizePositions(raw, batteries) {
    if (positionMemo.has(raw)) return positionMemo.get(raw);
    var out = {};
    Object.keys(raw).forEach(function (key) {
      var p = raw[key];
      var confidence = p.confidence || 'estimated';
      out[key] = Object.freeze(Object.assign({}, p, {
        confidence: confidence,
        sourceNote: p.sourceNote || 'IADS_codex_original 대표 개념좌표; 공개근거 미상은 estimated',
        coordNote: p.coordNote || (confidence === 'public'
          ? '공개자료 기반 도시·권역 수준 개념좌표'
          : '연구용 추정·도시·권역 수준 개념좌표')
      }));
    });
    // 포대의 ECS는 이미 posKey를 공유한다. 포대 전속 MFR/Patriot radar도 같은
    // 공동 사이트의 위·경도를 사용하고, 안테나 고도와 출처 메타만 유지한다.
    (batteries || []).forEach(function (b) {
      if (!b.mfrSensorPosKey || !out[b.posKey] || !out[b.mfrSensorPosKey]) return;
      var batteryPos = out[b.posKey], sensorPos = out[b.mfrSensorPosKey];
      out[b.mfrSensorPosKey] = Object.freeze(Object.assign({}, sensorPos, {
        lon: batteryPos.lon,
        lat: batteryPos.lat,
        coLocatedWith: b.posKey,
        coordNote: '포대·ECS·MFR/레이더 공동 개념 사이트(동일 위·경도)'
      }));
    });
    out = Object.freeze(out);
    positionMemo.set(raw, out);
    return out;
  }

  function roundsTotal(totalRounds) {
    return Object.keys(totalRounds || {}).reduce(function (sum, key) {
      return sum + (Number(totalRounds[key]) || 0);
    }, 0);
  }

  function normalizeBatteries(raw, positions) {
    if (batteryMemo.has(raw)) return batteryMemo.get(raw);
    var out = raw.map(function (b) {
      var type = KJ.SHOOTER_TYPES[b.shooterTypeId] || {};
      var q = b.quantity || 1;
      var bc = b.batteryConfig || {};
      var launcherCount = bc.launchers
        ? Object.keys(bc.launchers).reduce(function (sum, k) { return sum + bc.launchers[k]; }, 0)
        : ((type.battery && type.battery.launcherCount) || 1);
      var firstMissile = type.missiles && type.missiles[Object.keys(type.missiles)[0]];
      var roundsPerLauncher = bc.roundsPerLauncher || (firstMissile && firstMissile.roundsPerLauncher) || null;
      return freezeAll(Object.assign({}, b, {
        id: 'BATTERY_' + b.posKey,
        quantity: q,
        confidence: b.confidence || (positions[b.posKey] && positions[b.posKey].confidence) || 'estimated',
        sourceNote: b.sourceNote || (positions[b.posKey] && positions[b.posKey].sourceNote) ||
          'IADS_codex_original deployment declaration',
        launcherConfig: {
          launcherCount: b.shooterTypeId === 'BIHO' || b.shooterTypeId === 'CHUNMA' ? q : launcherCount,
          roundsPerLauncher: roundsPerLauncher,
          perVehicleConcurrency: bc.perVehicleConcurrency || null,
          aggregateRounds: roundsTotal(b.totalRounds)
        },
        reloadConfig: {
          scope: 'per-launcher',
          durationSec: bc.reloadDurationSec || (type.battery && type.battery.reloadTime) || 900
        }
      }));
    });
    out = Object.freeze(out);
    batteryMemo.set(raw, out);
    return out;
  }

  function normalizeSensors(raw, positions) {
    if (sensorMemo.has(raw)) return sensorMemo.get(raw);
    var out = raw.map(function (sensorDecl) {
      return freezeAll(Object.assign({}, sensorDecl, {
        id: 'SENSOR_' + sensorDecl.posKey,
        confidence: sensorDecl.confidence || (positions[sensorDecl.posKey] && positions[sensorDecl.posKey].confidence) || 'estimated',
        sourceNote: sensorDecl.sourceNote || (positions[sensorDecl.posKey] && positions[sensorDecl.posKey].sourceNote) ||
          'IADS_codex_original sensor deployment declaration'
      }));
    });
    out = Object.freeze(out);
    sensorMemo.set(raw, out);
    return out;
  }

  function normalizeC2(raw, batteries, positions) {
    var batteryByPos = {};
    batteries.forEach(function (b) { batteryByPos[b.posKey] = b; });
    return Object.freeze(raw.map(function (node) {
      var battery = node.typeId === 'ECS' ? batteryByPos[node.posKey] : null;
      var id = node.typeId === 'ECS'
        ? 'ECS_' + node.posKey
        : 'C2_' + node.typeId + '_' + node.posKey;
      return freezeAll(Object.assign({}, node, {
        id: id,
        batteryId: battery ? battery.id : null,
        forceOwner: node.forceOwner || (battery && battery.forceOwner) || 'ROK',
        c2Axis: node.c2Axis || (battery && battery.c2Axis) || null,
        confidence: node.confidence || (positions[node.posKey] && positions[node.posKey].confidence) || 'estimated',
        sourceNote: node.sourceNote || (positions[node.posKey] && positions[node.posKey].sourceNote) ||
          'IADS_codex_original C2 deployment declaration'
      }));
    }));
  }

  function normalizeDeployment(raw) {
    var positions = normalizePositions(raw.positions, raw.batteries);
    var batteries = normalizeBatteries(raw.batteries, positions);
    var sensors = normalizeSensors(raw.sensors, positions);
    return freezeAll({
      id: raw.id,
      name: raw.name,
      description: raw.description + ' 정책연구용 개념 배치이며 실제 작전배치가 아니다.',
      positions: positions,
      batteries: batteries,
      sensors: sensors,
      c2Nodes: normalizeC2(raw.c2Nodes, batteries, positions)
    });
  }

  const DEPLOYMENT_HANBANDO_MINI_NORMAL = normalizeDeployment(RAW_DEPLOYMENT_HANBANDO_MINI_NORMAL);
  const DEPLOYMENT_HANBANDO_MINI_MCRC_DOWN = normalizeDeployment(RAW_DEPLOYMENT_HANBANDO_MINI_MCRC_DOWN);
  const DEPLOYMENT_HANBANDO_MINI_KAMDOC_DOWN = normalizeDeployment(RAW_DEPLOYMENT_HANBANDO_MINI_KAMDOC_DOWN);
  const DEPLOYMENT_HANBANDO_FULL_NORMAL = normalizeDeployment(RAW_DEPLOYMENT_HANBANDO_FULL_NORMAL);
  const DEPLOYMENT_HANBANDO_FULL_MCRC_DOWN = normalizeDeployment(RAW_DEPLOYMENT_HANBANDO_FULL_MCRC_DOWN);
  const DEPLOYMENT_HANBANDO_FULL_KAMDOC_DOWN = normalizeDeployment(RAW_DEPLOYMENT_HANBANDO_FULL_KAMDOC_DOWN);

  KJ.DEPLOYMENTS = Object.freeze({
    HANBANDO_MINI_NORMAL: DEPLOYMENT_HANBANDO_MINI_NORMAL,
    HANBANDO_MINI_MCRC_DOWN: DEPLOYMENT_HANBANDO_MINI_MCRC_DOWN,
    HANBANDO_MINI_KAMDOC_DOWN: DEPLOYMENT_HANBANDO_MINI_KAMDOC_DOWN,
    HANBANDO_FULL_NORMAL: DEPLOYMENT_HANBANDO_FULL_NORMAL,
    HANBANDO_FULL_MCRC_DOWN: DEPLOYMENT_HANBANDO_FULL_MCRC_DOWN,
    HANBANDO_FULL_KAMDOC_DOWN: DEPLOYMENT_HANBANDO_FULL_KAMDOC_DOWN
  });
  KJ.deploymentById = function (id) { return KJ.DEPLOYMENTS[id] || null; };
  KJ.DEPLOYMENT_IDS = Object.freeze(Object.keys(KJ.DEPLOYMENTS));

})();
