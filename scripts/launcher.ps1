# DeepSeek Harness 启动加速引导器 (无 Node.js 外部依赖)
# 通过目标客户端自带 Electron 运行时以 ELECTRON_RUN_AS_NODE=1 执行核心安装与卸载逻辑

$ErrorActionPreference = "Stop"

if ([Console]::IsOutputRedirected -or [Console]::IsErrorRedirected) {
  try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  } catch {}
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$CliScript = Join-Path $ScriptDir "fastboot-cli.mjs"
$PatchScript = Join-Path $RootDir "patches\apply-patches.mjs"

function Write-Info([string]$msg) {
  Write-Host $msg
}

function Write-Ok([string]$msg) {
  Write-Host $msg -ForegroundColor Green
}

function Write-Warn([string]$msg) {
  Write-Host $msg -ForegroundColor Yellow
}

function Write-Err([string]$msg) {
  if ([Console]::IsErrorRedirected) {
    [Console]::Error.WriteLine($msg)
  } else {
    Write-Host $msg -ForegroundColor Red
  }
}

function Show-Usage {
  Write-Info "用法:"
  Write-Info "  install.bat [安装目录或快捷方式] [--reinstall] [--dry-run] [--keep-cache] [--no-pause]"
  Write-Info "  uninstall.bat [安装目录或快捷方式] [--remove-backup] [--keep-cache] [--no-pause]"
  Write-Info ""
  Write-Info "说明:"
  Write-Info "  1. 直接双击 install.bat 或 uninstall.bat 将自动搜索本机 DeepSeek Harness 安装目录。"
  Write-Info "  2. 也可以把安装文件夹、DeepSeek Harness.exe、app.asar 或桌面快捷方式拖放到脚本图标上执行。"
  Write-Info "  3. 附加 --non-interactive 可在无人值守模式下跳过交互提示。"
}

function Resolve-TargetDir([string]$rawPath) {
  if ([string]::IsNullOrWhiteSpace($rawPath)) { return $null }
  $clean = $rawPath.Trim().Trim('"').Trim()
  if (-not $clean) { return $null }

  if ($clean.ToLower().EndsWith(".lnk") -and (Test-Path -LiteralPath $clean)) {
    try {
      $wsh = New-Object -ComObject WScript.Shell
      $sc = $wsh.CreateShortcut($clean)
      if ($sc.TargetPath) { $clean = $sc.TargetPath }
    } catch {}
  }

  try {
    $resolved = [System.IO.Path]::GetFullPath($clean)
  } catch {
    return $null
  }
  if (-not (Test-Path -LiteralPath $resolved)) { return $null }

  $lower = $resolved.ToLower()
  if ($lower.EndsWith("app.asar")) {
    $resolved = Split-Path -Parent (Split-Path -Parent $resolved)
  } elseif ($lower.EndsWith("deepseek harness.exe")) {
    $resolved = Split-Path -Parent $resolved
  } elseif ($lower.EndsWith("resources") -and (Test-Path -LiteralPath (Join-Path $resolved "app.asar"))) {
    $resolved = Split-Path -Parent $resolved
  }

  $exe = Join-Path $resolved "DeepSeek Harness.exe"
  $asar = Join-Path $resolved "resources\app.asar"
  if ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $asar)) {
    return $resolved
  }
  return $null
}

function Find-CandidateInstallDirs {
  $raw = New-Object System.Collections.Generic.List[string]

  foreach ($p in @(
    (Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness"),
    (Join-Path $env:LOCALAPPDATA "Programs\DSH"),
    (Join-Path $env:ProgramFiles "DeepSeek Harness"),
    (Join-Path ${env:ProgramFiles(x86)} "DeepSeek Harness")
  )) {
    if ($p) { $raw.Add($p) }
  }

  try {
    Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.Path) { $raw.Add($_.Path) }
    }
  } catch {}

  $regPaths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  foreach ($rp in $regPaths) {
    try {
      Get-ItemProperty $rp -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -like "*DeepSeek*" -or $_.DisplayName -like "*DSH*"
      } | ForEach-Object {
        if ($_.InstallLocation) { $raw.Add($_.InstallLocation) }
        if ($_.DisplayIcon) { $raw.Add(($_.DisplayIcon -replace ",.*$", "")) }
      }
    } catch {}
  }

  try {
    $wsh = New-Object -ComObject WScript.Shell
    $lnkRoots = @(
      [Environment]::GetFolderPath("Desktop"),
      [Environment]::GetFolderPath("CommonDesktopDirectory"),
      (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"),
      (Join-Path ([Environment]::GetFolderPath("CommonStartMenu")) "Programs")
    )
    foreach ($lr in $lnkRoots) {
      if ($lr -and (Test-Path -LiteralPath $lr)) {
        Get-ChildItem -LiteralPath $lr -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
          try {
            $sc = $wsh.CreateShortcut($_.FullName)
            if ($sc.TargetPath -like "*DeepSeek Harness.exe") {
              $raw.Add($sc.TargetPath)
            }
          } catch {}
        }
      }
    }
  } catch {}

  try {
    Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object {
      $_.Free -ne $null
    } | ForEach-Object {
      foreach ($sub in @(
        "DSH",
        "DeepSeek Harness",
        "Program Files\DeepSeek Harness",
        "Program Files (x86)\DeepSeek Harness",
        "Software\DeepSeek Harness",
        "Apps\DeepSeek Harness"
      )) {
        $cand = Join-Path $_.Root $sub
        if (Test-Path -LiteralPath $cand) { $raw.Add($cand) }
      }
    }
  } catch {}

  $seen = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)
  $result = New-Object System.Collections.Generic.List[string]
  foreach ($item in $raw) {
    $norm = Resolve-TargetDir $item
    if ($norm -and $seen.Add($norm)) {
      $result.Add($norm)
    }
  }
  return ,$result.ToArray()
}

function Get-RunningTargetPids([string]$installDir) {
  $exeNorm = (Join-Path $installDir "DeepSeek Harness.exe").ToLower()
  $pids = New-Object System.Collections.Generic.List[int]
  try {
    Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.Path -and $_.Path.ToLower() -eq $exeNorm) {
        $pids.Add([int]$_.Id)
      }
    }
  } catch {}
  return ,$pids.ToArray()
}

function Test-DirWritable([string]$dirPath) {
  $probe = Join-Path $dirPath (".fastboot-perm-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
  try {
    [System.IO.File]::WriteAllText($probe, "")
    [System.IO.File]::Delete($probe)
    return $true
  } catch {
    return $false
  }
}

function Test-IsAdministrator {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = [Security.Principal.WindowsPrincipal]$id
    return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Invoke-ElectronCli([string]$exePath, [string[]]$cliArgs) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exePath
  $quoted = foreach ($a in $cliArgs) {
    '"' + ($a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
  }
  $psi.Arguments = ($quoted -join " ")
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $psi.CreateNoWindow = $true
  $psi.Environment["ELECTRON_RUN_AS_NODE"] = "1"
  $psi.Environment.Remove("NODE_COMPILE_CACHE") | Out-Null

  $proc = [System.Diagnostics.Process]::Start($psi)
  $outTask = $proc.StandardOutput.ReadLineAsync()
  $errTask = $proc.StandardError.ReadLineAsync()

  while (-not $proc.HasExited -or $null -ne $outTask -or $null -ne $errTask) {
    $didWork = $false
    if ($null -ne $outTask -and $outTask.IsCompleted) {
      $line = $outTask.GetAwaiter().GetResult()
      if ($null -eq $line) {
        $outTask = $null
      } else {
        Write-Info $line
        $outTask = $proc.StandardOutput.ReadLineAsync()
      }
      $didWork = $true
    }
    if ($null -ne $errTask -and $errTask.IsCompleted) {
      $eline = $errTask.GetAwaiter().GetResult()
      if ($null -eq $eline) {
        $errTask = $null
      } else {
        Write-Err $eline
        $errTask = $proc.StandardError.ReadLineAsync()
      }
      $didWork = $true
    }
    if (-not $didWork) {
      if (-not $proc.HasExited) {
        $proc.WaitForExit(30) | Out-Null
      } else {
        Start-Sleep -Milliseconds 15
      }
    }
  }
  $proc.WaitForExit()
  return $proc.ExitCode
}

function Wait-FinishPrompt([bool]$noPause) {
  if ($noPause -or [Console]::IsInputRedirected) { return }
  Write-Info ""
  Write-Info "按任意键关闭此窗口..."
  try {
    [Console]::ReadKey($true) | Out-Null
  } catch {
    Read-Host "按回车键退出" | Out-Null
  }
}

$action = "install"
$rawArgs = @($args)
if ($rawArgs.Count -gt 0 -and $rawArgs[0] -in @("install", "uninstall", "status", "discover")) {
  $action = $rawArgs[0]
  if ($rawArgs.Count -gt 1) {
    $rawArgs = @($rawArgs[1..($rawArgs.Count - 1)])
  } else {
    $rawArgs = @()
  }
}

$explicitDir = $null
$reinstall = $false
$dryRun = $false
$stageOnly = $false
$noCheckRunning = $false
$keepCache = $false
$removeBackup = $false
$jsonOut = $false
$noPause = $false
$nonInteractive = $false
$showHelp = $false

for ($i = 0; $i -lt $rawArgs.Count; $i++) {
  $a = [string]$rawArgs[$i]
  if ($a -in @("--help", "-h", "/?")) {
    $showHelp = $true
  } elseif ($a -eq "--dir" -and ($i + 1) -lt $rawArgs.Count) {
    $i++
    $explicitDir = [string]$rawArgs[$i]
  } elseif ($a.StartsWith("--dir=")) {
    $explicitDir = $a.Substring(6)
  } elseif ($a -eq "--reinstall") {
    $reinstall = $true
  } elseif ($a -eq "--dry-run") {
    $dryRun = $true
  } elseif ($a -eq "--stage-only") {
    $stageOnly = $true
  } elseif ($a -eq "--no-check-running") {
    $noCheckRunning = $true
  } elseif ($a -eq "--keep-cache") {
    $keepCache = $true
  } elseif ($a -eq "--remove-backup") {
    $removeBackup = $true
  } elseif ($a -eq "--json") {
    $jsonOut = $true
  } elseif ($a -eq "--no-pause") {
    $noPause = $true
  } elseif ($a -eq "--non-interactive") {
    $nonInteractive = $true
    $noPause = $true
  } elseif (-not $a.StartsWith("-") -and [string]::IsNullOrEmpty($explicitDir)) {
    $explicitDir = $a
  }
}

if ($dryRun -or $jsonOut -or $showHelp -or [Console]::IsInputRedirected) {
  $nonInteractive = $true
}

if (-not $jsonOut) {
  Write-Info "============================================================"
  Write-Info "  DeepSeek Harness 启动加速工具"
  Write-Info "============================================================"
}

if ($showHelp) {
  Show-Usage
  exit 0
}

if (-not (Test-Path -LiteralPath $CliScript) -or -not (Test-Path -LiteralPath $PatchScript)) {
  Write-Err "错误: 发行包缺少核心文件 (fastboot-cli.mjs 或 apply-patches.mjs)，请重新完整解压全部目录后重试。"
  Wait-FinishPrompt $noPause
  exit 1
}

$targetDir = $null
if ($explicitDir) {
  $targetDir = Resolve-TargetDir $explicitDir
  if (-not $targetDir) {
    Write-Err "错误: 指定路径不是有效的 DeepSeek Harness 安装目录（需包含 DeepSeek Harness.exe 与 resources\app.asar）: $explicitDir"
    Wait-FinishPrompt $noPause
    exit 1
  }
} else {
  $candidates = Find-CandidateInstallDirs
  if ($candidates.Count -eq 1) {
    $targetDir = $candidates[0]
  } elseif ($candidates.Count -gt 1) {
    if ($nonInteractive) {
      $targetDir = $candidates[0]
    } else {
      Write-Info "扫描到多个 DeepSeek Harness 安装目录:"
      for ($idx = 0; $idx -lt $candidates.Count; $idx++) {
        Write-Info ("  [{0}] {1}" -f ($idx + 1), $candidates[$idx])
      }
      $pick = Read-Host "请输入要操作的序号并按回车 (直接回车默认选 1)"
      if ([string]::IsNullOrWhiteSpace($pick)) {
        $targetDir = $candidates[0]
      } elseif ($pick -match '^\d+$' -and [int]$pick -ge 1 -and [int]$pick -le $candidates.Count) {
        $targetDir = $candidates[[int]$pick - 1]
      } else {
        Write-Err "错误: 无效序号 $pick。"
        Wait-FinishPrompt $noPause
        exit 1
      }
    }
  } else {
    if ($nonInteractive) {
      Write-Err "错误: 未能自动扫描到 DeepSeek Harness 安装目录，请通过 --dir 参数指定安装路径。"
      Wait-FinishPrompt $noPause
      exit 1
    }
    Write-Warn "未能自动扫描到 DeepSeek Harness 安装目录。"
    while (-not $targetDir) {
      $inputPath = Read-Host "请将安装文件夹、DeepSeek Harness.exe 或桌面快捷方式拖入本窗口并按回车 (输入 Q 退出)"
      if ($inputPath -match '^[qQ]$') {
        exit 1
      }
      $targetDir = Resolve-TargetDir $inputPath
      if (-not $targetDir) {
        Write-Err "路径无效，请确认其中包含 DeepSeek Harness.exe 与 resources\app.asar。"
      }
    }
  }
}

$exePath = Join-Path $targetDir "DeepSeek Harness.exe"
$resDir = Join-Path $targetDir "resources"
$needWrite = ($action -eq "install" -and -not $dryRun) -or ($action -eq "uninstall")

if ($needWrite -and -not (Test-DirWritable $resDir)) {
  if (-not $nonInteractive -and -not (Test-IsAdministrator)) {
    Write-Warn "目标目录位于系统受保护位置，需要管理员权限才能写入: $resDir"
    $ans = Read-Host "是否以管理员权限重新运行以继续? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($ans) -or $ans -match '^[yY]$') {
      $relaunchArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $MyInvocation.MyCommand.Path, $action, "--dir", $targetDir)
      if ($reinstall) { $relaunchArgs += "--reinstall" }
      if ($keepCache) { $relaunchArgs += "--keep-cache" }
      if ($removeBackup) { $relaunchArgs += "--remove-backup" }
      if ($stageOnly) { $relaunchArgs += "--stage-only" }
      if ($noCheckRunning) { $relaunchArgs += "--no-check-running" }
      if ($noPause) { $relaunchArgs += "--no-pause" }
      try {
        $p = Start-Process -FilePath "powershell.exe" -ArgumentList $relaunchArgs -Verb RunAs -Wait -PassThru
        exit $p.ExitCode
      } catch {
        Write-Err "管理员授权已取消或启动失败: $($_.Exception.Message)"
        Wait-FinishPrompt $noPause
        exit 1
      }
    }
  }
  Write-Err "错误: 当前无权写入 $resDir，请关闭占用后右键以管理员身份运行本脚本。"
  Wait-FinishPrompt $noPause
  exit 1
}

if ($needWrite -and -not $noCheckRunning) {
  while ($true) {
    $running = Get-RunningTargetPids $targetDir
    if ($running.Count -eq 0) { break }
    Write-Warn ("检测到 DeepSeek Harness 正在运行中 (PID: {0})。" -f ($running -join ", "))
    if ($nonInteractive) {
      Write-Err "请先完全退出客户端含右下角托盘图标后再运行。"
      Wait-FinishPrompt $noPause
      exit 1
    }
    $waitAns = Read-Host "请完全退出客户端及托盘图标后按回车重试，或输入 Q 取消"
    if ($waitAns -match '^[qQ]$') {
      exit 1
    }
  }
}

$cliArgs = @($CliScript, $action, "--dir", $targetDir)
if ($reinstall) { $cliArgs += "--reinstall" }
if ($dryRun) { $cliArgs += "--dry-run" }
if ($stageOnly) { $cliArgs += "--stage-only" }
if ($noCheckRunning) { $cliArgs += "--no-check-running" }
if ($keepCache) { $cliArgs += "--keep-cache" }
if ($removeBackup) { $cliArgs += "--remove-backup" }
if ($jsonOut) { $cliArgs += "--json" }

if (-not $jsonOut) {
  Write-Info "正在通过目标客户端内置运行时执行操作 ($action)..."
}

$exitCode = Invoke-ElectronCli $exePath $cliArgs

if (-not $jsonOut) {
  Write-Info ""
  if ($exitCode -eq 0) {
    if ($action -eq "install" -and -not $dryRun -and -not $stageOnly) {
      Write-Ok "操作已完成。首次打开 DeepSeek Harness 时将在后台自动冷建启动缓存，通常第 2 次启动即可享受秒开体验。"
    } elseif ($action -eq "uninstall") {
      Write-Ok "已安全还原至官方原版镜像。"
    }
  } else {
    Write-Err "操作未能完成 (退出码: $exitCode)，原版文件未被破坏。"
  }
}

Wait-FinishPrompt $noPause
exit $exitCode
