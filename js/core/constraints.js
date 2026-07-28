/**
 * K-JAMDS 시뮬레이터 — 제약조건 어서션 (ADR-061: 고해상도 카탈로그 정본)
 *
 * 연구 제약사항을 데이터가 위반하지 않는지 상시 검증한다 (회귀 스위트의 기초).
 *  (A) 신궁·천마(단거리방공무기)는 탄도탄 교전 불가 — SHOOTER_TYPES.iadsEngageableThreats 정본
 *  (B) LEGACY 배치 THAAD 부재 + FULL USFK 독립축/KAMDOC 미연동
 *  (C) 디스클레이머 상시 표출
 *  (D) 전 배치 카탈로그 좌표는 도시 수준 개념좌표 (coordNote 필수)
 *  (E) 전투기·이지스·조기경보기 미포함 — 지상배치 방공 C2 한정 (ADR-060)
 *
 * ADR-061 이력: 종전 (A)(B)(D)는 legacy KJ.NODES/KJ.LINKS를 검사했다. legacy 배치 폐기로
 * 검사 대상을 고해상도 배치 카탈로그 6종 전수로 이관했다. 종전 (E) "KF-21 보라매 표기"는
 * legacy FTR 노드 폐기로 대상 자체가 소멸 — 같은 자리의 제약을 "전투기류 미포함 범위
 * 선언(ADR-060)"으로 승계한다(오표기 방지 → 미포함 보장으로 강화).
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  KJ.runConstraintChecks = function () {
    var checks = [];

    function add(id, name, pass, detail) {
      checks.push({ id: id, name: name, pass: !!pass, detail: detail || '' });
    }

    var ids = KJ.DEPLOYMENT_IDS || [];
    var catalogs = ids.map(function (id) { return KJ.buildDeploymentCatalog(id); });

    // (A) 단거리방공무기의 탄도탄 교전 불가 — 정본 교전가능성 표(iadsEngageableThreats) 기준
    var shoradTypes = ['BIHO', 'CHUNMA'];
    add('A', '신궁·천마(단거리방공) 탄도탄 교전 불가',
      shoradTypes.every(function (tid) {
        var allowed = ((KJ.SHOOTER_TYPES || {})[tid] || {}).iadsEngageableThreats || [];
        return allowed.length > 0 && allowed.indexOf('srbm') === -1 && allowed.indexOf('mrl_large') === -1;
      }),
      'WPN-SHIN-CON-01: SHOOTER_TYPES ' + shoradTypes.join('·') + '의 iadsEngageableThreats에 srbm·mrl_large 부재');

    // (B) LEGACY 배치에는 THAAD가 없고, FULL에서는 USFK 독립축으로만 존재
    var legacyNoThaad = catalogs.filter(function (c) { return c.id.indexOf('LEGACY') !== -1; })
      .every(function (c) {
        return !c.nodes.some(function (n) { return /thaad|사드/i.test(n.id + (n.name || '')); });
      });
    // 독립축의 정의: USFK 자산은 (1) 한국군 노드와 C2 링크로 이어지지 않고
    // (2) USFK_ 축에만 소속되어 한국군 WTA 후보군에 오르지 않는다.
    // USFK 사수 자체는 자기 축에서 실제 교전을 수행하므로 canEngage는 참이어야 한다
    // (tests/deployment-adapter.test.mjs의 어서션과 동일 정의).
    var fullIndependent = true;
    if (KJ.buildDeploymentCatalog) {
      var full = KJ.buildDeploymentCatalog('HANBANDO_FULL_NORMAL');
      var usfk = full.nodes.filter(function (n) { return n.forceOwner === 'USFK'; });
      fullIndependent = usfk.some(function (n) { return n.typeId === 'THAAD'; }) &&
        full.links.every(function (l) {
          return (full.nodeMap[l.from].forceOwner === 'USFK') === (full.nodeMap[l.to].forceOwner === 'USFK');
        }) && usfk.filter(function (n) { return n.category === 'shooter'; }).every(function (n) {
          return String(n.c2Axis).indexOf('USFK_') === 0 &&
            Object.keys(n.canEngage).some(function (k) { return n.canEngage[k] === true; });
        });
    }
    add('B', 'LEGACY 배치 THAAD 부재·FULL USFK 독립축', legacyNoThaad && fullIndependent,
      'LEGACY 3종에는 THAAD가 없고, FULL의 THAAD/Patriot은 KAMDOC 교차 링크 없이 USFK_ 축에서만 교전 — 한국군 WTA 후보 아님');

    // (C) 디스클레이머 상시 표출
    var el = document.getElementById('disclaimer');
    add('C', '디스클레이머 상시 표출',
      el && el.textContent.indexOf('정책연구용') !== -1 &&
      window.getComputedStyle(el).display !== 'none',
      '"정책연구용 개념값 · 실제 작전자료 아님" 배너');

    // (D) 도시 수준 개념좌표 — 배치 카탈로그 6종 전수
    var nodeCount = 0;
    var coordOk = catalogs.every(function (c) {
      return c.nodes.every(function (n) {
        nodeCount++;
        return Array.isArray(n.coord) && typeof n.coordNote === 'string' &&
          n.coordNote.indexOf('개념') !== -1;
      });
    });
    add('D', '모든 좌표에 개념좌표 주석(coordNote) 존재', coordOk,
      '배치 ' + ids.length + '종 · 노드 ' + nodeCount + '개 전수 검사');

    // (E) 지상배치 방공 C2 한정 — 전투기·이지스·조기경보기 미포함 (ADR-060)
    var scopeOk = catalogs.every(function (c) {
      return !c.nodes.some(function (n) {
        return /KF-21|FTR|이지스|SM-2|E-737|조기경보/i.test(n.id + (n.name || ''));
      });
    });
    add('E', '전투기·이지스·조기경보기 미포함 (지상배치 방공 C2 한정, ADR-060)', scopeOk,
      '배치 ' + ids.length + '종 전수 — 요격기·해상 자산 대응 타입 부재');

    return checks;
  };
})();
