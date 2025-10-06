export type _image_size = '1024x1024' | '1024x1536' | '1536x1024'
export type _generate_result = {
  dataUrl: string
  base64: string
  url?: string
  mime?: string
}
export type _saved_image = { id: string; filename: string; url: string; mime: string }
export type _listed_image = { filename: string; url: string; mtime: number }

export async function _generate_image(
  prompt: string,
  _size: _image_size = '1024x1024'
): Promise<_generate_result> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, size: _size })
  })
  if (!res.ok) throw new Error(`generate_failed (${res.status})`)
  const json = await res.json()
  if (!json?.image_base64) throw new Error('no_image_base64')
  return {
    dataUrl: `data:${json.mime || 'image/png'};base64,${json.image_base64}`,
    base64: json.image_base64,
    url: json?.file?.url,
    mime: json.mime
  }
}

export async function _save_image(base64: string, mime: string): Promise<_saved_image> {
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image_base64: base64, mime: mime })
  })
  if (!res.ok) throw new Error(`save_failed (${res.status})`)
  const json = await res.json()
  if (!json?.url) throw new Error('no_url_in_save_response')
  return json
}

export async function _list_images(): Promise<_listed_image[]> {
  const res = await fetch('/api/images')
  if (!res.ok) throw new Error(`list_failed (${res.status})`)
  const json = await res.json()
  return json || []
}