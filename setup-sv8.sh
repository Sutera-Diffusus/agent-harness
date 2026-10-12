#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  harness · SV8 一站式部署（裸 Ubuntu Server → 宫格终端全屏自启）
#
#  用法（SV8 上执行）：
#    bash <(curl -fsSL https://github.com/Sutera-Diffusus/agent-harness/releases/download/v1.0.0/setup-sv8.sh)
#
#  全流程：系统依赖 → XFCE 桌面+自动登录 → Node 22 → 字体 → 拉源码 → 装依赖 → 开机自启
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

TAG="v1.0.0"
REPO="Sutera-Diffusus/agent-harness"
WORK="$HOME/harness"

step() { echo ""; echo "==> [$1/7] $2"; }

step 1 "系统依赖（node-pty 编译 + Electron 运行库）"
sudo apt update -qq
sudo apt install -y -qq --no-install-recommends \
  build-essential python3 git curl ca-certificates unzip \
  libgtk-3-0 libnss3 libxss1 libxtst6 xauth \
  libasound2t64 2>/dev/null || sudo apt install -y -qq --no-install-recommends libasound2

step 2 "XFCE 轻桌面 + LightDM 自动登录"
sudo apt install -y -qq --no-install-recommends \
  xfce4 lightdm xorg fonts-noto-cjk fonts-noto-color-emoji
printf '[Seat:*]\nautologin-user=%s\nautologin-user-timeout=0\n' "$USER" \
  | sudo tee /etc/lightdm/lightdm.conf.d/50-autologin.conf > /dev/null

step 3 "Node.js 22"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y -qq nodejs
fi
echo "    node $(node -v)"

step 4 "Nerd Font（终端图标字体，失败不阻塞）"
mkdir -p ~/.local/share/fonts
if curl -fsSL --max-time 120 -o /tmp/nf.zip "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/CascadiaMono.zip" \
  && unzip -q -o -j /tmp/nf.zip "CaskaydiaMonoNerdFontMono-Regular.ttf" -d ~/.local/share/fonts/ 2>/dev/null; then
  fc-cache -f >/dev/null 2>&1 || true
  echo "    Nerd Font 已装"
else
  echo "    [跳过] 字体下载失败（omp 图标会显示为方框，不影响功能）"
fi

step 5 "拉取 harness 源码（GitHub $TAG）"
rm -rf /tmp/harness-src
mkdir -p /tmp/harness-src "$WORK"
curl -fsSL --retry 3 --max-time 300 -o /tmp/harness-src/src.zip \
  "https://github.com/$REPO/archive/refs/tags/$TAG.zip"
unzip -q -o /tmp/harness-src/src.zip -d /tmp/harness-src/
SRC_DIR=$(find /tmp/harness-src -maxdepth 1 -type d -name "agent-harness-*" | head -1)
cp -R "$SRC_DIR"/. "$WORK"/
cd "$WORK"

step 6 "安装依赖（npmmirror 镜像）"
npm config set registry https://registry.npmmirror.com
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install --no-audit --no-fund 2>&1 | tail -2

step 7 "开机自启（登录即全屏宫格）"
chmod +x start.sh
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/harness.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Harness
Comment=Multi-CLI grid console
Exec=$WORK/start.sh
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✅ 部署完成：$WORK"
echo ""
echo "  sudo reboot          ← 重启后自动登录、宫格全屏自启"
echo "  （UU远程连上就能看到）"
echo ""
echo "  不想重启想先看效果：  cd $WORK && npm start"
echo "════════════════════════════════════════════════════════"
