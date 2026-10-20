# Forge 统一计划目录：施工接续点

工程：`pxu8p`。状态：active，未最终验收。
施工树：`D:\VCP\VCPChat-ForgeNetwork\.integrations\official-20261019`。
基线：`1edcacf2304afb24164e79f66d5f73883d5c2fce`。
实现批次：b129–b196；本文件为后续文档节点。
未提交、未推送、未部署；未改生产配置、业务数据库或租约，未重启生产服务。

## 用户目标

家中、公司、服务器的全部已共享计划在客户端可见。
查看计划不下载源码、不导入工作树、不取得施工写权。
“已共享”需要各端显式配置发布范围和独立凭据；不是无认证全库广播。

## 已实现

- Hub 普通来源目录：独立 CatalogSourceStore，完整清单原子 CAS 替换、来源绑定设备、最新请求幂等。
- 来源发现、来源清单/Todo、已接续工程目录/计划详情网络接口。
- `catalog:read` / `catalog:publish` 与原源码下载、注册、写租约权限分离。
- `catalogOriginIds` / `catalogProjectIds` 为目录可见范围；`catalogPublishSourceIds` 为可发布来源。
- 已接续工程从 Hub 已发布 bundle 投影，详情游标绑定 revision、bundleHash 和计划快照。
- CatalogInventory 在发送前过滤数据库额外字段，不把根路径等原始字段发送到 Hub。
- CatalogCollect 在一个 deferred 只读事务中采集工程和 Todo，包含软删除；过渡状态拒绝整批，全球绑定工程不作为普通来源重复发布。
- CatalogPublishJournal 在网络发送前冻结载荷、请求 ID、基准版本；丢回执重启后重发原请求，不自动抬高版本解决冲突。
- CatalogPublisher 单飞、有界循环、停止排空；权限和冲突错误停发，网络类错误保留请求。
- 独立 `CATALOG_CONFIG_PATH`，默认关闭。JSON read 可单独启用；publish 需 sourceId、journalPath、allProjects=true。
- CatalogHost 接真实 ProjectForgeService 生命周期，启动补齐、changed 事件与轮询发布，退出先停发布再关日志和业务库。
- gui.listUnifiedProjects / getUnifiedProject 与现有 IPC 接通；旧同步本地 gui API 不改变。
- 面板请求 includeCatalog=true，显示来源、只读、获取时间、离线标识、截断提示；远端不伪造代码历史。
- 本地/远端身份去重不依据名称或短 ID。远端独立 remote: ID。
- IPC 与服务 GUI 门面都拒绝远端 ID 进入本地删除、回退、节点、历史接口。
- 列表、详情、节点迟到响应防覆盖保护。
- 缓存仅进程内：远端列表和最多16项详情，断网标明过期；权限/协议错误清缓存。客户端重启后不保留缓存。

## 已验证证据

最新选定回归：
`C:\Users\shenb\AppData\Local\Temp\forge-catalog-selected-final-b4750c8c8764412ea29bbd191b1bf41d`

- test-files.json：21份测试文件。
- tests.tap：378/378，失败/取消/跳过均0。
- status.json：原生退出码0。
- 包括12份 catalog 测试和9份原有 Forge 网络、Bundle、Hub、接续、宿主、可用性、往返、IPC及基本操作测试。
- 不与之前134、66、44等重复轮次累加。
- 实际 ForgeService + 真实回环 HTTP + 临时SQLite + 合成凭据已验证自动发布和统一详情。
- 面板测试执行实际脚本，但使用 VM 模拟 DOM；不是实际 Electron 窗口视觉验收。
- renderer node --check 曾通过。
- 最后 Git diff --check exit0，仅LF→CRLF提示；不涵盖未跟踪新文件。
- 文档写入前：12个tracked修改、24个untracked新文件，index为空。
- 本文创建后文件数增加1，不改变已测实现。

失败及修复：
- b156：测试清理顺序先删目录后关SQLite导致EPERM；统一fixture按服务器→目录库→其他库→目录关闭。
- b182：测试关闭后误读business.db.open，实际close将db置null；保存句柄并同时验证closed与null。
- b193–b194：直接gui.deleteProject远端ID原返回noop而不拒绝；新增服务层硬拒绝并验证数据库字节与事件不变。
- PowerShell Start-Process曾获取空ExitCode；后续全部用直接.NET Process句柄取退出码。
- PowerShell将Git stderr行尾提示视为终止错误；后续通过.NET Process独立采集stdout/stderr和退出码。

## 接续优先顺序

1. 不重做已通过的底层实现。先重新确认Git状态和真实加载端。
2. 真实 Electron 隔离窗口：加载实际页面，注入合成API或隔离服务，不接生产凭据；检查远端选中、只读/离线提示、标签隐藏、切回本地、删除不出现、布局及脚本错误。保留截图/结果并关闭测试进程。
3. 最终审查新增与已跟踪文件、全调用链及契约。重点：
   - 并发列表刷新/详情/权限撤销时，旧请求能否回填已清除的缓存。
   - 页间版本变化、项目由普通转接续、来源授权变化时的去重与缓存失效。
   - 资源容量、全量扫描预算与UI刷新频率；detail缓存目前仅数量上限，不是总字节上限。
   - 发布journal/source DB恢复后的冲突处置；不得静默抬版本或丢弃未确认请求。
   - 普通清单移除/硬删除、原本已缓存同源计划的短暂陈旧边界。
   - 配置与journal文件身份/路径绑定、同进程或多进程重复宿主使用同journal的边界。
   - 独立目录与自动接续同时启用、启动失败/退出的真实组合覆盖。
4. 复查旧IPC调用方兼容及新目录配置GUI-only启动分支，补必要定点测试。
5. 写部署交付说明、核验候选文件清单与回退材料，再按授权受控发布/部署。不要以本文件作为生产执行许可。
6. 更新Todo与正式报告；实际公司→家中/服务器可见性另验。

## 部署边界

服务器现有入口曾只读查看：
`C:\VCP\ClaudeBridge\operations\forge-daily-pilot-cutover-20261017-01\fixed-hub-entry.cjs`
它是旧单试点接线，不是可直接重放的新版安装器；当前PM2实际入口还需上线前重核。

服务器插件与客户端路径、宿主依赖、manifest不同，禁止整目录覆盖。
目录库需宿主显式创建并注入HubNetworkServer；本轮未替换服务器入口或生产配置。
保持每端独立身份、独立发布日志；不复制令牌、租约、业务库或设备身份来凑统一。
公司端尚未接入，不宣称全设备已经可见。

## 后继验收更新：b198–b213（以本节为当前状态）

本节覆盖上文相应历史停点，不改变“未提交、未部署”的边界。

### 真实窗口

- 独立入口 `scripts/test-forge-catalog-window.cjs`；Electron 44.0.0，加载实际 HTML/CSS/页面脚本，合成API、隔离userData/session，无生产IPC或业务库。
- 成功证据：`C:\Users\shenb\AppData\Local\Temp\forge-catalog-window-recheck-d34e48fe8df54874afc142e3b4f70c2c`。
- result.json ok=true；process-result.json 原生exit0，测试进程退出；stderr为空。
- remote-online.png、remote-offline.png、local-return.png 保存；后两张已实际读取核对。
- 远端只读、实际计算样式的标签隐藏、文本转义、截断标识、离线提示、切回本地控件及窗口宽度检查通过。合成API没有调用删除/节点/历史/回退；测试session未观察到被拦截的网络请求。这不是OS级网络沙箱证明。
- 首轮失败保留在 `forge-catalog-window-d3230805069c4426b2d47dbc33c8adb5`：Rust模式缺少CodeMirror simple扩展，另截图UnknownVizError。补HTML依赖顺序及绘制等待后通过；未独立证明截图错误的唯一根因。
- 此为真实页面配合成API验收，不是生产多端或真实IPC全链路视觉验收；Git/源码API刻意不暴露。

### 修复与新增验证

- b199：加载 `addon/mode/simple.js`，修复真实Rust模式报错；增加加载顺序回归。
- b202–b205：确定性反例复现clear后刷新回填、详情ABA、旧详情清除新目录。浏览器对象身份代次检查覆盖网络返回与提交，宿主拒绝旧代次写缓存；明确FORBIDDEN/UNAUTHENTICATED仍清缓存。修复前失败证据保留，不把失败轮次算通过。
- b206–b207：统一列表网络等待期间退出或重新初始化，迟到成功/失败均拒绝，不调用store重新开库。
- b208–b209：详情缓存同时限制16项和8MiB UTF8 JSON内容；超大详情正常返回但不缓存。不是实际V8堆内存上限，仍仅会话内缓存。
- b210：只读目录与文件配置自动接续共存、无额外租约、正常退出交权；无效目录JSON在接续启动前拒绝。
- b211–b213：合法目录配置但日志损坏导致宿主构造失败时，取消已排队接续启动；立即cleanup或等待取消两种时序均零身份请求、零注册/租约。保留写绑定，不删除标记解锁。GUI-only独立目录和混合配置的就绪入口已覆盖。
- 尚未以此宣称正常“目录发布+接续”组合全链路覆盖，不能用只读组合测试替代。

### 当前选定回归身份

`C:\Users\shenb\AppData\Local\Temp\forge-catalog-reviewed-edba66d6479b48459ca05ee1de57c6ae`

- 21份文件，392/392；失败/取消/跳过均0，原生exit0。
- status.json completedAt：2026-10-21T01:41:06.7951916+08:00。
- 基线HEAD仍 `1edcacf2304afb24164e79f66d5f73883d5c2fce`。
- source-sha256.json记录40个候选文件；测试前后摘要及Git状态一致，index为空，tracked diff --check exit0。
- tracked.diff、git-status.txt、test-files.json、tests.tap、stderr.txt保存。
- 本文追加在该次冻结之后，属于文档变更；不能宣称当前本文仍匹配旧清单摘要。实现未因本文改变。
- 392替代旧378作为当前选定回归计数，不累加历史重复轮次；真实窗口烟测单列。

### 下一停点

优先完成发布日志路径/文件身份、同journal多宿主边界及正常发布+接续组合审查，再做最终新增文件差分审查和服务器宿主适配方案。
尚未提交/推送/部署；服务器和公司端真实目录可见性未验收。保持active，不重放旧维护脚本。