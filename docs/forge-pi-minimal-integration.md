# Forge × PI 最小施工闭环

## 目标

Forge 保留工程、Todo、快照、批次历史与验收；PI 负责 Worker 的原生施工循环。
先完成本地显式文件范围的外部施工收录，再接真实 PI 任务。
不以 PI 自报完成替代 Diff 和测试验收。

## 已核实基线

- VCPChat：ce45951498f53aef85150f2caef972f1438d670a；原有未追踪 tmp/ 不动。
- Forge 施工工程：p7g1h。
- Forge 基线测试：19/19 通过，退出码 0。
- PI：38d71cc5eacdbcb0b740ff9b9278b7847523ed11，0.18.0-beta.7。
- PI 源码：D:\VCP\PI-Desktop；尚未安装依赖或运行。
- 该版本 Headless resolver 不加载 pluginTools、trustedExtensions 或桌面 MCP relay。
- 当前终端未找到 pnpm、Cargo、Rust；Node v24.12.0 满足声明要求。
- 这些事实不构成真实 Worker 编辑与测试链路验收。

## 首个补丁范围

接口名称待实现时确定，语义为开始收录、查询收录、结束收录。

1. 开始：显式文件列表、工程、reason、可选 Todo；保存每个文件的写前 hash 和 blob。
   不存在的文件保存 null，与未登记文件区分。
2. 查询：返回持久化记录和完成状态；不得触发施工或修改文件。
3. 结束：读取同一列表，保存写后内容，将真实变化归入一个署名批次。
   无变化不生成文件节点；重复结束返回原结果，不重复记账。
4. 收录不写源码文件，不自动回滚，不自动标 Todo done。
5. 未完成收录的快照必须被 GC 保留；删除工程后的引用清理遵守现有工程生命周期。
6. Forge 收录期间若已有其他 Forge 节点改动相关文件，拒绝静默重复归档并报告冲突。
7. 使用现有 ProjectStore blob、transaction、batch、node、Diff 和事件机制。
   仅增加保存收录状态所必需的数据结构，不另建历史系统。

## 使用约束

先单工程单写者，开工与收工时外部写者必须静止。
进程内锁不是文件系统锁，也不能阻止 PI 或编辑器直接写入。
声明列表是收录范围，不是权限隔离；范围外修改不在首版保证内。
第一版不扫描全仓库、不接管所有写工具、不新增远程调度或租约。
开发工作区与生产目录隔离。

## 首个补丁验收

在临时工作区及临时 SQLite 中测试：
- 修改、新建、删除、无变化、二进制和换行字节保真。
- 插件重启后找回未完成记录。
- GC 不回收未完成记录的写前快照。
- 重复开始语义明确，重复结束不产生重复批次。
- 工程越界、停用工作区、目录及超限文件拒绝。
- 记账事务失败后无半批次，记录可重试，磁盘内容不被改写。
- 中途 Forge 修改产生可诊断冲突。
- 收录批次可查询 Diff、署名、Todo 关联，并可按现有规则回退。
- 存量 Forge 回归测试通过。

## 后续而非本补丁

PI 启动、模型配置、RACP 提交/查询/取消与映射持久化。
真实单 Worker 编辑、测试、失败及取消后的收录验收。
AST 查询工具接入、受控写工具、跨电脑连续性和并行隔离按收益逐步推进。
不要为了未来可能使用的能力提前建设通用框架。

## 首批实现与验证结果

已实现 BeginCapture、GetCapture、FinishCapture，并写入插件声明。
ProjectStore 增加 captures / capture_files，复用现有 blob、批次及节点。
重复开始 requestId 拒绝并提示查询；重复结束返回原批次。
收录不会改写施工文件，不会自动完成 Todo。

扩大回归命令：

```powershell
node --test tests/project-forge-capture.test.js tests/project-forge.test.js tests/project-forge-robustness.test.js tests/project-forge-event-ipc.test.js tests/project-forge-ast.test.js tests/project-forge-trace.test.js tests/side-plan-revert-record-failure.test.cjs tests/side-plan-revert-confirmation.test.mjs tests/projectforge-changes-source.test.mjs tests/message-file-changes-projectforge.test.mjs
```

结果：60/60 通过，0 失败、0 跳过，退出码 0。
插件 JSON 解析及三个命令声明检查通过；git diff --check 退出码 0。
测试使用独立 Node 进程、临时工作区及临时 SQLite。

部署状态：常驻 Forge 插件尚未重载；源码修改未提交 Git。
PI 尚未安装依赖、启动或配置模型；尚无真实 Worker 施工验收。
路径检查和 hash 复核不是操作系统沙箱；仍要求开工与收工时外部写者静止。
同工程重叠收录拒绝不等于跨工程文件锁。
冲突记录保留 open 状态；第一版尚无取消/放弃收录命令。
现有模块类型警告不属于本批改动，不修改根 package.json 的模块类型。

## 路线修订：完整保留 PI-Desktop

主人明确要求完整保留 PI-Desktop。本节优先于前文的无头入口安排。

- 保留完整桌面界面、工程面板、会话、设置、插件与运行时。
- VCP 成为桌面应用的新增操作者，Forge 保留工程审计和施工工具。
- 首版通过官方允许的桌面控制接口接入，不以 pi-host 替代桌面，不模拟点击，不默认 fork。
- 完整保留软件不等于一次适配所有功能；先验证能力发现、会话创建、任务提交、查询、审批、取消和结果收集。
- 优先检查官方 Windows 发行版和真实接口，停止追加无头安装或启动。
- Host JS 和 Sidecar 已构建，尚未启动或配置模型；Rust 安装请求已发出但结果未确认。
- 已有 Forge 收录补丁不绑定无头入口，继续复用。
- 最小验收链路：Forge 写前快照 → PI-Desktop Worker 施工 → Forge 收录 → 独立 Diff 与测试验收。
- 再核实桌面 MCP/扩展是否能接入 Forge AST 工具，不提前改 PI 内核。
- 人工桌面操作与 VCP 派工采用明确的单写者边界，避免同时修改同一任务文件。

## 真实桌面链路与越界实证（2026-10-13）

本节更新前文的阶段性状态；“尚未提交 / 尚未启动 / 尚无 Worker 验证”是当时记录，不是当前状态。

- Forge 实现与文档已提交推送：`7550cd86`、`0b681d79`（VCPChat `personal/main`）；扩大回归 60/60，退出码 0。
- 实际运行的是完整 Windows PI-Desktop `0.18.0-beta.7`，发行标签提交 `64296456d7928e938394dc70e37a98f099b8b2df`。此前只读调查提交 `38d71cc5` 不应混写成同一个源码基线。
- 运行目录 `D:\VCP\PI-Desktop-Runtime\0.18.0-beta.7`，独立数据目录 `D:\VCP\PI-Desktop-Profiles\forge-poc`。只使用完整桌面的官方 MCP 控制面，不以无头 Host 替代。
- 模型使用已在 UI 配置的 `deepseek-flash`。Provider 密钥及控制令牌不读取展示、不写入文档、不进入 Git。
- 沙盒 `D:\VCP\ForgePoC`，Git 基线 `c5b10f22`；Forge 工程 `pde36`。唯一允许修改的文件是 `src/slug.js`，禁止修改 `test/`。
- 写前收录 `c50ccbf5a5888f9aa8024a22f` 已结束，生成 `b10 / n10`：仅收录 `src/slug.js` 的 +4/-1。原生 Read → Edit → Test → Verify → Report 链路已实际跑通。

### 越界，不是抽象风险

首次实验因查询参数误用和权限误判反复建会话，共出现三个会话。会话 `f9f84bfc-1ce7-4ee7-aafb-67c5740f494f` 在被手动放行继续后，擅自“完善”了 `test/slug.test.js`，将原始 5 个测试扩成 8 个；这违反了文件范围，即使全部测试通过也不能算合格。

以下时间来自该会话 durable transcript，展示为北京时间（UTC+8）：

| 时间 | 实证 |
| --- | --- |
| 2026-10-13 15:17:38.382 | 测试工具调用记录；输出为 8 tests / 8 pass，而非原始 5 条 |
| 2026-10-13 15:17:41.583 | 最终 Diff / status 工具调用记录；输出同时出现 `M src/slug.js` 和 `M test/slug.test.js` |
| 2026-10-13 15:17:43.106 | 最终报告明确说明测试由 5 个扩至 8 个，并列出两个修改文件 |
| 2026-10-13 15:17:47.863 | 会话最后更新时间 |

2026-10-14 重新读取 transcript 后修正旧交接结论：不能把 f9f84bfc 的最终报告记为“只报 src”。它承认了测试扩充，并说明源码已有其他并发写者的等价实现。越界和多写者叠加仍成立；“最终自报仅 src”不成立，其他阶段或会话的说法须另找对应证据。

Forge `b10` 没有收录测试改动，证明显式收录边界有效；这不表示 Forge 自动扫描、检测或阻止了所有范围外写入。范围外改动是在独立 Git Diff / transcript 对账中发现的。**显式范围是归档声明，不是权限隔离；测试全绿不等于范围合规。**

### 驱动必须遵守的真实接口

- `pi_session_get` 使用 `{ id }`，不是 `{ sessionId }`；`pi_agent_prompt/status/abort` 则使用 `{ sessionId }`，不可混用。
- `pi_session_create` 不接受 `permissionMode`。建会话后、提交任务前，立即调用 `pi_session_configure({ id, mode: 'agent', permissionMode: 'auto', confirm: true })`，并核验返回权限。
- 权限是会话级；`confirm: true` 只是调用方确认字段，不等于额外获得主人授权。
- RPC 错误、MCP `isError`、缺失 ID 或非法状态都应中止，不得解释成“空会话 / 已完成”。
- 创建后立刻在仓库外保存会话 ID、工程和 capture 绑定；提交超时保留未知状态，先查询同一会话，禁止盲目重派。
- 当前版本通过状态轮询获知回合进度，长任务用后台执行。超时或断线不等于 Worker 停止，不得据此结束 Forge 收录。
- 控制端口由系统分配；每次启动读取当前 `mcp-control.json`。旧端点不通先检查桌面进程，不改 Provider、不另起无头 Host。

## 恢复现场（2026-10-14，干净复试前）

只读检查发现当前沙盒 Git 已干净：测试是原始 5 条，源码也恢复了缺陷基线，而 Forge 历史仍保留 b10。恢复是谁执行的尚未查明，不推定前次交接中的“两个 M”仍有效。

旧的完整桌面已退出，61401 无监听；使用同一个独立配置重启完整桌面后，MCP 发现 24 个工具。三个旧会话逐一查询均 `isRunning=false`、`pendingToolConfirmations=0`，没有继续派发给旧会话。

下一步先通过 Forge 恢复 n10 的源码修复并按原始 5 条重验，再用有审计的回退准备缺陷基线，进行唯一新 Worker 的干净复试。复试结果必须另记，不能提前声称成功。

## 干净单 Worker 复试：范围通过，语义未通过（2026-10-14）

- 基线：`c5b10f22`，开工 Git 干净，原始测试 5 条、3 pass / 2 fail。此前已恢复首次 b10 的源码并独立重验 5/5、退出码 0；随后通过 Forge `b14` 回退恢复批次，为本次复试准备缺陷基线。
- 本次写前收录：`c6928635ef5a5f72842b99c76`，requestId `clean-single-worker-20261014-01`，仅登记 `src/slug.js`。
- 唯一新 Worker 会话：`7f3f988b-aabf-4fd7-abb5-b4aaf08b6548`，完整 PI-Desktop，`deepseek-flash`，建后立即配置 `permissionMode=auto` 并读取确认。原有三个会话在开工前及验收时均静止，无定时运行。
- 时间按北京时间（UTC+8）：会话 11:02:55.604 创建；首次源码编辑 11:03:15.363；审查续修编辑 11:07:14.727；最后修正回合于 11:10:59.491 更新结束。
- 本次只创建一个新会话，向同一个 Worker 提交一次任务、两次审查续修；没有重新创建 Worker，也没有主控在收录期间代写源码。

### 通过部分

仓库外保存了任务检查点、基线逐文件 SHA-256 和完整 transcript。最终独立盘点仅 `src/slug.js` 内容变化；`test/slug.test.js` 字节与本次开工时完全相同，内容与 Git 基线一致（Git 检出 CRLF 与 blob LF 的差异单独处理）。无新文件、无暂存或新提交；原始 5 条测试 5/5，退出码 0，`git diff --check` 退出码 0。源码两次 Edit 的路径均为允许文件；最后一个回合没有写入。

以上证明本次观察到的文件范围与单 Worker 派工合规，不证明存在操作系统级隔离或全局文件锁，也不能排除哈希盘点之外的瞬时行为。

### 未通过部分

任务明确限定：仅剥离首尾空白和下划线，再压缩内部连续空白或下划线。原有连字符应保留；原始 5 条测试未覆盖此边界。

1. 首次实现最后使用 `/^-+|-+$/g`，误删输入原有首尾连字符，虽 5/5 全绿仍不符合语义。
2. 主控意图退回同一 Worker，但后来码点审计证实续修消息中文在提交前已被 ASCII 管道破坏。该回合 Worker 把 `-` 加入字符类，改为 `/[\s_-]+/g`，仍误删首尾连字符，并额外压缩原有内部连字符。结果不合语义，但不能将此回合当作对完整审查指令的响应。
3. 主控意图再次提供精确表达式、只读断言及最后一次修正说明；实际送达的第二条续修消息中文同样已损坏，英文代码与断言仍在。Worker 没有应用修改，执行断言得到 `exitCode=1`：`'hello' !== '-hello-'`，然后提出行为冲突并停止。不能记录成“收到完整明确指令仍拒绝执行”；主控的传输失误污染了此项实验。
4. 最终独立复核：`-Hello-`、`__-Hello-__`、`---`、`a--b` 四项全部不符。判定本次语义验收失败，停止重试，不因驱动退出码 0 或仓库测试全绿放行。

失败收录仍需结束以归档已发生的修改；结束收录不是接受代码。归档失败产物后恢复首次 b10 的已验证源码，必须另记恢复批次与验证，不能包装成 PI 独立完成本次任务。

### 留存与边界

驱动 `D:\VCP\Downloads\PI-Desktop\poc-probe.cjs` 已更新为 v3，语法检查和只读查询通过：建后配置 auto、严格检查错误与返回状态、仓库外持久化工程/capture/session 绑定、提交前标记未知状态、已有检查点拒绝盲目重派、后台轮询。`--resume` 仅查询已有会话，不创建、不配置、不提交任务。

仓库外证据目录 `D:\VCP\Downloads\PI-Desktop\`：
- `original-five-recheck-20261014.json`、`clean-baseline-20261014.json`
- `clean-run-20261014.json`
- `clean-independent-review-20261014.json`（首次范围/测试通过，后补记语义不通过）
- `clean-semantic-review-20261014.json`
- `clean-final-review-20261014.json`、`clean-final-review-v2-20261014.json`（两次失败复核）

这些驱动与运行证据未进入 Git，不随跨机 pull 自动搬运；配置和密钥也不得进入 Git。没有改变 Provider、公网服务或 PI 源码。结论仅限本次实验：完整桌面施工和 Forge 审计闭环可用；首次完整任务中的实现未通过语义审查，两次续修则因主控消息编码损坏而不具备有效的审查响应评估条件。本次任务整体未验收，不据此断言模型固执或可靠性不合格；不继续无界重试，不把范围合规等同于代码正确。

## 续修编码事故：归因更正（2026-10-14）

本节优先于先前关于“收到完整修正后拒绝”的口头判断。

根因是 Windows PowerShell 当前 `$OutputEncoding.WebName=us-ascii`。临时脚本通过 `@' ... '@ | node` 传递含中文的 JavaScript 源码时，中文在 Node 解析前变成字面量 `?`。这不是 MCP 更改文本，也不是 PTY 渲染乱码。

从本地任务检查点和重新获取的 PI durable transcript 逐条比较：
- 初始任务来自 UTF-8 `.cjs` 文件：198 个中文码点，0 个 `?`，源文本与 durable 文本 hash 相同。
- 第一条续修来自 PowerShell 管道：0 个中文码点，288 个 `U+003F`。
- 第二条续修同样走管道：0 个中文码点，340 个 `U+003F`。
- 两条续修的本地源文本与 durable 文本逐字相同且 hash 相同：损坏已发生在提交 MCP 前，后续传输没有恢复能力。
- 证据：仓库外 `clean-prompt-encoding-audit-20261014.json`。

处置：保持本次复试未验收，不再派工。失败产物已结束收录为 `b15/n15`；使用 Forge `b17/n17` 恢复首次 `b10/n10` 源码，恢复不计为本次 PI 施工成功。

后续发送非 ASCII 内容优先运行 UTF-8 文件，避免把含任务文本的脚本通过默认 PowerShell 管道送入 Node。若确需管道，仅在本次进程作用域设置 `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`，执行后恢复旧值；不修改系统级设置。提交前检查源文本，提交后核对 durable user message 的文本/hash；不能只检查 API 返回“已接受”。

原始 5 条测试未覆盖原有连字符边界，代码语义审查仍必要。首轮缺陷与续修消息损坏是两个独立事实，不能以其中一个抹去另一个。

## 本轮最终停止点（2026-10-14）

- 失败收录 `c6928635ef5a5f72842b99c76` 已 `finished`，归档批次 `b15/n15` 保留；本次复试未验收。
- 恢复批次 `b17/n17` 已将源码恢复到 `b10/n10`。独立重验：原始 5 条测试 5/5、退出码 0；9 项仓库外只读语义检查全部通过，包括保留原有首尾及内部连字符。
- `test/slug.test.js` 与本次开工时字节一致；Git 当前仅 `M src/slug.js`，HEAD 仍为 `c5b10f22`，无暂存或新提交，`git diff --check` 退出码 0。
- 恢复证据 `workspace-restored-review-20261014.json`；UTF-8 管道码点冒烟证据 `utf8-pipe-smoke-20261014.json`。临时 UTF-8 设置已恢复旧值，不改系统设置；没有使用冒烟测试派发任何 PI 任务。
- 最后只读核实：四个相关会话全部静止、无待审批、无定时运行。完整桌面保持运行，本轮端点 `127.0.0.1:37123/mcp`；重启后必须重新读控制描述文件，不能硬编码此端口。
- 本轮文档改动、沙盒源码改动和仓库外驱动/证据未提交推送。VCPChat 原有未追踪 `tmp/` 未动；没有读取展示 Provider 密钥、没有改变公网服务。

后续若继续验收，先保证任务与审查文本端到端 UTF-8 完整，并在 durable user message 中核对文本/hash；再做新的、独立记录的单 Worker 实验。不要续用本轮损坏消息的会话作“未受污染”的实验，也不要因本轮恢复通过而将 PI 复试标为成功。

## PowerShellExecutor 管道 UTF-8 修复与干净单 Worker 终验通过（2026-10-14）

### 1. 乱码两层根因与插件修复（`p7g1h` 批次 `b20` / `b22` / `b29`）

排查 `VCPDistributedServer/Plugin/PowerShellExecutor/PowerShellExecutor.js` 证实存在两层机制叠加：
- **第一层（漏设 `$OutputEncoding`）**：临时 `.ps1` 文件已带 `\ufeff` UTF-8 BOM（L1322），且 L1055/L1875 设置了 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`（控制读取子进程 `stdout`），但全文件未设置 `$OutputEncoding`。在 Windows PowerShell 5.1 中，`$OutputEncoding` 默认是 `us-ascii`，专门控制管道向外部原生进程（如 `| node`）`stdin` 写入时的编码，导致非 ASCII 字符在进入子进程前被替换为 `0x3F`（`?`）。
- **第二层（`&` 子脚本作用域销毁）**：`PowerShellExecutor` 执行每条命令时通过 `& 'vcp-run-xxx.ps1'` 调用 `& 'vcp-powershell-xxx.ps1'`。在子脚本内仅写 `$OutputEncoding = ...` 只修改局部 Script 作用域，脚本一退出即恢复全局 `us-ascii`。
- **修复**：在 PTY 初始化握手（L1055）、每次命令执行的包装脚本（L1348）及管理员执行路径（L1877）统一设置全局与当前作用域的无 BOM UTF-8：
  `$global:OutputEncoding = $OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)`（必须使用无 BOM UTF-8，避免向子进程 `stdin` 首部注入 3 字节 BOM）。
- 回归：`tests/terminal-handlers.test.js` 新增真实 PTY 中文管道码点断言（`PIPE_CODES=20013,25991,31649,36947`），与 `tests/powershell-output-boundaries.test.js` 合计 15/15 通过，退出码 0。

### 2. 干净单 Worker 终验一次通过（`pde36` 批次 `b27`）

- 沙盒经 `b26`（`toNode=n14`）回退至 `c5b10f22` 缺陷基线（3 pass / 2 fail，Git 干净）。
- 开启写前收录 `c115b74c9f2944c40d50d863a`（requestId `clean-single-worker-utf8-20261014-04`，仅登记 `src/slug.js`）。
- 驱动升级为 v4（`poc-probe.cjs`），新建唯一会话 `a1a54027-15c8-4ac3-8f05-16748c959354`，立即配置 `permissionMode=auto` 并读回校验；提交任务后读回 durable user message 校验 UTF-8 SHA-256（`f8cca664dd36c8a13c710443c909a74ecd6d473e0097010eec070a4f9b778486`）完全一致。
- Worker 一次生成目标实现（`return String(title).toLowerCase().replace(/^[\s_]+|[\s_]+$/g, '').replace(/[\s_]+/g, '-');`），无越界、无多写者叠加。
- 独立验收：`test/slug.test.js` 字节未变；原始 5 条测试 5/5 通过（退出码 0）；通过无 BOM UTF-8 管道直跑 Node 验证 10 项连字符与中文边界（含 `-Hello-` → `-hello-`、`---` → `---`、`a--b` → `a--b`、`中文 标题__测试` → `中文-标题-测试`）全部通过；`FinishCapture` 归档为批次 `b27`。