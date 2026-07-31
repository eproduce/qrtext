<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { DrawAction } from '../types'
import { useDrawingTools } from '../composables/useDrawingTools'
import { useHistory } from '../composables/useHistory'
import Icon from './Icon.vue'

const props = defineProps<{ imageSrc: string }>()
const emit = defineEmits<{ close: []; save: [dataUrl: string] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
const actions = ref<DrawAction[]>([])
const bgImage = ref<HTMLImageElement | null>(null)

const { canUndo, canRedo, snapshot, undo, redo, clear: clearHistory } = useHistory()
function onActionAdded() { snapshot(actions.value) }

const {
  currentTool, strokeColor, strokeWidth,
  isDrawing, currentPoints,
  onMouseDown, onMouseMove, onMouseUp,
  drawPreview, renderActions,
  tools,
} = useDrawingTools(overlayRef, actions, onActionAdded)

const canvasSize = ref<{ w: number; h: number; displayW: number; displayH: number }>({ w: 800, h: 600, displayW: 800, displayH: 600 })
const copyFeedback = ref(false)
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

// ── 内联文字输入 ──
const showTextInput = ref(false)
const textInputValue = ref('')
const textInputPos = ref({ x: 0, y: 0 })
const textInputRef = ref<HTMLInputElement | null>(null)

function startTextInput(x: number, y: number) {
  textInputPos.value = { x, y }; textInputValue.value = ''
  showTextInput.value = true
  nextTick(() => textInputRef.value?.focus())
}

function commitText() {
  if (!textInputValue.value.trim()) { showTextInput.value = false; return }
  actions.value.push({
    tool: 'text', points: [{ x: textInputPos.value.x, y: textInputPos.value.y }],
    color: strokeColor.value, lineWidth: strokeWidth.value,
    text: textInputValue.value, fontSize: 20,
  })
  onActionAdded(); showTextInput.value = false; nextTick(redrawOverlay)
}

function onToolClick(toolType: string) { currentTool.value = toolType as any }

function handleMouseUp(e: MouseEvent) {
  if (currentTool.value === 'text') {
    const rect = overlayRef.value!.getBoundingClientRect()
    startTextInput((e.clientX - rect.left) * canvasSize.value.w / rect.width, (e.clientY - rect.top) * canvasSize.value.h / rect.height)
    return
  }
  onMouseUp(e); nextTick(redrawOverlay)
}

const strokeWidths = [1, 2, 3, 4, 6, 8, 10, 12]
const showWidthMenu = ref(false)

// ── 自定义颜色选择器（避免 Linux 原生 picker 全黑问题）──
const showColorPicker = ref(false)
const presetColors = [
  // 暖色系
  '#ff3b30', '#ff6b6b', '#ff9500', '#ff9f0a', '#ffcc00', '#ffd60a',
  // 冷色系
  '#34c759', '#30d158', '#20bf6b', '#0a84ff', '#007aff', '#5856d6',
  // 紫粉系
  '#bf5af2', '#af52de', '#ff2d55', '#ff375f', '#ff6482', '#e84393',
  // 大地色系
  '#ac8e68', '#e17055', '#fdcb6e', '#00b894', '#74b9ff', '#a29bfe',
  // 中性色
  '#ffffff', '#f0f0f5', '#d1d1d6', '#aeaeb2', '#8e8e93', '#636366',
  '#48484a', '#2c2c2e', '#1c1c1e', '#000000',
]

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  if (!/^[0-9A-Fa-f]{6}$/.test(h)) return ''
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

function recalcSize() {
  if (!bgImage.value) return
  const maxW = window.innerWidth * 0.9, maxH = window.innerHeight * 0.78
  let dw = bgImage.value.naturalWidth, dh = bgImage.value.naturalHeight
  if (dw > maxW || dh > maxH) { const r = Math.min(maxW / dw, maxH / dh); dw = Math.floor(dw * r); dh = Math.floor(dh * r) }
  const cw = Math.min(bgImage.value.naturalWidth, dw * 2)
  const ch = Math.min(bgImage.value.naturalHeight, dh * 2)
  canvasSize.value = { w: cw, h: ch, displayW: dw, displayH: dh }
}

function onWindowResize() {
  recalcSize()
  nextTick(() => { drawImage(); redrawOverlay() })
}

onMounted(async () => {
  const img = new Image()
  img.onload = () => {
    bgImage.value = img
    recalcSize()
    nextTick(() => { drawImage(); snapshot([]) })
  }
  img.src = props.imageSrc
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', onWindowResize)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', onWindowResize)
})

function drawImage() {
  const c = canvasRef.value; if (!c || !bgImage.value) return
  c.width = canvasSize.value.w; c.height = canvasSize.value.h
  if (overlayRef.value) { overlayRef.value.width = c.width; overlayRef.value.height = c.height }
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bgImage.value, 0, 0, c.width, c.height)
}

function redrawOverlay() {
  const c = overlayRef.value; if (!c) return
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  const bgCtx = canvasRef.value?.getContext('2d') ?? undefined
  renderActions(ctx, actions.value, bgCtx); drawPreview(ctx)
}

watch([actions, isDrawing, currentTool, strokeColor, currentPoints], () => nextTick(redrawOverlay), { deep: true })

// 鼠标事件：触发 composable 逻辑并立即重绘
function handleMouseDown(e: MouseEvent) { onMouseDown(e); redrawOverlay() }
function handleMouseMove(e: MouseEvent) { onMouseMove(e); redrawOverlay() }

function onKeyDown(e: KeyboardEvent) {
  if (showTextInput.value) {
    if (e.key === 'Escape') { e.preventDefault(); showTextInput.value = false; }
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault(); const r = e.shiftKey ? redo() : undo(); if (r !== null) actions.value = r; return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    e.preventDefault(); copyToClipboard(); return
  }
  // Cmd+W 关闭编辑器而非整个窗口
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault(); emit('close'); return
  }
  if (e.key === 'Escape') { e.preventDefault(); emit('close') }
}

function undoAction() { const r = undo(); if (r !== null) actions.value = r }
function redoAction() { const r = redo(); if (r !== null) actions.value = r }
function clearAll() { actions.value = []; clearHistory(); snapshot([]); nextTick(redrawOverlay) }

async function copyToClipboard() {
  if (!bgImage.value) return
  const origW = bgImage.value.naturalWidth, origH = bgImage.value.naturalHeight
  const c = document.createElement('canvas'); c.width = origW; c.height = origH
  const ctx = c.getContext('2d')!
  ctx.drawImage(bgImage.value, 0, 0, origW, origH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const sx = origW / canvasSize.value.w, sy = origH / canvasSize.value.h
  ctx.save(); ctx.scale(sx, sy); renderActions(ctx, actions.value, ctx); ctx.restore()
  try {
    const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'))
    const dataUrl = URL.createObjectURL(blob)
    const api = (window as any).electronAPI
    if (api) {
      // 通过 Electron nativeImage 写入系统剪贴板
      const reader = new FileReader()
      reader.onload = () => api.writeClipboardImage(reader.result as string)
      reader.readAsDataURL(blob)
    }
    URL.revokeObjectURL(dataUrl)
    copyFeedback.value = true
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
    copyFeedbackTimer = setTimeout(() => { copyFeedback.value = false }, 1800)
  } catch {
    // 复制失败，静默处理
  }
}

async function saveImage() {
  if (!bgImage.value) return
  const origW = bgImage.value.naturalWidth, origH = bgImage.value.naturalHeight
  const c = document.createElement('canvas'); c.width = origW; c.height = origH
  const ctx = c.getContext('2d')!
  ctx.drawImage(bgImage.value, 0, 0, origW, origH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const sx = origW / canvasSize.value.w, sy = origH / canvasSize.value.h
  ctx.save(); ctx.scale(sx, sy); renderActions(ctx, actions.value, ctx); ctx.restore()
  emit('save', c.toDataURL('image/png')); emit('close')
}
</script>

<template>
  <div class="editor-overlay">
    <div class="toolbar">
      <div class="toolbar-left">
        <button v-for="t in tools" :key="t.type"
          :class="['tb-btn', { on: currentTool === t.type }]"
          @click="onToolClick(t.type)" :title="t.label">
          <Icon :name="t.icon" class="tb-icon" />
        </button>
        <span class="tb-sep" />
        <div class="color-picker-wrap" title="颜色">
          <button class="tb-btn color-btn" @click="showColorPicker = !showColorPicker">
            <span class="color-dot" :style="{ background: strokeColor }"></span>
          </button>
          <div v-if="showColorPicker" class="color-menu" @mouseleave="showColorPicker = false">
            <div class="color-presets">
              <button v-for="c in presetColors" :key="c"
                :class="['color-swatch', { sel: strokeColor === c }]"
                :style="{ background: c }" :title="c"
                @click="strokeColor = c" />
            </div>
            <div class="color-info-row">
              <span class="color-dot-info" :style="{ background: strokeColor }"></span>
              <input v-model="strokeColor" class="hex-input" placeholder="#000000" maxlength="7" />
              <span class="rgb-text">{{ hexToRgb(strokeColor) }}</span>
            </div>
          </div>
        </div>
        <span class="tb-sep" />
        <div class="width-dropdown">
          <button class="tb-btn" @click="showWidthMenu = !showWidthMenu" title="线宽">
            <span class="width-dot" :style="{ width: strokeWidth + 'px', height: strokeWidth + 'px' }"></span>
          </button>
          <div v-if="showWidthMenu" class="width-menu" @mouseleave="showWidthMenu = false">
            <button v-for="w in strokeWidths" :key="w"
              :class="['width-opt', { sel: strokeWidth === w }]"
              @click="strokeWidth = w; showWidthMenu = false">
              <span class="width-sample" :style="{ width: w + 'px', height: w + 'px' }"></span>
              <span class="width-label">{{ w }}px</span>
            </button>
          </div>
        </div>
        <span class="tb-sep" />
        <button class="tb-btn" :class="{ off: !canUndo }" @click="undoAction" title="撤销 Ctrl+Z"><Icon name="undo" class="tb-icon" /></button>
        <button class="tb-btn" :class="{ off: !canRedo }" @click="redoAction" title="重做"><Icon name="redo" class="tb-icon" /></button>
        <button class="tb-btn" @click="clearAll" title="清除标注"><Icon name="trash" class="tb-icon" /></button>
      </div>
      <div class="toolbar-right">
        <button class="tb-act secondary" @click="emit('close')">取消</button>
        <button class="tb-act" :class="{ copied: copyFeedback }" @click="copyToClipboard">
          {{ copyFeedback ? '已复制 ✓' : '复制 ⌘C' }}
        </button>
        <button class="tb-act primary" @click="saveImage">完成</button>
      </div>
    </div>
    <div class="canvas-area" :style="{ width: canvasSize.displayW + 'px', height: canvasSize.displayH + 'px' }">
      <canvas ref="canvasRef" class="bg-layer" :style="{ width: canvasSize.displayW + 'px', height: canvasSize.displayH + 'px' }" />
      <canvas ref="overlayRef" class="draw-layer"
        :style="{ width: canvasSize.displayW + 'px', height: canvasSize.displayH + 'px', cursor: currentTool === 'select' ? 'default' : 'crosshair' }"
        @mousedown="handleMouseDown" @mousemove="handleMouseMove"
        @mouseup="handleMouseUp" @mouseleave="onMouseUp" />
      <div v-if="showTextInput" class="text-input-popup"
        :style="{ left: (textInputPos.x / canvasSize.w * 100) + '%', top: (textInputPos.y / canvasSize.h * 100) + '%' }">
        <input ref="textInputRef" v-model="textInputValue" class="text-input-field"
          placeholder="输入文字后回车" @keydown.enter="commitText"
          @keydown.escape="showTextInput = false" @blur="commitText" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.92);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  user-select: none;
}
.toolbar {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 16px;
  background: rgba(28,28,30,0.96);
  backdrop-filter: blur(24px);
  border-radius: 16px; padding: 6px 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: 10;
}
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 3px; }
.tb-btn {
  width: 36px; height: 36px; border: none; border-radius: 10px;
  background: rgba(255,255,255,0.06); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s;
  color: rgba(255,255,255,0.7);
}
.tb-btn:hover { background: rgba(255,255,255,0.15); color: #fff; }
.tb-btn.on { background: rgba(0,122,255,0.3); color: #fff; }
.tb-btn.off { opacity: 0.25; pointer-events: none; }
.tb-icon { width: 18px; height: 18px; }
.tb-sep { width: 1px; height: 22px; background: rgba(255,255,255,0.1); }
.color-picker-wrap {
  position: relative;
}
.color-btn {
  background: rgba(255,255,255,0.06); border-radius: 10px;
}
.color-btn:hover { background: rgba(255,255,255,0.15); }
.color-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.25); }
.color-menu {
  position: absolute; bottom: 44px; left: 50%; transform: translateX(-50%);
  background: rgba(28,28,30,0.98); border-radius: 12px;
  padding: 10px 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; gap: 10px; z-index: 20;
}
.color-presets {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px;
}
.color-swatch {
  width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.15);
  cursor: pointer; transition: transform .1s, border-color .1s;
}
.color-swatch:hover { transform: scale(1.15); border-color: rgba(255,255,255,0.5); }
.color-swatch.sel { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,0.3); }
.color-info-row {
  display: flex; align-items: center; gap: 10px;
  padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.08);
}
.color-dot-info {
  width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.2);
}
.hex-input {
  width: 78px; padding: 4px 8px; border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px; background: rgba(255,255,255,0.06); color: #fff;
  font-size: 13px; text-align: center; outline: none; font-family: monospace;
}
.hex-input:focus { border-color: rgba(255,255,255,0.4); }
.rgb-text {
  font-size: 12px; color: rgba(255,255,255,0.5);
  font-family: monospace; white-space: nowrap;
}
.width-dropdown { position: relative; }
.width-dot { display: block; background: #fff; border-radius: 50%; }
.width-menu {
  position: absolute; bottom: 44px; left: 50%; transform: translateX(-50%);
  background: rgba(28,28,30,0.98); border-radius: 12px;
  padding: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; gap: 2px; min-width: 100px;
}
.width-opt {
  display: flex; align-items: center; gap: 12px;
  padding: 7px 14px; border: none; border-radius: 8px;
  background: transparent; color: #fff; cursor: pointer; font-size: 13px;
}
.width-opt:hover { background: rgba(255,255,255,0.08); }
.width-opt.sel { background: rgba(0,122,255,0.2); }
.width-sample { background: #fff; border-radius: 50%; flex-shrink: 0; }
.width-label { min-width: 28px; text-align: right; opacity: 0.7; }
.tb-act {
  padding: 6px 16px; border: none; border-radius: 10px;
  background: rgba(255,255,255,0.08); color: #fff;
  cursor: pointer; font-size: 13px; font-weight: 500;
  transition: background .12s; white-space: nowrap;
}
.tb-act:hover { background: rgba(255,255,255,0.16); }
.tb-act.primary { background: #007aff; }
.tb-act.primary:hover { background: #0066d6; }
.tb-act.secondary { background: transparent; color: rgba(255,255,255,0.6); }
.tb-act.copied { background: rgba(52,199,89,0.25); color: #34c759; }
.canvas-area {
  position: relative; border-radius: 6px; overflow: hidden;
  box-shadow: 0 12px 48px rgba(0,0,0,0.6);
}
.bg-layer { position: absolute; inset: 0; }
.draw-layer { position: absolute; inset: 0; z-index: 1; }
.text-input-popup {
  position: absolute; z-index: 5; transform: translateY(-50%);
}
.text-input-field {
  padding: 6px 14px; border: 2px solid #007aff; border-radius: 10px;
  background: rgba(20,20,22,0.96); color: #fff; font-size: 16px;
  outline: none; min-width: 180px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
</style>
