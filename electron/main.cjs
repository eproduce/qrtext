// ═══════════════════════════════════════════════════════════════
//  QRTEXT Electron 主进程
//  Port from src-tauri/src/lib.rs
// ═══════════════════════════════════════════════════════════════
const { app, BrowserWindow, ipcMain, Menu, clipboard, nativeImage, dialog, screen, desktopCapturer } = require('electron')
const { execFile, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

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
ipcMain.handle('take-screenshot', async () => {
  // Linux：优先使用自研选区（Snipaste 式顺滑渲染，多屏/多分辨率适配）
  if (process.platform === 'linux') {
    const result = await customLinuxScreenshot()
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
})

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

function customLinuxScreenshot() {
  return new Promise((resolve) => {
    // 已有进行中的截图（用 resolver 判断，窗口会常驻复用）
    if (screenshotResolver) {
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

    // 并行：确保选区窗口就绪（复用已创建的窗口），同时捕获屏幕 ——
    // 两者互不依赖，串行执行会白白叠加等待时间，是「开始截图卡顿」的主要来源
    Promise.all([
      ensureSelectionWindow(box.x, box.y, box.width, box.height),
      captureAllDisplays(),
    ])
      .then(([, captured]) => {
        screenshotCapture = captured
        sendPreviewData(captured)
      })
      .catch(() => {
        // 捕获失败 → 回退外部截图工具
        screenshotCapture = null
        screenshotResolver = null
        hideSelectionWindow()
        restoreMainWindow()
        resolve({ ok: false, cancelled: false })
      })
  })
}

// 确保选区窗口就绪：首次创建，后续复用（避免每次新建窗口的开销）
function ensureSelectionWindow(x, y, width, height) {
  return new Promise((resolve) => {
    if (screenshotWin && !screenshotWin.isDestroyed()) {
      // 复用已创建的窗口：更新位置尺寸。
      // 置顶由显示后的 raiseScreenshotWindow 处理——窗口隐藏/未映射时
      // 设置 alwaysOnTop 会被 X11 忽略（crbug.com/1260832）。
      screenshotWin.setBounds({ x, y, width, height })
      resolve()
      return
    }

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
  const preview = captured.map((c) => {
    const w = c.bounds.width
    const h = c.bounds.height
    const size = c.nativeImage.getSize()
    // 尺寸一致时跳过 resize，减少编码前的耗时
    const resized = (size.width === w && size.height === h)
      ? c.nativeImage
      : c.nativeImage.resize({ width: w, height: h, quality: 'good' })
    return {
      x: c.bounds.x - winBounds.x,
      y: c.bounds.y - winBounds.y,
      width: w,
      height: h,
      // JPEG 70：预览图仅作选区显示用，最终裁剪使用原生分辨率图像，
      // 降低质量可显著加快编码与传输，减少「开始截图」的等待感
      image: 'data:image/jpeg;base64,' + resized.toJPEG(70).toString('base64'),
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
  const tmpPath = path.join(os.tmpdir(), `qrtext_full_${Date.now()}.jpg`)
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
  const candidates = isWayland
    ? [{ cmd: 'grim', args: [tmpPath] }]
    : [
        // import 输出 JPEG（-strip 去掉元数据，quality 90），比 PNG 编码快得多
        { cmd: 'import', args: ['-window', 'root', '-strip', '-quality', '90', tmpPath] },
        { cmd: 'maim', args: ['-u', tmpPath] },
        { cmd: 'scrot', args: ['-o', tmpPath] },
        { cmd: 'gnome-screenshot', args: ['-f', tmpPath] },
        { cmd: 'kylin-screenshot', args: [tmpPath] },
      ]

  // 并行检测工具是否存在，只调用可用的，避免逐个失败尝试的延迟
  const checks = await Promise.all(
    candidates.map(async (tool) => ((await commandExists(tool.cmd)) ? tool : null))
  )
  const available = checks.filter(Boolean)

  for (const tool of available) {
    try {
      // 1.5 秒超时：工具若是交互式/参数错误挂起，直接放弃换下一个
      await execWithTimeout(tool.cmd, tool.args, 1500)
      if (fs.existsSync(tmpPath)) {
        const img = nativeImage.createFromPath(tmpPath)
        fs.unlinkSync(tmpPath)
        if (!img.isEmpty()) return img
      }
    } catch { /* 参数不支持等，尝试下一个 */ }
  }
  return null
}

// 捕获所有显示器（原生分辨率）
async function captureAllDisplays() {
  const displays = screen.getAllDisplays()
  const box = getVirtualBounds(displays)

  // 优先：原生工具捕获整个虚拟桌面，再按显示器边界裁剪
  const fullImg = await tryNativeFullCapture()
  if (fullImg) {
    const size = fullImg.getSize()
    if (size.width > 0 && size.height > 0) {
      const scaleX = size.width / box.width
      const scaleY = size.height / box.height
      // 捕获尺寸与虚拟桌面不成比例（如 grim 只抓聚焦屏、全屏应用切换分辨率、
      // 某屏幕独占捕获等）→ 视为不完整，丢弃回退到 desktopCapturer
      const ratioDiff = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY)
      if (ratioDiff <= 0.1) {
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
    }
  }

  // 回退：desktopCapturer（高分辨率屏降采样以加快捕获）
  // 注意：Linux 下 PipeWire（Wayland）/ Xinerama（X11）常只返回单个
  // 「整个虚拟桌面」source，而非每个显示器各一个 —— 多屏时必须按边界裁剪，
  // 否则整张桌面图会被赋给每个显示器导致截图内容错位/重复。
  const maxDim = Math.max(box.width, box.height)
  const cap = 2560
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

  // 单显示器：直接裁剪（含缩放比换算）
  if (involved.length === 1) {
    const c = involved[0]
    const size = c.nativeImage.getSize()
    const scaleX = size.width / c.bounds.width
    const scaleY = size.height / c.bounds.height
    const cropped = c.nativeImage.crop({
      x: Math.round((selection.x - c.bounds.x) * scaleX),
      y: Math.round((selection.y - c.bounds.y) * scaleY),
      width: Math.round(selection.w * scaleX),
      height: Math.round(selection.h * scaleY),
    })
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
        // X11：gnome-screenshot（GTK 原生选择框，不易撕裂）→ flameshot → spectacle → ...
        { cmd: 'gnome-screenshot', args: ['-a', '-f', tmpPath] },
        { cmd: 'flameshot', args: ['gui', '-p', tmpPath] },
        { cmd: 'spectacle', args: ['-b', '-n', '-r', '-o', tmpPath] },
        { cmd: 'xfce4-screenshooter', args: ['-r', '-s', tmpPath] },
        { cmd: 'deepin-screenshot', args: ['-r', '-s', tmpPath] },
        { cmd: 'maim', args: ['-s', '-u', tmpPath] },
        { cmd: 'import', args: [tmpPath] },
        { cmd: 'scrot', args: ['-s', tmpPath] },
        { cmd: 'ukui-screenshot', args: ['-a', '-s', '-o', tmpPath] },
        { cmd: 'kylin-screenshot', args: ['-a', tmpPath] },
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

// ── 应用启动 ──
app.whenReady().then(() => {
  buildMenu()
  setDockIcon()
  createMainWindow()

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
