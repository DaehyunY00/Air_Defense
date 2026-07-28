/**
 * ADR-061: legacy 64노드 개념 배치는 폐기되었다. 좌표·pk·wtaSuit·L16/KVMF 데이터는
 * git 이력(커밋 d6cda7e 이전)에 보존된다. 이 스텁은 로더 호환용이다.
 * L16 12초는 갱신주기를 지연으로 오적용한 값, KVMF 30초는 폐기 파라미터에서 값만 승계한
 * 등급 C였다 — IADS_codex는 Link-K를 "Link-16급 가정, 1초 보수"로 판정했다(ADR-061).
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};
  KJ.NODES = Object.freeze([]);
})();
