import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyFastbootPatches } from "../patches/apply-patches.mjs";

// 禁用 Electron Node 运行时对 *.asar 路径的虚拟文件系统拦截，以便按普通二进制归档文件读写
process.noAsar = true;

const BACKUP_SUFFIX = ".pre-fastboot.bak";
const TMP_SUFFIX = ".fastboot.tmp";
const FASTBOOT_MARKER = 'Symbol.for("@deepseek-ai/dsh-app-boot/boot-slab")';
const ASAR_BLOCK_SIZE = 4194304;
const BOOT_APP_REL = "dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";

function calcIntegrity(buf) {
  const fullHash = createHash("sha256").update(buf).digest("hex");
  const blocks = [];
  if (buf.length === 0) {
    blocks.push(fullHash);
  } else {
    for (let i = 0; i < buf.length; i += ASAR_BLOCK_SIZE) {
      blocks.push(
        createHash("sha256")
          .update(buf.subarray(i, Math.min(i + ASAR_BLOCK_SIZE, buf.length)))
          .digest("hex")
      );
    }
  }
  return { algorithm: "SHA256", hash: fullHash, blockSize: ASAR_BLOCK_SIZE, blocks };
}

function parseAsar(asarPath) {
  const buf = readFileSync(asarPath);
  if (buf.length < 16) {
    throw new Error(`无效的 ASAR 文件: ${asarPath}`);
  }
  const headerObjLen = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  if (16 + jsonLen > buf.length) {
    throw new Error(`ASAR 头部损坏: ${asarPath}`);
  }
  const header = JSON.parse(buf.toString("utf8", 16, 16 + jsonLen));
  const dataStart = 8 + headerObjLen;

  const fileEntries = [];
  (function walk(node, prefix = "") {
    for (const [key, val] of Object.entries(node.files || {})) {
      const fp = prefix ? `${prefix}/${key}` : key;
      if (val.files) walk(val, fp);
      else fileEntries.push({ path: fp, node: val });
    }
  })(header);

  const entryMap = new Map(fileEntries.map((e) => [e.path, e.node]));

  function readBuffer(entryPath) {
    const node = entryMap.get(entryPath);
    if (!node || node.unpacked || node.link !== void 0 || node.offset === void 0) return null;
    const start = dataStart + Number(node.offset);
    return buf.subarray(start, start + node.size);
  }

  function readText(entryPath) {
    const slice = readBuffer(entryPath);
    return slice === null ? null : slice.toString("utf8");
  }

  return { buf, header, dataStart, fileEntries, entryMap, readBuffer, readText };
}

function inspectAsarState(asarPath) {
  const parsed = parseAsar(asarPath);
  let appVersion = "unknown";
  let dshVersion = "unknown";
  try {
    const rootPkg = JSON.parse(parsed.readText("package.json") || "{}");
    if (typeof rootPkg.version === "string") appVersion = rootPkg.version;
  } catch {}
  try {
    const dshPkg = JSON.parse(parsed.readText("dsh/package.json") || "{}");
    if (typeof dshPkg.version === "string") dshVersion = dshPkg.version;
  } catch {}
  const bootCode = parsed.readText(BOOT_APP_REL) || "";
  const isPatched = bootCode.includes(FASTBOOT_MARKER);
  return { parsed, appVersion, dshVersion, isPatched };
}

function normalizeCandidateRoot(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return null;
  let cur = resolve(rawPath.replace(/^"+|"+$/g, "").trim());
  if (!existsSync(cur)) return null;
  const lower = cur.toLowerCase();
  if (lower.endsWith("app.asar")) {
    const resDir = dirname(cur);
    cur = dirname(resDir);
  } else if (lower.endsWith("deepseek harness.exe")) {
    cur = dirname(cur);
  } else if (lower.endsWith("resources") && existsSync(join(cur, "app.asar"))) {
    cur = dirname(cur);
  }
  const exePath = join(cur, "DeepSeek Harness.exe");
  const asarPath = join(cur, "resources", "app.asar");
  if (existsSync(exePath) && existsSync(asarPath)) {
    return cur;
  }
  return null;
}

function querySystemCandidates() {
  if (process.platform !== "win32") return [];
  const candidates = [];
  const localAppData = process.env.LOCALAPPDATA || "";
  const progFiles = process.env.ProgramFiles || "C:\\Program Files";
  const progFiles86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  for (const base of [
    join(localAppData, "Programs", "DeepSeek Harness"),
    join(localAppData, "Programs", "DSH"),
    join(progFiles, "DeepSeek Harness"),
    join(progFiles86, "DeepSeek Harness"),
    dirname(process.execPath)
  ]) {
    const ok = normalizeCandidateRoot(base);
    if (ok) candidates.push(ok);
  }

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$out = New-Object System.Collections.Generic.List[string]
Get-Process -Name 'DeepSeek Harness' | ForEach-Object { if ($_.Path) { $out.Add((Split-Path $_.Path -Parent)) } }
$regPaths = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
foreach ($rp in $regPaths) {
  Get-ItemProperty $rp | Where-Object { $_.DisplayName -like '*DeepSeek*' -or $_.DisplayName -like '*DSH*' } | ForEach-Object {
    if ($_.InstallLocation) { $out.Add($_.InstallLocation) }
    if ($_.DisplayIcon) { $out.Add(($_.DisplayIcon -replace ',.*$','')) }
  }
}
$wsh = New-Object -ComObject WScript.Shell
$lnkRoots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'),
  (Join-Path ([Environment]::GetFolderPath('CommonStartMenu')) 'Programs')
)
foreach ($lr in $lnkRoots) {
  if ($lr -and (Test-Path $lr)) {
    Get-ChildItem -Path $lr -Filter '*.lnk' -Recurse | ForEach-Object {
      $sc = $wsh.CreateShortcut($_.FullName)
      if ($sc.TargetPath -like '*DeepSeek Harness.exe') { $out.Add($sc.TargetPath) }
    }
  }
}
Get-PSDrive -PSProvider FileSystem | ForEach-Object {
  foreach ($sub in @('DSH', 'DeepSeek Harness', 'Program Files\\DeepSeek Harness')) {
    $p = Join-Path $_.Root $sub
    if (Test-Path $p) { $out.Add($p) }
  }
}
$out | Select-Object -Unique | ForEach-Object { Write-Output $_ }
`;
  const res = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], {
    encoding: "utf8",
    windowsHide: true
  });
  if (res.status === 0 && res.stdout) {
    for (const line of res.stdout.split(/\r?\n/)) {
      const ok = normalizeCandidateRoot(line);
      if (ok) candidates.push(ok);
    }
  }
  return [...new Set(candidates.map((p) => p.toLowerCase()))].map((lower) =>
    candidates.find((p) => p.toLowerCase() === lower)
  );
}

function resolveInstallTarget(explicitDir) {
  if (explicitDir) {
    const normalized = normalizeCandidateRoot(explicitDir);
    if (!normalized) {
      throw new Error(`指定目录不是有效的 DeepSeek Harness 安装目录（需包含 DeepSeek Harness.exe 与 resources\\app.asar）: ${explicitDir}`);
    }
    return normalized;
  }
  const found = querySystemCandidates();
  if (found.length === 0) {
    throw new Error("未能自动找到 DeepSeek Harness 安装目录，请通过 --dir <安装路径> 参数指定，或将安装包根目录拖放至安装脚本。");
  }
  return found[0];
}

function findRunningProcesses(targetRoot) {
  if (process.platform !== "win32") return [];
  const ps = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
Get-Process -Name 'DeepSeek Harness' | ForEach-Object {
  if ($_.Path) { Write-Output "$($_.Id)|$($_.Path)" }
}
`;
  const res = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true
  });
  if (res.status !== 0 || !res.stdout) return [];
  const exeNorm = join(targetRoot, "DeepSeek Harness.exe").toLowerCase();
  const running = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf("|");
    if (sep < 0) continue;
    const pid = Number(trimmed.slice(0, sep));
    const exePath = trimmed.slice(sep + 1).trim();
    // 若通过 DeepSeek Harness.exe 以 ELECTRON_RUN_AS_NODE=1 运行本脚本自身，跳过自身与祖先检查以免误报占用
    if (pid === process.pid) continue;
    if (exePath.toLowerCase() === exeNorm) {
      running.push({ pid, exePath });
    }
  }
  return running;
}

function resolveDshCacheDir() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "cache");
}

function cleanRuntimeCaches() {
  const cacheDir = resolveDshCacheDir();
  const removed = [];
  for (const sub of ["boot-slab-v1", "boot-res-v1"]) {
    const full = join(cacheDir, sub);
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true });
      removed.push(full);
    }
  }
  return removed;
}

function writeAndVerifyAsar(parsed, replacements, outPath, checkExePath) {
  const packedEntries = parsed.fileEntries
    .filter((e) => !e.node.unpacked && e.node.link === void 0 && e.node.offset !== void 0)
    .sort((a, b) => Number(a.node.offset) - Number(b.node.offset));

  let newOffset = 0;
  const chunks = [];
  for (const entry of packedEntries) {
    const custom = replacements.get(entry.path);
    const data =
      custom !== void 0
        ? custom
        : parsed.buf.subarray(
            parsed.dataStart + Number(entry.node.offset),
            parsed.dataStart + Number(entry.node.offset) + entry.node.size
          );
    if (custom !== void 0) {
      entry.node.size = data.length;
      entry.node.integrity = calcIntegrity(data);
    }
    entry.node.offset = String(newOffset);
    newOffset += data.length;
    chunks.push(data);
  }

  const headerJson = JSON.stringify(parsed.header);
  const headerJsonBuf = Buffer.from(headerJson, "utf8");
  const headerPad = (4 - (headerJsonBuf.length % 4)) % 4;
  const headerPadded = headerPad ? Buffer.concat([headerJsonBuf, Buffer.alloc(headerPad, 0)]) : headerJsonBuf;

  const preHeader = Buffer.alloc(16);
  preHeader.writeUInt32LE(4, 0);
  preHeader.writeUInt32LE(8 + headerPadded.length, 4);
  preHeader.writeUInt32LE(4 + headerPadded.length, 8);
  preHeader.writeUInt32LE(headerJsonBuf.length, 12);

  const fd = openSync(outPath, "w");
  try {
    writeSync(fd, preHeader);
    writeSync(fd, headerPadded);
    for (const chunk of chunks) writeSync(fd, chunk);
  } finally {
    closeSync(fd);
  }

  // 全量回读新生成的 ASAR 核验每条哈希与长度
  const verified = parseAsar(outPath);
  const packedVerified = verified.fileEntries.filter(
    (e) => !e.node.unpacked && e.node.link === void 0 && e.node.offset !== void 0
  );
  if (packedVerified.length !== packedEntries.length) {
    throw new Error(`ASAR 完整性校验失败: 打包条目数不匹配 (${packedVerified.length} !== ${packedEntries.length})`);
  }
  for (const entry of packedVerified) {
    const start = verified.dataStart + Number(entry.node.offset);
    const slice = verified.buf.subarray(start, start + entry.node.size);
    if (slice.length !== entry.node.size) {
      throw new Error(`ASAR 长度不一致: ${entry.path}`);
    }
    if (entry.node.integrity?.hash) {
      const actualHash = createHash("sha256").update(slice).digest("hex");
      if (actualHash !== entry.node.integrity.hash) {
        throw new Error(`ASAR SHA-256 哈希不一致: ${entry.path}`);
      }
    }
  }

  // 使用目标客户端自带 V8 引擎检验全部修改模块的语法正确性
  const checkTmpDir = mkdtempSync(join(tmpdir(), "dsh-fastboot-chk-"));
  const chkEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete chkEnv.NODE_COMPILE_CACHE;
  try {
    let idx = 0;
    for (const [entryPath, modBuf] of replacements) {
      const tmpFile = join(checkTmpDir, `mod_${idx++}.mjs`);
      writeFileSync(tmpFile, modBuf);
      const r = spawnSync(checkExePath, ["--check", tmpFile], {
        env: chkEnv,
        encoding: "utf8",
        windowsHide: true
      });
      if (r.status !== 0) {
        throw new Error(`V8 语法校验失败 (${entryPath}):\n${r.stderr || r.stdout}`);
      }
    }
  } finally {
    try {
      rmSync(checkTmpDir, { recursive: true, force: true });
    } catch {}
  }

  return { totalFiles: verified.fileEntries.length, packedFiles: packedVerified.length, dataBytes: newOffset };
}

function cmdDiscover(flags) {
  const candidates = querySystemCandidates();
  const details = candidates.map((dir) => {
    const asarPath = join(dir, "resources", "app.asar");
    const bakPath = `${asarPath}${BACKUP_SUFFIX}`;
    const live = inspectAsarState(asarPath);
    let hasValidBackup = false;
    let backupVersion = null;
    if (existsSync(bakPath)) {
      try {
        const bak = inspectAsarState(bakPath);
        hasValidBackup = !bak.isPatched;
        backupVersion = bak.appVersion;
      } catch {}
    }
    return {
      installDir: dir,
      appVersion: live.appVersion,
      dshVersion: live.dshVersion,
      isPatched: live.isPatched,
      hasValidBackup,
      backupVersion,
      runningPids: findRunningProcesses(dir).map((p) => p.pid)
    };
  });
  if (flags.json) {
    console.log(JSON.stringify(details, null, 2));
  } else if (details.length === 0) {
    console.log("未自动扫描到 DeepSeek Harness 安装目录。");
  } else {
    for (const item of details) {
      console.log(`安装目录: ${item.installDir}`);
      console.log(`  版本: ${item.appVersion} | 状态: ${item.isPatched ? "已安装启动加速" : "官方原版"}`);
      console.log(`  原版备份: ${item.hasValidBackup ? `可用 (${item.backupVersion})` : "无"}`);
      console.log(`  运行中进程: ${item.runningPids.length > 0 ? item.runningPids.join(", ") : "无"}`);
    }
  }
}

function cmdInstall(flags) {
  const targetDir = resolveInstallTarget(flags.dir);
  const exePath = join(targetDir, "DeepSeek Harness.exe");
  const asarPath = join(targetDir, "resources", "app.asar");
  const bakPath = `${asarPath}${BACKUP_SUFFIX}`;
  const tmpPath = `${asarPath}${TMP_SUFFIX}`;

  if (!flags.dryRun && !flags.noCheckRunning) {
    const running = findRunningProcesses(targetDir);
    if (running.length > 0) {
      throw new Error(
        `检测到 DeepSeek Harness 正在运行中 (PID: ${running.map((r) => r.pid).join(", ")})。请先完全退出客户端含右下角托盘图标后再安装。`
      );
    }
  }

  const liveInfo = inspectAsarState(asarPath);
  console.log(`目标目录: ${targetDir}`);
  console.log(`当前客户端版本: ${liveInfo.appVersion} (dsh ${liveInfo.dshVersion})`);

  let baseSourcePath = asarPath;
  let baseInfo = liveInfo;

  if (liveInfo.isPatched) {
    if (!existsSync(bakPath)) {
      throw new Error(
        `当前 app.asar 已打过优化补丁且未找到原版备份文件 ${bakPath}，无法安全重装。请先覆盖恢复官方安装包。`
      );
    }
    const bakInfo = inspectAsarState(bakPath);
    if (bakInfo.isPatched) {
      throw new Error(`备份文件 ${bakPath} 自身已被修改，无法作为干净基线。`);
    }
    if (bakInfo.appVersion !== liveInfo.appVersion) {
      throw new Error(
        `当前版本 (${liveInfo.appVersion}) 与备份版本 (${bakInfo.appVersion}) 不一致，已终止以防版本错配。`
      );
    }
    if (!flags.reinstall) {
      console.log("检测到当前版本已安装启动加速补丁；如需重新构建请附加 --reinstall 参数。");
      return;
    }
    console.log(`使用已校验的同版本官方原版备份重装 (${bakInfo.appVersion})...`);
    baseSourcePath = bakPath;
    baseInfo = bakInfo;
  }

  console.log("正在校验核心补丁锚点与生成加速模块...");
  const replacements = applyFastbootPatches({
    listPaths: () => baseInfo.parsed.fileEntries.map((e) => e.path),
    readText: (p) => baseInfo.parsed.readText(p),
    log: (msg) => console.log(`  ${msg}`)
  });
  console.log(`锚点匹配与补丁生成完成，共改动 ${replacements.size} 个内部模块。`);

  if (flags.dryRun) {
    const sandboxTmp = mkdtempSync(join(tmpdir(), "dsh-fastboot-dry-"));
    try {
      const dryAsar = join(sandboxTmp, "app.asar");
      const stats = writeAndVerifyAsar(baseInfo.parsed, replacements, dryAsar, exePath);
      console.log(
        `[Dry-Run] 沙盒打包、全量 ${stats.packedFiles} 个文件 SHA-256 校验与 ${replacements.size} 模块 V8 语法检验全部通过，未修改原盘。`
      );
    } finally {
      try {
        rmSync(sandboxTmp, { recursive: true, force: true });
      } catch {}
    }
    return;
  }

  // 在修改原文件前，确保原始官方版安全落盘备份
  const needBackup =
    !existsSync(bakPath) ||
    (!liveInfo.isPatched &&
      (!inspectAsarStateSafe(bakPath) || !buffersEqualSha(liveInfo.parsed.buf, readFileSync(bakPath))));

  if (needBackup && !liveInfo.isPatched) {
    const bakTmp = `${bakPath}.tmp`;
    copyFileSync(asarPath, bakTmp);
    if (!buffersEqualSha(liveInfo.parsed.buf, readFileSync(bakTmp))) {
      try {
        rmSync(bakTmp, { force: true });
      } catch {}
      throw new Error(`创建原版备份失败，校验和不一致: ${bakPath}`);
    }
    if (existsSync(bakPath)) unlinkSync(bakPath);
    renameSync(bakTmp, bakPath);
    console.log(`已保存官方原版备份: ${bakPath}`);
  }

  try {
    const stats = writeAndVerifyAsar(baseInfo.parsed, replacements, tmpPath, exePath);
    console.log(
      `临时打包、全量 ${stats.packedFiles} 个条目 SHA-256 自检与 ${replacements.size} 模块 V8 语法检验全部通过。`
    );

    if (flags.stageOnly) {
      console.log(`已预生成校验完毕的临时镜像: ${tmpPath}`);
      return;
    }

    // 原子替换上线；若中途删除后 rename 失败立即从 bakPath 恢复
    try {
      if (existsSync(asarPath)) unlinkSync(asarPath);
      renameSync(tmpPath, asarPath);
    } catch (swapErr) {
      if (!existsSync(asarPath) && existsSync(bakPath)) {
        try {
          copyFileSync(bakPath, asarPath);
        } catch {}
      }
      throw new Error(`替换 app.asar 失败 (请确认没有其他程序占用该文件): ${swapErr.message}`);
    }
  } catch (err) {
    if (!flags.stageOnly && existsSync(tmpPath)) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {}
    }
    throw err;
  }

  if (!flags.keepCache) {
    const cleaned = cleanRuntimeCaches();
    if (cleaned.length > 0) {
      console.log(`已重置旧启动缓存目录，首次开启 DeepSeek Harness 时将在后台自动冷建新缓存池。`);
    }
  }

  console.log(`安装完成！已部署启动加速至: ${asarPath}`);
}

function inspectAsarStateSafe(p) {
  try {
    return !inspectAsarState(p).isPatched;
  } catch {
    return false;
  }
}

function buffersEqualSha(a, b) {
  if (a.length !== b.length) return false;
  return createHash("sha256").update(a).digest("hex") === createHash("sha256").update(b).digest("hex");
}

function cmdUninstall(flags) {
  const targetDir = resolveInstallTarget(flags.dir);
  const asarPath = join(targetDir, "resources", "app.asar");
  const bakPath = `${asarPath}${BACKUP_SUFFIX}`;

  if (!flags.noCheckRunning) {
    const running = findRunningProcesses(targetDir);
    if (running.length > 0) {
      throw new Error(
        `检测到 DeepSeek Harness 正在运行中 (PID: ${running.map((r) => r.pid).join(", ")})。请先完全退出客户端后再执行卸载恢复。`
      );
    }
  }

  const live = inspectAsarState(asarPath);
  if (!live.isPatched) {
    if (!flags.keepCache) {
      const cleaned = cleanRuntimeCaches();
      if (cleaned.length > 0) {
        console.log(`已清理启动加速缓存: ${cleaned.join(", ")}`);
      }
    }
    if (flags.removeBackup && existsSync(bakPath)) {
      rmSync(bakPath, { force: true });
    }
    console.log(`当前 ${asarPath} 已处于官方原版状态 (${live.appVersion})，无需还原。`);
    return;
  }

  if (!existsSync(bakPath)) {
    throw new Error(`未找到原版备份文件 ${bakPath}，请通过官方安装包覆盖修复。`);
  }

  const bakState = inspectAsarState(bakPath);
  if (bakState.isPatched) {
    throw new Error(`备份文件 ${bakPath} 自身带有修改标记，已拒绝覆盖还原。`);
  }
  if (bakState.appVersion !== live.appVersion) {
    throw new Error(
      `备份版本 (${bakState.appVersion}) 与当前版本 (${live.appVersion}) 不一致，已拒绝还原以防版本错配。`
    );
  }

  // 复制检验后再原子覆盖，确保原版文件完整无损
  const restoreTmp = `${asarPath}.restore.tmp`;
  copyFileSync(bakPath, restoreTmp);
  const verifiedHash = createHash("sha256").update(readFileSync(bakPath)).digest("hex");
  const copyHash = createHash("sha256").update(readFileSync(restoreTmp)).digest("hex");
  if (verifiedHash !== copyHash) {
    rmSync(restoreTmp, { force: true });
    throw new Error("备份副本校验和不一致，还原已取消。");
  }

  if (existsSync(asarPath)) unlinkSync(asarPath);
  renameSync(restoreTmp, asarPath);

  if (!flags.keepCache) {
    const cleaned = cleanRuntimeCaches();
    if (cleaned.length > 0) {
      console.log(`已清理启动加速缓存: ${cleaned.join(", ")}`);
    }
  }
  if (flags.removeBackup) {
    rmSync(bakPath, { force: true });
  }
  console.log(`已成功将 ${asarPath} 还原为官方原版 (${bakState.appVersion})。`);
}

function cmdStatus(flags) {
  const targetDir = resolveInstallTarget(flags.dir);
  const asarPath = join(targetDir, "resources", "app.asar");
  const bakPath = `${asarPath}${BACKUP_SUFFIX}`;
  const live = inspectAsarState(asarPath);
  const cacheDir = resolveDshCacheDir();
  console.log(`安装目录: ${targetDir}`);
  console.log(`程序版本: ${live.appVersion} (dsh ${live.dshVersion})`);
  console.log(`补丁状态: ${live.isPatched ? "已启用启动加速" : "官方原版未修改"}`);
  console.log(`原版备份: ${existsSync(bakPath) ? bakPath : "未创建"}`);
  console.log(`运行缓存目录 (${cacheDir}):`);
  for (const sub of ["boot-slab-v1", "boot-res-v1"]) {
    const p = join(cacheDir, sub);
    console.log(`  - ${sub}: ${existsSync(p) ? "存在" : "未生成"}`);
  }
}

function parseArgs(argv) {
  const flags = {
    cmd: null,
    dir: null,
    dryRun: false,
    reinstall: false,
    noCheckRunning: false,
    keepCache: false,
    stageOnly: false,
    removeBackup: false,
    json: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir" && i + 1 < argv.length) {
      flags.dir = argv[++i];
    } else if (arg.startsWith("--dir=")) {
      flags.dir = arg.slice(6);
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--reinstall") {
      flags.reinstall = true;
    } else if (arg === "--no-check-running") {
      flags.noCheckRunning = true;
    } else if (arg === "--keep-cache") {
      flags.keepCache = true;
    } else if (arg === "--stage-only") {
      flags.stageOnly = true;
    } else if (arg === "--remove-backup") {
      flags.removeBackup = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (!arg.startsWith("-") && !flags.cmd) {
      flags.cmd = arg;
    } else if (!arg.startsWith("-") && flags.cmd && !flags.dir) {
      flags.dir = arg;
    }
  }
  return flags;
}

const args = parseArgs(process.argv.slice(2));
try {
  switch (args.cmd) {
    case "discover":
      cmdDiscover(args);
      break;
    case "status":
      cmdStatus(args);
      break;
    case "install":
      cmdInstall(args);
      break;
    case "uninstall":
      cmdUninstall(args);
      break;
    default:
      console.log("用法: fastboot-cli.mjs <discover|status|install|uninstall> [--dir <路径>] [--reinstall] [--dry-run]");
      if (args.cmd) process.exitCode = 1;
  }
} catch (err) {
  console.error("错误:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
