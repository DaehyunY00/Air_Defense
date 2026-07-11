/**
 * K-JAMDS 시뮬레이터 — C2 연결(링크) 데이터 정의 (Phase 1)
 *
 * 각 링크는 모드별(asis/tobe) 통신 특성을 가짐:
 *  - type : 'datalink'(통합 데이터링크) | 'kvmf'(육군 계열 데이터링크) | 'link16' | 'voice' | 'broadcast'
 *    ※ kvmf는 표시·집계 구분용 유형(육군 체계 간 데이터링크가 Link-16만 있는 것처럼
 *      보이지 않도록 지도·범례에서 별도 표기). 엔진 로직은 delaySec만 사용.
 *  - delaySec : 항적/명령 1건 전달 지연(초). 근거는 docs/params.md 파라미터 ID 참조.
 *  - 모드에 해당 키가 없으면 그 모드에서는 링크가 존재하지 않음 (As-Is 미연동 표현).
 *
 * kind:
 *  - report  : 센서/하급제대 → C2 항적보고
 *  - coord   : C2 ↔ C2 협조·교전협조/권한위임
 *  - command : C2 → 무기체계 교전명령
 *
 * As-Is 핵심 구조(2022.12.26 실증): 육군 ADC2A(군단 AOC·JAOC)와 공군 MCRC·KAMDOC이
 * 데이터링크 미연동 — 음성보고(≥180s, C2-VOICE-DLY-01)만 가능, SAWS는 일방향 경보방송.
 * To-Be: JAMDC2(Track Fusion) 경유 전 노드 데이터링크 연동.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  var DL_FAST = { type: 'datalink', delaySec: 2, paramRef: 'C2-VOICE-DLY-01' };
  var L16 = { type: 'link16', delaySec: 12, paramRef: 'C2-L16-UPD-01' };
  var VOICE = { type: 'voice', delaySec: 180, paramRef: 'C2-VOICE-DLY-01' };
  var KVMF = { type: 'kvmf', delaySec: 30, paramRef: 'C2-VOICE-DLY-01' };

  KJ.LINKS = [
    // ─── 센서 → C2 항적보고 (공군 계열: As-Is에서도 자동화) ───
    { from: 'ACR-E', to: 'MCRC', kind: 'report', comm: { asis: DL_FAST, tobe: DL_FAST } },
    { from: 'ACR-W', to: 'MCRC', kind: 'report', comm: { asis: DL_FAST, tobe: DL_FAST } },
    { from: 'LAR-C', to: 'MCRC', kind: 'report', comm: { asis: DL_FAST, tobe: DL_FAST } },
    { from: 'E737', to: 'MCRC', kind: 'report', comm: { asis: L16, tobe: L16 } },
    { from: 'E737', to: 'KAOC', kind: 'report', comm: { asis: L16, tobe: L16 } },
    { from: 'GPR', to: 'KAMDOC', kind: 'report', comm: { asis: DL_FAST, tobe: DL_FAST } },
    { from: 'AEGIS-E', to: 'KAMDOC', kind: 'report', comm: { asis: L16, tobe: L16 } },
    { from: 'AEGIS-W', to: 'KAMDOC', kind: 'report', comm: { asis: L16, tobe: L16 } },
    { from: 'AEGIS-E', to: 'MCRC', kind: 'report', comm: { asis: L16, tobe: L16 } },
    { from: 'AEGIS-W', to: 'MCRC', kind: 'report', comm: { asis: L16, tobe: L16 } },

    // ─── 센서 → C2 항적보고 (육군 계열: ADC2A/KVMF, 음성) ───
    { from: 'LLR-1C', to: 'AOC-1C', kind: 'report', comm: { asis: KVMF, tobe: DL_FAST } },
    { from: 'LLR-CD', to: 'JAOC-CD', kind: 'report', comm: { asis: KVMF, tobe: DL_FAST } },
    { from: 'ADC2A-W', to: 'AOC-1C', kind: 'report', comm: { asis: VOICE, tobe: KVMF } },

    // ─── C2 ↔ C2 협조 (As-Is 병목의 핵심: 육↔공 음성 협조) ───
    { from: 'AOC-1C', to: 'MCRC', kind: 'coord', comm: { asis: VOICE, tobe: DL_FAST },
      note: 'As-Is: 데이터링크 미연동, 음성/VTC 협조만 가능 (2022.12.26 실증 병목)' },
    { from: 'JAOC-CD', to: 'MCRC', kind: 'coord', comm: { asis: VOICE, tobe: DL_FAST },
      note: 'As-Is: 수방사↔공군 음성 협조' },
    { from: 'MCRC', to: 'AOC-1C', kind: 'broadcast', comm: { asis: { type: 'broadcast', delaySec: 60, paramRef: 'C2-SAWS-DLY-01' } },
      note: 'SAWS 위성전군방공경보(일방향 방송, 교전활용 불가)' },
    { from: 'MCRC', to: 'JAOC-CD', kind: 'broadcast', comm: { asis: { type: 'broadcast', delaySec: 60, paramRef: 'C2-SAWS-DLY-01' } },
      note: 'SAWS 위성전군방공경보(일방향 방송, 교전활용 불가)' },
    { from: 'MCRC', to: 'KAOC', kind: 'coord', comm: { asis: DL_FAST, tobe: DL_FAST } },
    { from: 'KAMDOC', to: 'KAOC', kind: 'coord', comm: { asis: DL_FAST, tobe: DL_FAST } },
    { from: 'MCRC', to: 'KAMDOC', kind: 'coord', comm: { asis: VOICE, tobe: DL_FAST },
      note: 'As-Is: 공중위협·탄도탄 이원화 체계 간 협조 지연' },

    // ─── To-Be: JAMDC2 (Track Fusion) 연동 — 전 센서·C2 융합 ───
    { from: 'MCRC', to: 'JAMDC2', kind: 'report', comm: { tobe: DL_FAST } },
    { from: 'KAMDOC', to: 'JAMDC2', kind: 'report', comm: { tobe: DL_FAST } },
    { from: 'AOC-1C', to: 'JAMDC2', kind: 'report', comm: { tobe: DL_FAST } },
    { from: 'JAOC-CD', to: 'JAMDC2', kind: 'report', comm: { tobe: DL_FAST } },
    { from: 'JAMDC2', to: 'MCRC', kind: 'coord', comm: { tobe: DL_FAST } },
    { from: 'JAMDC2', to: 'KAMDOC', kind: 'coord', comm: { tobe: DL_FAST } },
    { from: 'JAMDC2', to: 'AOC-1C', kind: 'coord', comm: { tobe: DL_FAST } },
    { from: 'JAMDC2', to: 'JAOC-CD', kind: 'coord', comm: { tobe: DL_FAST } },
    { from: 'JAMDC2', to: 'KAOC', kind: 'coord', comm: { tobe: DL_FAST } },

    // ─── C2 → 무기체계 교전명령 ───
    { from: 'MCRC', to: 'FTR', kind: 'command', comm: { asis: L16, tobe: L16 } },
    { from: 'MCRC', to: 'SM2-E', kind: 'command', comm: { asis: L16, tobe: L16 } },
    { from: 'MCRC', to: 'SM2-W', kind: 'command', comm: { asis: L16, tobe: L16 } },
    { from: 'KAMDOC', to: 'MDU-M', kind: 'command', comm: { asis: DL_FAST, tobe: DL_FAST } },
    { from: 'KAMDOC', to: 'MDU-L', kind: 'command', comm: { asis: DL_FAST, tobe: DL_FAST } },
    { from: 'AOC-1C', to: 'SHORAD-1C', kind: 'command', comm: { asis: KVMF, tobe: DL_FAST } },
    { from: 'AOC-1C', to: 'MSAM-1C', kind: 'command', comm: { asis: KVMF, tobe: DL_FAST } },
    { from: 'JAOC-CD', to: 'SHORAD-CD', kind: 'command', comm: { asis: KVMF, tobe: DL_FAST } }
  ];

  /** 해당 모드에서 활성인 링크만 반환 */
  KJ.linksInMode = function (mode) {
    return KJ.LINKS.filter(function (l) { return !!l.comm[mode]; });
  };
})();
