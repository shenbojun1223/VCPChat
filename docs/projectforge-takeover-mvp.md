# Forge 统一接管协调层 MVP

> **后继版本：2026-10-16 availability 门禁。**
> 当前源码使用本地schema4与收据v2，已将pending可用性与软删除分离，
> 普通Store/工具/GUI拒绝pending，完成工程清除保留purged墓碑。
> 当前验收、迁移、旧进程停机升级及限制以 [availability说明](projectforge-availability-mvp.md) 为准。
> **下文保留schema3/收据v1的历史设计与双环境证据**；
> “RestoreProjects可解除隔离”和“RESTRICT阻止complete purge”描述旧实现，已非当前行为。
> 历史服务器104项通过不能作为当前schema4的服务器验收。本次仍未部署生产同步服务。

## 范围与状态

内部库：`VCPDistributedServer/Plugin/ProjectForge/projectTakeover.js`。
连接 records bundle 元数据导入与 Windows 新工作树物化，不是网络同步服务。
当前只在临时数据库、合成 bundle、新目录中验证，无生产工具命令或 HTTP 入口。
未接入 Hub 工程身份、中央内容存储、写租约或 Worker 心跳。

本机 SHENBOJUN：协调层 27 项 + 既有 97 项，共 **124/124 通过**。
fail=0、cancelled=0、skipped=0，测试进程退出码 0。
本机 TAP：
`%TEMP%/vcp-forge-takeover-verify-759b9fa12b70432da1a4f33fd1d8d25e/tests.tap`。
测试前后复核原有 7 处受跟踪修改、应用 HEAD 和索引未变。
服务器 `10_1_0_14` 已使用当前 Git 提交 `78aa37da` 完成同版本复测：
协调层 27 + 物化器 31 + bundle 26 + Hub 20，共 **104/104 通过**。
fail=0、cancelled=0、skipped=0，测试进程和验证脚本退出码均为 0。
本机额外包含既有 Forge/Capture 20 项，因此总数为 124，不能将两端数字相加当作不同用例数。
旧版 77 项服务器报告仍保留，但本次结论以当前 104 项报告为准。

## API 与所有权

```js
const { ProjectTakeover } = require('../VCPDistributedServer/Plugin/ProjectForge/projectTakeover');
const coordinator = new ProjectTakeover(receivingProjectStore, 'D:/private-state/publication.db');
try {
  const result = coordinator.takeover({
    requestId: 'persistent-takeover-request-id',
    bundle: verifiedBytes,
    expectedHash: trustedBundleSha256,
    target: {
      root: 'D:/authorized-existing-parent/new-project',
      workspaceId: 'local-workspace-id',
      workspaceAlias: 'local-alias',
      subpath: 'new-project',
    },
  });
  // result.ready / filesystemVerified 代表本次校验完成，不代表业务测试已经通过。
} finally {
  coordinator.close(); // 仅关闭其拥有的物化日志连接，不关闭调用者的 ProjectStore。
}
```

- `start(args)`：创建或找回发布任务；幂等导入记录和收据，返回 ready=false。
- `resume(requestId, bundle, { expectedHash })`：验证原收据，恢复物化并提交完成回执。
- `takeover(args)`：start 后 resume；缺少导入收据时必须用原 target 重试 start。
- `getTask(requestId)`：只读持久化状态，不重新验证文件，始终 ready=false、
  filesystemVerified=false；recordedComplete 才表示曾记录完成。
- 同一 requestId 绑定同一 bundle 摘要、完整目标映射、发布 journal 身份和任务 ID。
  复用请求但更改这些参数会拒绝；不会为同一请求再导入一个工程。

调用者须授权 WorkspaceResolver 工作区、持久化 bundle 和可信摘要、停止外部写者。
本库不会把自报的工作区别名或 holder 当成认证证据。
所有路径和状态库属于可信本机环境；摘要校验不等于身份认证或数字签名。

## 两个持久化提交域

### 接收 Forge 数据库

构造协调器时显式调用 initializeProjectImports，新增 opt-in 扩展：
- `project_import_receipts`，版本 1；
- meta 中的 project_import_store_id；
- 不更改现有 schema_version=3 的普通表定义。

普通 bundle 校验、旧 importProjectBundle 不自动创建收据扩展。
原导入事务体抽为内部函数，旧导入入口仍是显式创建副本，不是幂等请求入口。

一次 BEGIN IMMEDIATE 内：
1. 校验 bundle、引用、已有 blob 和本地目的地；
2. 创建新工程并映射 Todo / 批次 / 节点 / Capture ID；
3. 将新工程标记为 pending 隔离状态；
4. 保存结果、ID 映射、元数据指纹和原发布任务绑定；
5. 全部成功才提交。

pending 暂借 deleted_at / deleted_by 表达：
deleted_by=`takeover:<requestId>`，deleted_at 为收据时间。
普通 getProject/listProjects 默认不展示它；包含已删除工程的管理查询仍然可见。
这不是权限隔离，也不是独立的生产可用性状态模型。

收据 project_id 外键使用 ON DELETE RESTRICT，防止清除身份后重试产生第二工程。
包括完成收据都暂时阻止 purge；取消、清理、保留期限和删除策略尚未实现。
已初始化收据的接收库改变了 purge 行为，因此不能未经适配直接部署生产。

重试比较元数据指纹、隔离标记及全部导入快照，不只看 projectId 存在。
元数据指纹包含本地映射后的结构化记录与自由文本，不包含独立校验的可用性字段。
来源报告、署名、历史 accepted 原样保留，不代表目标环境完成业务验收。

### 物化发布日志

沿用 WorktreeMaterializer 的 planned → staging → ready → published 协议。
日志追加持久 journal_id，兼容已有版本 1 日志；同路径换成新日志会被拒绝。
发布请求 ID 从接收库唯一 ID + takeover requestId 派生，避免不同接收库同名请求碰撞。
收据绑定 journal_id、绝对 journal 路径、jobId，而不是只靠目标目录名称猜测归属。

任务先写发布日志，再导入记录；如果导入失败，保留原 planned 任务供重试。
不清除或回滚另一个库的任务，不声称两个数据库有共同原子提交。

## 恢复流程与完成门

1. 创建或找回同一发布任务；
2. 导入和 pending 收据在接收库同事务提交；
3. 校验 pending 元数据和 blob 未漂移；
4. 恢复文件发布，重新核对目录身份、完整条目及字节哈希；
5. 接收库一个事务内解除 pending 并写 complete 收据；
6. 回执返回前再次检查文件。

进程退出、SQLite 失败、回执丢失后，从已提交状态查回原工程。
发布成功但完成回执未提交时，文件可能已存在，工程仍隐藏；
重试只补记同一收据，不再次导入元数据或覆盖文件。

`completeProjectImport` 是内部受信完成门，要求调用者先验证绑定的发布。
它不是密码学凭证接口，不能直接暴露为任意 Agent 可调用的生产命令。
跨库/文件系统之间没有锁住恶意外部写者；最后核验和回执之间依然不是原子观察。

complete 后如果文件或元数据被后续修改，重试会拒绝，不覆盖、不新建。
不会自动再次隐藏一个曾成功完成、后来正常编辑的工程。
没有在每次普通 Forge 读取时做文件校验；ready 只表示本次协调返回时的检查结果。

## 已知隔离缺口

普通 RestoreProjects 仍可直接解除 pending 的软删除标记。
当前协调器能检测这种变化并返回 IMPORT_DRIFT，但不能阻止普通管理入口提前暴露工程。
普通 includeDeleted/GUI 和其他写入口也尚未接入接管状态守卫。
测试验证的是“检测并拒绝继续”，不是“恢复接口已无法越权解除隔离”。

因此本阶段仅内部库，不开放生产 Import/Takeover。
正式接入前需要专门的 availability 状态和全部读取、恢复、删除、purge、
编辑入口的一致约束，不能把软删除复用当成完整隔离方案。

其他限制：
- Windows 本地可靠磁盘、协作式写者；不承诺断电、旧库备份回退、管理员篡改。
- 不支持覆盖已有目录、合并已有工程、从 ready=true 推导业务正确性。
- bundle 只携带登记文件，缺少整仓依赖文件时不能推导“项目可运行”。
- 当前依赖外部提供 bundle 内容；没有服务端内容上传、认证、限流和消息分页协议。
- 传输 journal 或接收库备份到另一台机器不是接管流程；本地身份和路径会失配。
- `_testHook` 只供测试，不得经外部请求传入。

## 本机验证覆盖

`tests/project-forge-takeover.test.js` 27 项：
- pending 默认不可见，发布完成后只出现一个工程；
- 回执丢失重试返回原 projectId、原 ID 映射、原物化任务；
- 10 个真实子进程 process.exit(73) 中断点：
  job-created、import-before-commit、metadata-committed、
  materializer:stage-created、materializer:file-written、materializer:committed:ready、
  materializer:renamed、files-published、complete-before-commit、complete-committed；
- 收据插入故障全部元数据/快照/ID 回滚；
- complete 更新故障保持工程隐藏、已发布文件保留；
- 请求变更、journal 更换、元数据漂移、文件漂移、已有目标目录拒绝；
- pending 手动恢复被检测，purge 受收据外键限制；
- 四个独立 SQLite 连接并发重试只得到一个收据、一个工程和一个发布任务。

新增协调层修改了 projectBundle.js 和 worktreeMaterializer.js；
旧指纹仍只代表此前基线，后续复测必须使用当前新版本。

## 后续顺序

1. 已完成：保全 Git 快照及服务器同版本临时库复测；生产部署尚未开始。
2. 为生产接入补齐专用可用性状态与全部入口守卫。
3. 对接 Hub bundle 内容存储、全局工程映射、认证接口与失租停止。
4. 最后验收真实跨设备工程交接，而不只是库级临时环境演示。

## 双环境验收证据 — 2026-10-16

验收 Git 快照：
- `f23c451259aca18ff7d4eb774646165d135d6b6e`：恢复的 Hub/bundle 基线；
- `243e169cb4beef7dc719ccf78f9f602a23da356c`：物化器基线；
- `78aa37daf3513a05d40a30a4231ad2063e3f1a2c`：当前统一接管协调层。
- 本机备份引用：`refs/backups/forge-takeover-local-20261016`。
  这是隔离快照，不是 application personal/main 已提交或推送。

服务器逐项校验提交父链、Git 树白名单、10 份 Git 文件以及独立 store.js 后，
才在 Git 已忽略的验证目录放置源码，运行临时数据库测试。
未更新 ServerProjectForge 常驻部署，未连接既有生产工程库。

本轮实现指纹：
| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `projectBundle.js` | 35562 | `9ed0bfecf670d8ab7110be139425033cbb3dee06b04a302b06da4dd2465753c3` |
| `worktreeMaterializer.js` | 19123 | `73942b40b6a61af4e5b35965a47fa0bcac18fd43743d6e98d07bb633ef195ac6` |
| `projectTakeover.js` | 6841 | `2de8c4d4274131b10c07f4dfc18cd74d59ff3f5369336ca4d02f0ad0762b2f9a` |
| `tests/project-forge-takeover.test.js` | 20013 | `b04ce1b4520b22ddb476bae6dea8fcdc7e12aa5cbdb1b9cbb8c61375362341cb` |

Git 增量包 SHA-256：
`d022f13e3a6ff3237b6983b172e268148125adb20a4ddb29b85ec0d3350257fc`。

服务器 Windows / Node v22.22.1，完整 TAP：
`C:\VCP\VCPToolBox\tmp\forge-takeover-verify-20261016-01\tests.tap`。
仓库外保全：
`C:\VCP\ClaudeBridge\operations\forge-takeover-verify-20261016-01\evidence`，
包含 tests.tap、verification.json；Git 对象与校验脚本在其父目录。

本节是服务器验收后的文档补充，不在原 78aa37da 提交中。
后续文档保全快照应是其后继；实现未变不等于文档字节未变。

**结论：内部协调库已通过双环境验收；生产接管和真实跨设备同步尚未上线。**
普通 RestoreProjects 可解除 pending 软删除，协调器只能检测并拒绝继续。
在独立可用性状态与全部入口守卫完成前，不开放生产 Import/Takeover。