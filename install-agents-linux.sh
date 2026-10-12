#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  harness · agent CLI 一键安装（Linux：codex / omp / kimi / dsh）
#
#  在线：bash <(curl -fsSL https://github.com/Sutera-Diffusus/agent-harness/releases/download/v1.0.0/install-agents-linux.sh)
#  离线：把 agents/ 文件夹和这个脚本放一起，bash install-agents-linux.sh
# ═══════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"
mkdir -p ~/.local/bin /tmp/harness-agents
export PATH="$HOME/.local/bin:$PATH"

step() { echo ""; echo "==> $1"; }

step "codex（Linux musl 静态版）"
if [ -f agents/codex-x86_64-unknown-linux-musl.tar.gz ]; then
  tar -xzf agents/codex-x86_64-unknown-linux-musl.tar.gz -C /tmp/harness-agents
else
  curl -fsSL --retry 3 -o /tmp/harness-agents/codex.tar.gz "https://github.com/openai/codex/releases/download/rust-v0.162.1/codex-x86_64-unknown-linux-musl.tar.gz"
  tar -xzf /tmp/harness-agents/codex.tar.gz -C /tmp/harness-agents
fi
cp /tmp/harness-agents/codex-x86_64-unknown-linux-musl ~/.local/bin/codex

step "omp（Linux x64）"
if [ -f agents/omp-linux-x64 ]; then
  cp agents/omp-linux-x64 ~/.local/bin/omp
else
  curl -fsSL --retry 3 -o ~/.local/bin/omp "https://github.com/can1357/oh-my-pi/releases/download/v18.10.0/omp-linux-x64"
fi

step "kimi（Linux x64）"
rm -rf /tmp/harness-agents/kimi-x
if [ -f agents/kimi-1.52.0-x86_64-unknown-linux-gnu.tar.gz ]; then
  mkdir -p /tmp/harness-agents/kimi-x && tar -xzf agents/kimi-1.52.0-x86_64-unknown-linux-gnu.tar.gz -C /tmp/harness-agents/kimi-x
else
  curl -fsSL --retry 3 -o /tmp/harness-agents/kimi.tar.gz "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-x86_64-unknown-linux-gnu.tar.gz"
  mkdir -p /tmp/harness-agents/kimi-x && tar -xzf /tmp/harness-agents/kimi.tar.gz -C /tmp/harness-agents/kimi-x
fi
cp /tmp/harness-agents/kimi-x/kimi ~/.local/bin/kimi 2>/dev/null || cp /tmp/harness-agents/kimi-x/bin/kimi ~/.local/bin/kimi

chmod +x ~/.local/bin/codex ~/.local/bin/omp ~/.local/bin/kimi 2>/dev/null || true

step "dsh（npm 包，需 node + 网络）"
if command -v npm >/dev/null 2>&1; then
  npm config set registry https://registry.npmmirror.com 2>/dev/null || true
  npm i -g @deepseek-ai/dsh --prefix ~/.local 2>/dev/null && echo "    dsh 已装" || echo "    [跳过] dsh 需网络：npm i -g @deepseek-ai/dsh --prefix ~/.local"
else
  echo "    [跳过] dsh 需要 node/npm（跑过 setup-sv8.sh 就有）"
fi

grep -q 'local/bin' ~/.bashrc 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
[ -f ~/.zshrc ] && ! grep -q 'local/bin' ~/.zshrc && echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc || true

echo ""
echo "════════════════════════════════════════"
echo "  ✅ codex / omp / kimi → ~/.local/bin"
echo "  harness 重启后窗格里直接可选"
echo "════════════════════════════════════════"
