(function () {
  'use strict';
  window.KJ = window.KJ || {};
/**
 * config/geo-mdl.js — 군사분계선(MDL) 육상 궤적 고정밀 근사 (방어측 배치 전용 단일 권위)
 *
 * ADR-049 배치 결함 수정 (2026-07-06 사용자 브라우저 검수):
 *   구 SHORAD 벨트는 옛 12개 포대 앵커(분계선보다 10~25km 남쪽, 철원 구간 38.11 vs 실제 38.3)를
 *   직선으로 이어 (1) 한강하구 중립수역 구간(126.49~126.70E)에서 강화-파주 직선 보간이 중립수역
 *   한복판~북측 개풍 연안에 노드를 찍고, (2) 전체가 실제 분계선 곡선이 아닌 직선 느낌이며,
 *   (3) 동단 128.40E/38.22N 이 실제 동부 접경(고성 명파리 38.61N)을 못 덮는 결함이 있었다.
 *
 * 본 모듈은 실제 군사분계선 육상 궤적의 공개 지리 기반 근사(±3~5km) 꼭짓점을 단일 권위로 담는다.
 *
 * 권위 관계 주의:
 *   - scenarios.js 의 MDL_POLYLINE 은 **위협 원점용**(북측 발사 원점 배치)이며 사용자 시각 검증
 *     완료 상태다 — 본 모듈과 별개 권위이므로 건드리지 않는다.
 *   - 본 모듈은 **방어측(SHORAD 등) 배치 전용** 권위다.
 *
 * import 순환 없음: 본 모듈은 잎(leaf) — 어떤 프로젝트 모듈도 import 하지 않는다.
 * 결정론: 순수 수학(입력→출력 고정), Date.now/Math.random 없음.
 */

const KM_PER_DEG_LAT = 111.32;

/**
 * 실제 군사분계선 육상 궤적 근사 꼭짓점 (서→동, 공개 지리 기반 근사 ±3~5km).
 * 첫 두 점(126.68E)은 임진강 하구~판문점 남쪽의 남북 방향 구간(수직 구간)이다.
 */
const MDL_DEFENSE_POLYLINE = Object.freeze([
  Object.freeze({ lon: 126.68, lat: 37.77 }),  // 임진강·한강 합수부
  Object.freeze({ lon: 126.68, lat: 37.94 }),  // 판문점 남
  Object.freeze({ lon: 126.80, lat: 37.98 }),  // 장단
  Object.freeze({ lon: 126.95, lat: 38.05 }),  // 연천 서
  Object.freeze({ lon: 127.10, lat: 38.18 }),  // 연천 북 태풍전망대
  Object.freeze({ lon: 127.35, lat: 38.30 }),  // 철원 북 백마고지~평강 남
  Object.freeze({ lon: 127.62, lat: 38.31 }),  // 김화·화천 북
  // 동부 구간 2차 하향 수정 (2026-07-06 사용자 브라우저 검수 2차): 초판 근사(38.30/38.38/38.61)가
  // 실제 분계선보다 최대 ~9km 북쪽이라 해안면(펀치볼)·서화면·수동면에서 노드가 DMZ 띠를 넘었다.
  // 지도 실측 대비 보수(남측) 하향 + 진부령 북 꼭짓점 추가.
  Object.freeze({ lon: 127.88, lat: 38.27 }),  // 양구 북 펀치볼 남서
  Object.freeze({ lon: 128.10, lat: 38.30 }),  // 서화 북
  Object.freeze({ lon: 128.22, lat: 38.36 }),  // 진부령 북
  Object.freeze({ lon: 128.36, lat: 38.58 }),  // 고성 명파리 해안
]);

/**
 * 경도 → MDL 근사 위도 (구간 선형보간, lon 의 함수).
 * - 범위 밖은 양 끝점으로 클램프.
 * - 수직 구간(같은 경도 연속 꼭짓점)은 폭 0 이라 건너뛴다 — 유효 도메인은 lon ≥ 126.68 이며,
 *   한강하구 구간(lon < 126.75)은 배치 보간 금지 도메인(수동 앵커 규칙, deployments.js 참조).
 * @param {number} lon
 * @returns {number} 위도(도)
 */
function mdlDefenseLatAt(lon) {
  const pts = MDL_DEFENSE_POLYLINE;
  if (lon <= pts[0].lon) return pts[0].lat;
  if (lon >= pts[pts.length - 1].lon) return pts[pts.length - 1].lat;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (b.lon <= a.lon) continue;              // 수직(폭 0) 구간 skip
    if (lon <= b.lon) {
      return a.lat + (b.lat - a.lat) * (lon - a.lon) / (b.lon - a.lon);
    }
  }
  return pts[pts.length - 1].lat;
}

/**
 * MDL 남측 수직 오프셋 위도 (배치선). 기본 6km 남쪽.
 * @param {number} lon
 * @param {number} [offsetKm=6]
 * @returns {number}
 */
function mdlDefenseSouthLat(lon, offsetKm = 6) {
  return mdlDefenseLatAt(lon) - offsetKm / KM_PER_DEG_LAT;
}

/**
 * MDL 궤적의 [lonStart, lonEnd] 구간을 **호길이(arc-length) 등간격**으로 count 개 표본.
 * 반환 점은 궤적 폴리라인 위에 있다(위도 = 그 경도의 보간 위도).
 * 평면 근사: dx = dLon·111.32·cos(중간위도), dy = dLat·111.32 (km).
 * @param {number} lonStart
 * @param {number} lonEnd
 * @param {number} count - 표본 수(양 끝 포함, count>=2)
 * @returns {Array<{lon: number, lat: number}>}
 */
function sampleMdlDefensePoints(lonStart, lonEnd, count) {
  const pts = MDL_DEFENSE_POLYLINE;
  // 구간 폴리라인 절단 (수직 구간은 lonStart 이west 라 자연 배제).
  const clipped = [{ lon: lonStart, lat: mdlDefenseLatAt(lonStart) }];
  for (const p of pts) {
    if (p.lon > lonStart && p.lon < lonEnd) clipped.push({ lon: p.lon, lat: p.lat });
  }
  clipped.push({ lon: lonEnd, lat: mdlDefenseLatAt(lonEnd) });

  // 누적 호길이 (km)
  const cum = [0];
  for (let i = 1; i < clipped.length; i += 1) {
    const a = clipped[i - 1];
    const b = clipped[i];
    const midLatRad = ((a.lat + b.lat) / 2) * Math.PI / 180;
    const dx = (b.lon - a.lon) * KM_PER_DEG_LAT * Math.cos(midLatRad);
    const dy = (b.lat - a.lat) * KM_PER_DEG_LAT;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];

  const samples = [];
  for (let k = 0; k < count; k += 1) {
    const target = total * (count > 1 ? k / (count - 1) : 0);
    // target 이 속한 세그먼트 탐색 후 세그먼트 내 호길이 비율로 선형보간.
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i += 1;
    const a = clipped[i - 1];
    const b = clipped[i];
    const segLen = cum[i] - cum[i - 1];
    const t = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
    samples.push({
      lon: a.lon + (b.lon - a.lon) * t,
      lat: a.lat + (b.lat - a.lat) * t,
    });
  }
  return samples;
}

  KJ.KM_PER_DEG_LAT = KM_PER_DEG_LAT;
  KJ.MDL_DEFENSE_POLYLINE = MDL_DEFENSE_POLYLINE;
  KJ.mdlDefenseLatAt = mdlDefenseLatAt;
  KJ.mdlDefenseSouthLat = mdlDefenseSouthLat;
  KJ.sampleMdlDefensePoints = sampleMdlDefensePoints;
})();
