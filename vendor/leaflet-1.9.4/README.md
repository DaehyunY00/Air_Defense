# Leaflet 1.9.4 (vendored)

지도 라이브러리 Leaflet 1.9.4를 저장소에 동봉한 사본이다.
`index.html`은 CDN(unpkg) 대신 이 파일을 읽고, `scripts/build-single.mjs`는
단일본 HTML을 만들 때 이 파일을 인라인한다.

- 출처: https://unpkg.com/leaflet@1.9.4/dist/{leaflet.js,leaflet.css}
- 라이선스: BSD-2-Clause. 저작권 표기는 `leaflet.js` 선두의 `/* @preserve */`
  주석에 그대로 보존돼 있다 — © 2010–2023 Vladimir Agafonkin, © 2010–2011 CloudMade.
  전문: https://github.com/Leaflet/Leaflet/blob/v1.9.4/LICENSE

## 왜 동봉하는가

CDN 의존은 두 가지를 막고 있었다.

1. **폐쇄망·오프라인에서 지도 재생 애니메이션이 아예 실행되지 않음.** `L`이
   없으면 `map-view.js`가 SVG 개념도 대체 경로로 넘어가고, `sim-view.js:230`이
   애니메이션을 건너뛴 채 결과 모달만 띄운다. 이 경로는 정상 설계지만, 그 결과
   **재생 로직 자체를 검증할 수 없었다**(2026-07-27 UI 검토에서 미검증으로 남은 항목).
2. 외부망이 있는 환경에서도 CDN 장애·차단에 화면 기능이 종속된다.

동봉 후에는 타일(OpenStreetMap)만 온라인이며, 타일이 없어도 Leaflet은 초기화되어
마커·범위 링·연결선·재생 애니메이션이 모두 동작한다(배경만 비어 보인다).

## 무결성

| 파일 | 로컬 sha256 | 업스트림 SRI(sha256, base64) | 업스트림과 |
|---|---|---|---|
| `leaflet.js` | `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a` | `20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=` | **바이트 일치** |
| `leaflet.css` | `5f236f11b6ca29a549c06be1c1c786ec53523fb39a1bae2f2ba61f6fef889edb` | `p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` | **불일치 — 원인 미규명**(아래) |

두 파일은 기존 단일본 HTML에 이미 인라인돼 있던 블록에서 추출했다(이 컨테이너는
외부망이 막혀 있어 원본을 다시 내려받을 수 없다). `leaflet.js`는 업스트림 SRI와
**바이트 단위로 일치**함을 확인했다(위 sha256을 base64로 인코딩하면 SRI 값과 같다).

`leaflet.css`는 일치하지 않는다. **원인은 아직 규명되지 않았다.**

### leaflet.css 불일치 — 조사 결과 (2026-07-27)

처음에는 "인라인 과정의 공백 차이"로 추정했으나 **그 추정은 반증됐다.** 아래는
외부망 없이 확인할 수 있는 범위를 모두 확인한 결과다.

**1. 공백 가설 — 반증됨.** 후행 개행 가감, CRLF 변환, 줄끝 공백 제거, BOM,
탭↔공백 치환, 연속 빈 줄 축약, 선행 개행 복원 등 15가지 변환 중 업스트림 SRI를
재현하는 것은 **하나도 없었다**. 단순 공백 차이가 아니다.

**2. 저장소 이력 — 최초 인라인 이후 무변경.** 단일본 HTML을 포함한 27개 커밋
전체에서 CSS 블록의 sha256이 `5f236f11…`로 동일하다(2026-07-11 최초 등장 이후
한 번도 수정된 적 없음). 즉 차이는 **최초 인라인 시점부터** 있었다.

**3. 내용 진위 — 정상적인 Leaflet 1.9.4 스타일시트로 판단.**
   - 구조: 중괄호·주석 균형 정상, 125개 규칙 / 133개 선택자, 절단 흔적 없음
   - 커버리지: `leaflet.js`가 조작하는 `leaflet-*` 클래스 40종이 모두 정의돼 있음
     (미정의 5종은 런타임 접두사 `leaflet-zoom-`·`leaflet-marker-` 등과
     스타일이 불필요한 `leaflet-drag-target`)
   - 표준 섹션 20종(popup·tooltip·control-zoom/layers/attribution/scale·touch·
     oldie·safari·crosshair·zoom-anim·fade-anim·print 미디어 등) 전부 존재
   - **정본 z-index 스택 10개 값이 정확히 일치**: pane 400 · tile 200 · overlay 400 ·
     shadow 500 · marker 600 · tooltip 650 · popup 700 · control 800 ·
     map-pane canvas 100 · map-pane svg 200. 이 값들은 CSS에만 존재하는 임의의
     상수이므로, 우연히 맞을 수 없다.
   - 순수 ASCII, HTML 엔티티 오염 없음, 자식 결합자(`.leaflet-pane > svg`) 정상
   - 런타임 계산값도 정본과 일치: `.leaflet-container` position relative /
     overflow hidden, 컨트롤 컨테이너 z 1000, 확대 버튼 30×30,
     attribution 배경 `rgba(255,255,255,.8)`

**4. 남은 가설(둘 다 미검증).** (a) 동봉본이 업스트림과 실제로 다른 바이트를
가진다, (b) `index.html`에 있던 CSS SRI 값 자체가 잘못 적혀 있었다(JS SRI는
맞았으므로 둘 중 하나만 틀렸다는 뜻이 된다). **원본을 받아 대조하기 전에는
어느 쪽인지 말할 수 없다.**

**5. 왜 여기서 끝났는가.** 이 컨테이너의 egress 허용목록에 `unpkg.com`도
`registry.npmjs.org`도 없다(둘 다 403 — "Host not in allowlist"). 디스크 전체를
뒤져도 독립적인 Leaflet 사본이 없다. 조직 정책 거부는 우회하지 않는다.

**6. 끝내는 방법.** 외부망이 있는 환경에서 아래를 실행하면 바이트 단위로 대조하고
첫 차이 지점·줄 단위 차이를 출력한다. 결과를 이 절에 기록하면 항목을 닫을 수 있다.

```bash
node scripts/verify-vendor-leaflet.mjs          # 요약
node scripts/verify-vendor-leaflet.mjs --diff   # 줄 단위 차이까지
```

**현재의 실무적 결론**: 로컬 파일로 전환했으므로 SRI는 더 이상 로딩 경로에
관여하지 않는다(같은 출처에서 읽는다). 무결성은 저장소와
`tests/vendor-leaflet.test.js`가 보장한다 — 위 sha256 고정, 업스트림 SRI 대조,
그리고 바이트 출처를 증명할 수 없는 CSS를 위해 **내용 기반 진위 검증**(정본 z-index
스택 8종·구조 균형·표준 섹션·클래스 커버리지)까지 회귀로 걸어 두었다. 스타일시트가
어긋나면 지도 레이아웃이 즉시 깨지는데 렌더·재생이 모두 정상이므로 기능상 문제는
관측되지 않았다. 다만 **"업스트림과 바이트 단위로 동일하다"고는 말할 수 없다** —
위 6번으로 확인하기 전까지는 미해결로 둔다.

## 이미지 자산을 두지 않는 이유

`leaflet.css`는 `images/marker-icon.png`·`images/layers.png`·`images/layers-2x.png`를
참조하지만, 이 앱은 기본 마커 아이콘도 레이어 컨트롤도 쓰지 않는다
(`map-view.js`는 `L.divIcon`만 사용). 해당 규칙에 걸리는 요소가 생기지 않으므로
브라우저가 이 이미지를 요청하지 않는다 — 요청이 0건임을 회귀 테스트로 확인한다.
