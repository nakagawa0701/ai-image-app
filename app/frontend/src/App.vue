<script setup lang="ts">
import { ref } from 'vue'
import { api_generate, type ImageSize } from './lib/api'

const _prompt = ref('')
const _size = ref<ImageSize>('1024x1024')
const _loading = ref(false)
const _error = ref<string | null>(null)
const _images = ref<string[]>([])

const _on_generate = async () => {
  _error.value = null
  if (!_prompt.value.trim()) {
    _error.value = 'プロンプトを入力してください'
    return
  }
  _loading.value = true
  try {
    const url = await api_generate(_prompt.value.trim(), _size.value)
    _images.value = [url] // v1は1枚で十分
  } catch (e: any) {
    _error.value = e?.message ?? '生成に失敗しました'
  } finally {
    _loading.value = false
  }
}
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
      <img
        v-for="(img, i) in _images"
        :key="i"
        :src="img"
        alt="generated"
        class="_thumb"
      />
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

._thumb
  width: 100%
  aspect-ratio: 1
  object-fit: cover
  border: 1px solid #333
  border-radius: 10px

._hint
  opacity: .7
  font-size: 12px
</style>
