/** Classic-worker fallback. The preferred loader is sim-worker.mjs. */
'use strict';
self.window = self;

/** 모든 import에 버전 쿼리를 붙인다. 워커가 모듈을 **버전 없이** 불러오면, 갱신된 배포를
 *  받은 브라우저가 옛 사본을 캐시에서 섞어 쓰면서 **조용히 다른 수치**를 낸다(실측: 같은
 *  seed·같은 설정에서 생성 위협 157→142). 크래시보다 나쁜 실패 양식이라 전부 고정한다. */
importScripts(
  '../config/system-types.js?v=20260826b',
  '../config/geo-mdl.js?v=20260826b',
  '../config/deployments.js?v=20260826b',
  '../data/nodes.js?v=20260826b',
  '../data/links.js?v=20260826b',
  '../data/threats.js?v=20260826b',
  '../data/scenarios.js?v=20260826b',
  '../data/axes.js?v=20260826b',
  '../config/deployment-adapter.js?v=20260826b',
  '../core/rng.js?v=20260826b',
  '../core/heap.js?v=20260826b',
  '../analysis/bottleneck.js?v=20260826b',
  '../analysis/c2-report.js?v=20260826b',
  '../engine/sim-engine.js?v=20260826b',
  '../analysis/mc-runner.js?v=20260826b',
  '../analysis/transition.js?v=20260826b',
  '../analysis/overlap-heatmap.js?v=20260826b',
  './sim-worker-runtime.js?v=20260826b'
);
