<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  id: string
  dataUrl: string
  x: number
  y: number
  width: number
}>()

const emit = defineEmits<{
  move: [id: string, x: number, y: number]
  close: [id: string]
}>()

const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const pos = ref({ x: props.x, y: props.y })

function onMouseDown(e: MouseEvent) {
  isDragging.value = true
  dragStart.value = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  pos.value = { x: e.clientX - dragStart.value.x, y: e.clientY - dragStart.value.y }
  emit('move', props.id, pos.value.x, pos.value.y)
}

function onMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}
</script>

<template>
  <div class="float-screenshot" :style="{ left: pos.x + 'px', top: pos.y + 'px', width: width + 'px' }">
    <div class="float-header" @mousedown="onMouseDown">
      <span class="float-title">截图</span>
      <button class="float-close" @click="emit('close', id)" title="关闭">✕</button>
    </div>
    <img :src="dataUrl" class="float-img" draggable="false" />
  </div>
</template>

<style scoped>
.float-screenshot {
  position: fixed; z-index: 999;
  border-radius: 10px; overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.35);
  background: #2c2c2e;
  transition: box-shadow .2s;
  min-width: 140px;
}
.float-screenshot:hover {
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
}
.float-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 10px; cursor: move;
  background: rgba(0,0,0,0.3);
}
.float-title { font-size: 11px; color: rgba(255,255,255,0.6); }
.float-close {
  border: none; background: none; color: rgba(255,255,255,0.5);
  cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 4px;
}
.float-close:hover { background: rgba(255,255,255,0.1); color: #fff; }
.float-img {
  display: block; width: 100%; height: auto;
  user-select: none; pointer-events: none;
}
</style>
