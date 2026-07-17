<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { DrawAction } from '../types'
import { useDrawingTools } from '../composables/useDrawingTools'
import { useHistory } from '../composables/useHistory'

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

const canvasSize = ref({ w: 800, h: 600 })

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

onMounted(async () => {
  const img = new Image()
  img.onload = () => {
    bgImage.value = img
    const maxW = window.innerWidth * 0.9, maxH = window.innerHeight * 0.78
    let w = img.naturalWidth, h = img.naturalHeight
    if (w > maxW || h > maxH) { const r = Math.min(maxW / w, maxH / h); w = Math.floor(w * r); h = Math.floor(h * r) }
    canvasSize.value = { w, h }
    nextTick(() => { drawImage(); snapshot([]) })
  }
  img.src = props.imageSrc
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

function drawImage() {
  const c = canvasRef.value; if (!c || !bgImage.value) return
  c.width = canvasSize.value.w; c.height = canvasSize.value.h
  if (overlayRef.value) { overlayRef.value.width = c.width; overlayRef.value.height = c.height }
  c.getContext('2d')!.drawImage(bgImage.value, 0, 0, c.width, c.height)
}

function redrawOverlay() {
  const c = overlayRef.value; if (!c) return
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  renderActions(ctx, actions.value); drawPreview(ctx)
}

watch([actions, isDrawing, currentTool, strokeColor, currentPoints], () => nextTick(redrawOverlay), { deep: true })

// 鼠标事件：触发 composable 逻辑并立即重绘
function handleMouseDown(e: MouseEvent) { onMouseDown(e); redrawOverlay() }
function handleMouseMove(e: MouseEvent) { onMouseMove(e); redrawOverlay() }

function onKeyDown(e: KeyboardEvent) {
  if (showTextInput.value) { if (e.key === 'Escape') showTextInput.value = false; return }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault(); const r = e.shiftKey ? redo() : undo(); if (r !== null) actions.value = r
  }
  if (e.key === 'Escape') emit('close')
}

function undoAction() { const r = undo(); if (r !== null) actions.value = r }
function redoAction() { const r = redo(); if (r !== null) actions.value = r }
function clearAll() { actions.value = []; clearHistory(); snapshot([]); nextTick(redrawOverlay) }

async function copyToClipboard() {
  const c = document.createElement('canvas'); c.width = canvasSize.value.w; c.height = canvasSize.value.h
  const ctx = c.getContext('2d')!; if (bgImage.value) ctx.drawImage(bgImage.value, 0, 0, c.width, c.height)
  renderActions(ctx, actions.value)
  c.toBlob(async b => { if (b) await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]) })
}

async function saveImage() {
  const c = document.createElement('canvas'); c.width = canvasSize.value.w; c.height = canvasSize.value.h
  const ctx = c.getContext('2d')!; if (bgImage.value) ctx.drawImage(bgImage.value, 0, 0, c.width, c.height)
  renderActions(ctx, actions.value); emit('save', c.toDataURL('image/png')); emit('close')
}
</script>

<template>
  <div class="editor-overlay" @click.self="emit('close')">
    <div class="toolbar">
      <div class="toolbar-left">
        <button v-for="t in tools" :key="t.type"
          :class="['tb-btn', { on: currentTool === t.type }]"
          @click="onToolClick(t.type)" :title="t.label">
          <span class="tb-icon">{{ t.icon }}</span>
        </button>
        <span class="tb-sep" />
        <label class="color-picker-wrap" title="颜色">
          <input type="color" v-model="strokeColor" class="color-picker" />
          <span class="color-dot" :style="{ background: strokeColor }"></span>
        </label>
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
        <button class="tb-btn" :class="{ off: !canUndo }" @click="undoAction" title="撤销 Ctrl+Z">↩</button>
        <button class="tb-btn" :class="{ off: !canRedo }" @click="redoAction" title="重做">↪</button>
        <button class="tb-btn" @click="clearAll" title="清除">🗑</button>
      </div>
      <div class="toolbar-right">
        <button class="tb-act secondary" @click="emit('close')">取消</button>
        <button class="tb-act" @click="copyToClipboard">复制</button>
        <button class="tb-act primary" @click="saveImage">完成</button>
      </div>
    </div>
    <div class="canvas-area" :style="{ width: canvasSize.w + 'px', height: canvasSize.h + 'px' }">
      <canvas ref="canvasRef" class="bg-layer" />
      <canvas ref="overlayRef" class="draw-layer"
        @mousedown="handleMouseDown" @mousemove="handleMouseMove"
        @mouseup="handleMouseUp" @mouseleave="onMouseUp"
        :style="{ cursor: currentTool === 'select' ? 'default' : 'crosshair' }" />
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
  background: transparent; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .12s;
}
.tb-btn:hover { background: rgba(255,255,255,0.08); }
.tb-btn.on { background: rgba(0,122,255,0.25); }
.tb-btn.off { opacity: 0.25; pointer-events: none; }
.tb-icon { font-size: 17px; line-height: 1; }
.tb-sep { width: 1px; height: 22px; background: rgba(255,255,255,0.1); }
.color-picker-wrap {
  position: relative; width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; border-radius: 10px;
}
.color-picker-wrap:hover { background: rgba(255,255,255,0.08); }
.color-picker { position: absolute; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.color-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.25); }
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
.canvas-area {
  position: relative; border-radius: 6px; overflow: hidden;
  box-shadow: 0 12px 48px rgba(0,0,0,0.6);
}
.bg-layer { position: absolute; inset: 0; }
.draw-layer { position: absolute; inset: 0; z-index: 1; }
.text-input-popup {
  position: absolute; z-index: 5; transform: translate(-50%, -50%);
}
.text-input-field {
  padding: 6px 14px; border: 2px solid #007aff; border-radius: 10px;
  background: rgba(20,20,22,0.96); color: #fff; font-size: 16px;
  outline: none; min-width: 180px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
</style>
