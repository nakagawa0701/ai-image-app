import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import 'dotenv/config'

const app = new Hono()
app.use('*', logger())
app.use('*', cors())

app.get('/api/health', (c) => c.json({ ok: true }))

// ここに /api/generate, /api/edit を後で追加する

const port = Number(process.env.PORT ?? 8787)
console.log(`[backend] listening on http://localhost:${port}`)
export default app

