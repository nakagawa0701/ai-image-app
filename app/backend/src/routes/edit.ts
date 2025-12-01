import { Hono } from 'hono'
import { z } from 'zod'
import {
  computeEditAlpha,
  bboxFromAlpha,
  padBBox,
  strictComposite,
  makePatchDataUrlScaled,
  resizeAlphaTo,
  scaleBBoxTo
, inflateAlpha1ch
} from '../services/inpaint'
import {
  parseDataUrl,
  readImageByName,
  saveToEdits,
  isSafeFileName
} from '../../lib/image-io'
import { orGenerateFromPatch } from '../services/openrouter'

const bodySchema = z.object({
  filename: z.string().refine(isSafeFileName, 'bad_file_name'), // 元画像は保存済み前提
  mask_data_url: z.string().min(1, 'mask_required'),
  prompt: z.string().min(1, 'prompt_required'),
  feather: z.number().int().min(0).max(32).optional().default(2),
  padding: z.number().int().min(0).max(128).optional().default(12),
  save: z.boolean().optional().default(false)
})

// 先頭付近はそのまま。下の try 内に stage を入れる
export function registerEditRoutes(app: Hono) {
  app.post('/api/edit', async (c) => {
    let stage = 'parse' // どこで失敗したか可視化
    try {
      const body = await c.req.json()
      const { filename, mask_data_url, prompt, feather, padding, save } = bodySchema.parse(body)

      stage = 'read_base'
      const { buf: originalBuf } = await readImageByName(filename)

      stage = 'parse_mask'
      const mask = parseDataUrl(mask_data_url)
      const maskBuf = Buffer.from(mask.base64, 'base64')

      stage = 'mask_to_bbox'
      let { fullAlpha, width: maskW, height: maskH } = await computeEditAlpha(maskBuf)
      fullAlpha = await inflateAlpha1ch(fullAlpha, maskW, maskH, 1)
      const b0 = bboxFromAlpha(fullAlpha, maskW, maskH)
      if (!b0) return c.json({ error: 'empty_mask', stage }, 400)
      const bboxMaskSpace = padBBox(b0, maskW, maskH, padding)

      // ★ 元画像の実寸を取得
      const meta = await (await import('sharp')).default(originalBuf).metadata()
      const imgW = meta.width!, imgH = meta.height!
      if (!imgW || !imgH) return c.json({ error: 'image_meta_failed', stage }, 400)

      // ★ マスクが元画像とサイズ不一致なら、アルファとbboxを補正
      stage = 'align_mask_to_image'
      const sx = imgW / maskW
      const sy = imgH / maskH

      const fullAlphaImageSpace = (maskW === imgW && maskH === imgH)
        ? fullAlpha
        : await resizeAlphaTo(fullAlpha, maskW, maskH, imgW, imgH)

      const bbox = (maskW === imgW && maskH === imgH)
        ? bboxMaskSpace
        : scaleBBoxTo(bboxMaskSpace, sx, sy, imgW, imgH)

      // ★ 以降は「画像座標系」の bbox / alpha を使用
      stage = 'make_patch'
      const patchDataUrl = await makePatchDataUrlScaled(originalBuf, bbox, 1024)

      stage = 'openrouter'
      const edited = await orGenerateFromPatch(prompt, patchDataUrl)
      const editedBuf = Buffer.from(edited.base64, 'base64')

      if (fullAlphaImageSpace.length !== imgW * imgH) {
        return c.json({
          error: `alpha_size_mismatch exp=${imgW * imgH} got=${fullAlphaImageSpace.length}`,
          stage: 'composite_precheck'
        }, 500)
      } 

      stage = 'composite'
      const outBuf = await strictComposite(originalBuf, editedBuf, fullAlphaImageSpace, bbox, feather)
      stage = 'save_or_return'
      if (save) {
        const saved = await saveToEdits({ mime: 'image/png', base64: outBuf.toString('base64') })
        return c.json({ image_base64: outBuf.toString('base64'), mime: 'image/png', file: saved })
      }
      return c.json({ image_base64: outBuf.toString('base64'), mime: 'image/png' })
    } catch (e: any) {
      const msg = String(e?.message || 'edit_failed')
      // よくあるパターンは明確に
      if (/openrouter_http_401|unauthorized|invalid/i.test(msg)) {
        return c.json({ error: 'invalid_openrouter_api_key', stage }, 401)
      }
      if (/file_not_found|bad_file_name|mask_meta_failed|image_meta_failed|empty_mask|malformed_data_url/.test(msg)) {
        return c.json({ error: msg, stage }, 400)
      }
      console.error('[edit]', stage, msg)
      return c.json({ error: msg, stage }, 500)
    }
  })
}

