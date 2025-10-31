<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import InpaintingEditor from './components/InpaintingEditor.vue'
import {
  _generate_image,
  _save_image,
  _list_images,
  _delete_image,
  type _image_size,
  type _generate_result,
  type _save_result,
  type _image_item
} from './lib/api'

// ---- 状態 ----
const _prompt = ref('')
const _size = ref<_image_size>('1024x1024')
const _loading = ref(false)
const _saving = ref(false)
const _error = ref<string | null>(null)
const _deleting = ref<Set<string>>(new Set())

// 表示中の画像（data URL）と保存情報
const _current = ref<{ dataUrl: string; mime: string } | null>(null)
const _saved = ref<_save_result | null>(null)

// エディタ表示
const _editing = ref(false)

// 履歴
const _history = ref<_image_item[]>([])
const _history_loading = ref(false)
const _history_error = ref<string | null>(null)

// ---- ユーティリティ（英語エラー → 日本語整形） ----
function _ja_error(e: any, fallback: string) {
  const m = String(e?.message || '')
  if (m.includes('prompt_required')) return 'プロンプトを入力してください'
  if (m.includes('invalid_openrouter_api_key') || m.includes('401')) return 'OpenRouter の API キーが無効です（.env を確認）'
  if (m.includes('openrouter_http_429')) return 'リクエストが多すぎます。しばらく待ってから再実行してください'
  if (m.includes('no_image_in_response')) return '画像を取得できませんでした（モデル設定を確認してください）'
  if (m.includes('list_images_failed')) return '保存済み画像の取得に失敗しました'
  if (m.includes('generate_failed')) return '画像の生成に失敗しました'
  if (m.includes('save_failed')) return '画像の保存に失敗しました'
  if (m.includes('edit_failed')) return 'マスク編集に失敗しました'
  return fallback
}

function _open_from_history(it: _image_item) {
  // すでに保存済みなので、そのまま "編集対象" としてセット
  _saved.value = { url: it.url, filename: it.filename, mime: it.mime }
  // プレビュー表示。dataURLでなくても <img src> はOK
  _current.value = { dataUrl: it.url, mime: it.mime }
  _editing.value = true
}

// ---- 履歴読込 ----
async function _load_history() {
  _history_error.value = null
  _history_loading.value = true
  try {
    _history.value = await _list_images({ kind: 'all', limit: 60 })
  } catch (e: any) {
    _history_error.value = _ja_error(e, '保存済み画像の取得に失敗しました')
  } finally {
    _history_loading.value = false
  }
}

async function _on_delete_from_history(it: _image_item) {
  if (!confirm(`${it.filename}\nこの画像を削除します。よろしいですか？`)) return
  _deleting.value = new Set(_deleting.value).add(it.filename)
  try {
    await _delete_image(it.filename)

    // もしプレビュー中の画像を消したらUIをクリア
    if (_saved.value?.filename === it.filename) {
      _current.value = null
      _saved.value = null
      _editing.value = false
    }

    // 履歴から除去（再読込でもOKだが即時反映にする）
    _history.value = _history.value.filter(x => x.filename !== it.filename)
  } catch (e: any) {
    alert(`削除に失敗しました: ${e?.message ?? e}`)
  } finally {
    const s = new Set(_deleting.value)
    s.delete(it.filename)
    _deleting.value = s
  }
}

const _is_from_history = computed(() => {
  return Boolean(_saved.value && _current.value?.dataUrl === _saved.value.url)
})

// ---- アクション ----
const _on_generate = async () => {
  _error.value = null
  if (!_prompt.value.trim()) {
    _error.value = 'プロンプトを入力してください'
    return
  }
  _loading.value = true
  try {
    const res: _generate_result = await _generate_image(_prompt.value.trim(), _size.value)
    _current.value = { dataUrl: res.dataUrl, mime: res.mime }
    _saved.value = null // 新規生成時は保存状態をリセット
  } catch (e: any) {
    _error.value = _ja_error(e, '画像の生成に失敗しました')
  } finally {
    _loading.value = false
  }
}

const _on_save = async () => {
  _error.value = null
  if (!_current.value) {
    _error.value = '保存する画像がありません'
    return
  }
  _saving.value = true
  try {
    const saved = await _save_image(_current.value.dataUrl)
    _saved.value = saved
    _load_history() // 履歴を更新
  } catch (e: any) {
    _error.value = _ja_error(e, '画像の保存に失敗しました')
  } finally {
    _saving.value = false
  }
}

const _open_editor = () => {
  if (!_saved.value) {
    _error.value = '編集するには、まず画像を保存してファイル名（filename）を取得してください'
    return
  }
  _editing.value = true
}

const _on_done_edit = (p: { dataUrl: string; saved?: { url: string; filename: string; mime: string } | null }) => {
  // 編集後の結果をそのまま表示に反映
  _current.value = { dataUrl: p.dataUrl, mime: 'image/png' }
  if (p.saved) _saved.value = p.saved
  _editing.value = false
  _load_history() // 履歴を更新
}

onMounted(() => { _load_history() })
</script>

<template>
  <div class="_page_root">
    <header class="_header">
      <h1 class="_title">AI 画像生成とマスク編集</h1>
      <p class="_subtitle">1) 生成 → 2) 保存（ファイル名を取得）→ 3) 編集（赤く塗った部分だけ反映）</p>
    </header>

    <section class="_panel">
      <div class="_form_row">
        <input
          class="_prompt_input"
          v-model="_prompt"
          placeholder="例: 青い森に浮かぶ紙飛行機、ミニマルでフラット"
          aria-label="プロンプト"
        />
        <button class="_btn _primary" :disabled="_loading" @click="_on_generate">
          {{ _loading ? '生成中…' : '生成する' }}
        </button>
      </div>
      <div class="_note">サイズ指定はプロンプト内で指定してください。</div>
      <div v-if="_error" class="_error">{{ _error }}</div>
    </section>

    <section v-if="_current" class="_panel">
      <div class="_preview_row">
        <img :src="_current.dataUrl" alt="生成結果" class="_thumb" />
        <div class="_actions_col">
          <button class="_btn" :disabled="_saving || !_current" @click="_on_save">
            {{ _saving ? '保存中…' : 'この画像を保存' }}
          </button>
          <button class="_btn" :disabled="!_saved" @click="_open_editor">この画像を編集</button>
          <a v-if="_saved?.url" class="_link" :href="_saved.url" download>保存した画像をダウンロード</a>
          <div v-if="_saved" class="_meta">
            <div class="_meta_row"><span class="_meta_label">ファイル名</span><span class="_meta_val">{{ _saved.filename }}</span></div>
            <div class="_meta_row"><span class="_meta_label">形式</span><span class="_meta_val">{{ _saved.mime }}</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="_panel">
      <div class="_history_head">
        <h2 class="_subtitle2">保存済みの画像（履歴）</h2>
        <div class="_history_actions">
          <button class="_btn" :disabled="_history_loading" @click="_load_history">
            {{ _history_loading ? '更新中…' : '再読み込み' }}
          </button>
        </div>
      </div>

      <div v-if="_history_error" class="_error">{{ _history_error }}</div>

      <div class="_history_grid" v-if="_history.length">
        <div class="_history_item" v-for="it in _history" :key="it.filename">
          <a :href="it.url" target="_blank" class="_history_card">
            <img class="_history_img" :src="it.url" :alt="it.filename" />
            <div class="_history_meta">
              <span class="_pill" :class="it.kind === 'edits' ? '_pill_edits' : '_pill_gen'">
                {{ it.kind === 'edits' ? '編集' : '生成' }}
              </span>
              <span class="_fname">{{ it.filename }}</span>
              <span class="_mtime">{{ new Date(it.mtime).toLocaleString('ja-JP') }}</span>
            </div>
          </a>
          <div class="_history_actions_row">
            <button class="_btn" @click="_open_from_history(it)">この画像を編集</button>
            <button
              class="_btn _danger"
              :disabled="_deleting.has(it.filename)"
              @click="_on_delete_from_history(it)"
            >
              {{ _deleting.has(it.filename) ? '削除中…' : '削除' }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="_muted">まだ保存された画像はありません</div>
    </section>

    <!-- モーダル（マスク編集） -->
    <div v-if="_editing && _saved" class="_modal_backdrop" @click.self="_editing=false">
      <div class="_modal_card" role="dialog" aria-label="マスク編集">
        <InpaintingEditor
          :filename="_saved.filename"
          :image-url="_saved.url"
          :default-prompt="'不要な部分を自然に修正'"
          :feather="2"
          :padding="12"
          :autosave="true"
          @done="_on_done_edit"
          @close="_editing=false"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="sass">
._page_root
  padding: 24px
  display: grid
  gap: 16px

._header
  display: grid
  gap: 6px

._title
  font-size: 22px
  font-weight: 700

._subtitle
  opacity: .8
  font-size: 12px

._panel
  display: grid
  gap: 10px
  padding: 16px
  border: 1px solid #333
  border-radius: 12px
  background: #111

._form_row
  display: grid
  grid-template-columns: 1fr auto auto
  gap: 8px
  align-items: center

._prompt_input
  padding: 10px
  border: 1px solid #444
  border-radius: 8px
  background: #000
  color: #eee

._size_select
  padding: 10px
  border: 1px solid #444
  border-radius: 8px
  background: #000
  color: #eee

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

._note
  font-size: 12px
  opacity: .7

._error
  color: #ff6b6b
  font-size: 12px

._preview_row
  display: grid
  grid-template-columns: 1fr auto
  gap: 16px
  align-items: start

._thumb
  width: 100%
  aspect-ratio: 1
  object-fit: cover
  border: 1px solid #333
  border-radius: 10px

._actions_col
  display: grid
  gap: 10px
  min-width: 240px

._link
  font-size: 12px
  text-decoration: underline

._meta
  display: grid
  gap: 4px
  font-size: 12px
  opacity: .85

._meta_row
  display: grid
  grid-template-columns: 80px 1fr
  gap: 8px

._meta_label
  opacity: .7

/* 履歴 */
._subtitle2
  font-size: 16px
  font-weight: 700

._history_head
  display: flex
  align-items: center
  justify-content: space-between

._history_actions
  display: flex
  gap: 8px

._history_grid
  display: grid
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))
  gap: 12px

._history_card
  display: grid
  gap: 6px
  border: 1px solid #333
  border-radius: 10px
  padding: 8px
  background: #0d0d0d
  text-decoration: none
  color: inherit

._history_img
  width: 100%
  aspect-ratio: 1
  object-fit: cover
  border-radius: 6px

._history_meta
  display: grid
  gap: 2px
  font-size: 11px
  opacity: .9

._history_item
  display: grid
  gap: 6px

._history_actions_row
  display: flex
  flex-direction: column
  align-items: center
  justify-content: space-between
  gap: 8px
  margin-top: -6px
  margin-bottom: 8px

._danger
  border-color: #a44
  background: #521

._history_actions_row ._btn
  width: 100%

._pill
  display: inline-block
  padding: 2px 6px
  border-radius: 999px
  font-size: 10px
  border: 1px solid #444
  margin-right: 6px
._pill_gen
  background: #112
._pill_edits
  background: #121
._fname
  word-break: break-all
._mtime
  opacity: .75

._muted
  opacity: .7
  font-size: 12px

/* モーダル */
._modal_backdrop
  position: fixed
  inset: 0
  background: rgba(0,0,0,.5)
  display: grid
  place-items: center
  padding: 24px
  z-index: 50

._modal_card
  width: min(960px, 100%)
  max-height: 90vh
  overflow: auto
  padding: 16px
  border-radius: 12px
  background: #0e0e0e
  border: 1px solid #333
</style>
