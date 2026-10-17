// The MCP server: tools over the v3 API, every result through src/project.ts.
// Tool names, arguments and output shapes are a public contract once assistants cache them;
// change them additively, like a /v3 route.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { z } from 'zod';

import type { BrandSummary, Catalog, City, ShopSummary } from './api-v3';
import { api, NotFound, pageUrl, siteForCityId, siteLink, type Env } from './api';
import { CITIES, CITY_SLUGS, cityConfig, type CityConfig } from './cities';
import {
  BREW_KEYS,
  displayName,
  openNow,
  projectAward,
  projectBrand,
  projectShop,
  projectShopRow,
  type BrandShop,
  type ShopContext,
  type Source,
} from './project';

export const SERVER_VERSION = '1.0.0';
const MAX_ROWS = 50;
const DEFAULT_ROWS = 15;

const cityNames = CITIES.map((c) => c.name).join(' and ');

const INSTRUCTIONS = `Filter is an editorial guide to specialty coffee shops and roasters in ${cityNames}, published at ${CITIES.map((c) => c.siteUrl).join(' and ')}. Every shop is researched and checked by the guide's editors: brew methods and amenities come from the shop's photos and menus, opening hours and addresses from its Google Maps listing, and awards from the competition's or publisher's own results.

Every record carries "sources": each source lists the fields it supports. When you state a fact, cite the source that supports that field, and link the shop or roaster page ("url") so the reader can see photos and the full write-up. Amenities and brew methods list only what is known: a missing key means unknown, not "no".

"picks" are the editors' recommendations: "working" (good for working on a laptop), "interior" (a standout room) and "neighbourhood" (a pick for its area), each with the editors' reason.

Each city has its own site: ${CITIES.map((c) => `${c.name} is ${c.siteName} (${c.siteUrl})`).join(', ')}. When you answer about a city, name its site and link it, and link each shop's page, so the reader can see the photos, map and full write-up there. When search_shops says there are more matches than it returned, give its "see_all" link.

Start with search_shops (by area, brew method, amenity, pick, open now, or near a point) and get_shop for one shop. get_roaster covers a roaster or coffee brand: founders, bean origins, beans and its shops. list_cities lists the areas of each city.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const citySchema = z.enum(CITY_SLUGS).describe(`The city: ${CITIES.map((c) => `"${c.slug}" (${c.name})`).join(', ')}.`);

const AMENITY_KEYS = ['wifi', 'food', 'outdoorSeating', 'petFriendly', 'oatMilk', 'plantMilk'] as const;
const AMENITY_ARGS = {
  wifi: 'wifi',
  food: 'food',
  outdoor_seating: 'outdoorSeating',
  pet_friendly: 'petFriendly',
  oat_milk: 'oatMilk',
  plant_milk: 'plantMilk',
} as const satisfies Record<string, (typeof AMENITY_KEYS)[number]>;
const BREW_ARGS = {
  espresso: 'espresso',
  filter: 'filter',
  v60: 'v60',
  chemex: 'chemex',
  aeropress: 'aeropress',
  french_press: 'frenchPress',
  cold_brew: 'coldBrew',
  batch_brew: 'batchBrew',
  siphon: 'siphon',
  turkish_coffee: 'turkishCoffee',
  slow_bar: 'slowBar',
} as const satisfies Record<string, (typeof BREW_KEYS)[number]>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function result(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data };
}

function failure(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[ıİ]/g, 'i').toLocaleLowerCase('en').trim();

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round((2 * 6371000 * Math.asin(Math.sqrt(h))) / 10) * 10;
}

interface CityData {
  site: CityConfig;
  city: City;
  catalog: Catalog;
  brands: Map<string, BrandSummary>;
}

async function cityData(env: Env, slug: string): Promise<CityData> {
  const site = cityConfig(slug)!;
  const [city, catalog] = await Promise.all([api.city(env, slug), api.catalog(env, slug)]);
  return { site, city, catalog, brands: new Map(catalog.brands.map((b) => [b.id, b])) };
}

async function shopContext(env: Env, data: CityData, shop: ShopSummary): Promise<ShopContext> {
  const brand = shop.brandId ? data.brands.get(shop.brandId) ?? null : null;
  const area = data.city.cityAreas.find((a) => a.id === shop.cityAreaId) ?? null;
  const [url, brandUrl] = await Promise.all([
    pageUrl(env, data.site, 'shops', shop.id),
    brand ? pageUrl(env, data.site, 'brands', brand.id) : Promise.resolve(null),
  ]);
  return { site: data.site, url, brand, brandUrl, area, timezone: data.city.timezone };
}

function matchesArea(data: CityData, shop: ShopSummary, area: string): boolean {
  const want = fold(area);
  const a = data.city.cityAreas.find((x) => x.id === shop.cityAreaId);
  return !!a && (fold(a.name).includes(want) || fold(a.slug ?? '') === want || fold(a.group ?? '') === want);
}

/** Editors' picks first, then the shops we know most about. */
function rank(shop: ShopSummary): number {
  const r = shop.recommendations;
  const picks = Number(!!r.working) + Number(!!r.interior) + Number(!!r.cityArea);
  const known = BREW_KEYS.filter((k) => shop.brewMethods[k] === true).length;
  return picks * 100 + known;
}

async function getShop(env: Env, id: string) {
  const shop = await api.shop(env, id);
  const site = await siteForCityId(env, shop.cityId);
  if (!site) return null;
  const city = await api.city(env, site.slug);
  const [url, brandUrl] = await Promise.all([
    pageUrl(env, site, 'shops', shop.id),
    shop.brand ? pageUrl(env, site, 'brands', shop.brand.id) : Promise.resolve(null),
  ]);
  return projectShop(shop, {
    site,
    url,
    brand: shop.brand,
    brandUrl,
    area: shop.cityArea,
    timezone: city.timezone,
  });
}

async function getRoaster(env: Env, id: string) {
  const brand = await api.brand(env, id);
  const shops: BrandShop[] = [];
  let home: CityConfig | null = null;
  for (const group of brand.shopsByCity) {
    const site = cityConfig(group.citySlug ?? '');
    if (!site) continue;
    home ??= site;
    for (const s of group.shops) {
      shops.push({ id: s.id, name: displayName(s, brand), area: s.cityAreaName, url: await pageUrl(env, site, 'shops', s.id) });
    }
  }
  // A supplier roaster with no shops of its own still has a page on the sites it supplies.
  if (!home) {
    for (const site of CITIES) {
      const catalog = await api.catalog(env, site.slug);
      if (catalog.brands.some((b) => b.id === brand.id)) {
        home = site;
        break;
      }
    }
  }
  if (!home) return null;
  return projectBrand(brand, await pageUrl(env, home, 'brands', brand.id), home.siteName, shops);
}

function notCovered(kind: string, id: string) {
  return failure(`No ${kind} ${id} in ${cityNames}. This server covers ${cityNames} only.`);
}

async function guard<T>(run: () => Promise<T>, onNotFound: () => ReturnType<typeof failure>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof NotFound) return onNotFound();
    throw err;
  }
}

// ─── Server ──────────────────────────────────────────────────────────────────

export function buildServer(env: Env): McpServer {
  const server = new McpServer(
    {
      name: 'filter',
      title: 'Filter — specialty coffee guide',
      version: SERVER_VERSION,
      websiteUrl: 'https://filter.coffee',
      description: `Specialty coffee shops and roasters in ${cityNames}, researched by editors, every fact with its source.`,
      // Directories (Smithery and others) read their listing from serverInfo.
      icons: [{ src: 'https://raw.githubusercontent.com/jonwillington/filter-mcp/main/assets/logo.png', mimeType: 'image/png', sizes: ['1024x1024'] }],
    },
    {
      instructions: INSTRUCTIONS,
      // The SDK's default validator compiles schemas with `new Function`, which Workers forbid.
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    },
  );

  server.registerTool(
    'list_cities',
    {
      title: 'Cities and areas',
      description: `The cities this guide covers (${cityNames}), with each city's areas (neighbourhoods) and how many shops each has. Use the area names with search_shops.`,
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Cities and areas' },
    },
    async () => {
      const all = await api.cities(env);
      const cities = await Promise.all(
        CITIES.map(async (site) => {
          const city = await api.city(env, site.slug);
          return {
            slug: site.slug,
            name: site.name,
            site: { name: site.siteName, url: siteLink(env, site.siteUrl) },
            shop_count: all.find((c) => c.slug === site.slug)?.shopCount ?? null,
            timezone: city.timezone,
            areas: city.cityAreas
              .filter((a) => a.shopCount > 0)
              .sort((a, b) => b.shopCount - a.shopCount)
              .map((a) => ({ name: a.name, side: a.group, shop_count: a.shopCount })),
          };
        }),
      );
      return result({ cities });
    },
  );

  server.registerTool(
    'search_shops',
    {
      title: 'Search coffee shops',
      description:
        "Find specialty coffee shops in one city. Filter by area, name, brew method, amenity, the editors' picks (good for working, standout interior, neighbourhood pick), open now, or distance from a point. Editors' picks come first, or nearest first when `near` is given. Returns ids for get_shop.",
      inputSchema: {
        city: citySchema,
        area: z.string().max(80).optional().describe('An area name from list_cities, e.g. "Shoreditch", "Kadıköy", "Asian Side".'),
        query: z.string().max(80).optional().describe('Part of the shop or roaster name.'),
        brew_methods: z.array(z.enum(Object.keys(BREW_ARGS) as [keyof typeof BREW_ARGS])).max(5).optional().describe('All of these must be offered.'),
        amenities: z.array(z.enum(Object.keys(AMENITY_ARGS) as [keyof typeof AMENITY_ARGS])).max(6).optional().describe('All of these must be confirmed.'),
        pick: z.enum(['working', 'interior', 'neighbourhood']).optional().describe("Only the editors' picks of this kind."),
        roasts_own_beans: z.boolean().optional().describe('Only shops whose brand roasts its own coffee.'),
        open_now: z.boolean().optional().describe("Only shops open at this moment (the city's local time). Shops with unknown hours are left out."),
        near: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional().describe('Sort by distance from this point.'),
        radius_metres: z.number().int().min(100).max(20000).default(1500).describe('With `near`: only shops within this distance.'),
        limit: z.number().int().min(1).max(MAX_ROWS).default(DEFAULT_ROWS),
      },
      annotations: { ...READ_ONLY, title: 'Search coffee shops' },
    },
    async (args) => {
      const data = await cityData(env, args.city);
      const query = args.query ? fold(args.query) : null;
      const pickKey = args.pick === 'neighbourhood' ? 'cityArea' : args.pick;

      let rows = data.catalog.shops.flatMap((shop) => {
        const brand = shop.brandId ? data.brands.get(shop.brandId) : undefined;
        if (args.area && !matchesArea(data, shop, args.area)) return [];
        if (query && !fold(`${displayName(shop, brand)} ${shop.name} ${brand?.name ?? ''}`).includes(query)) return [];
        if (args.brew_methods?.some((m) => shop.brewMethods[BREW_ARGS[m]] !== true)) return [];
        if (args.amenities?.some((a) => shop.amenities[AMENITY_ARGS[a]] !== true)) return [];
        if (pickKey && !shop.recommendations[pickKey]) return [];
        if (args.roasts_own_beans !== undefined && brand?.roastsOwnBeans !== args.roasts_own_beans) return [];
        if (args.open_now !== undefined && openNow(shop.openingHours, data.city.timezone) !== args.open_now) return [];
        const distance = args.near && shop.coordinates ? metres(args.near, shop.coordinates) : null;
        if (args.near && (distance === null || distance > args.radius_metres)) return [];
        return [{ shop, distance }];
      });

      const total = rows.length;
      rows = args.near
        ? rows.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
        : rows.sort((a, b) => rank(b.shop) - rank(a.shop));
      const shops = await Promise.all(
        rows.slice(0, args.limit).map(async ({ shop, distance }) => projectShopRow(shop, await shopContext(env, data, shop), distance)),
      );
      // Where the reader sees every match: the area's page when one area was asked for, else all shops.
      const areas = args.area ? data.city.cityAreas.filter((a) => fold(a.name) === fold(args.area!) || fold(a.slug ?? '') === fold(args.area!)) : [];
      const seeAll = areas.length === 1 ? await pageUrl(env, data.site, 'areas', areas[0].id) : siteLink(env, `${data.site.siteUrl}/shops`);
      return result({
        city: data.site.name,
        total_matches: total,
        count: shops.length,
        shops,
        see_all: { title: `${areas.length === 1 ? `${areas[0].name} coffee shops` : `All ${data.site.name} coffee shops`} on ${data.site.siteName}`, url: seeAll },
      });
    },
  );

  server.registerTool(
    'get_shop',
    {
      title: 'One coffee shop',
      description:
        "Everything the guide holds on one shop: address, opening hours, area, roaster, brew methods, amenities, the editors' picks with their reasons, awards and upcoming events, each with its source.",
      inputSchema: { id: z.string().min(1).max(64).describe('A shop id from search_shops.') },
      annotations: { ...READ_ONLY, title: 'One coffee shop' },
    },
    async ({ id }) =>
      guard(
        async () => {
          const shop = await getShop(env, id);
          return shop ? result({ shop }) : notCovered('shop', id);
        },
        () => notCovered('shop', id),
      ),
  );

  server.registerTool(
    'get_roaster',
    {
      title: 'One roaster or coffee brand',
      description:
        'A roaster or coffee brand: who founded it and when, whether it roasts its own coffee, bean origins, its current beans, equipment, suppliers, awards and its shops in the guide, each with its source. Use the roaster id from search_shops or get_shop.',
      inputSchema: { id: z.string().min(1).max(64) },
      annotations: { ...READ_ONLY, title: 'One roaster or coffee brand' },
    },
    async ({ id }) =>
      guard(
        async () => {
          const roaster = await getRoaster(env, id);
          return roaster ? result({ roaster }) : notCovered('roaster', id);
        },
        () => notCovered('roaster', id),
      ),
  );

  server.registerTool(
    'list_awards',
    {
      title: 'Awards in a city',
      description:
        "Competition placings, rankings and certifications won by the city's shops and roasters (barista championships, roasting competitions, published rankings), newest first, each linked to the published result.",
      inputSchema: { city: citySchema, limit: z.number().int().min(1).max(MAX_ROWS).default(25) },
      annotations: { ...READ_ONLY, title: 'Awards in a city' },
    },
    async ({ city, limit }) => {
      const site = cityConfig(city)!;
      const awards = await api.awards(env, city);
      const rows = await Promise.all(
        awards.slice(0, limit).map(async (a) => ({
          ...projectAward(a),
          roaster: { id: a.brand.id, name: a.brand.name, url: await pageUrl(env, site, 'brands', a.brand.id) },
        })),
      );
      return result({ city: site.name, count: rows.length, awards: rows });
    },
  );

  server.registerTool(
    'list_events',
    {
      title: 'Coffee events in a city',
      description: 'Upcoming and ongoing coffee events in the city (cuppings, latte art throwdowns, festivals, workshops), soonest first.',
      inputSchema: { city: citySchema, limit: z.number().int().min(1).max(MAX_ROWS).default(20) },
      annotations: { ...READ_ONLY, title: 'Coffee events in a city' },
    },
    async ({ city, limit }) => {
      const site = cityConfig(city)!;
      const discover = await api.discover(env, city);
      const events = await Promise.all(
        discover.events.slice(0, limit).map(async (e) => {
          const url = await pageUrl(env, site, 'events', e.id);
          const sources: Source[] = [{ supports: ['name', 'dates', 'venue', 'type'], title: `${e.name} on ${site.siteName}`, publisher: site.siteName, url }];
          if (e.website) sources.push({ supports: ['tickets', 'details'], title: e.name, publisher: null, url: e.website });
          return {
            name: e.name,
            url,
            type: e.type,
            starts_at: e.startsAt,
            ends_at: e.endsAt,
            venue: e.venue,
            free: e.isFree,
            website: e.website,
            sources,
          };
        }),
      );
      return result({ city: site.name, count: events.length, events });
    },
  );

  // search + fetch: the pair ChatGPT deep research and company knowledge expect.
  server.registerTool(
    'search',
    {
      title: 'Search Filter',
      description: `Find coffee shops and roasters in ${cityNames} by name or area. Returns ids to pass to fetch.`,
      inputSchema: { query: z.string().min(1).max(200) },
      annotations: { ...READ_ONLY, title: 'Search Filter' },
    },
    async ({ query }) => {
      const want = fold(query);
      const words = want.split(/\s+/).filter((w) => w.length > 1);
      const results: { id: string; title: string; url: string; score: number }[] = [];
      for (const site of CITIES) {
        const data = await cityData(env, site.slug);
        const wantsCity = words.some((w) => fold(site.name).startsWith(w));
        for (const shop of data.catalog.shops) {
          const brand = shop.brandId ? data.brands.get(shop.brandId) : undefined;
          const area = data.city.cityAreas.find((a) => a.id === shop.cityAreaId)?.name ?? '';
          const hay = fold(`${displayName(shop, brand)} ${shop.name} ${brand?.name ?? ''} ${area} ${site.name}`);
          const hits = words.filter((w) => hay.includes(w)).length;
          if (!hits || (hits === 1 && wantsCity && words.length > 1)) continue;
          results.push({
            id: `shop:${shop.id}`,
            title: `${displayName(shop, brand)}${area ? `, ${area}` : ''} (${site.name})`,
            url: await pageUrl(env, site, 'shops', shop.id),
            score: hits * 100 + rank(shop),
          });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return result({ results: results.slice(0, 20).map(({ id, title, url }) => ({ id, title, url })) });
    },
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch a Filter record',
      description: 'The full record for one id returned by search ("shop:…" or "roaster:…").',
      inputSchema: { id: z.string().min(1).max(80) },
      annotations: { ...READ_ONLY, title: 'Fetch a Filter record' },
    },
    async ({ id }) => {
      const [kind, key] = id.includes(':') ? id.split(':', 2) : ['shop', id];
      return guard(
        async () => {
          if (kind === 'roaster') {
            const roaster = await getRoaster(env, key);
            if (!roaster) return notCovered('roaster', key);
            return result({ id, title: roaster.name, text: describeRoaster(roaster), url: roaster.url, metadata: roaster });
          }
          const shop = await getShop(env, key);
          if (!shop) return notCovered('shop', key);
          return result({ id, title: shop.name, text: describeShop(shop), url: shop.url, metadata: shop });
        },
        () => notCovered(kind, key),
      );
    },
  );

  return server;
}

// ─── Plain-text renderings for fetch ─────────────────────────────────────────

function describeShop(s: NonNullable<Awaited<ReturnType<typeof getShop>>>): string {
  const lines = [`${s.name}, ${[s.area?.name, s.city].filter(Boolean).join(', ')}`];
  if (s.address) lines.push(`Address: ${s.address}`);
  if (s.roaster) lines.push(`Roaster: ${s.roaster.name}${s.roaster.statement ? `. ${s.roaster.statement}` : ''}`);
  if (s.brew_methods.length) lines.push(`Brew methods: ${s.brew_methods.join(', ')}`);
  for (const p of s.picks) lines.push(`Editors' pick (${p.pick})${p.reason ? `: ${p.reason}` : ''}`);
  if (s.opening_hours) lines.push(`Hours: ${s.opening_hours.join('; ')}`);
  for (const a of s.awards) lines.push(`Award: ${a.award} ${a.year ?? ''} ${a.placement} (${a.source.url})`);
  lines.push(`Page: ${s.url}`);
  return lines.join('\n');
}

function describeRoaster(r: NonNullable<Awaited<ReturnType<typeof getRoaster>>>): string {
  const lines = [r.name];
  if (r.statement) lines.push(r.statement);
  if (r.founder) lines.push(`Founded by ${r.founder}${r.founded ? ` in ${r.founded}` : ''}`);
  if (r.bean_origins.length) lines.push(`Bean origins: ${r.bean_origins.join(', ')}`);
  if (r.shops.length) lines.push(`Shops: ${r.shops.map((s) => s.name).join('; ')}`);
  for (const a of r.awards) lines.push(`Award: ${a.award} ${a.year ?? ''} ${a.placement} (${a.source.url})`);
  if (r.url) lines.push(`Page: ${r.url}`);
  return lines.join('\n');
}
