import { Hono } from 'hono'
import { z } from 'zod'
import {
  parseDataUrl,
  saveToGenerated,
  saveToEdits,
  readImageByName,
  isSafeFileName
} from '../../lib/image-io'

const Body = z.object({
  data_url: z.string().optional(),    // data:image/...;base64,...
  filename: z.string().optional(),    // 既存ファイル名（generated/edits 内）
  url: z.string().optional(),         // /api/files/<filename>
  dest: z.enum(['generated', 'edits']).optional().default('generated')
})

export function registerSaveRoutes(app: Hono) {
  app.post('/api/save', async (c) => {
    try {
      const { data_url, filename, url, dest } = Body.parse(await c.req.json())

      // 保存関数の選択
      const saver = dest === 'edits' ? saveToEdits : saveToGenerated

      // 1) DataURL を保存
      if (data_url && /^data:image\//i.test(data_url)) {
        const { mime, base64 } = parseDataUrl(data_url)
        const saved = await saver({ mime, base64 })
        return c.json(saved)
      }

      // 2) 既存ファイル名 / URL をコピー保存
      const pickName = (() => {
        if (filename && isSafeFileName(filename)) return filename
        if (url) {
          const m = url.match(/\/api\/files\/([A-Za-z0-9._-]+\.(?:png|jpe?g|webp|avif))/i)
          if (m && isSafeFileName(m[1])) return m[1]
        }
        return null
      })()
      if (pickName) {
        const { buf, mime } = await readImageByName(pickName)
        const saved = await saver({ mime, base64: buf.toString('base64') })
        return c.json(saved)
      }

      return c.json({ error: 'invalid_payload' }, 400)
    } catch (e: any) {
      return c.json({ error: String(e?.message || 'save_failed') }, 500)
    }
  })
}
