<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { invoke } from '@tauri-apps/api/core'

// ── 标签页 ──
type Tab = 'decode' | 'encode'
const activeTab = ref<Tab>('decode')

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
const qrSize = ref(280)
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

// ── 解码：系统截图 ──
async function takeScreenshot() {
  try {
    // 调用系统截图工具，截图到剪贴板
    await invoke<string>('take_screenshot')
    // 截图成功后从剪贴板读取图片
    await readFromClipboard()
  } catch (err) {
    if (String(err).includes('已取消')) return
    // 其他错误：仍然尝试读取剪贴板（用户可能手动截了）
    console.error('截图命令失败:', err)
    await readFromClipboard()
  }
}

// ── 解码：从剪贴板读取截图（回退方案）─
async function readFromClipboard() {
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const imageTypes = item.types.filter(t => t.startsWith('image/'))
      if (imageTypes.length > 0) {
        const blob = await item.getType(imageTypes[0])
        const file = new File([blob], 'screenshot.png', { type: imageTypes[0] })
        processImage(file)
        return
      }
    }
    showToast('剪贴板中没有图片，请先截图')
  } catch {
    showToast('无法读取剪贴板，请尝试 Ctrl+V 粘贴')
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
    })
    qrError.value = ''
  } catch {
    qrError.value = '生成失败，请检查输入内容'
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

        <!-- 预览 + 结果 -->
        <div v-else class="decode-result">
          <div class="preview-box">
            <img :src="imageSrc" alt="preview" class="preview-img" />
            <button class="btn-icon close-btn" @click="clearDecode" title="清除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <canvas ref="canvasRef" hidden />

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

          <p v-if="decodeError" class="error-msg">{{ decodeError }}</p>
        </div>
      </section>

      <!-- ═══ 生成二维码 ═══ -->
      <section v-if="activeTab === 'encode'" class="panel encode-panel">
        <div class="encode-layout">
          <!-- 输入区 -->
          <div class="input-area">
            <div class="input-header">
              <span class="input-label">输入文本内容</span>
              <span class="char-count">{{ charCount }} 字</span>
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

.preview-box {
  position: relative;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg);
  display: flex;
  justify-content: center;
  max-height: 340px;
}

.preview-img {
  max-width: 100%;
  max-height: 340px;
  object-fit: contain;
}

.close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn svg {
  width: 16px;
  height: 16px;
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
</style>

