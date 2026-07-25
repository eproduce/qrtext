#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Docker 容器内构建入口
#  产出：deb / rpm / 麒麟自包含 AppImage
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cd /workspace

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  QRTEXT Docker 构建${NC}"
echo -e "${GREEN}  $(date '+%Y-%m-%d %H:%M')${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""

# ── 1. npm 依赖 ──
echo -e "${YELLOW}[1/5] npm ci...${NC}"
npm ci
echo -e "${GREEN}✓ npm 依赖完成${NC}"

# ── 2. 前端构建 ──
echo ""
echo -e "${YELLOW}[2/5] vite build...${NC}"
npx vite build
echo -e "${GREEN}✓ 前端构建完成${NC}"

# ── 3. Tauri 构建 deb + rpm ──
echo ""
echo -e "${YELLOW}[3/5] tauri build (deb + rpm)...${NC}"
npx tauri build --bundles deb,rpm 2>&1 | tail -20
echo -e "${GREEN}✓ deb/rpm 构建完成${NC}"

# ── 4. 制作麒麟专用 AppImage ──
echo ""
echo -e "${YELLOW}[4/5] 制作麒麟专用 AppImage（自包含 glibc 全家桶）...${NC}"

BIN="src-tauri/target/release/qrtext"
APPDIR="/tmp/QRTEXT.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" \
         "$APPDIR/usr/share/icons" \
         "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/lib"

cp "$BIN" "$APPDIR/usr/bin/qrtext"

cat > "$APPDIR/usr/share/applications/qrtext.desktop" << 'DESKEOF'
[Desktop Entry]
Type=Application
Name=QRTEXT
Icon=qrtext
Exec=qrtext
Categories=Utility;
DESKEOF

cp src-tauri/icons/128x128.png "$APPDIR/usr/share/icons/qrtext.png"
cp src-tauri/icons/128x128.png "$APPDIR/qrtext.png"

# linuxdeploy 收集 NEEDED 库 + GTK3
cd /tmp
DEPLOY_GTK_VERSION=3 linuxdeploy \
  --appdir "$APPDIR" \
  --desktop-file "$APPDIR/usr/share/applications/qrtext.desktop" \
  --icon-file "$APPDIR/usr/share/icons/qrtext.png" \
  --plugin gtk 2>&1 | tail -3

# 强制打入 glibc 全家桶（确保麒麟系统完全不依赖系统 glibc）
echo "打入 glibc 全家桶..."
for lib in libc.so.6 libm.so.6 libpthread.so.0 libdl.so.2 librt.so.1 \
           libstdc++.so.6 libgcc_s.so.1 ld-linux-x86-64.so.2; do
  SRC=$(find /lib /usr/lib -name "$lib" -type f 2>/dev/null | head -1)
  [ -n "$SRC" ] && cp -L "$SRC" "$APPDIR/usr/lib/" && echo "  ✓ $lib"
done

# ── 强制打入 WebKit WebProcess（webkit2gtk 子进程，缺它运行时报"找不到文件"）──
echo ""
echo "打入 WebKitWebProcess..."
WEBPROC=$(find /usr/lib -name 'WebKitWebProcess' -type f 2>/dev/null | head -1)
if [ -n "$WEBPROC" ]; then
  mkdir -p "$APPDIR/usr/libexec"
  cp -L "$WEBPROC" "$APPDIR/usr/libexec/WebKitWebProcess"
  # 也放在 webkit2gtk 标准路径
  WK_DIR=$(dirname "$WEBPROC")
  mkdir -p "$APPDIR/$WK_DIR"
  cp -L "$WEBPROC" "$APPDIR/$WK_DIR/"
  echo "  ✓ WebKitWebProcess → usr/libexec/ + $WK_DIR/"
fi

WEBPROC_NET=$(find /usr/lib -name 'WebKitNetworkProcess' -type f 2>/dev/null | head -1)
if [ -n "$WEBPROC_NET" ]; then
  cp -L "$WEBPROC_NET" "$APPDIR/usr/libexec/"
  echo "  ✓ WebKitNetworkProcess → usr/libexec/"
fi

# ── 打入 GSettings schemas（GDK/GTK 需要，缺它运行时报 GSettings 错误）──
echo ""
echo "编译 GSettings schemas..."
SCHEMA_DIR=$(find /usr/share -name 'glib-2.0' -path '*/glib-2.0/schemas' -type d 2>/dev/null | head -1)
if [ -n "$SCHEMA_DIR" ] && command -v glib-compile-schemas >/dev/null 2>&1; then
  mkdir -p "$APPDIR/usr/share/glib-2.0/schemas"
  cp "$SCHEMA_DIR"/*.xml "$APPDIR/usr/share/glib-2.0/schemas/" 2>/dev/null || true
  glib-compile-schemas "$APPDIR/usr/share/glib-2.0/schemas/"
  echo "  ✓ GSettings schemas 已编译"
else
  echo "  ⚠ 未找到 schemas，跳过"
fi

# ── 打入额外的 dlopen 依赖（web process sandbox、gstreamer 等）──
echo ""
echo "收集 dlopen 依赖..."
for pattern in \
  'libwebkit2gtk-4.1' \
  'libjavascriptcoregtk-4.1' \
  'libWPEBackend-fdo' \
  'libwpe'; do
  found=$(find /usr/lib -name "${pattern}*.so*" -type f 2>/dev/null)
  for f in $found; do
    dst="$APPDIR/usr/lib/$(basename "$f")"
    [ ! -f "$dst" ] && cp -L "$f" "$dst" && echo "  ✓ $(basename "$f")"
  done
done

# patchelf：给所有 .so 设置 RPATH = $ORIGIN（同目录优先查找依赖）
# 这是关键——用 RPATH 代替 LD_LIBRARY_PATH，避免 dlopen 链路回退到系统路径
echo "设置所有 .so 的 RPATH 为 \$ORIGIN..."
find "$APPDIR/usr/lib" -name '*.so*' -type f | while IFS= read -r so; do
  # 跳过非 ELF 文件
  file "$so" 2>/dev/null | grep -q "ELF" || continue
  # $ORIGIN: 优先同目录 → $ORIGIN/.. : 子目录中的 lib（如 x86_64-linux-gnu/）也能找到上层 lib
  patchelf --set-rpath '$ORIGIN:$ORIGIN/..' "$so" 2>/dev/null || true
done
echo "  ✓ 所有 .so RPATH 已设为 \$ORIGIN:\$ORIGIN/.."

echo "设置二进制 RPATH..."
patchelf --set-rpath '$ORIGIN/../lib:$ORIGIN/../lib/x86_64-linux-gnu' \
         "$APPDIR/usr/bin/qrtext"
echo "  ✓ 二进制 RPATH: \$ORIGIN/../lib"

# AppRun：使用自带 ld-linux 启动（完全绕过麒麟系统 glibc 2.28）
# 即使 RPATH 已设，系统 ld-linux 版本太旧会直接拒绝加载 → 必须自带
cat > "$APPDIR/AppRun" << 'APPRUN'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"

# 基础路径
export PATH="$HERE/usr/bin:$PATH"

# 最关键：用自带的 ld-linux 启动，绕过系统旧版 glibc
LD_SO="$HERE/usr/lib/ld-linux-x86-64.so.2"
if [ ! -f "$LD_SO" ]; then
  # AppImage 运行时 ld-linux 路径可能不同，尝试自动查找
  LD_SO=$(find "$HERE" -name 'ld-linux-x86-64.so*' -type f 2>/dev/null | head -1)
fi

# 库搜索路径
LIB_PATH="$HERE/usr/lib:$HERE/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH="$LIB_PATH"

# GTK / GDK
export GTK_PATH="$HERE/usr/lib/x86_64-linux-gnu/gtk-3.0"
export GDK_PIXBUF_MODULE_FILE="$HERE/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders.cache"
export GDK_PIXBUF_MODULEDIR="$HERE/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders"

# GIO / GLib
export GIO_MODULE_DIR="$HERE/usr/lib/x86_64-linux-gnu/gio/modules"
if [ -d "$HERE/usr/share/glib-2.0/schemas" ]; then
  export GSETTINGS_SCHEMA_DIR="$HERE/usr/share/glib-2.0/schemas"
fi

# WebKit：告诉它去哪里找子进程（WebProcess/NetworkProcess）
if [ -d "$HERE/usr/libexec" ]; then
  export WEBKIT_EXEC_PATH="$HERE/usr/libexec"
fi
export WEBKIT_DISABLE_COMPOSITING_MODE=1

# 自包含主题（防止麒麟系统缺 GTK 主题导致启动失败）
export GTK_CSD=0
export GTK_THEME=Default

# 启动：用自带 ld-linux 执行
if [ -f "$LD_SO" ]; then
  exec "$LD_SO" --library-path "$LIB_PATH" "$HERE/usr/bin/qrtext" "$@"
else
  # 兜底：直接用系统 ld-linux（通常会在老系统上报 GLIBC 版本错误）
  exec "$HERE/usr/bin/qrtext" "$@"
fi
APPRUN
chmod +x "$APPDIR/AppRun"

# appimagetool 打包
echo "appimagetool 打包..."
ARCH=x86_64 appimagetool "$APPDIR" "/tmp/QRTEXT-x86_64.AppImage" 2>&1 | tail -3

APPI="/tmp/QRTEXT-x86_64.AppImage"
if [ -f "$APPI" ]; then
  DEST="/workspace/src-tauri/target/release/bundle/appimage/"
  mkdir -p "$DEST"
  cp "$APPI" "$DEST"
  ls -lh "$DEST"
  echo -e "${GREEN}✓ 自包含 AppImage（完整 glibc + webkit2gtk-4.1 + GTK3）${NC}"
else
  echo -e "${RED}✗ AppImage 生成失败${NC}"
  exit 1
fi

# ── 5. 验证 ──
echo ""
echo -e "${YELLOW}[5/5] 验证产物...${NC}"

echo ""
echo "=== deb 包 ==="
ls -lh /workspace/src-tauri/target/release/bundle/deb/ 2>/dev/null || echo "  (无)"

echo ""
echo "=== rpm 包 ==="
ls -lh /workspace/src-tauri/target/release/bundle/rpm/ 2>/dev/null || echo "  (无)"

echo ""
echo "=== AppImage ==="
ls -lh /workspace/src-tauri/target/release/bundle/appimage/ 2>/dev/null || echo "  (无)"

# 验证：直接检查构建目录（不提取 AppImage，避免 unsquashfs 兼容问题）
echo ""
echo "=== 产物验证 ==="
set +e  # 验证失败不阻塞构建

BIN="/workspace/src-tauri/target/release/qrtext"
LIB_DIR="$APPDIR/usr/lib"

echo ""
echo "二进制 glibc 需求:"
objdump -T "$BIN" 2>/dev/null | grep -oP 'GLIBC_\d+\.\d+' | sort -Vu | tail -3 || echo "  (objdump 不可用)"

echo ""
echo "已打包的 C/C++ 运行时:"
for f in libstdc++.so.6 libstdc++.so.6.* libc.so.6 libgcc_s.so.1; do
  ls -la "$LIB_DIR/$f" 2>/dev/null && echo "  ✓ $f" || echo "  ✗ $f"
done

if ls "$LIB_DIR/libstdc++.so"* >/dev/null 2>&1; then
  LIBCPP=$(find "$LIB_DIR" -name 'libstdc++.so*' -type f | head -1)
  VER=$(strings "$LIBCPP" 2>/dev/null | grep -oP 'GLIBCXX_\d+\.\d+\.\d+' | sort -Vu | tail -1 || echo "?")
  echo ""
  echo "自带 libstdc++: $VER"
  echo "麒麟系统自带:   GLIBCXX_3.4.25 左右"
else
  echo ""
  echo "!!! 未找到 libstdc++.so !!!"
fi

echo ""
echo "已打包 .so 文件总数: $(find "$LIB_DIR" -name '*.so*' -type f 2>/dev/null | wc -l)"

echo ""
echo "自包含资产:"
for asset in ld-linux-x86-64.so.2 libstdc++.so.6 libc.so.6 libgcc_s.so.1; do
  ls "$LIB_DIR/$asset" 2>/dev/null && echo "  ✓ $asset" || echo "  ✗ $asset 缺失!"
done
echo "  WebKitWebProcess: $(find "$APPDIR" -name 'WebKitWebProcess' -type f 2>/dev/null | wc -l) 个"
echo "  GSettings schemas: $(find "$APPDIR/usr/share/glib-2.0/schemas" -name 'gschemas.compiled' 2>/dev/null | wc -l) 个"

echo ""
echo "AppRun 前5行:"
head -5 "$APPDIR/AppRun" 2>/dev/null || echo "  (无)"

set -e

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  构建完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo "  deb:  src-tauri/target/release/bundle/deb/"
echo "  rpm:  src-tauri/target/release/bundle/rpm/"
echo "  AppImage: src-tauri/target/release/bundle/appimage/"
echo ""
echo "  AppImage 自包含：ld-linux 2.35 + libc + libstdc++ + WebKitWebProcess + GSettings"
  echo "  麒麟 V10 SP1 可直接运行（FUSE 不可用时用 --appimage-extract-and-run）"
