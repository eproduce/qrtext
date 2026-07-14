#!/bin/bash
# Docker 容器内构建脚本（ubuntu:20.04 / glibc 2.31）
set -e
export DEBIAN_FRONTEND=noninteractive TZ=Asia/Shanghai

echo "============================================"
echo "  QRTEXT 麒麟 SP1 V10 兼容构建"
echo "============================================"

# ── 1. 配置 apt 源 ──
# 依次尝试国内镜像
MIRRORS=(
  "aliyun|http://mirrors.aliyun.com/ubuntu|focal"
  "tsinghua|http://mirrors.tuna.tsinghua.edu.cn/ubuntu|focal"
  "ustc|http://mirrors.ustc.edu.cn/ubuntu|focal"
  "kylin|http://archive.kylinos.cn/kylin/KYLIN-ALL|10.1"
)

FOUND=0
for entry in "${MIRRORS[@]}"; do
  IFS='|' read -r name url code <<< "$entry"
  echo "→ 尝试镜像: $name ($code)"
  
  cat > /etc/apt/sources.list << EOF
deb [trusted=yes] ${url} ${code} main restricted universe multiverse
deb [trusted=yes] ${url} ${code}-updates main restricted universe multiverse
deb [trusted=yes] ${url} ${code}-security main restricted universe multiverse
EOF

  if apt-get update -o Acquire::Check-Valid-Until=false 2>&1 | tail -1; then
    if apt-cache show libgtk-3-dev >/dev/null 2>&1; then
      echo "  ✓ $name 可用"
      FOUND=1
      break
    fi
  fi
  echo "  ✗ $name 不可用"
done

if [ "$FOUND" = "0" ]; then
  echo "所有 focal 镜像不可用，切换到 jammy..."
  cat > /etc/apt/sources.list << EOF
deb [trusted=yes] http://archive.ubuntu.com/ubuntu jammy main restricted universe multiverse
deb [trusted=yes] http://archive.ubuntu.com/ubuntu jammy-updates main restricted universe multiverse
EOF
  apt-get update -o Acquire::Check-Valid-Until=false
fi

# ── 2. 安装依赖 ──
echo ""
echo "安装构建依赖..."
apt-get install -y --no-install-recommends \
  curl wget ca-certificates gnupg build-essential pkg-config \
  libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  libsoup-3.0-dev libglib2.0-dev libssl-dev \
  patchelf file

# ── 3. 验证 ──
echo ""
echo "=== glibc 版本 ==="
ldd --version | head -1

pkg-config --exists webkit2gtk-4.1 || { echo "✗ webkit2gtk-4.1 缺失"; exit 1; }
pkg-config --exists libsoup-3.0 || { echo "✗ libsoup-3.0 缺失"; exit 1; }
echo "✓ 系统依赖就绪"

# ── 4. Node.js 22 ──
echo ""
echo "安装 Node.js..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
echo "  Node.js $(node -v)"

# ── 5. Rust ──
echo ""
echo "安装 Rust..."
curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
. /root/.cargo/env
echo "  $(rustc --version)"

# ── 6. 构建 ──
cd /app
echo ""
echo "=== npm ci ==="
npm ci

echo ""
echo "=== vite build ==="
npx vite build

echo ""
echo "=== tauri build ==="
npx tauri build --bundles deb,appimage

# ── 7. 检查 ──
echo ""
echo "=== glibc 符号需求（必须 ≤ 2.31） ==="
objdump -T src-tauri/target/release/qrtext | grep -oP 'GLIBC_\K[0-9.]+' | sort -Vu | tail -5

echo ""
echo "============================================"
echo "  构建完成！"
echo "============================================"
