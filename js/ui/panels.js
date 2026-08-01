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

  // ══════════════ [분석] 탭 — 같은 항적이 두 체계에서 얼마나 걸렸나 ══════════════
  // 요구는 하나다: **시간이 얼마나 걸렸고, 어디서 벌어졌는지 수치로 보인다.**
  // 그래서 화면은 세 층뿐이다 — 총 소요시간 한 줄 → 단계별 차이 표 → 항적별 병렬 로그.
  // 종전 [결심 비교] 탭의 게이지·분포·후보 팝오버는 읽는 데 사전지식이 필요해 걷어냈다.

  /** 항적 단계 중 관문 하나의 시각(초). 없으면 null. */
  function gateT(tr, kind) {
    if (!tr || !tr.stages) return null;
    for (var i = 0; i < tr.stages.length; i++) {
      var n = tr.stages[i].name;
      var hit =
        kind === 'spawn' ? n === '생성' :
        kind === 'detect' ? n === '탐지' :
        kind === 'c2' ? n.indexOf('책임C2:') === 0 :
        kind === 'ident' ? n.indexOf('식별확정:') === 0 :
        kind === 'fire' ? (n.indexOf('발사:') === 0 || n.indexOf('자위권발사:') === 0) :
        kind === 'end' ? (n.indexOf('BDA:') === 0 || n.indexOf('누수:') === 0) : false;
      if (hit) return tr.stages[i].t;
    }
    return null;
  }

  // 관문 사이 구간 — 9단계 파이프라인을 사람이 읽는 다섯 토막으로 접었다.
  var GATES = [
    { key: 'detect', from: 'spawn', to: 'detect', label: '① 침투 → 탐지', why: '레이더가 볼 때까지' },
    { key: 'assign', from: 'detect', to: 'c2', label: '② 탐지 → 담당 지휘소 지정', why: '누가 맡을지 정할 때까지' },
    { key: 'ident', from: 'c2', to: 'ident', label: '③ 지정 → 식별 확정', why: '무엇인지 확인할 때까지' },
    { key: 'fire', from: 'ident', to: 'fire', label: '④ 식별 → 발사', why: '쏘기로 결심하고 쏠 때까지' },
    { key: 'total', from: 'spawn', to: 'fire', label: '⑤ 침투 → 발사 (합계)', why: '들어와서 요격탄이 나갈 때까지', total: true }
  ];

  /**
   * 두 모드의 항적을 ID로 짝지어 구간별 평균 소요시간과 차이를 낸다.
   *
   * ⚠️ **전 구간을 같은 항적 집합(코호트)으로 계산한다.** 구간마다 "그 구간을 통과한
   * 항적"만 따로 세면 표본이 달라져 **부분의 합이 합계와 어긋난다**(실측: 구간 합 −9.8초
   * vs 합계 −21.9초). 그러면 "어디서 벌어졌나"를 이 표로 읽을 수 없다 — 각 줄이 서로 다른
   * 위협들을 말하기 때문이다. 그래서 **양 체계에서 전 관문을 통과한 항적만** 코호트로 잡고,
   * 그 집합 하나로 모든 줄을 낸다. 대가는 표본 축소이며, 제외 건수를 화면에 공시한다.
   */
  function gateStats(ta, tb) {
    var byB = {};
    (tb || []).forEach(function (t) { byB[t.id] = t; });
    var KEYS = ['spawn', 'detect', 'c2', 'ident', 'fire'];
    var cohort = [];
    var paired = 0;
    (ta || []).forEach(function (a) {
      var b = byB[a.id];
      if (!b) return;
      paired++;
      var ga = {}, gb = {};
      for (var i = 0; i < KEYS.length; i++) {
        ga[KEYS[i]] = gateT(a, KEYS[i]);
        gb[KEYS[i]] = gateT(b, KEYS[i]);
        if (ga[KEYS[i]] == null || gb[KEYS[i]] == null) return;   // 한 관문이라도 빠지면 제외
      }
      cohort.push({ a: ga, b: gb });
    });
    var n = cohort.length;
    var rows = GATES.map(function (g) {
      if (!n) return { g: g, n: 0, a: null, b: null, d: null };
      var sa = 0, sb = 0;
      cohort.forEach(function (c) {
        sa += c.a[g.to] - c.a[g.from];
        sb += c.b[g.to] - c.b[g.from];
      });
      return { g: g, n: n, a: sa / n, b: sb / n, d: sb / n - sa / n };
    });
    rows.cohort = n;
    rows.paired = paired;
    return rows;
  }

  function secTxt(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '초'; }
  function deltaTxt(v) {
    if (v == null) return '—';
    var r = Math.round(v * 10) / 10;
    if (Math.abs(r) < 0.05) return '<span class="an-same">변화 없음</span>';
    return r < 0 ? '<b class="an-fast">' + r.toFixed(1) + '초 (빨라짐)</b>'
                 : '<b class="an-slow">+' + r.toFixed(1) + '초 (느려짐)</b>';
  }

  /** 구간별 막대 — 두 체계를 같은 척도로 그려 길이 차이가 곧 시간 차이가 되게 한다. */
  function gateBar(a, b, max) {
    if (a == null || b == null || !max) return '';
    var wa = Math.max(1, a / max * 100), wb = Math.max(1, b / max * 100);
    return '<div class="an-bars">' +
      '<div class="an-bar an-bar-a" style="width:' + wa.toFixed(1) + '%"><span>As-Is</span></div>' +
      '<div class="an-bar an-bar-b" style="width:' + wb.toFixed(1) + '%"><span>To-Be</span></div>' +
      '</div>';
  }

  /**
   * [C2 구조] 항적 재생 — 좌우 두 계층도를 **하나의 시계**로 몬다.
   * 노드·간선은 `data-t`(최초 관여 시각)를 갖고, 재생헤드가 그 시각을 지나면 켜진다.
   * rAF는 백그라운드 탭에서 멈추므로 타이머 안전장치로 반드시 끝을 맺는다.
   */
  function bindStructurePlay(box, span) {
    var btn = el('sv-play');
    if (!btn || !span) return;
    var cols = box.querySelector('.sv-cols');
    var lit = cols.querySelectorAll('.sv-node.sv-act, .sv-edge.sv-flow');
    var clock = el('sv-clock');
    var raf = null, guard = null;
    function paint(t) {
      Array.prototype.forEach.call(lit, function (n) {
        n.classList.toggle('sv-on', parseFloat(n.getAttribute('data-t')) <= t);
      });
      if (clock) clock.textContent = fmtTime(t);
    }
    function finish() {
      if (raf) cancelAnimationFrame(raf);
      if (guard) clearTimeout(guard);
      raf = guard = null;
      cols.classList.remove('sv-playing');
      paint(span.t1);
      btn.disabled = false;
    }
    btn.addEventListener('click', function () {
      if (raf) return;
      var DUR = 3000, t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      cols.classList.add('sv-playing');
      btn.disabled = true;
      paint(span.t0 - 1);
      guard = setTimeout(finish, DUR + 1200);
      (function step() {
        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        var p = Math.min(1, (now - t0) / DUR);
        paint(span.t0 + (span.t1 - span.t0) * p);
        if (p < 1) raf = requestAnimationFrame(step); else finish();
      })();
    });
  }

  // ══════════════ C2 계통 세로 계층 레이아웃 (공용) ══════════════
  // ⚠️ [C2 구조] 탭과 [분석] 탭의 **항적별 다이어그램이 같은 그림이어야** 한다.
  //    두 벌로 두면 계층 정의가 갈라져 같은 항적이 화면마다 다르게 보인다.
  //    그래서 레이아웃을 여기 한 곳에 두고 양쪽이 호출한다(sim-view는 KJ.panels.c2Column).

  // ── 계층 정의 (사용자 제공 아키텍처 반영) ──
  // 핵심: To-Be는 상위 작전사와 각 C2 체계 **사이에 「합동방공C2」 조율층이 끼어든다.**
  // 모델에서 그 조율층에 해당하는 노드가 IAOC(통합공중작전통제소)·EOC(교전운영센터)이며,
  // 둘 다 `modes:["tobe"]` — As-Is에는 존재하지 않는다. 그래서 As-Is 그림에서는 이 띠가
  // 통째로 비고, **그 빈 칸이 곧 이 탭이 말하려는 구조 차이**다.
  var COORD = { IAOC: 1, EOC: 1 };               // 합동방공C2 조율층
  var SYSTEM = { KAMD_OPS: 1, MCRC: 1, ARMY_LOCAL_AD: 1 };  // C2 체계층
  function tierOf(n) {
    if (n.category === 'sensor') return 4;
    if (n.category === 'shooter') return 5;
    if (COORD[n.typeId]) return 1;
    if (SYSTEM[n.typeId]) return 2;
    if (n.typeId === 'ICC') return 3;
    return 3;                                    // ECS·기타 포대급 C2도 교전통제층
  }
  // ⚠️ 상위 작전사(공작사·지작사·해작사·수방사)와 해상 계통(KNTDS·함정)은
  //    **모델 범위 밖**이다 — 디스클레이머대로 이 모델은 지상배치 방공체계 C2에 한정하며
  //    요격기·해상 자산을 포함하지 않는다(ADR-060). 아키텍처 맥락으로만 점선 표시하고,
  //    시뮬레이션이 그것을 계산하는 것처럼 보이지 않게 링크는 긋지 않는다.
  var OUT_OF_SCOPE = ['공작사', '지작사', '해작사', '수방사'];
  var TIERS = [
    { label: '상위 작전사', hint: '모델 범위 밖 — 아키텍처 맥락', ghost: true },
    { label: '합동방공 C2 (조율층)', hint: 'To-Be에서 신설 — IAOC · EOC', band: true },
    { label: 'C2 체계', hint: 'MCRC · KAMDOC · 방공C2A(군단·수방사 AOC)' },
    { label: '교전통제 (ICC · ECS)', hint: '권역·포대 단위 사격통제' },
    { label: '레이더', hint: '공군 레이더 · 그린파인 · 국지방공' },
    { label: '요격부대', hint: '발사' }
  ];

  // 유형 표시명 — 카탈로그 이름은 개체명(ICC W1)이라 묶음 라벨로는 유형명이 낫다.
  var TYPE_LABEL = {
    KAMD_OPS: 'KAMDOC', MCRC: 'MCRC', IAOC: '통합공중작전통제소', EOC: '교전운영센터',
    ARMY_LOCAL_AD: '군단 방공상황실', ICC: 'ICC 교전통제소', ECS: 'ECS 포대지휘소',
    FPS117: 'FPS-117', GREEN_PINE_B: 'Green Pine', LSAM_MFR: 'L-SAM MFR',
    MSAM_MFR: 'M-SAM MFR', PATRIOT_RADAR: 'Patriot 레이더', TPS880K: 'TPS-880K',
    BIHO: '비호', CHEONGUNG2: '천궁-II', CHUNMA: '천마', LSAM: 'L-SAM', PAC3: 'PAC-3'
  };
  function typeLabel(t) { return TYPE_LABEL[t] || t; }

  /**
   * 한 모드의 세로 계층 SVG.
   *  · act 없음 → **집약 보기**: 계층×유형으로 묶어 16~18개 묶음만 그린다.
   *    개별 노드 64개를 다 찍으면 같은 유형의 반복이 화면을 덮어 구조가 안 보인다.
   *    묶음 반지름 = 개수, 간선 굵기 = 묶음 사이 링크 수.
   *  · act 있음 → **개별 보기**: 그 항적에 관여한 노드만 이름까지 펼친다(보통 8~10개).
   */
  function c2Column(cat, mode, act) {
    var links = KJ.linksInMode ? KJ.linksInMode(mode, cat) : cat.links;
    // ⚠️ 노드도 **모드로 걸러야 한다.** 통합공중작전통제소(IAOC)·교전운영센터(EOC)는
    //    모델상 `modes:["tobe"]` — To-Be에만 존재하는 노드다. 카탈로그 전체를 그리면
    //    As-Is 그림에 없어야 할 통합 지휘소가 떠서, 이 탭이 보여주려는 구조 차이를
    //    정반대로 오도한다(실제로 그렇게 나왔다).
    var nodes = KJ.nodesInMode ? KJ.nodesInMode(mode, cat) : cat.nodes;
    var present = {};
    nodes.forEach(function (n) { present[n.id] = n; });

    function keyOf(id) {
      var n = present[id];
      if (!act) return id;
      if (act[id] != null) return id;
      return (n && n.typeId && act[n.typeId] != null) ? n.typeId : id;
    }
    var detail = !!act;
    // 개별 보기에서는 관여 노드만 남긴다(그래야 이름이 들어간다).
    var shownNodes = detail
      ? nodes.filter(function (n) { return act[keyOf(n.id)] != null; })
      : nodes;

    // 교전명령은 상급 C2 → **ECS** → 포대로 간다. 항적은 `사수선정·표적할당:IAOC→BATTERY_…`
    // 처럼 양 끝만 적어 중간 ECS 홉이 빠지고, 그러면 사수가 선 없이 떠 버린다.
    // 카탈로그에 1홉 경로가 실재할 때만 그 중간 노드를 **경로상 노드**로 보완한다 —
    // 연결을 지어내는 게 아니라 모델이 가진 경로를 밝히는 것이며, 표기로 구분한다.
    if (detail) {
      var byId = {};
      nodes.forEach(function (n) { byId[n.id] = n; });
      var adj = {};
      (links || []).forEach(function (l) { (adj[l.from] = adj[l.from] || {})[l.to] = 1; });
      var have = {};
      shownNodes.forEach(function (n) { have[n.id] = 1; });
      var bridges = [];
      shownNodes.filter(function (n) { return n.category === 'shooter'; }).forEach(function (sh) {
        var src = shownNodes.find(function (n) {
          return n.category === 'c2' && adj[n.id] && !adj[n.id][sh.id];
        });
        if (!src) return;
        var mid = Object.keys(adj[src.id] || {}).find(function (m) {
          return adj[m] && adj[m][sh.id] && !have[m] && byId[m];
        });
        if (!mid || have[mid]) return;
        have[mid] = 1;
        var bn = byId[mid];
        bridges.push({ id: bn.id, name: bn.name, category: bn.category, typeId: bn.typeId,
          modes: bn.modes, _bridge: true });
      });
      shownNodes = shownNodes.concat(bridges);
    }

    // 묶음 단위 결정: 집약이면 계층|유형, 개별이면 노드 자체.
    function unitOf(n) { return detail ? n.id : (tierOf(n) + '|' + n.typeId); }
    var units = {}, order = [];
    shownNodes.forEach(function (n) {
      var u = unitOf(n);
      if (!units[u]) {
        units[u] = { key: u, tier: tierOf(n), typeId: n.typeId, category: n.category,
          n: 0, ids: [], t: null, bridge: !!n._bridge,
          label: detail ? (n.name || n.id) : typeLabel(n.typeId) };
        order.push(u);
      }
      units[u].n++;
      units[u].ids.push(n.id);
      if (detail) {
        var at = act[keyOf(n.id)];
        if (at != null && (units[u].t == null || at < units[u].t)) units[u].t = at;
      }
    });
    var idToUnit = {};
    Object.keys(units).forEach(function (u) {
      units[u].ids.forEach(function (id) { idToUnit[id] = u; });
    });

    var rows = [[], [], [], [], [], []];
    order.forEach(function (u) { rows[units[u].tier].push(units[u]); });
    rows.forEach(function (r) { r.sort(function (x, y) { return x.label < y.label ? -1 : 1; }); });

    var W = 470, PAD_X = 10, TOP = 16, tierH = 78;
    var H = TOP + TIERS.length * tierH;
    var pos = {};
    rows.forEach(function (list, ti) {
      var y = TOP + ti * tierH + 42;
      var step = (W - PAD_X * 2) / Math.max(1, list.length);
      // 한 계층에 4개 이상이면 라벨이 겹친다 — 위아래로 엇갈려 놓는다(점 위치는 그대로).
      var stagger = list.length >= 4;
      list.forEach(function (u, i) {
        pos[u.key] = { x: PAD_X + step * (i + 0.5), y: y,
          lab: stagger ? (i % 2 ? 1 : 0) : 0 };
      });
    });

    // 묶음 사이 링크 집계 — 개별 링크를 다 긋지 않고 굵기로 표현한다.
    var KIND = { report: '#3d8bd9', coord: '#a06ed2', command: '#3d8b40', status: '#6b7a8d' };
    // ⚠️ 묶음 키에 이미 '|'가 들어 있다('0|KAMD_OPS'). 같은 구분자로 이어 붙여 문자열을
    //    다시 쪼개면 파싱이 깨져 **간선이 한 줄도 안 그려진다**(실제로 그랬다).
    //    그래서 키로 파싱하지 않고 객체에 양 끝을 그대로 담는다.
    var agg = {}, shownLinks = 0;
    (links || []).forEach(function (l) {
      var ua = idToUnit[l.from], ub = idToUnit[l.to];
      if (!ua || !ub || ua === ub) return;
      shownLinks++;
      var kind = l.kind || 'coord';
      var k = ua + '\u0001' + ub + '\u0001' + kind;
      if (!agg[k]) agg[k] = { from: ua, to: ub, kind: kind, n: 0 };
      agg[k].n++;
    });
    var edges = Object.keys(agg).map(function (k) {
      var e = agg[k], kind = e.kind, ends = [e.from, e.to];
      var p = pos[ends[0]], q = pos[ends[1]];
      if (!p || !q) return '';
      var cnt = e.n;
      var w = detail ? 1.2 : Math.min(4, 0.6 + Math.log(cnt + 1) * 1.1);
      var ta = detail && units[ends[0]] ? units[ends[0]].t : null;
      var tb = detail && units[ends[1]] ? units[ends[1]].t : null;
      var lit = (ta != null && tb != null) ? Math.max(ta, tb) : null;
      return '<line class="sv-edge' + (lit != null ? ' sv-flow' : '') + '"' +
        (lit != null ? ' data-t="' + lit + '"' : '') +
        ' x1="' + p.x.toFixed(1) + '" y1="' + p.y + '" x2="' + q.x.toFixed(1) + '" y2="' + q.y +
        '" stroke="' + (KIND[kind] || '#6b7a8d') + '" stroke-width="' + w.toFixed(1) + '"' +
        ' opacity="' + (detail ? 0.5 : 0.55) + '"' +
        (kind === 'coord' ? ' stroke-dasharray="3 3"' : '') + '>' +
        '<title>' + esc((units[ends[0]] || {}).label + ' → ' + (units[ends[1]] || {}).label +
          ' · ' + kind + ' ' + cnt + '개') + '</title></line>';
    }).join('');

    var dots = order.map(function (u) {
      var g = units[u], p = pos[u];
      if (!p) return '';
      if (g.tier === 1) return '';             // 조율층은 가로 띠로 대신 그린다
      var r = detail ? 5 : Math.min(11, 4 + Math.sqrt(g.n) * 2.0);
      return '<g class="sv-node sv-' + esc(g.category) + (g.tier === 0 ? ' sv-upper' : '') +
        (g.bridge ? ' sv-bridge' : '') +
        (g.t != null ? ' sv-act' : '') + '"' + (g.t != null ? ' data-t="' + g.t + '"' : '') + '>' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y + '" r="' + r.toFixed(1) + '"></circle>' +
        (!detail && g.n > 1 ? '<text class="sv-cnt" x="' + p.x.toFixed(1) + '" y="' + (p.y + 2.4) +
          '" text-anchor="middle">' + g.n + '</text>' : '') +
        '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + r + 8 + (p.lab ? 8 : 0)) +
        '" text-anchor="middle">' + esc(g.label) + '</text>' +
        '<title>' + esc(g.label + ' · ' + g.n + '개' +
          (g.bridge ? ' · 경로상 노드(항적 기록에는 없음)' : '') +
          (g.t != null ? ' · 관여 ' + fmtTime(g.t) : '')) + '</title></g>';
    }).join('');

    var bands = TIERS.map(function (T, ti) {
      var y = TOP + ti * tierH;
      var g = '<g class="sv-band"><rect x="0" y="' + y + '" width="' + W + '" height="' + tierH +
        '" fill="' + (ti % 2 ? '#111823' : '#0d1117') + '"></rect>' +
        '<text class="sv-tier" x="6" y="' + (y + 12) + '">' + esc(T.label) +
        ' <tspan class="sv-hint">' + esc(T.hint) + '</tspan></text>';
      if (T.ghost) {
        // 모델 범위 밖 — 점선 상자로 맥락만 보여주고 링크는 긋지 않는다.
        var bw = (W - 20) / OUT_OF_SCOPE.length;
        g += OUT_OF_SCOPE.map(function (name, i) {
          var bx = 10 + bw * i + 4;
          return '<g class="sv-ghost"><rect x="' + bx.toFixed(1) + '" y="' + (y + 26) +
            '" width="' + (bw - 8).toFixed(1) + '" height="22" rx="3"></rect>' +
            '<text x="' + (bx + (bw - 8) / 2).toFixed(1) + '" y="' + (y + 40) +
            '" text-anchor="middle">' + esc(name) + '</text></g>';
        }).join('');
      }
      if (T.band) {
        // 조율층 — 있으면 가로 띠, 없으면 그 사실을 글자로 남긴다(빈 칸이 곧 차이다).
        var coord = (rows[1] || []);
        if (coord.length) {
          g += '<rect class="sv-coordbar" x="10" y="' + (y + 28) + '" width="' + (W - 20) +
            '" height="20" rx="4"></rect>' +
            '<text class="sv-coordtxt" x="' + (W / 2) + '" y="' + (y + 42) +
            '" text-anchor="middle">합동방공 C2 — ' +
            esc(coord.map(function (u) { return u.label; }).join(' · ')) + '</text>';
        } else {
          g += '<text class="sv-none" x="' + (W / 2) + '" y="' + (y + 42) +
            '" text-anchor="middle">조율층 없음 — 각 C2 체계가 작전사로 직접 올라간다</text>';
        }
      }
      return g + '</g>';
    }).join('');

    return { svg: '<svg class="sv-svg" viewBox="0 0 ' + W + ' ' + H + '">' +
      bands + edges + dots + '</svg>',
      links: shownLinks, nodes: nodes.length, units: order.length, detail: detail };
  }


  KJ.panels = {
    /** [분석] 탭의 항적별 다이어그램이 같은 레이아웃을 쓴다(중복 구현 금지). */
    c2Column: c2Column,

    /**
     * [분석] 탭 — 같은 항적이 두 체계에서 얼마나 걸렸고, 어디서 벌어졌나.
     * ① 합계 한 줄 → ② 단계별 차이 표 → ③ 항적 로그 병렬 비교(결과 모달과 같은 렌더러).
     */
    renderAnalysis: function (state) {
      var ctx = el('analysis-context');
      if (!ctx) return;
      var self = this;
      var data = pipelineData(state, function () { self.renderAnalysis(state); });
      var sc = KJ.scenarioById(state.sc);
      ctx.innerHTML = '<b>' + esc(sc.name) + '</b> · ' + esc(state.dep) +
        ' · 강도 ×' + Number(state.x).toFixed(1) + ' · seed ' + state.seed +
        ' · ' + state.dur + '초 · 동일 seed 짝지음(CRN — 두 체계가 같은 위협을 마주함)';
      if (!data) {
        var msg = desCache.error
          ? '<div class="bn-none">계산 실패: ' + esc(desCache.error) + '</div>'
          : '<div class="note">⏳ 두 체계 DES 계산 중…</div>';
        ['analysis-headline', 'analysis-gates', 'analysis-threat-log']
          .forEach(function (id) { if (el(id)) el(id).innerHTML = msg; });
        return;
      }
      // pipelineData는 mode:'asis'로 요청하므로 a=As-Is, b=To-Be로 고정된다.
      var ta = data.a.threatTraces || [], tb = data.b.threatTraces || [];
      var rows = gateStats(ta, tb);
      var total = rows[rows.length - 1];

      // ① 합계 — 이 화면에서 제일 먼저 읽혀야 하는 한 줄.
      el('analysis-headline').innerHTML = total.n
        ? '<div class="an-head">' +
          '<div class="an-head-cell"><div class="an-head-val">' + secTxt(total.a) + '</div>' +
          '<div class="an-head-lab">As-Is 분절형</div></div>' +
          '<div class="an-head-op">→</div>' +
          '<div class="an-head-cell"><div class="an-head-val">' + secTxt(total.b) + '</div>' +
          '<div class="an-head-lab">To-Be 통합형</div></div>' +
          '<div class="an-head-cell an-head-delta"><div class="an-head-val">' +
          deltaTxt(total.d) + '</div><div class="an-head-lab">차이 (항적 ' + total.n + '건 평균)</div></div>' +
          '</div>' +
          '<div class="note">침투부터 요격탄이 나갈 때까지의 평균 시간입니다. ' +
          '<b>양 체계에서 전 단계를 모두 통과한 항적 ' + total.n + '건</b>만 셉니다' +
          (rows.paired ? ' (짝지어진 항적 ' + rows.paired + '건 중 ' + (rows.paired - total.n) +
            '건은 한쪽이라도 발사까지 가지 못해 제외)' : '') + '. ' +
          '한쪽만 도달한 항적을 섞으면 "빨라졌다"가 아니라 "못 간 것을 뺐다"가 되어 ' +
          '수치가 거짓말을 합니다.</div>'
        : '<div class="bn-none">두 체계가 모두 발사까지 도달한 항적이 없어 시간 비교를 낼 수 없습니다.</div>';

      // ② 구간별 — 어디서 벌어졌는지 수치로.
      var maxV = 0;
      rows.forEach(function (r) {
        if (r.g.total) return;
        if (r.a != null) maxV = Math.max(maxV, r.a, r.b);
      });
      el('analysis-gates').innerHTML =
        '<table class="an-table"><thead><tr>' +
        '<th>구간</th><th class="num">As-Is</th><th class="num">To-Be</th><th>차이</th><th>비교</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr' + (r.g.total ? ' class="an-total"' : '') + '>' +
            '<td>' + esc(r.g.label) + '<i class="an-why">' + esc(r.g.why) + '</i></td>' +
            '<td class="num">' + secTxt(r.a) + '</td>' +
            '<td class="num">' + secTxt(r.b) + '</td>' +
            '<td>' + deltaTxt(r.d) + '</td>' +
            '<td class="an-barcell">' + (r.g.total ? '' : gateBar(r.a, r.b, maxV)) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>' +
        '<div class="note">전 구간을 <b>같은 항적 ' + (total.n || 0) + '건</b>으로 계산했습니다 — ' +
        '그래서 <b>구간 소요시간의 합이 합계와 정확히 일치</b>합니다. 구간마다 표본을 달리 잡으면 ' +
        '각 줄이 서로 다른 위협을 말하게 되어 "어디서 벌어졌나"를 이 표로 읽을 수 없습니다.</div>';

      // ③ 항적 로그 병렬 비교 — 결과 모달과 **같은 렌더러**를 재사용한다.
      if (KJ.simView && KJ.simView.renderThreatCompare) {
        KJ.simView.renderThreatCompare(el('analysis-threat-log'), {
          asis: data.a, tobe: data.b,
          audits: { asis: {}, tobe: {} },   // 감사 이벤트는 시뮬레이션 탭 실행에만 실린다
          catalog: catalogFor(state)
        });
      }
    },

    /**
     * [C2 구조] 탭 — As-Is ↔ To-Be를 **세로 계층**으로 나란히 놓는다.
     *
     * 계층은 사용자가 제시한 아키텍처를 따른다:
     *   상위 작전사 → **합동방공 C2(조율층)** → C2 체계 → 교전통제(ICC·ECS) → 레이더·요격부대
     * 하위 네 계층의 연결은 링크 데이터에서 나온 것이다(실측 흐름):
     *   센서 →(report) ECS·C4I / ECS →(coord) ICC →(coord) C4I / ECS →(command) 사수
     * To-Be의 핵심 차이인 조율층은 IAOC·EOC이며 As-Is에는 그 노드 자체가 없다.
     *
     * 항적을 고르면 탐지~요격까지 노드가 **시각 순서대로 점등**된다. 좌우가 같은 시계를
     * 공유하므로 어느 쪽이 먼저 끝나는지가 그대로 보인다.
     * ⚠️ 간선은 카탈로그에 실제로 있는 링크만 그린다(없는 연결을 지어내지 않는다).
     */
    renderStructure: function (state) {
      var box = el('structure-diagram');
      if (!box) return;
      var self = this;
      var cat = catalogFor(state);
      if (!cat) { box.innerHTML = '<div class="bn-none">배치 카탈로그를 불러오지 못했습니다.</div>'; return; }
      var data = pipelineData(state, function () { self.renderStructure(state); });

      // (레이아웃은 모듈 최상위 c2Column으로 옮겼다 — 두 탭이 공유한다)
      var resolver = KJ.simView && KJ.simView.buildNodeResolver
        ? KJ.simView.buildNodeResolver(cat) : null;

      // ── 항적 선택 목록 (판정이 갈린 항적을 위로) ──
      var options = '', actA = null, actB = null, span = null;
      var sel = box.getAttribute('data-threat') || '';
      if (data && resolver) {
        var ta = data.a.threatTraces || [], tb = data.b.threatTraces || [];
        var byB = {};
        tb.forEach(function (t) { byB[t.id] = t; });
        var cands = ta.filter(function (t) { return byB[t.id]; }).map(function (t) {
          var o = byB[t.id];
          return { id: t.id, a: t, b: o, diff: t.outcome !== o.outcome };
        });
        cands.sort(function (x, y) { return (y.diff ? 1 : 0) - (x.diff ? 1 : 0); });
        options = cands.slice(0, 60).map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' +
            esc(c.id) + (c.diff ? ' — 판정이 갈림' : '') + '</option>';
        }).join('');
        var pick = cands.find(function (c) { return c.id === sel; });
        if (pick) {
          var mk = function (tr) {
            var m = {}, lo = Infinity, hi = -Infinity;
            (tr.stages || []).forEach(function (s) {
              resolver.keysInStage(s.name).forEach(function (k) {
                if (m[k] == null || s.t < m[k]) m[k] = s.t;
              });
              if (s.t < lo) lo = s.t;
              if (s.t > hi) hi = s.t;
            });
            return { act: m, lo: lo, hi: hi };
          };
          var A = mk(pick.a), B = mk(pick.b);
          actA = A.act; actB = B.act;
          span = { t0: Math.min(A.lo, B.lo), t1: Math.max(A.hi, B.hi) };
        }
      }

      var colA = c2Column(cat, 'asis', actA), colB = c2Column(cat, 'tobe', actB);
      box.innerHTML =
        '<div class="sv-controls">' +
        '<label>항적 <select id="sv-threat"><option value="">— 정적 구조만 보기 —</option>' +
        options + '</select></label>' +
        (span ? '<button type="button" id="sv-play">▶ 탐지→요격 재생</button>' +
          '<span id="sv-clock" class="sv-clock">' + fmtTime(span.t0) + '</span>' : '') +
        '</div>' +
        (data ? '' : '<div class="note">⏳ 두 체계 DES 계산 중…</div>') +
        '<div class="sv-cols" data-t0="' + (span ? span.t0 : 0) + '" data-t1="' + (span ? span.t1 : 1) + '">' +
        '<div class="sv-col"><h4>As-Is 분절형 <span>' +
        (colA.detail ? '관여 노드 ' + colA.units + '개' : '노드 ' + colA.nodes + '개 → ' + colA.units + '묶음 · 링크 ' + colA.links) +
        '</span></h4>' + colA.svg + '</div>' +
        '<div class="sv-col"><h4>To-Be 통합형 <span>' +
        (colB.detail ? '관여 노드 ' + colB.units + '개' : '노드 ' + colB.nodes + '개 → ' + colB.units + '묶음 · 링크 ' + colB.links) +
        '</span></h4>' + colB.svg + '</div>' +
        '</div>' +
        '<div class="sv-legend"><i style="background:#3d8bd9"></i>항적보고' +
        '<i style="background:#a06ed2"></i>협조<i style="background:#3d8b40"></i>교전명령' +
        '<i style="background:#6b7a8d"></i>현황</div>' +
        '<div class="note">아래 네 계층(C2 체계·교전통제·레이더·요격부대)의 연결은 링크 데이터에서 나온 것입니다 — ' +
        '센서가 ECS·상급에 보고하고, ' +
        'ECS가 ICC를 거쳐 상급과 협조하며, 교전명령은 ECS에서 포대로 내려갑니다. ' +
        (colA.detail
          ? '<b>고른 항적에 실제로 관여한 노드만</b> 펼쳐 놓았습니다. 재생을 누르면 두 체계가 ' +
            '같은 시계로 점등됩니다 — 어느 쪽이 먼저 요격까지 가는지 그대로 보입니다.'
          : '같은 유형은 <b>하나로 묶어</b> 그렸습니다(원 안 숫자 = 개수, 선 굵기 = 링크 수). ' +
            '개별 노드 ' + colA.nodes + '개를 다 찍으면 같은 것의 반복이 화면을 덮어 구조가 안 보입니다 — ' +
            '개별 노드는 위에서 <b>항적을 고르면</b> 관여한 것만 펼쳐집니다.') +
        ' <b>To-Be에만 존재하는 노드</b>가 있습니다 — 통합공중작전통제소(IAOC)·교전운영센터(EOC)는 ' +
        '모델상 To-Be 전용이라 As-Is 그림에는 나타나지 않습니다(노드 ' + colA.nodes + ' → ' + colB.nodes + '). ' +
        '그리고 <b>To-Be에서만</b> 센서·ECS가 상급 지휘소로 <b>직접</b> 보고하는 링크가 생깁니다 — ' +
        '링크 수 차이(' + colA.links + ' → ' + colB.links + ')가 그것입니다.</div>';

      var selEl = el('sv-threat');
      if (selEl) {
        selEl.addEventListener('change', function () {
          box.setAttribute('data-threat', selEl.value);
          self.renderStructure(state);
        });
      }
      bindStructurePlay(box, span);
    },
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
