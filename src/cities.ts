// The cities this server answers for, each with the city site its links point at.
// Adding one: its site must be live and publish /slug-history.json (every filter-city-web
// site does). Then add it here and deploy; tool descriptions pick it up from this list.

export interface CityConfig {
  /** The v3 city slug. */
  slug: string;
  name: string;
  /** The city site, canonical origin, no trailing slash (filter-city-web cities/<key>.ts). */
  siteUrl: string;
  siteName: string;
}

export const CITIES: CityConfig[] = [
  { slug: 'london', name: 'London', siteUrl: 'https://filter.coffee', siteName: 'filter' },
  { slug: 'istanbul', name: 'Istanbul', siteUrl: 'https://istanbrew.com', siteName: 'Istanbrew' },
];

export const CITY_SLUGS = CITIES.map((c) => c.slug) as [string, ...string[]];

export function cityConfig(slug: string): CityConfig | undefined {
  return CITIES.find((c) => c.slug === slug);
}
