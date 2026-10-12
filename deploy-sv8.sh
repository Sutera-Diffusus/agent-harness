#!/usr/bin/env bash
# SV8 harness 一键部署 —— Ubuntu Server 26.04 + 显示器方案
# 前提：SSD 到货装好系统后，把 agent-harness 目录拷到 SV8，然后：
#   bash deploy-sv8.sh
# 完成后重启，自动登录进 XFCE，自动打开宫格终端。
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> [1/6] 编译与运行依赖（node-pty 源码编译 + Electron 运行库）"
sudo apt update
sudo apt install -y --no-install-recommends \
  build-essential python3 git curl ca-certificates unzip \
  libgtk-3-0 libnss3 libxss1 libxtst6 xauth \
  libasound2t64 2>/dev/null || sudo apt install -y --no-install-recommends libasound2

echo "==> [2/6] XFCE 轻桌面 + LightDM 自动登录"
sudo apt install -y --no-install-recommends \
  xfce4 lightdm xorg fonts-noto-cjk fonts-noto-color-emoji
printf '[Seat:*]\nautologin-user=%s\nautologin-user-timeout=0\n' "$USER" \
  | sudo tee /etc/lightdm/lightdm.conf.d/50-autologin.conf > /dev/null

echo "==> [3/6] Node.js 22"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node -v

echo "==> [4/6] Nerd Font（消除终端图标豆腐块）"
mkdir -p ~/.local/share/fonts
FONT_URL="https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/CascadiaMono.zip"
if curl -fsSL --max-time 120 -o /tmp/cascadia-mono.zip "$FONT_URL"; then
  unzip -o -j /tmp/cascadia-mono.zip "CaskaydiaMonoNerdFontMono-Regular.ttf" -d ~/.local/share/fonts/ 2>/dev/null \
    || unzip -o /tmp/cascadia-mono.zip -d ~/.local/share/fonts/
  fc-cache -fv > /dev/null
  echo "    Nerd Font 已安装"
else
  echo "    [跳过] 字体下载失败，不影响功能（omp 图标会显示为方框）"
fi

echo "==> [5/6] harness 安装"
cd "$HARNESS_DIR"
npm config set registry https://registry.npmmirror.com
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install

echo "==> [6/6] 开机自启"
chmod +x "$HARNESS_DIR/start.sh"
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/harness.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Harness
Comment=Agent terminal grid
Exec=$HARNESS_DIR/start.sh
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

echo ""
echo "完成。执行 sudo reboot 后：自动登录 → XFCE → 宫格终端全屏自启。"
echo "如需手动启动：bash $HARNESS_DIR/start.sh"
