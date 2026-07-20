# 版本变更












## 0.3.8 (2026-07-20)

- fix: 修复 AppImage/Windows 启动问题，增强错误诊断
## 0.3.8 (2026-07-19)

- feat: 修复粘贴快捷键、编辑器交互及新增剪贴板复制功能
## 0.3.8 (2026-07-17)

- 修复：删除未使用的 fontSize 变量
- SVG图标独立渲染 + 半透明底色 + 模糊修复（直接像素化背景）
- 编辑器默认亮色 + 加粗线宽，深色背景可见
- 全部 emoji 替换为统一样式 SVG 图标
- 钉截图移到历史面板 + 系统级浮动窗口 + Tauri 拖拽/关闭权限
- 浮动截图改用 Tauri 多窗口 API：独立系统窗口，可移出应用、可拖拽、可调整大小
- 浮动截图替代便签：截图像便利贴一样钉在桌面 + 修复画布实时渲染
- 截图编辑器重设计：底部悬浮工具栏 + 色盘 + 线宽下拉 + 修复文字输入
## 0.3.8 (2026-07-17)

- 修复 TS 错误：移除未使用的 import 和变量
- 截图编辑器：画笔/箭头/矩形/圆/文字/马赛克 + 撤销重做 + 便利贴 + 截图历史
## 0.3.8 (2026-07-17)

- AppRun 用 $APPDIR 替代 readlink -f，兼容老系统
## 0.3.8 (2026-07-16)

- Windows便携版修复：直接打包构建输出 + 嵌入 WebView2
## 0.3.8 (2026-07-16)

- 修复 AppRun 冲突：linuxdeploy 只拉库，appimagetool 打包
- docs: update changelog for 0.3.8 [skip ci]
- 修复：删除重复的 id: bump
- 版本号一致性：删除 nightly 后缀，Release tag 用 commit SHA
- chore: release v0.3.8 [skip ci]
- 修复：删除多余的 fi 语法错误
- 修复 AppImage：捆绑完整 glibc 全家桶 + patchelf 强制定向打包链接器
- chore: release v0.3.7 [skip ci]
- macOS: Apple Silicon 交叉编译 x86_64，单 job 双架构
- macOS 双架构：Apple Silicon + Intel x86_64
- chore: release v0.3.6 [skip ci]
- Windows 改为 NSIS + 便携版 zip；release 自动升版号 + CHANGELOG
- 自动版本号：nightly tag 唯一 + 二进制版本带 run_number
- 恢复 macOS 和 Windows 构建
- 修复：删除重复的 upload-artifact 步骤
- AppImage 完全自包含：捆绑 glibc + webkit2gtk-4.1 + GTK3，不碰系统库
- 修复：构建脚本独立成文件，避免 YAML 转义问题
- CI: ubuntu:20.04 + 多国内镜像回退 → glibc 2.31 兼容麒麟
- CI: 麒麟公网镜像 + 阿里云镜像回退，全部依赖与 SP1 版本一致
- 修复：从 Jammy 拉取 libsoup-3.0（Debian Bullseye 缺少）
- CI: 改用 Debian Bullseye 容器（glibc 2.31，LTS 支持中）
- CI: ubuntu:20.04 容器构建 → glibc 2.31 完整兼容麒麟 SP1 V10 AppImage
- 简化 CI：ubuntu-22.04 直接构建，添加 glibc 兼容性检查
- 修复 CI：ubuntu-20.04 已下线，改用容器内构建 glibc 2.31
- 适配麒麟 SP1 V10：glibc 2.31 兼容构建 + 国产截图工具支持
- docs: 重写 CHANGELOG，所有特性合并至 0.3.5
- chore: release v0.3.5
- chore: release v0.3.4
- chore: release v0.3.3
- chore: release v0.3.2
- chore: release v0.3.1
- chore: release v0.3.0
- chore: release v0.2.1
- chore: release v0.2.0
- chore: release v0.1.2
- fix: release 脚本同步更新 README 版本号
- feat: 添加自动化 release 脚本——自动升版号+生成 CHANGELOG+打 tag
- chore: release v0.1.1
- feat: 二维码生成容量最大化——Version 40 + L级纠错，约 2900 字上限
- feat: 统一版本管理——含 bump 脚本、CHANGELOG、动态版本号
- fix: 移除 Services 菜单项——系统控制无法汉化，且工具类应用无需此功能
- fix: QRTEXT 菜单完全中文化 — 隐藏/退出改为自定义中文标签
- fix: 窗口菜单中文化 — 最小化 / 进入全屏，添加菜单事件处理
- fix: 菜单中文标签化 + 关于 QRTEXT 弹窗
- feat: 重新设计图标——深色极简风格，青色扫描光线
- docs: 添加应用截图到 README 预览
- docs: 移除 README 中无效的预览截图链接
- fix: 使用 to-ico 生成真正的 ICO 格式，修复 Windows 构建 RC2175 错误
- fix: 消除 Linux 平台 unreachable_code 警告，重构平台条件编译
- fix(ci): 添加 contents: write 权限，修复 Nightly Release 403 错误
- feat: 设计 QRTEXT 专属图标，替换所有 demo 图标
- feat(ci): 添加 Nightly Release——每次 push main 自动发布预发布版本
- fix(ci): 重写构建流程——手动 vite build + tauri-action + upload-artifact
- fix(ci): 改用 npm run tauri:build，添加调试输出定位构建问题
- feat(ci): 推送 tag 自动创建 GitHub Release 并上传安装包
- ci: 切换到 Node24 Actions 运行时，适配 GitHub Actions 弃用 Node20
- fix(ci): 修复 GitHub Actions 产物上传，tauri-action 自动上传
- i18n: 系统菜单栏改为中文
- refactor: 精简系统菜单栏，移除无关菜单项
- docs: 完善 README 文档
- feat: 重构为二维码识别/生成工具，支持跨平台截图识别
- 初始化项目 + GitHub Actions 构建
## 0.3.8 (2026-07-15)

- 修复：删除重复的 id: bump
- 版本号一致性：删除 nightly 后缀，Release tag 用 commit SHA
- chore: release v0.3.8 [skip ci]
- 修复：删除多余的 fi 语法错误
- 修复 AppImage：捆绑完整 glibc 全家桶 + patchelf 强制定向打包链接器
- chore: release v0.3.7 [skip ci]
- macOS: Apple Silicon 交叉编译 x86_64，单 job 双架构
- macOS 双架构：Apple Silicon + Intel x86_64
- chore: release v0.3.6 [skip ci]
- Windows 改为 NSIS + 便携版 zip；release 自动升版号 + CHANGELOG
- 自动版本号：nightly tag 唯一 + 二进制版本带 run_number
- 恢复 macOS 和 Windows 构建
- 修复：删除重复的 upload-artifact 步骤
- AppImage 完全自包含：捆绑 glibc + webkit2gtk-4.1 + GTK3，不碰系统库
- 修复：构建脚本独立成文件，避免 YAML 转义问题
- CI: ubuntu:20.04 + 多国内镜像回退 → glibc 2.31 兼容麒麟
- CI: 麒麟公网镜像 + 阿里云镜像回退，全部依赖与 SP1 版本一致
- 修复：从 Jammy 拉取 libsoup-3.0（Debian Bullseye 缺少）
- CI: 改用 Debian Bullseye 容器（glibc 2.31，LTS 支持中）
- CI: ubuntu:20.04 容器构建 → glibc 2.31 完整兼容麒麟 SP1 V10 AppImage
- 简化 CI：ubuntu-22.04 直接构建，添加 glibc 兼容性检查
- 修复 CI：ubuntu-20.04 已下线，改用容器内构建 glibc 2.31
- 适配麒麟 SP1 V10：glibc 2.31 兼容构建 + 国产截图工具支持
- docs: 重写 CHANGELOG，所有特性合并至 0.3.5
- chore: release v0.3.5
- chore: release v0.3.4
- chore: release v0.3.3
- chore: release v0.3.2
- chore: release v0.3.1
- chore: release v0.3.0
- chore: release v0.2.1
- chore: release v0.2.0
- chore: release v0.1.2
- fix: release 脚本同步更新 README 版本号
- feat: 添加自动化 release 脚本——自动升版号+生成 CHANGELOG+打 tag
- chore: release v0.1.1
- feat: 二维码生成容量最大化——Version 40 + L级纠错，约 2900 字上限
- feat: 统一版本管理——含 bump 脚本、CHANGELOG、动态版本号
- fix: 移除 Services 菜单项——系统控制无法汉化，且工具类应用无需此功能
- fix: QRTEXT 菜单完全中文化 — 隐藏/退出改为自定义中文标签
- fix: 窗口菜单中文化 — 最小化 / 进入全屏，添加菜单事件处理
- fix: 菜单中文标签化 + 关于 QRTEXT 弹窗
- feat: 重新设计图标——深色极简风格，青色扫描光线
- docs: 添加应用截图到 README 预览
- docs: 移除 README 中无效的预览截图链接
- fix: 使用 to-ico 生成真正的 ICO 格式，修复 Windows 构建 RC2175 错误
- fix: 消除 Linux 平台 unreachable_code 警告，重构平台条件编译
- fix(ci): 添加 contents: write 权限，修复 Nightly Release 403 错误
- feat: 设计 QRTEXT 专属图标，替换所有 demo 图标
- feat(ci): 添加 Nightly Release——每次 push main 自动发布预发布版本
- fix(ci): 重写构建流程——手动 vite build + tauri-action + upload-artifact
- fix(ci): 改用 npm run tauri:build，添加调试输出定位构建问题
- feat(ci): 推送 tag 自动创建 GitHub Release 并上传安装包
- ci: 切换到 Node24 Actions 运行时，适配 GitHub Actions 弃用 Node20
- fix(ci): 修复 GitHub Actions 产物上传，tauri-action 自动上传
- i18n: 系统菜单栏改为中文
- refactor: 精简系统菜单栏，移除无关菜单项
- docs: 完善 README 文档
- feat: 重构为二维码识别/生成工具，支持跨平台截图识别
- 初始化项目 + GitHub Actions 构建
## 0.3.8 (2026-07-15)

- 修复：删除多余的 fi 语法错误
- 修复 AppImage：捆绑完整 glibc 全家桶 + patchelf 强制定向打包链接器
## 0.3.7 (2026-07-14)

- macOS: Apple Silicon 交叉编译 x86_64，单 job 双架构
- macOS 双架构：Apple Silicon + Intel x86_64
## 0.3.6 (2026-07-14)

- Windows 改为 NSIS + 便携版 zip；release 自动升版号 + CHANGELOG
- 自动版本号：nightly tag 唯一 + 二进制版本带 run_number
- 恢复 macOS 和 Windows 构建
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

