import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'

// Dev only: serve api/*.ts (the Vercel functions) from `npm run dev`, so the whole app runs
// locally without a Vercel login. Production never uses this; Vercel runs api/ itself.
function localApi(): Plugin {
  return {
    name: 'local-vercel-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const match = /^\/api\/([a-z0-9-]+)$/.exec(url.pathname)
        if (!match) return next()
        try {
          const mod = await server.ssrLoadModule(`/api/${match[1]}.ts`)
          const handler = mod[req.method ?? 'GET']
          if (typeof handler !== 'function') {
            res.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'method_not_allowed' }))
            return
          }
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const body = chunks.length ? Buffer.concat(chunks) : undefined
          const request = new Request(url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          })
          const response: Response = await handler(request)
          res.writeHead(response.status, Object.fromEntries(response.headers))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          server.ssrFixStacktrace(err as Error)
          console.error(err)
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'server_error', message: 'Local API error, see terminal.' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Make .env.local (git-ignored) available to the api/ handlers in dev, like Vercel env vars.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return { plugins: [react(), localApi()] }
})
