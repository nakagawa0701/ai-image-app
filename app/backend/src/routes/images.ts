import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DIR_GENERATED, DIR_EDITS, isSafeFileName } from '../../lib/image-io'

type Item = {
  url: string
  filename: string
  mime: string
  mtime: number
  kind: 'generated' | 'edits'
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.webp') return 'image/webp'
  if (e === '.avif') return 'image/avif'
  return 'application/octet-stream'
}

async function listDir(dir: string, kind: Item['kind']): Promise<Item[]> {
  let ents: any[] = []
  try {
    ents = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    // ディレクトリ未作成でもOK（空配列）
    return []
  }

  const files = ents.filter(d => d.isFile())
  const items: Item[] = []

  for (const f of files) {
    const filename = f.name
    if (!isSafeFileName(filename)) continue
    const abs = path.join(dir, filename)
    try {
      const st = await fs.stat(abs)
      items.push({
        url: `/api/files/${filename}`,
        filename,
        mime: mimeFromExt(path.extname(filename)),
        mtime: st.mtimeMs,       // number(ms)
        kind
      })
    } catch {
      /* 途中で消えた等はスキップ */
    }
  }
  return items
}

export function registerImagesRoutes(app: Hono) {
  // 一覧
  app.get('/api/images', async (c) => {
    const kind = (c.req.query('kind') || 'all') as 'all' | 'generated' | 'edits'
    const limit = Math.max(1, Math.min(1000, Number(c.req.query('limit') || 60)))

    let items: Item[] = []
    if (kind === 'generated' || kind === 'all') {
      items = items.concat(await listDir(DIR_GENERATED, 'generated'))
    }
    if (kind === 'edits' || kind === 'all') {
      items = items.concat(await listDir(DIR_EDITS, 'edits'))
    }

    // 新しい順
    items.sort((a, b) => b.mtime - a.mtime)

    // limit
    items = items.slice(0, limit)

    return c.json(items)
  })

  // 削除
  app.delete('/api/images/:filename', async (c) => {
    const filename = c.req.param('filename')
    if (!isSafeFileName(filename)) return c.json({ error: 'bad_file_name' }, 400)
    const candidates = [
      path.join(DIR_EDITS, filename),
      path.join(DIR_GENERATED, filename),
    ]
    for (const abs of candidates) {
      try {
        await fs.unlink(abs)
        return c.json({ ok: true, filename })
      } catch {
        /* try next */
      }
    }
    return c.json({ error: 'file_not_found' }, 404)
  })
}
