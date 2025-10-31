import { parseDataUrl } from '../../lib/image-io'

export type OrImage = { mime: string; base64: string }

function _extractImageDataUrl(json: any): string | null {
  // A) message.images[*].image_url.url
  const imgs = json?.choices?.[0]?.message?.images
  if (Array.isArray(imgs)) {
    const u = imgs[0]?.image_url?.url
    if (typeof u === 'string' && u.startsWith('data:image/')) return u
  }
  // B) message.content[*].image_url.url / image_url (string)
  const content = json?.choices?.[0]?.message?.content
  if (Array.isArray(content)) {
    for (const part of content) {
      const u1 = part?.image_url?.url
      const u2 = typeof part?.image_url === 'string' ? part.image_url : undefined
      const u = u1 || u2
      if (typeof u === 'string' && u.startsWith('data:image/')) return u
    }
  }
  return null
}

async function _postOpenRouter(payload: any): Promise<any> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set')

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_PUBLIC_URL || 'http://localhost:5173',
      'X-Title': 'ai-image-app'
    },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.error('[openrouter]', res.status, t?.slice?.(0, 800) ?? '')
    throw new Error(`openrouter_http_${res.status}: ${t}`)
  }
  return res.json()
}

export async function orGenerateFromPatch(prompt: string, patchDataUrl: string): Promise<OrImage> {
  const modelId = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image-preview'

  // 1st トライ: type=image_url + {url}
  const payloadA = {
    model: modelId,
    modalities: ['image', 'text'],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `このパッチ領域だけを編集してください。${prompt}` },
          { type: 'image_url', image_url: { url: patchDataUrl } }
        ]
      }
    ]
  }

  try {
    const j = await _postOpenRouter(payloadA)
    const url = _extractImageDataUrl(j)
    if (url) return parseDataUrl(url)
    // 画像が取り出せなければ次の方式へ
    console.warn('[openrouter] no image in payloadA response, trying payloadB')
  } catch (e: any) {
    // 400 / 422 などは別スキーマを試す
    if (!/openrouter_http_4\d\d/.test(String(e?.message || ''))) throw e
  }

  // 2nd トライ: type=input_image + 直接 string
  const payloadB = {
    model: modelId,
    modalities: ['image', 'text'],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `このパッチ領域だけを編集してください。${prompt}` },
          { type: 'input_image', image_url: patchDataUrl } // ← 文字列で直渡し
        ]
      }
    ]
  }

  const j2 = await _postOpenRouter(payloadB)
  const url2 = _extractImageDataUrl(j2)
  if (!url2) throw new Error('no_image_in_response')
  return parseDataUrl(url2)
}
