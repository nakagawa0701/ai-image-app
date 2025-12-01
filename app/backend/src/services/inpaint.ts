import sharp from 'sharp'
import { bufferToPngDataUrl } from '../../lib/image-io.js'

type MeanRGB = { r: number; g: number; b: number }

async function _meanRgb(buf: Buffer): Promise<MeanRGB> {
  const s = await sharp(buf).stats()
  return {
    r: s.channels[0].mean,
    g: s.channels[1].mean,
    b: s.channels[2].mean
  }
}

// パッチの平均にゲインを掛けて周辺平均に寄せる（過補正防止でclamp）
async function colorMatchTo(patchRgb: Buffer, target: MeanRGB): Promise<Buffer> {
  const src = await _meanRgb(patchRgb)
  // 0除算を避けつつ安全域で係数算出（0.6〜1.6の間にクランプ）
  const gx = (t: number, s: number) => Math.max(0.6, Math.min(1.6, (t + 1e-3) / (s + 1e-3)))
  const kr = gx(target.r, src.r), kg = gx(target.g, src.g), kb = gx(target.b, src.b)
  // 3x3対角行列で線形ゲイン
  return sharp(patchRgb)
    .recomb([[kr,0,0],[0,kg,0],[0,0,kb]])
    .toBuffer()
}

// bboxの周辺（N pxのリング）を抜き出して平均色を計算
async function _surroundingMean(original: Buffer, imgW: number, imgH: number, bbox: BBox, ring = 8): Promise<MeanRGB> {
  const left = Math.max(0, bbox.left - ring)
  const top = Math.max(0, bbox.top - ring)
  const right = Math.min(imgW, bbox.left + bbox.width + ring)
  const bottom = Math.min(imgH, bbox.top + bbox.height + ring)

  // 周辺リング：外矩形から内矩形を引くのが理想だが、簡易に外矩形の平均でも十分効く
  const crop = await sharp(original).extract({ left, top, width: right - left, height: bottom - top }).toBuffer()
  return _meanRgb(crop)
}

export type BBox = { left: number; top: number; width: number; height: number }

function clamp(n: number, min: number, max: number) { return Math.min(Math.max(n, min), max) }

/** マスクの「編集対象アルファ(0..255)」を計算
 *  - 透明=編集 → アルファ反転
 *  - αが無い場合は白しきい値(>200)=編集
 */
export async function computeEditAlpha(maskBuf: Buffer): Promise<{ fullAlpha: Buffer, width: number, height: number }> {
  const meta = await sharp(maskBuf).metadata()
  if (!meta.width || !meta.height) throw new Error('mask_meta_failed')

  // αチャンネルがある場合：必ず raw で取り出す
  if (meta.hasAlpha) {
    const { data, info } = await sharp(maskBuf)
      .ensureAlpha()
      .extractChannel('alpha')
      .raw()
      .toBuffer({ resolveWithObject: true })

    // 透明(0)=編集 → 反転
    const inv = Buffer.from(data.map((v: number) => 255 - v))
    const hasEdit = inv.some((v: number) => v > 0)
    if (hasEdit) return { fullAlpha: inv, width: info.width, height: info.height }
    // 反転で全ゼロなら、下の白黒しきい値にフォールバック
  }

  // αなし or 反転で編集ゼロ：グレースケールを raw で取り出して白>200 を編集（白=編集）
  const { data, info } = await sharp(maskBuf)
    .grayscale()
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true })

  const alpha = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) alpha[i] = data[i] > 200 ? 255 : 0
  return { fullAlpha: alpha, width: info.width, height: info.height }
}

export function bboxFromAlpha(alpha: Buffer, w: number, h: number): BBox | null {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      const v = alpha[y*w + x]
      if (v > 0) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** bbox をパディングして画像内に収める */
export function padBBox(b: BBox, w: number, h: number, pad: number): BBox {
  const left = clamp(b.left - pad, 0, w-1)
  const top = clamp(b.top - pad, 0, h-1)
  const right = clamp(b.left + b.width - 1 + pad, 0, w-1)
  const bottom = clamp(b.top + b.height - 1 + pad, 0, h-1)
  return { left, top, width: right-left+1, height: bottom-top+1 }
}

/** 厳密合成：マスク外は1pxも変えない。feather(px)で境界をぼかす */
export async function strictComposite(
  originalBuf: Buffer,
  editedPatchBuf: Buffer,
  fullAlpha: Buffer,
  bbox: BBox,
  feather = 2
): Promise<Buffer> {
  const meta = await sharp(originalBuf).metadata()
  if (!meta.width || !meta.height) throw new Error('image_meta_failed')
  const imgW = meta.width
  const imgH = meta.height

  // 1) マスクを bbox で切り出し（raw 1ch 前提）
  let alphaCrop = await sharp(fullAlpha, { raw: { width: imgW, height: imgH, channels: 1 } })
    .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
    .raw()
    .toBuffer()

  // 2) ぼかし（後続で必ず 1ch に再強制する）
  let blurred = feather > 0
    ? await sharp(alphaCrop, { raw: { width: bbox.width, height: bbox.height, channels: 1 } })
        .blur(feather)
        .raw()
        .toBuffer()
    : alphaCrop

  // ★ 2.5) 念のためチャンネルを 1ch に強制（環境によって 3ch になるケースを吸収）
  const area = bbox.width * bbox.height
  if (blurred.length !== area) {
    const ratio = blurred.length / area
    // ratio を 2|3|4 のユニオンに“型で”絞る
    const isInt = Number.isInteger(ratio)
    const isSupported = ratio === 2 || ratio === 3 || ratio === 4
    if (isInt && isSupported) {
      const ch = ratio as 2 | 3 | 4
      blurred = await sharp(blurred, {
        raw: { width: bbox.width, height: bbox.height, channels: ch } // ← ここが型OKになる
      })
        .extractChannel(0) // 0ch を取り出して 1ch 化
        .raw()
        .toBuffer()
    } else {
      throw new Error(`alpha_crop_size_mismatch exp=${area} got=${blurred.length}`)
    }
  }

  // 3) 生成パッチを bbox サイズに正規化（RGB 3ch）
  const patchRgb = await sharp(editedPatchBuf)
    .resize({ width: bbox.width, height: bbox.height, fit: 'fill' })
    .removeAlpha()
    // .toColourspace('rgb')   // ← これがNG
    .toColorspace('srgb')       // ← OK: srgb に統一
    .toBuffer()

    const metapatch = await sharp(originalBuf).metadata()
    const imgwpatch = metapatch.width!, imghpatch = metapatch.height!

    // ... patchRgb を作成した後に挿入
    const neighMean = await _surroundingMean(originalBuf, imgwpatch, imghpatch, bbox, 8)
    const patchMatched = await colorMatchTo(patchRgb, neighMean)


  // 4) raw(1ch) α → PNG（joinChannel は画像入力を想定）
  const alphaPng = await sharp(blurred, { raw: { width: bbox.width, height: bbox.height, channels: 1 } })
    .png()
    .toBuffer()

  // 5) RGB + α(PNG) → RGBA パッチ
  const patchRgba = await sharp(patchMatched)
    .joinChannel(alphaPng)
    .png()
    .toBuffer()

  // 6) 元画像へ厳密合成
  const composited = await sharp(originalBuf)
    .toColorspace('srgb')       // ← ベース側も srgb に合わせておくと安全
    .composite([{ input: patchRgba, left: bbox.left, top: bbox.top }])
    .png()
    .toBuffer()

  return composited
}



/** パッチDataURLを作る（bbox切り出し） */
export async function makePatchDataUrl(originalBuf: Buffer, bbox: BBox): Promise<string> {
  const patch = await sharp(originalBuf)
    .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
    .png()
    .toBuffer()
  return bufferToPngDataUrl(patch)
}

export async function resizeAlphaTo(
  alpha: Buffer,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Promise<Buffer> {
  if (srcW === dstW && srcH === dstH) return alpha
  return await sharp(alpha, { raw: { width: srcW, height: srcH, channels: 1 } })
    .resize({ width: dstW, height: dstH, fit: 'fill' })
    .raw()
    .toBuffer()
}

export function scaleBBoxTo(
  b: BBox,
  sx: number,
  sy: number,
  dstW: number,
  dstH: number
): BBox {
  const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)
  const left = clamp(Math.round(b.left * sx), 0, dstW - 1)
  const top = clamp(Math.round(b.top * sy), 0, dstH - 1)
  const right = clamp(Math.round((b.left + b.width - 1) * sx), 0, dstW - 1)
  const bottom = clamp(Math.round((b.top + b.height - 1) * sy), 0, dstH - 1)
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}


/** bbox切り出し → 最大辺maxPxに収まるよう縮小 → dataURL返却 */
export async function makePatchDataUrlScaled(originalBuf: Buffer, bbox: BBox, maxEdge = 1536): Promise<string> {
  const base = sharp(originalBuf).extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
  const meta = await base.metadata()
  const w = meta.width!, h = meta.height!
  const scale = Math.min(1, maxEdge / Math.max(w, h))

  // 歪み禁止: contain（余白は透明）で拡大 → モデルには“正しい見かけ”を渡す
  const up = await base
    .toColorspace('srgb')
    .resize({
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      fit: 'inside',           // ← 歪めない
      withoutEnlargement: false
    })
    .png()
    .toBuffer()

  return `data:image/png;base64,${up.toString('base64')}`
}

// 1ch raw α を「ぼかし→しきい値」で 1〜2px膨張させる
export async function inflateAlpha1ch(alpha: Buffer, w: number, h: number, px = 1): Promise<Buffer> {
  if (px <= 0) return alpha
  // ぼかして閾値で白を広げる（ソフト膨張）
  const blurred = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
    .blur(px)                 // 半径px
    .raw().toBuffer()
  const out = Buffer.allocUnsafe(w * h)
  // 128を境に2値化（0/255）
  for (let i = 0; i < out.length; i++) out[i] = blurred[i] >= 128 ? 255 : 0
  return out
}
