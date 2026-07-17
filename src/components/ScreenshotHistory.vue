<script setup lang="ts">
import type { ScreenshotRecord } from '../types'
import Icon from './Icon.vue'

defineProps<{
  records: ScreenshotRecord[]
}>()

const emit = defineEmits<{
  select: [record: ScreenshotRecord]
  delete: [id: string]
  edit: [record: ScreenshotRecord]
  pin: [record: ScreenshotRecord]
}>()
</script>

<template>
  <div class="history-panel" v-if="records.length">
    <div class="history-title">截图历史</div>
    <div class="history-list">
      <div v-for="rec in records" :key="rec.id" class="history-item">
        <img :src="rec.editedDataUrl || rec.thumbnailUrl"
          class="history-thumb"
          @click="emit('select', rec)"
          :title="new Date(rec.createdAt).toLocaleString()" />
        <div class="history-actions">
          <button @click="emit('pin', rec)" title="钉在桌面"><Icon name="pin" class="h-icon" /></button>
          <button @click="emit('edit', rec)" title="编辑"><Icon name="edit" class="h-icon" /></button>
          <button @click="emit('delete', rec.id)" title="删除"><Icon name="trash" class="h-icon" /></button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-panel {
  padding: 12px;
  border-top: 1px solid #333;
}
.history-title {
  font-size: 12px; color: #888;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.history-list {
  display: flex; gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.history-item {
  position: relative;
  flex-shrink: 0;
}
.history-thumb {
  width: 80px; height: 56px;
  object-fit: cover; border-radius: 6px;
  cursor: pointer; border: 2px solid transparent;
}
.history-thumb:hover { border-color: #007aff; }
.history-actions {
  position: absolute; top: 2px; right: 2px;
  display: none; gap: 2px;
}
.history-item:hover .history-actions { display: flex; }
.history-actions button {
  width: 20px; height: 20px; border: none; border-radius: 4px;
  background: rgba(0,0,0,0.7); color: #fff;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.h-icon { width: 12px; height: 12px; }
</style>
