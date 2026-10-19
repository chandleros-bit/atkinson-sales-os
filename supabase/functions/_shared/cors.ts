// CORS for edge functions the browser calls via supabase.functions.invoke().
// The browser sends an OPTIONS preflight first (invoke adds authorization,
// apikey and x-client-info headers), and every real response must carry
// Access-Control-Allow-Origin too, or the browser drops it and invoke reports
// a fetch error. Same header set as crm-action's CORS block.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Wraps a Deno.serve handler: answers the preflight without running the
// handler, and adds the CORS headers to whatever the handler returns
// (including its error responses). A handler that throws becomes a 500 JSON
// body with CORS, so the browser sees the message instead of a CORS failure.
// Server-to-server callers like pg_cron ignore the extra headers, so wrapping
// a cron-driven function is harmless.
export function withCors(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    let res: Response
    try {
      res = await handler(req)
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
        status: 500,
        headers: { ...CORS, 'content-type': 'application/json' },
      })
    }
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
