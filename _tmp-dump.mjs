import fs from 'node:fs';
import { createRequire } from 'node:module';
globalThis.window = globalThis;
const require = createRequire(import.meta.url);
['config/system-types.js', 'config/geo-mdl.js', 'config/deployments.js', 'data/nodes.js',
  'data/links.js', 'data/threats.js', 'data/scenarios.js', 'data/axes.js',
  'config/deployment-adapter.js'].forEach(f => require('./js/' + f));
const KJ = globalThis.KJ;
const cat = KJ.resolveModelCatalog({ deploymentId: 'HANBANDO_LEGACY_NORMAL', features: {} });

const label = { KAMD_OPS: 'KAMDOC', MCRC: 'MCRC', IAOC: 'IAOC', EOC: 'EOC',
  ARMY_LOCAL_AD: 'ADC2A', ICC: 'ICC', ECS: 'ECS' };
function grp(n) {
  if (n.category === 'sensor') return 'SENSOR:' + n.typeId;
  if (n.category === 'shooter') return 'SHOOTER:' + n.typeId;
  return label[n.typeId] || n.typeId;
}
const out = { modes: {}, nodes: {}, roles: cat.roles };

cat.nodes.forEach(n => {
  const g = grp(n);
  const e = out.nodes[g] = out.nodes[g] || { group: g, category: n.category, typeId: n.typeId, count: 0, name: n.name, modes: n.modes || 'both' };
  e.count++;
  if (n.category === 'c2' && !e.queue) {
    e.queue = { servers: n.queue.servers, svc: n.queue.serviceTimeSec, cap: n.queue.capacity };
  }
});

['asis', 'tobe'].forEach(mode => {
  const present = {};
  KJ.nodesInMode(mode, cat).forEach(n => { present[n.id] = n; });
  const agg = {};
  KJ.linksInMode(mode, cat).forEach(l => {
    const a = present[l.from], b = present[l.to];
    if (!a || !b) return;
    const c = l.comm[mode];
    const key = grp(a) + '>' + grp(b) + '|' + l.kind + '|' + c.type + '|' + c.delaySec;
    if (!agg[key]) agg[key] = { from: grp(a), to: grp(b), kind: l.kind, type: c.type,
      delaySec: c.delaySec, dist: c.dist || null, servers: c.messageServers || null,
      capacity: c.messageCapacity || null, freshnessSec: c.freshnessSec || null,
      paramRef: c.paramRef, n: 0 };
    agg[key].n++;
  });
  out.modes[mode] = {
    nodes: Object.keys(present).length,
    links: KJ.linksInMode(mode, cat).length,
    edges: Object.values(agg).sort((x, y) => (x.from + x.to).localeCompare(y.from + y.to))
  };
});
fs.writeFileSync('_tmp-c2.json', JSON.stringify(out, null, 1));
console.log('nodes groups:', Object.keys(out.nodes).length,
  '| asis edges:', out.modes.asis.edges.length, '| tobe edges:', out.modes.tobe.edges.length);
