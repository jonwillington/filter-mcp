# Submission pack

What the directories ask for, drafted. The server is public, read-only and needs no account,
so no test credentials are needed anywhere.

## Listing

| Field | Value |
|---|---|
| Name | Filter |
| Short description | Specialty coffee shops in London and Istanbul |
| Long description | Filter is an editorial guide to specialty coffee in London and Istanbul. Every shop is researched and checked by the guide's editors: brew methods and amenities from the shop's photos and menus, opening hours from its Google Maps listing, awards from the competition's own results. Ask where to get a V60 near you that's open now, which shops in Kadıköy are good for working, or who roasts the coffee at a café. Every fact comes with its source and a link to the shop's page. |
| Category | Lifestyle (ChatGPT: "Lifestyle"; Claude: "Travel" or "Lifestyle") |
| Website | https://filter.coffee |
| Support | https://filter.coffee/contact |
| Privacy policy | https://filter.coffee/privacy |
| Terms | https://filter.coffee/terms |
| Logo | `assets/logo.png` (1024×1024), `assets/icon.png` (256×256) |

**Before submitting:** the privacy policy (filter-city-web `components/legal/documents.ts`) covers
site visits but not the connector. Add a line: requests to mcp.filter.coffee are logged with the
tool name, city and the calling app's user agent (Cloudflare Workers logs, kept a few days), and
the caller's IP address is used for rate limiting only. No account, no personal data.

## MCP

| Field | Value |
|---|---|
| Server URL | https://mcp.filter.coffee/mcp |
| Transport | Streamable HTTP (JSON responses), stateless |
| Authentication | None |
| CSP | Not needed: no UI resources |
| Tool annotations | Every tool `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` |
| Domain verification (ChatGPT) | Serve the portal's token at `https://mcp.filter.coffee/.well-known/openai-apps-challenge` (add to `src/index.ts` when the portal issues it) |

## Starter prompts

1. Where can I get a V60 in Shoreditch that's open now?
2. Which coffee shops in Kadıköy are good for working on a laptop?
3. Who roasts the coffee at Meet Lab Coffee, and where are their beans from?
4. Which London coffee shops have won awards recently?

## Positive test cases

Results change as the guide is updated, so the shape is what's tested, not specific rows.

| # | Prompt | Expected behaviour |
|---|---|---|
| 1 | Find me a filter coffee spot near Old Street that's open now. | `search_shops` with `city: "london"`, `brew_methods` including `v60` or `filter`, `open_now: true`, and `near` around Old Street. Lists shops by distance with links. |
| 2 | Good places to work from in Kadıköy? | `search_shops` with `city: "istanbul"`, `area: "Kadıköy"`, `pick: "working"`. Quotes the editors' reasons and links each shop. |
| 3 | Tell me about Meet Lab Coffee. | `search` or `search_shops`, then `get_shop` / `get_roaster`. Gives hours, brew methods, awards with their source links. |
| 4 | What awards have Istanbul roasters won? | `list_awards` with `city: "istanbul"`. Each award cites its published result. |
| 5 | Any coffee events in London coming up? | `list_events` with `city: "london"`. Dates, venues, links. |

## Negative test cases

| # | Prompt | Expected behaviour |
|---|---|---|
| 1 | Best coffee shops in Paris? | Says the guide covers London and Istanbul only; no substitute results. |
| 2 | What's the Google rating of this shop? | Says the guide doesn't serve ratings and links the shop page and its Google Maps listing. |
| 3 | Write me the full review of this shop. | Gives the facts and the editors' pick reason, links the shop page for the full write-up; does not invent a review. |

## Where to submit

- **MCP Registry:** `mcp-publisher login github` then `mcp-publisher publish` (reads `server.json`).
- **Smithery:** smithery.ai → Add server → URL.
- **Claude connectors directory:** Anthropic's connector submission form.
- **ChatGPT apps:** the OpenAI apps / plugin submission portal, "With MCP".
- **Gemini CLI:** `gemini extensions install https://github.com/jonwillington/filter-mcp` (works as soon as the repo is public; reads `gemini-extension.json`).
