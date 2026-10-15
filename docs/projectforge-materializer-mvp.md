# Forge 工作树物化 MVP

## 范围与当前状态

内部库：`VCPDistributedServer/Plugin/ProjectForge/worktreeMaterializer.js`。
只把已经校验的 records bundle 的当前文件状态还原到一个**原先不存在的新目录**。
不是整仓库同步，不覆盖原工作树，不导入 Forge 工程元数据，不启动网络服务。
未登记在 bundle 中的文件不会凭空出现；null 文件状态表示该路径不应存在。

依赖已经验收的 `projectBundle.js`。仅限 Windows、本地可靠文件系统、协作式单写者。
调用者必须授权目的工作区、保管可信 bundle 及其摘要、选择共享发布日志并协调写者。
没有跨不同发布日志的全局任务锁，也没有代替 OS 沙箱或 Hub 写租约。

## 接口

```js
const { WorktreeMaterializer } = require('../VCPDistributedServer/Plugin/ProjectForge/worktreeMaterializer');

const materializer = new WorktreeMaterializer('D:/private-state/materialize.db');
try {
  const job = materializer.createJob({
    requestId: 'persistent-unique-request-id',
    destination: 'D:/authorized-existing-parent/new-project',
    bundle: verifiedBundleBytes,
    expectedHash: trustedBundleSha256,
  });
  const result = materializer.resume(job.id, verifiedBundleBytes, {
    expectedHash: trustedBundleSha256,
  });
  // result.state === 'published' 仅表示工作树已发布。
  // result.metadataImported === false；不是工程接管或测试验收结论。
} finally {
  materializer.close();
}
```

- `createJob` 持久化 requestId、摘要、目的地与父目录身份。
- 同 requestId/同载荷重试取回原任务，不创建第二份任务；
  改摘要或目的地返回 REQUEST_CONFLICT。
- `advance` 推进一步，`resume` 有限次数推进至 published；重试必须重新提供同一 bundle。
- `getJob` 查询状态、当前暂存路径与以前尝试的保留路径。
- 日志不保存 bundle 内容；调用者须另行持久化内容与可信摘要。
- 目的父目录必须已存在，不允许卷根、UNC、设备命名空间、junction/symlink 祖先。
- 本库不读取工作区配置，也不会判断某个目录真的已经获得用户授权。
- `_testHook` 只用于测试故障注入，不得暴露给网络请求。

## 四态协议与事务边界

`planned → staging → ready → published`

使用独立 SQLite 日志：WAL、synchronous=FULL、foreign_keys、BEGIN IMMEDIATE。
已有库必须匹配专用表集合及版本；不能误传现有 Forge 工程库。
拒绝调用者外层事务，避免把内层 savepoint 成功误认为持久化成功。

1. planned：任务已记录，尚无暂存目录。
2. staging：暂存名称和尝试编号先在数据库提交，再创建同父目录的新暂存。
   文件使用 wx 独占创建、fsync；不覆盖、不收养其他目录。
3. ready：全部文件、目录清单及字节摘要均一致，暂存目录 dev/ino 身份已提交。
4. published：Windows 目录 rename 成功后，再验证目的目录身份与内容并记账。

数据库事务和文件系统不是同一个原子事务。
代码没有把它们伪装成分布式事务；恢复协议专门处理两者之间的进程中断窗口。

### 中断恢复规则

- staging 已有目录：保留旧目录，另分配暂存重新写入，不修补或删除不明残留。
  每任务最多 16 次尝试，达到上限停下供人工检查。
- ready 且暂存仍在：重新验证目录身份、完整清单和内容；目的地必须不存在。
- ready 且暂存不在：可能是 rename 已完成、日志尚未提交。
  只有目的地的 dev/ino 与记录相同，并且清单与所有文件哈希都相同，才能补记 published。
- 两边都不在、父目录换了身份、目的地由别的目录冒领：拒绝并保留现场。
- published 再次 resume：只验证原目的目录，不覆盖后来修改的文件。

旧暂存的清理、任务取消、日志容量回收不在首版范围内。
`retainedStages` 是历史保留路径，不承诺路径至今一定存在。
日志是可信本地状态，不是抵抗管理员篡改、inode 重用或恶意 TOCTOU 攻击的认证凭据。

## 发布与安全边界

- 实际 Windows 运行时测试覆盖了 rename 拒绝覆盖已存在空目录的行为。
  包括检查后、rename 前才出现的空目录竞态；失败后两边内容均保留。
- 非 Windows 构造函数直接拒绝。不能把 Windows 测试结论套用到 Linux 的覆盖式 rename。
- 暂存目录与目的地同父目录；不允许把暂存复制到另一卷后假称原子发布。
- 恢复前后检查目录身份，并拒绝文件链接、硬链接、额外条目、缺失条目和摘要漂移。
- null 路径不能同时成为活目录，已存在文件不能同时作为其他已知路径的父目录。
- 目录身份和内容核验防止普通误接管，不是路径能力句柄或恶意写者隔离。
- 未保留 POSIX 可执行位、ACL、时间戳、空目录和 ADS；bundle v1 只表达记录过的文件字节。
- 测试覆盖**进程退出恢复**，不承诺拔电、磁盘缓存丢失、网络盘或数据库旧备份恢复安全。
- 日志事务会覆盖整步本地写盘，同一日志中不同任务也会暂时串行；首版优先正确性。

## 与工程记录导入的衔接

records bundle 导入器要求目标工作树尚不存在，而物化后目录已经存在。
因此不能简单“物化成功后直接调用旧 importProjectBundle”；
也不能“先导入记录就宣布工作树已就绪”。

下一层须显式设计 import + materialize 的持久化协调任务、工程可用状态和查回协议。
当前两个内部库分别通过测试，但尚未组成生产级工程接管入口。
Hub 全局工程绑定、内容存储、网络身份认证、心跳和失租停止也尚未接入。

## 家中机换机恢复 — 2026-10-16

工作机 JOSHUASHEN-PC6 的工程 ID 和未提交文件不属于家中机 SHENBOJUN。
家中机原 HEAD 为 `19e1283f273932dfc5d78a3b50f9d817b7c88627`。
从服务器保留的已验收文件建立隔离 Git 根提交：
`f23c451259aca18ff7d4eb774646165d135d6b6e`。

恢复四份缺失文件：hubStore.js、projectBundle.js 和各自测试。
通过 Git bundle 验证提交、树白名单与逐文件 SHA-256，wx 创建，不合并不相关历史。
应用仓库保存 `refs/backups/forge-core-recovery-20261016`，HEAD 和索引未移动。
旧有 7 处受跟踪改动事先备份，恢复前后指纹一致；未读取或搬运 config.env 密钥。
恢复工程 `pofyl`，Capture `c94eacc404f3e08ec220c0ade`，收录批次 b1。
旧工作机的两篇 Hub/bundle 文档不在该四文件恢复提交内，不能声称已恢复。

本机恢复资料：`%TEMP%/forge-core-recovery-20261016-01`；
源码跨机恢复走 Git bundle，工具传输只承载包的字节，没有替代 Git 内容校验。

## 本机验证

SHENBOJUN 使用已有 Electron 的 Node 模式，显式等待测试进程结束并落盘 TAP。
物化器及测试已收到 CreateFile 成功回执，工程 pofyl 批次 b2 / b3。

`tests/project-forge-materializer.test.js` 31 项 + records bundle 26 项 +
Hub 20 项 + 既有 Forge/Capture 20 项：**97/97 通过**。
fail=0，cancelled=0，skipped=0，进程退出码 0。

包括 8 个真实子进程 process.exit(73) 中断点、ready/published 两处 SQL 故障、
相同内容不同 inode 拒绝、目标目录竞态、外层事务拒绝及 4 个独立 SQLite 连接竞争。
恢复测试在临时目录使用合成文件，不读取生产工程数据。
测试前后确认原有 7 处改动和应用 HEAD 一致。

TAP：
`%TEMP%/vcp-forge-materializer-verify-bdf38c9972cf430fb0df2f7cb7300d8b/tests.tap`。

## 服务器同 Git 版本复测

服务器 `10_1_0_14`，Windows，Node v22.22.1。
通过 Git 增量 bundle 传输，而不是手工复制源码：
- 基线根提交：`f23c451259aca18ff7d4eb774646165d135d6b6e`；
- 物化器提交：`243e169cb4beef7dc719ccf78f9f602a23da356c`；
- 校验完整父链、Git 树白名单、7 份 Git blob 和服务器 store.js 的原始字节指纹后，
  才写入 Git 已忽略的隔离测试目录。
- 增量 bundle SHA-256：
  `2e25a6f8e2fca35c9a7b52e88db397841777a898f3f8fc46217a8bb6cf6033a5`。

物化器 31 项 + records bundle 26 项 + Hub 20 项：**77/77 通过**。
fail=0，cancelled=0，skipped=0，测试进程和验证脚本退出码均为 0。
这包含 8 个真实子进程退出点、两处 SQL 记账故障与四独立连接并发恢复。
服务器这组不包含前端服务集成的既有 Forge/Capture 20 项；
该 20 项已在家中机与其他 77 项一起通过，总数 97。

本次验收的实现与测试指纹：
| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `worktreeMaterializer.js` | 18548 | `fa0f7b29bfa5de064ff51fb4581c0b8578a42394f7ba0a520dd52f140edb2f8b` |
| `tests/project-forge-materializer.test.js` | 21154 | `9b37e640a075c687c86774d9c5a8e645f15cf7ebd6419496c0091ee72a176dc3` |

服务器 TAP：
`C:\VCP\VCPToolBox\tmp\forge-materializer-verify-20261016-01\tests.tap`。
校验脚本、Git 对象及 verification.json：
`C:\VCP\ClaudeBridge\operations\forge-materializer-verify-20261016-01`。

应用仓库保留 `refs/backups/forge-materializer-local-20261016` 指向该隔离提交。
该提交包含服务器验收前的文档；本节是验收后的文档补充，尚未进入该提交。
应用 personal/main 的 HEAD 未移动，索引未改，未提交或推送应用业务分支。

## 阶段结论

**Windows 工作树物化内部库已通过双环境验收。**
不是已上线的同步服务，也不是端到端工程接管。
现有 Forge 工程库、常驻插件和已有工作树未被本次验证迁移或覆盖。

下一阶段：显式协调元数据导入、文件发布与完成回执，
以持久化任务保证响应丢失、SQL 失败和进程中断后能查回原结果。
在该协调流程验收前，不开放生产 Import/Takeover 入口。