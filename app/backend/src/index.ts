import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import 'dotenv/config'

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

type _or_image = { mime: string; base64: string }

const app = new Hono()
  .use('*', logger())
  .use('*', cors())

// ---------- ユーティリティ（保存パス/拡張子/保存/配信） ----------
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

async function _save_local_image(base64: string, mime: string) {
  await _ensure_dir(_generated_dir)
  const ext = _ext_by_mime[mime] ?? 'png'
  const id = randomUUID()
  const filename = `${id}.${ext}`
  const filepath = path.join(_generated_dir, filename)
  const buf = Buffer.from(base64, 'base64')
  await fs.writeFile(filepath, buf)
  // フロントから相対で取れる配信URL
  const url = `/api/files/${filename}`
  return { id, filename, url, mime }
}

function _safe_name(name: string) {
  // a-b-cd... のUUID.EXT のみ許可
  return /^[a-f0-9-]+\.(png|jpg|jpeg|webp)$/i.test(name)
}

// ---------- 画像配信エンドポイント ----------
app.get('/api/files/:name', async (c) => {
  const name = c.req.param('name')
  if (!_safe_name(name)) return c.text('bad name', 400)
  const file = path.join(_generated_dir, name)
  try {
    const data = await fs.readFile(file)
    const ext = path.extname(name).slice(1).toLowerCase()
    const mime = _mime_by_ext[ext] ?? 'application/octet-stream'
    return new Response(data, { headers: { 'content-type': mime } })
  } catch {
    return c.text('not found', 404)
  }
})

// ---------- 保存済み画像一覧エンドポイント ----------
app.get('/api/images', async (c) => {
  try {
    await _ensure_dir(_generated_dir)
    const files = await fs.readdir(_generated_dir)
    const images = await Promise.all(
      files
        .filter((f) => _safe_name(f))
        .map(async (f) => {
          const stat = await fs.stat(path.join(_generated_dir, f))
          return {
            filename: f,
            url: `/api/files/${f}`,
            mtime: stat.mtime.getTime()
          }
        })
    )
    // mtimeの降順でソート
    images.sort((a, b) => b.mtime - a.mtime)
    return c.json(images)
  } catch (e: any) {
    return c.json({ error: e?.message || 'list_failed' }, 500)
  }
})

// ---------- ヘルスチェック ----------
app.get('/api/health', (c) => c.json({ ok: true }))

// ---------- OpenRouter 画像生成（chat/completions + modalities） ----------
async function _or_generate_image(prompt: string, model?: string): Promise<_or_image> {
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
  const url: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (!url || !url.startsWith('data:image/')) throw new Error('no_image_in_response')

  const m = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([^]+)$/)
  if (!m) throw new Error('malformed_data_url')
  return { mime: m[1], base64: m[2] }
}

// ---------- 生成API：保存してURLも返す ----------
app.post('/api/generate', async (c) => {
  try {
    const { prompt } = await c.req.json()
    if (!prompt || typeof prompt !== 'string') {
      return c.json({ error: 'prompt_required' }, 400)
    }
    const out = await _or_generate_image(prompt)
    // 保存はフロントエンドからの /api/save で行う
    return c.json({
      image_base64: out.base64,
      mime: out.mime
    })
  } catch (e: any) {
    const msg = String(e?.message || 'generate_failed')
    if (/openrouter_http_401|unauthorized|invalid/i.test(msg)) {
      return c.json({ error: 'invalid_openrouter_api_key' }, 401)
    }
    return c.json({ error: msg }, 500)
  }
})

// ---------- フロントエンドからの画像保存API ----------
app.post('/api/save', async (c) => {
  try {
    const { image_base64, mime } = await c.req.json<{ image_base64: string; mime: string }>()
    if (!image_base64 || typeof image_base64 !== 'string' || !mime || typeof mime !== 'string') {
      return c.json({ error: 'image_base64_and_mime_required' }, 400)
    }
    const saved = await _save_local_image(image_base64, mime)
    return c.json(saved)
  } catch (e: any) {
    const msg = String(e?.message || 'save_failed')
    return c.json({ error: msg }, 500)
  }
})

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`[backend] http://localhost:${port}`)
