<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { DrawAction, ToolType } from '../types'
import { useDrawingTools } from '../composables/useDrawingTools'
import { useHistory } from '../composables/useHistory'

const props = defineProps<{
  imageSrc: string
}>()

const emit = defineEmits<{
  close: []
  save: [dataUrl: string]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
const actions = ref<DrawAction[]>([])
const bgImage = ref<HTMLImageElement | null>(null)

const { canUndo, canRedo, snapshot, undo, redo, clear: clearHistory } = useHistory()

function onActionAdded() {
  snapshot(actions.value)
}

const {
  currentTool, strokeColor, strokeWidth, fontSize,
  isDrawing,
  onMouseDown, onMouseMove, onMouseUp,
  drawPreview, renderActions,
  tools, colors,
} = useDrawingTools(overlayRef, actions, onActionAdded)

const canvasSize = ref({ w: 800, h: 600 })

onMounted(async () => {
  const img = new Image()
  img.onload = () => {
    bgImage.value = img
    const maxW = window.innerWidth * 0.85
    const maxH = window.innerHeight * 0.75
    let w = img.naturalWidth, h = img.naturalHeight
    if (w > maxW || h > maxH) {
      const r = Math.min(maxW / w, maxH / h)
      w = Math.floor(w * r)
      h = Math.floor(h * r)
    }
    canvasSize.value = { w, h }
    nextTick(() => {
      drawImage()
      snapshot([])
    })
  }
  img.src = props.imageSrc

  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})

function drawImage() {
  const canvas = canvasRef.value
  if (!canvas || !bgImage.value) return
  canvas.width = canvasSize.value.w
  canvas.height = canvasSize.value.h
  if (overlayRef.value) {
    overlayRef.value.width = canvasSize.value.w
    overlayRef.value.height = canvasSize.value.h
  }
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bgImage.value, 0, 0, canvas.width, canvas.height)
}

function redrawOverlay() {
  const canvas = overlayRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  renderActions(ctx, actions.value)
  drawPreview(ctx)
}

watch([actions, isDrawing, currentTool, strokeColor], () => {
  nextTick(redrawOverlay)
}, { deep: true })

// 鼠标在 overlay 上时
function handleMouseDown(e: MouseEvent) {
  onMouseDown(e)
  nextTick(redrawOverlay)
}
function handleMouseMove(e: MouseEvent) {
  onMouseMove(e)
  nextTick(redrawOverlay)
}
function handleMouseUp(e: MouseEvent) {
  onMouseUp(e)
  nextTick(redrawOverlay)
}

function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault()
    if (e.shiftKey) {
      const restored = redo()
      if (restored !== null) actions.value = restored
    } else {
      const restored = undo()
      if (restored !== null) actions.value = restored
    }
  }
  if (e.key === 'Escape') {
    emit('close')
  }
}

function undoAction() {
  const restored = undo()
  if (restored !== null) actions.value = restored
}

function redoAction() {
  const restored = redo()
  if (restored !== null) actions.value = restored
}

function clearAll() {
  actions.value = []
  clearHistory()
  snapshot([])
  nextTick(redrawOverlay)
}

async function copyToClipboard() {
  const canvas = document.createElement('canvas')
  canvas.width = canvasSize.value.w
  canvas.height = canvasSize.value.h
  const ctx = canvas.getContext('2d')!
  // 先画背景图
  if (bgImage.value) ctx.drawImage(bgImage.value, 0, 0, canvas.width, canvas.height)
  // 再画标注层
  const overlayCtx = overlayRef.value?.getContext('2d')
  if (overlayCtx) {
    renderActions(ctx, actions.value)
  }
  canvas.toBlob(async (blob) => {
    if (blob) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
    }
  })
}

async function saveImage() {
  const canvas = document.createElement('canvas')
  canvas.width = canvasSize.value.w
  canvas.height = canvasSize.value.h
  const ctx = canvas.getContext('2d')!
  if (bgImage.value) ctx.drawImage(bgImage.value, 0, 0, canvas.width, canvas.height)
  renderActions(ctx, actions.value)
  const dataUrl = canvas.toDataURL('image/png')
  emit('save', dataUrl)
  emit('close')
}
</script>

<template>
  <div class="screenshot-editor-overlay" @click.self="emit('close')">
    <div class="editor-container" :style="{ width: canvasSize.w + 'px' }">
      <!-- 工具栏 -->
      <div class="editor-toolbar">
        <div class="tool-group">
          <button v-for="t in tools" :key="t.type"
            :class="['tool-btn', { active: currentTool === t.type }]"
            @click="currentTool = t.type"
            :title="t.label">
            {{ t.icon }}
          </button>
        </div>
        <div class="tool-divider"></div>
        <div class="tool-group colors">
          <button v-for="c in colors" :key="c"
            :class="['color-btn', { active: strokeColor === c }]"
            :style="{ background: c }"
            @click="strokeColor = c" />
        </div>
        <div class="tool-divider"></div>
        <div class="tool-group">
          <input type="range" min="1" max="12" v-model.number="strokeWidth" class="width-slider" title="线宽" />
        </div>
        <div class="tool-divider"></div>
        <div class="tool-group actions">
          <button :disabled="!canUndo" @click="undoAction" title="撤销 Ctrl+Z">↩</button>
          <button :disabled="!canRedo" @click="redoAction" title="重做 Ctrl+Shift+Z">↪</button>
          <button @click="clearAll" title="清除标注">🗑</button>
        </div>
        <div class="tool-spacer"></div>
        <div class="tool-group">
          <button class="btn-primary" @click="copyToClipboard">📋 复制</button>
          <button class="btn-primary" @click="saveImage">💾 保存</button>
          <button class="btn-secondary" @click="emit('close')">✕</button>
        </div>
      </div>

      <!-- 画布区 -->
      <div class="canvas-wrapper" :style="{ width: canvasSize.w + 'px', height: canvasSize.h + 'px' }">
        <canvas ref="canvasRef" class="bg-canvas" />
        <canvas ref="overlayRef" class="overlay-canvas"
          @mousedown="handleMouseDown"
          @mousemove="handleMouseMove"
          @mouseup="handleMouseUp"
          @mouseleave="handleMouseUp"
          :style="{ cursor: currentTool === 'select' ? 'default' : 'crosshair' }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.screenshot-editor-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center;
}
.editor-container {
  background: #1c1c1e;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.editor-toolbar {
  display: flex; align-items: center;
  padding: 8px 12px; gap: 6px;
  background: #2c2c2e;
  flex-wrap: wrap;
}
.tool-group {
  display: flex; gap: 3px; align-items: center;
}
.tool-btn {
  width: 32px; height: 32px; border: none; border-radius: 6px;
  background: transparent; font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.tool-btn:hover { background: #3a3a3c; }
.tool-btn.active { background: #007aff; }
.tool-divider {
  width: 1px; height: 24px; background: #48484a; margin: 0 4px;
}
.color-btn {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer;
}
.color-btn.active { border-color: #fff; transform: scale(1.2); }
.width-slider { width: 60px; accent-color: #007aff; }
.actions button {
  width: 28px; height: 28px; border: none; border-radius: 4px;
  background: transparent; color: #fff; cursor: pointer; font-size: 14px;
}
.actions button:hover { background: #3a3a3c; }
.actions button:disabled { opacity: 0.3; }
.tool-spacer { flex: 1; }
.btn-primary {
  padding: 5px 12px; border: none; border-radius: 6px;
  background: #007aff; color: #fff; cursor: pointer; font-size: 13px;
}
.btn-primary:hover { background: #0056cc; }
.btn-secondary {
  padding: 5px 12px; border: none; border-radius: 6px;
  background: #48484a; color: #fff; cursor: pointer; font-size: 13px;
}
.canvas-wrapper {
  position: relative; overflow: hidden;
}
.bg-canvas, .overlay-canvas {
  position: absolute; top: 0; left: 0;
  width: 100%; height: 100%;
}
.overlay-canvas { z-index: 1; }
</style>
