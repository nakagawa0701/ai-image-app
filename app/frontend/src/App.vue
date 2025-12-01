<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import InpaintingEditor from './components/InpaintingEditor.vue'
import {
  _generate_image,
  _save_image,
  _list_images,
  _delete_image,
  _upload_data_url,
  type _image_item
} from './lib/api'

type _data_url_img = { dataUrl: string; mime: string }

// タブ（モード）
const _tab = ref<'upload' | 'generate'>('upload')

// 生成系
const _prompt = ref('')
const _size = ref('1024x1024')

// 現在プレビューと保存済み参照
const _current = ref<null | _data_url_img>(null)
const _saved = ref<null | { url: string; filename: string; mime: string }>(null)

// 編集モーダル
const _editing = ref(false)
const _modal_phase = ref<'edit' | 'result'>('edit')
const _modal_result = ref<null | _data_url_img>(null)
const _busy_modal = ref(false)

// 履歴
const _history = ref<_image_item[]>([])
const _deleting = ref<Set<string>>(new Set())

// ローディング
const _saving = ref(false)
const _uploading = ref(false)
const _generating = ref(false)

// 追加状態
const _dragging = ref(false)
const MAX_FILE_MB = 20

async function _file_to_data_url(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

async function _ingest_data_url(dataUrl: string) {
  try {
    _uploading.value = true
    const saved = await _upload_data_url(dataUrl)
    _saved.value = saved
    _current.value = { dataUrl: saved.url, mime: saved.mime } // URL（保存済み）
    _modal_result.value = null
  } finally {
    _uploading.value = false
  }
}

// 画像アップロード
async function _on_pick_file(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) return alert('画像ファイルを選択してください')
  if (file.size > MAX_FILE_MB * 1024 * 1024) return alert(`ファイルが大きすぎます（最大 ${MAX_FILE_MB}MB）`)
  const dataUrl = await _file_to_data_url(file)
  await _ingest_data_url(dataUrl)
  input.value = ''
}

function _on_dragover(e: DragEvent) {
  e.preventDefault()
  _dragging.value = true
}
function _on_dragleave(e: DragEvent) {
  e.preventDefault()
  _dragging.value = false
}
async function _on_drop(e: DragEvent) {
  e.preventDefault()
  _dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) return alert('画像ファイルをドロップしてください')
  if (file.size > MAX_FILE_MB * 1024 * 1024) return alert(`ファイルが大きすぎます（最大 ${MAX_FILE_MB}MB）`)
  const dataUrl = await _file_to_data_url(file)
  await _ingest_data_url(dataUrl)
}

// クリップボード貼り付け（Cmd/Ctrl + V）
async function _on_paste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const it of items) {
    if (it.kind === 'file') {
      const file = it.getAsFile()
      if (file && file.type.startsWith('image/')) {
        e.preventDefault()
        if (file.size > MAX_FILE_MB * 1024 * 1024) return alert(`ファイルが大きすぎます（最大 ${MAX_FILE_MB}MB）`)
        const dataUrl = await _file_to_data_url(file)
        await _ingest_data_url(dataUrl)
        break
      }
    }
  }
}

// 生成
const _size_presets = [
  { label: '正方形', value: '1024x1024' },
  { label: '縦長',   value: '768x1024' },
  { label: '横長',   value: '1024x768' }
]
const _prompt_snippets = [
  '高解像度・細部まで鮮明に',
  '自然光・柔らかい影',
  '被写界深度浅め・ボケ感',
  '写実的・現実的',
  '背景はそのまま'
]
const _prompt_len = computed(() => _prompt.value.trim().length)

function _pick_size(v: string) {
  _size.value = v
}
function _append_snippet(t: string) {
  if (_prompt.value && !/\s$/.test(_prompt.value)) _prompt.value += ' '
  _prompt.value += t
}
function _clear_prompt() {
  _prompt.value = ''
}
function _on_prompt_keydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    if (!_generating.value && _prompt_len.value) _on_generate()
  }
}

async function _on_generate() {
  if (!_prompt.value.trim()) {
    alert('生成内容を入力してください')
    return
  }
  try {
    _generating.value = true
    const res = await _generate_image({ prompt: _prompt.value.trim(), size: _size.value })
    _current.value = { dataUrl: res.dataUrl, mime: res.mime }
    _saved.value = null
    _modal_result.value = null
  } catch (e: any) {
    alert(`生成に失敗: ${e?.message ?? e}`)
  } finally {
    _generating.value = false
  }
}

// 現在プレビューを保存（DataURLのみ保存）
async function _on_save_current() {
  if (!_current.value) return
  if (!/^data:image\//i.test(_current.value.dataUrl)) {
    alert('この画像はすでに保存済みです（DataURLではありません）')
    return
  }
  try {
    _saving.value = true
    const saved = await _save_image(_current.value.dataUrl)
    _saved.value = saved
    _current.value = { dataUrl: saved.url, mime: saved.mime }
    await _reload_history()
  } catch (e: any) {
    alert(`保存に失敗: ${e?.message ?? e}`)
  } finally {
    _saving.value = false
  }
}

// 履歴
async function _reload_history() {
  const list = await _list_images({ kind: 'all', limit: 60 })
  _history.value = list
}
function _open_from_history(it: _image_item) {
  _saved.value = { url: it.url, filename: it.filename, mime: it.mime }
  _current.value = { dataUrl: it.url, mime: it.mime }
  _modal_result.value = null
  _editing.value = true
  _modal_phase.value = 'edit'
}
async function _on_delete_from_history(it: _image_item) {
  if (!confirm(`${it.filename}\nこの画像を削除します。よろしいですか？`)) return
  _deleting.value = new Set(_deleting.value).add(it.filename)
  try {
    await _delete_image(it.filename)
    if (_saved.value?.filename === it.filename) {
      _current.value = null
      _saved.value = null
      _editing.value = false
    }
    _history.value = _history.value.filter(x => x.filename !== it.filename)
  } catch (e: any) {
    alert(`削除に失敗: ${e?.message ?? e}`)
  } finally {
    const s = new Set(_deleting.value); s.delete(it.filename); _deleting.value = s
  }
}

// 編集モーダルを開く（未保存なら自動保存後に開く）
async function _open_editor_smart() {
  if (!_saved.value) {
    if (_current.value && /^data:image\//i.test(_current.value.dataUrl)) {
      try {
        _saving.value = true
        const saved = await _save_image(_current.value.dataUrl)
        _saved.value = saved
        _current.value = { dataUrl: saved.url, mime: saved.mime }
        await _reload_history()
      } catch (e: any) {
        alert(`保存に失敗: ${e?.message ?? e}`)
        return
      } finally {
        _saving.value = false
      }
    } else {
      alert('先に画像を保存してください（編集は保存済み画像が対象です）')
      return
    }
  }
  _modal_result.value = null
  _modal_phase.value = 'edit'
  _editing.value = true
}

// モーダルを閉じる
function _close_editor() {
  _editing.value = false
  _modal_phase.value = 'edit'
  _modal_result.value = null
}

// エディタ完了イベント
function _on_edit_done(payload: { dataUrl: string, saved?: { url: string, filename: string, mime: string } | null }) {
  if (payload.saved) {
    _saved.value = payload.saved
    _current.value = { dataUrl: payload.saved.url, mime: payload.saved.mime }
    _modal_result.value = null
    _modal_phase.value = 'edit'
    _reload_history()
    return
  }
  _modal_result.value = { dataUrl: payload.dataUrl, mime: 'image/png' }
  _current.value = { dataUrl: payload.dataUrl, mime: 'image/png' }
  _modal_phase.value = 'result'
}

// 結果ビュー：保存
async function _save_modal_result() {
  if (!_modal_result.value) return
  try {
    _busy_modal.value = true
    const saved = await _save_image(_modal_result.value.dataUrl, { dest: 'edits' })
    _saved.value = saved
    _current.value = { dataUrl: saved.url, mime: saved.mime }
    await _reload_history()
  } catch (e: any) {
    alert(`保存に失敗: ${e?.message ?? e}`)
  } finally {
    _busy_modal.value = false
  }
}

// 結果ビュー：続けて編集
async function _continue_modal_edit() {
  if (!_modal_result.value) return
  try {
    _busy_modal.value = true
    const saved = await _save_image(_modal_result.value.dataUrl, { dest: 'edits' })
    _saved.value = saved
    _current.value = { dataUrl: saved.url, mime: saved.mime }
    _modal_result.value = null
    _modal_phase.value = 'edit'
    await _reload_history()
  } catch (e: any) {
    alert(`編集の続行に失敗: ${e?.message ?? e}`)
  } finally {
    _busy_modal.value = false
  }
}

const _is_from_history = computed(() => Boolean(_saved.value && _current.value?.dataUrl === _saved.value.url))

onMounted(_reload_history)
</script>

<template>
  <div class="_wrap">
    <!-- タブ -->
    <div class="_tabs">
      <button class="_tab" :class="{ _active: _tab==='upload' }" @click="_tab='upload'">アップロード</button>
      <button class="_tab" :class="{ _active: _tab==='generate' }" @click="_tab='generate'">生成</button>
    </div>

    <!-- タブ: アップロード -->
    <section v-if="_tab==='upload'" class="_section">
      <h2 class="_h2">画像をアップロード</h2>

      <div
        class="_uploader_card"
        :class="{ _dragging: _dragging, _loading: _uploading }"
        @dragover="_on_dragover"
        @dragleave="_on_dragleave"
        @drop="_on_drop"
        @paste="_on_paste"
        aria-label="画像のドラッグ＆ドロップ、クリック選択、または貼り付けに対応"
      >
        <input
          id="_file_input"
          class="_file_input"
          type="file"
          accept="image/*"
          :disabled="_uploading"
          @change="_on_pick_file"
        />
        <label for="_file_input" class="_drop_content">
          <svg class="_drop_icon" viewBox="0 0 24 24" width="48" height="48" aria-hidden="true">
            <path d="M12 16v-8m0 0l-4 4m4-4l4 4M4 16a4 4 0 014-4h8a4 4 0 014 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="_drop_title">ここに画像をドラッグ＆ドロップ</div>
          <div class="_drop_sub">または <span class="_accent">クリックして選択</span> / <kbd>Ctrl</kbd> + <kbd>V</kbd> で貼り付け</div>
          <div class="_hints">PNG・JPG・WEBP、最大 {{ MAX_FILE_MB }}MB</div>
          <div class="_spinner" v-if="_uploading">アップロード中…</div>
        </label>
      </div>

      <div v-if="_current" class="_preview">
        <img :src="_current.dataUrl" class="_img" alt="プレビュー" />
        <div class="_actions_row">
          <button class="_btn" :disabled="_saving || !_current || _is_from_history" @click="_on_save_current">
            {{ _saving ? '保存中…' : 'この画像を保存' }}
          </button>
          <button class="_btn _primary" :disabled="_saving || !_current" @click="_open_editor_smart">この画像を編集</button>
        </div>
      </div>
    </section>

    <!-- タブ: 生成 -->
    <section v-else class="_section">
      <h2 class="_h2">画像を新しく生成</h2>

      <div class="_gen_card">
        <div class="_chips_row" role="group" aria-label="サイズのプリセット">
          <button
            v-for="p in _size_presets"
            :key="p.value"
            class="_chip"
            :class="{ _chip_active: _size === p.value }"
            @click="_pick_size(p.value)"
            :aria-pressed="_size === p.value"
          >
            {{ p.label }}（{{ p.value }}）
          </button>
        </div>

        <div class="_prompt_block">
          <textarea
            class="_promptarea"
            v-model="_prompt"
            rows="3"
            placeholder="例: モダンな家の外観、夕景、35mm、木目の外壁、温かい照明、現実的"
            @keydown="_on_prompt_keydown"
            aria-label="生成内容（Ctrl/⌘ + Enter で生成）"
          />
          <div class="_meta_row">
            <div class="_snips">
              <button
                v-for="s in _prompt_snippets"
                :key="s"
                class="_snip_btn"
                @click="_append_snippet(s)"
                type="button"
              >{{ s }}</button>
            </div>
            <div class="_right_meta">
              <span class="_kbd_hint"><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> で生成</span>
              <span class="_counter">{{ _prompt_len }} 文字</span>
            </div>
          </div>
        </div>

        <div class="_actions_row">
          <button class="_btn" @click="_clear_prompt" :disabled="!_prompt_len">クリア</button>
          <button class="_btn _primary" :disabled="_generating || !_prompt_len" @click="_on_generate">
            {{ _generating ? '生成中…' : '生成' }}
          </button>
        </div>

        <div class="_tips">
          ・短くても具体的に（対象・質感・光・雰囲気）を書くと狙い通りになりやすいです<br>
          ・サイズは上のプリセットから選べます（正方形/縦長/横長）
        </div>

        <div class="_loading_bar" v-if="_generating" aria-live="polite">生成しています…</div>
      </div>

      <div v-if="_current" class="_preview">
        <img :src="_current.dataUrl" class="_img" alt="プレビュー" />
        <div class="_actions_row">
          <button class="_btn" :disabled="_saving || !_current || _is_from_history" @click="_on_save_current">
            {{ _saving ? '保存中…' : 'この画像を保存' }}
          </button>
          <button class="_btn _primary" :disabled="_saving || !_current" @click="_open_editor_smart">この画像を編集</button>
        </div>
      </div>
    </section>

    <!-- 履歴 -->
    <section class="_section">
      <h2 class="_h2">履歴（生成・編集）</h2>

      <div class="_history_grid" v-if="_history.length">
        <article class="_hcard" v-for="it in _history" :key="it.filename" @click="_open_from_history(it)">
          <div class="_hthumb_wrap">
            <img class="_hthumb" :src="it.url" :alt="it.filename" />

            <span class="_badge" :class="it.kind === 'edits' ? '_badge_edits' : '_badge_gen'">
              {{ it.kind === 'edits' ? '編集' : '生成' }}
            </span>

            <div class="_hover_bar">
              <button class="_btn _mini" @click.stop="_open_from_history(it)">編集</button>
              <!-- DL は a[download] で -->
              <button class="_btn _mini" :href="it.url" :download="it.filename" @click.stop>DL</button>
              <button
                class="_btn _mini _danger"
                :disabled="_deleting.has(it.filename)"
                @click.stop="_on_delete_from_history(it)"
              >
                {{ _deleting.has(it.filename) ? '削除中…' : '削除' }}
              </button>
            </div>
          </div>

          <div class="_hmeta">
            <span class="_fname" :title="it.filename">{{ it.filename }}</span>
            <time class="_mtime">{{ new Date(it.mtime).toLocaleString('ja-JP') }}</time>
          </div>
        </article>
      </div>

      <div v-else class="_empty">まだ履歴はありません</div>
    </section>

    <!-- フルスクリーン編集モーダル（同じモーダルで結果も表示） -->
    <div v-if="_editing" class="_modal_backdrop" @click.self="_close_editor">
      <div class="_modal_panel">
        <div class="_modal_header">
          <span>{{ _modal_phase === 'edit' ? '編集モード' : '編集結果' }}</span>
          <button class="_btn" @click="_close_editor">閉じる</button>
        </div>

        <div class="_modal_body">
          <!-- フェーズ: 編集中 -->
          <template v-if="_modal_phase==='edit' && _saved">
            <InpaintingEditor
              :key="_saved.filename + ':' + (_editing ? 'open' : 'closed') + ':' + _modal_phase"
              :filename="_saved.filename"
              :image-url="_saved.url"
              :default-brush="32"
              :feather="2"
              :padding="14"
              :autosave="false"
              @done="_on_edit_done"
              @close="_close_editor"
            />
          </template>

          <!-- フェーズ: 編集結果 -->
          <div v-else class="_result_wrap">
            <img :src="_modal_result!.dataUrl" class="_result_img" alt="編集結果" />
            <div class="_result_actions">
              <button class="_btn" :disabled="_busy_modal" @click="_save_modal_result">
                {{ _busy_modal ? '保存中…' : '保存する' }}
              </button>
              <button class="_btn _primary" :disabled="_busy_modal" @click="_continue_modal_edit">
                {{ _busy_modal ? '準備中…' : '続けて編集' }}
              </button>
              <button class="_btn" :disabled="_busy_modal" @click="_close_editor">閉じる</button>
            </div>
            <div class="_hint">保存すると履歴に追加されます。「続けて編集」は一度保存してから再度編集に戻ります。</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="sass">
._wrap
  display: grid
  gap: 24px
  max-width: 960px
  margin: 0 auto
  padding: 16px

._tabs
  display: flex
  gap: 8px
  border-bottom: 1px solid #2b2b2b
  padding-bottom: 8px

._tab
  padding: 10px 14px
  border: 1px solid #444
  border-bottom: none
  background: #1a1a1a
  color: #ddd
  cursor: pointer
  user-select: none
  border-top-left-radius: 10px
  border-top-right-radius: 10px

._active
  background: #222
  color: #fff
  opacity: 1

._section
  display: grid
  gap: 12px

._h2
  font-size: 18px
  font-weight: 700

._uploader_card
  position: relative
  border: 1px dashed #3a3a3a
  border-radius: 14px
  padding: 28px
  display: grid
  place-items: center
  background: #121212
  transition: border-color .2s ease, background-color .2s ease, transform .2s ease

._uploader_card:hover
  border-color: #6ba6ff
  transform: translateY(-1px)

._uploader_card._dragging
  border-color: #8bdc9b
  box-shadow: 0 0 0 3px rgba(139,220,155,.18) inset

._uploader_card._loading
  opacity: .8
  pointer-events: none

._file_input
  position: absolute
  inset: 0
  opacity: 0
  pointer-events: none

._drop_content
  display: grid
  gap: 8px
  place-items: center
  text-align: center
  user-select: none
  cursor: pointer

._drop_icon
  color: #9bb4ff
  opacity: .9

._drop_title
  font-weight: 700
  font-size: 16px

._drop_sub
  font-size: 13px
  opacity: .9

._accent
  color: #7fd3a6
  text-decoration: underline

._hints
  font-size: 12px
  opacity: .7

._spinner
  margin-top: 6px
  font-size: 12px
  opacity: .85
  position: relative
  padding-left: 18px

._spinner::before
  content: ''
  position: absolute
  left: 0
  top: 50%
  width: 12px
  height: 12px
  margin-top: -6px
  border-radius: 50%
  border: 2px solid rgba(255,255,255,.25)
  border-top-color: rgba(255,255,255,.9)
  animation: _spin 1s linear infinite

@keyframes _spin
  to
    transform: rotate(360deg)

._row
  display: flex
  gap: 8px
  align-items: center

._prompt
  flex: 1
  min-width: 260px
  padding: 10px
  border: 1px solid #444
  border-radius: 8px
  background: #111
  color: #eee

._size
  width: 140px

._btn
  padding: 10px 14px
  border-radius: 8px
  border: 1px solid #666
  background: #222
  color: #eee
  cursor: pointer
  height: 40px

._btn[disabled]
  opacity: .5
  cursor: not-allowed
  filter: grayscale(20%)

._primary
  border-color: #4a8
  background: #274

._danger
  border-color: #a44
  background: #521

._preview
  display: grid
  gap: 8px

._img
  width: 90%
  height: auto
  border-radius: 10px
  border: 1px solid #333
  justify-self: center

._actions_row
  display: flex
  gap: 8px
  flex-wrap: wrap

._gen_card
  display: grid
  gap: 12px
  padding: 16px
  border: 1px solid #2b2b2b
  border-radius: 12px
  justify-self: center

._chips_row
  display: flex
  flex-wrap: wrap
  gap: 8px

._chip
  padding: 8px 12px
  border-radius: 999px
  border: 1px solid #444
  background: #1a1a1a
  color: #ddd
  cursor: pointer
  font-size: 12px
  transition: transform .15s ease, background-color .15s ease, border-color .15s ease
  opacity: .9

._chip:hover
  transform: translateY(-1px)
  border-color: #5a8

._chip_active
  background: #243
  border-color: #5a8
  color: #e9fff7

._prompt_block
  display: grid
  gap: 8px

._promptarea
  min-height: 96px
  border-radius: 10px
  border: 1px solid #444
  background: #0f0f0f
  color: #eee
  resize: vertical
  line-height: 1.5
  outline: none
  padding: 8px

._promptarea:focus
  border-color: #6ba6ff
  box-shadow: 0 0 0 3px rgba(107,166,255,.2)

._meta_row
  display: flex
  justify-content: space-between
  gap: 10px
  flex-wrap: wrap

._snips
  display: flex
  flex-wrap: wrap
  gap: 6px

._snip_btn
  padding: 6px 10px
  border-radius: 8px
  border: 1px solid #3a3a3a
  background: #1a1b1c
  color: #d8d8d8
  font-size: 12px
  cursor: pointer

._snip_btn:hover
  border-color: #6ba6ff
  background: #1e2230

._right_meta
  display: flex
  align-items: center
  gap: 10px
  font-size: 12px
  opacity: .85

._kbd_hint kbd
  display: inline-block
  padding: 0 6px
  border: 1px solid #444
  border-bottom-width: 2px
  border-radius: 6px
  background: #141414
  font-size: 11px

._counter
  opacity: .7

._loading_bar
  margin-top: 4px
  font-size: 12px
  opacity: .9

._history_grid
  display: grid
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))
  gap: 14px

._hcard
  position: relative
  border: 1px solid #2b2b2b
  border-radius: 12px
  overflow: hidden
  background: #141416
  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease
  cursor: pointer

._hcard:hover
  transform: translateY(-2px)
  box-shadow: 0 6px 14px rgba(0,0,0,.35)
  border-color: #3b3b3b

._hthumb_wrap
  position: relative
  aspect-ratio: 1 / 1
  background: #0f0f0f

._hthumb
  width: 100%
  height: 100%
  object-fit: cover
  display: block

._badge
  position: absolute
  left: 8px
  top: 8px
  padding: 3px 8px
  font-size: 11px
  border-radius: 999px
  border: 1px solid #3a3a3a
  background: rgba(0,0,0,.35)
  backdrop-filter: blur(4px)

._badge_gen
  color: #fff
  border-color: rgba(100,140,255,.35)
  background: rgba(0,50,199,.45)

._badge_edits
  color: #fff
  border-color: rgba(160,120,255,.35)
  background: rgba(199,50,0,.45)

._hover_bar
  position: absolute
  inset: auto 8px 8px 8px
  display: flex
  gap: 6px
  justify-content: flex-end
  opacity: 0
  transform: translateY(6px)
  transition: opacity .15s ease, transform .15s ease
  pointer-events: none

._hcard:hover ._hover_bar
  opacity: 1
  transform: translateY(0)
  pointer-events: auto

._btn._mini
  padding: 6px 10px
  font-size: 12px
  border-radius: 8px

._hmeta
  display: grid
  gap: 4px
  padding: 10px

._fname
  font-size: 12px
  color: #ddd
  line-height: 1.4
  display: -webkit-box
  -webkit-line-clamp: 2
  -webkit-box-orient: vertical
  overflow: hidden

._mtime
  font-size: 11px
  opacity: .7

._empty
  opacity: .7
  font-size: 12px

._modal_backdrop
  position: fixed
  inset: 0
  background: rgba(0,0,0,.6)
  display: grid
  place-items: center
  z-index: 999

._modal_panel
  width: min(1100px, 96vw)
  height: min(90vh, 900px)
  background: #0f0f10
  border: 1px solid #333
  border-radius: 14px
  display: grid
  grid-template-rows: auto 1fr
  overflow: hidden
  box-shadow: 0 10px 30px rgba(0,0,0,.45)

._modal_header
  display: flex
  align-items: center
  justify-content: space-between
  padding: 10px 12px
  border-bottom: 1px solid #222
  background: #121212
  font-weight: 700

._modal_body
  padding: 12px
  overflow: auto

._result_wrap
  display: grid
  gap: 12px
  place-items: center

._result_img
  width: 100%
  height: auto
  border-radius: 10px
  border: 1px solid #333

._result_actions
  display: flex
  gap: 10px
  flex-wrap: wrap

._hint
  font-size: 12px
  opacity: .75
</style>
