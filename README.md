# DSH FastBoot — DeepSeek Harness 启动加速工具

中文 | [English](./README.en.md)

让 Windows 版 **DeepSeek Harness** 桌面客户端告别漫长启动等待的一键加速补丁。无需额外安装 Node.js 或其他运行环境，双击即可部署，自带同版本原版备份与完整校验门禁，可随时一键无损还原。

---

## 为什么会启动这么慢（通俗说明）

每次打开 DeepSeek Harness 时，后台会先加载主程序与各类插件。原版客户端在启动阶段要做两件非常耗时的事：

1. **反复翻找大量零碎小文件**：即便只安装了十几个扩展，系统也要顺着文件夹逐层定位，执行数千次文件探测与 `package.json` 读取，在机械硬盘或安全软件实时扫描环境下尤为卡顿。
2. **现场解析并编译代码**：每次冷启动都要将大量 JavaScript 模块重新解析、编译后才能进入就绪状态。

**本工具做的事情很纯粹**：
- 把散落的插件源码与预编译好的 V8 机器码打包成连续内存缓存池，后续启动整块映射进内存；
- 把目录探测与插件静态资源映射做成快照清单，省去成千上万次无效文件系统探测；
- 对已带内容版本哈希的插件前端资源放行浏览器磁盘缓存，降低重启后前端重复编译耗时；
- **不修改任何第三方插件源码，也不触碰你的账号、对话记录与个人配置。**

---

## 上手指南（普通用户）

### 环境要求
- Windows 10 / Windows 11 桌面版 DeepSeek Harness
- 适用官方版本：`0.2.2-rc.1` ～ `0.2.2-rc.5`（支持同系列小版本自适应锚点匹配）

### 一键安装加速
1. **彻底退出客户端**：关闭 DeepSeek Harness 窗口，确认右下角系统托盘图标也已完全退出。
2. **下载并解压本工具**：将压缩包解压至任意文件夹，路径支持中文、空格或括号。
3. **双击运行 `install.bat`**：
   - 脚本会自动搜索电脑中的 DeepSeek Harness 安装路径并开始核验部署；
   - 若搜索到多个安装目录，按屏幕提示输入序号选择；
   - 若客户端安装在非默认路径未被自动扫描到，可将桌面快捷方式或安装目录直接拖放到 `install.bat` 图标上或拖入终端窗口。
4. **两次启动看效果**：
   - 安装后**第 1 次**打开 DeepSeek Harness，客户端就绪后会先空闲退让数秒，随后在后台建立本机加速缓存池；
   - 从**第 2 次**正常启动开始，即可稳定享受缓存命中带来的启动提速。

> 提示：若客户端安装在 `C:\Program Files` 等系统受保护目录，脚本会主动提示是否以管理员身份提权继续。

### 一键卸载还原
1. 彻底退出 DeepSeek Harness 客户端与系统托盘图标。
2. 双击运行 `uninstall.bat`，工具会核对同版本原版备份以及解包目录一致性，将 `resources\app.asar` 还原为官方原版并清理运行缓存。

### 常见疑问
- **客户端官方自动更新或插件批量更新时会冲突吗？**
  - 客户端升级前会自动在安装目录生成同版本原版备份 `resources\app.asar.pre-fastboot.bak`。若官方自动更新覆盖了新版主程序，安装与还原工具均会先执行全量解包目录一致性核验，阻止旧备份跨版本写入，确认新版启动正常后重新运行 `install.bat` 即可刷新基准备份。
  - 在插件市场批量安装、升级或卸载插件时，运行期解析会自动跳过全局文件钩子、中止在途后台建池并清理过期缓存，避免与外部 `pnpm` 争抢 Windows 文件锁。
- **插件越多加速效果越明显吗？**
  是的。安装数十个扩展的用户在目录遍历、文件读取与 V8 编译阶段节省的耗时更加可观；插件自身激活逻辑发起的网络请求或业务计算耗时仍按原样保留，不能通过静态缓存跳过。

---

## 技术原理与工程实现（开发者参考）

本工具采用纯静态 AST 锚点补丁与运行时连续内存池方案，仓库内不含任何大体积官方二进制文件：

### 1. 四阶段优化与防护链路
- **阶段 A — 启动期 I/O 合并与冷逻辑后置**：消除冗余阻塞探测，将桌面 HMR、设置项描述、`dsh-client-hmr` 监控等非关键前置步骤推迟至首屏就绪之后，并监听 `app-boot/config-reload` 及时清理客户端元数据缓存，为 `dsh-hmr` 的 `compare()` 补充异步时钟校准完成前的同步兜底。
- **阶段 B — V8 Code Cache 与连续 Slab 内存池**：
  - 为 ASAR 内置模块生成 V8 `cachedData`（`asar-cc-*.bin`）；
  - 将扩展源码及其依赖树整合为连续二进制镜像与预编译字节码池（`ext-slab-*.bin`），启动时由 Worker 线程一次顺序读入 `SharedArrayBuffer`，配合 64 并发 `fs.promises.stat` 校对 `mtime` 与大小后零拷贝注入 Node CJS/ESM 加载链路；
  - 默认在 Host 就绪后空闲退让 4000 ms 再启动后台建池，并在 `writeSlabFile` 落盘时配合文件重试与二次元数据比对，避免并发写盘污染快照。
- **阶段 C — 运行期防竞态、主进程缓存与回环代理防护**：
  - `dsh-app-boot` 改用单遍补丁注入。当运行期插件变更调用 `computeLatestResolution()` 并传入快照旁路标记时，严格禁止再次挂载全局 `fs` 劫持钩子并优先清理易变缓存直读真实磁盘；
  - `recompose()` 触发时递增配置世代号、主动 `terminate()` 在途后台建池 Worker 并作废过期 `res-*.json` 快照，建池期间如遇世代变化则自动丢弃临时结果；
  - `lib/main.js` 自动为空或缺少回环地址的环境去重补齐 `NO_PROXY=127.0.0.1,localhost`，为 `authenticateWebHost` 增加短退避重试以抵御本地代理与瞬时握手抖动造成的 `ECONNRESET`；同时对包含 `?rev=` / `&rev=` 内容哈希且 Host 下发 `immutable` 的 `/plugins/` 响应放行缓存。
- **阶段 D — 零外部依赖自举与安全校验门禁**：
  - 引导脚本 `launcher.ps1` 直接复用目标安装目录自带的 `DeepSeek Harness.exe`（设置 `ELECTRON_RUN_AS_NODE=1` 并剥离负向 `NODE_COMPILE_CACHE` 干扰）驱动 CLI 引擎，在入口启用 `process.noAsar = true` 绕过 Electron ASAR VFS 拦截；
  - 安装、重装、`--dry-run` 与还原前均执行解包目录一致性校验，逐条核对 `app.asar` 内全部 `unpacked` 条目与磁盘 `resources\app.asar.unpacked` 的存在性及 SHA-256；
  - 打包新镜像强制检查总条目数与全量 SHA-256 一致性，并对全部修改模块执行 Electron 同源 V8 `--check` 语法检验；落盘替换采用带 Windows `EPERM`/`EBUSY` 退避重试与异常自动回补的原子替换逻辑，运行中进程检测会自动排除当前进程及其祖先进程 PID。

### 2. 项目目录结构
```text
dsh-fastboot/
├── install.bat                           # 一键安装入口（纯 ASCII，兼容中文/空格/括号路径）
├── uninstall.bat                         # 一键还原与清理入口
├── README.md                             # 中文说明文档
├── README.en.md                          # 英文说明文档
├── patches/
│   ├── apply-patches.mjs                 # 补丁编排总控（detectProfileBootPath / applyFastbootPatches）
│   └── modules/
│       ├── utils.mjs                     # 公共锚点替换与 ASAR 不可变路径判定工具
│       ├── dsh-app-boot.mjs              # 启动分辨率快照、全局 fs 加速、Slab 建池与运行期防竞态补丁
│       ├── dsh-desktop-host.mjs          # 宿主启动阶段切换、Slab 收尾与指标输出补丁
│       ├── main-js.mjs                   # 主进程回环 NO_PROXY、鉴权退避重试与带 rev 插件缓存放行补丁
│       ├── dsh-hmr.mjs                   # HMR 文件监控延迟、路径缓存与时钟校准兜底补丁
│       ├── dsh-config-editor.mjs         # 配置编辑与回滚后的缓存失效补丁
│       ├── dsh-settings.mjs              # 设置描述延迟计算与缓存补丁
│       ├── dsh-client-modules.mjs        # 客户端模块清单缓存与 config-reload 清理补丁
│       ├── dsh-client-hmr.mjs            # 客户端 HMR 启动后置与 ASAR 只读跳过补丁
│       ├── profile-boot.mjs              # Profile 启动阶段协同补丁
│       ├── cordis.mjs                    # Cordis 运行时解析优化补丁
│       └── cordis-plugin-loader.mjs      # 插件加载器并行化与路径缓存补丁
└── scripts/
    ├── launcher.ps1                      # 无外部 Node.js 依赖交互引导与进程/权限检查器
    └── fastboot-cli.mjs                  # ASAR 解析打包、解包一致性校验与 V8 安全校验核心引擎
```

### 3. 命令行与自动化参数
可直接通过 `install.bat` / `uninstall.bat` 传参，或使用目标目录下 Electron 运行时（设置 `ELECTRON_RUN_AS_NODE=1`）或本地 Node 22+ 执行 `scripts/fastboot-cli.mjs <discover|status|install|uninstall>`：

| 参数 | 适用入口 | 作用说明 |
| :--- | :--- | :--- |
| `--dir <路径>` / `--dir=<路径>` | `bat` / `CLI` | 指定安装目录、`DeepSeek Harness.exe`、`app.asar` 或 `.lnk` 快捷方式 |
| `--dry-run` | `bat` / `CLI` | 在临时目录执行解包核验、补丁注入、全量打包、SHA-256 校验与 V8 语法验证，不修改原盘 |
| `--reinstall` | `bat` / `CLI` | 已启用加速时，基于同版本 `.pre-fastboot.bak` 原版备份重新生成优化镜像 |
| `--stage-only` | `bat` / `CLI` | 仅生成并校验 `app.asar.fastboot.tmp` 暂存镜像，暂不替换现网文件 |
| `--keep-cache` | `bat` / `CLI` | 安装或卸载时保留用户目录 `.dsh\cache` 下的 `boot-slab-v1` 与 `boot-res-v1` |
| `--remove-backup` | `bat` / `CLI` | 卸载还原官方原版后一并删除 `.pre-fastboot.bak` 备份文件 |
| `--no-check-running` | `bat` / `CLI` | 跳过运行中的 `DeepSeek Harness.exe` 进程检查 |
| `--json` | `bat` / `CLI` | 配合 `discover` 输出 JSON 格式安装路径发现结果 |
| `--no-pause` | `install.bat` / `uninstall.bat` | 引导脚本结束后跳过按键暂停直接退出 |
| `--non-interactive` | `install.bat` / `uninstall.bat` | 无人值守模式，自动选定扫描路径且不交互阻塞 |

### 4. 运行时环境变量开关
如排查特定插件兼容性或调优后台建池时机，可通过环境变量细粒度控制，无需还原 `app.asar`：

- `DSH_FASTBOOT_DISABLE=1`：全局关闭加速补丁注入的所有运行时优化（包含主进程代理防护与缓存放行）
- `DSH_NO_BOOT_FS_CACHE=1`：禁用启动期 `fs` 劫持、目录与模块路径缓存
- `DSH_NO_RES_CACHE=1`：禁用插件分辨率快照缓存 `boot-res-v1`
- `DSH_DISABLE_SLAB=1`：禁用 V8 Code Cache 与扩展连续内存池加载
- `DSH_NO_SLAB_BUILD=1`：禁止后台生成新的 Slab 与 Code Cache 文件
- `DSH_SLAB_BUILD_DELAY_MS=<毫秒>`：自定义启动就绪后后台建池的空闲退让延迟（默认 `4000` 毫秒）
- `DSH_WAIT_SLAB_BUILD=1`：强制启动收尾阶段立即启动或同步等待后台建池完成
- `DSH_NO_PLUGIN_HTTP_CACHE=1`：恢复主进程对带 `?rev=` `/plugins/` 响应强制添加 `cache-control: no-store`
- `DSH_NO_LOOPBACK_NO_PROXY=1`：禁用主进程及子进程环境中的回环 `NO_PROXY` 自动补齐
- `DSH_KEEP_COMPILE_CACHE=1`：在主进程拉起 Node 子进程时保留外部传入的 `NODE_COMPILE_CACHE` 环境变量
- `DSH_BOOT_METRICS_OUT=<文件路径>`：将单次启动加载命中计数、Code Cache 拒绝数与耗时指标输出至 JSON 文件

### 5. 实测性能与基准探针数据（`0.2.2-rc.5`）
基于官方 `0.2.2-rc.5` 客户端（桌面 Profile 安装 `32` 个本地依赖包、共 `748` 条解析条目）的实测表现：

- **完整桌面端到端启动实测（含主窗口、插件加载与前端渲染缓存）**：
  - **官方原版未加速**：约 `30 s`
  - **安装补丁后首次启动（冷建缓存）**：约 `9 s`
  - **二次及后续热启动（缓存命中）**：约 `5 s`
- **无头宿主进程 `dsh-desktop-host` 探针实测**：
  - **官方原版基准**：IPC Ready `7048.4 ms` ～ `7691.4 ms`
  - **首次冷建缓存 (`cold-build`)**：IPC Ready `4541.2 ms`（Host 就绪 `4317.5 ms`），同时于后台生成 `asar-cc-*.bin`、`ext-slab-*.bin` 与 `res-*.json`
  - **热缓存连续命中 (`warm-slab`)**：IPC Ready `3613.3 ms` ～ `3703.1 ms`（Host 就绪 `3363.9 ms` ～ `3464.4 ms`），稳定命中 `2123` 个 ASAR 代码缓存（CJS `582` + ESM `1541`）与 `2058` 个扩展条目，`resSnapshotHit = 1`，`fallbackRej` 与 `fallbackSyntax` 均为 `0`
