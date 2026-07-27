# ADR-054 — legacy 자산 배치의 고해상도 이식(LEGACY_HIRES) — `iads-c2`를 legacy 편성에 적용

## 맥락

`modelFidelity='iads-c2'`(SNR/RCS 센서 물리·PSSEK·PIP 운동학·명령 수명주기)는 고해상도 배치
(MINI/FULL)에서만 동작한다. 엔진이 조합을 명시적으로 막는다.

```js
if (this.modelFidelity === 'iads-c2' && !this.highResolutionDeployment) {
  throw new Error('modelFidelity=iads-c2 requires a high-resolution deployment');
}
```

그런데 두 플래그가 켜는 대상이 다르다.

```js
this.nativeIads        = this.highResolutionDeployment;    // 책임 C2 해소·PIP 교전·발사대 탄약
this.iadsSensorPhysics = this.modelFidelity === 'iads-c2'; // 센서 물리·PSSEK
```

즉 가드는 "물리 센서만 켜지고 그 뒤를 받을 native 파이프라인이 없는" 반쪽 상태를 막는 안전장치다.

**요구**: legacy 배치의 자산 위치·편성은 그대로 두되, 교전·센서 물리는 고해상도 모델을 쓰고 싶다.

**진짜 장벽은 가드가 아니라 데이터였다.** legacy 노드에는 물리 계산에 필요한 타입 메타데이터가
전혀 없다 — 센서 `typeId` 0/20, 사수 `typeId` 0/18, `engage.missiles` 0/18, `mfrSensorId` 0/18,
`forceOwner` 0/18. 물리 계층은 전부 타입 스펙(`system-types.js`)에서 값을 읽는다.

이 실패는 **조용하다**. `resolveSensorRanges(undefined)`가 `null`을 반환하고
`computeScanPFinal`이 `null`로 게이트되므로, 예외 없이 **전 위협이 미탐지로 누수**한다.

## 선택지

- **A. 가드를 완화하고 legacy 9단계에 물리 센서만 얹는다.** 엔진 2곳(가드,
  `_onIadsSensorScan`의 라우팅 분기) + 센서 타입 매핑. legacy 고유 관측(중복교전·승인 병목)을
  유지한 채 탐지만 정밀해진다. 다만 PSSEK·PIP·발사대·명령 수명주기는 못 쓴다.
- **B. legacy 자산 배치를 고해상도 배치로 재정의한다.** `deployments.js`에 legacy 좌표를 쓰는
  배치를 추가하면 **엔진 수정 0줄**로 `iads-c2`가 그대로 돈다. 어댑터가 ECS 파생·링크 생성·
  M/M/c/K 환산을 자동 처리한다.
- **C. legacy 노드에 타입 메타데이터를 직접 부여한다.** `nodes.js`를 확장해 legacy 노드가
  두 경로를 겸하게 한다.

## 결정

**B — `HANBANDO_LEGACY_{NORMAL, MCRC_DOWN, KAMDOC_DOWN}` 배치 신설.**

C는 `nodes.js`가 Phase 0 결과 지문(SHA-256)에 고정되어 있어 회귀 위험이 크고, legacy 노드가
두 모델의 필드를 동시에 지니게 되어 의미론이 흐려진다. A는 얻는 것이 탐지 계층뿐이라
"legacy 편성으로 고해상도 교전을 본다"는 요구를 충족하지 못한다.

B는 기존 코드를 전혀 건드리지 않으므로 **legacy(compat) 경로와 기존 6개 배치가 bit 단위로
불변**이다. 새 배치는 순수 추가다.

## 구성

노드 64개(C2 30 · 센서 19 · 사수 15). 좌표는 전부 legacy `nodes.js`의 개념좌표를 lon/lat로 옮겼다.

| legacy 자산 | IADS 타입 | 비고 |
|---|---|---|
| BAT-CHUNMA-*(5) | `CHUNMA` | 전속 MFR **없음**(아래 §함정 참조) |
| BAT-CHEONGUNG2-*(5) | `CHEONGUNG2` | `MSAM_MFR` |
| SHORAD-1C / SHORAD-CD | `BIHO` | `LOCAL_AD` 축(군단·수방사 AOC 통제) |
| MSAM-1C | `CHEONGUNG2` | `LOCAL_AD` 축 — legacy MSAM-1C는 `canEngage`에서 탄도탄·무인기가 빠진 **ABT 전용**이고, 엔진의 `LOCAL_AD` 축도 ABT만 교전하므로 두 제약이 일치한다 |
| MDU-M / MDU-L | `PAC3` / `LSAM` | `PATRIOT_RADAR` / `LSAM_MFR`, 미사일방어부대 계선(`ICC_MDU`) |
| ACR-E/W | `FPS117` | 감시 사거리가 250km→470km로 바뀐다(타입 스펙 채택) |
| LAR-C, LLR-1C/CD | `TPS880K` | LLR은 `localAdPosKey`로 군단·수방사에 귀속 |
| GPR | `GREEN_PINE_B` | |
| 천마 세트 MFR(5) | `TPS880K` | **감시 전용** — 포대 FC와 미연결 |

C2는 KAMD_OPS·MCRC·ICC 11(10세트 + 미사일방어부대)·ARMY_LOCAL_AD 2(1군단·수방사)·
포대별 ECS 15·IAOC/EOC로 구성한다. legacy의 KAOC는 어댑터 `roles`가 MCRC로 해소하므로 두지 않는다.

### 의도적 제외

타입 레지스트리에 대응 자산군이 없어 제외했다.

| 자산 | 사유 |
|---|---|
| FTR(전투기) | 이동 플랫폼. native 교전 모델은 고정 발사대·포락선·재장전을 전제한다 |
| SM2-E/W(이지스) | 함상 이동 플랫폼 |
| E737(조기경보기) | 공중 플랫폼 — 고도가 시간의 함수 |
| AEGIS-E/W | 함상 레이더 |
| ADC2A-W | 육안·광학 관측 — 레이더 방정식(SNR ∝ R⁻⁴·RCS)이 성립하지 않는다 |

**따라서 LEGACY_HIRES와 legacy(compat)의 절대값을 직접 비교해서는 안 된다.** 두 배치는 전력
구성이 다르다. 비교 대상은 어디까지나 **같은 배치 안의 As-Is ↔ To-Be**다.

## 함정 — 천마 포대에 MFR을 물리면 영구 미발사가 된다

`TPS880K`는 `ranges.fireControl`이 없어 `hasFireControlCapability`가 false다. 이 센서를
포대의 `mfrSensorId`로 물리면 항적이 `FIRE_CONTROL` 상태에 영영 도달하지 못하고,
`_iadsFireControlState`의 `ready`가 계속 false여서 **그 포대는 한 발도 쏘지 않는다**.

FULL 배치의 SHORAD가 `mfrSensorTypeId: null`인 것도 같은 이유다(`!shooter.mfrSensorId`이면
`ready: true`로 우회). 천마 세트도 같은 패턴을 따르고, legacy MFR-W1 등은 **독립 감시 센서**로만
배치해 탐지에 기여하게 했다. 회귀로 고정한다.

## 검증

`tests/legacy-hires-deployment.test.mjs`(어서션 26건).

- **물리 계층이 실제로 동작**: SC3 ×1.0 seed 12345 As-Is에서 센서 스캔이 수행되고 게이팅이
  발화하며, 이벤트 수가 compat 44,378 → iads-c2 286,561로 늘어난다. 두 충실도 모두 실제
  격추가 발생한다(전 위협 미탐지로 끝나지 않음 — 조용한 실패 방지).
- **충실도별 결과**: As-Is 격추율 compat 12.2% → iads-c2 32.1%, 누출률 72.9% → 55.7%.
  MINI/FULL과 같은 방향(정밀화 시 절대 성능 상승)이다.
- **노드 파괴 대체**: MCRC_DOWN에서 ABT 책임이 권역 ICC로, KAMDOC_DOWN에서 탄도 책임이
  권역 ICC로 전환된다.
- **To-Be 통합**: 한국군 책임 C2가 IAOC로 수렴하고 누출률이 As-Is보다 낮다.
- **기존 경로 불변**: legacy(compat) 실행이 고해상도 카탈로그를 타지 않고 kind 키가 종전
  3종 그대로이며, MINI 배치 구성이 불변이다. `baseline.test.js`의 SHA-256도 통과한다.

## 결론 영향

없음(순수 추가). 기존 6개 배치와 legacy(compat)의 수치는 바뀌지 않는다. 다만 **비교 축이
하나 늘어난다** — 종전에는 "legacy = compat 전용, 고해상도 = MINI/FULL"이라 배치 축과 충실도
축이 얽혀 있었는데, 이제 **같은 자산 편성에서 충실도만 바꾼 대조**가 가능하다.

## 되돌리는 법

`js/config/deployments.js`에서 `HANBANDO_LEGACY_*` 정의와 레지스트리 3줄을 제거하고
`tests/run-all.js`에서 스위트 항목을 뺀다. 다른 파일에는 의존이 없다.

## 한계

- ACR→FPS117처럼 **타입 스펙이 legacy 원값과 다른 항목**이 있다(250km → 470km). "자산 배치만
  legacy를 따르고 성능은 타입 레지스트리를 따른다"는 설계 의도대로이나, legacy의 센서 성능을
  그대로 재현하려면 별도 타입 정의가 필요하다.
- 미사일방어부대 계선(`ICC_MDU`)은 legacy에 없는 개념 노드다. legacy는 KAMDOC이 MDU를 직접
  통제하나 고해상도 명령경로가 ICC→ECS→포대를 전제해 계선 대표 노드를 두었다.
- 제외 자산군 5종은 여전히 미모델링이다. 특히 전투기·이지스는 이동 플랫폼 지원이 선행되어야 한다.
