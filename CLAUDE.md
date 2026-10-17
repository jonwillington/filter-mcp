# filter-mcp

Filter's coffee guide as a public MCP server. Read README.md first.

- **Contract.** Tool names, arguments and output fields are public once assistants cache them.
  Additive changes only, like a /v3 route.
- **Payload policy** is in the header of `src/project.ts`: facts with sources, never the
  long-form writing, `signals`, `preferenceProfile` or the Google rating. Every new field needs
  a source in `sources[].supports`.
- **Types.** `src/api-v3.ts` is a copy of filter-website `types/api-v3.ts`. `npm run check:types`.
- **No data here.** Everything comes from filter-api /v3 and the city sites' slug maps.
- **Production.** `npm run deploy` goes live at once. Run `npm run dev` + `npm run smoke` first.
