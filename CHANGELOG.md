# 版本变更

## 0.3.2 (2026-07-12)

## 0.3.1 (2026-07-12)

## 0.3.0 (2026-07-12)

## 0.2.1 (2026-07-12)

## 0.2.0 (2026-07-12)

## 0.1.2 (2026-07-12)

### 新增
- 添加自动化 release 脚本——自动升版号+生成 CHANGELOG+打 tag

### 修复
- release 脚本同步更新 README 版本号

## 0.1.1 (2026-07-12)

### 新增
- 二维码生成容量最大化——Version 40 + L级纠错，约 2900 字上限
- 统一版本管理——含 bump 脚本、CHANGELOG、动态版本号
- 重新设计图标——深色极简风格，青色扫描光线
- 设计 QRTEXT 专属图标，替换所有 demo 图标
- 添加 Nightly Release——每次 push main 自动发布预发布版本
- 推送 tag 自动创建 GitHub Release 并上传安装包
- 重构为二维码识别/生成工具，支持跨平台截图识别

### 修复
- 移除 Services 菜单项——系统控制无法汉化，且工具类应用无需此功能
- QRTEXT 菜单完全中文化 — 隐藏/退出改为自定义中文标签
- 窗口菜单中文化 — 最小化 / 进入全屏，添加菜单事件处理
- 菜单中文标签化 + 关于 QRTEXT 弹窗
- 使用 to-ico 生成真正的 ICO 格式，修复 Windows 构建 RC2175 错误
- 消除 Linux 平台 unreachable_code 警告，重构平台条件编译
- 添加 contents: write 权限，修复 Nightly Release 403 错误
- 重写构建流程——手动 vite build + tauri-action + upload-artifact
- 改用 npm run tauri:build，添加调试输出定位构建问题
- 修复 GitHub Actions 产物上传，tauri-action 自动上传

### 其他
- docs: 添加应用截图到 README 预览
- docs: 移除 README 中无效的预览截图链接
- ci: 切换到 Node24 Actions 运行时，适配 GitHub Actions 弃用 Node20
- i18n: 系统菜单栏改为中文
- refactor: 精简系统菜单栏，移除无关菜单项
- docs: 完善 README 文档
- 初始化项目 + GitHub Actions 构建

## 0.1.0 (2026-07-12)

### 新增
- 二维码识别：截图框选 / 拖拽图片 / 粘贴截图三种方式
- 二维码生成：输入文本实时预览，一键下载 PNG
- 跨平台截图功能（macOS / Linux / Windows）
- GitHub Actions 自动构建，支持 Nightly Release
- 深色极简风格自定义图标

### 优化
- 全中文系统菜单栏（QRTEXT / 编辑 / 窗口）
- 关于 QRTEXT 弹窗
- 现代化 Apple 风格 UI 界面
- 完整的 README 文档
