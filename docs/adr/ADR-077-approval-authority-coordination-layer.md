# ADR-077 — To-Be 교전승인권을 합동방공C2 조율층으로 옮긴다

- 상태: 채택
- 일자: 2026-08-01
- 관련: ADR-036(USFK 계선 제외) · ADR-058(승인 계선 coord 링크) · ADR-062(0과 미측정의 구분) · ADR-076(직전 재기준선)

## 배경

To-Be 아키텍처의 요체는 기존 C2 체계(MCRC · KAMD 작전실 · 군단 AOC) **위에 합동방공C2 조율층(IAOC)이 얹힌 것**이다. 그런데 To-Be 실행에서 교전승인은 여전히 MCRC로 갔다. 조율층을 신설해 놓고 승인만 옛 계선으로 붙인 셈이라, 모델이 표현한다고 주장하는 구조와 어긋났다.

발견 경로는 UI다. [분석] 탭 항적 로그의 To-Be 열에 `감독하 자동교전 승인 (C2_MCRC_MCRC)`이 찍혀 있었다.

원인은 코드가 아니라 데이터였다. `js/data/threats.js`가 ABT 3종의 승인권자를 이렇게 적고 있었다:

```js
ac_low · heli · fighter : approvalLevel: { asis: 'KAOC', tobe: 'MCRC' }
                          automation:    { asis: 'human-in-loop', tobe: 'human-on-loop' }
```

`js/model/iads/c2-policy.js`의 `approvalAuthority`는 이 값을 그대로 돌려줄 뿐 To-Be 오버라이드가 없다. 즉 잘못된 것은 정책 로직이 아니라 정책 **데이터**였다.

## 결정

ABT 3종(ac_low · heli · fighter)의 `approvalLevel.tobe`를 `'MCRC'` → `'IAOC'`로 바꾼다. `asis`는 손대지 않는다.

이를 위해 `js/config/deployment-adapter.js`의 `catalog.roles`에 `IAOC` 키를 추가했다. 이미 있던 `fusionC2`와 **같은 노드를 가리키는 별칭**이다 — 새 노드를 만들지 않았다. `KAOC`와 `MCRC`가 이미 같은 노드를 두 이름으로 가리키고 있으므로 기존 방식과 일관된다. 데이터 파일이 내부 배선 이름(`fusionC2`) 대신 편제 이름으로 승인권자를 적을 수 있게 하려는 것이다.

엔진의 카탈로그 부재 폴백(`sim-engine.js`의 `roles: {...}`)에도 같은 대응을 넣었다.

## 왜 `'IAOC'`를 그냥 적으면 안 됐나 — 조용히 승인이 사라지는 함정

`KJ.resolveRoleId`(deployment-adapter.js)는 **등록되지 않은 키를 그대로 반환한다**:

```js
return catalog.roles && hasOwnProperty(catalog.roles, id) ? catalog.roles[id] : id;
```

반환된 `'IAOC'`는 nodeId가 아니다. 그러면 엔진이

```js
if (policy.auto === 'auto-preauth' || !approvalId || approvalId === commander.id
    || !this.nodeState[approvalId]) {
  threat._iadsApproval[key] = 'granted';   // 홉 없이 즉시 승인
```

의 `!this.nodeState['IAOC']`에 걸려 **"승인권자 부재 → 승인 불필요"로 처리한다**. 승인 홉이 통째로 사라지는데 실행은 성공하고 결과는 빨라진다. 즉 **오타 하나가 "To-Be가 개선됐다"로 위장된다**. ADR-062가 경계하는 "0과 미측정의 혼동"과 정확히 같은 함정이다.

측정해 보니 등록된 역할은 `fusionC2` · `KAMDOC` · `MCRC` · `KAOC` 넷뿐이었고, `IAOC`와 `EOC`는 미등록이었다. 그래서 별칭을 먼저 등록하고 데이터를 바꿨다.

`tests/approval-authority.test.mjs`가 이 함정을 잠근다 — threats.js가 쓰는 모든 역할 이름이 (a) 카탈로그 노드로, (b) **해당 모드 편성에 존재하는** 노드로, (c) 큐를 가진 C2 노드로 해소되는지 전수 검사하고, 미등록 키가 입력을 그대로 돌려준다는 사실 자체도 어서션으로 명문화한다.

## 무엇이 실제로 달라졌나

To-Be ABT의 `automation`은 `human-on-loop`이다. 이 분기는 **coord 협조 홉을 생략하고 승인권자 큐 서비스만** 태운다(`sim-engine.js` `_iadsApprovalGate`). 따라서 이번 변경으로 붙는 것은 링크 지연이 아니라 **IAOC의 대기·서비스 시간**이다. coord 링크 유무는 이 경로에 영향이 없다.

또 `approvalId === commander.id` 가드 때문에 **IAOC 자신이 결심자인 축(KILL_WEB global)은 자기승인**이 되어 홉이 없다. 남는 승인 홉은 **군단 AOC(ARMY_LOCAL_AD) → 합동방공C2** 축뿐이다. ADR-058이 "승인 홉이 실제로 발생하는 곳은 LOCAL_AD 축 하나"라고 한 구조가 To-Be에서도 그대로 유지되며, 교리적으로도 군단 AOC가 조율층에 승인을 요청하는 그림이 맞다.

실측 (SC3 · ×1.5 · seed 12345 · 600초 · HANBANDO_LEGACY_NORMAL · iads-c2):

| 마크 | As-Is (전=후) | To-Be 전 | To-Be 후 |
|---|---|---|---|
| 협조개시 (human-in-loop) | 60 → `C2_MCRC_MCRC` | 0 | 0 |
| 감독승인개시 (human-on-loop) | 0 | 21 → `C2_MCRC_MCRC` | **21 → `C2_IAOC_IAOC`** |
| 승인완료 | 44 | 17 | 21 |
| 자체교전승인 | 57 | 164 | 173 |
| 권한위임 | 0 | 0 | 0 |

## 결과 — 기준선 이동

여덟 번째 재기준선이다(ADR-061 이관 → 065 → 066 → 067 → 068 → 072 → 076 → 077).

| 케이스 | 지문 | 격추 | 누수 |
|---|---|---|---|
| sc1\|asis | **불변** | 22 | 2 |
| sc1\|tobe | 변경 | 21 → **23** | 1 |
| sc2\|asis | **불변** | 13 | 0 |
| sc2\|tobe | **불변** | 13 | 0 |
| sc3\|asis | **불변** | 64 | 108 |
| sc3\|tobe | 변경 | 113 → **117** | 58 → **54** |

**As-Is 3케이스가 bit-exact 불변인 것이 변경 범위의 하드 체크다.** `approvalLevel.asis`를 손대지 않았으므로 그래야 하고, 실제로 그렇다. `decision-audit`·`shadow-eval`·`engagement-state-unification`의 As-Is 지문도 전부 글자 그대로 종전 값이다. SC2 To-Be가 불변인 것은 그 시나리오에 해당 승인 홉이 없기 때문이다.

`native-wta`의 반증 셀(FULL·SC3·×1.0·seed 777)은 이동 없이 유지됐다.

## ⚠️ 이득의 출처 — 인용할 때 반드시 함께 밝힐 것

개선의 대부분은 조율층의 **위상**이 아니라 승인권자 노드의 **서비스시간 파라미터**에서 나온다:

| 노드 | 처리시간 | 서버 |
|---|---|---|
| MCRC | 37.5초/건 | 8 |
| IAOC | 2.5초/건 | 20 |

승인 1건이 **15배** 빨라진다. SC3 To-Be에서 IAOC의 승인 부하는 ρ=0.003, Wq=0, 드롭 0 — 큐가 사실상 비어 있다. 관측된 결과로, 종전에 `감독승인개시` 21건 중 `승인완료`가 17건이던 것이 21건 전부로 바뀌었다(4건 회복). 그 4건이 종전에 왜 완결되지 않았는지는 분해하지 않았다 — 큐 드롭과 "승인 도착 전 위협 소멸" 두 경로가 모두 가능하고, 어느 쪽이든 원인은 승인권자가 제때 처리하지 못한 것이다.

이 파라미터 차이는 자의적인 것이 아니라 "조율층은 자동화된 융합·조율 노드"라는 모델 전제의 표현이다. 그러나 **결과 수치를 인용할 때 "조율층을 거치게 했더니 좋아졌다"로만 말하면 과장이다.** 정확한 문장은 "승인을 37.5초 노드에서 2.5초 노드로 옮긴 결과"이며, 그 파라미터 자체가 별도의 검증 대상이다. `approval-authority.test.mjs` #4가 이 두 값을 어서션으로 고정해, 값이 바뀌면 이 ADR의 결론 문장도 함께 갱신하도록 강제한다.

방향성에 대해서도 명시한다: 이번 수정은 **또다시 To-Be에 유리한 방향**으로 움직였다(직전 ADR-076은 반대 방향이었다). 채택 기준은 결과를 보기 전에 정해졌다 — "모델이 표현한다고 주장하는 아키텍처와 실행 경로가 일치하는가". 그 기준은 방향맹(direction-blind)이며, 어긋난 것을 맞춘 결과가 어느 쪽으로 갔든 되돌리지 않는다.

## 남은 문제 — To-Be의 MCRC가 완전히 놀고 있다

이번 변경으로 To-Be에서 MCRC의 도착 건수가 **0**이 됐다(변경 전에는 승인 21건이 유일한 부하였다). 즉 이 모델의 To-Be에서 MCRC는 아무 일도 하지 않는다. 주어진 To-Be 아키텍처에서 MCRC는 조율층 아래에 **여전히 존재하는** 체계이므로, 이는 모델이 그 체계의 잔여 역할을 표현하지 못한다는 뜻이다.

이번 ADR의 범위를 넘으므로 고치지 않았다. 별도 과제로 남긴다 — To-Be에서 MCRC가 담당할 잔여 임무(예: 특정 축선 항적 관리, 조율층 우회 시 대체 계선)를 정의하고 부하를 부여할지, 아니면 "To-Be에서 MCRC는 방공 교전 계선에서 빠진다"를 명시적 모델 전제로 문서화할지 결정이 필요하다.

## 변경 파일

- `js/data/threats.js` — ABT 3종 `approvalLevel.tobe` `'MCRC'` → `'IAOC'`, 헤더 주석에 역할 이름 함정 경고
- `js/config/deployment-adapter.js` — `catalog.roles.IAOC` 별칭 추가 + 함정 경고 주석
- `js/engine/sim-engine.js` — 카탈로그 부재 폴백 `roles`에 IAOC 추가
- `tests/approval-authority.test.mjs` — 신설 (역할 해소 전수 검사 · 조율층 경유 실행 검증 · As-Is 불변 · 서비스시간 고정)
- `tests/hires-baseline.json` · `tests/decision-audit.test.mjs` · `tests/shadow-eval.test.mjs` · `tests/engagement-state-unification.test.mjs` — To-Be 지문 재고정
- `tests/run-all.js` — 신규 스위트 등록. 겸사겸사 `decision-audit`이 라벨만 다르게 **두 번 등록**돼 있던 것을 한 줄로 합쳤다(같은 파일을 두 번 돌리고 있었다)
