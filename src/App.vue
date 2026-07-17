<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import ScreenshotEditor from './components/ScreenshotEditor.vue'
import StickyNote from './components/StickyNote.vue'
import ScreenshotHistory from './components/ScreenshotHistory.vue'
import type { StickyNote as StickyNoteType, ScreenshotRecord } from './types'

declare const __APP_VERSION__: string
const version = __APP_VERSION__

// ── 关于弹窗 ──
const showAbout = ref(false)
onMounted(() => {
  listen('show-about', () => { showAbout.value = true })
})

// ── 标签页 ──
type Tab = 'decode' | 'encode' | 'notes'
const activeTab = ref<Tab>('decode')

// ── 截图编辑器 ──
const showEditor = ref(false)
const editingImage = ref('')

function openEditor(dataUrl: string) {
  editingImage.value = dataUrl
  showEditor.value = true
}

function onEditorSave(dataUrl: string) {
  imageSrc.value = dataUrl
  addToHistory(dataUrl)
  nextTick(() => decodeQR())
}

// ── 便利贴 ──
const notes = ref<StickyNoteType[]>([])
function addNote() {
  notes.value.push({
    id: Date.now().toString(),
    text: '',
    color: '#fff9c4',
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 200,
    width: 220,
    height: 160,
    createdAt: Date.now(),
    pinned: false,
  })
}
function updateNote(updated: StickyNoteType) {
  const idx = notes.value.findIndex(n => n.id === updated.id)
  if (idx !== -1) notes.value[idx] = updated
}
function closeNote(id: string) {
  notes.value = notes.value.filter(n => n.id !== id)
}

// ── 截图历史 ──
const historyRecords = ref<ScreenshotRecord[]>([])
function addToHistory(dataUrl: string, editedDataUrl?: string) {
  const record: ScreenshotRecord = {
    id: Date.now().toString(),
    dataUrl,
    thumbnailUrl: dataUrl,
    createdAt: Date.now(),
    editedDataUrl,
  }
  historyRecords.value.unshift(record)
  if (historyRecords.value.length > 20) historyRecords.value.pop()
}
function selectHistory(record: ScreenshotRecord) {
  imageSrc.value = record.editedDataUrl || record.dataUrl
  activeTab.value = 'decode'
  nextTick(() => decodeQR())
}
function editHistory(record: ScreenshotRecord) {
  openEditor(record.dataUrl)
}
function deleteHistory(id: string) {
  historyRecords.value = historyRecords.value.filter(r => r.id !== id)
}

// ── 解码 ──
const imageSrc = ref<string | null>(null)
const decodedText = ref('')
const decodeError = ref('')
const isDragging = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

// ── 编码 ──
const encodeText = ref('')
const qrDataUrl = ref('')
const qrSize = ref(360)
const qrError = ref('')

// ── 通知 ──
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 2200)
}

// ── 解码：文件选择 ──
function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) processImage(file)
  input.value = ''
}

// ── 解码：拖拽上传 ──
function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}
function onDragLeave() {
  isDragging.value = false
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file) processImage(file)
}

// ── 解码：处理图片 ──
function processImage(file: File) {
  if (!file.type.startsWith('image/')) {
    decodeError.value = '请选择一张图片文件'
    return
  }
  decodeError.value = ''
  decodedText.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    imageSrc.value = reader.result as string
    nextTick(() => decodeQR())
  }
  reader.readAsDataURL(file)
}

// ── 解码：解析 QR ──
function decodeQR() {
  const canvas = canvasRef.value
  if (!canvas || !imageSrc.value) return
  const img = new Image()
  img.onload = () => {
    const maxDim = 800
    let w = img.naturalWidth
    let h = img.naturalHeight
    if (w > maxDim || h > maxDim) {
      const ratio = Math.min(maxDim / w, maxDim / h)
      w = Math.floor(w * ratio)
      h = Math.floor(h * ratio)
    }
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    const result = jsQR(imageData.data, w, h)
    if (result) {
      decodedText.value = result.data
      decodeError.value = ''
    } else {
      decodedText.value = ''
      decodeError.value = '图片中未检测到二维码'
    }
  }
  img.src = imageSrc.value
}

// ── 解码：粘贴图片 ──
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) processImage(file)
      break
    }
  }
}

// ── 解码：系统框选截图 ──
async function takeScreenshot() {
  try {
    const dataUrl = await invoke<string>('take_screenshot')
    imageSrc.value = dataUrl
    addToHistory(dataUrl)
    await nextTick()
    decodeQR()
  } catch (err) {
    const msg = String(err)
    if (msg.includes('已取消')) return
    showToast('截图失败，请重试')
  }
}

// ── 解码：清除 ──
function clearDecode() {
  imageSrc.value = null
  decodedText.value = ''
  decodeError.value = ''
}

// ── 复制 ──
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast('已复制到剪贴板')
  } catch {
    showToast('复制失败')
  }
}

// ── 编码：生成 QR ──
let genTimer: ReturnType<typeof setTimeout> | null = null
watch(encodeText, (val) => {
  if (genTimer) clearTimeout(genTimer)
  genTimer = setTimeout(() => generateQR(val), 300)
})

async function generateQR(text: string) {
  if (!text.trim()) {
    qrDataUrl.value = ''
    qrError.value = ''
    return
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(text, {
      width: qrSize.value,
      margin: 2,
      color: { dark: '#1d1d1f', light: '#ffffff' },
      errorCorrectionLevel: 'L',
    })
    qrError.value = ''
  } catch {
    qrError.value = '内容过长超出二维码容量（约 2900 字节），请精简文本'
    qrDataUrl.value = ''
  }
}

// ── 下载 ──
function downloadQR() {
  if (!qrDataUrl.value) return
  const a = document.createElement('a')
  a.href = qrDataUrl.value
  a.download = 'qrcode.png'
  a.click()
}

// ── 粘贴文本 ──
async function pasteText() {
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      encodeText.value = text
      showToast('已粘贴剪贴板内容')
    }
  } catch {
    showToast('无法读取剪贴板')
  }
}

// ── 清除编码 ──
function clearEncode() {
  encodeText.value = ''
  qrDataUrl.value = ''
  qrError.value = ''
}

// ── 计算 ──
const charCount = computed(() => encodeText.value.length)
const showDownload = computed(() => !!qrDataUrl.value)
</script>

<template>
  <div class="app-container" @paste="activeTab === 'decode' && onPaste($event)">
    <!-- 顶栏 -->
    <header class="app-header">
      <div class="logo">
        <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span class="logo-text">QRTEXT</span>
      </div>
      <nav class="tabs">
        <button
          :class="['tab', { active: activeTab === 'decode' }]"
          @click="activeTab = 'decode'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          识别
        </button>
        <button
          :class="['tab', { active: activeTab === 'encode' }]"
          @click="activeTab = 'encode'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon">
            <path d="M12 4v16m8-8H4" />
          </svg>
          生成
        </button>
        <button
          :class="['tab', { active: activeTab === 'notes' }]"
          @click="activeTab = 'notes'"
        >
          📝 便利贴
        </button>
      </nav>
    </header>

    <!-- 内容区 -->
    <main class="app-main">
      <!-- ═══ 识别二维码 ═══ -->
      <section v-if="activeTab === 'decode'" class="panel decode-panel">
        <!-- 上传区 -->
        <div
          v-if="!imageSrc"
          :class="['dropzone', { dragging: isDragging }]"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
          @click="fileInputRef?.click()"
        >
          <div class="dropzone-icon">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="4" y="8" width="40" height="34" rx="3" />
              <circle cx="17" cy="20" r="3" />
              <path d="M4 36l11-11 7 7 7-10 15 14" />
            </svg>
          </div>
          <p class="dropzone-title">拖拽截图到此处</p>
          <p class="dropzone-hint">或拖拽 / 粘贴截图 · 支持 Ctrl+V</p>
          <div class="dropzone-actions">
            <button class="btn-screenshot" @click.stop="takeScreenshot">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-s">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              框选截图识别
            </button>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            accept="image/*"
            hidden
            @change="handleFileSelect"
          />
        </div>

        <!-- 识别结果 -->
        <div v-else class="decode-result">
          <canvas ref="canvasRef" hidden />

          <!-- 未识别到内容 -->
          <div v-if="!decodedText && !decodeError" class="result-status">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" class="status-icon">
              <circle cx="24" cy="24" r="20" />
              <path d="M24 16v8M24 32h.01" stroke-width="2" stroke-linecap="round" />
            </svg>
            <p>正在识别二维码…</p>
          </div>

          <!-- 识别成功 -->
          <div v-if="decodedText" class="result-card">
            <div class="result-header">
              <span class="result-label">识别结果</span>
              <button class="btn-copy" @click="copyText(decodedText)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-s">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                复制
              </button>
            </div>
            <p class="result-text">{{ decodedText }}</p>
          </div>

          <!-- 错误提示 -->
          <p v-if="decodeError" class="error-msg">{{ decodeError }}</p>

          <div class="decode-actions">
            <button class="btn-secondary" @click="openEditor(imageSrc!)">
              ✏️ 编辑截图
            </button>
            <button class="btn-secondary" @click="takeScreenshot">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-s">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              重新截图
            </button>
            <button class="btn-secondary" @click="clearDecode">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-s">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
              清除
            </button>
          </div>

          <!-- 截图历史 -->
          <ScreenshotHistory
            :records="historyRecords"
            @select="selectHistory"
            @delete="deleteHistory"
            @edit="editHistory"
          />
        </div>
      </section>

      <!-- ═══ 生成二维码 ═══ -->
      <section v-if="activeTab === 'encode'" class="panel encode-panel">
        <div class="encode-layout">
          <!-- 输入区 -->
          <div class="input-area">
            <div class="input-header">
              <span class="input-label">输入文本内容</span>
              <span class="char-count">{{ charCount }} 字 / 约 2900 字上限</span>
            </div>
            <textarea
              v-model="encodeText"
              class="text-input"
              placeholder="输入或粘贴要生成二维码的文本…"
              rows="5"
            />
            <div class="input-actions">
              <button class="btn-secondary" @click="pasteText">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-s">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                粘贴
              </button>
              <button class="btn-secondary" @click="clearEncode">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-s">
                  <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                </svg>
                清除
              </button>
            </div>
          </div>

          <!-- 二维码预览 -->
          <div class="qr-preview">
            <div v-if="showDownload" class="qr-card">
              <img :src="qrDataUrl" alt="QR Code" class="qr-img" />
              <button class="btn-primary download-btn" @click="downloadQR">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-s">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                下载 PNG
              </button>
            </div>
            <div v-else class="qr-placeholder">
              <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="28" y="4" width="16" height="16" rx="2" />
                <rect x="4" y="28" width="16" height="16" rx="2" />
                <rect x="28" y="28" width="16" height="16" rx="2" />
              </svg>
              <p class="qr-placeholder-text">在左侧输入文本后将自动生成二维码</p>
            </div>
            <p v-if="qrError" class="error-msg">{{ qrError }}</p>
          </div>
        </div>
      </section>
    </main>

    <!-- 便利贴面板 -->
    <div v-if="activeTab === 'notes'" class="notes-panel">
      <div class="notes-header">
        <span>便利贴 ({{ notes.length }})</span>
        <button class="btn-primary" @click="addNote">+ 新建</button>
      </div>
      <div v-if="!notes.length" class="notes-empty">
        <p>暂无便利贴，点击"新建"创建</p>
      </div>
    </div>

    <!-- 浮动便利贴 -->
    <StickyNote
      v-for="note in notes" :key="note.id"
      :note="note"
      @update="updateNote"
      @close="closeNote"
    />

    <!-- 截图编辑器 -->
    <ScreenshotEditor
      v-if="showEditor"
      :imageSrc="editingImage"
      @close="showEditor = false"
      @save="onEditorSave"
    />

    <!-- 关于弹窗 -->
    <Transition name="modal">
      <div v-if="showAbout" class="about-overlay" @click.self="showAbout = false">
        <div class="about-card">
          <div class="about-icon">
            <svg viewBox="0 0 32 32" width="56" height="56">
              <rect width="32" height="32" rx="7" fill="#1A1A2E"/>
              <rect x="5" y="5" width="6" height="6" rx="1.5" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.9"/>
              <rect x="7" y="7" width="2.5" height="2.5" rx="0.5" fill="#4FACFE"/>
              <rect x="21" y="5" width="6" height="6" rx="1.5" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.9"/>
              <rect x="23" y="7" width="2.5" height="2.5" rx="0.5" fill="#4FACFE"/>
              <rect x="5" y="21" width="6" height="6" rx="1.5" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.9"/>
              <rect x="7" y="23" width="2.5" height="2.5" rx="0.5" fill="#4FACFE"/>
            </svg>
          </div>
          <h2 class="about-title">QRTEXT</h2>
          <p class="about-version">版本 {{ version }}</p>
          <p class="about-desc">跨平台二维码识别与生成工具</p>
          <p class="about-tech">Tauri 2 · Vue 3 · Rust</p>
          <button class="btn-primary about-close" @click="showAbout = false">确定</button>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── 布局 ── */
.app-container {
  width: 100%;
  max-width: 800px;
  margin: 24px;
  background: var(--surface);
  border-radius: 20px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  position: relative;
}

/* ── 顶栏 ── */
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  width: 26px;
  height: 26px;
  color: var(--accent);
}

.logo-text {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.tabs {
  display: flex;
  background: var(--bg);
  border-radius: var(--radius-sm);
  padding: 3px;
  gap: 2px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  transition: all 0.2s;
}

.tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.tab-icon {
  width: 16px;
  height: 16px;
}

/* ── 主体 ── */
.app-main {
  padding: 24px 28px 32px;
}

.panel {
  animation: fadeIn 0.25s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── 拖拽区 ── */
.dropzone {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  padding: 56px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
}

.dropzone:hover,
.dropzone.dragging {
  border-color: var(--accent);
  background: var(--accent-light);
}

.dropzone-icon {
  width: 60px;
  height: 60px;
  margin: 0 auto 16px;
  color: var(--text-secondary);
}

.dropzone-title {
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 4px;
}

.dropzone-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.dropzone-actions {
  margin-top: 16px;
}

.btn-screenshot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 22px;
  border-radius: 20px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-screenshot:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 113, 227, 0.3);
}

/* ── 解码结果 ── */
.decode-result {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.decode-actions {
  display: flex;
  gap: 8px;
}

.result-status {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-secondary);
  font-size: 14px;
}

.status-icon {
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
  opacity: 0.4;
}

.result-card {
  background: var(--bg);
  border-radius: var(--radius);
  padding: 16px 18px;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.result-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.result-text {
  font-size: 15px;
  line-height: 1.6;
  word-break: break-all;
  white-space: pre-wrap;
}

/* ── 编码区 ── */
.encode-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: flex-start;
}

@media (max-width: 640px) {
  .encode-layout {
    grid-template-columns: 1fr;
  }
  .app-container {
    margin: 0;
    border-radius: 0;
    min-height: 100vh;
  }
  .app-main {
    padding: 16px;
  }
}

.input-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.input-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.char-count {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.text-input {
  width: 100%;
  padding: 14px 16px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 15px;
  line-height: 1.6;
  resize: vertical;
  background: var(--bg);
  color: var(--text);
  transition: border-color 0.2s;
}

.text-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}

.input-actions {
  display: flex;
  gap: 8px;
}

/* ── QR 预览 ── */
.qr-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.qr-card {
  background: #fff;
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.qr-img {
  width: 200px;
  height: 200px;
  image-rendering: pixelated;
}

.download-btn {
  width: 100%;
}

.qr-placeholder {
  width: 200px;
  height: 200px;
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  text-align: center;
}

.qr-placeholder-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* ── 按钮 ── */
.btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--border);
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: var(--surface-hover);
  border-color: #ccc;
}

.btn-copy {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 5px;
  background: var(--surface);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--accent);
  transition: all 0.15s;
}

.btn-copy:hover {
  background: var(--accent);
  color: #fff;
}

.btn-icon-s {
  width: 15px;
  height: 15px;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 错误 ── */
.error-msg {
  font-size: 13px;
  color: var(--danger);
  text-align: center;
}

/* ── Toast ── */
.toast {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #1d1d1f;
  color: #fff;
  padding: 10px 22px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  z-index: 100;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* ── 关于弹窗 ── */
.about-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.about-card {
  background: var(--surface);
  border-radius: 20px;
  padding: 36px 40px;
  text-align: center;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.16);
  max-width: 320px;
  width: 90%;
}

.about-icon {
  margin-bottom: 12px;
}

.about-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.3px;
  margin-bottom: 4px;
}

.about-version {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.about-desc {
  font-size: 14px;
  color: var(--text);
  margin-bottom: 2px;
}

.about-tech {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.about-close {
  width: 100%;
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .about-card {
  transform: scale(0.9);
}

.modal-leave-to .about-card {
  transform: scale(0.9);
}

/* ── 便利贴面板 ── */
.notes-panel {
  padding: 20px;
}
.notes-header {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 12px;
  font-size: 15px; font-weight: 600;
}
.notes-empty {
  text-align: center; padding: 40px; color: var(--text-secondary);
}
</style>

