/**
 * K-JAMDS 시뮬레이터 — 축선별 개념 궤적 좌표 (Phase 4)
 *
 * 시나리오의 위협은 'west'|'central'|'east'|'seoul' 축선만 가지고 있어 정확한 좌표가 없다.
 * Phase 4 위협궤적 애니메이션·히트맵을 위해, 각 축선에 진입점(entry)→표적권역(target)
 * 개념 좌표를 부여한다. 실제 침투경로·표적이 아닌 시각화용 개념 근사이며, 다른 모든 좌표와
 * 동일하게 도시 수준 개념좌표다(디스클레이머 동일 적용).
 *
 * 위치(t) = lerp(entry, target, clamp((t - spawnT) / dwellSec, 0, 1))
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  KJ.AXES = {
    west: {
      label: '서부축(서해)',
      entry: [37.90, 125.30], entryNote: '백령도 인근 개념좌표(서해 북방)',
      target: [37.55, 126.98], targetNote: '서울 개념좌표(방호 표적권역)'
    },
    central: {
      label: '중부축(DMZ)',
      entry: [38.25, 127.31], entryNote: '철원 인근 개념좌표(중부전선)',
      target: [37.15, 127.10], targetNote: '수도권 남부 개념좌표(오산·평택 권역)'
    },
    east: {
      label: '동부축(DMZ~동해)',
      entry: [38.30, 128.40], entryNote: '고성 인근 개념좌표(동부전선)',
      target: [37.80, 128.90], targetNote: '강릉 인근 개념좌표(동해 함대 권역)'
    },
    seoul: {
      label: '수도권 직접침투',
      entry: [37.75, 126.90], entryNote: '고양 인근 개념좌표(2022.12.26 재현 진입점)',
      target: [37.56, 126.99], targetNote: '서울 도심 개념좌표'
    }
  };

  /** 위협 위치(t) 선형보간: entry→target, [0,1] 클램프 진행률 */
  KJ.axisPosition = function (axisKey, progress) {
    var a = KJ.AXES[axisKey];
    if (!a) return null;
    var p = Math.max(0, Math.min(1, progress));
    return [
      a.entry[0] + (a.target[0] - a.entry[0]) * p,
      a.entry[1] + (a.target[1] - a.entry[1]) * p
    ];
  };
})();
