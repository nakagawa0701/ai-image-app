import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import 'dotenv/config'

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { registerEditRoutes } from './routes/edit'
import { registerImagesRoutes } from './routes/images'
import { DIR_GENERATED, DIR_EDITS, isSafeFileName } from '../lib/image-io'
import { registerUploadRoutes } from './routes/upload'
import { registerSaveRoutes } from './routes/save'


type _img = { mime: string; base64: string }

const app = new Hono()
  .use('*', logger())
  .use('*', cors())
  registerUploadRoutes(app)
  registerSaveRoutes(app)

// ---------------- 共通ユーティリティ（重複排除） ----------------
const _storage_root = path.resolve(process.cwd(), 'storage')
const _generated_dir = path.join(_storage_root, 'generated')

const _ext_by_mime: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
}
const _mime_by_ext: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

async function _ensure_dir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

function _parse_data_url(dataUrl: string): _img {
  const m = dataUrl?.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([^]+)$/)
  if (!m) throw new Error('malformed_data_url')
  return { mime: m[1], base64: m[2] }
}

async function _save_local_image(img: _img) {
  await _ensure_dir(_generated_dir)
  const ext = _ext_by_mime[img.mime] ?? 'png'
  const id = randomUUID()
  const filename = `${id}.${ext}`
  const filepath = path.join(_generated_dir, filename)
  await fs.writeFile(filepath, Buffer.from(img.base64, 'base64'))
  return { id, filename, url: `/api/files/${filename}`, mime: img.mime }
}

registerEditRoutes(app)
registerImagesRoutes(app)

// ---------------- 配信 ----------------
app.get('/api/files/:name', async (c) => {
  const name = c.req.param('name')
  if (!isSafeFileName(name)) return c.text('bad name', 400)
  const tryPaths = [path.join(DIR_GENERATED, name), path.join(DIR_EDITS, name)]
  for (const fp of tryPaths) {
    try {
      const data = await fs.readFile(fp)
      const ext = name.split('.').pop()!.toLowerCase()
      const mime = ( { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp' } as any )[ext] ?? 'application/octet-stream'
      return new Response(data, { headers: { 'content-type': mime } })
    } catch {/* try next */}
  }
  return c.text('not found', 404)
})

// ---------------- ヘルス ----------------
app.get('/api/health', (c) => c.json({ ok: true }))

// ---------------- OpenRouter 画像生成（保存しない版） ----------------
async function _or_generate_image(prompt: string): Promise<_img> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set')
  const modelId = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image-preview'

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
  const url: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (!url?.startsWith('data:image/')) throw new Error('no_image_in_response')
  return _parse_data_url(url)
}

// 生成：保存しない（Base64のみ返却）
app.post('/api/generate', async (c) => {
  try {
    const { prompt } = await c.req.json()
    if (!prompt || typeof prompt !== 'string') return c.json({ error: 'prompt_required' }, 400)
    const out = await _or_generate_image(prompt)
    return c.json({ image_base64: out.base64, mime: out.mime })
  } catch (e: any) {
    const msg = String(e?.message || 'generate_failed')
    if (/openrouter_http_401|unauthorized|invalid/i.test(msg)) return c.json({ error: 'invalid_openrouter_api_key' }, 401)
    return c.json({ error: msg }, 500)
  }
})

// 保存：dataUrl か base64+mime を受け取って保存
app.post('/api/save', async (c) => {
  try {
    const body = await c.req.json()
    let img: _img | null = null

    if (typeof body?.dataUrl === 'string') {
      img = _parse_data_url(body.dataUrl)
    } else if (typeof body?.image_base64 === 'string' && typeof body?.mime === 'string') {
      img = { base64: body.image_base64, mime: body.mime }
    }
    if (!img) return c.json({ error: 'invalid_payload' }, 400)

    const saved = await _save_local_image(img)
    return c.json({ file: saved })
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'save_failed' }, 500)
  }
})

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`[backend] http://localhost:${port}`)

export default app
