<script setup lang="ts">
import { ref, computed } from 'vue'
import type { StickyNote } from '../types'

const props = defineProps<{
  note: StickyNote
}>()

const emit = defineEmits<{
  update: [note: StickyNote]
  close: [id: string]
}>()

const editing = ref(false)
const editText = ref(props.note.text)

const colors = ['#fff9c4', '#ffccbc', '#c8e6c9', '#bbdefb', '#e1bee7', '#f5f5f5']
const noteStyle = computed(() => ({
  left: props.note.x + 'px',
  top: props.note.y + 'px',
  width: props.note.width + 'px',
  minHeight: props.note.height + 'px',
  background: props.note.color,
  zIndex: props.note.pinned ? 100 : 10,
}))

function save() {
  emit('update', { ...props.note, text: editText.value })
  editing.value = false
}

function changeColor(c: string) {
  emit('update', { ...props.note, color: c })
}

function togglePin() {
  emit('update', { ...props.note, pinned: !props.note.pinned })
}

// 拖拽
let dragging = false
let dragOffset = { x: 0, y: 0 }
function onDragStart(e: MouseEvent) {
  dragging = true
  dragOffset = { x: e.clientX - props.note.x, y: e.clientY - props.note.y }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}
function onDragMove(e: MouseEvent) {
  if (!dragging) return
  emit('update', {
    ...props.note,
    x: e.clientX - dragOffset.x,
    y: e.clientY - dragOffset.y,
  })
}
function onDragEnd() {
  dragging = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}
</script>

<template>
  <div class="sticky-note" :style="noteStyle">
    <div class="note-header" @mousedown="onDragStart">
      <div class="note-colors">
        <span v-for="c in colors" :key="c"
          class="note-color-dot"
          :style="{ background: c }"
          @click.stop="changeColor(c)" />
      </div>
      <div class="note-actions">
        <button @click="togglePin" :class="{ pinned: note.pinned }">📌</button>
        <button @click="emit('close', note.id)">✕</button>
      </div>
    </div>
    <div class="note-body" @dblclick="editing = true">
      <textarea v-if="editing" v-model="editText"
        @blur="save" @keydown.escape="save"
        class="note-textarea" autofocus />
      <div v-else class="note-text">{{ note.text || '双击编辑...' }}</div>
    </div>
  </div>
</template>

<style scoped>
.sticky-note {
  position: fixed;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.note-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 8px;
  cursor: move;
  user-select: none;
}
.note-colors { display: flex; gap: 4px; }
.note-color-dot {
  width: 12px; height: 12px; border-radius: 50%;
  cursor: pointer; border: 1px solid rgba(0,0,0,0.15);
}
.note-actions { display: flex; gap: 4px; }
.note-actions button {
  border: none; background: none; cursor: pointer;
  font-size: 12px; padding: 2px; border-radius: 4px;
}
.note-actions button:hover { background: rgba(0,0,0,0.08); }
.pinned { opacity: 0.5; }
.note-body { flex: 1; padding: 8px 12px 12px; overflow: auto; }
.note-text { white-space: pre-wrap; font-size: 13px; min-height: 40px; }
.note-textarea {
  width: 100%; min-height: 60px;
  border: none; background: transparent;
  resize: vertical; font-size: 13px; outline: none;
  font-family: inherit;
}
</style>
