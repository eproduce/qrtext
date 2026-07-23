#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  macOS 本地 Docker 构建
#  与 CI 完全相同的环境，产物直接出现在项目目录
#
#  前提：安装 Docker Desktop for Mac
#  用法：bash scripts/docker-build.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker &>/dev/null; then
  echo "错误：未安装 Docker，请先安装 Docker Desktop"
  echo "  https://www.docker.com/products/docker-desktop/"
  exit 1
fi

echo "构建 Docker 镜像..."
docker build --platform linux/amd64 -t qrtext-builder .

echo ""
echo "在容器中构建..."
docker run --rm \
  --platform linux/amd64 \
  -v "$PWD":/workspace \
  -v "$HOME/.cargo/registry:/root/.cargo/registry" \
  qrtext-builder

echo ""
echo "产物："
echo "  deb:  src-tauri/target/release/bundle/deb/"
echo "  rpm:  src-tauri/target/release/bundle/rpm/"
echo "  AppImage: src-tauri/target/release/bundle/appimage/"
