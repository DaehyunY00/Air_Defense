# 수정 후 검증 — 2026-09-16

기준 커밋: `12d14e0c251ca8f89750ba279e77eeec217062cd`  
작업 브랜치: `codex/c2-structural-integrity-20260916`

## 결과

- `tests/run-all.js`에 등록된 서로 다른 **52개 스위트 전부 통과**.
- 생산 JavaScript 41개 파일의 `node --check` 통과.
- 신규 결함 재현 검사 18개 통과: 상태·계통·명령 계보 14개, 실제 HTML 설정·집계 4개.
- 기존 `hires-baseline`의 고정 조건 SHA-256 6개 유지.
- 앱 및 지휘흐름 단일 HTML을 각각 빌더로 재생성. 지휘흐름 빌더의 바이트 재현 검사 통과.

전체 순차 실행은 장시간 통계 검사를 병렬 처리하기 위해 중단했다. 이후 같은 등록 목록을
최대 3개씩 실행하고, 보완한 검사만 다시 실행하여 52개 스위트의 성공 결과를 합산했다.
순차 실행기 자체가 끝까지 실행되었다는 의미는 아니다. 스위트별 결과와 배포 파일 SHA-256은
[post-fix-validation.json](post-fix-validation.json)에 기록했다. Node.js `v22.18.0` 사용.

재실행 명령:

```sh
node scripts/build-command-flow-single.mjs
node scripts/build-single.mjs
node tests/run-all.js
```

## 기존 검사 보완 근거

`engagement-state-unification`, `decision-audit`, `shadow-eval`, `native-wta`의 오래된
기대값 실패는 수정 전 엔진·스키마에서도 재현했다. 복원본의 두 Git blob ID가 기준 커밋과
정확히 일치하는 것을 확인했다. 새 관측값으로 과거 해시를 덮어쓰지 않고, 기능 토글·상태
소비·계측 비간섭·통제 입력의 계약을 검사하도록 바꿨다.

`approval-authority`의 서버 수는 이미 적용된 ADR-088에 맞췄다. 제대·엔진·Monte Carlo·전환점
검사의 특정 모드 우열이나 지배 원인 고정 조건은 관측 계정 및 통제 입력 검사로 대체했다.
양·음·0 효과와 전환점 부재도 정상적으로 검증한다. 모델 결과를 검사 기대값에 맞추기 위한
생산 모델 조정은 하지 않았다.

## 검증 범위

실제 엔진 경계와 HTML 안의 설정·표시 함수를 실행했다. 브라우저의 시각적·수동 상호작용
검증은 포함하지 않는다. 이번 결과는 소프트웨어 정합성 검증이며, 실제 지휘절차·권한·인간
판단시간의 타당성 검증이나 As-Is/To-Be 우열의 실증이 아니다. 변경 내용과 가정의 범위는
[ADR-100](../../adr/ADR-100-c2-state-and-observation-integrity.md)에 명시했다.

이 폴더의 기존 `README.md`와 원시 관측 파일은 **수정 전 검토 자료**로 보존한다.
