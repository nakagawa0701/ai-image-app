<script setup lang="ts">
defineProps<{
  dataUrl: string
}>()

const emit = defineEmits<{
  (e: 'complete'): void
  (e: 'modify'): void
}>()
</script>

<template>
  <div class="_overlay">
    <div class="_card">
      <h2 class="_card_title">生成しました</h2>
      <img :src="dataUrl" alt="generated preview" class="_preview_img" />
      <p class="_card_hint">この画像をどうしますか？</p>
      <div class="_actions">
        <button class="_btn _btn_modify" @click="emit('modify')">修正する</button>
        <button class="_btn _btn_complete" @click="emit('complete')">完成（保存）</button>
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
  z-index: 100

._card
  background: #222
  border-radius: 16px
  padding: 24px
  display: grid
  gap: 16px
  border: 1px solid #444
  max-width: 500px
  width: 90%

._card_title
  font-size: 20px
  font-weight: 700
  text-align: center

._preview_img
  width: 100%
  border-radius: 10px
  aspect-ratio: 1
  object-fit: contain

._card_hint
  font-size: 14px
  text-align: center
  opacity: 0.8

._actions
  display: grid
  grid-template-columns: 1fr 1fr
  gap: 12px

._btn
  padding: 12px
  border-radius: 8px
  border: none
  font-size: 16px
  font-weight: 700
  cursor: pointer

._btn_modify
  background: #444
  color: #fff
  border: 1px solid #666

._btn_complete
  background: #3a7fff
  color: #fff
</style>
