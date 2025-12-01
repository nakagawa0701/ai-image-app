<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { _edit_image } from '../lib/api'

type _props = {
  filename: string
  imageUrl: string
  defaultPrompt?: string
  defaultBrush?: number
  feather?: number
  padding?: number
  autosave?: boolean
}
const props = withDefaults(defineProps<_props>(), {
  defaultPrompt: '',
  defaultBrush: 28,
  feather: 2,
  padding: 12,
  autosave: true
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done', payload: { dataUrl: string, saved?: { url: string, filename: string, mime: string } | null }): void
}>()

// 要素参照
const _img_el = ref<HTMLImageElement | null>(null)
const _overlay = ref<HTMLCanvasElement | null>(null)       // 赤の可視レイヤ
const _cursor  = ref<HTMLCanvasElement | null>(null)       // ブラシカーソル
const _mask    = ref<HTMLCanvasElement | null>(null)       // 実送信用の白黒マスク
const _container = ref<HTMLDivElement | null>(null)

// UI状態
const _prompt = ref(props.defaultPrompt)
const _brush = ref(props.defaultBrush)
const _tool = ref<'brush'|'eraser'>('brush')
const _ov_alpha = ref(0.45)
const _working = ref(false)
const _is_drawing = ref(false)

// 座標・スケール
let _scaleX = 1, _scaleY = 1
let _dpr = Math.max(1, window.devicePixelRatio || 1)
let _lastX: number | null = null
let _lastY: number | null = null

// Undo/Redo（スナップショット）
const UNDO_MAX = 30
let _hist: ImageData[] = []
let _hIndex = -1
let _strokeDirty = false // このストロークでマスクに変更があったか

function _snapshot(push = false) {
  const m = _mask.value
  if (!m) return null
  const ctx = m.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const shot = ctx.getImageData(0, 0, m.width, m.height)

  if (push) {
    if (_hIndex < _hist.length - 1) _hist.splice(_hIndex + 1) // Redo破棄
    _hist.push(shot)
    if (_hist.length > UNDO_MAX) _hist.shift()
    _hIndex = _hist.length - 1
  }
  return shot
}
function _apply_hist_at(i: number) {
  const img = _hist[i]
  if (!img) return
  const m = _mask.value
  if (!m) return
  const ctxM = m.getContext('2d')!
  ctxM.putImageData(img, 0, 0)
  _repaint_overlay_from_mask()
}
function _undo_once() {
  if (_hIndex <= 0) return
  _hIndex--
  _apply_hist_at(_hIndex)
}
function _redo_once() {
  if (_hIndex >= _hist.length - 1) return
  _hIndex++
  _apply_hist_at(_hIndex)
}

function _resize_canvases(forceClear = true) {
  const img = _img_el.value
  const ov = _overlay.value
  const cv = _cursor.value
  const m  = _mask.value
  if (!img || !ov || !m || !cv) return

  const { width, height } = img.getBoundingClientRect()
  if (width === 0 || height === 0) return

  // 可視オーバーレイ & カーソル: HiDPI対応
  for (const c of [ov, cv]) {
    c.style.width = `${Math.round(width)}px`
    c.style.height = `${Math.round(height)}px`
    c.width  = Math.round(width * _dpr)
    c.height = Math.round(height * _dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(1,0,0,1,0,0)
    ctx.clearRect(0,0,c.width,c.height)
    ctx.scale(_dpr, _dpr)
  }

  // 実マスクは natural サイズ固定（BEと一致）
  m.width  = img.naturalWidth
  m.height = img.naturalHeight
  if (forceClear) {
    const ctxM = m.getContext('2d')!
    ctxM.fillStyle = '#000'
    ctxM.fillRect(0, 0, m.width, m.height)
    _hist = []
    _hIndex = -1
    _snapshot(true)
  } else {
    _repaint_overlay_from_mask()
  }

  _scaleX = img.naturalWidth  / width
  _scaleY = img.naturalHeight / height
}

function _get_coords(e: PointerEvent) {
  const ov = _overlay.value!
  const r = ov.getBoundingClientRect()
  const xCss = e.clientX - r.left
  const yCss = e.clientY - r.top
  return { xCss, yCss }
}

function _draw_stroke(xCss: number, yCss: number) {
  const ov = _overlay.value!, m = _mask.value!
  const ctxV = ov.getContext('2d')!
  const ctxM = m.getContext('2d')!

  // 可視レイヤ（赤, CSSpx）
  ctxV.globalAlpha = 1
  ctxV.lineCap = 'round'
  ctxV.lineJoin = 'round'
  ctxV.lineWidth = _brush.value
  ctxV.beginPath()
  if (_lastX == null || _lastY == null) ctxV.moveTo(xCss, yCss)
  else ctxV.moveTo(_lastX, _lastY)
  ctxV.lineTo(xCss, yCss)

  if (_tool.value === 'brush') {
    ctxV.globalCompositeOperation = 'source-over'
    ctxV.strokeStyle = `rgba(255,0,0,${_ov_alpha.value})`
  } else {
    ctxV.globalCompositeOperation = 'destination-out'
    ctxV.strokeStyle = 'rgba(0,0,0,1)'
  }
  ctxV.stroke()
  ctxV.globalCompositeOperation = 'source-over'

  // 実マスク（natural px）：白=編集 / 黒=非編集
  const lwNat = Math.max(1, Math.round(_brush.value * ((_scaleX + _scaleY) / 2)))
  ctxM.lineCap = 'round'
  ctxM.lineJoin = 'round'
  ctxM.lineWidth = lwNat
  ctxM.beginPath()
  const xNat = Math.max(0, Math.min(m.width  - 1, Math.round(xCss * _scaleX)))
  const yNat = Math.max(0, Math.min(m.height - 1, Math.round(yCss * _scaleY)))
  const lx = _lastX == null ? xNat : Math.max(0, Math.min(m.width  - 1, Math.round(_lastX * _scaleX)))
  const ly = _lastY == null ? yNat : Math.max(0, Math.min(m.height - 1, Math.round(_lastY * _scaleY)))
  ctxM.moveTo(lx, ly)
  ctxM.lineTo(xNat, yNat)
  ctxM.strokeStyle = (_tool.value === 'brush') ? '#fff' : '#000'
  ctxM.stroke()
  _strokeDirty = true

  _lastX = xCss
  _lastY = yCss
  _draw_cursor(xCss, yCss)
}

function _on_pointer_down(e: PointerEvent) {
  if (!_overlay.value) return
  _snapshot(true)
  _strokeDirty = false
  _is_drawing.value = true
  _overlay.value.setPointerCapture(e.pointerId)
  const { xCss, yCss } = _get_coords(e)
  _lastX = xCss
  _lastY = yCss
  _draw_stroke(xCss, yCss)
}
function _on_pointer_move(e: PointerEvent) {
  const { xCss, yCss } = _get_coords(e)
  if (_is_drawing.value) _draw_stroke(xCss, yCss)
  else _draw_cursor(xCss, yCss)
}
function _on_pointer_up(e: PointerEvent) {
  if (!_overlay.value) return
  _is_drawing.value = false
  _overlay.value.releasePointerCapture(e.pointerId)
  _lastX = _lastY = null
  if (_strokeDirty) _snapshot(true)
}

function _clear_mask() {
  const ov = _overlay.value!, m = _mask.value!
  const ctxV = ov.getContext('2d')!
  const ctxM = m.getContext('2d')!
  ctxV.setTransform(1,0,0,1,0,0)
  ctxV.clearRect(0, 0, ov.width, ov.height)
  ctxV.scale(_dpr, _dpr)
  ctxM.fillStyle = '#000'
  ctxM.fillRect(0, 0, m.width, m.height)
  _snapshot(true)
}

function _has_strokes(): boolean {
  const m = _mask.value
  if (!m || !m.width || !m.height) return false
  const ctx = m.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  const raster = ctx.getImageData(0, 0, m.width, m.height)
  const data: Uint8ClampedArray = raster.data
  for (let i = 0; i < data.length; i += 4 * 16) {
    const v = data[i]
    if (v !== undefined && v > 32) return true
  }
  return false
}

function _repaint_overlay_from_mask() {
  const ov = _overlay.value, m = _mask.value
  if (!ov || !m) return

  const ctxV = ov.getContext('2d')!
  const ctxM = m.getContext('2d', { willReadFrequently: true })!

  ctxV.setTransform(1, 0, 0, 1, 0, 0)
  ctxV.clearRect(0, 0, ov.width, ov.height)

  const maskData = ctxM.getImageData(0, 0, m.width, m.height).data
  const outW = ov.width
  const outH = ov.height
  const tmp = ctxV.createImageData(outW, outH)
  const out = tmp.data

  const stepX = m.width  / outW
  const stepY = m.height / outH

  for (let y = 0; y < outH; y++) {
    const srcY = Math.floor(y * stepY)
    let di = y * outW * 4
    for (let x = 0; x < outW; x++, di += 4) {
      const srcX = Math.floor(x * stepX)
      const si = (srcY * m.width + srcX) * 4
      const white = Number(maskData[si] ?? 0)
      if (white > 0) {
        out[di + 0] = 255
        out[di + 1] = 0
        out[di + 2] = 0
        out[di + 3] = Math.round(_ov_alpha.value * 255)
      } else {
        out[di + 3] = 0
      }
    }
  }

  ctxV.putImageData(tmp, 0, 0)
  ctxV.scale(_dpr, _dpr)
}

// ブラシカーソル
function _draw_cursor(xCss: number, yCss: number) {
  const cv = _cursor.value
  if (!cv) return
  const ctx = cv.getContext('2d')!
  ctx.setTransform(1,0,0,1,0,0)
  ctx.clearRect(0,0,cv.width,cv.height)
  ctx.scale(_dpr, _dpr)
  ctx.strokeStyle = _tool.value === 'brush' ? 'rgba(255,0,0,.9)' : 'rgba(255,255,255,.9)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(xCss, yCss, _brush.value/2, 0, Math.PI*2)
  ctx.stroke()
}

function _set_tool(t: 'brush'|'eraser') {
  _tool.value = t
}

// プロンプト入力：Ctrl/⌘ + Enter で実行
function _on_prompt_keydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    _apply_edit()
  }
}

// キーボードショートカット
function _on_key(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA'
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) _redo_once()
    else _undo_once()
    return
  }
  if (inInput) return

  const k = e.key
  if (k === 'b' || k === 'B') _set_tool('brush')
  if (k === 'e' || k === 'E') _set_tool('eraser')
  if (k === '[') _brush.value = Math.max(2, _brush.value - 2)
  if (k === ']') _brush.value = Math.min(256, _brush.value + 2)
  if (k === 'c' || k === 'C') _clear_mask()
  if (k === 'Escape') emit('close')
}

async function _apply_edit() {
  const m = _mask.value
  if (!m) return
  if (!_has_strokes()) {
    alert('マスクが空です。編集したい範囲を赤で塗ってください。')
    return
  }
  if (!props.filename) { alert('元画像が保存されていません（ファイル名が必要です）'); return }
  if (!_prompt.value.trim()) { alert('編集内容（プロンプト）を入力してください'); return }

  try {
    _working.value = true
    const maskDataUrl = m.toDataURL('image/png') // 白=編集、黒=非編集
    const res = await _edit_image({
      filename: props.filename,
      maskDataUrl,
      prompt: _prompt.value.trim(),
      feather: props.feather,
      padding: props.padding,
      save: props.autosave
    })
    emit('done', { dataUrl: res.dataUrl, saved: res.saved || null })
    _clear_mask()
  } catch (e: any) {
    alert(`マスク編集に失敗しました: ${e?.message ?? e}`)
  } finally {
    _working.value = false
  }
}

onMounted(() => {
  const img = _img_el.value!
  const onload = () => _resize_canvases(true)
  if (img.complete && img.naturalWidth) onload()
  else img.addEventListener('load', onload, { once: true })

  const ro = new ResizeObserver(() => _resize_canvases(false))
  ro.observe(_container.value!)

  window.addEventListener('keydown', _on_key, { passive: false })
  _cleanup = () => {
    ro.disconnect()
    window.removeEventListener('keydown', _on_key)
  }
})

let _cleanup: null | (() => void) = null
onBeforeUnmount(() => { if (_cleanup) _cleanup() })

watch(() => props.imageUrl, () => {
  _resize_canvases(true)
})
watch(_ov_alpha, () => _repaint_overlay_from_mask())
</script>

<template>
  <div class="_editor_wrap">
    <!-- ツールバー -->
    <div class="_toolbar">
      <!-- ツール切替 -->
      <div class="_seg">
        <button class="_seg_btn" :class="{ _active: _tool==='brush' }" @click="_set_tool('brush')" title="B">ブラシ</button>
        <button class="_seg_btn" :class="{ _active: _tool==='eraser' }" @click="_set_tool('eraser')" title="E">消しゴム</button>
      </div>

      <!-- ブラシ -->
      <div class="_brush_ctrl">
        <label class="_label">ブラシ</label>
        <input class="_brush_input" type="range" min="2" max="256" v-model.number="_brush" aria-label="ブラシサイズ" />
        <span class="_brush_px">{{ _brush }}px</span>
      </div>

      <!-- オーバーレイ透明度 -->
      <div class="_alpha_ctrl">
        <label class="_label">オーバーレイ</label>
        <input class="_alpha_input" type="range" min="0.1" max="0.9" step="0.05" v-model.number="_ov_alpha" />
        <span class="_alpha_val">{{ Math.round(_ov_alpha * 100) }}%</span>
      </div>
    </div>

    <!-- プロンプト & 実行 -->
    <div class="_prompt_row">
      <input
        class="_prompt_input"
        v-model="_prompt"
        placeholder="例: 塗った壁を白い塗装に、自然に。陰影と質感は周囲と馴染ませる"
        aria-label="編集内容のプロンプト"
        @keydown="_on_prompt_keydown"
      />
    </div>
    <div>
      <div>
        <button class="_btn _primary" :disabled="_working" @click="_apply_edit">
          {{ _working ? '処理中…' : 'この内容で編集する' }}
        </button>
      </div>
      <div>
        <button class="_btn" @click="$emit('close')">閉じる</button>
      </div>
    </div>
    <!-- ステージ -->
    <div class="_stage" ref="_container">
      <img ref="_img_el" class="_base_img" :src="imageUrl" alt="編集元の画像" />
      <canvas
        ref="_overlay"
        class="_overlay"
        :style="{ opacity: String(_ov_alpha) }"
        @pointerdown="_on_pointer_down"
        @pointermove="_on_pointer_move"
        @pointerup="_on_pointer_up"
        @pointercancel="_on_pointer_up"
        @pointerleave="_on_pointer_up"
      />
      <canvas ref="_cursor" class="_cursor" />
      <canvas ref="_mask" class="_mask_canvas" />
    </div>

    <div class="_hint">
      ・赤く塗った部分が「編集対象」です（内部では 白=編集 / 黒=非編集 のマスクPNGを送信）<br>
      ・ショートカット：B / E（ツール切替）、[ / ]（ブラシサイズ）、Ctrl/⌘+Z（戻す）、Ctrl/⌘+Shift+Z（やり直す）、C（消去）、Ctrl/⌘+Enter（編集実行）、Esc（閉じる）
    </div>
  </div>
</template>

<style scoped lang="sass">
._editor_wrap
  display: grid
  gap: 16px

._toolbar
  display: flex
  flex-wrap: wrap
  gap: 8px
  align-items: center

._seg
  display: inline-flex
  border: 1px solid #444
  border-radius: 10px
  overflow: hidden

._seg_btn
  padding: 10px 12px
  background: #1a1a1a
  color: #ccc
  border: none
  cursor: pointer
  font-size: 13px

._seg_btn + ._seg_btn
  border-left: 1px solid #444

._seg_btn._active
  background: #274
  color: #fff

._brush_ctrl, ._alpha_ctrl
  display: flex
  align-items: center
  gap: 6px

._label
  font-size: 12px
  opacity: .8

._brush_input
  width: 160px

._brush_px
  width: 60px
  font-size: 12px
  text-align: right
  opacity: .7

._alpha_input
  width: 140px

._alpha_val
  width: 44px
  font-size: 12px
  text-align: right
  opacity: .7

._prompt_row
  display: grid
  grid-template-columns: 1fr auto auto
  gap: 8px
  align-items: center

._prompt_input
  width: 100%
  padding: 10px
  border: 1px solid #444
  border-radius: 8px
  background: #111
  color: #eee
  min-width: 240px

._btn
  padding: 10px 14px
  border-radius: 8px
  border: 1px solid #666
  background: #222
  color: #eee
  cursor: pointer
  height: 40px

._primary
  border-color: #4a8
  background: #274

._stage
  position: relative
  width: 100%
  max-width: 880px
  border: 1px solid #333
  border-radius: 10px
  overflow: hidden
  justify-self: center
  background: #0f0f0f

._base_img
  display: block
  width: 100%
  height: auto
  position: relative
  z-index: 1
  user-select: none
  -webkit-user-drag: none

._overlay
  position: absolute
  inset: 0
  touch-action: none
  cursor: crosshair
  z-index: 2

._cursor
  position: absolute
  inset: 0
  pointer-events: none
  z-index: 3

._mask_canvas
  display: none

._hint
  font-size: 12px
  opacity: .7
  line-height: 1.6
</style>
