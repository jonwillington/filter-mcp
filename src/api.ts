// Reads the v3 API (filter-api) and each city site's slug map. Nothing here touches a
// database: the MCP server sees exactly what the apps and sites see (published records only).

import type { BrandDetail, Catalog, CityAward, CityListItem, City, Discover, ShopDetail } from './api-v3';
import { CITIES, type CityConfig } from './cities';

export interface Env {
  /** Service binding to filter-api. Absent in plain `wrangler dev`: we then fetch the public host. */
  API?: Fetcher;
  /** filter-api's BUILD_KEY, so its per-address limit on detail pages doesn't count this Worker. */
  API_BUILD_KEY?: string;
  MCP_LIMITER?: RateLimit;
}

const PUBLIC_API = 'https://api.filter.coffee';

/** Per-isolate memo. The API already caches at the edge and revalidates by content version;
 *  this only saves the hop for the big city payloads within one warm isolate. */
const memo = new Map<string, { at: number; value: Promise<unknown> }>();
const TTL_MS = 5 * 60 * 1000;

function remember<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => memo.delete(key));
  return value;
}

export class NotFound extends Error {}

async function v3<T>(env: Env, path: string): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'filter-mcp' };
  if (env.API_BUILD_KEY) headers['x-filter-build-key'] = env.API_BUILD_KEY;
  const url = `${PUBLIC_API}${path}`;
  const res = env.API ? await env.API.fetch(url, { headers }) : await fetch(url, { headers });
  if (res.status === 404) throw new NotFound(path);
  if (!res.ok) throw new Error(`filter-api ${res.status} for ${path}`);
  return ((await res.json()) as { data: T }).data;
}

export const api = {
  cities: (env: Env) => remember('cities', () => v3<CityListItem[]>(env, '/v3/cities')),
  city: (env: Env, slug: string) => remember(`city:${slug}`, () => v3<City>(env, `/v3/cities/${slug}`)),
  catalog: (env: Env, slug: string) => remember(`catalog:${slug}`, () => v3<Catalog>(env, `/v3/cities/${slug}/catalog`)),
  awards: (env: Env, slug: string) => remember(`awards:${slug}`, () => v3<CityAward[]>(env, `/v3/cities/${slug}/awards`)),
  discover: (env: Env, slug: string) =>
    remember(`discover:${slug}`, () => v3<Discover>(env, `/v3/cities/${slug}/discover?events=50&news=0`)),
  shop: (env: Env, id: string) => v3<ShopDetail>(env, `/v3/shops/${encodeURIComponent(id)}`),
  brand: (env: Env, id: string) => v3<BrandDetail>(env, `/v3/brands/${encodeURIComponent(id)}`),
};

// ─── Links to the city sites ─────────────────────────────────────────────────

type SlugKind = 'shops' | 'brands' | 'areas' | 'events';
type SlugMaps = Partial<Record<SlugKind, Record<string, string>>>;

/** Each site publishes /slug-history.json at deploy (filter-city-web scripts/snapshot.mjs);
 *  `current` is this deploy's id → slug. A site that can't be read only costs pretty URLs. */
function slugMaps(site: CityConfig): Promise<SlugMaps> {
  return remember(`slugs:${site.slug}`, async () => {
    try {
      const res = await fetch(`${site.siteUrl}/slug-history.json`, { headers: { 'user-agent': 'filter-mcp' } });
      if (!res.ok) return {};
      return (((await res.json()) as { current?: SlugMaps }).current ?? {}) as SlugMaps;
    } catch {
      return {};
    }
  });
}

const ROUTES: Record<SlugKind, string> = { shops: '/shop', brands: '/roaster', areas: '/area', events: '/guide/event' };

/** The page on the city site, as filter-city-web lib/slugs.ts `href` builds it. A record newer
 *  than the last site deploy has no slug yet and takes the /x fallback, which renders the same page. */
export async function pageUrl(site: CityConfig, kind: SlugKind, id: string): Promise<string> {
  const slug = (await slugMaps(site))[kind]?.[id];
  return slug
    ? `${site.siteUrl}${ROUTES[kind]}/${slug}`
    : `${site.siteUrl}/x?k=${kind}&id=${encodeURIComponent(id)}`;
}

/** The served city a v3 cityId belongs to, if any. */
export async function siteForCityId(env: Env, cityId: string | null): Promise<CityConfig | null> {
  if (!cityId) return null;
  const cities = await api.cities(env);
  const slug = cities.find((c) => c.id === cityId)?.slug;
  return CITIES.find((c) => c.slug === slug) ?? null;
}
