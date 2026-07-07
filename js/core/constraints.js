/**
 * K-JAMDS 시뮬레이터 — 제약조건 어서션 (Phase 1)
 *
 * 연구 제약사항을 데이터가 위반하지 않는지 상시 검증한다 (회귀 스위트의 기초).
 *  (a) KP-SAM(신궁)·천마(단거리방공무기)는 탄도탄 교전 불가
 *  (b) KAMDOC↔THAAD 연동 노드·링크 부재
 *  (c) 디스클레이머 상시 표출
 *  (d) 모든 좌표는 도시 수준 개념좌표 (coordNote 필수)
 *  (e) KF-21은 국산 보라매로 표기 (인도수출형 F-21 아님)
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  KJ.runConstraintChecks = function () {
    var checks = [];

    function add(id, name, pass, detail) {
      checks.push({ id: id, name: name, pass: !!pass, detail: detail || '' });
    }

    // (a) 단거리방공무기의 탄도탄 교전 불가
    var shorads = KJ.NODES.filter(function (n) { return n.id.indexOf('SHORAD') === 0; });
    add('A', '신궁·천마(단거리방공) 탄도탄 교전 불가',
      shorads.length > 0 && shorads.every(function (n) {
        return n.canEngage.srbm === false && n.canEngage.mrl_large === false;
      }),
      'WPN-SHIN-CON-01: 대상 노드 ' + shorads.map(function (n) { return n.id; }).join(', '));

    // (b) THAAD 미모델링
    var thaadNode = KJ.NODES.some(function (n) {
      return /thaad|사드/i.test(n.id + n.name);
    });
    var thaadLink = KJ.LINKS.some(function (l) {
      return /thaad/i.test(l.from + l.to);
    });
    add('B', 'KAMDOC↔THAAD 연동 미모델링', !thaadNode && !thaadLink,
      'THAAD 노드·링크가 데이터에 존재하지 않아야 함');

    // (c) 디스클레이머 상시 표출
    var el = document.getElementById('disclaimer');
    add('C', '디스클레이머 상시 표출',
      el && el.textContent.indexOf('정책연구용') !== -1 &&
      window.getComputedStyle(el).display !== 'none',
      '"정책연구용 개념값 · 실제 작전자료 아님" 배너');

    // (d) 도시 수준 개념좌표
    add('D', '모든 좌표에 개념좌표 주석(coordNote) 존재',
      KJ.NODES.every(function (n) {
        return Array.isArray(n.coord) && typeof n.coordNote === 'string' &&
          n.coordNote.indexOf('개념') !== -1;
      }),
      '노드 ' + KJ.NODES.length + '개 전수 검사');

    // (e) KF-21 표기
    var ftr = KJ.nodeById('FTR');
    add('E', 'KF-21 국산 보라매 표기 (F-21 인도수출형 아님)',
      ftr && ftr.role.indexOf('보라매') !== -1 && ftr.name.indexOf('F-21,') === -1,
      'FTR 노드 표기 검사');

    return checks;
  };
})();
