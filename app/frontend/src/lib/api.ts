export type _image_size = '1024x1024' | '1024x1536' | '1536x1024'
export type _generate_result = { dataUrl: string; mime: string }
export type _save_result = { url: string; filename: string; mime: string }

export type _image_item = {
  filename: string
  url: string
  mime: string
  bytes: number
  mtime: string
  kind: 'generated' | 'edits'
}

export async function _edit_image(params: {
  filename: string            // 元画像（/api/generate 後に /api/save したファイル名）
  maskDataUrl: string         // キャンバスから出す data:image/png;base64,...
  prompt: string
  feather?: number            // px（境界） default 2
  padding?: number            // bboxパディング px default 12
  save?: boolean              // trueなら edits/ へ保存
}) {
  const res = await fetch('/api/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: params.filename,
      mask_data_url: params.maskDataUrl,
      prompt: params.prompt,
      feather: params.feather ?? 2,
      padding: params.padding ?? 12,
      save: Boolean(params.save)
    })
  })
  if (!res.ok) {
  const txt = await res.text().catch(() => '')
  try {
    const j = JSON.parse(txt)
    const detail = [j?.error, j?.stage].filter(Boolean).join(' @ ')
    throw new Error(detail || `edit_failed (${res.status})`)
  } catch {
    throw new Error(txt || `edit_failed (${res.status})`)
  }
}
  const json = await res.json()
  if (!json?.image_base64) throw new Error('no_image_base64')
  return {
    dataUrl: `data:${json.mime || 'image/png'};base64,${json.image_base64}`,
    saved: json.file ?? null  // { url, filename, mime } | null
  }
}

export async function _generate_image(prompt: string, _size: _image_size = '1024x1024'): Promise<_generate_result> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, size: _size }) // サイズは目安（OpenRouterは強制不可）
  })
  if (!res.ok) throw new Error(`generate_failed (${res.status})`)
  const json = await res.json()
  if (!json?.image_base64 || !json?.mime) throw new Error('no_image_base64')
  return { dataUrl: `data:${json.mime};base64,${json.image_base64}`, mime: json.mime }
}

export async function _save_image(dataUrl: string): Promise<_save_result> {
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataUrl })
  })
  if (!res.ok) throw new Error(`save_failed (${res.status})`)
  const json = await res.json()
  if (!json?.file?.url || !json?.file?.filename || !json?.file?.mime) throw new Error('invalid_save_response')
  return { url: json.file.url, filename: json.file.filename, mime: json.file.mime }
}

export async function _list_images(params?: { kind?: 'generated'|'edits'|'all', limit?: number, offset?: number }): Promise<_image_item[]> {
  const q = new URLSearchParams()
  if (params?.kind) q.set('kind', params.kind)
  if (params?.limit) q.set('limit', String(params.limit))
  if (params?.offset) q.set('offset', String(params.offset))
  const res = await fetch(`/api/images?${q.toString()}`)
  if (!res.ok) throw new Error(`list_images_failed (${res.status})`)
  const json = await res.json()
  if (!Array.isArray(json?.items)) return []
  return json.items as _image_item[]
}

export async function _delete_image(filename: string): Promise<{ ok: true; filename: string }> {
  const res = await fetch(`/api/images/${encodeURIComponent(filename)}`, { method: 'DELETE' })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    try { const j = JSON.parse(txt); throw new Error(j?.error || `delete_failed (${res.status})`) }
    catch { throw new Error(txt || `delete_failed (${res.status})`) }
  }
  return res.json()
}
