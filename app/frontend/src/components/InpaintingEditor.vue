<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  dataUrl: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'regenerate', payload: { mask: string; prompt: string }): void
}>()

const _new_prompt = ref('')
const _brush_size = ref(40)

const _image_ref = ref<HTMLImageElement | null>(null)
const _canvas_ref = ref<HTMLCanvasElement | null>(null)
const _ctx = ref<CanvasRenderingContext2D | null>(null)

const _is_drawing = ref(false)
const _last_pos = ref<{ x: number; y: number } | null>(null)

// Canvasのセットアップ
const _setup_canvas = () => {
  const img = _image_ref.value
  const canvas = _canvas_ref.value
  if (!img || !canvas) return

  // 画像の表示サイズに合わせてCanvasの解像度を設定
  const rect = img.getBoundingClientRect()
  canvas.width = rect.width
  canvas.height = rect.height

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  _ctx.value = ctx

  // ブラシを白に設定
  ctx.fillStyle = '#FFFFFF'
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = _brush_size.value
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

// リサイズ時にCanvasを再セットアップするためのObserver
let _resize_observer: ResizeObserver | null = null
onMounted(() => {
  const container = _image_ref.value?.parentElement
  if (container) {
    _resize_observer = new ResizeObserver(() => {
      _setup_canvas()
    })
    _resize_observer.observe(container)
  }
})
onUnmounted(() => {
  _resize_observer?.disconnect()
})

// dataUrlが変更されたら(画像が読み込まれたら)Canvasをセットアップ
watch(() => props.dataUrl, () => {
  const img = new Image()
  img.onload = () => _setup_canvas()
  img.src = props.dataUrl
}, { once: true })

// ブラシサイズが変更されたらContextに反映
watch(_brush_size, (size) => {
  if (_ctx.value) {
    _ctx.value.lineWidth = size
  }
})

const _get_canvas_pos = (e: MouseEvent) => {
  const canvas = _canvas_ref.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  }
}

const _start_draw = (e: MouseEvent) => {
  _is_drawing.value = true
  _last_pos.value = _get_canvas_pos(e)
}

const _stop_draw = () => {
  _is_drawing.value = false
  _last_pos.value = null
}

const _draw = (e: MouseEvent) => {
  if (!_is_drawing.value || !_ctx.value || !_last_pos.value) return
  const pos = _get_canvas_pos(e)
  _ctx.value.beginPath()
  _ctx.value.moveTo(_last_pos.value.x, _last_pos.value.y)
  _ctx.value.lineTo(pos.x, pos.y)
  _ctx.value.stroke()
  _last_pos.value = pos
}

const _clear_mask = () => {
  const canvas = _canvas_ref.value
  const ctx = _ctx.value
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
}

const _on_regenerate = () => {
  const canvas = _canvas_ref.value
  if (!canvas) return

  // バックグラウンドで黒背景のマスクを生成する
  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = canvas.width
  tempCanvas.height = canvas.height
  const tempCtx = tempCanvas.getContext('2d')
  if (!tempCtx) return

  // 黒で塗りつぶし
  tempCtx.fillStyle = '#000000'
  tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height)

  // ユーザーが描画した白いマスクを上に描画
  tempCtx.drawImage(canvas, 0, 0)

  const mask = tempCanvas.toDataURL('image/png')
  emit('regenerate', { mask, prompt: _new_prompt.value })
}
</script>

<template>
  <div class="_overlay">
    <div class="_editor">
      <div class="_header">
        <h2 class="_title">マスク編集</h2>
        <button class="_close_btn" @click="emit('close')">×</button>
      </div>

      <div class="_main_view">
        <div class="_img_container">
          <img ref="_image_ref" :src="dataUrl" alt="editing image" class="_img" />
          <canvas
            ref="_canvas_ref"
            class="_canvas"
            @mousedown="_start_draw"
            @mouseup="_stop_draw"
            @mouseleave="_stop_draw"
            @mousemove="_draw"
          ></canvas>
        </div>

        <div class="_toolbar">
          <div class="_tool">
            <label for="brush_size">ブラシサイズ: {{ _brush_size }}</label>
            <input
              type="range"
              id="brush_size"
              min="10"
              max="100"
              v-model="_brush_size"
              class="_slider"
            />
          </div>
          <div class="_tool">
            <button class="_btn _btn_clear" @click="_clear_mask">マスクをクリア</button>
          </div>
          <div class="_tool">
            <label for="new_prompt">修正プロンプト（マスク部分の指示）</label>
            <input
              id="new_prompt"
              v-model="_new_prompt"
              placeholder="例: サングラスをかけている"
              class="_prompt_input"
            />
          </div>
        </div>
      </div>

      <div class="_footer">
        <button class="_btn _btn_cancel" @click="emit('close')">キャンセル</button>
        <button class="_btn _btn_regen" @click="_on_regenerate">再生成</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="sass">
._overlay
  position: fixed
  top: 0
  left: 0
  right: 0
  bottom: 0
  background: rgba(0,0,0,0.8)
  display: grid
  place-items: center
  z-index: 200

._editor
  background: #282828
  border-radius: 16px
  border: 1px solid #444
  width: 90vw
  height: 90vh
  max-width: 1400px
  display: flex
  flex-direction: column

._header
  display: flex
  justify-content: space-between
  align-items: center
  padding: 12px 20px
  border-bottom: 1px solid #444

._title
  font-size: 18px
  font-weight: 700

._close_btn
  background: none
  border: none
  color: #fff
  font-size: 24px
  cursor: pointer

._main_view
  flex: 1
  display: grid
  grid-template-columns: 1fr 300px
  gap: 20px
  padding: 20px
  overflow: hidden

._img_container
  position: relative
  display: grid
  place-items: center
  background: #111
  border-radius: 10px
  overflow: hidden

._img
  max-width: 100%
  max-height: 100%
  object-fit: contain

._canvas
  position: absolute
  top: 0
  left: 0
  cursor: crosshair

._toolbar
  display: flex
  flex-direction: column
  gap: 24px
  padding: 10px

._tool
  display: grid
  gap: 8px

._slider
  width: 100%

._prompt_input
  padding: 10px
  border: 1px solid #444
  border-radius: 8px
  background: #111
  color: #eee
  width: 100%

._btn_clear
  padding: 10px
  border-radius: 8px
  border: 1px solid #666
  background: #333
  color: #fff

._footer
  display: flex
  justify-content: flex-end
  gap: 12px
  padding: 16px 20px
  border-top: 1px solid #444

._btn
  padding: 12px 20px
  border-radius: 8px
  border: none
  font-size: 16px
  font-weight: 700
  cursor: pointer

._btn_cancel
  background: #444
  color: #fff
  border: 1px solid #666

._btn_regen
  background: #3a7fff
  color: #fff
</style>
