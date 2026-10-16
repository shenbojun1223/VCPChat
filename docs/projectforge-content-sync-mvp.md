# Forge 可信 Hub 内容与全局／本地工程映射

## 产品位置与部署边界

目标仍是系统自动保存、上传、取回工程进度与已登记代码，不依赖主人提醒或 Agent 自觉 commit/push。
本轮是该产品的**内部内容与映射闭环**，不是后台自动同步上线。

基线为 `c093ea1f2d002eeba34ff61fc8d048790322b79a`。
先核对公司 JOSHUASHEN-PC6 两个工作树和服务器 10_1_0_14，
再以同一 Git 原始字节导出到服务器独立目录验证。
基线两端各 235/235；用例重叠，不能相加。
服务器第一轮 234/235：隔离导出漏带 `preloads/core/define.js`，
补齐同一提交中的 preload/core 依赖后 235/235，未修改实现或跳过测试。
这是环境准备失败，不隐藏、不拿首轮冒充通过。

没有替换客户端／服务器常驻插件，没有迁移生产工程库，没有 HTTP、认证或后台任务。
源码跨机以 Git 提交为身份通道；Git 是本轮开发成果交接，不是产品要求用户手动提交。
API 仍仅内部可信能力；普通工具 manifest 不暴露新入口。

首读本文件，旧协调器边界见：
- `docs/projectforge-availability-mvp.md`：本地 schema4、pending 门禁、收据 v2。
- `docs/projectforge-takeover-mvp.md`：接管协议与历史说明，现版以顶部声明为准。
本轮没有改变便携 bundle format v1/schema3，也没有改接收库的业务 schema4。

## 1. HubContentStore：可信内容而非摘要占位

`VCPDistributedServer/Plugin/ProjectForge/hubContentStore.js`

- 显式绝对路径、独立 SQLite，拒绝普通 Forge 库或未知 schema。
- `content_meta` 持久身份和限额；`content_bundles` 原始完整 Buffer、SHA-256、大小、
  源工程 ID 同一事务提交，内容库 schema1。
- put 必须提供预期 SHA-256；服务器自行计算摘要并复用 validateProjectBundle，
  验证包形状、行数、引用、每个 blob、大小、便携路径；不是信任上传方摘要。
- get 再次核验大小、完整包和每个快照，不因“以前上传过”就返回损坏字节。
- 重复上传同 hash 幂等，已有字节仍复验；损坏数据不自动覆盖／修复。
- BEGIN IMMEDIATE、WAL、synchronous=FULL；插入前 quota 预检与写入同事务。
- 默认总 payload 512 MiB、1024 个 bundle；创建时可收紧，之后持久不允许每连接绕过。
  单 bundle／blob 等沿用现有 96/8/64 MiB 与 50000 行限制。
- quota 是逻辑完整包大小／数量，不是 SQLite、WAL、日志的物理磁盘上限。
- 整包 Buffer、同步校验，不是流式上传；大包可能阻塞调用线程。
- 只追加、不提供删除、驱逐或垃圾回收。未发布上传也占容量。
  满额明确拒绝，不能宣称可无限长期生产运行。
- 拒绝调用者外层内容事务，防止 savepoint 被误当作持久 COMMIT。
- 不扫描密钥、不决定可上传文件，调用者负责授权、停写和数据范围。
  合法 bundle 也可能含敏感内容，摘要校验不等于脱敏。

## 2. Hub schema2：完整内容先于版本发布

现有 `hubStore.js` 的身份、租约、随机 leaseId、单调 fence、严格过期、
requestId 和 expectedRevision CAS 保留，没有重造仲裁库。

构造 `new HubStore(path, { contentStore })`：
- 绑定内容库持久身份与新 Hub UUID，写 schema_version=2。
- 旧 schema1 要先备齐所有历史 revision 对应内容才能绑定；失败同事务回滚。
- schema2 重开必须提供同一内容库；摘要-only 模式或另一个内容库均拒绝。
- 当前实现已打开的摘要-only 连接在发布前重读 mode，遇绑定后也不能继续裸发摘要。
- **真正旧版本进程不会理解这些守卫**。绑定升级前必须停旧进程并备份，
  schema 标记不是防止旧进程或任意 raw SQL 的权限系统，不支持盲目降级。

发布：
1. 在 Hub IMMEDIATE 事务内检查当前租约、holder、leaseId、fence、过期。
2. 从绑定内容库取回并完整验证包，缺失／损坏则不创建 revision。
3. 沿用原 requestId 幂等与 CAS，提交新版本。
4. 上传只保存内容，不创建版本；存储接口不替代发布写权。
5. 重放发布也要求当前有效凭证和完整内容，旧代不能借幂等旁路 fence。
6. Hub 写入口拒绝调用者外层事务，返回值不冒充未提交 savepoint 已持久发布。

`getHubId()` 只用于内容绑定后的 Hub。
`downloadRevision(globalProjectId, revision)` 返回不可变历史信息和重新校验的完整 bytes。
内部 raw DB/contentStore 对象都是可信能力，不提供 ACL／恶意管理员防护。
内容库没有正常删除入口，因此发布与保留内容之间只需有序提交；
两库仍**非共同原子**，外部篡改或旧备份回退可能损坏引用，后续读取会拒绝而不补造内容。

## 3. ProjectSync：持久身份映射与导入恢复

`projectSync.js`：
```js
const sync = new ProjectSync(localStore, journalPath, mappingPath, {
    hub: contentBoundHub,
    deviceId: 'synthetic-device-A',
});
```

显式构造会为接收库启用既有导入收据扩展和发布日志，只用于临时库验收。
不能把构造器直接塞进运行中的真实业务库。

独立 mapping schema1：
- Hub UUID、deviceId、接收库 UUID、发布日志 UUID／绝对路径、mapping UUID。
- 全局工程 ID、当地工程 ID、工作区 ID／别名／subpath、绝对目标目录。
- 每接收库每 Hub 固定一个 mapping UUID／绝对路径，在接收库 meta 中钉住。
  换 mapping DB、设备名、接收库、Hub 或日志都拒绝，不凭短工程 ID 猜对应关系。
- 同 mapping 内每全局工程唯一，本地 ID、请求、目录唯一；根目录及父子重叠保留，
  Windows 大小写别名按词法规范化拒绝。
- 接收库 + Hub 的 pin 是协作约束，不是所有数据库／日志之间的全局路径锁。
  symlink／junction、恶意 TOCTOU、不同数据库或外部写者仍需单独授权／隔离。
- 失败构造可能保留已初始化空库／日志／绑定，需检查后复用，不能假设零副作用。
- 不支持丢失 mapping DB 后自动解除 pin 或重新建一套库；不支持旧备份混搭回退。
- 本机绝对路径只保存在本机映射，不作为另一台电脑应使用的路径。

`registerLocal(localProjectId)`：
- 以接收库唯一身份作为 originId，避免不同库的相同本地 ID 碰撞。
- Hub 注册成功但本地映射前退出，重放找回同一全局身份。
- 已接管副本再次注册直接返回原全局 ID，不能把 B 副本 fork 成第二个全球工程。
- 映射仍 pending 时拒绝普通注册；先恢复原接管请求。

`publishLocal({ globalProjectId, lease, requestId, expectedRevision })`：
- 绑定本设备 holder，原点与已 ready 的副本均可在获得新租约后发布。
- 首次请求的基础版本必须等于本地映射已知版本；不提供“把旧树强行改成最新 base”。
- export → 验证上传 → 本地 sync_publications 固定摘要／base／holder／fence → Hub 发布 → 本地记账。
- 同请求重放使用冻结的 bytes，即使本地以后有改动也不混入旧 checkpoint。
- 创建冻结记录前中断只可能留下未引用内容；没有已发布版本可被误认。
- 记录后重试必须保持请求、基础版本和代际，失租发布仍拒绝。
- 不自动认领／续租、不启动 Worker，不承诺写盘入口已受租约保护。
  外部文件写者仍须由调用者停下；本地映射状态不是编辑权限。

`reconcilePublication(requestId)`：
- Hub 已发布但本地记账失败，随后旧租约失效，可只读查询原 base+1 历史。
- 精确匹配 requestId、SHA、base、holder、fence 并下载校验内容后补本地账。
- 不创建 Hub revision、不续租、不取得写权、不改文件；未发布／另一请求占位均拒绝。
- 后续本地较新发布记录不会被旧历史对账回退。
- filesystemVerified=false：补记历史不是当前工作树的 attestation。

`start / resume / receive`：
- B 首次选择一个已发布 revision，持久固定版本、摘要、完整目标和原请求。
- 省略 revision 只在首次选 Hub head，重试仍固定原检查点。
- 原 importRevision/importBundleHash 与 B 后续发布的 revision/bundleHash 分离，
  后续发布不会悄悄改写原接管请求。
- 映射 planned(pending) → 下载完整校验 → 确定性接管 requestId →
  现有 ProjectTakeover.start/resume → 绑定本地工程 → ready 记账。
- 概念设备 A/B 使用不同接收库和新目录；不是覆盖工作目录或整仓依赖备份。
- 相同请求进程退出后恢复同一个工程／收据／发布任务；不同请求不能重复映射同一工程。
- 已有目标目录绝不覆盖；同一映射的自动版本升级本轮明确不支持。
- complete 工程清除后，旧请求识别 IMPORT_PURGED，并留本地映射墓碑，不重建或改文件。
  getMapping 只读记录可能暂未与接收库清除同步，resume 才执行墓碑对账。
- B 已有正常编辑／发布后，重放旧接管若发现 IMPORT_DRIFT 则拒绝，保留新工作。
- getMapping/read-only recordedComplete 不做文件系统校验，ready/filesystemVerified=false。
  receive/resume 成功只说明本次结构恢复验证，不代表完整工程可运行或业务验收。
- 拒绝调用者的 mapping／receiving／Hub 外层事务；不能用大事务包装此协议。

## 恢复与不可冒称的保证

Hub、内容库、映射库、接收库、发布日志与文件系统**不共同原子**。
由每步独立持久提交、固定请求、已绑定身份、既有接管收据和日志协调恢复。
ready 前部分步骤可能已完成；本地映射仍 pending 时工程也可能已在接收库 complete。
不回滚已发布目录来掩盖这类裂缝，恢复只对账并复验，不覆盖后续正常修改。
测试承诺普通进程退出及事务回滚恢复，不宣称突然断电、网络盘、旧库回退或恶意篡改可恢复。

取消、墓碑／日志保留期、配额扩展、内容 GC、目标解绑和映射重置尚未实现。
真实部署前需要停旧进程、备份并制定升级／容量／回收策略。

## 验证状态

实现最终测试数量和同 Git 版本服务器证据，以本节后继验收记录为准。
开发证据根（不进入源码）：
- 公司：`D:\VCP\Handoffs\Evidence\forge-hub-content-office-20261016-01`
- 基线服务器：`C:\VCP\ClaudeBridge\operations\forge-availability-verify-20261016-01`
- 独立 Forge 审计工程 `pcdl7`、仓库外 construction.db；不是当前客户端默认业务库。

用例包括原字节中文/BOM/CRLF/二进制、配额／摘要／损坏、上传非发布、schema1 绑定回滚、
旧代发布拒绝、接管固定版本、本地落后基线拒绝、失租历史对账、SQL 触发器回滚、
多个真实子进程 process.exit(73) 中断点和四独立 SQLite 连接并发。
这些是内部合成双端与工具库测试，不是全应用 GUI 或真实跨设备自动同步验收。

## 下一阶段顺序

1. 本轮同 Git 版本两环境验收、文档与源码安全交接。
2. 认证网络 API、传输限额与可靠后台检查点／发布／取回调度。
3. 实际写入口接入租约／心跳及失租停止；协调在途 Worker 和跨设备接管。
4. 设计已有目录的显式、安全版本推进／本地冲突处理，而非直接覆盖。
5. 最后使用经授权的真实业务工程进行跨设备自动接续验收。

只能取得最后成功上传且发布的检查点；离线未上传字节不会凭空出现，
也不能抢占仍有效写者。**本轮尚未交付“换电脑后无感自动同步”的最终产品体验。**

## 最终内部库验收 — b6f7abde

- 实现提交：`b6f7abde010e5327b5ec391beccbd93834276b5d`，父提交 `c093ea1f2d002eeba34ff61fc8d048790322b79a`。
- 本机 JOSHUASHEN-PC6：两轮完整 14 文件 Forge 回归均 **304/304**，
  exit0、fail/cancelled/skipped 均0；两轮五文件源码指纹一致，提交逐字节核实。
- 两轮 TAP：`content-sync-full-03/tests.tap`
  SHA256 `0f5c57fc7b89af1887155d9593793c6803223b21ca69a55c0a7a809d1fd63551`；
  `content-sync-full-04/tests.tap`
  SHA256 `2159a4ff6ac6ad2722558c6b2dcc03f3e92da1aefa4c0e7267c3e0df5c79dd1e`。
- 服务器 10_1_0_14、v22.22.1：同Git实现提交 **304/304**，exit0，
  fail/cancelled/skipped 均0；源码导出前后、常驻仓库HEAD/索引/既有修改指纹均验证。
  TAP SHA256 `1ac868787f6ba10fff39a71d2693a58b6f6cedc4a1544b53fdc212b7893100e3`。
- 服务器证据：
  `C:\VCP\ClaudeBridge\operations\forge-hub-content-verify-20261016-01\evidence`。
- 新增69项是304项子集；两端及重复轮次用例重叠，不能相加为不同用例。
- 真实process.exit(73)：内容2个、接收7个、发布2个中断点；
  原接管/物化/availability故障测试亦完整回归。SQL触发器故障保留跨库裂缝并可重放恢复。
- 首轮专项49/50：测试误用getTodos，只改为既有listTodos；另一次全量304断言通过后，
  接管文件进程报PostQueuedCompletionStatus无效句柄，exit2147483651，整轮按失败保留。
  接管单跑27/27。新增两组Worker测试修为等待真实exit后清理，两轮全量及服务器通过。
  **不声称已证明那次Electron收尾崩溃的唯一根因或永久消除。**
- 当前实现仅5文件；后继文档提交不改变已测源码。
- 独立施工审计pcdl7与证据位于仓库外，不是默认Forge业务工程库。
- 同Git版本复测不等于真实设备经网络自动同步；生产插件、真实业务库和配置未启用本实现。

### 换机接续

发布分支为 `work/forge-hub-content-20261016`（最终远端提交见发布回执）。
首读本页。旧工作区有未提交文件时，先只读检查，再fetch到旁侧新worktree，不直接pull/reset/clean。
本轮开发施工树为 `D:\VCP\VCPChat-ForgeSync`；家中同名D盘不是共享目录。
Git只带源码，不带Hub/内容/映射/接收库、日志、Provider配置或工程ID。
不要将旧未跟踪hubStore/projectBundle覆盖新版。
下一阶段先认证与可靠后台传输，实际写入口租约和失租停止、显式目录推进须独立设计验收。
