// filter-mcp: Filter's coffee guide as a remote MCP server, for ChatGPT, Claude, Cursor,
// Gemini and anything else that speaks Streamable HTTP.
//
//   Endpoint: https://mcp.filter.coffee/mcp   (stateless, read-only, no auth)
//
// Connecting:
//   - Claude:  Settings → Connectors → Add custom connector → paste the URL.
//   - ChatGPT: Settings → Apps & Connectors → Developer mode → Create → the URL, auth "None".
//   - Claude Code: `claude mcp add --transport http filter https://mcp.filter.coffee/mcp`.
//
// Stateless by design (one server per request, no sessions), as ddbx-data/worker/mcp.ts:
// a deploy never strands a live session.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';

import type { Env } from './api';
import { CITIES } from './cities';
import { buildServer, SERVER_VERSION } from './tools';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Authorization',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

/** The SDK 406s a POST whose Accept doesn't name both JSON and SSE (health checkers send
 *  `*\/*` or nothing). We only answer in JSON, so widen it. */
function withLenientAccept(req: Request): Request {
  const accept = (req.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('application/json') && accept.includes('text/event-stream')) return req;
  const headers = new Headers(req.headers);
  headers.set('accept', 'application/json, text/event-stream');
  return new Request(req, { headers });
}

/** The SDK 400s a protocol version it doesn't know; nothing we serve differs between
 *  versions, so answer at the newest we speak and let the client negotiate down. */
function withKnownProtocolVersion(req: Request): Request {
  const version = req.headers.get('mcp-protocol-version');
  if (!version || SUPPORTED_PROTOCOL_VERSIONS.includes(version)) return req;
  const headers = new Headers(req.headers);
  headers.set('mcp-protocol-version', LATEST_PROTOCOL_VERSION);
  return new Request(req, { headers });
}

/** Tool and method names from a JSON-RPC body, for the usage log. */
async function operations(req: Request): Promise<{ method: string; tool: string; city: string }[]> {
  try {
    const body = (await req.clone().json()) as unknown;
    const messages = Array.isArray(body) ? body : [body];
    return messages.map((m: { method?: unknown; params?: { name?: unknown; arguments?: { city?: unknown } } }) => ({
      method: String(m?.method ?? '-').slice(0, 40),
      tool: String(m?.params?.name ?? '-').slice(0, 40),
      city: String(m?.params?.arguments?.city ?? '-').slice(0, 40),
    }));
  } catch {
    return [];
  }
}

/** The assistant family, from the User-Agent (as ddbx-data/worker/mcp.ts clientFamily). */
function clientFamily(userAgent: string | null): string {
  const ua = (userAgent ?? '').toLowerCase();
  if (/chatgpt|openai/.test(ua)) return 'chatgpt';
  if (/claude|anthropic/.test(ua)) return 'claude';
  if (/cursor/.test(ua)) return 'cursor';
  if (/copilot|vscode|visual studio code/.test(ua)) return 'vscode';
  if (/gemini|google/.test(ua)) return 'gemini';
  if (/smithery/.test(ua)) return 'smithery';
  return 'assistant';
}

async function handleMcp(req: Request, env: Env): Promise<Response> {
  const started = Date.now();
  const ops = await operations(req);
  const client = clientFamily(req.headers.get('user-agent'));
  const server = buildServer({ ...env, CLIENT: client });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  let status = 500;
  try {
    const res = await transport.handleRequest(withKnownProtocolVersion(withLenientAccept(req)));
    status = res.status;
    return res;
  } finally {
    for (const op of ops.length ? ops : [{ method: '-', tool: '-', city: '-' }]) {
      console.log(JSON.stringify({ event: 'mcp_usage', ...op, status, ms: Date.now() - started, client }));
    }
  }
}

const ABOUT = {
  name: 'Filter MCP server',
  version: SERVER_VERSION,
  endpoint: 'https://mcp.filter.coffee/mcp',
  transport: 'streamable-http',
  auth: 'none',
  cities: CITIES.map((c) => ({ name: c.name, site: c.siteUrl })),
  docs: 'https://github.com/jonwillington/filter-mcp',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/' || url.pathname === '') {
      return Response.json(ABOUT, { headers: CORS });
    }

    if (url.pathname === '/mcp') {
      if (req.method !== 'POST') {
        // Stateless: no SSE stream to open, no session to delete.
        return withCors(Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }, { status: 405, headers: { Allow: 'POST, OPTIONS' } }));
      }
      if (env.MCP_LIMITER) {
        const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
        const { success } = await env.MCP_LIMITER.limit({ key: `mcp:${ip}` });
        if (!success) {
          return withCors(Response.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests. Try again in a minute.' }, id: null }, { status: 429, headers: { 'Retry-After': '60' } }));
        }
      }
      try {
        return withCors(await handleMcp(req, env));
      } catch (err) {
        console.error('mcp error', err);
        return withCors(Response.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error.' }, id: null }, { status: 500 }));
      }
    }

    return Response.json({ error: 'not_found' }, { status: 404, headers: CORS });
  },
} satisfies ExportedHandler<Env>;
