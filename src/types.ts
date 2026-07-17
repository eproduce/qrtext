// 截图编辑器类型定义

export type ToolType = 'select' | 'pen' | 'arrow' | 'rect' | 'circle' | 'text' | 'blur'

export interface Point {
  x: number
  y: number
}

export interface DrawAction {
  tool: ToolType
  points: Point[]
  color: string
  lineWidth: number
  text?: string
  fontSize?: number
  // 用于矩形/圆形
  startPoint?: Point
  endPoint?: Point
}

export interface EditorState {
  actions: DrawAction[]
  currentAction: DrawAction | null
  isDrawing: boolean
}

export interface ScreenshotRecord {
  id: string
  dataUrl: string
  thumbnailUrl: string
  createdAt: number
  editedDataUrl?: string
  x?: number
  y?: number
  width?: number
}
