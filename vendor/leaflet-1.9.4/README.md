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
| `leaflet.css` | `5f236f11b6ca29a549c06be1c1c786ec53523fb39a1bae2f2ba61f6fef889edb` | `p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` | 불일치(공백 추정) |

두 파일은 기존 단일본 HTML에 이미 인라인돼 있던 블록에서 추출했다(이 컨테이너는
외부망이 막혀 있어 원본을 다시 내려받을 수 없다). `leaflet.js`는 업스트림 SRI와
**바이트 단위로 일치**함을 확인했다(위 sha256을 base64로 인코딩하면 SRI 값과 같다).

`leaflet.css`는 일치하지 않는다. 내용 자체는 정상적인 Leaflet 1.9.4 스타일시트로
보인다 — 663줄, `/* required styles */`로 시작해 print 미디어 블록으로 끝나며,
CRLF도 커스텀 규칙도 섞여 있지 않다. 후행 개행만 조정해서는 SRI가 맞지 않으므로
파일 중간 어딘가의 공백 차이로 추정하지만, **원본을 받아 대조하기 전까지는 추정일
뿐**이다. 외부망이 있는 환경에서 확인할 수 있도록 차이 자체를 여기 남겨 둔다.
스타일시트가 어긋나면 지도 레이아웃이 곧바로 깨지는데 렌더는 정상이므로,
기능상 문제는 관측되지 않았다.

로컬 파일이므로 SRI는 더 이상 의미가 없다(같은 출처에서 읽는다). 무결성은
저장소가 보장하며, `tests/vendor-leaflet.test.js`가 위 sha256과 필수 심볼 존재를
회귀로 고정한다.

## 이미지 자산을 두지 않는 이유

`leaflet.css`는 `images/marker-icon.png`·`images/layers.png`·`images/layers-2x.png`를
참조하지만, 이 앱은 기본 마커 아이콘도 레이어 컨트롤도 쓰지 않는다
(`map-view.js`는 `L.divIcon`만 사용). 해당 규칙에 걸리는 요소가 생기지 않으므로
브라우저가 이 이미지를 요청하지 않는다 — 요청이 0건임을 회귀 테스트로 확인한다.
