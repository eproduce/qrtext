# 版本变更

## 0.3.5 (2026-07-12)

### ✨ 功能
- 二维码识别：系统框选截图 / 拖拽图片 / Ctrl+V 粘贴，自动解析内容一键复制
- 二维码生成：输入文本实时预览，支持 2900+ 字符，一键下载 PNG
- 跨平台截图：macOS (screencapture) / Linux (gnome-screenshot) / Windows (ms-screenclip)
- 全中文菜单栏：QRTEXT（关于/隐藏/退出）· 编辑（撤销/重做/剪切/拷贝/粘贴/全选）· 窗口（最小化/全屏）
- 关于 QRTEXT 弹窗，显示版本信息和技术栈
- 深色极简风格自定义图标（QR 定位图案 + 青色扫描光线）

### 🚀 CI/CD
- GitHub Actions 自动三平台构建（deb/dmg/msi）
- push main 自动更新 Nightly Release
- push v* tag 自动创建正式 Release
- `npm run release` 一键升版号 + 生成 CHANGELOG + 打 tag
- Node24 Actions 运行时支持

### 🐛 修复
- Windows 构建图标格式兼容（ICO 3.0 格式）
- Linux 平台编译警告消除
- 二维码版本自适应，短文本模块清晰可扫
- 截图数据 base64 传递，绕过 WebView 文件权限
- 截图后不展示图片，直接显示识别结果
- 重新截图按钮，无需关闭当前结果即可继续

### 📚 文档
- 完整的 README（功能介绍、技术栈、开发指南、版本管理）
- 应用截图预览

