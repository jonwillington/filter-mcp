/**
 * Filter API v3 — wire contract for the native apps.
 *
 * Served by `workers/api` at https://api.filter.coffee/v3/*.
 * The SwiftUI app mirrors these types by hand, so every change needs a note
 * in the PR description.
 *
 * Rules:
 * - Additive changes only. Removing or renaming a field, or changing its type,
 *   needs /v4: App Store builds can't be rolled back.
 * - Keys are camelCase. IDs are Strapi `documentId` strings.
 * - Every field is always present. Unknown values are `null`, never omitted.
 * - Timestamps are ISO 8601 UTC. Wall-clock times are "HH:mm" in the city's
 *   timezone (`City.timezone`).
 * - Records link to each other by ID. Nothing is copied in with a prefix.
 * - Only published, non-dev content is served.
 * - Every 200 response carries a strong ETag and honours If-None-Match (304).
 */

// ─── Envelope ─────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiMeta {
  /** Content version the response was built from. Same value as the ETag. */
  version: string;
  /** When this response body was generated (ISO 8601). */
  generatedAt: string;
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export type ApiErrorCode =
  | 'not_found'
  | 'bad_request'
  | 'method_not_allowed'
  | 'internal_error'
  /** 429: too many writes, or shop/brand/maker pages, from one address. */
  | 'rate_limited'
  /** 403: a browser on a site that isn't ours, or one of ours reading another city's data. Added 2026-10-14. */
  | 'forbidden'
  /** 502: the CMS didn't accept a write. */
  | 'upstream_error';

// ─── Shared shapes ────────────────────────────────────────────────────────────

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface Image {
  url: string;
  width: number | null;
  height: number | null;
  formats: ImageFormats;
}

export interface ImageFormats {
  thumbnail: ImageVariant | null;
  small: ImageVariant | null;
  medium: ImageVariant | null;
  large: ImageVariant | null;
}

export interface ImageVariant {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SocialLinks {
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  twitter: string | null;
  youtube: string | null;
  /** Added 2026-10-10 (additive). People only, so far. */
  linkedin: string | null;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface OpeningHours {
  /** Always seven entries, Monday first. */
  days: OpeningDay[];
}

export interface OpeningDay {
  weekday: Weekday;
  /**
   * - `open`: `ranges` has at least one entry
   * - `closed`: closed all day
   * - `open24h`: open all day
   * - `unknown`: no data for this day, or the source text couldn't be parsed
   */
  status: 'open' | 'closed' | 'open24h' | 'unknown';
  /** "HH:mm" in the city's timezone. A `close` at or before `open` means it closes after midnight. */
  ranges: TimeRange[];
  /** The source text for this day (e.g. "8:00 AM – 6:00 PM"), for display when `status` is `unknown`. */
  text: string | null;
}

export interface TimeRange {
  open: string;
  close: string;
}

// ─── Cities ───────────────────────────────────────────────────────────────────

/** GET /v3/cities */
export type CitiesResponse = ApiResponse<CityListItem[]>;

export interface CityListItem {
  id: string;
  slug: string;
  name: string;
  countryCode: string | null;
  shopCount: number;
}

/** GET /v3/cities/:city — `:city` is a slug (e.g. `istanbul`) or a documentId. */
export type CityResponse = ApiResponse<City>;

export interface City {
  id: string;
  slug: string;
  name: string;
  headline: string | null;
  /** Plain text. Paragraphs are separated by a blank line. */
  story: string | null;
  /**
   * Words in `story` that link to a neighbourhood, brand or shop. Every `text` appears in `story`; link its first
   * occurrence. Empty when the story has none. Added 2026-10-10 (additive).
   */
  storyLinks: StoryLink[];
  /** Who wrote `story`; null when it's uncredited or there's no story. Added 2026-10-10 (additive). */
  storyAuthor: StoryAuthor | null;
  /**
   * The headline and story in other languages, by language code ("tr"). A language is listed only when it has a
   * story; clients fall back to `headline`/`story` for any other. Added 2026-10-10 (additive).
   */
  translations: Record<string, CityStoryTranslation>;
  /** IANA timezone, e.g. "Europe/Istanbul". Opening hours are in this zone. */
  timezone: string | null;
  center: Coordinates | null;
  bounds: Bounds | null;
  /** Simplified outline (≤ ~150 points). `?boundaries=full` returns the source outline. */
  boundary: Coordinates[] | null;
  backgroundImage: Image | null;
  /** Credit for the background photo. Null until set in Strapi. */
  backgroundCredit: PhotoCredit | null;
  /** Focal point of the background photo as fractions 0–1 (0,0 = top-left). Null if unset. */
  backgroundFocus: { x: number; y: number } | null;
  /** Alt text for the background photo. */
  backgroundAlt: string | null;
  /** Up to 3 countries on the most distinct beans across the city's brands, most first. */
  topOrigins: TopOrigin[];
  /**
   * Beans the city's site features (home's beans shelf), chosen by hand, in order. Ids of published beans
   * (`Bean.id`); empty when none are chosen. Added 2026-10-13 (additive).
   */
  featuredBeanIds: string[];
  primaryColor: string | null;
  secondaryColor: string | null;
  country: Country;
  cityAreas: CityArea[];
}

/** A phrase in a story that links to a record: `kind` says which (`area` = a `CityArea`). */
export interface StoryLink {
  text: string;
  kind: 'area' | 'brand' | 'shop';
  id: string;
}

/** A story's byline: the person who wrote it. `id` is a `Person` id. */
export interface StoryAuthor {
  id: string;
  name: string;
  photo: Image | null;
  /** A line under the name, e.g. "Founder at Istanbrew". Null when unset. Added 2026-10-10 (additive). */
  affiliation: string | null;
  /** Plain text. Added 2026-10-10 (additive). */
  bio: string | null;
  links: SocialLinks;
  /** `bio` and `affiliation` in other languages, by language code. Added 2026-10-10 (additive). */
  translations: Record<string, { bio: string | null; affiliation: string | null }>;
}

/** A city's story in another language. Its links are its own, since the words differ ("Kadıköy’den"). */
export interface CityStoryTranslation {
  headline: string | null;
  story: string;
  storyLinks: StoryLink[];
}

export interface PhotoCredit {
  photographer: string;
  profileUrl: string | null;
  photoUrl: string | null;
  /** e.g. "Unsplash" */
  source: string;
}

export interface TopOrigin {
  name: string;
  /** ISO 3166-1 alpha-2, as in `Bean.origins`. */
  code: string | null;
  /** Distinct beans from this origin (a bean counts once per origin). */
  beanCount: number;
}

export interface Country {
  id: string;
  code: string | null;
  name: string;
  primaryColor: string | null;
  primaryColorDark: string | null;
  secondaryColor: string | null;
  secondaryColorDark: string | null;
  /** Second flag colour, strong enough for white text. Added 2026-10-10 (additive). */
  accentColour: string | null;
  /**
   * Dark mode: primaryColor lifted for links, buttons and headings on dark surfaces (put dark text on it).
   * Built from accentColour when the primary is black. Added 2026-10-10 (additive).
   */
  primaryColorOnDark: string | null;
  /** Dark mode: accentColour lifted the same way. Added 2026-10-10 (additive). */
  accentColourOnDark: string | null;
  highInflation: boolean | null;
}

export interface CityArea {
  id: string;
  slug: string | null;
  name: string;
  /** e.g. "European Side", "Asian Side". */
  group: string | null;
  summary: string | null;
  center: Coordinates | null;
  bounds: Bounds | null;
  /** Simplified outline (≤ ~100 points). `?boundaries=full` returns the source outline. */
  boundary: Coordinates[] | null;
  shopCount: number;
}

// ─── Catalog (the main call) ──────────────────────────────────────────────────

/** GET /v3/cities/:city/catalog */
export type CatalogResponse = ApiResponse<Catalog>;

export interface Catalog {
  cityId: string;
  shops: ShopSummary[];
  /** Brands of this city's shops, plus their suppliers. */
  brands: BrandSummary[];
  /**
   * The brands in `brands` that belong to this city: they have a shop here or are based here
   * (CMS homeLocation). Suppliers based elsewhere are left out, so city lists (roasters, beans)
   * show only local brands while shop pages can still name an out-of-town supplier.
   * Added 2026-10-12 (additive): treat a missing field as "every brand is local".
   */
  localBrandIds?: string[];
  /** Landmarks, museums, parks and ferry piers in this city. Most prominent first. Added 2026-09-24 (additive). */
  attractions: Attraction[];
}

export interface ShopSummary {
  id: string;
  slug: string | null;
  /** Full CMS name, e.g. "Kronotrop Moda - Istanbul". */
  name: string;
  /**
   * Branch name for chain shops, e.g. "Moda". Clients build the display name
   * from the brand: independent brand → brand name; other brand types →
   * "Brand · prefName" (or the brand name alone when this is null); no brand → `name`.
   * Added 2026-09-17 (additive).
   */
  prefName: string | null;
  brandId: string | null;
  cityId: string | null;
  cityAreaId: string | null;
  coordinates: Coordinates | null;
  address: string | null;
  heroImage: Image | null;
  openingHours: OpeningHours | null;
  /**
   * The shop's Google Maps rating, from the Places API (refreshed by the CMS, not live).
   * Null when the shop has no verified place or no reviews yet. Added 2026-09-26 (additive).
   */
  googleRating: GoogleRating | null;
  /** Shop value, falling back to the brand's default. */
  amenities: Amenities;
  /** Shop value, falling back to the brand's default. */
  brewMethods: BrewMethods;
  recommendations: Recommendations;
  /** Editorial quality tier from the CMS, e.g. "verified", "full-process", "draft". */
  qualityTier: string | null;
  /**
   * The recommendation reasons in other languages, by language code ("tr", "th"). A language is listed only when
   * it has at least one reason; clients fall back to `recommendations` for any reason it lacks. Since RESPONSE_SHAPE 22.
   */
  translations: Record<string, ShopTranslation>;
  /** Taste-matching tags, e.g. { look: { minimal: 1 }, special: { roastery: 2 } }. */
  preferenceProfile: Record<string, Record<string, number>> | null;
  updatedAt: string | null;
}

export interface GoogleRating {
  /** 1–5, one decimal place, as Google shows it. */
  stars: number;
  /** How many Google reviews the rating is from. Always at least 1. */
  reviewCount: number;
}

export interface Amenities {
  wifi: boolean | null;
  food: boolean | null;
  outdoorSeating: boolean | null;
  petFriendly: boolean | null;
  oatMilk: boolean | null;
  plantMilk: boolean | null;
}

export interface BrewMethods {
  espresso: boolean | null;
  filter: boolean | null;
  v60: boolean | null;
  chemex: boolean | null;
  aeropress: boolean | null;
  frenchPress: boolean | null;
  coldBrew: boolean | null;
  batchBrew: boolean | null;
  siphon: boolean | null;
  turkishCoffee: boolean | null;
  slowBar: boolean | null;
}

export interface ShopTranslation {
  cityAreaReason: string | null;
  workingReason: string | null;
  interiorReason: string | null;
}

export interface Recommendations {
  cityArea: boolean | null;
  cityAreaReason: string | null;
  working: boolean | null;
  /** Why it's a working pick, one or two sentences (CMS workingRecExp). Since RESPONSE_SHAPE 21. */
  workingReason: string | null;
  interior: boolean | null;
  /** Why its interior is a pick (CMS interiorRecExp). Since RESPONSE_SHAPE 21. */
  interiorReason: string | null;
  brewing: boolean | null;
}

export interface BrandSummary {
  id: string;
  name: string;
  /** "independent" | "smallChain" | "regionalChain" | … */
  type: string | null;
  /** 8–12 word headline. */
  statement: string | null;
  logo: Image | null;
  /**
   * The brand's colour, `#RRGGBB`, for the band at the top of its page. Can be pale: draw text and icons on it
   * in `brandColourInk`. Null when the brand has no colour of its own: draw a neutral with white text.
   * Added 2026-10-10 (additive).
   */
  brandColour: string | null;
  /** Text and icon colour on `brandColour`: `#FFFFFF`, or `#1C1C1C` on a pale colour. Null when `brandColour` is. Added 2026-10-10 (additive). */
  brandColourInk: string | null;
  /** `brandColour` lifted for text and accents on dark surfaces (dark text on it). Added 2026-10-10 (additive). */
  brandColourOnDark: string | null;
  roastsOwnBeans: boolean | null;
  supplierIds: string[];
}

// ─── Shop detail ──────────────────────────────────────────────────────────────

/** GET /v3/shops/:id */
export type ShopResponse = ApiResponse<ShopDetail>;

/**
 * A ranked shop from /v3/cities/:city/recommend or /v3/shops/:id/similar. Added 2026-10-17 (additive).
 * `reasons` are keys in the preference vocabulary: `purpose.working`, `look.raw`, `brew.v60`, `pick.city`,
 * `pick.working`, `pick.interior`, `pick.brewing`, `independent`. The signals behind the score stay server-side.
 */
export interface ShopMatch {
  shopId: string;
  score: number;
  reasons: string[];
  /** From `near` (recommend) or from the shop asked about (similar). */
  distanceMetres: number | null;
}

/** /v3/cities/:city/recommend and /v3/shops/:id/similar. Shops in `matches` order; brands of those shops. */
export interface ShopMatches {
  cityId: string;
  matches: ShopMatch[];
  shops: ShopSummary[];
  brands: BrandSummary[];
}

export interface ShopDetail extends ShopSummary {
  description: string | null;
  neighbourhood: string | null;
  phone: string | null;
  /** Shop value, falling back to the brand's. */
  links: SocialLinks;
  googlePlaceId: string | null;
  gallery: Image[];
  menus: Menu[];
  brand: BrandSummary | null;
  cityArea: CityAreaRef | null;
  coffeePartner: CoffeePartner | null;
  /** Upcoming and ongoing events at this shop, soonest first. */
  events: Event[];
  /**
   * Up to 3 attractions within walking distance, most prominent first, then nearest.
   * Never across the water (the attraction's city-area group must match the shop's).
   * Added 2026-09-24 (additive).
   */
  nearbyAttractions: NearbyAttraction[];
  /**
   * What the shop's description was written from, in the CMS's order. The shop's own
   * only: its brand's are on `BrandDetail.citedSources`. Added 2026-09-29 (additive).
   */
  citedSources: CitedSource[];
  /**
   * Awards, competition placings and rankings, each with a cited source: the brand's
   * brand-level results plus any for this shop. Newest first; empty when none.
   * Added 2026-10-04 (additive).
   */
  awards: AwardResult[];
}

/** Something a description or story cites: an article, the shop's own site, a social account. */
export interface CitedSource {
  /** Absolute http(s) URL. */
  url: string;
  /** The page's title. Falls back to the URL's host when the CMS has none. */
  title: string;
  /** Who published it. Often unknown for a shop's sources. */
  publisher: string | null;
}

export interface CityAreaRef {
  id: string;
  name: string;
  group: string | null;
}

export interface Menu {
  id: string;
  image: Image | null;
  isCurrent: boolean | null;
  validFrom: string | null;
  validTo: string | null;
  lastVerified: string | null;
}

export type AttractionCategory =
  | 'landmark'
  | 'religious'
  | 'palace'
  | 'museum'
  | 'market'
  | 'park'
  | 'street'
  | 'venue'
  | 'ferry';

export interface Attraction {
  id: string;
  /** English name, e.g. "Galata Tower". */
  name: string;
  /** Local-language name, e.g. "Galata Kulesi". */
  localName: string | null;
  slug: string | null;
  /** One of AttractionCategory. Clients should show a generic icon for values they don't know. */
  category: string | null;
  /** 1 = famous landmark, 2 = notable, 3 = local anchor. */
  prominence: number;
  cityId: string | null;
  cityAreaId: string | null;
  coordinates: Coordinates | null;
  /** Line along a long street or park edge. Distances use it when present. */
  outline: Coordinates[] | null;
  summary: string | null;
  image: Image | null;
  /** Photographer and licence, e.g. "A.Savin, FAL, via Wikimedia Commons". Show it wherever `image` is shown. Added 2026-09-25. */
  imageCredit: string | null;
  website: string | null;
}

export interface NearbyAttraction {
  id: string;
  name: string;
  localName: string | null;
  category: string | null;
  prominence: number;
  /** Straight-line distance, rounded to 10 m. */
  distanceMetres: number;
  /** Walking estimate: distance × 1.25 for street detours at 80 m a minute. At least 1. */
  walkMinutes: number;
}

export interface CoffeePartner {
  id: string;
  name: string;
  logo: Image | null;
  countryCode: string | null;
  primaryCategory: string | null;
  website: string | null;
  instagram: string | null;
}

// ─── Brand detail ─────────────────────────────────────────────────────────────

/** GET /v3/brands/:id */
export type BrandResponse = ApiResponse<BrandDetail>;

export interface BrandDetail extends BrandSummary {
  /** Plain text. Paragraphs are separated by a blank line. */
  story: string | null;
  description: string | null;
  founded: string | null;
  founder: string | null;
  hq: string | null;
  backgroundImage: Image | null;
  links: SocialLinks;
  ownRoastDescription: string | null;
  ownRoastCountries: CountryRef[];
  roastProfiles: { light: boolean | null; medium: boolean | null; dark: boolean | null };
  /** Free-form CMS JSON, e.g. { espresso: ["Victoria Arduino Eagle 1"], roasters: [] }. */
  equipment: Record<string, string[]> | null;
  /**
   * The entries of `equipment` that name a known maker, in equipment order; empty when none. Render `equipment` as
   * before and make a value a link when `equipmentMakers` has an entry with the same `key` and `label`.
   * Added 2026-10-13 (additive).
   */
  equipmentMakers: EquipmentMakerLink[];
  beans: Bean[];
  suppliers: BrandSummary[];
  /** This brand's shops, grouped by city. */
  shopsByCity: BrandCityShops[];
  /** What the brand's story was written from. Added 2026-09-29 (additive). */
  citedSources: CitedSource[];
  /**
   * All of the brand's award results, including shop-specific ones (`shopId` set).
   * Newest first; empty when none. Added 2026-10-04 (additive).
   */
  awards: AwardResult[];
  /**
   * Branded goods the brand sells (mugs, caps, totes), in the editor's order. Empty for
   * most brands. No prices: `productUrl` is the brand's own shop page. Added 2026-10-08 (additive).
   */
  merch: MerchItem[];
  /**
   * Coffee subscriptions the roaster sells on its own shop, in the editor's order. Empty for
   * most brands. No prices: `subscribeUrl` is the roaster's subscription page. Added 2026-10-08 (additive).
   */
  subscriptions: CoffeeSubscription[];
}

/** A maker of coffee equipment. Added 2026-10-13 (additive). */
export interface EquipmentMakerSummary {
  /** CMS documentId. */
  id: string;
  slug: string;
  name: string;
  logo: Image | null;
  /** What it makes: 'espresso' | 'grinders' | 'roasters' | 'brewers'. */
  kinds: string[];
  countryName: string | null;
  countryCode: string | null;
}

/** One equipment entry on a brand that names a known maker. Added 2026-10-13 (additive). */
export interface EquipmentMakerLink {
  /** The key in BrandDetail.equipment, exactly as stored ('espresso', 'grinders', 'grinder', ...). */
  key: string;
  /** The entry, exactly as it appears in BrandDetail.equipment[key]. */
  label: string;
  maker: EquipmentMakerSummary;
}

/** GET /v3/equipment-makers/:idOrSlug[?city=<slug>]. Added 2026-10-13 (additive). */
export type EquipmentMakerResponse = ApiResponse<EquipmentMakerDetail>;

/** GET /v3/cities/:city/equipment-makers. Added 2026-10-13 (additive). */
export type CityEquipmentMakersResponse = ApiResponse<EquipmentMakerDetail[]>;

export interface EquipmentMakerDetail extends EquipmentMakerSummary {
  /** Plain text. Paragraphs separated by a blank line. */
  bio: string | null;
  hq: string | null;
  foundedYear: number | null;
  website: string | null;
  instagram: string | null;
  citedSources: CitedSource[];
  /**
   * Brands whose equipment names this maker, by brand name. With ?city, only that city's brands
   * (same rule as Catalog.localBrandIds: a shop in the city, or based there).
   */
  usedBy: EquipmentMakerUse[];
}

export interface EquipmentMakerUse {
  brand: BrandSummary;
  /** The brand's matching entries, e.g. ["La Marzocco Linea PB", "La Marzocco GS3"]. */
  labels: string[];
}

export type AwardLevel = 'world' | 'continental' | 'national' | 'regional' | 'city' | 'other';

/** What an award is, for readers. Added 2026-10-11 (additive). */
export type AwardKind = 'competition' | 'ranking' | 'press' | 'certification';

export type AwardPlacement =
  | 'winner'
  | '1st'
  | '2nd'
  | '3rd'
  | 'finalist'
  | 'semi-finalist'
  | 'ranked'
  | 'listed'
  | 'honourable-mention'
  | 'other';

/** The competition, ranking or recognition itself. */
export interface Award {
  id: string;
  name: string;
  organiser: string | null;
  level: AwardLevel | null;
  /** e.g. 'barista', 'brewing', 'cafe-ranking', 'guide-listing'. Treat unknown values as generic. */
  category: string | null;
  website: string | null;
  /** Our own badge for the award. A result with its own badge (e.g. "100 Best 2025") shows that instead. */
  badge: Image | null;
  /** The organiser's logo. Only present when we may show it (usage 'press-kit' or 'permission'). */
  officialLogo: Image | null;
  /**
   * What the award is, for readers: a competition, a ranking, press coverage or a certification. Null when the
   * CMS hasn't classified it yet: fall back to `placement` and `level`. Added 2026-10-11 (additive).
   */
  kind: AwardKind | null;
  /**
   * The cited publication's or organiser's own site icon, small, to recognise the source beside a citation.
   * Not the official logo, which stays gated (see `officialLogo`). Added 2026-10-11 (additive).
   */
  sourceIcon: Image | null;
}

/** One cited win, placement or listing. Every result has a source. */
export interface AwardResult {
  id: string;
  award: Award;
  year: number | null;
  /** The award's own edition label when it is not just the year, e.g. '2025, Turkey'. */
  edition: string | null;
  placement: AwardPlacement;
  /** Position when `placement` is 'ranked'. */
  rank: number | null;
  /** Who won it, as named in the source. Null when the award went to the business. */
  recipientName: string | null;
  /** Set when the result is for one shop rather than the brand as a whole. */
  shopId: string | null;
  source: { url: string; title: string | null; publisher: string | null; archiveUrl: string | null };
}

/** One entry of `GET /v3/cities/:city/awards`: an award result plus who holds it. Added 2026-10-04 (additive). */
export type CityAward = AwardResult & {
  brand: {
    id: string;
    name: string;
    /** independent | smallChain | regionalChain | nationalChain | global */
    type: string | null;
    logo: Image | null;
    /** This brand's shops in the requested city. */
    shopCount: number;
  };
  /** Set only for shop-specific results. `area` is the city area name. */
  shop: { id: string; name: string; area: string | null } | null;
};

export type CityAwardsResponse = ApiResponse<CityAward[]>;

export interface CountryRef {
  name: string | null;
  code: string | null;
}

export interface BrandCityShops {
  cityId: string | null;
  cityName: string | null;
  citySlug: string | null;
  shops: BrandShopRef[];
}

export interface BrandShopRef {
  id: string;
  name: string;
  /** Branch name, see ShopSummary.prefName. Added 2026-09-17 (additive). */
  prefName: string | null;
  cityAreaName: string | null;
  coordinates: Coordinates | null;
  heroImage: Image | null;
}

export interface Bean {
  id: string;
  name: string;
  slug: string | null;
  /** "single-origin" | "blend" */
  type: string | null;
  roastLevel: string | null;
  process: string | null;
  shortDescription: string | null;
  fullDescription: string | null;
  region: string | null;
  farm: string | null;
  producer: string | null;
  altitude: string | null;
  cuppingScore: number | null;
  /** Free-form CMS JSON for blends. */
  blendComponents: unknown | null;
  photo: Image | null;
  learnMoreUrl: string | null;
  origins: CountryRef[];
  flavorTags: FlavorTag[];
}

export interface MerchItem {
  id: string;
  name: string;
  /** "mug" | "cup" | "glassware" | "tumbler" | "apparel" | "headwear" | "bag" | "accessory" | "other" */
  category: string | null;
  /** One or two plain sentences: material, maker, size. */
  description: string | null;
  /** Who made it when the brand names a partner, e.g. "Kinto". */
  maker: string | null;
  photo: Image | null;
  /** The product page on the brand's own shop. Always an absolute http(s) URL. */
  productUrl: string;
}

export interface CoffeeSubscription {
  id: string;
  name: string;
  /** "roasters-choice" (a different coffee each delivery) | "single-coffee" | "customisable" | "other" */
  coffeeChoice: string | null;
  /** Any of "filter", "espresso", "omni". */
  brewStyles: string[];
  /** As offered, e.g. ["250 g", "1 kg"]. */
  bagSizes: string[];
  /** Plain strings, e.g. ["Every 2 weeks", "Monthly"]. */
  frequencies: string[];
  /** Any of "whole-bean", "ground". */
  grindOptions: string[];
  /** Where it delivers when the roaster says, e.g. "UK". */
  shipsTo: string | null;
  /** One or two plain sentences. */
  description: string | null;
  photo: Image | null;
  /** The subscription page on the roaster's own shop. Always an absolute http(s) URL. */
  subscribeUrl: string;
}

export interface FlavorTag {
  id: string | null;
  name: string;
}

// ─── Discover ─────────────────────────────────────────────────────────────────

/**
 * GET /v3/cities/:city/discover?events=20&news=20
 * Limits default to 20 and cap at 50.
 */
export type DiscoverResponse = ApiResponse<Discover>;

export interface Discover {
  cityId: string;
  /** Upcoming and ongoing events, soonest first. */
  events: Event[];
  /** People with at least one pick in this city, and those picks. */
  people: PersonWithPicks[];
  /** News mentioning this city, or a shop or brand in it, newest first. */
  news: NewsArticle[];
  /** Brands referenced by `events`, `people` and `news`. */
  brands: BrandSummary[];
}

export interface Event {
  id: string;
  name: string;
  description: string | null;
  /** "festival" | "conference" | "competition" | … */
  type: string | null;
  startsAt: string | null;
  endsAt: string | null;
  cityId: string | null;
  venue: string | null;
  website: string | null;
  isFree: boolean | null;
  ticketPrice: number | null;
  ticketsAvailable: boolean | null;
  image: Image | null;
  hostBrandId: string | null;
  shopIds: string[];
}

export interface Person {
  id: string;
  name: string;
  slug: string | null;
  bio: string | null;
  photo: Image | null;
  /** Role slugs, e.g. ["critic"]. */
  roles: string[];
  affiliation: string | null;
  affiliatedShopId: string | null;
  /** The brand they work for when no single shop fits (e.g. wholesale across a chain); link `affiliation` to it when `affiliatedShopId` is null. Added 2026-10-27 (additive). */
  affiliatedBrandId: string | null;
  links: SocialLinks;
  /** `bio` and `affiliation` in other languages, by language code. Added 2026-10-10 (additive). */
  translations: Record<string, { bio: string | null; affiliation: string | null }>;
}

export interface PersonWithPicks extends Person {
  /** Picks for shops in the requested city, ordered by rank. */
  picks: PersonPick[];
  /**
   * Picks of a brand rather than a shop (a roaster that only sells beans), for brands whose home city or one of whose
   * shops is in the requested city, ordered by rank. Ranks are shared with `picks`. The brands are in `Discover.brands`.
   * Added 2026-10-27 (additive).
   */
  brandPicks: PersonBrandPick[];
}

export interface PersonBrandPick {
  id: string;
  brandId: string;
  rank: number | null;
  description: string | null;
  translations: Record<string, { description: string }>;
}

export interface PersonPick {
  id: string;
  shopId: string;
  rank: number | null;
  description: string | null;
  /** `description` in other languages, by language code. Added 2026-10-10 (additive). */
  translations: Record<string, { description: string }>;
}

export interface NewsArticle {
  id: string;
  title: string;
  slug: string | null;
  statement: string | null;
  summary: string | null;
  /** "YYYY-MM-DD" */
  publishedDate: string | null;
  type: string | null;
  importance: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  /** The outlet's logo (Time Out's, Sprudge's), to show beside `sourceName`; null when we have none. Added 2026-10-14 (additive). */
  sourceIcon: Image | null;
  author: string | null;
  image: Image | null;
  brandIds: string[];
  shopIds: string[];
  cityIds: string[];
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/** `work_nomination`: a reader nominating the shop as good for working, with why. Added 2026-10-17 (additive). */
export type ProposedUpdateType = 'shop_update' | 'menu_upload' | 'work_nomination';

/**
 * Body of `POST /v3/proposed-updates`: a reader saying a shop's information is wrong.
 * JSON, at most 8 KB. No sign-in; limited per IP address.
 */
export interface ProposedUpdateRequest {
  /** The shop's documentId. Must be a shop the API serves. */
  shopId: string;
  /** What's wrong, in the reader's words. 1–2,000 characters after trimming. */
  description: string;
  /** Defaults to `shop_update`. */
  updateType?: ProposedUpdateType;
}

/** `data` of the 201 response. */
export interface ProposedUpdateReceipt {
  /** The new entry's documentId in the CMS, if it said. */
  id: string | null;
  shopId: string;
  status: 'pending';
}
