# harness

多 CLI 宫格工作台：一个 Electron 窗口承载 codex / omp / Kimi / shell 等真实终端会话。

**设计语言**：光与仪器——浅色毛玻璃 chrome（stylegrid 工艺）× 深色终端仪器区，两区对比。卡片式侧栏、仪表化 HUD、悬浮暗色 Dock。

## 界面结构

```
┌────────────────────────────────────────────────────────┐
│ ▣ HARNESS · ●3 运行 · ●1 待输入 · 四宫格 · 13:38:05     │ ← HUD
├────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│  │ Codex ⌁  │ │ omp   ⌁  │ │ PS (琥珀) │  ← 实时窗格   │
│  └──────────┘ └──────────┘ └──────────┘               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│  │ 空窗格＋  │ │ 空窗格＋  │ │ 空窗格＋  │  ← 点阵画布  │
│  └──────────┘ └──────────┘ └──────────┘               │
├────────────────────────────────────────────────────────┤
│      [⬜⬛⬛⬛] [+] [⌁广播] [●3运行] [?] [⚙]              │ ← 悬浮 Dock
└────────────────────────────────────────────────────────┘
左滑抽屉：项目树 / 作战台 / 额度圆环（Ctrl+Shift+B 呼出）
```

## 核心能力

- **HUD 信息条**：运行数 / 待输入数 / 布局 / 时钟，永远在视野里
- **窗格总览** `Ctrl+Tab`：所有窗格的实况卡片——品牌图标 + 状态 + **终端最后两行实时预览** + 输出量/时长
- **广播模式**：Dock 的 ⌁ 按钮——开启后输入同步到所有窗格（多 agent 并行操作）
- **活动波形**：每格标题栏内嵌实时输出波形
- **等待输入检测**：输出骤停 + 提示符结尾 → 琥珀色边框告警
- **侧栏抽屉**：项目树（目录→CLI 子行→恢复会话）/ 作战台 / 额度圆环三面板
- **额度圆环**：每供应商 5h/周/月/余额独立环，百分比环心 + 倒计时

## 快捷键

| 键 | 功能 |
|---|---|
| `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+Tab` | 窗格总览（实时预览卡） |
| `Ctrl+Shift+B` | 侧栏抽屉 |
| `Ctrl+1` … `6` | 聚焦第 N 格 |
| `Ctrl+Shift+Enter` | 新窗格 |
| `Ctrl+Shift+W` | 结束聚焦窗格 |
| `Ctrl+F` | 终端内搜索 |
| `Ctrl+D` | 显隐控制坞 |
| `Ctrl+,` / `Ctrl+/` | 设置 / 帮助 |

## 平台

- **Windows**：`npx electron .`
- **macOS（Intel / Apple Silicon 均可）**：
  ```
  xcode-select --install    # node-pty 编译需要
  npm install
  npx electron .
  ```
  macOS 特有适配：`hiddenInset` 红绿灯窗控 + 左侧留位、保留系统应用菜单（Cmd+Q）、zsh 终端候选。
  打包：`npm i -D electron-builder && npx electron-builder --mac zip`（配置见 `electron-builder.yml`；签名 dmg 需在 Mac 上执行）。
- **SV8（Ubuntu 26.04 + 显示器）**：`bash deploy-sv8.sh && sudo reboot`

## 图标来源

- 品牌真标：codex/kimi/deepseek/opencode 来自 lobehub 官方图标包；omp/PS/cmd 从各自 `.exe` 提取；bash = simple-icons
- UI 图标：lucide-static（31 个内联 SVG）
- 全部本地文件，运行时零网络依赖

## 核心设计

### 侧栏（轨道分栏）
- 左缘 46px 图标轨道：**项目** / **作战台** / **额度** 三面板切换
- 面板可折叠（轨道保留），`Ctrl+Shift+B` 切换
- 项目面板：搜索 + 类别过滤 + **项目树**（目录→各 CLI 子行，含恢复会话按钮）
- 作战台：实时窗格状态（工作中/待输入/运行中），等待输入自动置顶
- 额度面板：每供应商**圆环仪表**（5h/周/月/余额），全部窗口可见

### 悬浮 Dock
- 底部中央毛玻璃悬浮控制坞：布局切换（单窗/双列/四/六宫格图标）+ 新窗格 + 运行计数 + 帮助 + 设置
- `Ctrl+D` 隐藏/显示，隐藏后底部留小把手可点回

### 窗格
- 标题栏：真实品牌图标 + CLI 名 + **实时波形** + 状态 + 警告图标
- 顶部渐变带 = CLI 身份色
- 等待输入：琥珀色脉冲边框
- 拖拽标题栏换位、双击最大化、Ctrl+1~6 聚焦

### 真实图标
- codex/omp/Kimi/PowerShell/cmd → 从各自 `.exe` 提取的官方图标
- DSH/opencode/bash → simple-icons（deepseek/opencode/gnubash）
- UI 图标 → lucide-static（27 个内联 SVG）

## 快捷键

| 键 | 功能 |
|---|---|
| `Ctrl+Shift+P` | 命令面板 |
| `Ctrl+Shift+B` | 折叠 / 展开侧栏面板 |
| `Ctrl+1` … `6` | 聚焦第 N 个窗格 |
| `Ctrl+Shift+Enter` | 新窗格 |
| `Ctrl+Shift+W` | 结束聚焦窗格 |
| `Ctrl+F` | 终端内搜索 |
| `Ctrl+D` | 显示 / 隐藏控制坞 |
| `Ctrl+,` | 设置 |
| `Ctrl+/` | 快捷键帮助 |

## 数据源

| 内容 | 来源 |
|---|---|
| Codex 会话 | `~/.codex/sessions/**/rollout-*.jsonl` |
| omp 会话 | `~/.omp/agent/history.db`（python sqlite 桥） |
| DSH 会话 | `~/.dsh/sessions/` |
| 额度 | `~/.omp/agent/agent.db` → `usage_history` |
| git 分支 | `.git/HEAD` 实时读取 |

## 启动

```
npx electron .
```

## SV8 部署（Ubuntu Server 26.04 + 显示器）

```
bash deploy-sv8.sh
sudo reboot
```

所有图标/字体均为本地文件，无运行时网络依赖。
