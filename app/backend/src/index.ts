import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import 'dotenv/config'

type OrImage = { mime: string; base64: string }

const app = new Hono()
  .use('*', logger())
  .use('*', cors())

// ヘルスチェック
app.get('/api/health', (c) => c.json({ ok: true }))

// OpenRouter 画像生成（chat/completions + modalities=['image','text']）
async function or_generate_image(prompt: string, model?: string): Promise<OrImage> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set')

  const modelId =
    model || process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image-preview'

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_PUBLIC_URL || 'http://localhost:5173',
      'X-Title': 'ai-image-app'
    },
    body: JSON.stringify({
      model: modelId,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`openrouter_http_${res.status}: ${t}`)
  }

  const json: any = await res.json()
  const url: string | undefined =
    json?.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (!url || !url.startsWith('data:image/')) throw new Error('no_image_in_response')

  const m = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([^]+)$/)
  if (!m) throw new Error('malformed_data_url')
  return { mime: m[1], base64: m[2] }
}

// 生成API
app.post('/api/generate', async (c) => {
  try {
    const { prompt } = await c.req.json()
    if (!prompt || typeof prompt !== 'string') {
      return c.json({ error: 'prompt_required' }, 400)
    }
    const out = await or_generate_image(prompt)
    return c.json({ image_base64: out.base64, mime: out.mime })
  } catch (e: any) {
    const msg = String(e?.message || 'generate_failed')
    if (/openrouter_http_401|unauthorized|invalid/i.test(msg)) {
      return c.json({ error: 'invalid_openrouter_api_key' }, 401)
    }
    return c.json({ error: msg }, 500)
  }
})

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`[backend] http://localhost:${port}`)
