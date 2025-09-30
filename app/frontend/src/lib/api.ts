export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024'

export async function api_generate(prompt: string, size: ImageSize = '1024x1024') {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, size })
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`generate_failed (${res.status}) ${t}`)
  }
  const json = await res.json()
  if (!json?.image_base64) throw new Error('no_image_base64')
  return `data:image/png;base64,${json.image_base64}` as const
}
