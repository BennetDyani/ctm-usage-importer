// Phase 0 checkpoint: proves Vercel is running our server-side functions.
// Uses the Web-standard signature (Request -> Response), so no Vercel-specific
// package is needed. Phase 2 adds a database check here.
export function GET(): Response {
  return Response.json(
    {
      status: 'ok',
      service: 'ctm-usage-importer',
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
