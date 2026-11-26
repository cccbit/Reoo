<div align="center">
  <img src="src/assets/reoo-icon.png" alt="Reoo Logo" width="96" height="96" />
  <h1>Reoo</h1>
  <p><strong>新一代极简、轻量化、原生速度的现代代码与文本编辑器</strong></p>
  <p>继承 Sublime Text 的极速响应、大文件秒开与 Hot Exit 灵魂，融合超越 Zed 的纯粹现代美学。</p>

  <p>
    <img src="https://img.shields.io/badge/Rust-2024_Edition-orange?style=flat-square&logo=rust" alt="Rust" />
    <img src="https://img.shields.io/badge/Tauri-v2-24C8D8?style=flat-square&logo=tauri" alt="Tauri v2" />
    <img src="https://img.shields.io/badge/SolidJS-1.9-2C4F7C?style=flat-square&logo=solid" alt="SolidJS" />
    <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License" />
  </p>
</div>

---

## 核心特性

- **极致轻量与瞬时启动**：基于 Rust + Tauri v2 + SolidJS，前端产物仅 **~30 KB gzip**，安装包不足 **10 MB**；首帧预热显示机制彻底消除黑屏闪烁，磁盘遍历与搜索全异步下沉后台线程。
- **Rope + Mmap 大文件引擎**：底层采用 B-Tree Rope（`ropey`）与零拷贝内存映射（`memmap2`），编辑与行寻址复杂度均为 $O(\log N)$；前端仅按视口渲染可见 50~80 行，轻松应对大文件流畅滚动。
- **完整多光标编辑体验**：原生支持 `Ctrl+D` 增量选词、`Alt+点击` 任意加光标、左键无缝跨行拖拽选择、双/三击选词选行，以及原子级多光标撤销与重做。
- **Ripgrep 同源极速搜索**：内置 `ignore` + `grep-searcher` 工作区并行搜索，同时提供当前文件高亮查找（`Ctrl+F`）与逐个/批量替换（`Ctrl+H`）。
- **无感退出恢复（Hot Exit）**：关闭软件无需弹窗确认，未保存草稿、光标位置、打开的工作区与个性化配置自动持久化并在下次启动瞬间恢复。
- **代码颜色内联预览与取色器**：自动识别代码中的 `#Hex`、`rgb()`、`hsl()`、`oklch()` 颜色字面量并在左侧显示辅助色块，点击即可呼出颜色选择器实时替换（完整支持 `Ctrl+Z` 撤销）。
- **现代极简视觉与个性化**：
  - 36px 一体化无边框顶栏，融合极简菜单（文件/编辑/选择/视图）、标签页与四合一毛玻璃命令中心。
  - 支持 **浅色 / 深色 / 跟随系统** 三态主题切换，内置 7 款 OKLCH 推荐主题色卡（默认科技蓝）。
  - 内置 **简体中文 / English** 双语界面切换。
- **多编码读写与系统集成**：支持 `UTF-8`、`UTF-8 with BOM`、`GB18030 (GBK)`、`UTF-16LE`、`UTF-16BE` 自动识别与「以编码保存」；Windows 平台支持在设置中一键注册系统资源管理器右键菜单（「用 Reoo 打开」）。

---

## 快捷键速查（对齐 VS Code）

| 快捷键 | 功能 |
| :--- | :--- |
| `Ctrl+P` | 快速打开工作区文件 |
| `Ctrl+Shift+P` / `F1` | 打开命令面板 (`>`) |
| `Ctrl+G` | 快速跳转行号 (`:`) |
| `Ctrl+N` / `Ctrl+O` | 新建文件（自动聚焦即可输入）/ 打开文件 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 另存为 |
| `Ctrl+W` | 关闭当前标签页 |
| `Ctrl+F` / `Ctrl+H` | 当前文件查找 / 查找并替换 |
| `Ctrl+Shift+F` | 工作区全局搜索 |
| `Ctrl+D` | 增量选中下一个相同词（多光标） |
| `Alt + 点击` | 添加独立光标 |
| `Ctrl+/` | 切换行注释 |
| `Shift+Alt+F` | 格式化文档 |
| `F12` | 转到定义 |
| `Shift+Alt+↓` / `Ctrl+Shift+K` | 向下复制行 / 删除当前行 |
| `Ctrl+B` / `Ctrl+,` | 切换侧边栏 / 打开设置 |

---

## 项目架构

采用「**重后端、薄前端、按视口传输**」的分层设计，Rust 核心引擎完全解耦于 UI，可独立进行单元测试与性能基准测试：

```text
├── crates/
│   ├── reoo-core/        # Ropey 文本缓冲区、多光标事务、Undo 栈、多编码读写、行级高亮与格式化
│   ├── reoo-search/      # 基于 ripgrep 内核的工作区并行检索与文件模糊索引
│   └── reoo-workspace/   # 目录懒加载与 Hot Exit 会话持久化
├── src-tauri/            # Tauri v2 桌面宿主、异步命令桥接与 Windows 右键菜单集成
└── src/                  # SolidJS 极薄虚拟化视口、Canvas 精准测宽、OKLCH 双主题与 i18n
```

---

## 本地开发与构建

### 环境要求

- [Rust](https://www.rust-lang.org/)（1.85+，支持 2024 Edition）
- [Node.js](https://nodejs.org/)（20+）与 [pnpm](https://pnpm.io/)（10+）
- Linux 构建需安装 Tauri v2 依赖（`libwebkit2gtk-4.1-dev`、`libappindicator3-dev`、`librsvg2-dev` 等）

### 运行与打包

```bash
# 安装前端依赖
pnpm install

# 启动桌面热重载开发模式
pnpm tauri dev

# 运行 Rust 核心单元测试
cargo test --workspace

# 构建原生发布版安装包
pnpm tauri build
```

---

## 自动发布各端安装包（GitHub Actions）

本仓库已内置 [.github/workflows/release.yml](.github/workflows/release.yml) 跨平台自动构建流水线，支持一键编译 **Windows (`.msi` / `.exe`)**、**macOS Apple Silicon & Intel (`.dmg`)** 与 **Linux (`.AppImage` / `.deb` / `.rpm`)**：

```bash
# 推送版本标签即可自动触发全平台打包并生成 GitHub Release 草稿
git tag v0.1.0
git push origin v0.1.0
```

也可以在 GitHub 仓库的 **Actions → Release Reoo → Run workflow** 中手动触发构建。

---

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。欢迎提交 Issue 与 Pull Request！
