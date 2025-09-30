import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import OpenAI from 'openai'
import { z } from 'zod'
import 'dotenv/config'

const app = new Hono()
  .use('*', logger())
  .use('*', cors())

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const _ok = <T>(c: any, data: T, status = 200) => c.json(data, status)
const _err = (c: any, message: string, status = 400) => c.json({ error: message }, status)

app.post('/api/generate', async (c) => {
  try {
    const body = await c.req.json()
    const schema = z.object({
      prompt: z.string().min(1, 'prompt_required'),
      size: z.enum(['1024x1024', '1024x1536', '1536x1024']).default('1024x1024')
    })
    const { prompt, size } = schema.parse(body)

    const out = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size,
      response_format: 'b64_json'
    })

    const b64 = out.data?.[0]?.b64_json
    if (!b64) return _err(c, 'no_image', 502)

    return _ok(c, { image_base64: b64 })
  } catch (e: any) {
    // Zod などのバリデーション・API エラーを握りつぶさずに返す
    return _err(c, e?.message ?? 'generate_failed', 500)
  }
})

app.get('/api/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port })
console.log(`[backend] http://localhost:${port}`)
console.log('[backend] OPENAI key loaded:', Boolean(process.env.OPENAI_API_KEY))
