# Forge 上班交接 — 2026-10-16

> **当前候选：单工程自动接续，施工分支 `work/forge-autoresume-20261016`。**
> 基于 `9f77c05c`，首读 [projectforge-autoresume-mvp.md](projectforge-autoresume-mvp.md)。
> 异步网络已接通持久映射、正常Forge写门与自动检查点；本机冻结380/380。
> 正常可见施工工程 `pn0ma`；尚未真实跨设备验收或部署，PI实际进程尚未适配。
> 下方网络阶段“尚未接通”等描述是旧版历史，不作为当前实现结论。
> 本轮先保全开发源码与同版本复测，不替换常驻插件或业务库。
> **当前接续：认证网络库已完成限定范围验收。**
> 实现 `d69b76e0`，分支 `work/forge-network-20261016`；
> 首读 [projectforge-network-protocol.md](projectforge-network-protocol.md)。
> 公司网络专项39/39、文件级串行343/343；服务器同提交默认并行与串行各343/343。
> 公司Electron默认并行收尾异常仍未解决；未部署生产同步，异步网络尚未接通持久映射。
> 下一步复用现有Forge/ServerProjectForge，只拉通单工程自动检查点与安全换端接续，不再扩建平台。
> 家中可见工程 `pvui2` 接续公司 `p2ube`；工程ID/DB不随Git，不覆盖旧工作区或业务库。
> **后继：可信Hub内容与全局／本地映射内部闭环。**
> 实现提交 `b6f7abde`，分支 `work/forge-hub-content-20261016`。
> 本机两轮及服务器同Git版本均304/304，详见 [projectforge-content-sync-mvp.md](projectforge-content-sync-mvp.md)。
> 下文保留早期交接历史；未部署常驻服务、未启用真实业务库、未交付后台无感同步。

> **公司接续后继：availability门禁阶段。**
> 本页记录171d138a的原始交接，原134项和下一步为当时基线。
> 当前后继见 [projectforge-availability-mvp.md](projectforge-availability-mvp.md)：
> 公司旁侧工作树分支work/forge-availability-20261016，83项专项/235项Forge回归已通过。
> 新版Store会迁移本地库到schema4，旧schema3客户端不能混用同一库；未升级真实业务库或常驻插件。
> **无感跨机接续仍由系统自动触发，不依赖用户提醒或Agent主动提交**；
> 当前Git推送用于开发成果保全，并不表示自动同步服务已上线。

## 先读结论

交接分支：`origin/handoff/forge-takeover-20261016`。
基于个人主分支 `19e1283f273932dfc5d78a3b50f9d817b7c88627`，不是从独立恢复根历史直接合并。
本次是源码、测试和进度文档交接，**不是 Forge 工程数据库同步，也不是生产接管上线**。

三笔提交：
1. `26a11674d7d7eda23f8e68439207212bad70b964`：四个内部库、四份测试及两份验收文档；
   与 accepted 快照 `b6085c798135d7b6e4b5e693783957583a1f1af4` 的十份文件逐字节一致。
2. `0ccb9fd684b8888f9477fac5de1471c8c057d2e5`：四份双宿主适配和十项补测；
   适配源码相对家中原文件只统一了 CRLF 为 LF，没有改动原工作区。
3. 当前文档提交：本交接说明，最终发布版本用远端分支及 `git rev-parse HEAD` 核对。

## 已完成与实际验证

| 模块 | 实现与边界 | 用例 |
|---|---|---:|
| `hubStore.js` | 全局身份、持久申请、单写者租约、fencing、版本 CAS；独立 SQLite，摘要不是内容存储 | 20 |
| `projectBundle.js` | 记录及引用快照保真、局部主键映射、事务导入、opt-in 幂等收据 | 26 |
| `worktreeMaterializer.js` | Windows 新目录发布、四态日志、残留保留、目录身份和字节复核 | 31 |
| `projectTakeover.js` | 元数据导入、发布任务与完成收据的持久恢复协调 | 27 |
| 既有 Forge/Capture | 旧功能回归 | 20 |
| 双宿主补测 | wrapped/flat initialize、静态工作区、停用/越界、插件内 fileKit | 10 |

本次隔离工作树对实现提交 `0ccb9fd6` 运行：
**134/134，通过；exit=0，fail/cancelled/skipped 均 0。**
测试执行的是交接工作树内源码；仅借用本机已安装依赖，没有 npm install/ci 或原生重建。
完整 TAP 在家中机：
`D:\VCP\Handoffs\Evidence\forge-handoff-20261016\tests-1792085050704\tests.tap`。
TAP SHA-256：
`adc767a7d95305f027f4e59fb5d26a7076e9e921173e5ee3a6d0e5e8ed608a568`。
这是上述关键回归，不是全仓测试或 GUI/真实跨设备业务验收。

此前服务器 Windows / Node 22.22.1、better-sqlite3 12.4.1 对同一核心实现完成 104/104，
不包含新增双宿主十项或前端服务集成二十项；两端用例重叠，不能相加算不同用例。
本次交接不部署服务器常驻插件、不启用现有业务工程库扩展。

## 公司电脑安全取回

公司 JOSHUASHEN-PC6 与家中 SHENBOJUN 的 D:\VCP 是两份独立目录。
公司旧工作区可能保留同名未跟踪文件、旧文档和未提交改动。
**不要直接 pull/切分支覆盖旧现场，更不要 reset --hard 或 clean。**

先看状态、fetch，再把交接分支放到旁边的新目录：

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'D:\VCP\VCPChat'
$wt = 'D:\VCP\VCPChat-ForgeSync'
git -C $repo status --short
git -C $repo -c http.connectTimeout=10 -c http.lowSpeedLimit=1 -c http.lowSpeedTime=20 fetch --no-tags origin refs/heads/handoff/forge-takeover-20261016:refs/remotes/origin/handoff/forge-takeover-20261016
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed' }
if (Test-Path -LiteralPath $wt) { throw 'Target exists: inspect before reuse' }
git -C $repo worktree add -b work/forge-takeover-20261016 $wt origin/handoff/forge-takeover-20261016
if ($LASTEXITCODE -ne 0) { throw 'Worktree creation failed: inspect branch/path' }
git -C $wt rev-parse HEAD
git -C $wt status --short
Get-Content -LiteralPath "$wt\docs\projectforge-handoff-20261016.md"
```

若本地 `work/forge-takeover-20261016` 已存在，检查它的提交和对应工作树，不要强制重建。
取回后核对远端分支哈希与本次交接回执/日记所记最终提交。
工作机旧文件仅用于差异审查；尤其旧 projectBundle.js 不应覆盖新版收据实现。
没有必要重新从聊天拷贝源码、Git bundle 或恢复旧本机工程 ID。

## 在新工作树复测

确认旧仓库 node_modules 对应同一 package-lock 和其 Electron ABI 后，可仅借用本机依赖。
**不要跨机复制 node_modules，也不要为跑测试覆盖运行中客户端的原生模块。**
依赖不匹配时停止并安排独立安装环境，不在当前聊天进程下盲目 npm ci。

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'D:\VCP\VCPChat'
$wt = 'D:\VCP\VCPChat-ForgeSync'
git -C $wt diff --exit-code origin/personal/main -- package.json package-lock.json
if ($LASTEXITCODE -ne 0) { throw 'Dependency manifest differs: inspect before reusing dependencies' }
if (-not (Test-Path -LiteralPath "$repo\node_modules\electron\dist\electron.exe")) { throw 'Missing local Electron runtime' }
if (-not (Test-Path -LiteralPath "$wt\node_modules")) {
    New-Item -ItemType Junction -Path "$wt\node_modules" -Target "$repo\node_modules" | Out-Null
}
$tap = Join-Path $env:TEMP ('forge-handoff-' + [guid]::NewGuid().ToString('N') + '.tap')
$old = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $tests = @(
        'tests/project-forge-takeover.test.js',
        'tests/project-forge-materializer.test.js',
        'tests/project-forge-bundle.test.js',
        'tests/project-forge-hub.test.js',
        'tests/project-forge-capture.test.js',
        'tests/project-forge.test.js',
        'tests/project-forge-host-compat.test.js'
    )
    $p = Start-Process -FilePath "$repo\node_modules\electron\dist\electron.exe" -WorkingDirectory $wt `
        -ArgumentList (@('--test', '--test-reporter=tap', "--test-reporter-destination=$tap") + $tests) `
        -Wait -PassThru
    if (-not (Test-Path -LiteralPath $tap)) { throw 'No TAP evidence' }
    $text = [System.IO.File]::ReadAllText($tap)
    Get-Content -LiteralPath $tap -Tail 10
    if ($p.ExitCode -ne 0 -or $text -notmatch '(?m)^# tests 134\r?$' -or
        $text -notmatch '(?m)^# pass 134\r?$' -or $text -notmatch '(?m)^# fail 0\r?$' -or
        $text -notmatch '(?m)^# cancelled 0\r?$' -or $text -notmatch '(?m)^# skipped 0\r?$') {
        throw "Verification failed; inspect $tap"
    }
} finally {
    if ($null -eq $old) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $old }
}
```

Windows GUI 程序直接调用可能过早返回；以显式等待子进程和落盘 TAP 为准，不能只看旧 LASTEXITCODE。
junction 是本机临时依赖连接，不提交它。若已存在 node_modules，先确认指向及依赖，不自动替换。

## 明天从哪里继续

**第一优先：专用 availability 状态与所有入口守卫。**

当前 pending 暂借 deleted_at/deleted_by 隐藏：
- 普通 RestoreProjects 仍可解除隐藏；协调器只能检测 IMPORT_DRIFT，不能阻止提前暴露。
- includeDeleted/GUI、编辑、恢复、删除、purge 等入口未统一接入接管状态守卫。
- 收据外键 ON DELETE RESTRICT 连 complete 工程也暂阻止 purge。
- 取消、清理与保留期策略尚无生产实现。

在解决这些问题之前，不新增生产 Import/Takeover 命令，
不对既有工程库构造 ProjectTakeover，不把“库级测试通过”当成业务可上线。

后续顺序：
1. availability 模型、全入口守卫和兼容迁移，先临时库测试；
2. Hub 可信 bundle 内容存储与全局本地映射；
3. 认证网络接口、租约写入口、心跳及失租停止；
4. 真实跨设备业务工程交接验收；
5. 最后才是多 Agent 自动派工。

详见 `projectforge-takeover-mvp.md` 与 `projectforge-materializer-mvp.md`。
之前工作机 Hub/bundle 两篇旧文档未进入本次恢复白名单；当前文档和源码为准。

## 明确没有同步的东西

- Forge 数据库、工程 ID、Todo 运行状态和施工批次不随本分支自动迁移。
  家中 accepted 工程 pycxv/pofyl 和发布工程 p2p8n 的 ID 不可直接拿到公司机调用。
  公司新建本机施工工程，引用本交接说明；继续开发时显式指向新工作树。
- 当前运行中的 VCPChat 仍使用旧源码根目录，创建 Git worktree 不会自动切换插件加载路径。
  要让 Forge 操作新工作树，登记独立工作区或采用经授权的新工程根；不要误改旧 D:\VCP\VCPChat。
- Provider 密钥、config.env、PI 配置/会话、检查点、运行时依赖、数据库、日志、备份均不入库。
- 服务器 PI v5 驱动仍为服务器部署物，不包含在本交接分支，不能声称已同步到公司端。
- 家中原工作区保持 personal/main=19e1283f，七处原有修改及新增核心文件保留；
  四份适配已发布不代表原脏工作区被清理，切勿明天无审查重复提交。
- 发布只针对 handoff 分支，不合入、不推送 personal/main，不额外合并 upstream。

## 家中留存位置

- 发布工作树：`D:\VCP\Handoffs\VCPChat-Forge-20261016`
- 原工作区保护清单、索引与七份原件、TAP：
  `D:\VCP\Handoffs\Evidence\forge-handoff-20261016`
- 原 accepted 备份引用：`refs/backups/forge-takeover-accepted-20261016`
- 隔离恢复提交链：f23c4512 → 243e169c → 78aa37da → b6085c79；
  这些独立恢复提交不是交接分支的祖先，交接通过选择性原字节移植形成正常主分支后继。