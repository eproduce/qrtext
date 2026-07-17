import { ref, type Ref } from 'vue'
import type { ToolType, Point, DrawAction } from '../types'

export function useDrawingTools(
  canvasRef: Ref<HTMLCanvasElement | null>,
  actionsRef: Ref<DrawAction[]>,
  onActionAdded: () => void,
) {
  const currentTool = ref<ToolType>('pen')
  const strokeColor = ref('#ff3b30')
  const strokeWidth = ref(3)
  const isDrawing = ref(false)
  const currentPoints = ref<Point[]>([])
  const startPoint = ref<Point | null>(null)
  const fontSize = ref(20)

  function getCanvasPos(e: MouseEvent): Point {
    const canvas = canvasRef.value!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function onMouseDown(e: MouseEvent) {
    if (currentTool.value === 'select') return
    isDrawing.value = true
    const pt = getCanvasPos(e)
    startPoint.value = pt
    currentPoints.value = [pt]
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDrawing.value) return
    const pt = getCanvasPos(e)

    if (currentTool.value === 'pen' || currentTool.value === 'arrow') {
      currentPoints.value.push(pt)
    } else if (currentTool.value === 'rect' || currentTool.value === 'circle' || currentTool.value === 'blur') {
      currentPoints.value = [pt] // 只用当前点更新预览
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (!isDrawing.value) return
    isDrawing.value = false

    const endPt = getCanvasPos(e)
    let action: DrawAction | null = null

    switch (currentTool.value) {
      case 'pen':
        if (currentPoints.value.length > 1) {
          action = {
            tool: 'pen',
            points: [...currentPoints.value],
            color: strokeColor.value,
            lineWidth: strokeWidth.value,
          }
        }
        break
      case 'arrow':
        if (currentPoints.value.length >= 1 && startPoint.value) {
          action = {
            tool: 'arrow',
            points: [startPoint.value, endPt],
            color: strokeColor.value,
            lineWidth: strokeWidth.value,
          }
        }
        break
      case 'rect':
        if (startPoint.value) {
          action = {
            tool: 'rect',
            points: [],
            color: strokeColor.value,
            lineWidth: strokeWidth.value,
            startPoint: startPoint.value,
            endPoint: endPt,
          }
        }
        break
      case 'circle':
        if (startPoint.value) {
          action = {
            tool: 'circle',
            points: [],
            color: strokeColor.value,
            lineWidth: strokeWidth.value,
            startPoint: startPoint.value,
            endPoint: endPt,
          }
        }
        break
      case 'blur':
        if (startPoint.value) {
          action = {
            tool: 'blur',
            points: [],
            color: strokeColor.value,
            lineWidth: strokeWidth.value,
            startPoint: startPoint.value,
            endPoint: endPt,
          }
        }
        break
      case 'text':
        // 文字工具由 ScreenshotEditor 组件处理内联输入，这里不生成 action
        break
    }

    if (action) {
      actionsRef.value.push(action)
      onActionAdded()
    }
    currentPoints.value = []
    startPoint.value = null
  }

  // 实时预览绘制
  function drawPreview(ctx: CanvasRenderingContext2D) {
    if (!isDrawing.value) return

    ctx.save()
    ctx.strokeStyle = strokeColor.value
    ctx.fillStyle = strokeColor.value
    ctx.lineWidth = strokeWidth.value
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const tool = currentTool.value
    const pts = currentPoints.value

    switch (tool) {
      case 'pen':
        if (pts.length > 1) {
          ctx.beginPath()
          ctx.moveTo(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y)
          }
          ctx.stroke()
        }
        break
      case 'arrow':
        if (startPoint.value && pts.length > 0) {
          drawArrow(ctx, startPoint.value, pts[pts.length - 1])
        }
        break
      case 'rect':
        if (startPoint.value && pts.length > 0) {
          const end = pts[pts.length - 1]
          ctx.strokeRect(startPoint.value.x, startPoint.value.y, end.x - startPoint.value.x, end.y - startPoint.value.y)
        }
        break
      case 'circle':
        if (startPoint.value && pts.length > 0) {
          const end = pts[pts.length - 1]
          const rx = Math.abs(end.x - startPoint.value.x) / 2
          const ry = Math.abs(end.y - startPoint.value.y) / 2
          const cx = (startPoint.value.x + end.x) / 2
          const cy = (startPoint.value.y + end.y) / 2
          ctx.beginPath()
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
        break
      case 'blur':
        if (startPoint.value && pts.length > 0) {
          const end = pts[pts.length - 1]
          ctx.fillStyle = 'rgba(128,128,128,0.5)'
          ctx.fillRect(startPoint.value.x, startPoint.value.y, end.x - startPoint.value.x, end.y - startPoint.value.y)
        }
        break
    }
    ctx.restore()
  }

  function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point) {
    const headLen = 12
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    // 箭头
    ctx.beginPath()
    ctx.moveTo(to.x, to.y)
    ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6))
    ctx.moveTo(to.x, to.y)
    ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
  }

  function drawAction(ctx: CanvasRenderingContext2D, action: DrawAction) {
    ctx.save()
    ctx.strokeStyle = action.color
    ctx.fillStyle = action.color
    ctx.lineWidth = action.lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    switch (action.tool) {
      case 'pen':
        if (action.points.length > 1) {
          ctx.beginPath()
          ctx.moveTo(action.points[0].x, action.points[0].y)
          for (let i = 1; i < action.points.length; i++) {
            ctx.lineTo(action.points[i].x, action.points[i].y)
          }
          ctx.stroke()
        }
        break
      case 'arrow':
        if (action.points.length >= 2) {
          drawArrow(ctx, action.points[0], action.points[1])
        }
        break
      case 'rect':
        if (action.startPoint && action.endPoint) {
          ctx.strokeRect(action.startPoint.x, action.startPoint.y, action.endPoint.x - action.startPoint.x, action.endPoint.y - action.startPoint.y)
        }
        break
      case 'circle':
        if (action.startPoint && action.endPoint) {
          const rx = Math.abs(action.endPoint.x - action.startPoint.x) / 2
          const ry = Math.abs(action.endPoint.y - action.startPoint.y) / 2
          const cx = (action.startPoint.x + action.endPoint.x) / 2
          const cy = (action.startPoint.y + action.endPoint.y) / 2
          ctx.beginPath()
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
        break
      case 'blur':
        if (action.startPoint && action.endPoint) {
          // 应用像素化模糊
          const x = Math.min(action.startPoint.x, action.endPoint.x)
          const y = Math.min(action.startPoint.y, action.endPoint.y)
          const w = Math.abs(action.endPoint.x - action.startPoint.x)
          const h = Math.abs(action.endPoint.y - action.startPoint.y)
          if (w > 0 && h > 0) {
            try {
              const imageData = ctx.getImageData(x, y, w, h)
              pixelate(imageData, 8)
              ctx.putImageData(imageData, x, y)
            } catch { /* 忽略边界外 */ }
          }
        }
        break
      case 'text':
        if (action.text && action.points.length > 0) {
          ctx.font = `${action.fontSize || 20}px sans-serif`
          ctx.fillText(action.text, action.points[0].x, action.points[0].y)
        }
        break
    }
    ctx.restore()
  }

  function pixelate(imageData: ImageData, blockSize: number) {
    const { data, width, height } = imageData
    for (let y = 0; y < height; y += blockSize) {
      for (let x = 0; x < width; x += blockSize) {
        let r = 0, g = 0, b = 0, count = 0
        for (let dy = 0; dy < blockSize && y + dy < height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < width; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4
            r += data[idx]
            g += data[idx + 1]
            b += data[idx + 2]
            count++
          }
        }
        r = Math.floor(r / count)
        g = Math.floor(g / count)
        b = Math.floor(b / count)
        for (let dy = 0; dy < blockSize && y + dy < height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < width; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4
            data[idx] = r
            data[idx + 1] = g
            data[idx + 2] = b
          }
        }
      }
    }
  }

  // 渲染所有已确认的 actions
  function renderActions(ctx: CanvasRenderingContext2D, actions: DrawAction[]) {
    for (const action of actions) {
      drawAction(ctx, action)
    }
  }

  const tools: { type: ToolType; icon: string; label: string }[] = [
    { type: 'select', icon: 'select', label: '选择' },
    { type: 'pen', icon: 'pen', label: '画笔' },
    { type: 'arrow', icon: 'arrow', label: '箭头' },
    { type: 'rect', icon: 'rect', label: '矩形' },
    { type: 'circle', icon: 'circle', label: '圆形' },
    { type: 'text', icon: 'text', label: '文字' },
    { type: 'blur', icon: 'blur', label: '马赛克' },
  ]

  return {
    currentTool, strokeColor, strokeWidth,
    isDrawing, currentPoints, startPoint,
    onMouseDown, onMouseMove, onMouseUp,
    drawPreview, renderActions,
    tools,
  }
}
