# ProjectForge Hub — 仲裁核心 MVP

## 本阶段交付范围

新增 `VCPDistributedServer/Plugin/ProjectForge/hubStore.js`。
核心是显式指定路径的独立 SQLite 数据库，不修改本地 Forge 的 `store.js`、
既有工程表或正在运行的 Forge 数据库。当前没有网络监听或自动加载入口。

该模块仅提供：
- 全局工程身份及来源登记的幂等性；
- 单一有效写租约、持久化申请记录、续租和释放；
- 单调递增 fencing token；
- 带版本 CAS 的不可变发布记录，及摘要引用。

**不是完整的跨设备接管实现。** 尚未提供 bundle 导入导出、文件搬运、
本地工程绑定、写入口拦截、身份认证、HTTP 服务、UI、自动 Worker 调度。
`bundleHash` 仅是调用者声明的 SHA-256 引用，未验证 bundle 内容或可用性。
不能据此声称现有各端已经受中央写锁控制。

## 身份与数据边界

- `originId`：未来由每个安装实例持久化的唯一 ID；不能只使用工作区别名或电脑名。
- `localProjectId`：原本本地库内的短工程 ID。
- `(originId, localProjectId)` 唯一映射到 Hub 全局 ID `g_<UUID>`。
  不同来源相同短 ID 绝不能被误合并。
- 登记相同来源和短 ID、相同名称，返回相同全局工程。
  原登记改名称重复提交返回 `REQUEST_CONFLICT`，本阶段无重命名 API。
- 其他设备之后显式使用同一个全局 ID，而不是靠名称猜测工程。
  本地绑定表及工程 bundle 恢复仍需后续实现。
- 本模块不存储本机绝对工作区路径，不把 Windows 路径当全局工程身份。
- 现有批次、节点、Todo 数字主键是各本地库的局部编号；
  后续整工程 bundle 必须显式做引用映射，不能直接合并行。

## API

```js
const { HubStore } = require('../VCPDistributedServer/Plugin/ProjectForge/hubStore');
const hub = new HubStore('/explicit/local-disk/forge-hub.db');

try {
  const project = hub.registerProject({
    originId: 'installation-UUID',
    localProjectId: 'p1234',
    name: 'Example',
  });
  const lease = hub.acquireLease({
    projectId: project.id,
    holder: 'installation-UUID',
    requestId: 'unique-acquire-request-UUID',
    ttlMs: 60000,
  });

  // 先读取并物化 lease.revision 对应的工程状态，未来再允许本地写入。
  // lease 是含 256-bit leaseId 的私密句柄，禁止进入日志/聊天/源码仓库。
  const renewed = hub.renewLease({ ...lease, ttlMs: 60000 });

  // 仅演示版本指针发布；当前模块不保证这个 bundle 已实际保存。
  const revision = hub.publishRevision({
    ...renewed,
    requestId: 'unique-publish-request-UUID',
    expectedRevision: lease.revision,
    bundleHash: 'a'.repeat(64),
  });
  hub.getProject(project.id);           // 不包含 leaseId
  hub.getRevision(project.id, revision.revision);
  hub.releaseLease(renewed);
} finally {
  hub.close();
}
```

返回错误为 `HubError`，程序应按 `error.code` 判定，不解析自然语言 message。
输入标识符限定为 1–128 字符 ASCII 标识，TTL 必须为整数 1000–300000 ms，
默认 60000 ms。版本号和 fencing token 使用 JavaScript 安全整数，
溢出时拒绝操作。

## 租约不变量

1. 全部变更用 SQLite `BEGIN IMMEDIATE`：先取得写保留锁，再读取共享状态。
   即使多个进程或连接访问同一个本地 Hub 数据库，也不能同时授予写权。
2. 租约 active 当且仅当 Hub 的 `now < expiresAt`，等于截止时间即失效。
3. 活跃租约阻止一切新申请，包括相同 holder 的不同 requestId。
   holder 名称不是身份证明，也不能作为可重入锁密钥。
4. 每次新授予都生成随机 leaseId，并将 fencing token 加一；
   续租保持 leaseId 和 fence 不变，不能缩短当前到期时间。
5. 释放不重置 fence。过期、释放、被接管的旧凭据不能续租、释放或发布。
6. 申请响应丢失时，同一个 holder/requestId 可取回仍有效的同一份租约。
   更改 TTL 拒绝；旧申请已过期、释放或被新代替换后，返回 `STALE_REQUEST`，
   不能以原 requestId 隐式重新获取写权。
7. `leaseId + holder + fence + projectId` 必须完整匹配。
   公共工程查询不返回 leaseId；私密申请记录保存在中央数据库内。
8. 续租、释放和发布均由 Hub 时钟判断，客户端时钟不参与仲裁。
   若时钟落后于该工程最后成功提交的变更时间，返回 `CLOCK_ROLLBACK`。
   注入 clock 只为离线测试；生产调用方不得由请求提供 clock。

## 发布不变量

- 只有当前有效租约能发布，发布不自动释放租约。
- `expectedRevision` 必须等于中央最新版本，成功后版本号加一。
- 相同 requestId 和完全相同 payload/租约代可幂等取回原发布结果。
  即使幂等重试，也先验证当前租约；旧代请求不能绕过 fencing。
- 内容、基线版本或租约代改变后复用 requestId 返回 `REQUEST_CONFLICT`。
- 同一旧版本的并发发布最多一份成功，其余 `REVISION_CONFLICT`；
  失败事务不留下新版本或半写的项目指针。
- 摘要不同于文件内容，也不同于工程完整性保证。
  真正发布 API 后续必须先确保 bundle 已完整保存、校验再更新版本指针。

## 持久化、安全与部署限制

- 使用独立 SQLite 文件、WAL、foreign_keys、synchronous=FULL 和 busy timeout。
- 仅接受空库或精确版本的 Hub 表集合，拒绝误用普通 Forge 数据库；
  不自动迁移未知版本。未设计将现有 Forge 数据库原地升级为 Hub。
- SQLite 文件必须在中央机器的本地可靠磁盘，不用 SMB、同步盘或网络文件系统。
- 数据库回滚/旧备份恢复可能使 fence 退回；当前无跨恢复 epoch。
  不允许在有写者存活时直接覆盖/回退中央数据库。
- 核心不是网络鉴权层。未来 HTTP/插件适配器必须验证客户端身份，
  将认证主体绑定到 holder，不信任请求里自报的身份，不公开租约密钥。
- fencing 当前只保护 Hub 的续租、释放和发布，不阻止外部 Worker 直接写磁盘。
  各端写入口与 Worker 生命周期必须接入失租停止机制；
  中央拒绝旧代发布仍是最后防线。
- 本阶段请求日志不自动清除，以免过早遗忘防重派状态；容量治理留待后续。
- 本阶段无强制抢占 API，接管须原持有者释放或租约自然过期。

## 已完成验证 — 2026-10-15

`tests/project-forge-hub.test.js` 使用临时数据库，不连接生产库或网络。
覆盖身份隔离、过期边界、幂等重试、旧代拒写、版本冲突、
重开恢复、时钟回退、错误数据库保护，以及独立 Worker/SQLite 连接的真实竞争。

### 本机 JOSHUASHEN-PC6
- 在 Electron 的 Node 模式下显式等待子进程结束，并落盘 TAP。
- Hub 20 项 + 既有 Forge / Capture 20 项：**40/40 通过**；
  fail=0，cancelled=0，skipped=0，进程退出码 0。
- 两项真实竞争分别由 6 个独立 Worker / SQLite 连接发起：
  同一工程仅一个租约申请成功，同一基线版本仅一个发布成功。
- TAP 证据目录：
  `%TEMP%\vcp-forge-hub-verify-8428fff566744ffcadc7a8ada56c224b`。
- 直接运行 Electron 曾仅返回退出码、未显示用例，因此没有将该回执单独作为通过证据。

### 服务器 10_1_0_14
- Node v22.22.1，better-sqlite3 12.4.1。
- 从本机只传输指定源码和测试的 ZIP，严格校验清单、长度及 SHA-256 后执行。
- 同一套 Hub 测试 **20/20 通过**；fail=0，cancelled=0，skipped=0，
  进程退出码 0，包含上述两项独立连接真实竞争。
- 仅在 Git 已忽略的隔离目录放置验证副本，测试库全部由测试创建在临时目录。
- 服务器 TAP：
  `C:\VCP\VCPToolBox\tmp\forge-hub-verify-20261015-01\tests.tap`。

### 已验证的原始字节指纹
| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `VCPDistributedServer/Plugin/ProjectForge/hubStore.js` | 14089 | `a317a75031d9c2b15a706b75d5f025754180fe777d45de1a1fa65122f06ea350` |
| `tests/project-forge-hub.test.js` | 14702 | `0b2fc20ba0b630eb9fa0c2f29ddef440eeca296f12464abf2d65f08969d8af85` |

验证包 7953 字节，SHA-256：
`67c2642339d09ab0f475a542437b60c8b89333d72b1fe4f0d556e8abbb1352c5`。
服务器成功复测后重新核对本机源码和测试，指纹未变。
指纹描述的是本次验收版本，后续改动须重新验证。

## 阶段结论与下一阶段

**仲裁核心已通过双环境测试，不等于中央 Hub 服务已上线。**
未连接生产工程库、未启动常驻网络服务、未拦截各端文件写入。
本次没有修改既有 Forge 实现或数据库，也未提交、推送 Git；
源码仍需正式提交后才能由 Git 跨机交付，隔离传包不替代版本发布。

后续顺序：
1. 实现整工程 bundle 的导出、校验和事务导入，拒绝 open capture 和未归档漂移。
   数据库事务与工作树写盘不是同一个原子操作，必须分别定义失败恢复边界。
2. 提供有认证、有限流和请求大小约束的中央接口与客户端。
3. 接入本地工程绑定、全量变更入口及 Worker 心跳/失租停止。
4. 完成一次真实跨设备交接，之后再考虑任务级多 Agent 调度。