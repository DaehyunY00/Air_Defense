/**
 * K-JAMDS 시뮬레이터 — 탭 패널 렌더러 (Phase 1 → [분석] 탭 개편)
 * [분석] / [근거자료] 탭.
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

  function renderPipeline(state) {
    var box = el('pipeline-stages');
    if (!box) return;
    // 파이프라인 지표와 항적 병렬 로그가 같은 desPair 결과를 공유한다. pipelineData는
    // 같은 key의 재요청을 pending으로 흡수하므로(콜백을 덮어쓰지 않음), 두 렌더러 모두
    // "둘 다 다시 그리는" 동일 콜백을 넘겨야 나중 구독자가 갱신을 놓치지 않는다.
    var d = pipelineData(state, function () { renderAnalysisPanels(state); });
    if (!d) {
      el('pipeline-context').textContent = desCache.error
        ? 'DES 비교 계산 실패: ' + desCache.error
        : 'As-Is/To-Be DES를 백그라운드 Worker에서 계산 중입니다. 다른 탭·지도는 계속 조작할 수 있습니다.';
      box.innerHTML = '<div class="note">⏳ 9단계 파이프라인 비교 계산 중…</div>';
      var taxonomy = el('taxonomy-body');
      if (taxonomy) taxonomy.innerHTML = '<tr><td colspan="9">⏳ DES 결과 대기 중…</td></tr>';
      return;
    }
    var a = d.a, b = d.b, ga = a.global, gb = b.global;
    var catalog = catalogFor(state);
    var ca = codeCounts(a, catalog), cb = codeCounts(b, catalog);

    el('pipeline-context').textContent =
      KJ.scenarioById(state.sc).name + ' · 강도 ×' + Number(state.x).toFixed(1) +
      ' · seed ' + state.seed + ' · ' + state.dur + '초 — As-Is/To-Be 각 1복제 결정론 DES(동일 seed).' +
      ' seed·시간은 [시뮬레이션] 탭 입력값을 따릅니다.';

    var delegA = ga.delegation, delegB = gb.delegation;
    // ADR-062: 승인 계선(ADR-058)이 꺼진 실행에서 ⑥⑦ 승인·협조 지표는 "0"이 아니라 "미측정"이다.
    // 실행 결과가 스스로 신고한 features를 근거로 판정한다(UI 상태가 아니라 실제 실행 조건).
    var apprOn = !!((ga.features && ga.features.approvalChain) || (gb.features && gb.features.approvalChain));
    var APPR_NA = '미측정 — 승인 계선(ADR-058) OFF';
    var apprNa = apprOn ? null : APPR_NA;
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
        // no_report_path는 구조적으로 발화 불가(커버 센서가 있으면 보고경로 항상 존재 —
        // 구 tests/deadcode.test.js 영구 死 판정 — ADR-061로 스위트 폐기, tests/retired-legacy-suites.md)라 분석 탭 표시에서 제외(2026-07 지표 정리).
        codes: ['no_responsible_c2'],
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
        fn: '_onC2Arrive · _afterC2 (To-Be: _onFusionArrive)',
        bottleneck: 'C2 처리 포화(대기행렬), Best-Shooter 배정 실패 — ⑤ WTA(_doEngage)는 ' +
          '실제로는 ⑥⑦ 결심(_decision) 이후 ⑧ 단계에서 실행됨(엔진 실행 순서 ≠ 교리 F2T2EA 순서)',
        fix: 'JAMDC2 집중 처리·AI 식별로 서비스시간 단축(서버 풀링 효과)',
        codes: ['overflow_c2'],
        metrics: [
          { label: 'C2 항적처리 최대 ρ (track)', mom: 'MoP', kind: 'raw2', lower: true, max: 1,
            a: maxRhoByKind(a, 'c2', 'track'), b: maxRhoByKind(b, 'c2', 'track'),
            tip: 'C2 노드 중 최대 항적처리(track) 이용률. C2 서버풀은 ③④⑤ 항적처리와 ⑥⑦ 승인처리에 ' +
              '공유되므로, 이 값은 승인 부하를 제외한 순수 ③④⑤ 부하만 집계한다(승인 ρ는 ⑥⑦ 카드). ' +
              'ρ≥0.7 주의 · ≥0.9 병목 · 드롭=포화 (ENV-RHO-THRESH-01). ' +
              '관측 ρ는 시간가중 적분값이며 드롭·reneging으로 버려진 부하는 분자에 포함되지 않으므로, ' +
              '포화 구간에서 실제 수요를 과소표현한다(이론 ρ가 1을 넘어도 관측 ρ는 <1). ρ는 반드시 드롭 수·Wq와 함께 읽어야 한다.' },
          { label: 'C2 항적처리 최대 대기 (Wq·track)', mom: 'MoP', kind: 'sec', lower: true,
            a: maxWqByKind(a, 'c2', 'track'), b: maxWqByKind(b, 'c2', 'track'),
            tip: '항적처리(track) 대기행렬에서 서버를 기다린 평균 시간(초). ρ와 달리 포화의 체감 비용을 직접 표현한다. ' +
              '관측 ρ는 버린 일을 분자에 포함하지 않으므로(드롭·reneging), ρ만으로는 포화를 과소평가한다.' },
          { label: 'C2 항적처리 포화 드롭 (track)', mom: 'MoP', kind: 'cnt', lower: true,
            a: sumDropsByKind(a, 'c2', 'track'), b: sumDropsByKind(b, 'c2', 'track'),
            tip: 'M/M/c/K 대기실 용량(K) 초과로 상실된 항적처리(track) 작업 수 → overflow:<노드> 실패코드.' },
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
          { label: '그중 협조 홉 지연', mom: 'MoP', kind: 'sec', lower: true, na: apprNa,
            a: ga.meanCoordDelaySec, b: gb.meanCoordDelaySec,
            tip: '결심 지연 중 coord 협조 경로(육↔공 음성 등) 홉 지연 몫. ' +
              '집계 방식: 책임 C2→승인권자 최소지연 경로(coord 링크만 사용하는 다익스트라)의 링크 지연 합을 위협별로 누적해, ' +
              '결심 지연과 **같은 분모**(결심이 성립한 위협 수)로 나눈 평균이다 — 두 지표를 직접 뺄 수 있다. ' +
              '승인 계선(ADR-058)이 켜진 실행에서만 집계된다 — 꺼진 실행은 협조를 상태공유·plan 차단으로만 모델링하므로 ' +
              '"0"이 아니라 "미측정"으로 표시한다(ADR-062). 실측(ADR-072 기본값 30 seed): As-Is 16.6~34.4초. ' +
              '**잔여(결심지연−협조)는 항적·식별 지연 + C2 처리 + 승인 서비스 + 승인 대기의 합**이다. ' +
              '실측: As-Is 결심지연에서 협조 홉이 차지하는 몫은 SC1 24% · SC2 8% · SC3 11%뿐이다 — ' +
              '즉 "데이터링크만 깔면 해결된다"는 함의는 절반도 맞지 않다. ' +
              '다만 **잔여 전체가 승인 대기인 것도 아니다** — 승인 대기(Wq)만 떼어 보면 SC1 1.5초 · SC2 9.8초 · SC3 45.1초로, ' +
              '부하가 높은 SC3에서만 승인권자 대기행렬이 주된 몫이 된다(그래서 두 지표를 함께 봐야 한다). ' +
              'To-Be는 협조 홉이 대부분 생략되어 0이다.' },
          { label: '승인 노드 최대 ρ (approval)', mom: 'MoP', kind: 'raw2', lower: true, max: 1, na: apprNa,
            a: maxRhoByKind(a, 'c2', 'approval'), b: maxRhoByKind(b, 'c2', 'approval'),
            tip: '교전승인권자 노드가 승인 처리(⑥⑦)로 점유된 이용률 — C2 서버풀 공유 부하 중 approval만 분리. ' +
              '승인 계선(ADR-058) OFF 실행은 책임 C2가 자체 승인해 승인 홉 자체가 없으므로 미측정으로 표시한다(그 부하는 ③④⑤ 카드에 포함). ' +
              '실측(ADR-072 기본값 30 seed): As-Is ρ 0.25~0.50. ' +
              '종전 ③④⑤ 카드의 C2 ρ에는 이 승인 부하가 섞여 있어(예: KAOC는 승인 전용에 가깝다) 항적처리 부하를 과대표시했다. ' +
              '이 지표가 ⑥⑦(한국 이원화 C2의 승인 병목)을 직접 측정한다.' },
          { label: '승인 대기 (Wq·approval)', mom: 'MoP', kind: 'sec', lower: true, na: apprNa,
            a: maxWqByKind(a, 'c2', 'approval'), b: maxWqByKind(b, 'c2', 'approval'),
            tip: '승인 대기행렬에서 승인권자 서버를 기다린 평균 시간(초) — ⑥⑦ 결심 병목의 직접 증거. ' +
              '승인 계선(ADR-058) ON에서만 측정된다(실측 As-Is 1.5초(SC1)~45.1초(SC3) — 부하의 함수). ' +
              'To-Be는 사전승인 자동교전·동적 분권으로 승인 홉이 줄어 대기가 감소한다.' },
          { label: 'coord 링크 전달지연 (전달 1건 평균)', mom: 'MoP', kind: 'sec', lower: true,
            a: commMeanDelay(a, 'coord'), b: commMeanDelay(b, 'coord'),
            tip: '⑥⑦단계 coord(교전협조) 링크 전달의 평균 지연만 집계 — As-Is 육↔공 음성 협조(≥180s)가 실제로 발화하는 곳.' },
          { label: 'MCRC+국지 복수출처 항적융합', mom: 'MoP', kind: 'cnt', lower: null,
            a: c2aMetric(ga, 'trackFusion', 'multiSourceTracks'), b: c2aMetric(gb, 'trackFusion', 'multiSourceTracks'),
            tip: 'FULL 고해상도에서 군단 AOC/C2A가 MCRC 공중항적과 자체 TPS-880K·MFR 항적을 동일 위협으로 상관·융합한 건수.' },
          { label: '교전현황 음성/VTC 드롭', mom: 'MoP', kind: 'cnt', lower: true,
            a: c2aMetric(ga, 'statusSharing', 'dropped'), b: c2aMetric(gb, 'statusSharing', 'dropped'),
            tip: '군단 AOC→MCRC 교전현황 채널(1채널, 처리 중 포함 4건)이 포화되어 전파되지 못한 메시지 수.' },
          { label: '지연·드롭 상태정보로 인한 중복교전', mom: 'MoCE', kind: 'cnt', lower: true,
            a: c2aMetric(ga, 'statusSharing', 'duplicatesDueToStaleState'), b: c2aMetric(gb, 'statusSharing', 'duplicatesDueToStaleState'),
            tip: 'MCRC와 군단 AOC가 서로 다른 교전상태 원장을 보유한 상태에서 동일 위협에 실제 발사한 건수. 중복교전의 인과 지표.' },
          { label: '중복교전 위험 (축선 합, 정적)', mom: 'MoCE', kind: 'raw', lower: true,
            a: d.heatA, b: d.heatB,
            tip: '[정적 사전 예측] 서로 다른 통제계통이 제때 협조 불가(협조지연 ≥ 0.5×체공창, ENV-OVERLAP-RISK-01)한 무기쌍 × 부하(λ)의 축선 합. ' +
              'DES가 실제로 중복교전을 시뮬레이션하기 전의 위험 "점수"다 — 아래 "중복교전 발생(동적)"과 나란히 읽어 예측력을 검증한다(computeOverlapHeat 유지).' },
          { label: '중복교전 발생 (동적, 건수)', mom: 'MoCE', kind: 'cnt', lower: true,
            a: ga.coordination.duplicates, b: gb.coordination.duplicates,
            tip: '[동적 실제 발생] DES에서 동일 항적을 두 통제계통이 각각 교전한 실제 건수(_coordCheck 협조 실패). ' +
              'As-Is 팬아웃 계통이 잔여 체공창 내 협조(음성 180s)에 실패하면 발생 — KJADS 문제상황 1(교전 중복·책임공백)의 직접 관측. ' +
              'To-Be는 JAMDC2 COP 공유로 팬아웃 자체가 없어 0. 승인 실패코드 responsibility_gap이 이때 부활한다.' },
          { label: '요격탄 이중 소모 (중복교전 비용)', mom: 'MoFE', kind: 'raw', lower: true,
            a: ga.cost.duplicateInterceptM, b: gb.cost.duplicateInterceptM,
            tip: '중복교전으로 이중 소모된 요격탄 개념 비용(백만$). ⑨ 비용교환비(MoFE)를 As-Is에서 악화시키는 요인 — ' +
              '종전 모델은 이 비용을 전혀 계상하지 않아 As-Is 중복교전 비용을 과소평가했다(To-Be는 0).' },
          { label: '분권 전환 (횟수)', mom: 'MoCE', kind: 'cnt', lower: null, na: apprNa,
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
        bottleneck: '교전수단 부재(제약: 신궁·천마↔탄도탄), 교전창 부족(체공창 내 교전 완료 불가), 교전채널 포화',
        fix: '(능력·교전창 제약은 C2 통합으로 해결 불가 — 무기체계 능력·물리 문제로 분리)',
        codes: ['no_shooter', 'no_engage_window', 'overflow_shooter'],
        metrics: [
          { label: '무기 최대 관측 ρ', mom: 'MoP', kind: 'raw2', lower: true, max: 1,
            a: maxRho(a, 'shooter'), b: maxRho(b, 'shooter'),
            tip: '교전 무기 노드 중 최대 채널 이용률.' },
          // ADR-062: '무기 최대 평균대기(Wq)' 삭제 — native 교전 모델에는 사수 대기행렬이 없다.
          // 동시교전 슬롯이 차면 대기가 아니라 즉시 차단(capacity_full) 후 1초 뒤 재시도하므로
          // 대기시간이라는 관측량 자체가 존재하지 않는다(드롭 999건 셀에서도 Wq=0.00으로 실측).
          { label: 'command 링크 전달지연 (전달 1건 평균)', mom: 'MoP', kind: 'sec', lower: true,
            a: commMeanDelay(a, 'command'), b: commMeanDelay(b, 'command'),
            tip: '⑧단계 command(교전명령) 링크 전달의 평균 지연만 집계(C2→무기체계).' },
          { label: '동시교전 슬롯 차단 (재시도)', mom: 'MoP', kind: 'cnt', lower: true,
            a: dropSum(a, 'shooter'), b: dropSum(b, 'shooter'),
            tip: '동시교전 채널(maxSimultaneous)이 모두 점유돼 교전 개시가 차단된 횟수(capacityBlocks). ' +
              '⚠️ 영구 상실이 아니라 1초 뒤 재시도로 회복될 수 있는 차단이다 — 종전 라벨 "포화 드롭 합"은 ' +
              '상실로 오독될 수 있어 정정했다(ADR-062). 실제 상실은 실패코드 overflow:<노드>·timeout으로 따로 계상된다.' }
        ]
      },
      {
        no: '⑨', name: 'BDA → 재교전 (폐루프)', fn: '_onEngageEnd',
        bottleneck: '명중 실패(저Pk, 예: 무인기 0.1~0.5), 체공창 소진(교전 중), 재교전 상한(3회)',
        fix: '재교전 폐루프는 dwell 창 내에서만 — 앞 단계 지연 단축이 곧 재교전 기회 확보',
        codes: ['missed', 'timeout:engage', 'timeout:c2'],
        metrics: [
          { label: '격추율 (해결분 기준)', mom: 'MoFE', kind: 'rate', lower: false, max: 1,
            a: ga.killRate, b: gb.killRate,
            tip: '격추 ÷ (생성 − 관측종료 미해결) — censorFix 절단 보정 분모(해결분 기준). ' +
              '결과 모달 상단의 "격추율 (전체 생성 기준)"(killed/spawned)과 분모가 다르므로 값 비교 시 주의.' },
          { label: '평균 격추시간 (조건부·생존자편향 주의)', mom: 'MoP', kind: 'sec', lower: true,
            a: ga.meanTimeToKillSec, b: gb.meanTimeToKillSec,
            tip: '격추 성공 항적의 생성→격추 평균 소요(n=As-Is ' + (ga.meanTimeToKillN || 0) + ' · To-Be ' + (gb.meanTimeToKillN || 0) + '). ' +
              '⚠️ 생존자 편향: "격추한 것"에만 조건화된 평균이라 As-Is↔To-Be 단순비교는 오도할 수 있다. To-Be가 As-Is가 놓치던 ' +
              '어려운(느린) 표적까지 격추하면 meanTTK가 오히려 커져 "느려 보이는" 선택효과가 생긴다 — 반드시 격추율(n)과 함께 읽어라.' },
          { label: '교전당 발사수', mom: 'MoP', kind: 'raw2', lower: null,
            a: ga.shotsPerEngagement, b: gb.shotsPerEngagement,
            tip: '요격탄 총 발사수 ÷ 최초교전 표적수. 1.0=교전당 1발(shoot-look-shoot), >1=재교전·연발(salvo) 발사 부담↑, ' +
              '<1=일부 명령표적이 발사 전 이탈(체공창 소진). 방향(개선/악화) 판정 없는 참고 지표 — 높/낮음이 곧 좋/나쁨이 아니다. ' +
              '집계 범위 주의: As-Is 중복교전(ghost) 발사는 분자·분모 모두 제외되지만 비용교환비의 요격탄 비용에는 포함된다(범위 상이). ' +
              '비용교환비·격추율과 함께 요격탄 소모 강도를 읽는다.' },
          { label: '방어효율 (방어한 위협가치 비율)', mom: 'MoFE', kind: 'rate', lower: false, max: 1,
            a: ga.cost.defenseEfficiency, b: gb.cost.defenseEfficiency,
            tip: '격추 위협가치 ÷ (격추 + 누수 위협가치) — 전체 위협가치 중 실제로 방어(격추)한 비율. ' +
              '비용교환비(exchange)의 함정("아무것도 안 쏘면 exchange=0으로 최적")을 반전한다: 안 쏘면 격추 0 → 방어효율 0=최악. ' +
              'exchange가 누수(패배)를 경제성으로 보상하던 결함(⑨ 사실 c)의 보완 지표 — exchange는 회귀 안전을 위해 그대로 유지.' },
          { label: '비용교환비 (저가 포화위협)', mom: 'MoFE', kind: 'ratio', lower: true,
            a: ga.cost.exchangeSat, b: gb.cost.exchangeSat,
            tip: '무인기·장사정포 대응 소모 요격탄 비용 ÷ 격추 위협가치 (개념 단가, 한반도 보정 필요). >1이면 아군이 더 비싼 자원 소모. ' +
              '⚠️ 함정: 분모에 "격추한" 위협만 들어가 **아무것도 안 쏘면 0으로 "최적"이 된다**(패배가 경제성으로 계상) — 반드시 "방어효율"·격추율과 함께 읽어라. To-Be가 항상 개선되는 지표가 아님(docs/모의논리서.html §5).' },
          { label: '고가유도탄 보존율 (자원최적화)', mom: 'MoFE', kind: 'rate', lower: false, max: 1,
            a: ga.highValuePreservation, b: gb.highValuePreservation,
            tip: '1 − 고가 유도탄($≥5M, L-SAM) 소모액 ÷ 전체 요격탄 소모액 — 높을수록 고가 자산 보존(KJADS 원칙 5-1 직접 지표). ' +
              '⚠️ 반증: As-Is 순진한 min-load가 오히려 보존율이 높다 — To-Be Best-Shooter가 고가 낭비를 생성. 비용 인식 WTA(costAwareWta)는 이를 완화(docs/adr/ADR-007).' },
          { label: '위협등급 대비 요격탄 단가 (쏜 것 전부)', mom: 'MoFE', kind: 'ratio', lower: true,
            a: ga.interceptPerThreatValue, b: gb.interceptPerThreatValue,
            tip: '총 요격탄가 ÷ 교전한 위협가치 — exchange와 달리 격추 여부와 무관(쏜 것 전부). "적정한 무기를 골랐는가"를 격추 성공과 분리해서 본다. 낮을수록 위협가치에 걸맞은 요격탄 배정.' }
        ]
      },
      {
        no: '⑨+', name: '결과 종합 (전 단계의 귀결)', fn: '_results',
        bottleneck: '모든 단계 병목의 최종 귀결 — 누출률',
        fix: '구조적 원인([구조])은 To-Be에서 감소, 일부는 순수 명중 실패로 이동하는 것이 정상 경로',
        codes: [],
        metrics: [
          { label: '요격 실패율 (누출률, 해결분 기준)', mom: 'MoFE', kind: 'rate', lower: true, max: 1,
            a: ga.leakRate, b: gb.leakRate,
            tip: '누출 ÷ (생성 − 관측종료 미해결) — censorFix 절단 보정 분모(해결분 기준). ' +
              '결과 모달의 "확정 누출률 (전체 생성 기준)"(leaked/spawned)과 분모가 다르므로 값 비교 시 주의.' },
          { label: '구조적 실패 합 ([구조] 원인)', mom: 'MoCE', kind: 'cnt', lower: true,
            a: structuralLeaks(ga), b: structuralLeaks(gb),
            tip: '전 원인 코드 중 structural=true(탐지공백·비융합·책임공백·포화·지연) 합 — To-Be에서 감소해야 정상.' }
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

  // ══════════════ [결심 비교] 탭 (ADR-075) ══════════════
  // ADR-073/074가 남긴 로그를 **순수 후처리**한 `c2Analysis.decisionComparison`만 읽어 그린다.
  // 엔진 상태를 되쓰지 않고, 값을 다시 계산하지도 않는다.
  //
  // 미측정 표시 규율(ADR-062·073 계승): 계측이 꺼진 런은 0이 아니라 "미측정"으로 렌더한다.
  // 판정은 UI 상태가 아니라 **런이 보고한** `global.features.decisionAudit`(→ available)에서 취한다.

  var decisionSel = { threatId: null };  // ② 팝오버로 펼친 위협(탭 세션 내 선택 상태)

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

  /** 병목 taxonomy ↔ 발생 단계 요약표 (+ 이번 설정의 관측 건수) */
  function renderTaxonomyTable(ca, cb) {
    var body = el('taxonomy-body');
    if (!body) return;
    // 발생 단계(stage)는 엔진 정본 KJ.LEAK_TAXONOMY에서 읽는다 — 결과 모달 대조표와 동일 출처
    // 엔진이 실제 방출하는 코드와 1:1 정합(⑧ no_engage_window · ⑨ timeout 분해 반영).
    // overflow와 timeout:c2는 세부·반복 증거 전 conditional, timeout:engage는 비구조.
    var rows = [
      { code: 'not_detected', fixer: '센서·융합' },
      { code: 'no_sensor', fixer: '센서 배치' },
      { code: 'no_responsible_c2', fixer: '책임·권한 설계' },
      // no_report_path 행 제거(2026-07 지표 정리): 전 시나리오·강도·배치 스윕에서 0건이며
      // 구 tests/deadcode.test.js(ADR-061 폐기)가 "구조적으로 발화 불가(영구 死)"로 판정한 코드 — 엔진 경로와
      // 死 코드 게이트는 유지하되 분석 탭 표에는 표시하지 않는다.
      { code: 'responsibility_gap', fixer: 'To-Be 통합 C2', core: true },
      { code: 'overflow', fixer: '처리용량·자동화',
        count: function (c) { return (c.overflow_c2 || 0) + (c.overflow_shooter || 0); } },
      { code: 'no_shooter', fixer: '무기체계 능력' },
      { code: 'engagement_geometry_gap', fixer: '배치·사거리·고도 능력' },
      { code: 'window_lost_due_to_c2', fixer: 'C2·명령 지연' },
      { code: 'no_fire_control', fixer: '추적·화통 전환' },
      { code: 'capacity_full', fixer: '동시교전 용량' },
      { code: 'ammo_depleted', fixer: '탄약·재장전' },
      { code: 'no_engage_window', fixer: '무기 교전창·체공(⑧)' },
      { code: 'missed', fixer: '무기 Pk·재교전' },
      { code: 'timeout:c2', fixer: '전 단계 지연(교전 미개시)',
        count: function (c) { return (c['timeout:c2'] || 0) + (c['timeout'] || 0); } }, // legacy timeout 흡수(조건부)
      { code: 'timeout:engage', fixer: '무기 체공·교전(⑨)' }
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
        '<td>' + (meta.structurality === 'structural' ? '✅ 구조' :
          (meta.structurality === 'conditional' ? '⚠️ 조건부' :
            (meta.structurality === 'unknown' ? '❓ 미분해' : '❌ 비구조'))) + '</td>' +
        '<td>' + esc(r.fixer) + '</td>' +
        '<td class="num">' + a + '</td><td class="num">' + b + '</td>' +
        '<td class="num"><span class="' + dcls + '">' + (d > 0 ? '+' : '') + d + '</span></td></tr>';
    }).join('');
  }

  /** mm:ss 포맷 (sim-view와 동일 정의) */
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

  /** [분석] 탭 위협 항적 병렬 로그 — 동일 seed As-Is↔To-Be DES 1복제의 위협별 9단계 대조.
   *  좌=As-Is 분절형, 우=To-Be 통합형으로 고정(상단 모드 선택과 무관). */
  function renderThreatLog(state) {
    var box = el('analysis-threat-log');
    if (!box) return;
    var data = pipelineData(state, function () { renderAnalysisPanels(state); });
    if (!data) {
      box.innerHTML = desCache.error
        ? '<div class="bn-none">DES 비교 계산 실패: ' + esc(desCache.error) + '</div>'
        : '<div class="note">⏳ As-Is↔To-Be 항적 로그 계산 중…</div>';
      return;
    }
    var ta = data.a.threatTraces || [], tb = data.b.threatTraces || [];
    if (!ta.length && !tb.length) {
      box.innerHTML = '<div class="bn-none">이 설정에서 생성된 위협 항적이 없습니다.</div>';
      return;
    }
    // ID로 1:1 대응 (CRN — 두 모드의 위협 집단은 동일해야 한다)
    var byIdB = {};
    tb.forEach(function (tr) { byIdB[tr.id] = tr; });
    var seen = {};
    var rows = ta.map(function (tr) {
      seen[tr.id] = 1;
      return { id: tr.id, a: tr, b: byIdB[tr.id] || null };
    });
    // 대응이 깨진 경우(설계상 없어야 함)도 숨기지 않고 드러낸다
    tb.forEach(function (tr) { if (!seen[tr.id]) rows.push({ id: tr.id, a: null, b: tr }); });

    var tally = { gain: 0, loss: 0, same: 0, other: 0 };
    rows.forEach(function (r) {
      r.oa = outcomeOf(r.a); r.ob = outcomeOf(r.b);
      r.dv = divergenceOf(r.oa, r.ob);
      if (r.dv.key === 'gain') tally.gain++;
      else if (r.dv.key === 'loss') tally.loss++;
      else if (r.dv.key === 'other') tally.other++;
      else tally.same++;
    });
    var unpaired = rows.filter(function (r) { return !r.a || !r.b; }).length;

    var scen = KJ.scenarioById(state.sc);
    var html = '<div class="analysis-context">' +
      esc(scen ? scen.name : state.sc) + ' · ' + esc(state.dep) +
      ' · 강도 ×' + Number(state.x).toFixed(1) + ' · seed ' + state.seed + ' · ' + state.dur + '초 · ' +
      '동일 seed 결정론 DES 1복제 — 추적 ' + rows.length + '건 ' +
      '(<b class="dv-gain">개선 ' + tally.gain + '</b> · <b class="dv-loss">악화 ' + tally.loss +
      '</b> · 동일 ' + tally.same + (tally.other ? ' · 기타 ' + tally.other : '') + ')' +
      (data.a.traceTruncated || data.b.traceTruncated
        ? ' · ⚠️ 추적 상한(300건) 절삭 — 아래 표는 표본, 상단 지표는 전체 기준' : '') +
      '</div>';
    if (unpaired) {
      html += '<div class="note">⚠️ 두 모드에서 대응되지 않는 항적 ' + unpaired + '건 — ' +
        'CRN(공통난수) 설계상 위협 집단은 모드와 무관하게 같아야 합니다. 대응 실패는 모델 결함 신호입니다.</div>';
    }

    var FILTERS = [
      { key: 'diff', label: '판정이 갈린 항적', n: tally.gain + tally.loss + tally.other },
      { key: 'gain', label: '개선', n: tally.gain },
      { key: 'loss', label: '악화', n: tally.loss },
      { key: 'all', label: '전체', n: rows.length }
    ];
    html += '<div class="alog-filters">' + FILTERS.map(function (f) {
      return '<button type="button" class="alog-filter' + (logFilter === f.key ? ' is-on' : '') +
        '" data-filter="' + f.key + '">' + esc(f.label) + ' <b>' + f.n + '</b></button>';
    }).join('') + '</div>';

    var shown = rows.filter(function (r) {
      if (logFilter === 'all') return true;
      if (logFilter === 'diff') return r.dv.key === 'gain' || r.dv.key === 'loss' || r.dv.key === 'other';
      return r.dv.key === logFilter;
    });
    if (!shown.length) {
      html += '<div class="bn-none">이 조건에 해당하는 항적이 없습니다.</div>';
      box.innerHTML = html;
      bindFilters(box, state);
      return;
    }
    html += '<div class="alog-legend"><span>좌 <b>As-Is 분절형</b></span>' +
      '<span>우 <b>To-Be 통합형</b></span></div>';
    html += shown.map(function (r) {
      var ref = r.a || r.b;
      return '<details class="alog-row">' +
        '<summary class="alog-hdr">' +
        '<span class="tlog-dot" style="background:' + KJ.simView.threatColor(ref.type) + '"></span>' +
        '<span class="alog-id">' + esc(r.id) + ' <i>(' + esc(ref.axis) + ')</i></span>' +
        '<span class="alog-time">' + fmtTime(ref.spawnT) + ' 침투</span>' +
        '<span class="alog-pair">' + outcomeBadge(r.oa) +
        '<span class="alog-arrow">→</span>' + outcomeBadge(r.ob) + '</span>' +
        '<span class="alog-dv ' + r.dv.cls + '">' + esc(r.dv.label) + '</span>' +
        '</summary>' +
        '<div class="alog-cols">' +
        '<div class="alog-col"><h4>As-Is 분절형</h4>' + stageList(r.a) + '</div>' +
        '<div class="alog-col"><h4>To-Be 통합형</h4>' + stageList(r.b) + '</div>' +
        '</div></details>';
    }).join('');
    box.innerHTML = html;
    bindFilters(box, state);
  }

  function bindFilters(box, state) {
    var btns = box.querySelectorAll('.alog-filter');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        logFilter = b.getAttribute('data-filter');
        renderThreatLog(state);
      });
    });
  }

  /** 같은 desPair 결과를 쓰는 분석 탭 패널 일괄 렌더 (비동기 도착 시 공용 콜백) */
  function renderAnalysisPanels(state) {
    renderPipeline(state);
    renderThreatLog(state);
    if (KJ.tableSort) KJ.tableSort.attachAll(el('panel-analysis')); // 숫자열 헤더 우측정렬 동기화
  }

  KJ.panels = {
    /** [분석] 탭: 9단계 파이프라인 지표 + As-Is↔To-Be 위협 항적 병렬 로그 */
    renderAnalysis: renderAnalysisPanels,

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
