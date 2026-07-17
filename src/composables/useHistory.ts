import { ref, computed } from 'vue'
import type { DrawAction } from '../types'

export function useHistory() {
  const undoStack = ref<DrawAction[][]>([])
  const redoStack = ref<DrawAction[][]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function snapshot(actions: DrawAction[]) {
    undoStack.value.push(actions.map(a => ({ ...a, points: [...a.points] })))
    redoStack.value = []
  }

  function undo(): DrawAction[] | null {
    if (!canUndo.value) return null
    const current = undoStack.value[undoStack.value.length - 1]
    redoStack.value.push(current.map(a => ({ ...a, points: [...a.points] })))
    undoStack.value.pop()
    // 返回上一个状态
    if (undoStack.value.length > 0) {
      return undoStack.value[undoStack.value.length - 1].map(a => ({ ...a, points: [...a.points] }))
    }
    return []
  }

  function redo(): DrawAction[] | null {
    if (!canRedo.value) return null
    const next = redoStack.value.pop()!
    undoStack.value.push(next.map(a => ({ ...a, points: [...a.points] })))
    return next.map(a => ({ ...a, points: [...a.points] }))
  }

  function clear() {
    undoStack.value = []
    redoStack.value = []
  }

  return { canUndo, canRedo, snapshot, undo, redo, clear }
}
