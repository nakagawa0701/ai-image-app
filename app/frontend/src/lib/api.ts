export type _image_size = '1024x1024' | '1024x1536' | '1536x1024'
export type _generate_result = { dataUrl: string; mime: string }
export type _save_result = { url: string; filename: string; mime: string }

export type _image_item = {
  url: string
  filename: string
  mime: string
  mtime: number                // ← ここを単一真実源（SSOT）に
  kind: 'generated' | 'edits'
}

// ヘルパー：fetch 失敗メッセージの抽出
async function _ensure_ok(res: Response, fallback: string) {
  if (res.ok) return
  const txt = await res.text().catch(() => '')
  try {
    const j = JSON.parse(txt)
    throw new Error(j?.error || `${fallback} (${res.status})`)
  } catch {
    throw new Error(txt || `${fallback} (${res.status})`)
  }
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

export async function _generate_image(args: { prompt: string; size?: string }): Promise<{ dataUrl: string; mime: string }> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: args.prompt, size: args.size })
  })
  await _ensure_ok(res, 'generate_failed')
  const j = await res.json() as { image_base64?: string; mime?: string }
  if (!j.image_base64) throw new Error('no_image_in_response')
  const mime = j.mime || 'image/png'
  return { dataUrl: `data:${mime};base64,${j.image_base64}`, mime }
}

export async function _save_image(
  input: string,
  opts?: { dest?: 'generated' | 'edits' }
): Promise<{ url: string; filename: string; mime: string }> {
  const dest = opts?.dest ?? 'generated'

  let payload: any
  if (/^data:image\//i.test(input)) {
    payload = { data_url: input, dest }
  } else if (/^\/api\/files\//.test(input) || /^https?:\/\/.+\/api\/files\//.test(input)) {
    payload = { url: input, dest }
  } else {
    throw new Error('not_data_url_or_api_file_url')
  }

  const r = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error || 'save_failed')
  return j
}




export async function _list_images(args: { kind: 'all' | 'generated' | 'edits'; limit?: number }): Promise<_image_item[]> {
  const q = new URLSearchParams()
  q.set('kind', args.kind)
  if (args.limit) q.set('limit', String(args.limit))
  const res = await fetch(`/api/images?${q}`)
  await _ensure_ok(res, 'list_failed')
  const raw = await res.json() as Array<{ url: string; filename: string; mime: string; mtime: string | number; kind: 'generated' | 'edits' }>
  return raw.map(it => {
    // 文字列でも数値でも、必ず number(ms) に
    const mtime =
      typeof it.mtime === 'number' ? it.mtime
      : (/^\d+$/.test(it.mtime) ? Number(it.mtime) : Date.parse(it.mtime))
    return { ...it, mtime: isFinite(mtime) ? mtime : Date.now() }
  })
}

export async function _delete_image(filename: string): Promise<{ ok: true; filename: string }> {
  const res = await fetch(`/api/images/${encodeURIComponent(filename)}`, { method: 'DELETE' })
  await _ensure_ok(res, 'delete_failed')
  return res.json()
}

export async function _upload_data_url(dataUrl: string): Promise<{ url: string; filename: string; mime: string }> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data_url: dataUrl })
  })
  await _ensure_ok(res, 'upload_failed')
  const j = await res.json()
  return j.file
}
