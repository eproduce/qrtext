# GitHub Actions CI 专用构建容器
# 基于 ubuntu:20.04 → glibc 2.31 → 兼容麒麟 SP1 V10
# 此 Docker 仅运行在 GitHub 服务器上，本地不需要 Docker
FROM ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Shanghai

# 基础工具链 + Tauri 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates build-essential pkg-config \
    libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
    libsoup-3.0-dev libglib2.0-dev libssl-dev \
    file patchelf \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

# webkit2gtk-4.1（从 Ubuntu 22.04 拉取 deb）
RUN set -ex; \
    JWKIT_VER="2.48.1-0ubuntu0.22.04.1"; \
    BASE="http://archive.ubuntu.com/ubuntu/pool/universe/w/webkit2gtk"; \
    cd /tmp; \
    for pkg in \
      "libjavascriptcoregtk-4.1-0_${JWKIT_VER}_amd64.deb" \
      "libwebkit2gtk-4.1-0_${JWKIT_VER}_amd64.deb" \
      "libjavascriptcoregtk-4.1-dev_${JWKIT_VER}_amd64.deb" \
      "libwebkit2gtk-4.1-dev_${JWKIT_VER}_amd64.deb"; \
    do wget -q "${BASE}/${pkg}" && dpkg -i "$pkg" || true; done; \
    apt-get install -f -y --no-install-recommends; \
    pkg-config --exists webkit2gtk-4.1 && echo "✓ webkit2gtk-4.1 OK"; \
    rm -rf /tmp/*

WORKDIR /app
