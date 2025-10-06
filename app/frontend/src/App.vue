<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  _generate_image,
  _save_image,
  _list_images,
  type _image_size,
  type _generate_result
} from './lib/api'

type _image_state = Partial<_generate_result> & {
  dataUrl: string
  is_saving: boolean
  is_saved: boolean
  save_error: string | null
}

const _prompt = ref('')
const _size = ref<_image_size>('1024x1024')
const _loading = ref(false)
const _error = ref<string | null>(null)
const _images = ref<_image_state[]>([])

const _on_generate = async () => {
  _error.value = null
  if (!_prompt.value.trim()) {
    _error.value = 'プロンプトを入力してください'
    return
  }
  _loading.value = true
  try {
    const result = await _generate_image(_prompt.value.trim(), _size.value)
    _images.value.unshift({ ...result, is_saving: false, is_saved: false, save_error: null }) // v1は1枚で十分
  } catch (e: any) {
    _error.value = e?.message ?? '生成に失敗しました'
  } finally {
    _loading.value = false
  }
}

const _on_save = async (image: _image_state) => {
  if (!image.base64 || !image.mime) return
  image.is_saving = true
  image.save_error = null
  try {
    const saved = await _save_image(image.base64, image.mime)
    image.is_saved = true
    image.dataUrl = saved.url // URLを永続的なものに更新
    image.base64 = undefined // 不要になったので消す
  } catch (e: any) {
    image.save_error = e?.message ?? '保存に失敗しました'
  } finally {
    image.is_saving = false
  }
}

onMounted(async () => {
  try {
    const images = await _list_images()
    _images.value = images.map((img) => ({
      dataUrl: img.url,
      is_saved: true,
      is_saving: false,
      save_error: null
    }))
  } catch (e: any) {
    _error.value = e?.message ?? '画像の読み込みに失敗しました'
  }
})
</script>

<template>
  <div class="_layout">
    <h1 class="_title">画像生成</h1>

    <div class="_form">
      <input
        class="_prompt_input"
        v-model="_prompt"
        placeholder="例: 青い森に浮かぶ紙飛行機、ミニマルでフラット"
      />
      <select class="_size_select" v-model="_size">
        <option value="1024x1024">1024x1024（正方形）</option>
        <option value="1024x1536">1024x1536（縦長）</option>
        <option value="1536x1024">1536x1024（横長）</option>
      </select>
      <button class="_generate_btn" :disabled="_loading" @click="_on_generate">
        {{ _loading ? '生成中…' : '生成' }}
      </button>
      <div v-if="_error" class="_error">{{ _error }}</div>
    </div>

    <div class="_grid">
      <div v-for="(img, i) in _images" :key="i" class="_thumb_wrap">
        <img :src="img.dataUrl" alt="generated" class="_thumb" />
        <div class="_thumb_actions">
          <button
            class="_save_btn"
            :disabled="img.is_saving || img.is_saved"
            @click="_on_save(img)"
          >
            {{ img.is_saving ? '保存中…' : img.is_saved ? '保存済み' : '保存' }}
          </button>
          <div v-if="img.save_error" class="_error">{{ img.save_error }}</div>
        </div>
      </div>
    </div>

    <div class="_hint">次のステップで「マスク編集」ページを足します。</div>
  </div>
</template>

<style scoped lang="sass">
._layout
  padding: 24px
  display: grid
  gap: 16px

._title
  font-size: 22px
  font-weight: 700

._form
  display: grid
  grid-template-columns: 1fr auto auto
  gap: 8px
  align-items: center

._prompt_input
  padding: 10px
  border: 1px solid #444
  border-radius: 8px
  background: #111
  color: #eee

._size_select
  padding: 10px
  border: 1px solid #444
  border-radius: 8px
  background: #111
  color: #eee

._generate_btn
  padding: 10px 14px
  border-radius: 8px
  border: 1px solid #666

._error
  grid-column: 1 / -1
  color: #ff6b6b
  font-size: 12px

._grid
  display: grid
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))
  gap: 12px

._thumb_wrap
  display: grid
  gap: 8px

._thumb
  width: 100%
  aspect-ratio: 1
  object-fit: cover
  border: 1px solid #333
  border-radius: 10px

._thumb_actions
  display: grid
  gap: 4px

._save_btn
  padding: 8px
  border-radius: 6px
  border: 1px solid #666
  width: 100%

._hint
  opacity: .7
  font-size: 12px
</style>
