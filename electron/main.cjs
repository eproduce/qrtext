// ═══════════════════════════════════════════════════════════════
//  QRTEXT Electron 主进程
//  Port from src-tauri/src/lib.rs
// ═══════════════════════════════════════════════════════════════
const { app, BrowserWindow, ipcMain, Menu, clipboard, nativeImage, dialog, screen, desktopCapturer } = require('electron')
const { execFile, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

// ── 调试日志：在终端运行 ./xxx.AppImage 时输出，用于定位 Linux 截图延迟/路径 ──
const dbg = (...a) => console.log('[qrtext]', Date.now(), ...a)

// ── 主窗口 ──
let mainWindow = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 480,
    minHeight: 400,
    fullscreenable: false,
    title: 'QRTEXT',
    icon: path.join(__dirname, '../icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 关闭确认
  mainWindow.on('close', (e) => {
    if (!closingConfirmed) {
      e.preventDefault()
      mainWindow.webContents.send('show-exit-confirm')
    }
  })
}

let closingConfirmed = false
ipcMain.on('confirm-exit', () => {
  closingConfirmed = true
  app.quit()
})

// ── 菜单栏 ──
function buildMenu() {
  const template = [
    {
      label: 'QRTEXT',
      submenu: [
        {
          label: '关于 QRTEXT',
          click: () => mainWindow?.webContents.send('show-about'),
        },
        { type: 'separator' },
        {
          label: '隐藏 QRTEXT',
          accelerator: 'CmdOrCtrl+H',
          click: () => app.hide(),
        },
        {
          label: '退出 QRTEXT',
          accelerator: 'CmdOrCtrl+Q',
          click: () => { closingConfirmed = true; app.quit() },
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '拷贝', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── 系统截图 ──
// 去重：上一次截图流程未结束前再次点击，直接复用同一次调用，
// 避免快速连点并发跑两条流程（hide 窗口 + 捕获互相干扰）导致报错
let takeScreenshotInFlight = null
ipcMain.handle('take-screenshot', () => {
  if (takeScreenshotInFlight) return takeScreenshotInFlight
  takeScreenshotInFlight = doTakeScreenshot()
    .finally(() => { takeScreenshotInFlight = null })
  return takeScreenshotInFlight
})

async function doTakeScreenshot() {
  const t0 = Date.now()
  dbg('take-screenshot 开始')
  // Linux：优先使用自研选区（Snipaste 式顺滑渲染，多屏/多分辨率适配）
  if (process.platform === 'linux') {
    const result = await customLinuxScreenshot()
    dbg('customLinuxScreenshot 返回', JSON.stringify({ ...result, hasData: !!result.dataUrl }), `${Date.now() - t0}ms`)
    if (result.cancelled) {
      throw new Error('截图已取消')
    }
    if (result.dataUrl) {
      writeImageToClipboard(result.dataUrl)
      return result.dataUrl
    }
    // 自研选区失败 → 回退外部截图工具
  }

  const tmpPath = path.join(os.tmpdir(), `qrtext_screenshot_${Date.now()}.png`)

  // 截图前完全隐藏窗口（hide 比 minimize 更彻底，无动画延迟）
  if (process.platform === 'linux' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
    await new Promise(r => setTimeout(r, 300))
  }

  try {
    if (process.platform === 'darwin') {
      await exec('screencapture', ['-i', '-x', tmpPath])
    } else if (process.platform === 'linux') {
      await linuxScreenshot(tmpPath)
    } else if (process.platform === 'win32') {
      await windowsScreenshot(tmpPath)
    }
  } finally {
    // 截图完成后恢复窗口
    if (process.platform === 'linux' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }

  if (!fs.existsSync(tmpPath)) {
    throw new Error('截图已取消或截图工具不可用')
  }

  const buf = fs.readFileSync(tmpPath)
  fs.unlinkSync(tmpPath)

  // 写入剪贴板
  try {
    const img = nativeImage.createFromBuffer(buf)
    clipboard.writeImage(img)
  } catch { /* 部分 Linux 桌面环境剪贴板不可用，静默忽略 */ }

  return `data:image/png;base64,${buf.toString('base64')}`
}

function writeImageToClipboard(dataUrl) {
  try {
    const img = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(img)
  } catch { /* 部分 Linux 桌面环境剪贴板不可用，静默忽略 */ }
}

// ── 自研截图选区（Snipaste 式） ──
let screenshotWin = null
let screenshotResolver = null
let screenshotCapture = null // 预捕获的显示器图像 [{ bounds, scaleFactor, nativeImage }]
let screenshotFlowStart = 0 // 一次截图流程的开始时刻（诊断用）

function customLinuxScreenshot() {
  return new Promise(async (resolve) => {
    screenshotFlowStart = Date.now()
    dbg('自研选区启动，session=', process.env.XDG_SESSION_TYPE || '(none)')
    // 原生 Wayland 会话：普通窗口在协议上无法盖过全屏应用（全屏 surface 恒在
    // 最顶），且 getBounds 返回 {0,0}、moveTop 不受支持，自研选区在多屏 +
    // 全屏下不可靠。直接返回「未完成」，让主流程回退系统截图工具
    // （grim+slurp / spectacle / gnome-screenshot 等，走合成器接口，
    // 可盖过全屏应用进行选区）。
    if (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) {
      dbg('→ 回退：Wayland 会话')
      resolve({ ok: false, cancelled: false })
      return
    }

    // 麒麟 UKUI 曾因「WM 将全屏应用强制置顶、自研选区盖不过」而整体回退
    // kylin-screenshot。实测（Kylin V10 SP1 / X11，ccb-pc）：kylin-screenshot
    // 以 `-a tmpPath` 调用并不产出文件 → 系统工具链整条失败，应用直接报
    // 「未找到截图工具」不可用。因此 X11 下改为优先自研选区（有 import 时
    // 捕获 ~0.2s，点击即出十字）；全屏遮挡交给 show 后的 raiseScreenshotWindow
    // 尽力置顶（非 UKUI 的 X11 全屏可盖）。Wayland 仍回退系统工具。
    dbg('X11 自研选区，desktop=', process.env.XDG_CURRENT_DESKTOP || '(none)')

    // 已有进行中的截图（用 resolver 判断，窗口会常驻复用）
    if (screenshotResolver) {
      dbg('→ 回退：已有截图进行中')
      resolve({ ok: false, cancelled: false })
      return
    }
    screenshotResolver = resolve

    // 截图前隐藏主窗口，避免其出现在捕获画面中
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide()
    }

    // 计算所有显示器的包围盒（支持多屏，坐标可为负）
    const displays = screen.getAllDisplays()
    const box = getVirtualBounds(displays)
    dbg('主窗口已隐藏，开始并行 选区窗口就绪 + 捕获')

    // 并行：确保选区窗口就绪（复用已创建的窗口），同时捕获屏幕 ——
    // 两者互不依赖，串行执行会白白叠加等待时间，是「开始截图卡顿」的主要来源
    Promise.all([
      ensureSelectionWindow(box.x, box.y, box.width, box.height),
      captureAllDisplays(),
    ])
      .then(([, captured]) => {
        dbg(`捕获完成，共 ${captured.length} 屏，耗时 ${Date.now() - screenshotFlowStart}ms`)
        screenshotCapture = captured
        sendPreviewData(captured)
        dbg('预览已发送，等待渲染端就绪→显示窗口')
      })
      .catch((e) => {
        // 捕获失败 → 回退外部截图工具
        dbg('自研选区捕获失败/回退：', e && e.message)
        screenshotCapture = null
        screenshotResolver = null
        hideSelectionWindow()
        restoreMainWindow()
        resolve({ ok: false, cancelled: false })
      })
  })
}

// 确保选区窗口就绪：已有窗口则复用（更新位置尺寸），否则新建。
// 置顶由显示后的 raiseScreenshotWindow 处理——窗口隐藏/未映射时
// 设置 alwaysOnTop 会被 X11 忽略（crbug.com/1260832）。
function ensureSelectionWindow(x, y, width, height) {
  if (screenshotWin && !screenshotWin.isDestroyed()) {
    screenshotWin.setBounds({ x, y, width, height })
    return Promise.resolve()
  }
  return createScreenshotWindow(x, y, width, height)
}

// 创建（隐藏）选区窗口并加载页面。供首次截图与启动预热共用；
// 页面 did-finish-load 后再 resolve，避免预览发送过早被跳过
function createScreenshotWindow(x, y, width, height) {
  return new Promise((resolve) => {
    screenshotWin = new BrowserWindow({
      x,
      y,
      width,
      height,
      // 不透明窗口：显示截图预览，避免透明窗口在部分 Linux 桌面变黑
      transparent: false,
      backgroundColor: '#000000',
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      // 预览图就绪前不显示，避免一闪而过的黑屏
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    screenshotWin.setAlwaysOnTop(true, 'screen-saver')
    screenshotWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    screenshotWin.loadFile(path.join(__dirname, 'screenshot.html'))

    screenshotWin.webContents.once('did-finish-load', () => {
      // 页面加载完成后，若捕获已完成则立即发送预览
      if (screenshotWin && !screenshotWin.isDestroyed() && screenshotCapture) {
        sendPreviewData(screenshotCapture)
      }
      resolve()
    })

    screenshotWin.on('closed', () => {
      screenshotWin = null
      screenshotCapture = null
      if (screenshotResolver) {
        const r = screenshotResolver
        screenshotResolver = null
        r({ ok: false, cancelled: true })
      }
    })
  })
}

// 启动预热：提前在后台创建好隐藏的选区窗口并加载页面，把
// 「首次点击截图要新建窗口 + 加载页面」的耗时挪到后台，
// 首次截图即可直接进入捕获流程，显著缩短点击到选区的延迟
let preloadingSelectionWin = false
function preloadScreenshotWindow() {
  if (process.platform !== 'linux') return
  if (preloadingSelectionWin) return
  if (screenshotWin && !screenshotWin.isDestroyed()) return
  const p = screen.getPrimaryDisplay()
  preloadingSelectionWin = true
  createScreenshotWindow(
    p.bounds.x,
    p.bounds.y,
    Math.max(1, Math.round(p.bounds.width)),
    Math.max(1, Math.round(p.bounds.height))
  )
    .catch(() => {})
    .finally(() => { preloadingSelectionWin = false })
}

function hideSelectionWindow() {
  if (screenshotWin && !screenshotWin.isDestroyed()) {
    screenshotWin.hide()
  }
}

// 发送低分辨率预览数据给选区窗口（JPEG 编码，体积小传输快）
function sendPreviewData(captured) {
  if (!screenshotWin || screenshotWin.isDestroyed()) return
  // 页面尚未加载完成，等待 did-finish-load 后再发送
  if (screenshotWin.webContents.isLoading()) return

  const winBounds = screenshotWin.getBounds()
  // 预览图仅作选区显示用（最终裁剪始终使用原生分辨率图像）。先把预览
  // 缩放到 CSS 显示尺寸并封顶最长边，可大幅降低 JPEG 编码耗时、IPC 体积
  // 与渲染端解码时间 —— 这是「点击截图 → 选区窗口出现」延迟的主要来源之一
  const PREVIEW_MAX_LONG = 2048
  const preview = captured.map((c) => {
    const w = c.bounds.width
    const h = c.bounds.height
    const size = c.nativeImage.getSize()
    const cssScale = Math.min(1, size.width / Math.max(1, w), size.height / Math.max(1, h))
    const capScale = Math.min(1, PREVIEW_MAX_LONG / Math.max(size.width, size.height, 1))
    const scale = Math.min(cssScale, capScale)
    const pw = scale < 1 ? Math.max(1, Math.round(size.width * scale)) : size.width
    const ph = scale < 1 ? Math.max(1, Math.round(size.height * scale)) : size.height
    const previewImg = (pw === size.width && ph === size.height)
      ? c.nativeImage
      : c.nativeImage.resize({ width: pw, height: ph, quality: 'good' })
    return {
      x: c.bounds.x - winBounds.x,
      y: c.bounds.y - winBounds.y,
      width: w,
      height: h,
      // JPEG 70：预览图仅作选区显示用，最终裁剪使用原生分辨率图像
      image: 'data:image/jpeg;base64,' + previewImg.toJPEG(70).toString('base64'),
    }
  })
  screenshotWin.webContents.send('screenshot-data', { displays: preview })
}

// 计算所有显示器的虚拟桌面包围盒
function getVirtualBounds(displays) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x)
    minY = Math.min(minY, d.bounds.y)
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// 快速检测命令是否存在（shell 内建 command -v）
function commandExists(cmd) {
  return new Promise((resolve) => {
    execFile('sh', ['-c', `command -v "${cmd}" >/dev/null 2>&1`], (err) => {
      resolve(!err)
    })
  })
}

// 带超时的命令执行（防止交互式截图工具阻塞等待用户操作）
function execWithTimeout(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 用 X11/Wayland 原生工具静默捕获整个虚拟桌面（远快于 desktopCapturer）
async function tryNativeFullCapture() {
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY

  // 第一梯队：静默且快的工具，无快门声/闪烁副作用，优先使用
  const silent = isWayland
    ? [{ cmd: 'grim', args: (p) => [p] }]
    : [
        // import 输出 JPEG（-strip 去掉元数据，quality 90），比 PNG 编码快得多
        { cmd: 'import', args: (p) => ['-window', 'root', '-strip', '-quality', '90', p] },
        { cmd: 'maim', args: (p) => ['-u', p] },
        { cmd: 'scrot', args: (p) => ['-o', p] },
      ]
  const img = await raceNativeTools(silent)
  if (img) return img

  if (isWayland) return null

  // 第二梯队：桌面环境自带截图工具（可能有快门声/闪烁），仅在无静默工具可用时回退
  const desktop = [
    { cmd: 'gnome-screenshot', args: (p) => ['-f', p] },
    { cmd: 'mate-screenshot', args: (p) => ['-f', p] },
    { cmd: 'xfce4-screenshooter', args: (p) => ['-f', '-s', p] },
    { cmd: 'ukui-screenshot', args: (p) => ['-f', p] },
    { cmd: 'deepin-screenshot', args: (p) => ['-f', p] },
  ]
  return raceNativeTools(desktop)
}

// 并行执行一组原生捕获工具（各自独立临时文件），首个成功者胜出。
// 串行逐个尝试时，每个挂起的工具都会白白消耗一个超时周期（1.5s×N），
// 这是「点击截图后数秒才出现选区」的主要来源；并行后最坏仅 1 个超时周期。
async function raceNativeTools(tools) {
  const checks = await Promise.all(
    tools.map(async (tool) => ((await commandExists(tool.cmd)) ? tool : null))
  )
  const available = checks.filter(Boolean)
  if (available.length === 0) return null

  const results = await Promise.all(
    available.map((tool) => {
      const tmpPath = path.join(
        os.tmpdir(),
        `qrtext_full_${Date.now()}_${Math.floor(Math.random() * 1e9)}.jpg`
      )
      return execWithTimeout(tool.cmd, tool.args(tmpPath), 1500)
        .then(() => {
          let img = null
          if (fs.existsSync(tmpPath)) {
            const candidate = nativeImage.createFromPath(tmpPath)
            if (!candidate.isEmpty()) img = candidate
            try { fs.unlinkSync(tmpPath) } catch { /* 忽略清理失败 */ }
          }
          return img
        })
        .catch(() => null)
    })
  )

  for (const img of results) {
    if (img) return img
  }
  return null
}

// 原生工具捕获整个虚拟桌面 → 按显示器边界裁剪为 captured 列表；失败返回 null。
// 整体限时：某工具存在但挂起时不耗尽多级串行超时
async function captureNativeByDisplay(displays, box) {
  const fullImg = await Promise.race([
    tryNativeFullCapture(),
    new Promise((r) => setTimeout(() => r(null), 1400)),
  ])
  if (!fullImg) return null
  const size = fullImg.getSize()
  if (!(size.width > 0 && size.height > 0)) return null
  const scaleX = size.width / box.width
  const scaleY = size.height / box.height
  // 捕获尺寸与虚拟桌面不成比例（如 grim 只抓聚焦屏、全屏应用切换分辨率、
  // 某屏幕独占捕获等）→ 视为不完整
  const ratioDiff = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY)
  if (ratioDiff > 0.1) return null
  return displays.map((d) => ({
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    scaleFactor: d.scaleFactor || 1,
    nativeImage: fullImg.crop({
      x: Math.round((d.bounds.x - box.x) * scaleX),
      y: Math.round((d.bounds.y - box.y) * scaleY),
      width: Math.round(d.bounds.width * scaleX),
      height: Math.round(d.bounds.height * scaleY),
    }),
  }))
}

// desktopCapturer 回退：按显示器裁剪为 captured 列表。
// 注意：Linux 下 PipeWire（Wayland）/ Xinerama（X11）常只返回单个
// 「整个虚拟桌面」source，而非每个显示器各一个 —— 多屏时必须按边界裁剪，
// 否则整张桌面图会被赋给每个显示器导致截图内容错位/重复。
// 最长边封顶 1920：无原生工具时取帧+PNG 编码是延迟主因，降采样可显著提速
async function captureViaDesktopCapturer(displays, box) {
  const maxDim = Math.max(box.width, box.height)
  const cap = 1920
  const ratio = maxDim > cap ? cap / maxDim : 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(1, Math.round(box.width * ratio)),
      height: Math.max(1, Math.round(box.height * ratio)),
    },
  })
  const sourceImages = sources
    .filter((s) => s && !s.thumbnail.isEmpty())
    .map((s) => ({
      id: s.display_id,
      image: nativeImage.createFromBuffer(s.thumbnail.toPNG()),
    }))
  if (sourceImages.length === 0) throw new Error('no display captured')

  const captured = []
  if (sourceImages.length === 1) {
    // 单个 source：整张虚拟桌面图 → 单屏直接使用，多屏按显示器边界裁剪
    const virtual = sourceImages[0].image
    if (displays.length === 1) {
      captured.push({
        bounds: { x: displays[0].bounds.x, y: displays[0].bounds.y, width: displays[0].bounds.width, height: displays[0].bounds.height },
        scaleFactor: displays[0].scaleFactor || 1,
        nativeImage: virtual,
      })
    } else {
      const size = virtual.getSize()
      const scaleX = size.width / box.width
      const scaleY = size.height / box.height
      for (const d of displays) {
        captured.push({
          bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
          scaleFactor: d.scaleFactor || 1,
          nativeImage: virtual.crop({
            x: Math.round((d.bounds.x - box.x) * scaleX),
            y: Math.round((d.bounds.y - box.y) * scaleY),
            width: Math.round(d.bounds.width * scaleX),
            height: Math.round(d.bounds.height * scaleY),
          }),
        })
      }
    }
  } else {
    // 多 source：按 display_id 精确匹配各显示器（Wayland 每输出一个 source）
    for (const d of displays) {
      const src = sourceImages.find((s) => s.id === String(d.id)) || sourceImages[0]
      captured.push({
        bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
        scaleFactor: d.scaleFactor || 1,
        nativeImage: src.image,
      })
    }
  }
  return captured
}

// 捕获所有显示器（原生分辨率）。原生工具与 desktopCapturer 并行竞争，
// 谁先产出有效结果用谁：某工具存在但慢/挂起时不必串行等完一轮再回退
// —— 这正是「点击截图后还要等 ~2s」的根因
async function captureAllDisplays() {
  const displays = screen.getAllDisplays()
  const box = getVirtualBounds(displays)
  const tasks = [
    captureNativeByDisplay(displays, box),
    captureViaDesktopCapturer(displays, box),
  ]
  return new Promise((resolve, reject) => {
    let settled = false
    const onOk = (r, who) => {
      if (!settled && Array.isArray(r) && r.length > 0) {
        settled = true
        dbg(`捕获胜出：${who}，共 ${r.length} 屏`)
        resolve(r)
      }
    }
    const onErr = () => {}
    tasks[0].then((r) => onOk(r, 'native 原生工具'), onErr)
    tasks[1].then((r) => onOk(r, 'desktopCapturer 回退'), onErr)
    Promise.allSettled(tasks).then(() => {
      if (!settled) reject(new Error('no display captured'))
    })
  })
}

function restoreMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
}

// 选区确认：relBounds 为选区窗口内相对坐标
ipcMain.on('screenshot-select', async (_event, relBounds) => {
  const resolver = screenshotResolver
  const win = screenshotWin
  const captured = screenshotCapture
  screenshotResolver = null
  screenshotCapture = null

  if (!win || !resolver || !relBounds || !captured) {
    hideSelectionWindow()
    resolver && resolver({ ok: false, cancelled: false })
    restoreMainWindow()
    return
  }

  const winBounds = win.getBounds()
  const selection = {
    x: winBounds.x + relBounds.x,
    y: winBounds.y + relBounds.y,
    w: relBounds.w,
    h: relBounds.h,
  }
  // 隐藏窗口（复用，下次截图无需重新创建）
  hideSelectionWindow()
  restoreMainWindow()

  try {
    // 直接用预捕获的原生分辨率图像裁剪（内存操作，无捕获延迟）
    const dataUrl = await cropFromCapture(captured, selection)
    resolver({ ok: true, dataUrl })
  } catch (e) {
    resolver({ ok: false, cancelled: false })
  }
})

ipcMain.on('screenshot-cancel', () => {
  const resolver = screenshotResolver
  screenshotResolver = null
  screenshotCapture = null
  hideSelectionWindow()
  restoreMainWindow()
  resolver && resolver({ ok: false, cancelled: true })
})

ipcMain.on('screenshot-ready', () => {
  const win = screenshotWin
  if (!win || win.isDestroyed()) return
  dbg('screenshot-ready → 显示选区窗口', screenshotFlowStart ? `自启动起 ${Date.now() - screenshotFlowStart}ms` : '')
  // 先显示并聚焦（映射窗口），再提升层级。
  // 注意：moveTop/setAlwaysOnTop 在窗口未映射（隐藏）时调用会被 X11 忽略
  // （Chromium crbug.com/1260832），必须在 show() 之后执行并重试，
  // 确保 WM 将选区窗口置于其它屏幕的全屏应用之上。
  win.show()
  win.focus()
  raiseScreenshotWindow()
})

// 提升选区窗口到最顶，盖过多屏场景下其它屏幕的全屏应用。
// X11：ABOVE 属性需在窗口映射（show）后由 WM 应用，延迟重试数次确保生效；
// Wayland：moveTop 不受支持、置顶由 compositor 决定，调用无害。
function raiseScreenshotWindow() {
  const win = screenshotWin
  if (!win || win.isDestroyed()) return
  let tries = 0
  const attempt = () => {
    if (!win || win.isDestroyed()) return
    try {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.moveTop()
      win.focus()
    } catch { /* Wayland 等平台不支持部分调用，忽略 */ }
    if (++tries < 8) setTimeout(attempt, 40)
  }
  attempt()
}

// 从预捕获图像中按全局 DIP 坐标裁剪（多屏 + 不同缩放比适配）
async function cropFromCapture(captured, selection) {
  // 找出与选区相交的显示器
  const involved = []
  for (const c of captured) {
    const ix = Math.max(selection.x, c.bounds.x)
    const iy = Math.max(selection.y, c.bounds.y)
    const ix2 = Math.min(selection.x + selection.w, c.bounds.x + c.bounds.width)
    const iy2 = Math.min(selection.y + selection.h, c.bounds.y + c.bounds.height)
    if (ix < ix2 && iy < iy2) {
      involved.push(c)
    }
  }
  if (involved.length === 0) throw new Error('no display involved')

  // 单显示器：直接裁剪（含缩放比换算）。裁剪坐标/尺寸必须钳制在图像
  // 实际像素范围内：缩放比或取整的微小偏差会让裁剪框越界，在右/下边缘
  // 抠出一整条黑边（用户反馈「截的图带黑边」的根因）
  if (involved.length === 1) {
    const c = involved[0]
    const size = c.nativeImage.getSize()
    const scaleX = size.width / c.bounds.width
    const scaleY = size.height / c.bounds.height
    let cx = Math.round((selection.x - c.bounds.x) * scaleX)
    let cy = Math.round((selection.y - c.bounds.y) * scaleY)
    let cw = Math.round(selection.w * scaleX)
    let ch = Math.round(selection.h * scaleY)
    if (cx < 0) { cw += cx; cx = 0 }
    if (cy < 0) { ch += cy; cy = 0 }
    cw = Math.min(cw, size.width - cx)
    ch = Math.min(ch, size.height - cy)
    if (cw <= 0 || ch <= 0) throw new Error('crop out of image bounds')
    const cropped = c.nativeImage.crop({ x: cx, y: cy, width: cw, height: ch })
    if (cropped.isEmpty()) throw new Error('crop produced empty image')
    return 'data:image/png;base64,' + cropped.toPNG().toString('base64')
  }

  // 多显示器：用离屏窗口合成
  const displayData = involved.map((c) => ({
    x: c.bounds.x,
    y: c.bounds.y,
    width: c.bounds.width,
    height: c.bounds.height,
    image: 'data:image/png;base64,' + c.nativeImage.toPNG().toString('base64'),
  }))
  return compositeDisplays(displayData, selection)
}

// 离屏合成窗口
let compositeWin = null
async function compositeDisplays(displayData, selection) {
  if (!compositeWin || compositeWin.isDestroyed()) {
    compositeWin = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
    })
    await compositeWin.loadFile(path.join(__dirname, 'composite.html'))
  }
  return compositeWin.webContents.executeJavaScript(
    `composite(${JSON.stringify(displayData)}, ${JSON.stringify(selection)})`
  )
}

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

async function linuxScreenshot(tmpPath) {
  // 检测 Wayland / X11 以优先匹配对应工具
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY

  const tools = isWayland
    ? [
        // Wayland：grim+slurp → flameshot → spectacle → gnome-screenshot
        { cmd: 'sh', args: ['-c', `slurp -d -f '%x,%y %w,%h' | grim -g - "${tmpPath}"`] },
        { cmd: 'flameshot', args: ['gui', '-p', tmpPath] },
        { cmd: 'spectacle', args: ['-b', '-n', '-r', '-o', tmpPath] },
        { cmd: 'gnome-screenshot', args: ['-a', '-f', tmpPath] },
        { cmd: 'maim', args: ['-s', '-u', tmpPath] },
        { cmd: 'import', args: [tmpPath] },
      ]
    : [
        // X11：gnome-screenshot（GTK 原生选择框，不易撕裂）→ kylin-screenshot
        // （麒麟自带，系统级可盖过全屏）→ flameshot → spectacle → ...
        { cmd: 'gnome-screenshot', args: ['-a', '-f', tmpPath] },
        { cmd: 'kylin-screenshot', args: ['-a', tmpPath] },
        { cmd: 'flameshot', args: ['gui', '-p', tmpPath] },
        { cmd: 'spectacle', args: ['-b', '-n', '-r', '-o', tmpPath] },
        { cmd: 'xfce4-screenshooter', args: ['-r', '-s', tmpPath] },
        { cmd: 'deepin-screenshot', args: ['-r', '-s', tmpPath] },
        { cmd: 'maim', args: ['-s', '-u', tmpPath] },
        // import 无参数是交互式（会挂起等人点选）；作为最后兜底改为非交互
        // 整屏抓取，保证至少能出图而不至于「未找到截图工具」
        { cmd: 'import', args: ['-window', 'root', '-strip', '-quality', '90', tmpPath] },
        { cmd: 'scrot', args: ['-s', tmpPath] },
        { cmd: 'ukui-screenshot', args: ['-a', '-s', '-o', tmpPath] },
      ]

  for (const tool of tools) {
    try {
      await exec(tool.cmd, tool.args)
      // 轮询等待文件写入，最多 1 秒（代替原来固定 500ms）
      for (let i = 0; i < 20; i++) {
        if (fs.existsSync(tmpPath)) return
        await new Promise(r => setTimeout(r, 50))
      }
    } catch { /* 工具不存在或用户取消，继续尝试下一个 */ }
  }

  throw new Error(
    '未找到截图工具。请安装以下任一：\n' +
    'flameshot、gnome-screenshot、spectacle、grim+slurp、maim'
  )
}

async function windowsScreenshot(tmpPath) {
  try {
    await exec('cmd', ['/c', 'start', '/wait', 'ms-screenclip:'])
    // 从剪贴板获取
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      fs.writeFileSync(tmpPath, img.toPNG())
      return
    }
  } catch { /* fallback */ }
  throw new Error('截图失败，请使用 Win+Shift+S 截图后粘贴')
}

// ── 浮动截图窗口（Snipaste 式：无边框纯图片、整窗拖动、滚轮缩放）──
let pinWin = null
let pinDataUrl = null
let pinDragOffset = null // 拖动时光标相对窗口左上角的偏移

ipcMain.handle('pin-screenshot', (_event, dataUrl) => {
  pinDataUrl = dataUrl
  // 窗口初始尺寸 = 图片实际尺寸（Snipaste 式，无多余边距）
  const size = nativeImage.createFromDataURL(dataUrl).getSize()
  const w = Math.max(24, size.width || 420)
  const h = Math.max(24, size.height || 320)

  if (pinWin && !pinWin.isDestroyed()) {
    // 复用 pin 窗口
    pinWin.setSize(w, h)
    pinWin.webContents.send('pin-set-image', dataUrl)
    pinWin.show()
    pinWin.focus()
    return
  }

  pinWin = new BrowserWindow({
    width: w,
    height: h,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  pinWin.on('closed', () => { pinWin = null; pinDragOffset = null })

  pinWin.loadFile(path.join(__dirname, '../dist/index.html'), {
    hash: `pin:${encodeURIComponent(dataUrl)}`,
  })
})

// 拖动开始：记录光标相对窗口的偏移（渲染端传 screenX/screenY，Wayland 兼容）
ipcMain.on('pin-drag-start', (e, pos) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  const [wx, wy] = win.getPosition()
  pinDragOffset = { dx: pos.screenX - wx, dy: pos.screenY - wy }
})

// 拖动中：跟随光标移动窗口
ipcMain.on('pin-drag-move', (e, pos) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || !pinDragOffset) return
  win.setPosition(
    Math.round(pos.screenX - pinDragOffset.dx),
    Math.round(pos.screenY - pinDragOffset.dy)
  )
})

// 拖动结束
ipcMain.on('pin-drag-end', () => { pinDragOffset = null })

// 滚轮缩放：按新图片尺寸调整窗口大小
ipcMain.on('pin-resize', (e, { w, h }) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  win.setSize(Math.max(24, Math.round(w)), Math.max(24, Math.round(h)))
})

// 右键菜单（Snipaste 式）
ipcMain.on('pin-context-menu', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  const dataUrl = pinDataUrl
  const menu = Menu.buildFromTemplate([
    {
      label: '复制图片',
      click: () => {
        try {
          clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
        } catch { /* 剪贴板不可用时静默忽略 */ }
      },
    },
    {
      label: '保存图片…',
      click: () => {
        const img = nativeImage.createFromDataURL(dataUrl)
        dialog.showSaveDialog(win, {
          title: '保存图钉图片',
          defaultPath: `QRTEXT-pin-${Date.now()}.png`,
          filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        }).then(({ canceled, filePath }) => {
          if (!canceled && filePath) fs.writeFileSync(filePath, img.toPNG())
        }).catch(() => {})
      },
    },
    { type: 'separator' },
    { label: '关闭', click: () => win.close() },
  ])
  menu.popup({ window: win })
})

ipcMain.on('close-window', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

// ── 剪贴板 ──
ipcMain.handle('write-clipboard-image', (_event, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl)
  clipboard.writeImage(img)
})

// ── Dock 图标 (macOS) ──
function setDockIcon() {
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '../icons/icon.png')
    if (fs.existsSync(iconPath)) {
      app.dock.setIcon(iconPath)
    }
  }
}

// 打印运行环境与可用截图工具（终端可见），用于判断截图走了哪条路径、为何慢
async function probeEnvironment() {
  const tools = ['import','maim','scrot','gnome-screenshot','mate-screenshot','xfce4-screenshooter','kylin-screenshot','flameshot','spectacle','ukui-screenshot','deepin-screenshot','grim','slurp']
  const found = []
  for (const t of tools) { try { if (await commandExists(t)) found.push(t) } catch {} }
  let nd = 0
  try { nd = screen.getAllDisplays().length } catch {}
  dbg('env platform=' + process.platform,
    'session=' + (process.env.XDG_SESSION_TYPE || '(none)') + (process.env.WAYLAND_DISPLAY ? ' wayland=yes' : ''),
    'desktop=' + (process.env.XDG_CURRENT_DESKTOP || '(none)'),
    'displays=' + nd,
    'tools=' + (found.length ? found.join(',') : 'NONE'))
}

// X11 下 desktopCapturer 首次调用需数秒初始化屏幕捕获（Electron 固有），
// 若机器缺少 import/maim/scrot 等原生工具会走该回退路径，冷启动极慢。
// 应用就绪后后台预热一次（小缩略图、丢弃结果），让首次截图就能快速回退
function warmUpDesktopCapturer() {
  if (process.platform !== 'linux') return
  if (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) return
  try {
    setTimeout(() => {
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 64, height: 64 },
      }).catch(() => {})
    }, 1500)
  } catch { /* 预热失败可忽略，回退时仍会再次尝试 */ }
}

// ── 应用启动 ──
app.whenReady().then(() => {
  buildMenu()
  setDockIcon()
  createMainWindow()
  warmUpDesktopCapturer()
  // 稍后后台创建隐藏选区窗口，预热「新建窗口+加载页面」的开销
  setTimeout(preloadScreenshotWindow, 1200)
  // 稍后打印运行环境与可用工具（诊断用）
  setTimeout(probeEnvironment, 3000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
