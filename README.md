# DSH FastBoot — DeepSeek Harness 启动加速工具

让 Windows 版 **DeepSeek Harness** 桌面客户端告别漫长启动等待的一键加速补丁。无需安装 Node.js 或任何运行环境，双击即可部署，同时自带同版本原版备份，随时一键无损还原。

---

## 为什么会启动这么慢？（通俗版）

每次打开 DeepSeek Harness 时，后台会先加载主程序和各种插件。原版客户端在启动阶段要做两件非常耗时的事：

1. **反复翻找几千个零碎小文件**：哪怕只装了十几个扩展，系统也要顺着文件夹层层敲门，执行数千次文件检查与 `package.json` 定位，机械硬盘或杀毒软件实时扫描下会格外卡顿。
2. **现场翻译大量代码**：每次启动都要把大量 JavaScript 模块重新解析、编译一遍再运行。

**本工具做的事情很纯粹**：
- 把散落的插件源码和预编译好的 V8 机器码打包成一整块连续缓存文件，下次启动直接整块读进内存；
- 把文件夹扫描结果做成一次性清单快照，省去成千上万次无效翻目录；
- **完全不修改任何第三方插件本身，也不触碰你的账号、对话记录和配置数据。**

---

## 上手指南（普通用户）

### 环境要求
- Windows 10 / Windows 11 桌面版 DeepSeek Harness
- 推荐官方版本：`0.2.2-rc.1` ～ `0.2.2-rc.3`（支持同系列小版本自适应锚点匹配）

### 一键安装加速
1. **彻底退出客户端**：关闭 DeepSeek Harness 窗口，并确认右下角系统托盘图标也已完全退出。
2. **下载并解压本工具**：将压缩包解压到任意英文或中文文件夹。
3. **双击运行 `install.bat`**：
   - 脚本会自动搜索电脑里的 DeepSeek Harness 安装路径并开始部署；
   - 如果搜索到了多个安装目录，按提示输入数字选择即可；
   - 如果客户端装在非常规位置未被自动发现，直接把桌面快捷方式或安装文件夹拖到 `install.bat` 图标上松手，或者拖进弹出窗口即可。
4. **两次启动看效果**：
   - 安装后**第 1 次**打开 DeepSeek Harness 时，程序会在后台悄悄建立本机缓存池；
   - 从**第 2 次**正常启动开始，就能稳定体验到提速效果。

> 提示：如果客户端安装在 `C:\Program Files` 等系统受保护目录下，脚本会主动询问是否以管理员身份提权继续。

### 一键卸载还原
1. 彻底退出 DeepSeek Harness 客户端（含托盘图标）。
2. 双击运行 `uninstall.bat`，工具会核对原版备份的版本号与完整性，将 `resources\app.asar` 还原为官方原版并清理加速缓存。

### 常见疑问
- **会不会破坏客户端或被官方更新覆盖？**
  安装前会自动在安装目录生成一份原版备份 `resources\app.asar.pre-fastboot.bak`。如果日后 DeepSeek Harness 官方自动更新覆盖了新版主程序，原本的加速会恢复成官方新版的原版状态；确认新版本可正常启动后，再次双击 `install.bat` 即可刷新备份并重新注入加速。如果新版代码结构变动较大导致定位锚点失效，脚本会直接安全中止并保留原盘，绝不会写入半成品。
- **插件越多越有用吗？**
  是的。30 个甚至 100 个插件的重度用户，在文件检索、读取与 V8 代码编译上省下来的绝对时间会比轻量用户更多；不过插件激活函数本身发起的网络请求或业务逻辑计算耗时仍会保留，无法被静态缓存跳过。

---

## 技术原理与工程实现（开发者参考）

本工具采用纯静态补丁注入与运行时原生内存池方案，不包含任何官方大体积二进制包：

### 1. 四阶段核心优化链路
- **阶段 A — 启动期 I/O 合并与冷逻辑后置**：移除冗余阻塞探测，将高开销的桌面 HMR/设置描述、文件监控等非关键启动前置步骤延迟至首屏就绪后执行，消除不必要的同步写盘行为。
- **阶段 B — V8 Code Cache 与连续 Slab 内存池**：
  - 将客户端内部模块预编译为 V8 `cachedData`（`asar-cc-*.bin`）；
  - 将本地已安装扩展及其依赖树合并打包进连续二进制镜像与预编译字节码池（`ext-slab-*.bin`），在启动时通过 Worker 线程以单次顺序读入 `SharedArrayBuffer`，并配合 **64 并发 `fs.promises.stat`** 核验所有纳管文件的 `mtime` 与体积，在保证热更新安全的前提下零拷贝注入 Node CJS/ESM 加载管线。
- **阶段 C — 模块边界与静态资源索引快照**：
  - 缓存 `package.json` 向上回溯边界、ESM 目录探针与 `node_modules` 解析结果；
  - 将插件静态资源映射序列化为 `res-*.json` 快照，通过基于路径写入序号（`resWriteSeq`）的一致性追踪防止并发写盘产生脏快照。
- **阶段 D — 零外部依赖自举与安全校验门禁**：
  - 引导层 `launcher.ps1` 直接复用目标安装目录自带的 `DeepSeek Harness.exe`（设置 `ELECTRON_RUN_AS_NODE=1` 且禁用 `NODE_COMPILE_CACHE` 干扰）运行 CLI 引擎，并在 JS 入口设置 `process.noAsar = true` 绕过 Electron ASAR VFS 拦截；
  - 新打包的 `app.asar` 在替换前强制执行**全量条目 SHA-256 逐一校验**与 **Electron 同源 V8 `--check` 语法检查**，校验通过后方原子替换上线。

### 2. 项目目录结构
```text
dsh-fastboot/
├── install.bat              # 一键安装入口（纯 ASCII，兼容中文/空格/括号路径）
├── uninstall.bat            # 一键还原与清理入口
├── README.md                # 使用与技术说明
├── patches/
│   └── apply-patches.mjs    # 自适应多锚点合并补丁生成器
└── scripts/
    ├── launcher.ps1         # 无 Node.js 依赖交互引导与进程/权限检查器
    └── fastboot-cli.mjs     # ASAR 解析、打包、全量 SHA-256 与 V8 校验核心引擎
```

### 3. 命令行与自动化参数
支持在终端向 `install.bat` 或 `uninstall.bat` 追加参数，亦支持直接使用 `node scripts/fastboot-cli.mjs <discover|status|install|uninstall>`：

| 参数 | 作用 |
| :--- | :--- |
| `--dir <路径>` | 指定安装目录、`DeepSeek Harness.exe`、`app.asar` 或 `.lnk` 快捷方式 |
| `--dry-run` | 仅在临时目录执行补丁匹配、全量打包、SHA-256 校验与 V8 语法验证，不修改原盘 |
| `--reinstall` | 已启用加速时，基于校验过的同版本 `.pre-fastboot.bak` 重新生成优化镜像 |
| `--stage-only` | 仅生成并校验 `app.asar.fastboot.tmp` 暂存镜像，暂不替换现网文件 |
| `--keep-cache` | 安装或卸载时不清理用户目录 `.dsh\cache` 下的 `boot-slab-v1` 与 `boot-res-v1` |
| `--remove-backup` | 卸载还原官方原版后一并删除 `.pre-fastboot.bak` 备份 |
| `--non-interactive` | 无人值守模式，跳过交互提示与结束按键等待 |

### 4. 运行时降级开关（环境变量）
如遇特定插件兼容排查需要，可通过环境变量细粒度关闭单层加速，无需立即还原镜像：

- `DSH_FASTBOOT_DISABLE=1`：全局关闭加速补丁注入的运行时优化
- `DSH_NO_BOOT_FS_CACHE=1`：禁用启动期目录与模块路径缓存
- `DSH_NO_RES_CACHE=1`：禁用插件静态资源索引快照
- `DSH_DISABLE_SLAB=1`：禁用 V8 Code Cache 与扩展连续内存池
- `DSH_BOOT_METRICS_OUT=<文件路径>`：将单次启动加载命中计数与耗时指标输出至 JSON 文件

### 5. 基准探针数据参考
基于官方 `0.2.2-rc.3` 桌面宿主进程 `dsh-desktop-host`（`16` 个扩展，系统页缓存已预热环境）进行的无头后端就绪测试参考数据：
- **关闭全部加速基准 (`fallback`)**：IPC Ready `7754.9 ms`（Host 就绪 `7499.8 ms`）
- **首次冷建缓存 (`cold-build`)**：IPC Ready `5968.1 ms`（Host 就绪 `5730 ms`），同时于后台完成 `asar-cc-*.bin`、`ext-slab-*.bin` 与 `res-*.json` 建池
- **热缓存连续命中 (`warm-slab`)**：IPC Ready `4463.5 ms` ～ `5237.6 ms`（Host 就绪 `4246.5 ms` ～ `5021 ms`），稳定命中 `2129` 个 ASAR 代码缓存与 `3317` 个扩展条目，`fallbackRej` 与 `fallbackSyntax` 均为 `0`

> 注：实际桌面端冷启动加速收益在冷磁盘 I/O 与多插件环境下会更加显著。
