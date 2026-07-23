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
  function modelConfig(state) {
    var high = state && state.dep && state.dep !== 'legacy';
    return high ? { deploymentId: state.dep, features: { highResolutionDeployment: true }, modelFidelity: state.fid || 'compat' } : {};
  }
  function catalogFor(state) {
    return KJ.resolveModelCatalog ? KJ.resolveModelCatalog(modelConfig(state)) : null;
  }

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
  var desCache = { key: null, data: null, pendingKey: null, requestId: 0, error: null, errorKey: null };
  function pipelineData(state, onReady) {
    var key = [state.sc, state.x, state.seed, state.dur, state.dep || 'legacy', state.fid || 'compat'].join('|');
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
        deploymentId: highCfg.deploymentId, features: highCfg.features,
        modelFidelity: highCfg.modelFidelity
      },
      includeHeat: true
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
  function maxRhoByKind(res, cat, kind) {
    var m = 0;
    res.nodes.forEach(function (n) {
      var v = n.rhoByKind ? n.rhoByKind[kind] : 0;
      if (n.category === cat && v > m) m = v;
    });
    return m;
  }
  function sumDropsByKind(res, cat, kind) {
    var s = 0;
    res.nodes.forEach(function (n) {
      if (n.category === cat && n.dropsByKind) s += n.dropsByKind[kind] || 0;
    });
    return s;
  }
  function maxWqByKind(res, cat, kind) {
    var m = 0;
    res.nodes.forEach(function (n) {
      var v = n.WqByKind ? n.WqByKind[kind] : 0;
      if (n.category === cat && isFinite(v) && v > m) m = v;
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
    var d = pipelineData(state, function () { renderPipeline(state); });
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
        codes: ['no_responsible_c2', 'no_report_path'],
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
          { label: '그중 협조 홉 지연', mom: 'MoP', kind: 'sec', lower: true,
            a: ga.meanCoordDelaySec, b: gb.meanCoordDelaySec,
            tip: '결심 지연 중 coord 협조 경로(육↔공 음성 등) 홉 지연 몫. **잔여(결심지연−협조)는 C2 처리·승인권자 대기(큐)·승인 서비스**다. ' +
              '실측: As-Is 결심지연의 협조 홉은 17~38%뿐이고 나머지 62~83%가 승인 대기다 — ' +
              '"데이터링크만 깔면 해결된다"는 함의는 절반만 맞다(승인권자 처리용량도 함께 봐야 한다). To-Be는 협조 홉이 대부분 생략되어 0에 가깝다.' },
          { label: '승인 노드 최대 ρ (approval)', mom: 'MoP', kind: 'raw2', lower: true, max: 1,
            a: maxRhoByKind(a, 'c2', 'approval'), b: maxRhoByKind(b, 'c2', 'approval'),
            tip: '교전승인권자 노드가 승인 처리(⑥⑦)로 점유된 이용률 — C2 서버풀 공유 부하 중 approval만 분리. ' +
              '종전 ③④⑤ 카드의 C2 ρ에는 이 승인 부하가 섞여 있어(예: KAOC는 승인 전용에 가깝다) 항적처리 부하를 과대표시했다. ' +
              '이 지표가 ⑥⑦(한국 이원화 C2의 승인 병목)을 직접 측정한다.' },
          { label: '승인 대기 (Wq·approval)', mom: 'MoP', kind: 'sec', lower: true,
            a: maxWqByKind(a, 'c2', 'approval'), b: maxWqByKind(b, 'c2', 'approval'),
            tip: '승인 대기행렬에서 승인권자 서버를 기다린 평균 시간(초) — ⑥⑦ 결심 병목의 직접 증거. ' +
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
        bottleneck: '교전수단 부재(제약: 신궁·천마↔탄도탄), 교전창 부족(체공창 내 교전 완료 불가), 교전채널 포화',
        fix: '(능력·교전창 제약은 C2 통합으로 해결 불가 — 무기체계 능력·물리 문제로 분리)',
        codes: ['no_shooter', 'no_engage_window', 'overflow_shooter'],
        metrics: [
          { label: '무기 최대 관측 ρ', mom: 'MoP', kind: 'raw2', lower: true, max: 1,
            a: maxRho(a, 'shooter'), b: maxRho(b, 'shooter'),
            tip: '교전 무기 노드 중 최대 채널 이용률.' },
          { label: '무기 최대 평균대기 (Wq)', mom: 'MoP', kind: 'sec', lower: true,
            a: maxWq(a, 'shooter'), b: maxWq(b, 'shooter'),
            tip: '교전 대기실에서 채널을 기다린 평균 시간(초). ρ와 달리 포화의 체감 비용을 직접 표현한다.' },
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
        bottleneck: '명중 실패(저Pk, 예: 무인기 0.1~0.5), 체공창 소진(교전 중), 재교전 상한(3회)',
        fix: '재교전 폐루프는 dwell 창 내에서만 — 앞 단계 지연 단축이 곧 재교전 기회 확보',
        codes: ['missed', 'timeout:engage', 'timeout:c2'],
        metrics: [
          { label: '격추율', mom: 'MoFE', kind: 'rate', lower: false, max: 1,
            a: ga.killRate, b: gb.killRate, tip: '생성 위협 중 격추 비율 — 최종 요격 성과.' },
          { label: '평균 격추시간 (조건부·생존자편향 주의)', mom: 'MoP', kind: 'sec', lower: true,
            a: ga.meanTimeToKillSec, b: gb.meanTimeToKillSec,
            tip: '격추 성공 항적의 생성→격추 평균 소요(n=As-Is ' + (ga.meanTimeToKillN || 0) + ' · To-Be ' + (gb.meanTimeToKillN || 0) + '). ' +
              '⚠️ 생존자 편향: "격추한 것"에만 조건화된 평균이라 As-Is↔To-Be 단순비교는 오도할 수 있다. To-Be가 As-Is가 놓치던 ' +
              '어려운(느린) 표적까지 격추하면 meanTTK가 오히려 커져 "느려 보이는" 선택효과가 생긴다 — 반드시 격추율(n)과 함께 읽어라.' },
          { label: '교전당 발사수', mom: 'MoP', kind: 'raw2', lower: null,
            a: ga.shotsPerEngagement, b: gb.shotsPerEngagement,
            tip: '요격탄 총 발사수 ÷ 최초교전 표적수. 1.0=교전당 1발(shoot-look-shoot), >1=재교전·연발(salvo) 발사 부담↑, ' +
              '<1=일부 명령표적이 발사 전 이탈(체공창 소진). 방향(개선/악화) 판정 없는 참고 지표 — 높/낮음이 곧 좋/나쁨이 아니다. ' +
              '비용교환비·격추율과 함께 요격탄 소모 강도를 읽는다.' },
          { label: '방어효율 (방어한 위협가치 비율)', mom: 'MoFE', kind: 'rate', lower: false, max: 1,
            a: ga.cost.defenseEfficiency, b: gb.cost.defenseEfficiency,
            tip: '격추 위협가치 ÷ (격추 + 누수 위협가치) — 전체 위협가치 중 실제로 방어(격추)한 비율. ' +
              '비용교환비(exchange)의 함정("아무것도 안 쏘면 exchange=0으로 최적")을 반전한다: 안 쏘면 격추 0 → 방어효율 0=최악. ' +
              'exchange가 누수(패배)를 경제성으로 보상하던 결함(⑨ 사실 c)의 보완 지표 — exchange는 회귀 안전을 위해 그대로 유지.' },
          { label: '비용교환비 (저가 포화위협)', mom: 'MoFE', kind: 'ratio', lower: true,
            a: ga.cost.exchangeSat, b: gb.cost.exchangeSat,
            tip: '무인기·장사정포 대응 소모 요격탄 비용 ÷ 격추 위협가치 (개념 단가, 한반도 보정 필요). >1이면 아군이 더 비싼 자원 소모. ' +
              '⚠️ 함정: 분모에 "격추한" 위협만 들어가 **아무것도 안 쏘면 0으로 "최적"이 된다**(패배가 경제성으로 계상) — 반드시 "방어효율"·격추율과 함께 읽어라. To-Be가 항상 개선되는 지표가 아님(docs/metrics-verification.md).' },
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
          { label: '요격 실패율 (누출률)', mom: 'MoFE', kind: 'rate', lower: true, max: 1,
            a: ga.leakRate, b: gb.leakRate,
            tip: '생성 위협 중 격추하지 못하고 공역을 통과(누수)한 비율.' },
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
      { code: 'no_report_path', fixer: 'To-Be 융합' },
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

  KJ.panels = {
    /** [분석] 탭: 9단계 파이프라인 지표 + 정상상태 해석 상세 렌더 */
    renderAnalysis: function (state, analysis) {
      var sc = KJ.scenarioById(state.sc);
      var catalog = catalogFor(state);
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
          '<td>' + esc(KJ.nodeById(r.from, catalog).name) + ' → ' + esc(KJ.nodeById(r.to, catalog).name) + '</td>' +
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
