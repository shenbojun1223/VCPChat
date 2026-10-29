# ProjectForge records bundle v1

## 当前能力

内部库：`VCPDistributedServer/Plugin/ProjectForge/projectBundle.js`。
这是工程记录和所引用快照的离线搬运模块，不是整个 Git 仓库归档，
也不是已上线的同步服务。没有新增工具命令、网络监听或生产数据迁移。

提供三个函数：
- `exportProjectBundle(store, projectId, options)` → `{ bytes: Buffer, sha256 }`
- `validateProjectBundle(bytes, options)` → 完整性检查后的统计信息
- `importProjectBundle(store, bytes, target, options)` → 新工程 ID、来源 ID、摘要及 ID 映射

仅接受当前 Forge schema 3；不修改 `store.js` 或既有 schema。
调用者负责工作区授权、停止外部写者、数据库生命周期及传输身份验证。

## 导出内容与拒绝条件

导出当前工程的：
- 工程名称、历史状态、报告、署名及时间；
- Todo、批次、节点与最新文件状态；
- 已结束的 Capture 及其文件基线；
- 上述记录引用到的所有原始快照，以 SHA-256 内容寻址。

不携带结构化的来源工作区配置和绝对根目录，不扫描整个工作树，
不包含其他工程或无引用 blob，也不扫描未登记文件。
已有报告、reason、summary 等自由文本原样保留，可能含来源路径和历史编号；
不会用字符串替换伪造为目标库编号。调用者可使用返回的 idMap 查询对应记录。
历史快照可能包含敏感内容；范围收敛不等于自动脱敏。

拒绝：
- 工程不存在或已软删除；
- 有任何未结束收录；
- 历史引用悬空、同文件 before/after 链断裂、最新文件状态与历史不一致；
- 缺失、损坏或超限的快照；
- 被盘点文件存在未归档修改、删除或意外出现；
- 路径不便携，或检查到符号链接、junction、硬链接；
- capture-only 文件的最新快照无法唯一确定。

无改动 Capture 也可能独占某文件的唯一快照，必须一并携带。
否则虽有 Capture 记录，换机后快照实际已丢失。
没有 file_state 的 Capture-only 文件按收录创建时间选择最新基线；
同时间、同路径、不同内容则返回 AMBIGUOUS_STATE，不用随机 Capture ID 猜先后。

文件范围是 file_state、历史节点及 Capture 文件，不包含未登记内容。
不能以此宣称“整个仓库无漂移”。导出使用数据库写保留锁和两轮磁盘核验，
但这不是 OS 沙箱，不能阻止外部进程在核验后继续写入。
调用者必须保证开工、导出和接管边界上的单写者静止。

## 完整性与资源限制

载荷为有版本号的 UTF-8 JSON，快照为原始字节的 canonical base64。
包括中文、BOM、CRLF、空文件和二进制，均不做文本换行归一化。

默认上限：
- 序列化 bundle：96 MiB；
- 单快照：8 MiB；
- 不重复快照合计：64 MiB；
- 所有记录与 blob 条目合计：50000。

options.limits 只能收紧，不能放大内置上限。
校验严格检查字段集合、ID 唯一性、引用闭包、快照长度和 SHA-256、
base64 规范性、节点顺序和文件状态一致性。

路径采用 NFC POSIX 相对路径；拒绝越界、绝对路径、反斜杠、ADS、
控制字符、Windows 保留设备名、.git、尾随点或空白及大小写冲突。
本阶段保守拒绝这些路径，而不是悄悄重命名。

options.expectedHash 可与可信渠道获得的 bundle 摘要比较。
未提供它时，内部哈希仍能检查结构和快照完整性，但不能证明来源可信。
攻击者能重算摘要；摘要本身不是数字签名或身份认证。

## 事务导入与本地映射

```js
const {
  exportProjectBundle, validateProjectBundle, importProjectBundle,
} = require('../VCPDistributedServer/Plugin/ProjectForge/projectBundle');

const bundle = exportProjectBundle(sourceStore, sourceProjectId);
validateProjectBundle(bundle.bytes, { expectedHash: bundle.sha256 });

const result = importProjectBundle(targetStore, bundle.bytes, {
  root: '/authorized-workspace/not-created-yet',
  workspaceId: 'local-workspace-id',
  workspaceAlias: 'local-alias',
  subpath: 'not-created-yet',
}, { expectedHash: bundle.sha256 });
```

root 必须是调用者已授权的绝对非卷根路径，且工作树目的地尚不存在。
本模块不判断别名是否真的对应已启用工作区；适配入口必须先经 WorkspaceResolver 授权。
拒绝调用者外层事务，避免内层 savepoint 被误当完整事务边界。

一次 BEGIN IMMEDIATE 内：
1. 校验已有同 hash 的目标快照，新增缺少的快照；
2. 创建新本地工程，不覆盖或合并已有工程；
3. 分别重建 Todo、批次、节点的局部数字主键；
4. 为 Capture 生成新 ID，重映射 todo_id、batch_id、baseline_node 和 capture_files；
5. 写入当前文件状态，成功后整笔提交。

返回 idMap.todos / batches / nodes / captures，保留来源编号到本地编号的映射。
Capture requestId 在新工程内保留，已结束状态和来源署名不变。
baseline_node=0 保留为零；报告中的历史“accepted”仅为来源状态，
不代表目标工作树已创建或在目标环境重新验收。

共享快照按 hash 去重；已存在但内容损坏的目标快照拒绝导入，
不会用来源内容静默覆盖潜在损坏。
SQL 中途失败，工程、ID 分配、快照及引用全部回滚。
本机已用真实 SQLite 触发器分别在 nodes、captures、capture_files、
file_state 插入时注入失败，核对全部表及 sqlite_sequence 无半写残留。

## 工作树、重试及恢复边界

**导入不会创建目录，也不会创建、修改或删除任何工作树文件。**
返回 requiresMaterialization=true，不持久化可自动接管的任务状态。
目标根尚不存在；工作树创建能力未接入前，不应对普通用户暴露该内部 API。

同一目的地已有本地工程记录时拒绝再次导入；不同目的地显式导入是独立副本，
不是按 requestId 幂等恢复，也不是 Hub 全局工程绑定。
响应丢失后的查回协议、本地绑定、复制品清理及替换流程尚未实现。

数据库事务和工作树落盘不是共同原子事务。
后续物化必须另外设计暂存目录、发布、数据库状态及崩溃恢复，
不能把事务导入等同于“跨机接管已完成”。

## 验证记录 — 2026-10-15

本机 JOSHUASHEN-PC6，使用 Electron 的 Node 模式显式等待子进程结束并保存 TAP。
`project-forge-bundle.test.js` 26 项，加 Hub 20 项及既有 Forge/Capture 20 项：
**66/66 通过，fail=0，cancelled=0，skipped=0，退出码 0。**

证据目录：
`%TEMP%\vcp-forge-bundle-verify-c7d13e803bfc453890f90d5268e32f30`。

包括临时双库主键占号、字节保真、显式测试物化后的往返导出、
无改动 Capture、GC 快照保护、范围限制、路径/漂移/损坏拒绝及四处 SQL 故障回滚。
测试里的显式物化仅是隔离 fixture，不是产品物化实现。
### 服务器同源码复测

服务器 `10_1_0_14`，Node v22.22.1、better-sqlite3 12.4.1。
在 Git 已忽略的隔离目录运行同一套 bundle 测试：
**26/26 通过，fail=0，cancelled=0，skipped=0，测试进程及验证脚本退出码均为 0。**

新增源码和测试以 Brotli 压缩的 UTF-8 JSON 传输，
解压前校验载荷摘要，写盘前检查固定文件清单、长度及 SHA-256。
服务器已有 store.js 经原始清单校验一致后，仅复制到隔离目录；
没有修改常驻插件，也没有复制配置、密钥或生产数据库。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `VCPDistributedServer/Plugin/ProjectForge/projectBundle.js` | 25731 | `047fcc838cc5f78398996c96d1a50766bce5e8d06fc0a7b1e8d108c23ee1cd9a` |
| `VCPDistributedServer/Plugin/ProjectForge/store.js` | 23668 | `e8a20f11ed6dcd0506dc7c25187c6951a2ed29308d4fab4bf2404981f20aec90` |
| `tests/project-forge-bundle.test.js` | 23031 | `a2ad04d1d1c145fd316ebd62732ba076b989f8f55186e2e24105c737789665b6` |

传输载荷 11064 字节，SHA-256：
`f16420e7f8b462f5dbde515e3d2070471f565b13f2b96fe407aed0b641ad5f2b`。
指纹标识本次验收版本，后续源码修改必须重新验证。

服务器证据目录：
`C:\VCP\VCPToolBox\tmp\forge-bundle-verify-20261015-01`。
其中 `tests.tap` 为完整测试报告，`verification.json` 为指纹与汇总记录。

### 阶段结论

**工程记录与引用快照的 bundle 核心已通过双环境验收。**
不是整仓库备份、不是工作树同步，也不是中央 Hub 服务上线。
已验证临时双库导出、校验、创建新副本和主键映射；
尚未提供工作树物化、生产入口、网络认证、本地全局绑定或租约写入约束。
未迁移现有工程库、未启动常驻服务，未提交或推送 Git。

## 下一阶段

1. 服务器隔离复测及源码指纹核对。
2. 工作树物化：新目录暂存、校验、发布及可恢复状态。
3. 工程 bundle 与 Hub 版本指针、可信内容存储对接。
4. 认证中央接口、本地全局工程绑定及租约写入口约束。
5. 最后做一次真实跨设备交接，而不是只在临时双库演示。