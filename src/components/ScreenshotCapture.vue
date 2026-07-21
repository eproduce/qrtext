<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const emit = defineEmits<{
  captured: [dataUrl: string]
  cancel: []
}>()

const imgSrc = ref('')
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)

// 选区状态
const selecting = ref(false)
const selection = ref({ x: 0, y: 0, w: 0, h: 0 })
const startPos = ref({ x: 0, y: 0 })
const imgSize = ref({ w: 0, h: 0 })
const scale = ref({ x: 1, y: 1 })

// 暗区遮罩
const maskTop = ref('0px')
const maskRight = ref('0px')
const maskBottom = ref('0px')
const maskLeft = ref('0px')

onMounted(async () => {
  try {
    imgSrc.value = await invoke<string>('capture_fullscreen')
    const img = new Image()
    img.onload = () => {
      imgSize.value = { w: img.naturalWidth, h: img.naturalHeight }
      const c = canvasRef.value!
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      overlayRef.value!.width = c.width
      overlayRef.value!.height = c.height
      c.getContext('2d')!.drawImage(img, 0, 0)
      updateScale()
    }
    img.src = imgSrc.value
  } catch (e) {
    emit('cancel')
  }
  window.addEventListener('resize', updateScale)
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateScale)
  window.removeEventListener('keydown', onKey)
})

function updateScale() {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  scale.value = {
    x: imgSize.value.w / rect.width,
    y: imgSize.value.h / rect.height,
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('cancel')
}

function getPos(e: MouseEvent) {
  const rect = overlayRef.value!.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * scale.value.x,
    y: (e.clientY - rect.top) * scale.value.y,
  }
}

function onMouseDown(e: MouseEvent) {
  selecting.value = true
  const p = getPos(e)
  startPos.value = p
  selection.value = { x: p.x, y: p.y, w: 0, h: 0 }
}

function onMouseMove(e: MouseEvent) {
  if (!selecting.value) return
  const p = getPos(e)
  const x = Math.min(startPos.value.x, p.x)
  const y = Math.min(startPos.value.y, p.y)
  const w = Math.abs(p.x - startPos.value.x)
  const h = Math.abs(p.y - startPos.value.y)
  selection.value = { x, y, w, h }
  drawOverlay()
}

function onMouseUp(_e: MouseEvent) {
  selecting.value = false
  if (selection.value.w < 5 || selection.value.h < 5) {
    // 太小，忽略
    clearSelection()
    return
  }
  drawOverlay()
}

function drawOverlay() {
  const c = overlayRef.value!
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)

  // 半透明遮罩
  const { x, y, w, h } = selection.value

  // 四边暗区
  if (w > 0 && h > 0) {
    // 上
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, c.width, y)
    // 下
    ctx.fillRect(0, y + h, c.width, c.height - y - h)
    // 左
    ctx.fillRect(0, y, x, h)
    // 右
    ctx.fillRect(x + w, y, c.width - x - w, h)

    // 选区边框
    ctx.strokeStyle = '#007aff'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)

    // 选区四角
    const cornerLen = 12
    ctx.fillStyle = '#007aff'
    corners(ctx, x, y, cornerLen)
    corners(ctx, x + w, y, cornerLen)
    corners(ctx, x, y + h, cornerLen)
    corners(ctx, x + w, y + h, cornerLen)
  }
}

function corners(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number) {
  ctx.fillRect(cx - len / 2, cy - 1, len, 3)
  ctx.fillRect(cx - 1, cy - len / 2, 3, len)
}

function clearSelection() {
  selection.value = { x: 0, y: 0, w: 0, h: 0 }
  const c = overlayRef.value!
  c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
}

async function confirmCrop() {
  const { x, y, w, h } = selection.value
  if (w < 5 || h < 5) return
  try {
    const sx = Math.round(x)
    const sy = Math.round(y)
    const sw = Math.round(w)
    const sh = Math.round(h)
    const dataUrl = await invoke<string>('crop_screenshot', {
      dataUrl: imgSrc.value,
      x: sx,
      y: sy,
      width: sw,
      height: sh,
    })
    emit('captured', dataUrl)
  } catch (e) {
    emit('cancel')
  }
}
</script>

<template>
  <div class="screenshot-overlay">
    <canvas ref="canvasRef" class="bg-full" />
    <canvas
      ref="overlayRef"
      class="overlay-full"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
    />
    <!-- 操作栏 -->
    <div class="crop-bar" v-if="selection.w > 5">
      <button class="crop-btn cancel" @click="emit('cancel')">取消</button>
      <span class="crop-info">{{ Math.round(selection.w) }} × {{ Math.round(selection.h) }}</span>
      <button class="crop-btn confirm" @click="confirmCrop">确认</button>
    </div>
    <div v-else class="crop-bar">
      <button class="crop-btn cancel" @click="emit('cancel')">取消 (Esc)</button>
      <span class="crop-info">拖拽框选截图区域</span>
    </div>
  </div>
</template>

<style scoped>
.screenshot-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: #000; cursor: crosshair;
  user-select: none;
}
.bg-full, .overlay-full {
  position: absolute; top: 0; left: 0;
  width: 100%; height: 100%; object-fit: contain;
}
.overlay-full { z-index: 1; }
.crop-bar {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 20px;
  background: rgba(28,28,30,0.96); backdrop-filter: blur(24px);
  border-radius: 14px; padding: 8px 20px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: 10;
}
.crop-btn {
  padding: 8px 20px; border: none; border-radius: 10px;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.crop-btn.cancel { background: rgba(255,255,255,0.1); color: #fff; }
.crop-btn.cancel:hover { background: rgba(255,255,255,0.18); }
.crop-btn.confirm { background: #007aff; color: #fff; }
.crop-btn.confirm:hover { background: #0066d6; }
.crop-info { color: rgba(255,255,255,0.6); font-size: 13px; }
</style>
