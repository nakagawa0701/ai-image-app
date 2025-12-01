// app/backend/src/routes/recolor.ts
import { Hono } from 'hono'
import { z } from 'zod'
import sharp from 'sharp'
import { computeEditAlpha, bboxFromAlpha, padBBox } from '../services/inpaint'
import { parseDataUrl, readImageByName, saveToEdits, isSafeFileName } from '../../lib/image-io'

const bodySchema = z.object({
  filename: z.string().refine(isSafeFileName, 'bad_file_name'),
  mask_data_url: z.string().min(1),
  color: z.string().regex(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i, 'bad_color'), // 例: #4a90e2
  feather: z.number().int().min(0).max(32).optional().default(2),
  padding: z.number().int().min(0).max(128).optional().default(8),
  blend: z.enum(['overlay', 'multiply', 'screen']).optional().default('overlay'),
  save: z.boolean().optional().default(true)
})

export function registerRecolorRoutes(app: Hono) {
  app.post('/api/recolor', async (c) => {
    try {
      const { filename, mask_data_url, color, feather, padding, blend, save } = bodySchema.parse(await c.req.json())

      // 1) 入力取得
      const { buf: originalBuf } = await readImageByName(filename)
      const mask = parseDataUrl(mask_data_url)
      const maskBuf = Buffer.from(mask.base64, 'base64')

      // 2) マスク→1ch α
      const { fullAlpha, width: mw, height: mh } = await computeEditAlpha(maskBuf)

      // 3) bbox 抽出＋余白
      const b0 = bboxFromAlpha(fullAlpha, mw, mh)
      if (!b0) return c.json({ error: 'empty_mask' }, 400)
      const bbox = padBBox(b0, mw, mh, padding)

      // 4) 元画像サイズへ α を整合
      const meta = await sharp(originalBuf).metadata()
      const iw = meta.width!, ih = meta.height!
      const alphaImg = (mw === iw && mh === ih)
        ? fullAlpha
        : await sharp(fullAlpha, { raw: { width: mw, height: mh, channels: 1 } })
            .resize({ width: iw, height: ih, fit: 'fill' })
            .raw().toBuffer()

      // 5) αをbboxで切り出し→ぼかし
      let alphaCrop = await sharp(alphaImg, { raw: { width: iw, height: ih, channels: 1 } })
        .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
        .raw().toBuffer()
      if (feather > 0) {
        alphaCrop = await sharp(alphaCrop, { raw: { width: bbox.width, height: bbox.height, channels: 1 } })
          .blur(feather).raw().toBuffer()
      }
      const alphaPng = await sharp(alphaCrop, { raw: { width: bbox.width, height: bbox.height, channels: 1 } })
        .png().toBuffer()

      // 6) パッチ抽出（RGB, sRGB統一）
      const basePatch = await sharp(originalBuf)
        .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
        .removeAlpha().toColorspace('srgb').png().toBuffer()

      // 7) 単色レイヤを生成してブレンド（質感保持）
      const colorLayer = await sharp({
        create: { width: bbox.width, height: bbox.height, channels: 3, background: color }
      }).png().toBuffer()

      const recoloredRgb = await sharp(basePatch)
        .composite([{ input: colorLayer, blend }]) // 'overlay' 推奨（質感を残しやすい）
        .toColorspace('srgb')
        .toBuffer()  // ← sharpのブレンドモード一覧（overlay/multiply/screen等）参照
      // 参照: https://sharp.pixelplumbing.com/api-composite/ （blend一覧）:contentReference[oaicite:4]{index=4}

      // 8) αを透過として結合 → RGBA小パッチ
      const patchRgba = await sharp(recoloredRgb).joinChannel(alphaPng).png().toBuffer()

      // 9) 元画像にぴったり合成（非編集部は不変）
      const out = await sharp(originalBuf)
        .toColorspace('srgb')
        .composite([{ input: patchRgba, left: bbox.left, top: bbox.top }])
        .png().toBuffer()

      if (save) {
        const saved = await saveToEdits({ mime: 'image/png', base64: out.toString('base64') })
        return c.json({ ok: true, image_base64: out.toString('base64'), file: saved })
      }
      return c.json({ ok: true, image_base64: out.toString('base64') })
    } catch (e: any) {
      return c.json({ error: String(e?.message || 'recolor_failed') }, 500)
    }
  })
}
