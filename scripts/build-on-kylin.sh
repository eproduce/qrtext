#!/bin/bash
# ═══════════════════════════════════════════════
#  麒麟 SP1 V10 / 国产 Linux 本地构建脚本
#  直接在麒麟系统上运行此脚本即可构建 AppImage
# ═══════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  QRTEXT - 麒麟 SP1 V10 构建脚本${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""

# ── 1. 检测系统 ──
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "系统: $NAME $VERSION"
else
  echo -e "${YELLOW}⚠ 无法识别系统版本${NC}"
fi

ARCH=$(uname -m)
echo "架构: $ARCH"
echo ""

# ── 2. 安装系统依赖 ──
echo -e "${YELLOW}[1/4] 安装系统依赖...${NC}"
echo "  需要 sudo 权限，请输入密码："

sudo apt-get update

# 基础编译工具
sudo apt-get install -y --no-install-recommends \
  curl wget build-essential pkg-config \
  libssl-dev libdbus-1-dev

# ── webkit2gtk ──
# 麒麟 SP1 仓库中可能是 4.0 版本，先检测
if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  echo -e "  ${GREEN}✓ 系统已有 webkit2gtk-4.1${NC}"
  WEBKIT_VER="4.1"
elif pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
  echo -e "  ${YELLOW}⚠ 系统仅有 webkit2gtk-4.0，尝试安装 4.1...${NC}"
  WEBKIT_VER="4.0"

  # 尝试从 Ubuntu 22.04 源获取 webkit2gtk-4.1
  JWKIT_VER="2.48.1-0ubuntu0.22.04.1"
  JWKIT_BASE="http://archive.ubuntu.com/ubuntu/pool/universe/w/webkit2gtk"
  cd /tmp
  for pkg in \
    "libjavascriptcoregtk-4.1-0_${JWKIT_VER}_amd64.deb" \
    "libwebkit2gtk-4.1-0_${JWKIT_VER}_amd64.deb" \
    "libjavascriptcoregtk-4.1-dev_${JWKIT_VER}_amd64.deb" \
    "libwebkit2gtk-4.1-dev_${JWKIT_VER}_amd64.deb"; do
    wget -q "${JWKIT_BASE}/${pkg}" && sudo dpkg -i "$pkg" 2>/dev/null || echo "  跳过 $pkg"
  done
  sudo apt-get install -f -y --no-install-recommends
  cd -

  if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    echo -e "  ${GREEN}✓ webkit2gtk-4.1 安装成功${NC}"
    WEBKIT_VER="4.1"
  else
    echo -e "  ${RED}✗ webkit2gtk-4.1 安装失败${NC}"
    echo "  请手动执行："
    echo "    sudo add-apt-repository ppa:webkit-team/ppa"
    echo "    sudo apt update"
    echo "    sudo apt install libwebkit2gtk-4.1-dev"
    exit 1
  fi
else
  echo -e "  ${RED}✗ 未检测到任何 webkit2gtk！${NC}"
  echo "  请安装: sudo apt install libwebkit2gtk-4.1-dev"
  exit 1
fi

# GTK / 图形库依赖
sudo apt-get install -y --no-install-recommends \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libsoup-3.0-dev \
  libglib2.0-dev \
  patchelf file

echo -e "${GREEN}  ✓ 系统依赖安装完成${NC}"

# ── 3. 安装 Node.js（如果版本 < 18） ──
echo ""
echo -e "${YELLOW}[2/4] 检查 Node.js...${NC}"
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  echo "  当前 Node.js: $(node -v)"
  if [ "$NODE_VER" -lt 18 ]; then
    echo -e "  ${YELLOW}  版本过低，安装 Node.js 22...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
else
  echo "  未安装 Node.js，正在安装 Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo -e "${GREEN}  ✓ Node.js $(node -v)${NC}"

# ── 4. 安装 Rust ──
echo ""
echo -e "${YELLOW}[3/4] 检查 Rust...${NC}"
if command -v rustc &>/dev/null; then
  echo "  当前 Rust: $(rustc --version)"
else
  echo "  正在安装 Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
fi
echo -e "${GREEN}  ✓ Rust $(rustc --version)${NC}"

# ── 5. 构建项目 ──
echo ""
echo -e "${YELLOW}[4/4] 构建项目...${NC}"

cd "$(dirname "$0")"

echo "  安装 npm 依赖..."
npm ci

echo "  构建前端..."
npx vite build

echo "  构建 Tauri 应用（deb + AppImage）..."
npx tauri build --bundles deb,appimage

# ── 6. 验证 AppImage ──
echo ""
echo -e "${YELLOW}[验证] 检查构建产物...${NC}"

# 检查二进制是否存在
BIN="src-tauri/target/release/qrtext"
if [ -f "$BIN" ]; then
  echo -e "  ${GREEN}✓ 二进制文件: $BIN${NC}"
  echo "   大小: $(du -h "$BIN" | cut -f1)"
  # 检查动态链接依赖
  echo "   关键依赖:"
  ldd "$BIN" 2>/dev/null | grep -E "not found|webkit2gtk|gtk|glib|soup" || echo "    (ldd 检测完成)"
else
  echo -e "  ${RED}✗ 二进制文件未生成！编译可能失败。${NC}"
fi

# 检查 AppImage 内容
APPIMAGE=$(ls src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1)
if [ -n "$APPIMAGE" ]; then
  echo -e "  ${GREEN}✓ AppImage: $APPIMAGE${NC}"
  echo "   大小: $(du -h "$APPIMAGE" | cut -f1)"
  # 提取并检查 AppImage 内部结构
  echo "   检查 AppImage 内部二进制..."
  chmod +x "$APPIMAGE"
  "$APPIMAGE" --appimage-extract >/dev/null 2>&1 && \
    if [ -f squashfs-root/usr/bin/qrtext ]; then
      echo -e "    ${GREEN}✓ 内部二进制存在: squashfs-root/usr/bin/qrtext${NC}"
      echo "     大小: $(du -h squashfs-root/usr/bin/qrtext | cut -f1)"
    else
      echo -e "    ${RED}✗ AppImage 内部缺少二进制文件！${NC}"
      echo "     内容列表:"
      find squashfs-root/usr/bin/ -type f 2>/dev/null || echo "     (usr/bin/ 为空)"
    fi
    rm -rf squashfs-root
else
  echo -e "  ${RED}✗ AppImage 未生成！${NC}"
  echo "  请检查是否安装了 appimagetool:"
  echo "    wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
  echo "    chmod +x appimagetool-x86_64.AppImage"
  echo "    sudo mv appimagetool-x86_64.AppImage /usr/local/bin/appimagetool"
fi

# ── 结果 ──
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  构建完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
DEB=$(ls src-tauri/target/release/bundle/deb/*.deb 2>/dev/null | head -1)
APPIMAGE=$(ls src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1)

if [ -n "$DEB" ]; then
  echo "  .deb 安装包: $DEB"
  echo "  安装命令: sudo dpkg -i $DEB"
fi
if [ -n "$APPIMAGE" ]; then
  echo "  AppImage:     $APPIMAGE"
  echo "  运行命令: chmod +x $APPIMAGE && $APPIMAGE"
fi

echo ""
echo -e "${YELLOW}  提示：如果 AppImage 运行时提示缺少依赖，${NC}"
echo -e "${YELLOW}  可先安装 .deb 包（自动处理依赖），再使用 AppImage。${NC}"
