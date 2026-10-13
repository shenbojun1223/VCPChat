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