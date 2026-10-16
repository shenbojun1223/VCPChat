# Forge 单工程自动接续 MVP

基线：`9f77c05cc7aad67e65a4c7cae1d8f435ffe97fd7`。
施工分支：`work/forge-autoresume-20261016`，家中旁侧树 `D:\VCP\VCPChat-ForgeNetwork`。
正常可见施工工程 `pn0ma`；工程 ID/业务库不随 Git。
实现已发布为 `986f1746210b84d0f0762fce22a5f1a29858a606`，本机及服务器同版本测试完成。
文档后继不改变该实现；真实跨设备接续、生产启用与真实PI进程验收仍未完成。不能据此宣称上线。

## 1. 用户目标与本轮交付

目标：公司/家中/服务器由系统自动保存、发布和取回同一个全局工程的已登记代码、Todo、履历，
不依赖主人提醒或 Agent 自觉 commit/push。Git 在这里仅保全开发成果。

本轮实现一个固定受信 Hub、每宿主显式启用一个工程：
A 正常 Forge 施工自动发布检查点 → 关新写入口、排空协作 Worker →
发布最后检查点并交权 → B 启动发现已发布版本、新目录接管 → 获得写权后继续施工。

已用正常 ProjectForgeService 工具及真实 HTTP 验证这条链路，但 A/B 仍是本机临时目录和独立库。
**不是实际两台电脑的接续验收，未替换运行中插件、未迁移业务库、未上传真实工程。**
真实 PI 进程尚未适配；测试中的协作 Worker 不代表 PI 已具备失租停止能力。

## 2. 复用的组件与新接口

- `projectNetworkSync.js`：异步 HubNetworkClient 接入现有 ProjectSync 映射、
  ProjectTakeover 收据、工作树物化日志；不把 Promise 伪装成同步网络返回。
- `projectWriteGate.js`：持久工程绑定、Store/工具/GUI/实际文件副作用前的协作式写门禁。
- `projectAutoResume.js`：启动发现、持久租约申请、后台检查点、续租、交权与恢复。
- ProjectForgeService：`initialize({ ...hostOptions, autoResume })` 可由受信宿主显式启用；
  `startAutoResume(options)`、`autoResumeStatus()`、`handoffAutoResume()`、
  `runAutoWorker(fn)` 为宿主接口，不新增面向 Agent 的同步工具平台。
- 默认不启用，不自动读凭据/配置，不监听网络。当前未增加 GUI 启用项或生产配置加载器。
  服务端 flat initialize 不会自动取得 autoResume；受信宿主须另调用启动接口。
- `cleanup()` 在正常可写时尝试最后检查点/释放；失败如实抛错，能安全停止的资源仍关闭。
  Worker 未真实退出时保留关门后的库，不能把停库冒充排空成功。

受信宿主一次性传入：已配置的 HubNetworkClient、journalPath、mappingPath，
以及原点 localProjectId 或接收端 globalProjectId + 新目录 target（二选一）。
本轮不提供每次手动上传命令。固定 Hub、设备授权、证书和工程范围必须在部署时安全配置。

## 3. 持久协议和写权

### 映射与冻结检查点

网络模式映射库 schema2，在原表之外增加 `sync_payloads`：
第一次上传前，同事务冻结 bytes/hash/base/requestId/holder/fence。
每个工程最多一个未确认检查点，单包沿用 96 MiB；映射库最多两个冻结载荷，不做无限离线队列。
成功发布并本地记账后清除冻结 bytes；历史请求记录仍保留，没有 GC/保留期策略。
已有同步 schema1 的 planned 发布须先对账，不能凭空迁出缺失冻结载荷。
同步协调器拒开网络 schema2；当前代码中已打开的同步连接也会检测版本变化。
真正旧进程仍须在升级前停止，不能依赖 schema 标记隔离任意旧代码。

上传/发布回复丢失，用原 requestId、base+1 历史、摘要、holder、fence 下载复验后补账。
未发布请求仅在确认真实更高代租约、远端 head 仍等于原 base 时允许重发同一冻结字节；
伪造 fence 不得污染原请求。网络、多个 SQLite 和文件系统不共同原子。

### 本地写门

普通未启用库维持 schema4；显式绑定工程后升为 schema5，Bundle 接受本地 schema4/5，
便携 bundle 仍 format v1/schema3，不携带本地写权绑定或绝对路径。
schema4 旧程序拒开已绑定库；仍必须停旧进程、备份，禁止盲降级或混用同库。

新 Store 连接和重启后的控制器默认拒写。租约获取回执可能是旧请求重放，
激活写门前必须重新续租确认；以本机单调时钟的请求起点 + TTL - safety 计算保守截止。
续租不确定/到期立即关门并发送 AbortSignal；恢复必须重新确认，不复活旧异步准入令牌。
AsyncLocalStorage 令牌绑定 gate/fence/epoch/live，操作完成后的逃逸续写也拒绝。

交权顺序：立即封新入口 → 通知协作 Worker 停止 → 等实际操作结束 →
确认没有 open capture → 最后检查点 → 释放租约。
超时、未结束 Capture、发布不确定均不报告交权成功。已有有效写者不能强抢。
目录改绑、删除/恢复/purge 对已绑定工程暂时拒绝，无普通解除绑定开关。
目录保留只约束同接收库协作式词法路径；不是跨库全局锁、OS 沙箱或恶意链接/TOCTOU 防护。

`runAutoWorker(fn)` 的 fn 必须直到真实 Worker/PI 停止、收录完成后才 resolve。
AbortSignal 不是杀进程。未知外部写者、raw SQLite、管理员或已发出的不可抢占系统调用不受沙箱保证。
后台检查点排空并冻结写门后上传；长操作超过租期时宁可关门重试，不承诺硬实时或无停顿。

## 4. 实测与证据

家中 SHENBOJUN：Electron Node 模式，文件级串行 16 份 Forge 测试。
`full-frozen-02`：**380/380，exit 0，fail/cancelled/skipped 0，invalidHandle=false**。
380 包含既有343项和新增37项，专项/多轮有重叠，不能相加。
运行前后源码 SHA-256 一致；旧仓库 HEAD、索引、status、七份原修改字节保护核对通过。

真实 `process.exit(73)` 共七个新增点：
- 发送：origin-registered、checkpoint-frozen、revision-published。
- 接收：mapping-planned、takeover-started、takeover:files-published、takeover-complete。

覆盖正常工具自动发布、B等待活跃写者、原字节/Todo/履历恢复、同身份继续施工、
SQL记账失败、失回复历史对账、更高代固定检查点恢复、新连接拒写、GUI异步失租、
目录/批量/camelCase参数绕过、Worker完成Capture后交权、重启与旧异步上下文反例。
首轮专项11/17：本地schema5被Bundle只允许schema4的检查拒绝；修实现后17/17。
中途368项诊断轮发生源码修改，不用作冻结验收。前一冻结377/377后又补三项反例，现以380为准。
公司此前 Electron 默认文件并行收尾异常未证实修复，本轮串行成功不等于修复。

仓库外证据：`D:\VCP\Handoffs\Evidence\forge-autoresume-home-20261016-01`。
- `frozen-02.json`、`frozen-02-verified.json`、`original-protection.json`。
- `full-frozen-02/tests.tap` SHA256：
  `2844294c8337a87f26139980dac28a8dfbfb340406cc7127c1588f1ee238f24ac`。
- `summary.json` 明确进程退出结果，不能用工具顶层SUCCESS代替。

## 5. 下一步与仍未交付项

先安全发布本轮独立施工分支，再服务器同 Git 版本临时环境复测。
服务器新验证目录为 `C:\VCP\ClaudeBridge\operations\forge-autoresume-verify-20261016-01`；
截至本机冻结验收，该目录已建立但脚本/候选/启动尚未完成，旧343项服务器结果不能挪用。

之后只补实际用户主路径的宿主配置连接：
一个固定 Hub + 一个明确授权的可丢弃验收工程，在家中机和服务器间自动发布、交权、
启动发现新目录恢复并从正常 Forge 入口继续。再接现有 PI 的真实停止/退出与 Capture 收尾。
部署和真实工程上传另行核对范围、备份、凭据与证书，不因单元测试通过自动启用。

不做已有目录升级/覆盖、双向合并、离线双写、多Worker/DAG、服务发现或通用部署平台。
首版仅首次 A→B 新目录恢复；不是公司→家中→公司已有副本持续升级。
Bundle 仅包含已登记文件及引用快照，不是整仓依赖备份，ready不等于业务可运行。
只取得最后成功发布检查点，断网未上传字节不会凭空出现。
断电、旧备份混搭、目标解绑、映射丢失恢复、日志/内容容量回收仍不在本轮承诺内。
## 发布前字节规范化

首次发布预检在提交前被原始字节比较拦截：系统Git的core.autocrlf=true，
把九份CRLF文件暂存为LF；HEAD仍为9f77c05c，没有提交或推送。
逐文件审计确认索引只存在CRLF→LF差异，无代码文本变化。
九份原件保存在仓库外pre-lf-originals；只将旁侧树这些文件统一LF，
没有修改全局Git配置或旧D:\VCP\VCPChat。
正常Forge Capture cc1a24626659448af2f0ff3de / b45已归档该字节变化。

规范化后以frozen-03.json冻结原始字节，full-normalized-01重跑16文件：
**380/380、exit0、fail/cancelled/skipped均0、invalidHandle=false**。
这是同一用例集合的复测，不能与前轮相加。
最终候选的源码应与此LF版逐字节一致，Git提交对象也必须核对；
原full-frozen-02的摘要只用于追溯规范化前那轮。
最新TAP摘要与候选15文件摘要记录于仓库外normalized-verification.json / candidate.json。
## 双环境验证与发布收口

实现提交 `986f1746210b84d0f0762fce22a5f1a29858a606`，
父提交 `9f77c05cc7aad67e65a4c7cae1d8f435ffe97fd7`；
远端 `origin/work/forge-autoresume-20261016` 已实时核实。
15文件白名单，没有配置、数据库、凭据、日志、依赖或运行产物。
主分支 `origin/personal/main` 保持 `19e1283f273932dfc5d78a3b50f9d817b7c88627`。

| 环境 | 实际结果 |
|---|---|
| 家中SHENBOJUN，Electron Node模式，16文件串行，LF版 | 380/380，exit0 |
| 服务器10_1_0_14，Node22.22.1，better-sqlite3 12.4.1，默认文件并行 | 380/380，exit0 |
| 同服务器同提交，16文件串行 | 380/380，exit0 |

以上fail/cancelled/skipped均0，invalidHandle=false；各环境和轮次覆盖重叠，不相加。
服务器从精确Git对象导出，核对父链、15文件白名单和每个原始blob；
sourcesUnchanged=true、residentProtected=true，未加载或替换常驻ServerProjectForge。
旧服务器343项仅是前版历史，不是本版验收证据。

最新本机LF版TAP SHA256：
`9edc6f24bb0a967085b2c7e1d6b9bf089e42611dc8ff702336b7c3cf6fe22b8bf`。
服务器证据：
`C:\VCP\ClaudeBridge\operations\forge-autoresume-verify-20261016-01\evidence`。
- `full-default/tests.tap` SHA256：
  `bbc8900f108e7f0ab439edf6fe1fd845e3e104780e7a18cb80ebfb00e6f5e0b4`。
- `full-serial/tests.tap` SHA256：
  `ae1b146755cc16011a6aca7055406782529b4cd7cca9634a2b8d759032ee7354`。
- `summary.json`、`source-manifest.json`、`resident-before.json`和`resident-after.json`。
服务器最后一轮完成于2026-10-16当地20:58，结果来自实际进程与落盘报告，不是启动推测。

发布与验证编排失误如实保留：
1. 首次推送其实已成功，收尾工作树干净检查被Git换行/stat状态拦截。
   逐文件核对disk/index/HEAD与候选摘要一致，再用命令局部core.autocrlf=false重新登记已核验文件；
   未改全局配置、未设assume-unchanged、未改文件内容、未再推送，最终treeClean=true。
   本机publication.json记录recoveredWithoutRepush=true与原现场保护结果。
2. 服务器第一轮在源码预检失败，原因是人工搬清单时三条摘要误抄成65位，
   该轮没有导出测试目录、没有运行测试。修正为本机生成值并增加64位形状检查后，
   逐个对Git对象核验成功，再实际运行上述两轮380项。错误日志归档于preflight-failed-01。
   这是验证清单错误，不是源码或测试失败，不用重试结果抹掉首轮失败。

本次收口是已发布代码的限定范围验证，不部署固定Hub，不启用真实工程，不适配真实PI进程。
下一次实际接入必须明确一次性配置、验收工程、新目录、证书与设备工程授权，
只用可丢弃工程完成真实家中机→服务器接续，不上传业务工程或覆盖已有副本。