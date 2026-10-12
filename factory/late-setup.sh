#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  SV8 出厂后部署脚本（系统装完首启自动跑，全程离线）
#  由 autoinstall late-commands 调用；也可手动 sudo bash late-setup.sh
# ═══════════════════════════════════════════════════════════════
set -e
export DEBIAN_FRONTEND=noninteractive
BUNDLE=/opt/sv8-bundle
HOME_U=/home/sv8

log() { echo "[late-setup] $1"; }

# ── 1. 电源：永不休眠（24/7 控制台） ──
log "电源策略"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

# ── 2. harness 组装（离线） ──
log "harness"
mkdir -p $HOME_U/harness/node_modules/electron
cp -r $BUNDLE/app/* $HOME_U/harness/
unzip -q -o $BUNDLE/electron-v33.2.0-linux-x64.zip -d $HOME_U/harness/node_modules/electron/dist
echo electron > $HOME_U/harness/node_modules/electron/path.txt
chmod +x $HOME_U/harness/node_modules/electron/dist/electron 2>/dev/null || true

# ── 3. agent CLI（离线） ──
log "agents"
mkdir -p $HOME_U/.local/bin /tmp/factory-ag
tar -xzf $BUNDLE/agents/codex-x86_64-unknown-linux-musl.tar.gz -C /tmp/factory-ag
cp /tmp/factory-ag/codex-x86_64-unknown-linux-musl $HOME_U/.local/bin/codex
cp $BUNDLE/agents/omp-linux-x64 $HOME_U/.local/bin/omp
mkdir -p /tmp/factory-ag/kimi-x
tar -xzf $BUNDLE/agents/kimi-1.52.0-x86_64-unknown-linux-gnu.tar.gz -C /tmp/factory-ag/kimi-x
cp /tmp/factory-ag/kimi-x/kimi $HOME_U/.local/bin/kimi 2>/dev/null || cp /tmp/factory-ag/kimi-x/bin/kimi $HOME_U/.local/bin/kimi
chmod +x $HOME_U/.local/bin/codex $HOME_U/.local/bin/omp $HOME_U/.local/bin/kimi 2>/dev/null || true

# PATH 持久化
for rc in $HOME_U/.bashrc $HOME_U/.zshrc; do
  [ -f "$rc" ] || touch "$rc"
  grep -q 'local/bin' "$rc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
done

# ── 4. harness 开机自启 ──
log "自启"
mkdir -p $HOME_U/.config/autostart
cat > $HOME_U/.config/autostart/harness.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Harness
Exec=$HOME_U/harness/node_modules/electron/dist/electron $HOME_U/harness --start-maximized
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

# ── 5. 归属修正 ──
chown -R sv8:sv8 $HOME_U

log "完成"
