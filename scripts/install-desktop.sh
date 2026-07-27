#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  QRTEXT 桌面集成安装脚本
#  在麒麟/Linux 上创建桌面快捷方式和开始菜单项
#
#  用法：bash install-desktop.sh ./QRTEXT-1.0.3.AppImage
# ═══════════════════════════════════════════════════════════════
set -e

APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "用法: bash $0 <QRTEXT-x86_64.AppImage>"
  exit 1
fi

APPIMAGE="$(realpath "$APPIMAGE")"
APPNAME="QRTEXT"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
APP_DIR="$HOME/.local/share/applications"
BIN_DIR="$HOME/.local/bin"

echo "安装 QRTEXT 桌面集成..."
echo "  AppImage: $APPIMAGE"
echo ""

# 1. 创建可执行快捷方式
mkdir -p "$BIN_DIR"
ln -sf "$APPIMAGE" "$BIN_DIR/qrtext"
chmod +x "$APPIMAGE"

# 2. 提取图标
mkdir -p "$ICON_DIR"
"$APPIMAGE" --appimage-extract "usr/share/icons/hicolor/256x256/apps/qrtext.png" >/dev/null 2>&1 || true
"$APPIMAGE" --appimage-extract ".DirIcon" >/dev/null 2>&1 || true
if [ -f squashfs-root/.DirIcon ]; then
  cp squashfs-root/.DirIcon "$ICON_DIR/qrtext.png"
elif [ -f squashfs-root/usr/share/icons/hicolor/256x256/apps/qrtext.png ]; then
  cp squashfs-root/usr/share/icons/hicolor/256x256/apps/qrtext.png "$ICON_DIR/qrtext.png"
elif [ -f icons/icon.png ]; then
  cp icons/icon.png "$ICON_DIR/qrtext.png"
fi
rm -rf squashfs-root

# 3. 创建 .desktop 文件
mkdir -p "$APP_DIR"
cat > "$APP_DIR/qrtext.desktop" << EOF
[Desktop Entry]
Type=Application
Name=QRTEXT
Comment=QR 码识别与生成工具
Exec=$BIN_DIR/qrtext %U
Icon=qrtext
Terminal=false
Categories=Utility;
StartupWMClass=QRTEXT
EOF

# 4. 刷新桌面数据库
command -v update-desktop-database &>/dev/null && update-desktop-database "$APP_DIR" || true

echo "✅ 完成！桌面和开始菜单中应该能看到 QRTEXT 图标了。"
echo ""
echo "卸载："
echo "  rm $BIN_DIR/qrtext $APP_DIR/qrtext.desktop $ICON_DIR/qrtext.png"
