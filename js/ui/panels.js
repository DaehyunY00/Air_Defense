/**
 * K-JAMDS 시뮬레이터 — 탭 패널 렌더러 (Phase 1 → [분석] 탭 개편)
 * [결심 비교] / [근거자료] 탭.
 *
 * ⚠️ [분석] 탭은 ADR-076에서 전면 개편을 위해 제거됐다(renderPipeline·renderTaxonomyTable
 * ·renderThreatLog 등). 그 화면이 쓰던 desPair 캐시(pipelineData)는 [결심 비교]가 공유하므로
 * 남아 있다 — 새 분석 화면은 이 캐시 위에 렌더러만 붙이면 된다.
 *  - 9단계 파이프라인 병목·해결 지표: 동일 seed의 As-Is/To-Be 결정론 DES 1복제 비교
 *    (설정 키 캐시 — 슬라이더 드래그 시 동일 설정 중복 재계산 방지)
 *  - 위협 항적 병렬 로그: 같은 desPair 결과에서 As-Is↔To-Be를 위협 ID로 1:1 대조.
 *    CRN(공통난수) 설계상 두 모드의 위협 집단은 동일하므로 판정이 갈린 항적이 구조 차이의 증거다.
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
  function modelConfig(state) {
    // ADR-061: 충실도 1종(iads-c2)·고해상도 배치만 존재한다.
    // ADR-062: 승인 계선(ADR-058) 토글 — 기본 OFF.
    var features = { highResolutionDeployment: true };
    // ADR-065: 승인 계선·표적 산포·남부 축선은 기본 ON — 상태가 '0'일 때만 끈다.
    features.approvalChain = state && state.appr !== '0';
    features.threatTargetDispersion = state && state.disp !== '0';
    features.southernAxes = state && state.south !== '0';
    features.linkSemanticsV2 = !state || state.linkv2 !== '0'; // ADR-066
    features.sensorReportParity = !state || state.rp !== '0'; // ADR-067
    features.unifiedEngagementState = !state || state.cop !== '0'; // ADR-068
    features.sawtoothFreshness = !state || state.saw !== '0'; // ADR-069·072
    features.selfDefenseFire = !state || state.sdf !== '0'; // ADR-071·072
    features.engageOnRemote = !!state && state.eor === '1'; // ADR-070: 기본 꺼짐 실험 옵션
    return { deploymentId: state && state.dep, features: features, modelFidelity: 'iads-c2' };
  }
  /**
   * ADR-073/074: DES 실행에만 얹는 결심 비교 계측 3종. 카탈로그 해석(modelConfig)에는 넣지
   * 않는다 — 계측은 토폴로지와 무관하고, 카탈로그 캐시 키를 흔들 이유가 없다.
   * 전부 **관측 전용**이라 격추·누수·난수 소비가 불변임이 회귀로 고정돼 있다
   * (decision-audit·shadow-eval 스위트). [분석]·[결심 비교] 두 탭이 같은 desPair 결과를
   * 공유하므로 계산은 한 번만 돈다.
   */
  function runFeatures(state) {
    return Object.assign({}, modelConfig(state).features, {
      decisionAudit: true, shadowEval: true, windowMargin: true
    });
  }
  function catalogFor(state) {
    return KJ.resolveModelCatalog ? KJ.resolveModelCatalog(modelConfig(state)) : null;
  }

  // ══════════════ 9단계 파이프라인 병목·해결 지표 (분석 탭 상단) ══════════════
  // 각 단계가 "어떤 병목을 드러내고 어떤 지표·실패코드로 관측되는지"를
  // As-Is↔To-Be 결정론 DES 1복제(동일 seed)로 나란히 비교한다.

  // DES 양모드 캐시 (설정이 같으면 재계산하지 않음 — 탭 전환·재렌더 대비)
  var desCache = { key: null, data: null, pendingKey: null, requestId: 0, error: null, errorKey: null };
  function pipelineData(state, onReady) {
    var key = [state.sc, state.x, state.seed, state.dur, state.dep, 'iads-c2',
      state.appr === '1' ? 'appr' : '',
      state.disp === '1' ? 'disp' : '',
      state.south === '1' ? 'south' : '',
      state.linkv2 === '0' ? 'linkv1' : '',
      state.rp === '0' ? 'norp' : '',
      state.cop === '0' ? 'nocop' : '',
      state.saw === '0' ? 'nosaw' : '',
      state.sdf === '0' ? 'nosdf' : '',
      state.eor === '1' ? 'eor' : ''].join('|'); // ADR-062~072: 토글도 캐시 키
    if (desCache.key === key) return desCache.data;
    if (desCache.errorKey === key) return null;
    if (desCache.pendingKey === key) return null;
    desCache.pendingKey = key;
    desCache.error = null; desCache.errorKey = null;
    var requestId = ++desCache.requestId;
    var highCfg = modelConfig(state);
    KJ.compute.run('desPair', {
      cfg: {
        scenarioId: state.sc, mode: 'asis', intensity: state.x,
        seed: state.seed, endTimeSec: state.dur,
        deploymentId: highCfg.deploymentId, features: runFeatures(state),
        modelFidelity: highCfg.modelFidelity,
        // 위협 항적 병렬 로그용 — mode:'asis' 고정이므로 current=As-Is, other=To-Be로 확정된다.
        trace: true, traceCap: 300
      },
      includeHeat: true,
      tracePair: true   // 반대 모드(To-Be)도 trace — 병렬 대조의 우측 열
    }).then(function (pair) {
      if (requestId !== desCache.requestId) return;
      desCache.key = key;
      desCache.pendingKey = null;
      desCache.errorKey = null;
      desCache.data = {
        a: pair.current, b: pair.other,
        heatA: pair.heatCurrent, heatB: pair.heatOther
      };
      if (onReady) onReady();
    }).catch(function (err) {
      if (requestId !== desCache.requestId) return;
      desCache.pendingKey = null;
      desCache.error = err.message;
      desCache.errorKey = key;
      if (onReady) onReady();
    });
    return null;
  }

  /** 링크 전달 1건당 평균 통신지연(초) — sim-view의 MoP 지표와 동일 정의.
   * kind 지정 시 그 종류(report/coord/command)만 집계 → 각 단계가 자기 단계 링크만 측정.
   * kind 생략 시 전 링크(하위호환).
   * ⚠️ 샘플된 실제 지연이 아니라 대표값(delaySec)×건수 가중평균 — 현재 링크 분포(삼각·균등)가
   * 모두 대칭이라 평균=대표값이지만, 비대칭 분포(lognormal 등)를 링크에 도입하면 실현 평균과
   * 괴리가 생기므로 그때는 샘플 합 집계로 교체해야 한다. */
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
    if (g.failureSummary) return g.failureSummary.structuralPrimary || 0;
    var n = 0;
    Object.keys(g.leakReasons).forEach(function (r) {
      if (KJ.leakTaxonomy(r).structural) n += g.leakReasons[r];
    });
    return n;
  }
  function c2aMetric(g, section, field) {
    var c = g.coordination && g.coordination[section];
    return c && typeof c[field] === 'number' ? c[field] : 0;
  }
  /** 카테고리별 최대 관측 ρ / 드롭 합 */
  function maxRho(res, cat) {
    var m = 0;
    res.nodes.forEach(function (n) { if (n.category === cat && n.rho > m) m = n.rho; });
    return m;
  }
  /** 카테고리별 최대 관측 Wq(평균 대기시간, 초). idle 노드(waitCount=0)는 _results가 Wq=0으로
   * 산출하므로 정상 참여하나, 방어적으로 isFinite 가드를 둔다(NaN/Infinity가 카드에 새지 않도록). */
  function maxWq(res, cat) {
    var m = 0;
    res.nodes.forEach(function (n) {
      if (n.category === cat && isFinite(n.Wq) && n.Wq > m) m = n.Wq;
    });
    return m;
  }
  // ── kind별(track/approval/engage) 분해 지표 — C2 서버풀이 ③④⑤ 항적처리(track)와
  //    ⑥⑦ 승인처리(approval)에 공유되므로, 각 카드가 자기 kind만 보게 한다(엔진 rhoByKind 등).
  //    구 필드가 없는 결과(하위호환·이론분석 노드)에는 0으로 폴백한다. ──
  // 고해상도 native는 항적처리를 kind='iads_track'으로 태깅하므로, 'track' 조회는 두 키를
  // 함께 본다(두 경로는 배타적이라 합·최대가 같다). 이 폴백이 없으면 고해상도 실행에서
  // ③④⑤ 카드가 실제 병목(노드 ρ≥0.9)을 0으로 표시한다.
  function kindKeys(kind) { return kind === 'track' ? ['track', 'iads_track'] : [kind]; }
  function maxRhoByKind(res, cat, kind) {
    var m = 0, keys = kindKeys(kind);
    res.nodes.forEach(function (n) {
      if (n.category !== cat || !n.rhoByKind) return;
      keys.forEach(function (k) { var v = n.rhoByKind[k] || 0; if (v > m) m = v; });
    });
    return m;
  }
  function sumDropsByKind(res, cat, kind) {
    var s = 0, keys = kindKeys(kind);
    res.nodes.forEach(function (n) {
      if (n.category !== cat || !n.dropsByKind) return;
      keys.forEach(function (k) { s += n.dropsByKind[k] || 0; });
    });
    return s;
  }
  function maxWqByKind(res, cat, kind) {
    var m = 0, keys = kindKeys(kind);
    res.nodes.forEach(function (n) {
      if (n.category !== cat || !n.WqByKind) return;
      keys.forEach(function (k) {
        var v = n.WqByKind[k] || 0;
        if (isFinite(v) && v > m) m = v;
      });
    });
    return m;
  }
  function dropSum(res, cat) {
    var s = 0;
    res.nodes.forEach(function (n) { if (n.category === cat) s += n.drops; });
    return s;
  }
  /** leakReasons를 단계 귀속용 코드로 정규화 (overflow는 노드 카테고리로 C2/교전 분리) */
  function codeCounts(res, catalog) {
    var out = {};
    Object.keys(res.global.leakReasons).forEach(function (k) {
      var n = res.global.leakReasons[k];
      if (k.indexOf('overflow:') === 0) {
        var nd = KJ.nodeById(k.slice(9), catalog);
        var bucket = nd && nd.category === 'shooter' ? 'overflow_shooter' : 'overflow_c2';
        out[bucket] = (out[bucket] || 0) + n;
      } else {
        out[k] = (out[k] || 0) + n;
      }
    });
    return out;
  }
  // 단계 귀속용 확장 코드(overflow 분리)의 라벨·구조성 — 기본 코드는 KJ.LEAK_TAXONOMY 참조
  var CODE_META = {
    overflow_c2: { label: '포화손실(C2 처리)', structurality: 'conditional', structural: false },
    // Phase 4(⑨) 재분류: 교전채널 포화는 유도탄·발사대 수 문제(no_shooter 계열) → 비구조.
    overflow_shooter: { label: '포화손실(교전채널)', structurality: 'conditional', structural: false }
  };
  function codeMeta(code) { return CODE_META[code] || KJ.leakTaxonomy(code); }

  // MoM 계층 툴팁 (NATO COBP/SAS-026, ENV-MOM-COBP-01 — sim-view와 동일)
  var MOM_TIP = {
    MoP: 'Measure of Performance — 체계 내부 과정 성능 (NATO COBP/SAS-026)',
    MoCE: 'Measure of C2 Effectiveness — 지휘통제 효과성 (NATO COBP/SAS-026)',
    MoFE: 'Measure of Force Effectiveness — 전력 전체의 임무 효과 (NATO COBP/SAS-026)'
  };

  // 종류별 기본 표시 자릿수. extra는 "두 값이 같게 보이는데 Δ는 개선이라 적히는" 모순을
  // 없애기 위해 metricRow가 한 자리 더 요구할 때만 붙는다(97.6%·98.5% → 둘 다 "98%" 문제).
  var BASE_PREC = { rate: 0, sec: 0, raw: 1, raw2: 2, ratio: 2 };
  function fmtVal(v, kind, extra) {
    if (v === null || v === undefined || (kind !== 'cnt' && !isFinite(v))) return '—';
    var p = (BASE_PREC[kind] || 0) + (extra || 0);
    if (kind === 'rate') return (v * 100).toFixed(p) + '%';
    if (kind === 'sec') return v.toFixed(p) + '초';
    if (kind === 'raw' || kind === 'raw2') return v.toFixed(p);
    if (kind === 'ratio') return v.toFixed(p) + '배';
    return v + '건';
  }
  function fmtDelta(d, kind, extra) {
    var av = Math.abs(d), p = (BASE_PREC[kind] || 0) + (extra || 0);
    if (kind === 'rate') return (av * 100).toFixed(p) + '%p';
    if (kind === 'sec') return av.toFixed(p) + '초';
    if (kind === 'raw' || kind === 'raw2') return av.toFixed(p);
    if (kind === 'ratio') return av.toFixed(p);
    return av + '건';
  }

  /** 지표 1행: [MoM][라벨][As-Is 값][좌막대][우막대][To-Be 값][Δ판정]
   * m.na가 있으면 값 대신 사유를 표시한다 — 모델이 이 지표를 **측정하지 않는 설정**일 때
   * 0을 그대로 보여주면 "지연 없음/병목 없음"으로 오독되기 때문이다(ADR-062). */
  function metricRow(m) {
    if (m.na) {
      return '<div class="pl-m pl-m-na" title="' + esc(m.tip || '') + '">' +
        '<span class="mom mom-' + m.mom.toLowerCase() + '" title="' + esc(MOM_TIP[m.mom]) + '">' + m.mom + '</span>' +
        '<span class="pl-m-label">' + esc(m.label) + '</span>' +
        '<span class="pl-m-na-note">' + esc(m.na) + '</span>' +
        '<span class="pl-m-delta vs-flat">미측정</span></div>';
    }
    var aN = (typeof m.a === 'number' && isFinite(m.a)) ? m.a : null;
    var bN = (typeof m.b === 'number' && isFinite(m.b)) ? m.b : null;
    var max = m.max || Math.max(aN || 0, bN || 0, 1e-9);
    var aw = aN === null ? 0 : Math.min(100, aN / max * 100);
    var bw = bN === null ? 0 : Math.min(100, bN / max * 100);
    // 표시 자릿수 결정: 기본 자릿수로 두 값이 똑같이 보이면 한 자리 더 준다.
    // 한 자리를 더 줘도 같게 보이면 그 차이는 표시 해상도 아래 — "동일"로 읽는다.
    var extra = 0, collapsed = false;
    if (aN !== null && bN !== null && aN !== bN && m.kind !== 'cnt') {
      if (fmtVal(aN, m.kind, 0) === fmtVal(bN, m.kind, 0)) {
        extra = 1;
        collapsed = fmtVal(aN, m.kind, 1) === fmtVal(bN, m.kind, 1);
      }
    }
    var deltaLabel, dcls;
    if (aN === null || bN === null) {
      deltaLabel = '판정 불가'; dcls = 'vs-flat';
    } else if (m.lower === null) { // 방향성 판정 없는 참고 지표 (예: 분권 전환)
      var dd = bN - aN;
      deltaLabel = ((dd === 0 || collapsed) ? '동일'
        : (dd > 0 ? '▲' : '▼') + ' ' + fmtDelta(dd, m.kind, extra)) + ' (참고)';
      dcls = 'vs-flat';
    } else {
      var d = bN - aN;
      var improved = m.lower ? d < 0 : d > 0;
      var same = collapsed || Math.abs(d) < (m.kind === 'cnt' ? 0.5 : 1e-9);
      var arrow = same ? '=' : (d > 0 ? '▲' : '▼');
      dcls = same ? 'vs-flat' : (improved ? 'vs-good' : 'vs-bad');
      deltaLabel = same ? '동일' : (arrow + ' ' + fmtDelta(d, m.kind, extra) + (improved ? ' 개선' : ' 악화'));
    }
    if (collapsed) extra = 0; // 동일로 접었으면 값도 기본 자릿수로 되돌린다
    return '<div class="pl-m" title="' + esc(m.tip || '') + '">' +
      '<span class="mom mom-' + m.mom.toLowerCase() + '" title="' + esc(MOM_TIP[m.mom]) + '">' + m.mom + '</span>' +
      '<span class="pl-m-label">' + esc(m.label) + '</span>' +
      '<span class="pl-m-val asis">' + fmtVal(m.a, m.kind, extra) + '</span>' +
      '<div class="pl-m-track l"><div class="pl-m-fill asis" style="width:' + aw.toFixed(0) + '%"></div></div>' +
      '<div class="pl-m-track r"><div class="pl-m-fill tobe" style="width:' + bw.toFixed(0) + '%"></div></div>' +
      '<span class="pl-m-val tobe">' + fmtVal(m.b, m.kind, extra) + '</span>' +
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
      (meta.structurality === 'structural' ? ' <span class="badge badge-warn">구조</span>' :
        (meta.structurality === 'conditional' ? ' <span class="badge">조건부</span>' : '')) +
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

  function unmeasured(reason) {
    return '<div class="dc-unmeasured">🚫 <b>미측정 — 결심 비교 계측 OFF</b>' +
      (reason ? '<span class="dc-unmeasured-why">(' + esc(reason) + ')</span>' : '') +
      '<div class="dc-unmeasured-how">이 런은 <code>decisionAudit</code> 계측 없이 실행됐습니다. ' +
      '값이 0인 것이 아니라 <b>재지 않은 것</b>입니다.</div></div>';
  }
  function pctText(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
  function secText(v) { return v == null ? '—' : Math.round(v) + 's'; }

  /** As-Is/To-Be 한 쌍을 좌우 막대로 놓는 게이지 한 줄. lowerBetter면 작은 쪽이 초록. */
  function gaugeRow(title, a, b, sub, lowerBetter) {
    function bar(side, v) {
      var w = v == null ? 0 : Math.max(0, Math.min(1, v)) * 100;
      var better = v != null && (lowerBetter
        ? (side === 'asis' ? v < 0 : true) : false);
      return '<div class="dc-g-bar"><div class="dc-g-fill ' + side + '" style="width:' +
        w.toFixed(1) + '%"></div></div>';
    }
    var winner = (a == null || b == null) ? null
      : (lowerBetter ? (b < a ? 'tobe' : (a < b ? 'asis' : null))
                     : (b > a ? 'tobe' : (a > b ? 'asis' : null)));
    return '<div class="dc-gauge">' +
      '<div class="dc-g-title">' + esc(title) +
      (winner ? '<span class="dc-g-win ' + winner + '">' +
        (winner === 'tobe' ? 'To-Be 우위' : 'As-Is 우위') + '</span>'
        : '<span class="dc-g-win flat">차이 없음</span>') + '</div>' +
      '<div class="dc-g-row"><span class="dc-g-lab asis">As-Is</span>' +
      bar('asis', a) + '<span class="dc-g-val asis">' + pctText(a) + '</span></div>' +
      '<div class="dc-g-row"><span class="dc-g-lab tobe">To-Be</span>' +
      bar('tobe', b) + '<span class="dc-g-val tobe">' + pctText(b) + '</span></div>' +
      '<div class="dc-g-sub">' + sub + '</div></div>';
  }

  /**
   * ③ 겹쳐 그린 두 분포. 0 미만 구간은 빨강 음영.
   * `undecidedA/B`는 결심조차 없어 여유를 잴 수 없었던 위협 수 — 축 왼쪽 밖의 **별도 통**으로
   * 그린다. 0으로 접어 넣으면 "여유 0초"로 오독되기 때문이다(미측정과 0의 구분).
   */
  function histogram(valuesA, valuesB, opts) {
    var all = valuesA.concat(valuesB).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    var undecidedA = opts.undecidedA || 0, undecidedB = opts.undecidedB || 0;
    if (!all.length && !undecidedA && !undecidedB) {
      return '<div class="bn-none">' + esc(opts.emptyText || '표본 없음') + '</div>';
    }
    var lo = Math.min.apply(null, all.concat(all.length ? [] : [0]));
    var hi = Math.max.apply(null, all.concat(all.length ? [] : [1]));
    if (!(hi > lo)) { hi = lo + 1; }
    var BINS = 28, W = 620, H = 150, PADL = 46, PADB = 26, PADT = 8;
    var side = (undecidedA || undecidedB) ? 58 : 0;   // 미결심 통 폭
    var plotW = W - PADL - 8 - side, plotH = H - PADB - PADT;
    function binOf(v) { return Math.min(BINS - 1, Math.floor((v - lo) / (hi - lo) * BINS)); }
    function counts(values) {
      var c = new Array(BINS).fill(0);
      values.forEach(function (v) { if (isFinite(v)) c[binOf(v)]++; });
      return c;
    }
    var ca = counts(valuesA), cb = counts(valuesB);
    // 곡선과 미결심 통은 **축척을 분리한다.** 미결심이 곡선 최댓값보다 훨씬 크면 공유 축척에서
    // 곡선이 뭉개져 분포 모양이 안 보인다. 두 통의 실제 건수는 축 아래 숫자로 병기한다.
    var peak = Math.max(1, Math.max.apply(null, ca.concat(cb)).valueOf());
    var undecidedPeak = Math.max(1, undecidedA, undecidedB);
    var bw = plotW / BINS;
    function poly(c, cls) {
      var pts = [];
      for (var i = 0; i < BINS; i++) {
        var x = PADL + side + i * bw, y = PADT + plotH - (c[i] / peak) * plotH;
        pts.push(x + ',' + y, (x + bw) + ',' + y);
      }
      return '<polyline class="dc-h-line ' + cls + '" points="' + pts.join(' ') + '"/>' +
        '<polygon class="dc-h-area ' + cls + '" points="' +
        (PADL + side) + ',' + (PADT + plotH) + ' ' + pts.join(' ') + ' ' +
        (PADL + side + plotW) + ',' + (PADT + plotH) + '"/>';
    }
    // 0 미만 구간 빨강 음영 (여유 분포 전용)
    var negShade = '';
    if (opts.shadeNegative && lo < 0) {
      var zeroX = PADL + side + Math.min(1, (0 - lo) / (hi - lo)) * plotW;
      negShade = '<rect class="dc-h-neg" x="' + (PADL + side) + '" y="' + PADT +
        '" width="' + (zeroX - PADL - side).toFixed(1) + '" height="' + plotH + '"/>' +
        '<line class="dc-h-zero" x1="' + zeroX.toFixed(1) + '" y1="' + PADT +
        '" x2="' + zeroX.toFixed(1) + '" y2="' + (PADT + plotH) + '"/>';
    }
    var undecidedBox = '';
    if (side) {
      var ua = (undecidedA / undecidedPeak) * plotH, ub = (undecidedB / undecidedPeak) * plotH;
      undecidedBox =
        '<rect class="dc-h-undec-box" x="' + PADL + '" y="' + PADT + '" width="' + (side - 8) +
        '" height="' + plotH + '"/>' +
        '<rect class="dc-h-undec asis" x="' + (PADL + 4) + '" y="' + (PADT + plotH - ua) +
        '" width="' + ((side - 16) / 2) + '" height="' + ua.toFixed(1) + '"/>' +
        '<rect class="dc-h-undec tobe" x="' + (PADL + 4 + (side - 16) / 2) + '" y="' + (PADT + plotH - ub) +
        '" width="' + ((side - 16) / 2) + '" height="' + ub.toFixed(1) + '"/>' +
        '<text class="dc-h-ax" x="' + (PADL + (side - 8) / 2) + '" y="' + (H - 14) +
        '" text-anchor="middle">미결심</text>' +
        '<text class="dc-h-ax" x="' + (PADL + (side - 8) / 2) + '" y="' + (H - 4) +
        '" text-anchor="middle">' + undecidedA + ' / ' + undecidedB + '</text>';
    }
    return '<svg class="dc-hist" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      negShade + undecidedBox +
      poly(ca, 'asis') + poly(cb, 'tobe') +
      '<line class="dc-h-axis" x1="' + (PADL + side) + '" y1="' + (PADT + plotH) +
      '" x2="' + (PADL + side + plotW) + '" y2="' + (PADT + plotH) + '"/>' +
      '<text class="dc-h-ax" x="' + (PADL + side) + '" y="' + (H - 12) + '">' + esc(opts.fmt(lo)) + '</text>' +
      '<text class="dc-h-ax" x="' + (PADL + side + plotW) + '" y="' + (H - 12) +
      '" text-anchor="end">' + esc(opts.fmt(hi)) + '</text>' +
      '<text class="dc-h-ax" x="2" y="' + (PADT + 10) + '">' + peak + '건</text>' +
      '<text class="dc-h-ax" x="' + (PADL + side + plotW / 2) + '" y="' + (H - 2) +
      '" text-anchor="middle">' + esc(opts.xLabel) + '</text>' +
      '</svg>';
  }

  /**
   * ① 페어드 타임라인 한 줄. 가로축은 **실제 시각**(생성 → 체공창 종료)이며,
   * C2 대기(Wq)/서비스는 위치가 아니라 [탐지→결심] 구간 안의 **비중**으로 나눠 칠한다
   * (여러 노드에 흩어진 대기·서비스에 단일 위치를 줄 수 없으므로 — 화면에 명시).
   */
  function timelineBar(r, side) {
    if (!r || r.spawnT == null) {
      return '<div class="dc-tl-bar dc-tl-absent">이 체계에서는 해당 위협 기록 없음</div>';
    }
    var t0 = r.spawnT, span = Math.max(1, (r.dwellEndT || r.spawnT + 1) - t0);
    function pos(t) { return t == null ? null : Math.max(0, Math.min(100, (t - t0) / span * 100)); }
    var segs = '';
    var detect = pos(r.detectT), decide = pos(r.firstDecisionT), fire = pos(r.firstFireT);
    var end = pos(r.killT != null ? r.killT : (r.leakT != null ? r.leakT : r.dwellEndT));
    if (detect != null) {
      segs += '<div class="dc-seg dc-seg-detect" style="left:0;width:' + detect.toFixed(2) +
        '%" title="탐지 대기 ' + secText(r.detectT - t0) + '"></div>';
    }
    if (detect != null && decide != null && decide > detect) {
      // 결심까지의 구간을 Wq(빗금) / 서비스(채움) / 나머지(전달·이동)로 비중 분할
      var width = decide - detect;
      var acct = Math.max(0.0001, r.c2QueueSec + r.c2ServiceSec);
      var gap = Math.max(0, (r.firstDecisionT - r.detectT) - acct);
      var totalSec = acct + gap;
      var wq = width * (r.c2QueueSec / totalSec), sv = width * (r.c2ServiceSec / totalSec);
      segs += '<div class="dc-seg dc-seg-wq" style="left:' + detect.toFixed(2) + '%;width:' +
        wq.toFixed(2) + '%" title="C2 대기 Wq ' + secText(r.c2QueueSec) + ' (비중 분할)"></div>' +
        '<div class="dc-seg dc-seg-svc" style="left:' + (detect + wq).toFixed(2) + '%;width:' +
        sv.toFixed(2) + '%" title="C2 서비스 ' + secText(r.c2ServiceSec) + ' (비중 분할)"></div>' +
        '<div class="dc-seg dc-seg-rest" style="left:' + (detect + wq + sv).toFixed(2) + '%;width:' +
        Math.max(0, width - wq - sv).toFixed(2) + '%" title="전달·기타 ' + secText(gap) + '"></div>';
    }
    if (decide == null && detect != null && r.windowCloseT != null) {
      // 결심이 아예 없었던 위협 — 빈 막대는 "아무 일도 없었다"로 읽히지 않으므로,
      // 탐지 이후 교전창이 통째로 흘러간 구간을 붉은 빗금으로 드러낸다.
      var idleEnd = Math.max(detect, pos(r.windowCloseT));
      segs += '<div class="dc-seg dc-seg-idle" style="left:' + detect.toFixed(2) + '%;width:' +
        (idleEnd - detect).toFixed(2) + '%" title="탐지 후 결심 없이 교전창이 마감됨 (' +
        secText(r.windowCloseT - r.detectT) + ')"></div>';
    }
    if (decide != null && fire != null && fire > decide) {
      segs += '<div class="dc-seg dc-seg-cmd" style="left:' + decide.toFixed(2) + '%;width:' +
        (fire - decide).toFixed(2) + '%" title="결심→발사 ' + secText(r.firstFireT - r.firstDecisionT) + '"></div>';
    }
    if (fire != null && end != null && end > fire) {
      segs += '<div class="dc-seg dc-seg-eng" style="left:' + fire.toFixed(2) + '%;width:' +
        (end - fire).toFixed(2) + '%" title="교전·요격"></div>';
    }
    // 교전창 마감 세로선 — 막대가 이 선을 넘으면(결심이 없거나 늦으면) 빨강
    var closeX = pos(r.windowCloseT);
    var missed = r.windowCloseT != null &&
      (r.firstDecisionT == null || r.firstDecisionT > r.windowCloseT);
    var marks = '';
    if (closeX != null) {
      marks += '<div class="dc-close' + (missed ? ' missed' : '') + '" style="left:' +
        closeX.toFixed(2) + '%" title="교전창 마감 ' + secText(r.windowCloseT - t0) + ' (생성 기준)"></div>';
    }
    if (r.approvalJobs > 0 && decide != null) {
      marks += '<div class="dc-appr" style="left:' + decide.toFixed(2) +
        '%" title="협조 연락·승인 절차 ' + r.approvalJobs + '건">◆</div>';
    }
    if (decide != null) {
      marks += '<div class="dc-decide" style="left:' + decide.toFixed(2) +
        '%" title="결심완료 ' + secText(r.firstDecisionT - t0) + '"></div>';
    }
    var outcome = r.killT != null ? '격추' : (r.leakT != null ? '누수' : '미해결');
    var margin = (r.windowCloseT != null && r.firstDecisionT != null)
      ? r.windowCloseT - r.firstDecisionT : null;
    return '<div class="dc-tl-bar' + (missed ? ' missed' : '') + '" data-side="' + side + '">' +
      segs + marks +
      '<div class="dc-tl-out ' + (r.killT != null ? 'ok' : (r.leakT != null ? 'bad' : 'flat')) + '">' +
      outcome + (margin != null ? ' · 여유 ' + secText(margin)
        : (r.firstDecisionT == null ? ' · 결심 없음' : '')) + '</div></div>';
  }

  /** ② 후보 명단 팝오버 — 실제 선택 = 색 링, 전역 최적 = 별표. */
  function candidatePanel(threatId, a, b) {
    if (!threatId) {
      return '<div class="bn-none">위 타임라인의 막대를 클릭하면 그 결심이 본 후보 명단이 열립니다.</div>';
    }
    function block(r, label, cls) {
      if (!r || !r.decisions.length) {
        return '<div class="dc-cand-side"><div class="dc-cand-head ' + cls + '">' + label +
          '</div><div class="bn-none">이 체계에서는 결심이 없었습니다 — 후보 명단 자체가 없습니다.</div></div>';
      }
      var body = r.decisions.map(function (d) {
        var peak = d.candidates.reduce(function (m, c) { return Math.max(m, Math.abs(c.score)); }, 0) || 1;
        var rowsHtml = d.candidates.map(function (c) {
          var isChosen = c.unitId === d.chosenUnitId;
          var isBest = d.globalBestUnitId && c.unitId === d.globalBestUnitId;
          return '<div class="dc-cand' + (isChosen ? ' chosen' : '') + '">' +
            '<span class="dc-cand-id">' + (isBest ? '<b class="dc-star">★</b>' : '') +
            esc(c.unitId) + ' <span class="dc-cand-type">' + esc(c.unitType || '') + '</span></span>' +
            '<span class="dc-cand-track"><span class="dc-cand-fill" style="width:' +
            (Math.abs(c.score) / peak * 100).toFixed(1) + '%"></span></span>' +
            '<span class="dc-cand-num">' + c.score.toExponential(2) + '</span>' +
            '<span class="dc-cand-meta">pk ' + c.pk.toFixed(2) + ' · ' +
            c.rangeKm.toFixed(0) + 'km · 탄약 ' + (c.ammoRatio * 100).toFixed(0) + '%</span></div>';
        }).join('');
        // 전역 최적이 후보 명단 밖에 있으면 별표를 붙일 자리가 없다 — 별도 줄로 드러낸다.
        var outside = d.globalBestUnitId && !d.candidates.some(function (c) {
          return c.unitId === d.globalBestUnitId;
        });
        var regretLine = d.regret == null
          ? '<div class="dc-regret none">선택 손실 미측정 (' + esc(d.shadowScope || '범위 밖') + ')</div>'
          : '<div class="dc-regret' + (d.regret > 0 ? ' loss' : ' opt') + '">' +
            (d.regret > 0
              ? '선택 손실 ' + d.regret.toExponential(2) + ' — 전역 최적은 ★ ' + esc(d.globalBestUnitId) +
                (outside ? ' <b>(이 결심자의 명단 밖)</b>' : '')
              : '선택 손실 0 — 전역 최적을 골랐습니다') + '</div>';
        return '<div class="dc-dec">' +
          '<div class="dc-dec-head">t=' + secText(d.t) + ' · ' + esc(d.commanderId) +
          ' <span class="dc-axis">' + esc(d.commanderAxis) + '/' + esc(d.commanderScope || '') + '</span></div>' +
          '<div class="dc-dec-sub">시야 내 발사대 ' + d.visibleUnitCount + '기 → 실현가능 후보 ' +
          d.candidateCount + '기' +
          (d.shadowFeasible != null ? ' · 전 자산 기준 실현가능 ' + d.shadowFeasible + '기' : '') +
          (d.candidatesTruncated ? ' <span class="dc-trunc">(표시는 상위 ' + d.candidates.length + '기)</span>' : '') +
          '</div>' + rowsHtml + regretLine + '</div>';
      }).join('');
      return '<div class="dc-cand-side"><div class="dc-cand-head ' + cls + '">' + label +
        ' <span class="dc-cand-n">결심 ' + r.decisions.length + '건</span></div>' + body + '</div>';
    }
    return '<div class="dc-cand-title">위협 <code>' + esc(threatId) + '</code></div>' +
      '<div class="dc-cand-pair">' + block(a, 'As-Is 분절형', 'asis') +
      block(b, 'To-Be 통합형', 'tobe') + '</div>' +
      '<div class="note">색 링 = 실제 선택 · ★ = 전 자산 기준 전역 최적(그림자 평가, USFK 제외 — ADR-036). ' +
      '점수는 WTA 목적함수 값이며 <b>격추 건수로 환산되지 않습니다</b> — 그래서 크기가 아니라 ' +
      '일치율(손실 0 비율)로 주장합니다(ADR-074 §한계).</div>';
  }

  /**
   * 대표 위협 선정 규칙(화면에 명시) — 임의 선택이 아님을 보이기 위해 규칙과 결과를 함께 낸다.
   * 1순위: As-Is 놓침(미결심·누수) & To-Be 격추로 **결과가 갈린** 위협
   * 2순위: 두 체계 모두 결심한 위협 중 여유 차이가 큰 순
   * 동순위는 threatId 오름차순(결정론).
   */
  function pickThreats(byIdA, byIdB, limit) {
    var ids = Object.keys(byIdA).filter(function (id) { return byIdB[id]; }).sort();
    function split(id) {
      var a = byIdA[id], b = byIdB[id];
      return (a.killT == null) && (b.killT != null);
    }
    var primary = ids.filter(split);
    var rest = ids.filter(function (id) { return !split(id); }).sort(function (x, y) {
      function marg(r) {
        return (r.windowCloseT != null && r.firstDecisionT != null)
          ? r.windowCloseT - r.firstDecisionT : -Infinity;
      }
      var dx = Math.abs(marg(byIdB[x]) - marg(byIdA[x]));
      var dy = Math.abs(marg(byIdB[y]) - marg(byIdA[y]));
      if (!isFinite(dx)) dx = -1;
      if (!isFinite(dy)) dy = -1;
      return dy - dx || (x < y ? -1 : 1);
    });
    return { primary: primary, list: primary.concat(rest).slice(0, limit) };
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** trace의 outcome 문자열을 판정 객체로 정규화.
   *  엔진 정본: outcome은 'killed' | 'leaked:<코드>' | null(관측 종료 시점 미해결). */
  function outcomeOf(tr) {
    if (!tr) return { kind: 'absent', label: '해당 없음' };
    if (tr.outcome === 'killed') return { kind: 'killed', label: '격추' };
    if (typeof tr.outcome === 'string' && tr.outcome.indexOf('leaked:') === 0) {
      var code = tr.outcome.slice(7);
      var meta = KJ.leakTaxonomy(code);
      return { kind: 'leaked', code: code, label: meta.label, structural: !!meta.structural };
    }
    return { kind: 'open', label: '미해결(관측 종료)' };
  }
  function outcomeBadge(o) {
    if (o.kind === 'killed') return '<span class="badge badge-ok">격추</span>';
    if (o.kind === 'leaked') return '<span class="badge badge-bad">' + esc(o.label) + '</span>';
    if (o.kind === 'open') return '<span class="badge badge-idle">미해결</span>';
    return '<span class="badge badge-idle">—</span>';
  }

  /** 동일 위협에 대한 As-Is↔To-Be 판정 변화 분류.
   *  CRN(공통난수) 설계상 두 모드의 위협 집단(ID·발생시각·축선)은 동일하므로 ID로 1:1 대응한다.
   *  판정이 갈린 항적만이 "C2 구조가 실제로 바꾼 결과"의 증거다. */
  function divergenceOf(oa, ob) {
    if (oa.kind === ob.kind) {
      return oa.kind === 'killed' ? { key: 'same-kill', label: '동일 (양측 격추)', cls: 'dv-same' }
        : oa.kind === 'leaked' ? (oa.code === ob.code
          ? { key: 'same-leak', label: '동일 (양측 실패)', cls: 'dv-same' }
          : { key: 'same-leak', label: '양측 실패 (사유 변화)', cls: 'dv-same' })
        : { key: 'same-open', label: '동일 (미해결)', cls: 'dv-same' };
    }
    if (ob.kind === 'killed') return { key: 'gain', label: '개선 (To-Be 격추)', cls: 'dv-gain' };
    if (oa.kind === 'killed') return { key: 'loss', label: '악화 (To-Be 실패)', cls: 'dv-loss' };
    return { key: 'other', label: '변화 (미해결 ↔ 실패)', cls: 'dv-other' };
  }

  /** 한쪽 모드의 단계 타임라인 <ul> — 없으면 사유를 명시(빈칸으로 두지 않는다) */
  function stageList(tr) {
    if (!tr) return '<ul class="alog-stages"><li class="bn-none">이 모드에 대응 항적 없음</li></ul>';
    if (!tr.stages || !tr.stages.length) return '<ul class="alog-stages"><li class="bn-none">기록된 단계 없음</li></ul>';
    return '<ul class="alog-stages">' + tr.stages.map(function (s) {
      return '<li><span class="alog-t">' + fmtTime(s.t) + '</span> ' +
        esc(KJ.simView.stageLabel(s.name)) + '</li>';
    }).join('') + '</ul>';
  }

  // 병렬 로그 필터 상태 (탭 재렌더에도 사용자의 선택 유지)
  var logFilter = 'diff';

  KJ.panels = {

    /**
     * [결심 비교] 탭 (ADR-075) — 4개 뷰를 순수 후처리로 렌더한다.
     * 데이터는 [분석] 탭과 같은 desPair 캐시를 쓴다(계측이 관측 전용이라 결과가 동일).
     */
    renderDecision: function (state) {
      var ctx = el('decision-context');
      if (!ctx) return;
      var self = this;
      var data = pipelineData(state, function () { self.renderDecision(state); });
      var sc = KJ.scenarioById(state.sc);
      ctx.innerHTML = '<b>' + esc(sc.name) + '</b> · ' + esc(state.dep) +
        ' · 강도 ×' + Number(state.x).toFixed(1) + ' · seed ' + state.seed +
        ' · ' + state.dur + '초 · 동일 seed paired DES(CRN)';
      if (!data) {
        var msg = desCache.error
          ? '<div class="bn-none">계산 실패: ' + esc(desCache.error) + '</div>'
          : '<div class="bn-none">두 체계 DES 계산 중…</div>';
        ['decision-gauges', 'decision-distributions', 'decision-timeline', 'decision-popover']
          .forEach(function (id) { if (el(id)) el(id).innerHTML = msg; });
        if (el('decision-rule')) el('decision-rule').innerHTML = '';
        return;
      }
      // pipelineData는 mode:'asis'로 요청하므로 current=As-Is, other=To-Be로 고정된다.
      var dcA = data.a.c2Analysis && data.a.c2Analysis.decisionComparison;
      var dcB = data.b.c2Analysis && data.b.c2Analysis.decisionComparison;

      // ── 미측정 표시 규율: 판정은 런이 보고한 값에서 취한다 ──
      if (!dcA || !dcB || !dcA.available || !dcB.available) {
        var reason = (dcA && dcA.reason) || (dcB && dcB.reason) || '런이 계측 상태를 보고하지 않음';
        ['decision-gauges', 'decision-distributions', 'decision-timeline', 'decision-popover']
          .forEach(function (id) { if (el(id)) el(id).innerHTML = unmeasured(reason); });
        if (el('decision-rule')) el('decision-rule').innerHTML = '';
        return;
      }

      // ── ④ 게이지 ──
      var gA = dcA.gauges, gB = dcB.gauges;
      var gaugeHtml = '';
      if (dcA.windowMargin && dcB.windowMargin && gA.missRate && gB.missRate) {
        gaugeHtml += gaugeRow('교전창 놓침률 — 문이 닫히기 전에 결심했는가',
          gA.missRate.rate, gB.missRate.rate,
          'As-Is ' + gA.missRate.missed + '/' + gA.missRate.total +
          ' · To-Be ' + gB.missRate.missed + '/' + gB.missRate.total +
          ' (분모 = 교전창이 실제로 존재했던 위협. <b>결심조차 없던 위협을 놓침으로 셉니다</b> — ' +
          '결심에 도달한 위협만 보면 생존 편향이 생깁니다. ADR-074)', true);
      } else {
        gaugeHtml += unmeasured('windowMargin OFF — 교전창 놓침률');
      }
      if (dcA.shadowEval && dcB.shadowEval && gA.optimalRate && gB.optimalRate) {
        gaugeHtml += gaugeRow('전역 최적 일치율 — 최적 사수를 골랐는가',
          gA.optimalRate.rate, gB.optimalRate.rate,
          'As-Is ' + gA.optimalRate.optimal + '/' + gA.optimalRate.n +
          ' · To-Be ' + gB.optimalRate.optimal + '/' + gB.optimalRate.n +
          ' (분모 = 그림자 평가가 가능했던 결심. USFK 독립 축은 0이 아니라 미측정으로 제외 — ADR-036)',
          false);
      } else {
        gaugeHtml += unmeasured('shadowEval OFF — 전역 최적 일치율');
      }
      el('decision-gauges').innerHTML = gaugeHtml +
        '<div class="note">이 두 게이지가 <b>주장의 근거</b>입니다. 아래 타임라인·후보 명단은 ' +
        '단일 실행의 사례(삽화)이며 그 자체로 인과를 증명하지 않습니다. 30시드 집계 방향과 ' +
        '원인 귀속은 <code>docs/adr/ADR-074</code>에 기록돼 있습니다.</div>';

      // ── ③ 분포 ──
      var distHtml = '';
      if (dcA.windowMargin && dcB.windowMargin) {
        distHtml += '<h3>(가) 교전창 여유 분포 — 결심완료 시점의 남은 시간</h3>' +
          histogram(dcA.distributions.margin.values, dcB.distributions.margin.values, {
            fmt: function (v) { return Math.round(v) + 's'; },
            xLabel: '교전창 마감 − 결심완료 (초) · 0 미만 = 문이 닫힌 뒤 결심',
            shadeNegative: true,
            undecidedA: gA.missRate ? gA.missRate.undecided : 0,
            undecidedB: gB.missRate ? gB.missRate.undecided : 0,
            emptyText: '결심이 없어 여유 표본이 없습니다.'
          }) +
          '<div class="note">왼쪽 회색 통 = <b>미결심</b>(결심 자체가 없어 여유를 잴 수 없는 위협). ' +
          '0으로 접어 넣으면 "여유 0초"로 오독되므로 축 밖에 따로 세우며, ' +
          '<b>곡선과 축척이 분리돼 있습니다</b>(건수는 통 아래 숫자로 병기 — 높이끼리 비교하지 마십시오). ' +
          '⚠️ 곡선 부분은 <b>결심에 도달한 위협만</b>의 분포라 생존 편향이 있습니다 — ' +
          '결심은 실현가능 PIP가 있어야 성립하므로 구조적으로 음수가 거의 나오지 않습니다. ' +
          '체계 비교는 게이지(전수 분모)로 하십시오.</div>';
      } else {
        distHtml += unmeasured('windowMargin OFF — 교전창 여유 분포');
      }
      if (dcA.shadowEval && dcB.shadowEval) {
        distHtml += '<h3>(나) 선택 손실 분포 — 전역 최적 대비 점수 차</h3>' +
          histogram(dcA.distributions.regret.values, dcB.distributions.regret.values, {
            fmt: function (v) { return v.toExponential(1); },
            xLabel: '선택 손실 regret (WTA 점수 단위) · 0 = 전역 최적',
            emptyText: '그림자 평가 표본이 없습니다.'
          }) +
          '<div class="note">가로축은 WTA 목적함수 점수 단위이며 격추 건수로 환산되지 않습니다. ' +
          '그래서 크기가 아니라 <b>0에 몰린 비율</b>(위 게이지)로 읽습니다.</div>';
      } else {
        distHtml += unmeasured('shadowEval OFF — 선택 손실 분포');
      }
      el('decision-distributions').innerHTML =
        '<div class="dc-legend"><span class="dc-key asis"></span>As-Is 분절형' +
        '<span class="dc-key tobe"></span>To-Be 통합형</div>' + distHtml;

      // ── ① 페어드 타임라인 ──
      var byA = {}, byB = {};
      dcA.threats.forEach(function (r) { byA[r.threatId] = r; });
      dcB.threats.forEach(function (r) { byB[r.threatId] = r; });
      var picked = pickThreats(byA, byB, 12);
      el('decision-rule').innerHTML =
        '<b>표시 사례 선정 규칙</b> — 임의 선택이 아닙니다. ' +
        '① <b>As-Is 미격추 · To-Be 격추</b>로 결과가 갈린 위협을 먼저 놓고(이번 실행 ' +
        picked.primary.length + '건), ② 나머지는 두 체계의 교전창 여유 차가 큰 순으로, ' +
        '동순위는 threatId 오름차순(결정론)으로 최대 12건을 표시합니다. ' +
        '<b>사례는 삽화이며 주장의 근거는 위 ③④ 분포·게이지입니다.</b> ' +
        'CRN(공통난수)으로 위/아래는 같은 seed의 <b>같은 위협</b>이며 도착시각도 동일합니다.';
      el('decision-timeline').innerHTML = picked.list.length
        ? picked.list.map(function (id, i) {
            var a = byA[id], b = byB[id];
            var isSplit = picked.primary.indexOf(id) !== -1;
            return '<div class="dc-tl-group' + (isSplit ? ' split' : '') +
              (decisionSel.threatId === id ? ' sel' : '') + '" data-threat="' + esc(id) + '">' +
              '<div class="dc-tl-key">' + esc(id) +
              '<span class="dc-tl-axis">' + esc(a.axis || '') + ' · 생성 ' + secText(a.spawnT) + '</span>' +
              (isSplit ? '<span class="dc-tl-tag">결과가 갈림</span>' : '') + '</div>' +
              '<div class="dc-tl-lane"><span class="dc-tl-side asis">As-Is</span>' +
              timelineBar(a, 'asis') + '</div>' +
              '<div class="dc-tl-lane"><span class="dc-tl-side tobe">To-Be</span>' +
              timelineBar(b, 'tobe') + '</div></div>';
          }).join('')
        : '<div class="bn-none">두 체계에 공통으로 기록된 위협이 없습니다.</div>';

      // ── ② 후보 명단 팝오버 (막대 클릭) ──
      if (!decisionSel.threatId || !byA[decisionSel.threatId]) {
        decisionSel.threatId = picked.list[0] || null;
      }
      el('decision-popover').innerHTML =
        candidatePanel(decisionSel.threatId, byA[decisionSel.threatId], byB[decisionSel.threatId]);
      Array.prototype.forEach.call(
        el('decision-timeline').querySelectorAll('.dc-tl-group'), function (node) {
          node.addEventListener('click', function () {
            decisionSel.threatId = node.dataset.threat;
            self.renderDecision(state);
            var card = el('decision-popover-card');
            if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        });
    },

    /** 근거자료 탭: 제약 어서션 + 파라미터 문서 링크 */
    renderData: function (state) {
      var checks = KJ.runConstraintChecks();
      el('constraint-list').innerHTML = checks.map(function (c) {
        return '<li class="' + (c.pass ? 'chk-pass' : 'chk-fail') + '">' +
          (c.pass ? '✅' : '❌') + ' <b>[' + c.id + '] ' + esc(c.name) + '</b>' +
          '<div class="chk-detail">' + esc(c.detail) + '</div></li>';
      }).join('');

      var catalog = catalogFor(state || { dep: 'legacy' });
      var inventoryNodes = catalog ? catalog.nodes : KJ.NODES;
      var nodeRows = inventoryNodes.map(function (n) {
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
