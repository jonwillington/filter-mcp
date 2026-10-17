// Calls every tool against a running server (default: wrangler dev on :8787).
// MCP_URL=https://mcp.filter.coffee/mcp npm run smoke   checks production.
const URL_ = process.env.MCP_URL ?? 'http://localhost:8787/mcp';
let n = 0;
async function rpc(method, params) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return r.structuredContent;
};

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
const tools = await rpc('tools/list', {});
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

const { cities } = await call('list_cities');
for (const c of cities) console.log(`${c.name}: ${c.shop_count} shops, ${c.areas.length} areas`);

for (const city of cities.map((c) => c.slug)) {
  const work = await call('search_shops', { city, pick: 'working', limit: 3 });
  console.log(`\n${city} working picks: ${work.total_matches}`);
  for (const s of work.shops) console.log(' ', s.name, '|', s.area, '|', s.url);
  const v60 = await call('search_shops', { city, brew_methods: ['v60'], open_now: true, limit: 2 });
  console.log(`  v60 + open now: ${v60.total_matches}`);
  const first = work.shops[0] ?? (await call('search_shops', { city, roasts_own_beans: true, limit: 1 })).shops[0];
  const { shop } = await call('get_shop', { id: first.id });
  console.log('  get_shop:', shop.name, '| hours', shop.opening_hours?.[0], '| sources', shop.sources.map((s) => s.title).join('; '));
  if (shop.roaster) {
    const { roaster } = await call('get_roaster', { id: shop.roaster.id });
    console.log('  get_roaster:', roaster.name, '| founder', roaster.founder, '| beans', roaster.beans.length, '| shops', roaster.shops.length, '|', roaster.url);
  }
  const awards = await call('list_awards', { city, limit: 2 });
  console.log('  awards:', awards.awards.map((a) => `${a.award} ${a.year} ${a.placement} → ${a.roaster.name}`).join(' / '));
  const events = await call('list_events', { city, limit: 2 });
  console.log('  events:', events.count);
}

const near = await call('search_shops', { city: 'london', near: { lat: 51.5246, lng: -0.0786 }, radius_metres: 600, limit: 3 });
console.log('\nnear Shoreditch:', near.shops.map((s) => `${s.name} ${s.distance_metres}m`).join(', '));
const found = await call('search', { query: 'kadıköy filter' });
console.log('search:', found.results.slice(0, 3).map((r) => r.title).join(' / '));
const fetched = await call('fetch', { id: found.results[0].id });
console.log('fetch:\n' + fetched.text);
