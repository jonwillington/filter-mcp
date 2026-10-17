# filter-mcp

Filter's specialty coffee guide (London and Istanbul) as a remote MCP server, so people can
ask ChatGPT, Claude, Cursor or Gemini about coffee shops and get answers from the guide, with
a source for every fact and a link back to the city site.

**Endpoint:** `https://mcp.filter.coffee/mcp` (Streamable HTTP, stateless, read-only, no auth)

## Connect

- **Claude:** Settings → Connectors → Add custom connector → paste the URL.
- **ChatGPT:** Settings → Apps & Connectors → Developer mode → Create → the URL, auth "None".
- **Claude Code:** `claude mcp add --transport http filter https://mcp.filter.coffee/mcp`
- **Cursor / VS Code:** add an HTTP MCP server named `filter` with the URL.

## Tools

| Tool | What |
|---|---|
| `list_cities` | Cities, their areas and shop counts |
| `search_shops` | Shops in one city by area, name, brew method, amenity, editors' pick, open now, or near a point |
| `get_shop` | One shop: address, hours, roaster, brew methods, amenities, picks with reasons, awards, events |
| `get_roaster` | One roaster or brand: founders, bean origins, current beans, equipment, suppliers, awards, shops |
| `list_awards` | Competition placings and rankings won in a city, each linked to the published result |
| `list_events` | Upcoming coffee events in a city |
| `search` / `fetch` | The pair ChatGPT deep research expects (ids `shop:…`, `roaster:…`) |

## Sources

Every record has `sources`, and each source lists the fields it `supports`:

- the shop or roaster page on the city site → name, area, brew methods, amenities, picks
- the Google Maps listing → address, coordinates, opening hours
- the pages the editors researched from (`citedSources` in the CMS) → founder, founded, roasting, equipment
- each award carries its own `source`; each bean its `source_url` (the roaster's page for it)

## What is served (and what isn't)

Facts, the one-line brand statement and the editors' pick reasons, each with its source.
Not served: the long-form writing (brand stories, shop descriptions), `signals` and
`preferenceProfile`, and the Google star rating. See the header of `src/project.ts`.

## How it works

```
assistant ──► mcp.filter.coffee/mcp (this Worker) ──service binding──► filter-api (/v3) ──► D1 filter-db
                                    └──► <city site>/slug-history.json (page URLs)
```

It holds no data of its own. Published records only, the same as the apps and sites.

## Develop

```
npm install
npm run dev        # wrangler dev against the public api.filter.coffee
npm run smoke      # calls every tool against localhost:8787 (MCP_URL=… for production)
npm run typecheck
npm run sync:types # copy types/api-v3.ts from filter-website (FILTER_WEBSITE_PATH to override)
```

## Deploy

`npm run deploy` (wrangler). Once, before the first deploy:
`wrangler secret put API_BUILD_KEY` with filter-api's `BUILD_KEY`. Without it every call
reaches filter-api from this Worker and shares one bucket of its 120-a-minute limit on shop
and brand pages. This Worker's own `MCP_LIMITER` (300 a minute per caller) does that job.

## Adding a city

Add it to `src/cities.ts` (its site must be live) and deploy.
