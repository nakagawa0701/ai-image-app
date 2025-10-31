import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DIR_GENERATED, DIR_EDITS, isSafeFileName } from '../../lib/image-io'


type Kind = 'generated' | 'edits'
type Item = { filename: string; url: string; mime: string; bytes: number; mtime: string; kind: Kind }

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

async function listDir(dir: string, kind: Kind): Promise<Item[]> {
  try {
    const names = await fs.readdir(dir)
    const items: Item[] = []
    for (const name of names) {
      if (!isSafeFileName(name)) continue
      const fp = path.join(dir, name)
      const st = await fs.stat(fp).catch(() => null)
      if (!st || !st.isFile()) continue
      const ext = name.split('.').pop()!.toLowerCase()
      const mime = MIME_BY_EXT[ext] ?? 'image/png'
      items.push({
        filename: name,
        url: `/api/files/${name}`,
        mime,
        bytes: st.size,
        mtime: new Date(st.mtimeMs).toISOString(),
        kind
      })
    }
    return items
  } catch {
    return []
  }
}

export function registerImagesRoutes(app: Hono) {
  app.get('/api/images', async (c) => {
    const kind = (c.req.query('kind') as Kind | 'all') || 'all'
    const limit = Math.max(0, Math.min(200, Number(c.req.query('limit') ?? 50)))
    const offset = Math.max(0, Number(c.req.query('offset') ?? 0))

    const listGen = kind === 'generated' || kind === 'all' ? await listDir(DIR_GENERATED, 'generated') : []
    const listEdt = kind === 'edits' || kind === 'all' ? await listDir(DIR_EDITS, 'edits') : []
    const all = [...listGen, ...listEdt].sort((a, b) => b.mtime.localeCompare(a.mtime))
    const items = all.slice(offset, offset + limit)
    return c.json({ items, total: all.length, offset, limit })
  })

  // 既存の registerImagesRoutes(app) の中に ↓ を追加
  app.delete('/api/images/:filename', async (c) => {
    try {
      const name = c.req.param('filename')
      if (!isSafeFileName(name)) return c.json({ error: 'bad_file_name' }, 400)

      const candidates = [
        { dir: DIR_EDITS, kind: 'edits' as const },
        { dir: DIR_GENERATED, kind: 'generated' as const }
      ]

      for (const x of candidates) {
        const fp = path.join(x.dir, name)
        const st = await fs.stat(fp).catch(() => null)
        if (st && st.isFile()) {
          await fs.unlink(fp)
          return c.json({ ok: true, filename: name, kind: x.kind })
        }
      }
      return c.json({ error: 'file_not_found' }, 404)
    } catch (e: any) {
      return c.json({ error: String(e?.message || 'delete_failed') }, 500)
    }
  })
}
