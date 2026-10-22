# Forge 第一层：2026-10-22 下班交接

本页是当日最终状态入口，优先于早期工程记录中“未部署／未共享”的阶段描述。

## 源码交付

- 分支：origin/handoff/forge-engineering-detail-layer1-20261022。
- 第一层实现：33e95b42fae08dda0fcd532cd143380dcca23c93。
- 第一轮文档：e95175ba2084a003cbc3ed3aef0b37a4eb1442ba。
- 本页所在后继提交补入弹层黑屏修复及测试。最终版本以该分支远端 SHA 为准。
- 基线46f90803已经包含c4b0e24c工作区初始化修复和卡片/来源筛选，不重复移植。
- 公司隔离交付树：D:\VCP\Handoffs\forge-engineering-detail-layer1-20261022。
- 公司原树D:\VCP\VCPChat仍personal/main@6e5ea724，原有与其他Agent改动未归入本次发布。
- 未合入origin/personal/main。

## 今天完成

1. 审查第一层30文件，固定交付白名单；复核用户复制的22份测试/窗口证据。
2. 隔离分支提交推送；最终按提交blob绑定69路径，20份选定回归201/201、exit0。重复运行不累加，不称全仓验收。
3. 服务器10_1_0_14更新ServerProjectForge的10个模块、新增4个模块。
   Hub与插件共用该目录，独立计划任务停启forge-hub及vcp-main，任务退出0。
   冷备完成，10份SQLite副本quick_check通过；配置未变、生产数据库未回卷。
   接续试点p4dbb的revision28、内容、元数据和快照检查通过。
4. 按主人单独授权，仅开启server-forge-plans的engineeringDetails。
   来源version1→2，pending=false，启用任务退出0；主服务恢复在线，其他服务未变。
   公司来源engineeringDetails仍关闭。
5. 公司交付版CatalogBrowser通过真实HTTPS读回服务器全部5个普通工程：
   p23nd、pf33h、pgnhc、pr4aa、pyemj均shared，报告/批次/文件三栏重组通过。
   当次版本2摘要c433d8a950f48ea627c49ebf21347f14db060b30a3a8abd98ad4f860b50a7b17。
   pr4aa报告8192字符标记截断，批次20/32；无报告与未共享状态分别处理。
6. 常驻GUI曾反复黑屏。用户诊断：globalSettingsModal已关闭，但overlay仍持有它，
   activeModals为空，原生视图被隐藏。
   复现发现openModal重复调用递增generation，OverlayCoordinator却忽略同名打开事件，
   最新关闭被误拒绝、旧关闭反而可误释放。
   修复仅更新同root的较新generation，保留单个lease及旧关闭拦截；未加轮询。
   新增2个真实ui-helpers集成反例：先失败，修复后三组16/16、exit0。
   用户完整重启后反馈“似乎正常”，随后确认远端各页签均有内容。
   这不等于长期不复发保证；502状态请求未证明与本故障相关。

## 当前剩余任务：统一远端与本地展示

用户已确认功能有显示，但四个页签的格式差别过大，并提供本机/服务器报告对比截图。
原因不是数据损坏：远端单独使用简单只读模板；报告escape后放pre，不渲染Markdown。
本机报告有Markdown标题、列表和表格，远端显示原始标记，观感差。

下一步在客户端做局部展示修正，不扩建共享协议：
- 概览、开发脉络、改动文件、验收报告复用或对齐本机布局、字体和组件样式。
- 报告支持安全Markdown标题/列表/表格/代码块；禁原始HTML、自动远程图片，
  检查现有渲染器及净化配置后复用，不直接放宽为任意innerHTML。
- 摘要外观与本机一致，但来源节点ID仅标识，不挂本地源码/历史/回退事件。
- 来源、版本、只读、截断信息集中展示。
- 不伪造缺失的完整历史、Diff或源码能力。
本项仅讨论并形成方向，尚未实现。phtsj保持active、3/4，不能报整体验收完成。
家中本层尚未部署、尚未实测GUI；global增强说明尚不支持。

## 回家安全接续

两台机器的D:\VCP独立，Git只传源码，不传配置、数据库、工程ID或证据目录。
家中首先确认机器、实际加载目录和git status，不盲目pull覆盖脏工作树。
拉取本次分支（不自动切换当前客户端）：

    git -C D:\VCP\VCPChat fetch --no-tags origin refs/heads/handoff/forge-engineering-detail-layer1-20261022:refs/remotes/origin/handoff/forge-engineering-detail-layer1-20261022

确认旁侧目录和本地分支未占用后，建立独立worktree；已有则核对后复用。
首读本页及docs/projectforge-engineering-detail-layer1.md。
家中Forge工程ID以当地ListProjects为准，不盲用公司phtsj。
运行客户端切换、依赖安装/重建、生产共享开关不是fetch附带动作。
不要复制公司config.env或凭据，也不要跨机搬node_modules。
先核对家中现有catalog配置是否具有服务器来源读取权限，缺少再正常配置。
公司交付树曾因checkout换行留下基线文件dirty，但这些项未纳入发布；不要整树暂存清洗。

## 证据位置（不随Git）

公司：
- D:\VCP\Handoffs\Evidence\forge-engineering-review-6caff2c6cfe443d385aaae3d7d324fa1
- D:\VCP\Handoffs\Evidence\forge-engineering-tests-20261022
- D:\VCP\Handoffs\Evidence\forge-engineering-publication-20261022
  publication.json、committed-verification.json、committed-tests.stdout；
  company-shared-read-1792655547097.json为真实共享读回证据，不含报告正文。
- D:\VCP\Handoffs\Evidence\forge-overlay-fix-7jgw4z
  red-two-cases.stdout、green.stdout、green-result.json。
服务器：
- C:\VCP\ClaudeBridge\operations\forge-detail-deploy-20261022-LRRPKe
  status.json、sharing-status.json、backup-result.json及cold目录。

不要重放上述维护任务，不重做pfkoc/b66卡片部署。
v2封套已进入生产目录库/发布日志，旧代码不保证能读取；
不删除pending、不回卷数据库或降低版本计数来凑回退。
服务器已获授权共享来源内全部授权普通工程的说明，自由文本不自动脱敏；
关闭开关不等于撤回已发布内容或所有读者缓存。