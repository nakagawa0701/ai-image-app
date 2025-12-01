import { Hono } from 'hono'
import { z } from 'zod'
import sharp from 'sharp'
import { parseDataUrl, saveToGenerated } from '../../lib/image-io'

const bodySchema = z.object({
  data_url: z.string().min(1, 'data_url_required')
})

export function registerUploadRoutes(app: Hono) {
  app.post('/api/upload', async (c) => {
    try {
      const body = await c.req.json()
      const { data_url } = bodySchema.parse(body)

      // data URL → バイナリ
      const parsed = parseDataUrl(data_url)
      const buf = Buffer.from(parsed.base64, 'base64')

      // 画像として解釈できるか & sRGB統一 & PNG正規化
      const png = await sharp(buf)
        .toColorspace('srgb')
        .png()
        .toBuffer()

      // generated/ に保存（アップロード画像は “元素材” 扱い）
      const saved = await saveToGenerated({ mime: 'image/png', base64: png.toString('base64') })
      return c.json({ ok: true, file: saved }) // { url, filename, mime }
    } catch (e: any) {
      return c.json({ error: String(e?.message || 'upload_failed') }, 400)
    }
  })
}
