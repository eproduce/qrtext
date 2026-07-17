<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <!-- 选择/指针 -->
    <path v-if="name === 'select'" d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    <!-- 画笔 -->
    <path v-if="name === 'pen'" d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    <!-- 箭头 -->
    <path v-if="name === 'arrow'" d="M5 12h14" /><path d="M12 5l7 7-7 7" />
    <!-- 矩形 -->
    <rect v-if="name === 'rect'" x="3" y="3" width="18" height="18" rx="2" />
    <!-- 圆形 -->
    <circle v-if="name === 'circle'" cx="12" cy="12" r="9" />
    <!-- 文字 -->
    <polyline v-if="name === 'text'" points="4 7 4 4 20 4 20 7" /><line x1="9.5" y1="20" x2="14.5" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
    <!-- 马赛克 -->
    <rect v-if="name === 'blur'" x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" />
    <!-- 撤销 -->
    <polyline v-if="name === 'undo'" points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
    <!-- 重做 -->
    <polyline v-if="name === 'redo'" points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    <!-- 删除 -->
    <polyline v-if="name === 'trash'" points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    <!-- 钉 -->
    <line v-if="name === 'pin'" x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24Z" />
    <!-- 编辑 -->
    <path v-if="name === 'edit'" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    <!-- 复制 -->
    <rect v-if="name === 'copy'" x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    <!-- 保存/完成 -->
    <polyline v-if="name === 'check'" points="20 6 9 17 4 12" />
    <!-- 关闭 -->
    <line v-if="name === 'x'" x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ name: string }>()
</script>
