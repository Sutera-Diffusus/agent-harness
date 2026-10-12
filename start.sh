#!/usr/bin/env bash
# harness 启动器：最大化窗口启动宫格终端
cd "$(dirname "${BASH_SOURCE[0]}")"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
exec npx electron . --start-maximized
