// What leaves this server. Every record goes through a `project*` function here, and every
// record carries `sources`: each source names the fields it backs (`supports`), so an
// assistant can cite the right page for each fact.
//
// PAYLOAD POLICY (Jon 2026-10-17): facts, the one-line brand statement and the pick reasons,
// each with its source, plus a link to the page on the city site. Never the long-form
// writing (brand `story`, shop `description`, `ownRoastDescription`, bean `fullDescription`),
// never `signals` or `preferenceProfile`, never the Google star rating. The writing is what
// the sites are for; an MCP server is a bulk channel. Add a field here only if it is a fact
// a source can back.
//
// Field names and shapes are a public contract once assistants cache them: additive only.

import type {
  AwardResult,
  BrandDetail,
  BrandSummary,
  BrewMethods,
  CitedSource,
  CityArea,
  CityOffers,
  Offer,
  OpeningHours,
  ShopDetail,
  ShopSummary,
} from './api-v3';
import type { CityConfig } from './cities';

export interface Source {
  /** The fields of this record the source backs. */
  supports: string[];
  title: string;
  publisher: string | null;
  url: string;
}

// ─── Names (port of filter-city-web lib/domain/names.ts) ─────────────────────

const SEP = /[-–—·|:,\s]/;
const SEP_EDGES = /^[-–—·|:,\s]+|[-–—·|:,\s]+$/g;
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');

export const isIndependent = (b: { type: string | null } | null | undefined) =>
  b?.type?.trim().toLowerCase() === 'independent';

function branchName(prefName: string | null | undefined, brand: string): string | null {
  let pref = prefName?.replace(SEP_EDGES, '') ?? '';
  if (!pref) return null;
  const brandName = brand.trim();
  if (brandName && fold(brandName).startsWith(fold(pref))) {
    const next = brandName.charAt(pref.length);
    if (next === '' || next === ' ') return null;
  }
  const candidates = [brandName, brandName.split(' ')[0]].filter((c) => c.length >= 3);
  for (const candidate of candidates) {
    if (!fold(pref).startsWith(fold(candidate))) continue;
    const rest = pref.slice(candidate.length);
    if (!rest || !SEP.test(rest.charAt(0))) continue;
    const trimmed = rest.replace(SEP_EDGES, '');
    if (trimmed) pref = trimmed;
    break;
  }
  return pref;
}

/** The name the sites and apps show: "Brand · Branch" for chains, the brand for independents. */
export function displayName(shop: { name: string; prefName: string | null }, brand: BrandSummary | null | undefined): string {
  if (!brand?.name) return shop.name;
  if (isIndependent(brand)) return brand.name;
  const branch = branchName(shop.prefName, brand.name);
  return branch ? `${brand.name} · ${branch}` : brand.name;
}

// ─── Small pieces ────────────────────────────────────────────────────────────

const BREW_LABELS: Record<keyof BrewMethods, string> = {
  espresso: 'espresso',
  filter: 'filter',
  v60: 'V60',
  chemex: 'Chemex',
  aeropress: 'AeroPress',
  frenchPress: 'French press',
  coldBrew: 'cold brew',
  batchBrew: 'batch brew',
  siphon: 'siphon',
  turkishCoffee: 'Turkish coffee',
  slowBar: 'slow bar',
};
export const BREW_KEYS = Object.keys(BREW_LABELS) as (keyof BrewMethods)[];

/** Only what is known: `true` and `false` both mean a source said so; unknown is left out. */
function known<T extends object>(flags: T): Partial<Record<keyof T, boolean>> {
  const out: Partial<Record<keyof T, boolean>> = {};
  for (const [k, v] of Object.entries(flags)) if (typeof v === 'boolean') out[k as keyof T] = v;
  return out;
}

function brewMethods(b: BrewMethods): string[] {
  return BREW_KEYS.filter((k) => b[k] === true).map((k) => BREW_LABELS[k]);
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon 08:00–18:00", "Sun closed". Null when no day is known. */
function hoursLines(hours: OpeningHours | null): string[] | null {
  if (!hours?.days?.length) return null;
  const lines = hours.days.map((d) => {
    const day = WEEKDAYS[d.weekday - 1];
    if (d.status === 'closed') return `${day} closed`;
    if (d.status === 'open24h') return `${day} open 24 hours`;
    if (d.status === 'open') return `${day} ${d.ranges.map((r) => `${r.open}–${r.close}`).join(', ')}`;
    return d.text ? `${day} ${d.text}` : `${day} unknown`;
  });
  return hours.days.some((d) => d.status !== 'unknown') ? lines : null;
}

/** Whether the shop is open at this moment in the city's timezone; null when hours are unknown. */
export function openNow(hours: OpeningHours | null, timezone: string | null, now = new Date()): boolean | null {
  if (!hours?.days?.length || !timezone) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WEEKDAYS.indexOf(get('weekday')) + 1;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

  const today = hours.days.find((d) => d.weekday === weekday);
  const yesterday = hours.days.find((d) => d.weekday === (weekday === 1 ? 7 : weekday - 1));
  if (!today || today.status === 'unknown') return null;
  if (today.status === 'open24h') return true;

  // A range from yesterday that runs past midnight.
  for (const r of yesterday?.status === 'open' ? yesterday.ranges : []) {
    if (toMin(r.close) <= toMin(r.open) && minutes < toMin(r.close)) return true;
  }
  if (today.status === 'closed') return false;
  return today.ranges.some((r) => {
    const open = toMin(r.open);
    const close = toMin(r.close);
    return close <= open ? minutes >= open : minutes >= open && minutes < close;
  });
}

function googleMapsUrl(name: string, address: string | null, placeId: string | null): string {
  const q = encodeURIComponent([name, address].filter(Boolean).join(', '));
  return placeId
    ? `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(placeId)}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function cited(list: CitedSource[], supports: string[]): Source[] {
  return list.map((s) => ({ supports, title: s.title, publisher: s.publisher, url: s.url }));
}

function picks(shop: ShopSummary) {
  const r = shop.recommendations;
  const out: { pick: 'working' | 'interior' | 'neighbourhood'; reason: string | null }[] = [];
  if (r.working) out.push({ pick: 'working', reason: r.workingReason });
  if (r.interior) out.push({ pick: 'interior', reason: r.interiorReason });
  if (r.cityArea) out.push({ pick: 'neighbourhood', reason: r.cityAreaReason });
  return out;
}

const PLACEMENT: Record<string, string> = {
  winner: 'winner',
  '1st': '1st place',
  '2nd': '2nd place',
  '3rd': '3rd place',
  finalist: 'finalist',
  'semi-finalist': 'semi-finalist',
  ranked: 'ranked',
  listed: 'listed',
  'honourable-mention': 'honourable mention',
  other: 'other',
};

export function projectAward(a: AwardResult) {
  return {
    award: a.award.name,
    organiser: a.award.organiser,
    kind: a.award.kind,
    level: a.award.level,
    year: a.year,
    placement: PLACEMENT[a.placement] ?? a.placement,
    rank: a.rank,
    recipient: a.recipientName,
    source: { title: a.source.title ?? a.award.name, publisher: a.source.publisher, url: a.source.url },
  };
}

// ─── Shops ───────────────────────────────────────────────────────────────────

export interface ShopContext {
  site: CityConfig;
  url: string;
  brand: BrandSummary | null;
  brandUrl: string | null;
  area: Pick<CityArea, 'id' | 'name' | 'group'> | null;
  timezone: string | null;
}

/** One row of search_shops: enough to choose, with get_shop for the rest. */
export function projectShopRow(shop: ShopSummary, ctx: ShopContext, distanceMetres: number | null) {
  const name = displayName(shop, ctx.brand);
  return {
    id: shop.id,
    name,
    url: ctx.url,
    area: ctx.area?.name ?? null,
    address: shop.address,
    distance_metres: distanceMetres,
    open_now: openNow(shop.openingHours, ctx.timezone),
    roaster: ctx.brand ? { id: ctx.brand.id, name: ctx.brand.name, roasts_own_beans: ctx.brand.roastsOwnBeans } : null,
    brew_methods: brewMethods(shop.brewMethods),
    amenities: known(shop.amenities),
    picks: picks(shop),
    sources: [
      {
        supports: ['name', 'area', 'roaster', 'brew_methods', 'amenities', 'picks'],
        title: `${name} on ${ctx.site.siteName}`,
        publisher: ctx.site.siteName,
        url: ctx.url,
      },
      {
        supports: ['address', 'open_now'],
        title: 'Google Maps',
        publisher: 'Google',
        url: googleMapsUrl(name, shop.address, null),
      },
    ] satisfies Source[],
  };
}

export function projectShop(shop: ShopDetail, ctx: ShopContext) {
  const name = displayName(shop, ctx.brand);
  const sources: Source[] = [
    {
      supports: ['name', 'area', 'roaster', 'brew_methods', 'amenities', 'picks', 'coffee_partner'],
      title: `${name} on ${ctx.site.siteName}`,
      publisher: ctx.site.siteName,
      url: ctx.url,
    },
    {
      supports: ['address', 'coordinates', 'opening_hours', 'open_now'],
      title: 'Google Maps listing',
      publisher: 'Google',
      url: googleMapsUrl(name, shop.address, shop.googlePlaceId),
    },
    ...cited(shop.citedSources, ['research']),
  ];
  if (shop.links.website) sources.push({ supports: ['website'], title: `${name} website`, publisher: name, url: shop.links.website });

  return {
    id: shop.id,
    name,
    url: ctx.url,
    city: ctx.site.name,
    area: ctx.area ? { name: ctx.area.name, side: ctx.area.group } : null,
    neighbourhood: shop.neighbourhood,
    address: shop.address,
    coordinates: shop.coordinates,
    opening_hours: hoursLines(shop.openingHours),
    timezone: ctx.timezone,
    open_now: openNow(shop.openingHours, ctx.timezone),
    roaster: ctx.brand
      ? {
          id: ctx.brand.id,
          name: ctx.brand.name,
          url: ctx.brandUrl,
          kind: ctx.brand.type,
          statement: ctx.brand.statement,
          roasts_own_beans: ctx.brand.roastsOwnBeans,
        }
      : null,
    coffee_partner: shop.coffeePartner ? { name: shop.coffeePartner.name, website: shop.coffeePartner.website } : null,
    brew_methods: brewMethods(shop.brewMethods),
    amenities: known(shop.amenities),
    picks: picks(shop),
    awards: shop.awards.map(projectAward),
    upcoming_events: shop.events.slice(0, 5).map((e) => ({ name: e.name, starts_at: e.startsAt, ends_at: e.endsAt, website: e.website })),
    links: { website: shop.links.website, instagram: shop.links.instagram },
    sources,
  };
}

// ─── Roasters and brands ─────────────────────────────────────────────────────

export interface BrandShop {
  id: string;
  name: string;
  area: string | null;
  url: string;
}

export function projectBrand(brand: BrandDetail, url: string | null, siteName: string | null, shops: BrandShop[]) {
  const sources: Source[] = [];
  if (url && siteName) {
    sources.push({ supports: ['name', 'statement', 'kind', 'shops', 'suppliers'], title: `${brand.name} on ${siteName}`, publisher: siteName, url });
  }
  sources.push(...cited(brand.citedSources, ['founder', 'founded', 'hq', 'roasts_own_beans', 'roast_profiles', 'equipment']));
  if (brand.links.website) sources.push({ supports: ['website', 'beans'], title: `${brand.name} website`, publisher: brand.name, url: brand.links.website });

  return {
    id: brand.id,
    name: brand.name,
    url,
    kind: brand.type,
    statement: brand.statement,
    founder: brand.founder,
    founded: brand.founded ? brand.founded.slice(0, 4) : null,
    hq: brand.hq,
    roasts_own_beans: brand.roastsOwnBeans,
    bean_origins: brand.ownRoastCountries.map((c) => c.name).filter(Boolean),
    roast_profiles: known(brand.roastProfiles),
    equipment: brand.equipment,
    // Each bean's own page is its source (the roaster's shop page, where we read it).
    beans: brand.beans.slice(0, 40).map((b) => ({
      name: b.name,
      type: b.type,
      origins: b.origins.map((o) => o.name).filter(Boolean),
      region: b.region,
      farm: b.farm,
      producer: b.producer,
      process: b.process,
      roast_level: b.roastLevel,
      altitude: b.altitude,
      flavour_notes: b.flavorTags.map((t) => t.name),
      source_url: b.learnMoreUrl,
    })),
    suppliers: brand.suppliers.map((s) => ({ id: s.id, name: s.name })),
    shops,
    awards: brand.awards.map(projectAward),
    links: { website: brand.links.website, instagram: brand.links.instagram },
    sources,
  };
}

// ─── Offers ──────────────────────────────────────────────────────────────────

/** The offer a shop page shows (its own, else its brand's), or null. */
export function offerForShop(offers: CityOffers | null, shopId: string): Offer | null {
  const id = offers?.byShop[shopId];
  return (id && offers?.offers.find((o) => o.id === id)) || null;
}

/** The offer a brand page shows, or null. */
export function offerForBrand(offers: CityOffers | null, brandId: string): Offer | null {
  const id = offers?.byBrand[brandId];
  return (id && offers?.offers.find((o) => o.id === id)) || null;
}

/** A promotion a brand runs at its shops. The terms are the brand's, so the note says so. The source is
 *  the guide page that shows the offer. `shopId` lists that shop first. */
export function projectOffer(
  offer: Offer,
  brand: { name: string; type: string | null } | null,
  source: { url: string; siteName: string } | null,
  shopId?: string,
) {
  const inStore = offer.redeem !== 'online';
  const online = offer.redeem !== 'in-store';
  const shops = [...offer.shops].sort((a, b) => Number(b.id === shopId) - Number(a.id === shopId));
  return {
    id: offer.id,
    tag: offer.tag,
    details: offer.details,
    terms: offer.terms,
    ends: offer.endsAt ? offer.endsAt.slice(0, 10) : null,
    run_by: offer.brandName,
    note: `Offer run by ${offer.brandName}. Their terms apply; Filter isn't responsible for it.`,
    redeem: {
      how: offer.redeem,
      ...(inStore
        ? {
            all_shops: offer.allShops,
            shops: shops.map((s) => ({
              id: s.id,
              name: displayName(s, brand as BrandSummary | null),
              area: s.cityAreaName,
              address: s.address,
            })),
          }
        : {}),
      ...(online ? { url: offer.url, code: offer.code } : {}),
    },
    translations: offer.translations,
    sources: source
      ? ([{ supports: ['offer'], title: `${offer.brandName} on ${source.siteName}`, publisher: source.siteName, url: source.url }] satisfies Source[])
      : [],
  };
}
