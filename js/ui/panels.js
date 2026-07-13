/**
 * K-JAMDS 시뮬레이터 — 탭 패널 렌더러 (Phase 1 → [분석] 탭 개편)
 * [분석] / [근거자료] 탭.
 *  - 9단계 파이프라인 병목·해결 지표: 동일 seed의 As-Is/To-Be 결정론 DES 1복제 비교
 *    (설정 키 캐시 — 슬라이더 드래그 시 동일 설정 중복 재계산 방지)
 *  - 정상상태 해석 상세(노드 ρ표·링크표·타임라인): 기존 KJ.analyzeScenario 유지
 * 병목·지표는 어디에도 하드코딩되지 않고 [시나리오 부하 × 토폴로지 × 용량] 관측에서 도출된다.
 */
(function () {
  'use strict';
  window.KJ = window.KJ || {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }

  var LEVEL_BADGE = {
    idle: '<span class="badge badge-idle">유휴</span>',
    normal: '<span class="badge badge-ok">정상</span>',
    warn: '<span class="badge badge-warn">주의 ρ≥0.7</span>',
    bottleneck: '<span class="badge badge-bad">병목 ρ≥0.9</span>',
    saturated: '<span class="badge badge-crit">포화 ρ≥1</span>'
  };
  var KIND_ICON = { node: '⬛', link: '🔗', gap: '⚠️' };

  // ══════════════ 9단계 파이프라인 병목·해결 지표 (분석 탭 상단) ══════════════
  // 각 단계가 "어떤 병목을 드러내고 어떤 지표·실패코드로 관측되는지"를
  // As-Is↔To-Be 결정론 DES 1복제(동일 seed)로 나란히 비교한다.

  // DES 양모드 캐시 (설정이 같으면 재계산하지 않음 — 탭 전환·재렌더 대비)
  var desCache = { key: null, data: null };
  function pipelineData(state) {
    var key = [state.sc, state.x, state.seed, state.dur].join('|');
    if (desCache.key === key) return desCache.data;
    var scn = KJ.scenarioById(state.sc);
    var cfg = { scenario: scn, intensity: state.x, seed: state.seed, endTimeSec: state.dur };
    var a = KJ.runDES(Object.assign({ mode: 'asis' }, cfg));
    var b = KJ.runDES(Object.assign({ mode: 'tobe' }, cfg));
    function heatSum(mode) {
      return KJ.computeOverlapHeat(scn, mode, state.x).axes
        .reduce(function (s, ax) { return s + ax.raw; }, 0);
    }
    desCache.key = key;
    desCache.data = { a: a, b: b, heatA: heatSum('asis'), heatB: heatSum('tobe') };
    return desCache.data;
  }

  /** 링크 전달 1건당 평균 통신지연(초) — sim-view의 MoP 지표와 동일 정의.
   * kind 지정 시 그 종류(report/coord/command)만 집계 → 각 단계가 자기 단계 링크만 측정.
   * kind 생략 시 전 링크(하위호환). */
  function commMeanDelay(res, kind) {
    var num = 0, den = 0;
    res.links.forEach(function (l) {
      if (kind && l.kind !== kind) return;
      num += l.delaySec * l.count; den += l.count;
    });
    return den ? num / den : 0;
  }
  /** 구조적 실패(공백·포화·지연) 합 — KJ.LEAK_TAXONOMY.structural 기준 */
  function structuralLeaks(g) {
    var n = 0;
    Object.keys(g.leakReasons).forEach(function (r) {
      if (KJ.leakTaxonomy(r).structural) n += g.leakReasons[r];
    });
    return n;
  }
  /** 카테고리별 최대 관측 ρ / 드롭 합 */
  function maxRho(res, cat) {
    var m = 0;
    res.nodes.forEach(function (n) { if (n.category === cat && n.rho > m) m = n.rho; });
    return m;
  }
  function dropSum(res, cat) {
    var s = 0;
    res.nodes.forEach(function (n) { if (n.category === cat) s += n.drops; });
    return s;
  }
  /** leakReasons를 단계 귀속용 코드로 정규화 (overflow는 노드 카테고리로 C2/교전 분리) */
  function codeCounts(res) {
    var out = {};
    Object.keys(res.global.leakReasons).forEach(function (k) {
      var n = res.global.leakReasons[k];
      if (k.indexOf('overflow:') === 0) {
        var nd = KJ.nodeById(k.slice(9));
        var bucket = nd && nd.category === 'shooter' ? 'overflow_shooter' : 'overflow_c2';
        out[bucket] = (out[bucket] || 0) + n;
      } else {
        out[k] = (out[k] || 0) + n;
      }
    });
    return out;
  }
  // 단계 귀속용 확장 코드(overflow 분리)의 라벨·구조성 — 기본 8종은 KJ.LEAK_TAXONOMY 참조
  var CODE_META = {
    overflow_c2: { label: '포화손실(C2 처리)', structural: true },
    overflow_shooter: { label: '포화손실(교전채널)', structural: true }
  };
  function codeMeta(code) { return CODE_META[code] || KJ.leakTaxonomy(code); }

  // MoM 계층 툴팁 (NATO COBP/SAS-026, ENV-MOM-COBP-01 — sim-view와 동일)
  var MOM_TIP = {
    MoP: 'Measure of Performance — 체계 내부 과정 성능 (NATO COBP/SAS-026)',
    MoCE: 'Measure of C2 Effectiveness — 지휘통제 효과성 (NATO COBP/SAS-026)',
    MoFE: 'Measure of Force Effectiveness — 전력 전체의 임무 효과 (NATO COBP/SAS-026)'
  };

  function fmtVal(v, kind) {
    if (v === null || v === undefined || (kind !== 'cnt' && !isFinite(v))) return '—';
    if (kind === 'rate') return (v * 100).toFixed(0) + '%';
    if (kind === 'sec') return v.toFixed(0) + '초';
    if (kind === 'raw') return v.toFixed(1);
    if (kind === 'raw2') return v.toFixed(2);
    if (kind === 'ratio') return v.toFixed(2) + '배';
    return v + '건';
  }
  function fmtDelta(d, kind) {
    var av = Math.abs(d);
    if (kind === 'rate') return (av * 100).toFixed(0) + '%p';
    if (kind === 'sec') return av.toFixed(0) + '초';
    if (kind === 'raw') return av.toFixed(1);
    if (kind === 'raw2') return av.toFixed(2);
    if (kind === 'ratio') return av.toFixed(2);
    return av + '건';
  }

  /** 지표 1행: [MoM][라벨][As-Is 값][좌막대][우막대][To-Be 값][Δ판정] */
  function metricRow(m) {
    var aN = (typeof m.a === 'number' && isFinite(m.a)) ? m.a : null;
    var bN = (typeof m.b === 'number' && isFinite(m.b)) ? m.b : null;
    var max = m.max || Math.max(aN || 0, bN || 0, 1e-9);
    var aw = aN === null ? 0 : Math.min(100, aN / max * 100);
    var bw = bN === null ? 0 : Math.min(100, bN / max * 100);
    var deltaLabel, dcls;
    if (aN === null || bN === null) {
      deltaLabel = '판정 불가'; dcls = 'vs-flat';
    } else if (m.lower === null) { // 방향성 판정 없는 참고 지표 (예: 분권 전환)
      var dd = bN - aN;
      deltaLabel = (dd === 0 ? '동일' : (dd > 0 ? '▲' : '▼') + ' ' + fmtDelta(dd, m.kind)) + ' (참고)';
      dcls = 'vs-flat';
    } else {
      var d = bN - aN;
      var improved = m.lower ? d < 0 : d > 0;
      var same = Math.abs(d) < (m.kind === 'cnt' ? 0.5 : 1e-9);
      var arrow = same ? '=' : (d > 0 ? '▲' : '▼');
      dcls = same ? 'vs-flat' : (improved ? 'vs-good' : 'vs-bad');
      deltaLabel = same ? '동일' : (arrow + ' ' + fmtDelta(d, m.kind) + (improved ? ' 개선' : ' 악화'));
    }
    return '<div class="pl-m" title="' + esc(m.tip || '') + '">' +
      '<span class="mom mom-' + m.mom.toLowerCase() + '" title="' + esc(MOM_TIP[m.mom]) + '">' + m.mom + '</span>' +
      '<span class="pl-m-label">' + esc(m.label) + '</span>' +
      '<span class="pl-m-val asis">' + fmtVal(m.a, m.kind) + '</span>' +
      '<div class="pl-m-track l"><div class="pl-m-fill asis" style="width:' + aw.toFixed(0) + '%"></div></div>' +
      '<div class="pl-m-track r"><div class="pl-m-fill tobe" style="width:' + bw.toFixed(0) + '%"></div></div>' +
      '<span class="pl-m-val tobe">' + fmtVal(m.b, m.kind) + '</span>' +
      '<span class="pl-m-delta ' + dcls + '">' + deltaLabel + '</span></div>';
  }

  /** 실패코드 칩: 라벨 + As-Is→To-Be 건수 + [구조] 뱃지 (0/0은 흐리게 — 매핑 자체를 보여줌) */
  function codeChip(code, ca, cb) {
    var meta = codeMeta(code);
    var a = ca[code] || 0, b = cb[code] || 0;
    var zero = a === 0 && b === 0;
    var trend = '';
    if (!zero && meta.structural) {
      trend = b < a ? ' pl-code-good' : (b > a ? ' pl-code-bad' : '');
    }
    return '<span class="pl-code' + (zero ? ' pl-code-zero' : '') + trend + '">' +
      '<code>' + esc(code.replace(/_((c2)|(shooter))$/, ':$1')) + '</code> ' + esc(meta.label) +
      ' <b class="asis">' + a + '</b>→<b class="tobe">' + b + '</b>' +
      (meta.structural ? ' <span class="badge badge-warn" title="C2 구조 개선(To-Be)으로 감소가 기대되는 원인">구조</span>' : '') +
      '</span>';
  }

  /** 단계 카드 1장 */
  function stageCard(s, ca, cb) {
    return '<div class="pl-stage' + (s.core ? ' pl-core' : '') + '">' +
      '<div class="pl-stage-head"><span class="pl-no">' + s.no + '</span> <b>' + esc(s.name) + '</b>' +
      ' <code class="pl-fn">' + esc(s.fn) + '</code>' +
      (s.core ? ' <span class="pl-star">★ 한국군 이원화 C2 핵심 병목</span>' : '') + '</div>' +
      '<div class="pl-desc">병목: ' + esc(s.bottleneck) +
      (s.fix ? ' <span class="pl-fix">해결(To-Be): ' + esc(s.fix) + '</span>' : '') + '</div>' +
      '<div class="pl-metrics">' + s.metrics.map(metricRow).join('') + '</div>' +
      (s.codes.length
        ? '<div class="pl-codes">실패코드: ' + s.codes.map(function (c) { return codeChip(c, ca, cb); }).join(' ') + '</div>'
        : '') +
      '</div>';
  }

  function renderPipeline(state) {
    var box = el('pipeline-stages');
    if (!box) return;
    var d = pipelineData(state);
    var a = d.a, b = d.b, ga = a.global, gb = b.global;
    var ca = codeCounts(a), cb = codeCounts(b);

    el('pipeline-context').textContent =
      KJ.scenarioById(state.sc).name + ' · 강도 ×' + Number(state.x).toFixed(1) +
      ' · seed ' + state.seed + ' · ' + state.dur + '초 — As-Is/To-Be 각 1복제 결정론 DES(동일 seed).' +
      ' seed·시간은 [시뮬레이션] 탭 입력값을 따릅니다.';

    var delegA = ga.delegation, delegB = gb.delegation;
    var stages = [
      {
        no: '①', name: '탐지 (Detect)', fn: '_beginDetect · _onDetect',
        bottleneck: '저고도·저RCS 탐지 실패, 센서 커버리지 공백 — 격추율 하락의 근원',
        fix: '다센서 병렬 결합(Any Sensor)으로 per-scan 획득확률·탐지 시점 향상 (항적 연속성은 미구현)',
        codes: ['not_detected', 'no_sensor'],
        metrics: [
          { label: '탐지율', mom: 'MoP', kind: 'rate', lower: false, max: 1,
            a: ga.spawned ? ga.detected / ga.spawned : null,
            b: gb.spawned ? gb.detected / gb.spawned : null,
            tip: 'per-scan 탐지확률 pᵢ = 센서Pd × 위협난이도(detectFactor) × 민감도배수. ' +
              'As-Is = maxᵢ(pᵢ)(비융합·최선 단일센서) / To-Be = 1−Πᵢ(1−pᵢ)(다센서 병렬 결합). ' +
              '체공 위협은 시행횟수 N=dwell/스캔이 커 누적 탐지"율"은 두 모드 모두 ~1.0으로 포화되므로, ' +
              '융합 효과는 율이 아니라 탐지 "시점" 단축으로 나타남(단일센서만 커버하는 위협은 개선 없음).' }
        ]
      },
      {
        no: '②', name: '추적생성 (Track) — 보고 링크', fn: '_onDetected',
        bottleneck: '항적 비융합(중복항적), 보고경로 부재',
        fix: 'JAMDC2 융합 허브로 단일 연속 항적 생성',
        codes: ['no_report_path'],
        metrics: [
          { label: 'report 링크 전달지연 (전달 1건 평균)', mom: 'MoP', kind: 'sec', lower: true,
            a: commMeanDelay(a, 'report'), b: commMeanDelay(b, 'report'),
            tip: '②단계 report(센서→담당 C2) 링크 전달의 평균 지연만 집계(coord·command 제외). ' +
              'As-Is에서도 이 경로는 대부분 데이터링크/KVMF라 음성 180s는 여기서 발화하지 않는다 — ' +
              '음성 협조 180s는 ⑥⑦(coord)단계의 지표다.' }
        ]
      },
      {
        no: '③④⑤', name: '식별·위협평가·WTA — C2 서버 처리',
        fn: '_onC2Arrive · _afterC2 · _doEngage (To-Be: _onFusionArrive)',
        bottleneck: 'C2 처리 포화(대기행렬), Best-Shooter 배정 실패',
        fix: 'JAMDC2 집중 처리·AI 식별로 서비스시간 단축(서버 풀링 효과)',
        codes: ['overflow_c2'],
        metrics: [
          { label: 'C2 최대 관측 ρ', mom: 'MoP', kind: 'raw2', lower: true, max: 1,
            a: maxRho(a, 'c2'), b: maxRho(b, 'c2'),
            tip: 'C2 노드 중 최대 이용률(busyTime/(c·T)). ρ≥0.7 주의 · ≥0.9 병목 · 드롭=포화 (ENV-RHO-THRESH-01).' },
          { label: 'C2 포화 드롭 합', mom: 'MoP', kind: 'cnt', lower: true,
            a: dropSum(a, 'c2'), b: dropSum(b, 'c2'),
            tip: 'M/M/c/K 대기실 용량(K) 초과로 상실된 항적 수 → overflow:<노드> 실패코드.' },
          { label: '도출 병목 수', mom: 'MoCE', kind: 'cnt', lower: true,
            a: a.bottlenecks.length, b: b.bottlenecks.length,
            tip: '관측 통계(ρ≥0.9·드롭·공백)에서 도출된 병목 수 — 하드코딩이 아니라 부하의 함수.' }
        ]
      },
      {
        no: '⑥⑦', name: '결심·교전협조/권한위임 — coord 홉',
        fn: '_decision · _onApproveArrive', core: true,
        bottleneck: '책임공백(협조경로 부재), 승인 지연, 중복교전 — 육↔공 음성 협조 ≥180s',
        fix: '사전승인 자동교전(automation 플래그)으로 결심·협조 홉 생략, 부하 임계 시 동적 분권 전환',
        codes: ['responsibility_gap'],
        metrics: [
          { label: '결심 지연 (탐지→교전개시)', mom: 'MoP', kind: 'sec', lower: true,
            a: ga.meanDecisionDelaySec, b: gb.meanDecisionDelaySec,
            tip: 'F2T2EA Find→Engage 평균 소요. 협조·승인·권한위임 홉과 C2 대기(Wq)가 모두 포함 — As-Is 음성 협조 부담이 여기서 발생.' },
          { label: 'coord 링크 전달지연 (전달 1건 평균)', mom: 'MoP', kind: 'sec', lower: true,
            a: commMeanDelay(a, 'coord'), b: commMeanDelay(b, 'coord'),
            tip: '⑥⑦단계 coord(교전협조) 링크 전달의 평균 지연만 집계 — As-Is 육↔공 음성 협조(≥180s)가 실제로 발화하는 곳.' },
          { label: '중복교전 위험 (축선 합)', mom: 'MoCE', kind: 'raw', lower: true,
            a: d.heatA, b: d.heatB,
            tip: '서로 다른 통제계통이 제때 협조 불가(협조지연 ≥ 0.5×체공창, ENV-OVERLAP-RISK-01)한 무기쌍 × 부하(λ)의 축선 합 — 이원화의 공간적 문제.' },
          { label: '분권 전환 (횟수)', mom: 'MoCE', kind: 'cnt', lower: null,
            a: delegA.count, b: delegB.count,
            tip: '승인권자 대기열 임계(C2-DELEG-THRESH-01) 초과 시 중앙↔분권 동적 전환 횟수' +
              (delegA.firstT !== null ? ' · As-Is 최초 전환 t=' + delegA.firstT.toFixed(0) + 's' : '') +
              (delegB.firstT !== null ? ' · To-Be 최초 전환 t=' + delegB.firstT.toFixed(0) + 's' : '') +
              '. 전환은 부하의 함수 — 저강도에서는 발생하지 않음(방향성 판정 없는 참고 지표).' }
        ]
      },
      {
        no: '⑧', name: '교전/요격명령 — 명령 링크 + 교전채널',
        fn: '_doEngage · _onShooterArrive',
        bottleneck: '교전수단 부재(제약: 신궁·천마↔탄도탄), 교전채널 포화',
        fix: '(제약은 C2 통합으로 해결 불가 — 무기체계 능력 문제로 분리)',
        codes: ['no_shooter', 'overflow_shooter'],
        metrics: [
          { label: '무기 최대 관측 ρ', mom: 'MoP', kind: 'raw2', lower: true, max: 1,
            a: maxRho(a, 'shooter'), b: maxRho(b, 'shooter'),
            tip: '교전 무기 노드 중 최대 채널 이용률.' },
          { label: 'command 링크 전달지연 (전달 1건 평균)', mom: 'MoP', kind: 'sec', lower: true,
            a: commMeanDelay(a, 'command'), b: commMeanDelay(b, 'command'),
            tip: '⑧단계 command(교전명령) 링크 전달의 평균 지연만 집계(C2→무기체계).' },
          { label: '교전채널 포화 드롭 합', mom: 'MoP', kind: 'cnt', lower: true,
            a: dropSum(a, 'shooter'), b: dropSum(b, 'shooter'),
            tip: '교전 대기실(K=채널×2) 초과로 상실된 교전 기회.' }
        ]
      },
      {
        no: '⑨', name: 'BDA → 재교전 (폐루프)', fn: '_onEngageEnd',
        bottleneck: '명중 실패(저Pk, 예: 무인기 0.1~0.5), 체공창 소진, 재교전 상한(3회)',
        fix: '재교전 폐루프는 dwell 창 내에서만 — 앞 단계 지연 단축이 곧 재교전 기회 확보',
        codes: ['missed', 'timeout'],
        metrics: [
          { label: '격추율', mom: 'MoFE', kind: 'rate', lower: false, max: 1,
            a: ga.killRate, b: gb.killRate, tip: '생성 위협 중 격추 비율 — 최종 요격 성과.' },
          { label: '평균 격추시간', mom: 'MoP', kind: 'sec', lower: true,
            a: ga.meanTimeToKillSec, b: gb.meanTimeToKillSec,
            tip: '격추 성공 항적의 생성→격추 평균 소요.' },
          { label: '비용교환비 (저가 포화위협)', mom: 'MoFE', kind: 'ratio', lower: true,
            a: ga.cost.exchangeSat, b: gb.cost.exchangeSat,
            tip: '무인기·장사정포 대응 소모 요격탄 비용 ÷ 격추 위협가치 (개념 단가, 한반도 보정 필요). >1이면 아군이 더 비싼 자원 소모. 주의: To-Be가 항상 개선되는 지표가 아님(docs/metrics-verification.md).' }
        ]
      },
      {
        no: '⑨+', name: '결과 종합 (전 단계의 귀결)', fn: '_results',
        bottleneck: '모든 단계 병목의 최종 귀결 — 누출률',
        fix: '구조적 원인([구조])은 To-Be에서 감소, 일부는 순수 명중 실패로 이동하는 것이 정상 경로',
        codes: [],
        metrics: [
          { label: '요격 실패율 (누출률)', mom: 'MoFE', kind: 'rate', lower: true, max: 1,
            a: ga.leakRate, b: gb.leakRate,
            tip: '생성 위협 중 격추하지 못하고 공역을 통과(누수)한 비율.' },
          { label: '구조적 실패 합 ([구조] 원인)', mom: 'MoCE', kind: 'cnt', lower: true,
            a: structuralLeaks(ga), b: structuralLeaks(gb),
            tip: '8종 원인 중 structural=true(탐지공백·비융합·책임공백·포화·지연) 합 — To-Be에서 감소해야 정상.' }
        ]
      }
    ];

    box.innerHTML =
      '<div class="pl-headrow"><span class="pl-side asis">◀ As-Is 분절형</span>' +
      '<span class="pl-side-mid">위협 도착 ↓</span>' +
      '<span class="pl-side tobe">To-Be 통합형 ▶</span></div>' +
      stages.map(function (s, i) {
        return stageCard(s, ca, cb) +
          (i < stages.length - 1 ? '<div class="pl-arrow">▼</div>' : '');
      }).join('') +
      '<div class="note">막대 길이 = 값의 상대 크기(비율·ρ는 0~100%/0~1, 나머지는 두 값 중 최대 기준). ' +
      '초록 판정 = To-Be 개선. MoM 계층: MoP 과정(성능) · MoCE C2 효과성 · MoFE 전력 효과성 — ' +
      'NATO COBP(SAS-026) 근거. 지표·코드 위에 마우스를 올리면 정의 툴팁이 표시됩니다. ' +
      '모든 값은 정책연구용 개념값 · As-Is↔To-Be 상대비교용입니다.</div>';

    renderTaxonomyTable(ca, cb);
  }

  /** 병목 taxonomy 8종 ↔ 발생 단계 요약표 (+ 이번 설정의 관측 건수) */
  function renderTaxonomyTable(ca, cb) {
    var body = el('taxonomy-body');
    if (!body) return;
    // 발생 단계(stage)는 엔진 정본 KJ.LEAK_TAXONOMY에서 읽는다 — 결과 모달 대조표와 동일 출처
    var rows = [
      { code: 'not_detected', fixer: '센서·융합' },
      { code: 'no_sensor', fixer: '센서 배치' },
      { code: 'no_report_path', fixer: 'To-Be 융합' },
      { code: 'responsibility_gap', fixer: 'To-Be 통합 C2', core: true },
      { code: 'overflow', fixer: '처리용량·자동화',
        count: function (c) { return (c.overflow_c2 || 0) + (c.overflow_shooter || 0); } },
      { code: 'no_shooter', fixer: '무기체계 능력' },
      { code: 'missed', fixer: '무기 Pk·재교전' },
      { code: 'timeout', fixer: '전 단계 지연' }
    ];
    body.innerHTML = rows.map(function (r, i) {
      var meta = KJ.leakTaxonomy(r.code);
      r.stage = meta.stage;
      var a = r.count ? r.count(ca) : (ca[r.code] || 0);
      var b = r.count ? r.count(cb) : (cb[r.code] || 0);
      var d = b - a;
      var dcls = (a === 0 && b === 0) ? 'vs-flat'
        : (meta.structural ? (d < 0 ? 'vs-good' : (d > 0 ? 'vs-bad' : 'vs-flat')) : 'vs-flat');
      return '<tr' + (r.core ? ' class="row-bottleneck"' : '') + '>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td><code>' + esc(r.code) + (r.code === 'overflow' ? ':&lt;노드&gt;' : '') + '</code></td>' +
        '<td>' + esc(meta.label) + '</td>' +
        '<td>' + esc(r.stage) + (r.core ? ' <b>★</b>' : '') + '</td>' +
        '<td>' + (meta.structural ? '✅ 구조' : '❌ 비구조') + '</td>' +
        '<td>' + esc(r.fixer) + '</td>' +
        '<td class="num">' + a + '</td><td class="num">' + b + '</td>' +
        '<td class="num"><span class="' + dcls + '">' + (d > 0 ? '+' : '') + d + '</span></td></tr>';
    }).join('');
  }

  KJ.panels = {
    /** [분석] 탭: 9단계 파이프라인 지표 + 정상상태 해석 상세 렌더 */
    renderAnalysis: function (state, analysis) {
      var sc = KJ.scenarioById(state.sc);
      renderPipeline(state);

      // ── 병목 종합 (시나리오에서 도출) ──
      var bn = analysis.bottlenecks.length
        ? analysis.bottlenecks.map(function (b) {
          return '<li class="bn-item bn-sev' + b.severity + '">' +
            KIND_ICON[b.kind] + ' <b>' + esc(b.name) + '</b><br>' +
            '<span class="bn-detail">' + esc(b.detail) + '</span></li>';
        }).join('')
        : '<li class="bn-none">현재 시나리오·강도·모드에서 도출된 병목 없음 ' +
          '(병목은 고정값이 아니라 부하의 함수 — 강도를 높이거나 시나리오를 바꿔보세요)</li>';
      el('bottleneck-summary').innerHTML =
        '<div class="analysis-context">' + esc(sc.name) + ' · ' +
        (state.mode === 'asis' ? 'As-Is (분절형)' : 'To-Be (K-JAMDS 통합형)') +
        ' · 강도 ×' + state.x.toFixed(1) + '</div><ul>' + bn + '</ul>';

      // ── 노드 이용률 표 (ρ 내림차순) ──
      var rows = analysis.nodes.slice().sort(function (a, b) {
        var ra = isFinite(a.rho) ? a.rho : 99, rb = isFinite(b.rho) ? b.rho : 99;
        return rb - ra;
      }).map(function (r) {
        var bar = Math.min(100, (isFinite(r.rho) ? r.rho : 1.2) * 100);
        return '<tr class="row-' + r.level + '">' +
          '<td>' + esc(r.name) + '</td>' +
          '<td>' + (r.category === 'c2' ? 'C2' : '교전') + '</td>' +
          '<td class="num">' + r.lambda.toFixed(2) + '</td>' +
          '<td class="num">' + r.servers + '</td>' +
          '<td class="num">' + r.serviceSec + 's</td>' +
          '<td><div class="rho-bar"><div class="rho-fill lv-' + r.level +
          '" style="width:' + bar + '%"></div>' +
          '<span>' + (isFinite(r.rho) ? r.rho.toFixed(2) : '≥1') + '</span></div></td>' +
          '<td class="num">' + (isFinite(r.Wq) ? r.Wq.toFixed(1) + 's' : '∞') + '</td>' +
          '<td>' + LEVEL_BADGE[r.level] + '</td></tr>';
      }).join('');
      el('node-table-body').innerHTML = rows;

      // ── 통신 링크 표 ──
      var lrows = analysis.links.slice().sort(function (a, b) {
        return (b.delaySec * b.flow) - (a.delaySec * a.flow);
      }).map(function (r) {
        return '<tr' + (r.isCommBottleneck ? ' class="row-bottleneck"' : '') + '>' +
          '<td>' + esc(KJ.nodeById(r.from).name) + ' → ' + esc(KJ.nodeById(r.to).name) + '</td>' +
          '<td>' + esc(r.type) + '</td>' +
          '<td class="num">' + r.delaySec + 's</td>' +
          '<td class="num">' + r.flow.toFixed(2) + '</td>' +
          '<td>' + (r.isCommBottleneck
            ? '<span class="badge badge-bad">통신병목</span>'
            : '<span class="badge badge-ok">정상</span>') + '</td></tr>';
      }).join('');
      el('link-table-body').innerHTML = lrows;

      // ── 위협별 타임라인 (탐지→교전 고정지연 추정) ──
      var tl = analysis.timelines.map(function (t) {
        var total = Math.max(t.totalSec, 1);
        var segs = t.stages.map(function (s, i) {
          var w = (s.sec / total * 100).toFixed(1);
          return '<div class="tl-seg tl-' + i + '" style="width:' + w + '%" title="' +
            esc(s.name) + ' ' + s.sec + '초"></div>';
        }).join('');
        return '<div class="tl-row">' +
          '<div class="tl-label">' + esc(t.typeName) + ' <span class="tl-axis">(' +
          esc(t.axis) + ')</span></div>' +
          '<div class="tl-bar">' + segs + '</div>' +
          '<div class="tl-total">' + (t.engageable ? '≈' + Math.round(t.totalSec) + '초' :
            '<span class="badge badge-crit">교전 불가</span>') + '</div></div>';
      }).join('');
      el('timeline-rows').innerHTML = tl ||
        '<div class="bn-none">시나리오에 위협이 없습니다.</div>';

      el('analysis-note').textContent =
        '※ Phase 1 정상상태 M/M/c(Erlang-C) 해석적 근사입니다. 타임라인은 대기시간을 제외한 ' +
        '경로 고정지연 합이며, Phase 2(DES)·Phase 3(Monte Carlo)에서 확률분포 기반으로 정밀화됩니다.';
      if (KJ.tableSort) KJ.tableSort.attachAll(el('panel-analysis')); // 숫자열 헤더 우측정렬 동기화
    },

    /** 근거자료 탭: 제약 어서션 + 파라미터 문서 링크 */
    renderData: function () {
      var checks = KJ.runConstraintChecks();
      el('constraint-list').innerHTML = checks.map(function (c) {
        return '<li class="' + (c.pass ? 'chk-pass' : 'chk-fail') + '">' +
          (c.pass ? '✅' : '❌') + ' <b>[' + c.id + '] ' + esc(c.name) + '</b>' +
          '<div class="chk-detail">' + esc(c.detail) + '</div></li>';
      }).join('');

      var nodeRows = KJ.NODES.map(function (n) {
        var refs = [];
        if (n.queue && n.queue.paramRef) refs.push(n.queue.paramRef);
        if (n.detectProb && n.detectProb.paramRef) refs.push(n.detectProb.paramRef);
        if (n.engage && n.engage.pk && n.engage.pk.paramRef) refs.push(n.engage.pk.paramRef);
        if (n.wtaSuit && n.wtaSuit.paramRef) refs.push(n.wtaSuit.paramRef);       // Best-Shooter 적합도 (Phase B-1)
        if (n.engage && n.engage.costRef) refs.push(n.engage.costRef);            // 요격탄 개념 단가 (Phase D)
        if (n.rangeRef) refs.push(n.rangeRef);
        (n.constraintRefs || []).forEach(function (r) { refs.push(r); });
        var km = n.category === 'sensor' ? n.rangeKm
          : (n.engage ? n.engage.rangeKm : null);
        return '<tr><td>' + esc(n.id) + '</td><td>' + esc(n.name) + '</td>' +
          '<td>' + n.category + '</td>' +
          '<td>' + (n.modes ? n.modes.join(',') : 'asis, tobe') + '</td>' +
          '<td class="num">' + (km ? '≈' + km + 'km' : '—') + '</td>' +
          '<td class="refs">' + refs.map(esc).join('<br>') + '</td></tr>';
      }).join('');
      el('inventory-body').innerHTML = nodeRows;

      // ── 위협 유형 표 (Phase A~D 데이터: 사거리대·발사권역·단가·자동화 차등) ──
      var AUTO_SHORT = { 'human-in-loop': '유인결심', 'human-on-loop': '감독자동', 'auto-preauth': '사전승인' };
      var threatRows = Object.keys(KJ.THREAT_TYPES).map(function (k) {
        var t = KJ.THREAT_TYPES[k];
        var refs = [t.paramRef, t.rangeRef, t.costRef].filter(function (r, i, arr) {
          return r && arr.indexOf(r) === i; // 중복 근거 ID 제거 (예: KN-25는 paramRef=rangeRef)
        });
        var zones = (t.originZones || []).join('·');
        return '<tr><td>' + esc(t.key) + '</td><td>' + esc(t.name) + '</td>' +
          '<td>' + esc(t.altBand) + '</td>' +
          '<td class="num">' + t.dwellSec + 's</td>' +
          '<td class="num">' + (t.rangeBandKm ? t.rangeBandKm.min + '–' + t.rangeBandKm.max + 'km' : '—') + '</td>' +
          '<td>' + esc(zones || '—') + '</td>' +
          '<td class="num">' + (t.unitCostM != null ? t.unitCostM : '—') + '</td>' +
          '<td>' + esc((AUTO_SHORT[t.automation && t.automation.asis] || '—') + ' → ' +
                       (AUTO_SHORT[t.automation && t.automation.tobe] || '—')) + '</td>' +
          '<td class="refs">' + refs.map(esc).join('<br>') + '</td></tr>';
      }).join('');
      el('threat-inventory-body').innerHTML = threatRows;
      if (KJ.tableSort) KJ.tableSort.attachAll(el('panel-data'));
    }
  };
})();
