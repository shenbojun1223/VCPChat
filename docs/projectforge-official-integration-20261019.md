# Forge 多端与官方更新集成 — 2026-10-19

## 固定输入与当前状态

- 多端基线：`eaf5ab5e7ba26479c738c8c66aa9c051c65db78b`。
- 官方输入：`8f1562ea8fb851d0e370449a66ba24700d93faf9`。
- 共同祖先：`a01807a1fa77ebf3fde22c78df8ee237d92e3ad5`。
- 施工工程：`pojwg`。
- 集成分支：`work/forge-official-integration-20261019`。
- 独立工作树：`D:\VCP\VCPChat-ForgeNetwork\.integrations\official-20261019`。

实现已发布：`61f8424f7e6d302e77a59778648b18d095acbd5a`，分支 `origin/work/forge-official-integration-20261019`。2026-10-19 20:46:28 +08:00，push exit0，独立 `ls-remote` 核实完整 SHA 一致；提交树为 `7f5fe3482dec24d7fcce12edfdab8bf6850661d8`。家中原主目录与 `personal/main` 保护检查通过。

后续历史文档归档使用普通文档后继提交，不重写上述实现提交。后继文档发布状态以远端及发布回执为准。家中日常客户端、公司客户端和服务器插件尚未部署此集成实现，源码发布不等于上线。

官方输入还包含游戏、音频、侧聊、终端和其他客户端更新，不是只挑选 Forge 六项的补丁。本次合并保留官方提交历史，不能把有限回归描述为全仓功能验收。

## 合并与兼容处理

原有六处 Git 冲突：
- `VCPDistributedServer/Plugin/PowerShellExecutor/PowerShellExecutor.js`
- `docs/contracts/chat-contracts.json`
- `docs/contracts/generated/chat-event-graph.json`
- `main.js`
- `modules/ipc/desktopHandlers.js`
- `modules/messageRenderer.js`

处理后无剩余冲突标记；有关 JS 语法检查通过，六处冲突已在集成索引中标记解决。自动合并结果另外审查：

- 18份多端底座模块与多端基线 Git blob 一致，包含 Hub、bundle、物化、原目录更新、写门、availability、自动接续、store 与 workspace。
- 官方 `args.js`、`indexerClient.js` 和 Windows 索引器 EXE 与官方输入 Git blob 一致。
- `ProjectForgeService.js` 保留多端接续逻辑，同时合入多 Todo 预检、编辑参数归一化说明与扩展语言提示。
- 个人 `postinstall: electron-builder install-app-deps` 保留；合并后的锁文件仍有相应 `hasInstallScript`。不要把官方输入锁文件内容直接当成集成树锁文件。
- 对长消息保护与官方工具正文懒挂载增加兼容预算模块及反例测试；不更改保存的消息原文，不宣称减少模型上下文。
- PowerShell 回传兼容修复及对应测试纳入集成结果。
- 历史同步测试的 groupchat mock 补充 `initializeRuntimeServices()`；真实历史队列、删除标记持久化和原断言保留，没有修改生产代码来迁就测试。
- 动态事件站点经审查后重建契约事件图：810 events、675 files、102 registered、undiscovered 为空，生成与门禁均 exit0。首次发现3个未登记站点的失败证据保留。

## 冻结回归

最终运行：
`D:\VCP\Handoffs\Evidence\forge-upstream-integration-1792410340745\integrated-final-1792413665883`

- 43份测试，612 tests / 612 pass。
- 0 fail、0 cancelled、0 skipped；各测试进程 exit0。
- 最终完成：2026-10-19 20:42:13 +08:00。
- `testAndSourceUnchanged=true`：本轮测试期间被监测源码和测试指纹不变。
- `status.json` SHA256：
  `151e8b65e67ada80d3c21f13301f3fa9aed1f1a84689b83ffa9a052d0d14d2290`。
- 使用本机 Electron Node 模式，原生 SQLite 预检通过；未安装或重编译依赖。集成树通过本机 junction 引用现有 node_modules。
- 新增 `tests/project-forge-upstream-edit-contract.test.js` 共11项：混用参数拒绝且无落盘/待办状态副作用、缺失步骤1的归一化及说明回传、符号路径不干扰编号编辑、多 Todo 四种输入、缺失后续编号时不部分更新。
- 范围还包括既有多端接续、官方 Rust 宏误判测试、工具卡片/长消息保护、PowerShell/终端、契约图、部分游戏入口、桌面同步桥和历史同步。
- 原439项基线、后续601项与最终612项存在包含关系，不能相加当作独立用例数。

第一次选定回归为586 pass / 1 fail，原因是历史同步mock缺少初始化方法，内部子测试未执行。补测试桩后为601/601，再增加11项编辑契约测试得到612/612。保留所有失败和复测日志，不改写失败记录。

## 空白与字节审计

默认 `git diff --cached --check` 曾报告969条：
- 识别CRLF后消除966条。
- 剩余3条位于官方原样文件的尾随空格：`PTYShellExecutor/AdminConfirm.js` 两处、`model-picker-popup.js` 一处。
- 本次解决冲突和新增文件的CRLF感知检查为0告警。

未为清空告警批量格式化官方文件，未全局修改Git空白策略。完整分类见仓库外 `whitespace-audit.json`。

## 部署前硬边界

1. 本次只在独立工作树合并和测试，日常 `D:\VCP\VCPChat` 未被覆盖或切换；原主目录HEAD、分支、index、status及受保护文件字节有独立核验记录。提交或部署前须再核实。
2. 不把代码提交视为服务重载。主进程与常驻插件需通过受控退出/启动加载；不强关当前聊天。
3. 公司端尚未部署集成版。两机应取同一个最终发布提交，不各自重新合并；设备身份、目录和配置保持各自独立。
4. 不覆盖工程数据库、不拷贝活跃SQLite文件充当一致性备份、不复制租约或设备身份。固定Hub的实时持权方必须重新查询，历史revision/fence不是实时状态。
5. 服务器的ServerProjectForge有独立manifest与部署路径。本次未更新服务器插件，不能声称前后端已经同步升级。
6. 当前PATH中未找到rustc/cargo；未跑Rust源码cargo test/clippy。Rust最低版本已为1.89，本次使用官方已提交Windows索引器进行所选测试，不宣称本机重建验证了该二进制。
7. 未完成完整Electron GUI交互、官方全部新功能验收或新版真实公司→家中→公司往返。索引器查询性能未进行专项基准测量。
8. 两份历史真实部署文档已全文审查并按原字节复制至 `docs/archive/forge-20261017/`，外层原件保持不变。归档索引记录摘要及历史阶段优先级；文档后继是否已发布仍须核实远端。旧版本真实部署证据不代替本集成版的部署验收。

## 下一步

- 实现提交已发布；本次文档归档按独立后继提交审计，不 amend 或强推已发布实现。
- 家中、公司取同一固定实现；服务器使用对应公共源码及独立宿主适配，不各自重新合并。
- 部署白名单尚需结合各机现场确定，不默认整体覆盖主目录或直接使用历史白名单。
- 实时核对原单工程接续绑定、授权与持权状态，再安排受控宿主切换与真实往返验证。
- 不借本次集成自动扩大到多工程调度、PI升级或其他新架构。

## 公司及其他电脑的安全取件

以下只获取源码，不升级运行中的客户端，不导入工程库，不绑定 Hub。

先检查本机主目录和已有工作树，保留所有未提交现场：

```powershell
git -C D:\VCP\VCPChat status --short
git -C D:\VCP\VCPChat worktree list
git -C D:\VCP\VCPChat fetch --no-tags origin refs/heads/work/forge-official-integration-20261019:refs/remotes/origin/work/forge-official-integration-20261019
```

核实固定实现存在且属于取回的发布历史：

```powershell
git -C D:\VCP\VCPChat cat-file -t 61f8424f7e6d302e77a59778648b18d095acbd5a
git -C D:\VCP\VCPChat merge-base --is-ancestor 61f8424f7e6d302e77a59778648b18d095acbd5a origin/work/forge-official-integration-20261019
```

两条命令均须成功。后继仅文档变化时，实现仍可固定取该 SHA；不要把分支名称自动当作永远不变的版本。

确认下面目标目录不存在后，才建立旁侧验证树：

```powershell
git -C D:\VCP\VCPChat -c core.autocrlf=false -c core.eol=lf worktree add --detach D:\VCP\VCPChat-ForgeOfficial-20261019 61f8424f7e6d302e77a59778648b18d095acbd5a
```

若目录已存在，检查其根路径、HEAD和改动后复用，不删除或强制覆盖。部分克隆可能需要额外下载文件对象，使用有状态、有限超时的取件流程，不无限重试。

公司此前的 `VCPChat-ForgeCompany@eaf5ab5e` 是旧基线验证树，不会因本次 fetch 自动升级。新工作树也不会自动成为常驻插件加载路径。

依赖必须核实本机锁文件与 Electron 原生 ABI；不跨机拷贝 `node_modules`，不在运行中的主客户端目录执行盲目的 `npm ci`。数据库、设备身份、控制凭据与工程状态不随 Git 迁移。