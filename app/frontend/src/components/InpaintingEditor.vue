<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { _edit_image } from '../lib/api'

type _props = {
  filename: string              // 保存済み元画像のファイル名（例: 1234-....png）
  imageUrl: string              // 元画像のURL（/api/files/...）
  defaultPrompt?: string
  defaultBrush?: number         // px
  feather?: number              // 合成の境界ぼかし(px)
  padding?: number              // 生成パッチの余白(px)
  autosave?: boolean            // trueなら編集結果をedits/へ保存
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

const _img_el = ref<HTMLImageElement | null>(null)
const _overlay = ref<HTMLCanvasElement | null>(null) // 画面上に重ねる赤塗り可視用
const _mask = ref<HTMLCanvasElement | null>(null)    // 実体の白黒マスク（送信）
const _container = ref<HTMLDivElement | null>(null)

const _prompt = ref(props.defaultPrompt)
const _brush = ref(props.defaultBrush)
const _is_drawing = ref(false)
let _rect: DOMRect | null = null
let _scaleX = 1
let _scaleY = 1

function _resize_canvases() {
  const img = _img_el.value
  const ov = _overlay.value
  if (!img || !ov) return
  const { width, height } = img.getBoundingClientRect()
  ov.width = Math.round(width)
  ov.height = Math.round(height)

  const m = _mask.value!
  m.width = img.naturalWidth
  m.height = img.naturalHeight

  _rect = img.getBoundingClientRect()
  _scaleX = img.naturalWidth / width
  _scaleY = img.naturalHeight / height

  const ctx = ov.getContext('2d')!
  ctx.clearRect(0, 0, ov.width, ov.height)
}

function _draw_point(clientX: number, clientY: number) {
  const ov = _overlay.value!, m = _mask.value!
  if (!_rect) return

  const x = clientX - _rect.left
  const y = clientY - _rect.top

  // 可視レイヤ（赤）
  const ctxV = ov.getContext('2d')!
  ctxV.fillStyle = 'rgba(255,0,0,.45)'
  ctxV.beginPath()
  ctxV.arc(x, y, _brush.value / 2, 0, Math.PI * 2)
  ctxV.fill()

  // 実マスク（白=編集、黒=非編集）
  const ctxM = m.getContext('2d')!
  ctxM.fillStyle = '#ffffff'
  ctxM.beginPath()
  // 半径スケーリング（任意：平均スケールで安定）
  const r = Math.round((_brush.value / 2) * ((_scaleX + _scaleY) / 2))
  ctxM.arc(Math.round(x * _scaleX), Math.round(y * _scaleY), r, 0, Math.PI * 2)
  ctxM.fill()
}

function _on_pointer_down(e: PointerEvent) {
  _is_drawing.value = true
  _overlay.value!.setPointerCapture(e.pointerId)
  _draw_point(e.clientX, e.clientY)
}
function _on_pointer_move(e: PointerEvent) {
  if (!_is_drawing.value) return
  _draw_point(e.clientX, e.clientY)
}
function _on_pointer_up(e: PointerEvent) {
  _is_drawing.value = false
  _overlay.value!.releasePointerCapture(e.pointerId)
}

function _clear_mask() {
  const ov = _overlay.value!, m = _mask.value!
  const v = ov.getContext('2d')!, t = m.getContext('2d')!
  v.clearRect(0, 0, ov.width, ov.height)
  t.fillStyle = '#000000'
  t.fillRect(0, 0, m.width, m.height)
}

const _working = ref(false)

async function _apply_edit() {
  const m = _mask.value!
  const maskDataUrl = m.toDataURL('image/png') // 白=編集対象、黒=非編集
  if (!props.filename) {
    alert('元画像が保存されていません（ファイル名が必要です）')
    return
  }
  if (!_prompt.value.trim()) {
    alert('編集内容（プロンプト）を入力してください')
    return
  }
  try {
    _working.value = true
    const res = await _edit_image({
      filename: props.filename,
      maskDataUrl,
      prompt: _prompt.value.trim(),
      feather: props.feather,
      padding: props.padding,
      save: props.autosave
    })
    emit('done', { dataUrl: res.dataUrl, saved: res.saved || null })
  } catch (e: any) {
    alert(`マスク編集に失敗しました: ${e?.message ?? e}`)
  } finally {
    _working.value = false
  }
}

onMounted(() => {
  const m = _mask.value!
  const ctx = m.getContext('2d')!
  const img = _img_el.value!
  const onload = () => {
    _resize_canvases()
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, m.width, m.height)
  }
  if (img.complete && img.naturalWidth) onload()
  else img.addEventListener('load', onload, { once: true })

  const ro = new ResizeObserver(() => _resize_canvases())
  ro.observe(_container.value!)
  _cleanup = () => ro.disconnect()
})

let _cleanup: null | (() => void) = null
onBeforeUnmount(() => { if (_cleanup) _cleanup() })
</script>

<template>
  <div class="_editor_wrap">
    <div class="_toolbar">
      <input class="_prompt_input" v-model="_prompt" placeholder="例: 左上の雲を消して青空に、自然に" aria-label="編集内容（プロンプト）" />
      <div class="_brush_ctrl">
        <label class="_label">ブラシ</label>
        <input class="_brush_input" type="range" min="4" max="128" v-model.number="_brush" aria-label="ブラシサイズ" />
        <span class="_brush_px">{{ _brush }}px</span>
      </div>
      <button class="_btn" @click="_clear_mask">マスクを消去</button>
      <button class="_btn _primary" :disabled="_working" @click="_apply_edit">{{ _working ? '処理中…' : 'この内容で編集する' }}</button>
      <button class="_btn" @click="$emit('close')">閉じる</button>
    </div>

    <div class="_stage" ref="_container">
      <img ref="_img_el" class="_base_img" :src="imageUrl" alt="編集元の画像" />
      <canvas
        ref="_overlay"
        class="_overlay"
        @pointerdown="_on_pointer_down"
        @pointermove="_on_pointer_move"
        @pointerup="_on_pointer_up"
        @pointercancel="_on_pointer_up"
        @pointerleave="_on_pointer_up"
      />
      <!-- 実マスク: 画面には表示しない -->
      <canvas ref="_mask" class="_mask_canvas" />
    </div>

    <div class="_hint">赤く塗った部分が「編集対象」になります（内部では白=編集、黒=非編集のマスクPNGとして送信）。</div>
  </div>
</template>

<style scoped lang="sass">
._editor_wrap
  display: grid
  gap: 12px

._toolbar
  display: flex
  flex-wrap: wrap
  gap: 8px
  align-items: center

._prompt_input
  flex: 1
  min-width: 260px
  padding: 10px
  border: 1px solid #444
  border-radius: 8px
  background: #111
  color: #eee

._brush_ctrl
  display: flex
  align-items: center
  gap: 6px

._label
  font-size: 12px
  opacity: .8

._brush_input
  width: 140px

._brush_px
  width: 56px
  font-size: 12px
  text-align: right
  opacity: .7

._btn
  padding: 10px 14px
  border-radius: 8px
  border: 1px solid #666
  background: #222
  color: #eee
  cursor: pointer

._primary
  border-color: #4a8
  background: #274

._stage
  position: relative
  width: 100%
  max-width: 720px
  border: 1px solid #333
  border-radius: 10px
  overflow: hidden

._base_img
  display: block
  width: 100%
  height: auto

._overlay
  position: absolute
  inset: 0
  touch-action: none
  cursor: crosshair

._mask_canvas
  display: none

._hint
  font-size: 12px
  opacity: .7
</style>
