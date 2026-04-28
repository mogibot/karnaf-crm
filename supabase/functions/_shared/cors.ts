// Origin allowlist. Browser-facing endpoints reflect a single allowed origin
// rather than wildcarding so cookies/credentials can never leak.

const allowList = (Deno.env.get('CORS_ALLOWED_ORIGINS') || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowed = allowList.includes(origin) ? origin : allowList[0] || 'http://localhost:5173';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  }
  return null;
}

export function jsonResponse(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
