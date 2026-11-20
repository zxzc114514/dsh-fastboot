# DSH FastBoot — DeepSeek Harness Startup Accelerator

[中文](./README.md) | English

A one-click startup acceleration patcher for the Windows **DeepSeek Harness** desktop client. It deploys without requiring a standalone Node.js installation, creates a same-version backup with full integrity verification gates, and supports lossless one-click rollback at any time.

---

## Why Startup Feels Slow (Plain Explanation)

Every time DeepSeek Harness starts, the desktop host loads the core runtime and all installed plugins. The stock client spends significant startup time on two tasks:

1. **Repeated probing across thousands of small files**: Even with roughly a dozen plugins installed, module resolution traverses nested folders and performs thousands of filesystem stats and `package.json` lookups, which slows down considerably on mechanical drives or under real-time antivirus scanning.
2. **On-the-fly JavaScript parsing and compilation**: Large numbers of JavaScript modules are parsed and compiled from scratch on every cold launch.

**What DSH FastBoot does**:
- Packs scattered plugin sources and precompiled V8 bytecode into contiguous cache files and maps them into memory on subsequent launches;
- Captures directory probes and extension resolution graphs as verified snapshots to eliminate redundant filesystem lookups;
- Allows Chromium disk and code caching for revision-hashed plugin frontend bundles instead of forcing `no-store`;
- **Never modifies any third-party plugin package itself, nor touches your account, conversation history, or personal configuration.**

---

## Quick Start (End Users)

### Requirements
- Windows 10 / Windows 11 desktop DeepSeek Harness
- Supported official builds: `0.2.2-rc.1` through `0.2.2-rc.5` (adaptive anchor matching across minor releases)

### One-Click Installation
1. **Exit the client completely**: Close all DeepSeek Harness windows and make sure the system tray icon has exited.
2. **Download and extract this repository**: Extract the archive into any folder (Unicode, spaces, and parentheses in paths are supported).
3. **Double-click `install.bat`**:
   - The launcher automatically scans common installation directories and begins verification and patching;
   - If multiple installations are found, pick the target number shown on screen;
   - If the client is installed in a custom location, drag the desktop shortcut or installation folder onto `install.bat` or into the prompt window.
4. **Verify over two launches**:
   - On the **1st launch** after patching, the host settles, backs off briefly, and builds local cache pools in the background;
   - Starting from the **2nd launch**, warm cache hits take effect automatically.

> Note: If DeepSeek Harness is installed under a protected directory such as `C:\Program Files`, the launcher prompts to elevate with Administrator privileges.

### One-Click Uninstall & Restore
1. Exit DeepSeek Harness completely, including its system tray icon.
2. Double-click `uninstall.bat`. The CLI verifies the same-version backup and unpacked asset consistency, restores `resources\app.asar` to the official baseline, and cleans up fastboot cache files.

### FAQ
- **What happens during official client upgrades or bulk plugin marketplace updates?**
  - Before modifying anything, the installer stores a baseline backup at `resources\app.asar.pre-fastboot.bak`. If an official auto-updater overwrites `app.asar` with a newer release, full unpacked asset consistency checks block stale backups from being mismatched across versions. Once the new release starts normally, run `install.bat` again to refresh the backup and re-apply patches.
  - During runtime plugin marketplace installs, upgrades, or removals, resolution computation automatically bypasses global filesystem hooks, cancels any in-flight background slab build worker, and invalidates stale snapshots so it never competes with external `pnpm` processes for Windows file locks.
- **Do users with more plugins benefit more?**
  Yes. Heavy plugin setups save noticeably more wall-clock time on file lookup, reading, and V8 compilation. Network requests or runtime initialization logic executed by a plugin's own activation handler remain unaffected and are not skipped by static caches.

---

## Technical Architecture & Engineering Details (Developers)

This project injects static AST-anchored patches and builds native runtime cache pools without bundling any large official binaries:

### 1. Four-Stage Optimization & Safety Pipeline
- **Stage A — Startup I/O Coalescing & Deferral of Cold Work**: Removes redundant blocking probes, defers non-critical desktop HMR inspection, settings descriptor building, and `dsh-client-hmr` watchers until after initial readiness, clears client source metadata caches on `app-boot/config-reload`, and adds a synchronous clock calibration fallback inside `dsh-hmr` `compare()`.
- **Stage B — V8 Code Cache & Contiguous Slab Pools**:
  - Generates V8 `cachedData` (`asar-cc-*.bin`) for immutable internal ASAR modules;
  - Bundles local extension sources and dependency trees alongside precompiled bytecode (`ext-slab-*.bin`), read sequentially by a Worker thread into a `SharedArrayBuffer` and validated via 64-concurrency `fs.promises.stat` checks on `mtime` and byte size before zero-copy injection into Node CJS/ESM loaders;
  - Backs off for 4000 ms by default after host readiness before background pool construction, using retry-safe renames and secondary `statSync` checks in `writeSlabFile` to prevent dirty writes.
- **Stage C — Runtime Anti-Race Protections, Main-Process Caching & Loopback Proxy Guard**:
  - `dsh-app-boot` uses a single-pass modular patch. When runtime plugin changes invoke `computeLatestResolution()` with snapshot bypass enabled, it clears volatile caches and reads real disk state without re-hooking global `fs`;
  - Every `recompose()` call increments a runtime epoch, terminates any pending `slabBuildWorker`, and clears obsolete `res-*.json` snapshots; if an epoch advances mid-build, temporary slab outputs are discarded;
  - `lib/main.js` deduplicates and ensures `NO_PROXY=127.0.0.1,localhost` across main and child environments, adds bounded backoff retries in `authenticateWebHost` to prevent proxy or handshake `ECONNRESET` failures, and preserves `immutable` caching on `/plugins/` responses carrying a `?rev=` / `&rev=` revision query.
- **Stage D — Zero-Dependency Bootstrap & Integrity Verification Gates**:
  - `launcher.ps1` reuses the target installation's own `DeepSeek Harness.exe` (with `ELECTRON_RUN_AS_NODE=1` and negative `NODE_COMPILE_CACHE` stripped) to run the CLI engine under `process.noAsar = true`;
  - Before install, reinstall, `--dry-run`, and uninstall, `verifyUnpackedConsistency()` verifies every `unpacked` entry listed in the ASAR header against `resources\app.asar.unpacked` on disk by existence and SHA-256;
  - Every newly built `app.asar` undergoes total entry-count verification, per-entry SHA-256 verification, and Electron V8 `--check` syntax validation before atomic replacement with Windows `EPERM`/`EBUSY` retry and automatic rollback on write failure. Running-process checks exclude the CLI process and all ancestor PIDs.

### 2. Repository Layout
```text
dsh-fastboot/
├── install.bat                           # One-click installer launcher (ASCII-safe)
├── uninstall.bat                         # One-click uninstaller and cache cleanup launcher
├── README.md                             # Chinese documentation
├── README.en.md                          # English documentation
├── patches/
│   ├── apply-patches.mjs                 # Patch orchestrator (detectProfileBootPath / applyFastbootPatches)
│   └── modules/
│       ├── utils.mjs                     # Shared replaceOnce & ASAR immutable path helper
│       ├── dsh-app-boot.mjs              # Resolution snapshots, boot fs accel, Slab pool & anti-race fixes
│       ├── dsh-desktop-host.mjs          # Boot phase transition, Slab finalization & metrics export
│       ├── main-js.mjs                   # Loopback NO_PROXY, auth retry & revisioned /plugins/ caching
│       ├── dsh-hmr.mjs                   # Deferred HMR observe, path caching & clock fallback
│       ├── dsh-config-editor.mjs         # Cache invalidation on config edit & rollback
│       ├── dsh-settings.mjs              # Deferred settings descriptor build & caching
│       ├── dsh-client-modules.mjs        # Client bundle manifest cache & config-reload invalidation
│       ├── dsh-client-hmr.mjs            # Deferred client HMR & ASAR immutability skip
│       ├── profile-boot.mjs              # Profile boot coordination patch
│       ├── cordis.mjs                    # Cordis runtime resolution optimization
│       └── cordis-plugin-loader.mjs      # Plugin loader concurrency & path cache
└── scripts/
    ├── launcher.ps1                      # Dependency-free interactive PowerShell launcher & elevation guard
    └── fastboot-cli.mjs                  # ASAR parser/packer, unpacked SHA-256 gate & V8 verifier
```

### 3. CLI Options & Automation Flags
Pass flags directly to `install.bat` / `uninstall.bat`, or invoke `scripts/fastboot-cli.mjs <discover|status|install|uninstall>` via the bundled Electron binary (`ELECTRON_RUN_AS_NODE=1`) or Node 22+:

| Flag | Scope | Description |
| :--- | :--- | :--- |
| `--dir <path>` / `--dir=<path>` | `bat` / `CLI` | Specify installation directory, `DeepSeek Harness.exe`, `app.asar`, or `.lnk` shortcut |
| `--dry-run` | `bat` / `CLI` | Run unpacked consistency checks, patch matching, sand-boxed packing, SHA-256 & V8 syntax checks without modifying disk files |
| `--reinstall` | `bat` / `CLI` | Rebuild patched `app.asar` from the verified same-version `.pre-fastboot.bak` backup |
| `--stage-only` | `bat` / `CLI` | Write and verify `app.asar.fastboot.tmp` without swapping the active `app.asar` |
| `--keep-cache` | `bat` / `CLI` | Preserve `boot-slab-v1` and `boot-res-v1` under user `.dsh\cache` during install or uninstall |
| `--remove-backup` | `bat` / `CLI` | Delete `.pre-fastboot.bak` after restoring the official baseline |
| `--no-check-running` | `bat` / `CLI` | Skip checking for running `DeepSeek Harness.exe` processes |
| `--json` | `bat` / `CLI` | Emit discovery results as JSON when using `discover` |
| `--no-pause` | `install.bat` / `uninstall.bat` | Exit immediately after launcher completion without waiting for a keypress |
| `--non-interactive` | `install.bat` / `uninstall.bat` | Unattended mode; auto-selects discovered target and skips interactive prompts |

### 4. Runtime Environment Variables
Fine-grained toggles let you disable individual layers for plugin compatibility troubleshooting without uninstalling the patch:

- `DSH_FASTBOOT_DISABLE=1`: Globally disables all injected runtime optimizations (including main-process proxy guard and `/plugins/` HTTP caching)
- `DSH_NO_BOOT_FS_CACHE=1`: Disables startup `fs` hooks, directory caches, and module path caches
- `DSH_NO_RES_CACHE=1`: Disables extension resolution snapshot caching (`boot-res-v1`)
- `DSH_DISABLE_SLAB=1`: Disables loading V8 Code Cache and contiguous extension Slab pools
- `DSH_NO_SLAB_BUILD=1`: Prevents background generation of new Slab and Code Cache files
- `DSH_SLAB_BUILD_DELAY_MS=<ms>`: Overrides post-ready idle backoff delay before starting background Slab build (default `4000` ms)
- `DSH_WAIT_SLAB_BUILD=1`: Starts/waits for Slab construction immediately at host readiness instead of backing off
- `DSH_NO_PLUGIN_HTTP_CACHE=1`: Restores forcing `cache-control: no-store` on `/plugins/` responses even when `?rev=` is present
- `DSH_NO_LOOPBACK_NO_PROXY=1`: Disables automatic loopback `NO_PROXY` injection in main and child environments
- `DSH_KEEP_COMPILE_CACHE=1`: Preserves external `NODE_COMPILE_CACHE` when spawning Node child processes from main process
- `DSH_BOOT_METRICS_OUT=<path>`: Writes per-launch hit counters, Code Cache rejection counts, and timing metrics to a JSON file

### 5. Real-World & Headless Benchmark Results (`0.2.2-rc.5`)
Measured on official `0.2.2-rc.5` with a desktop profile containing `32` installed dependency packages (`748` resolved package entries):

- **Full Desktop End-to-End Startup (including main window, plugin activation & frontend bundle cache)**:
  - **Stock unpatched client**: ~`30 s`
  - **1st launch after patching (cold cache build)**: ~`9 s`
  - **2nd and subsequent warm launches (cache hit)**: ~`5 s`
- **Headless Backend Probe (`dsh-desktop-host`)**:
  - **Stock official baseline**: IPC Ready `7048.4 ms` – `7691.4 ms`
  - **First cold cache build (`cold-build`)**: IPC Ready `4541.2 ms` (Host Ready `4317.5 ms`), generating `asar-cc-*.bin`, `ext-slab-*.bin`, and `res-*.json` in background
  - **Warm cache hits (`warm-slab`)**: IPC Ready `3613.3 ms` – `3703.1 ms` (Host Ready `3363.9 ms` – `3464.4 ms`), consistently hitting `2123` ASAR code cache entries (CJS `582` + ESM `1541`) and `2058` extension entries with `resSnapshotHit = 1`, `fallbackRej = 0`, and `fallbackSyntax = 0`
