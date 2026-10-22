# Forge 远端工程说明：第一层

工程：公司 `phtsj`，根 `D:\VCP\VCPChat`。
本说明对应实现截至 b105/n111，后续本文本身是文档节点。
状态：实现、隔离验证、静态审查及证据复核完成；实现已固定为33e95b42，交付分支推送状态须以远端回执为准。生产部署与真实跨端验收未完成。文中早期“未提交”表述为阶段记录，最新源码交付信息见文末。
本说明不是生产执行许可，禁止重放历史维护脚本。

## 用户可用能力与范围

普通来源目录在发布端显式开启后，共享：
- 验收报告文本及提交者；
- 最近施工批次摘要、节点数量、增删统计和相对路径预览；
- 变更文件清单与来源节点标识。

查看不取得写租约，不下载源码、快照正文或完整节点 Diff。
来源节点/批次 ID 只作来源内标识，不用于查询本地记录。

本层仅支持普通来源（source-kind）。
global 接续工程明确返回 `global-detail-not-supported`，不自动从 bundle 公开工程说明。
完整历史搜索、Diff/源码按需读取与公司接管续写仍是后续层次。

## 显式共享

受信发布配置新增可选布尔字段：

```json
{
  "publish": {
    "sourceId": "example-plans",
    "journalPath": "D:/Private/example-publish.db",
    "allProjects": true,
    "engineeringDetails": true
  }
}
```

此片段不是完整配置，也未写入任何生产配置。
缺省保持旧 v1 发布；不接受字符串 `"true"` 等 truthy 值。
开启适用于该来源全部被授权的普通工程；目前没有单工程详情共享选择器。
原工程授权、过渡状态拒绝与全局绑定排除保持。

白名单过滤不输出根路径字段、快照正文等额外字段；它不是自由文本秘密检测。
报告、批次原因、Todo 备注里手写的密钥、绝对路径或私密信息不会自动脱敏。
开启前须确认真实共享内容范围。

关闭开关会阻止尚未确认的 v2 请求发送，并保留原冻结日志报阻断。
关闭不是撤回已发布内容；不能删除 pending 或伪造确认来解除阻断。
已经确认后下一次合法 v1 完整清单可替换当前来源内容，但并不等于其他端会话缓存立即撤销。
需要撤销访问时按真实认证权限处理，不把共享开关冒称全端撤回按钮。

## 一致性、限额与协议

- 报告、Todo、施工摘要在同一 deferred 读事务中采集。
- v2 完整封套 `{version:2, records, details}`，同一个来源版本计数和 CAS 原子发布。
- 原 v1 数组规范化字节和请求路径保持。
- 发布日志先冻结完整载荷、请求 ID 和基准版本；丢回执重启后重试原请求，不改内容或抬版本。
- 独立发布路由 `/v1/catalog/engineering/publish`。
- 独立读取路由 `/v1/catalog/engineering/detail`：
  必须携带 sourceId/localProjectId/version/digest/section；
  section 为 report/timeline/files，cursor/limit 可选。
- 继续使用 catalog:publish/catalog:read 及其来源作用域；
  工程说明没有额外独立读权限，开启共享意味着该来源获授权目录读者可以读取说明。
  不继承 bundle/read/write/register 权限。
- 客户端不在增强接口失败后退回旧发布路径，避免静默丢失详情。
- 所有栏目绑定来源版本、摘要、工程身份和同一内容快照；
  浏览器检查片段连续性、分页进度并重算最终快照。
- 保留现有缓存数量/字节预算和代次失效机制；
  授权/协议失败不当成离线，迟到响应不回填旧缓存。
- 未共享、接口或资源不可用、已共享但为空分别表示。
  首次 NOT_FOUND 仅表示入口或资源不可用，不推断服务一定旧、不伪称未共享。

当前预览上限：
- 报告 8192 UTF-16 code units；
- 最近批次 20；每批次路径 20；
- 文件清单 100；路径 512 字符；
- 单工程详情 JSON 128 KiB；
- 完整来源载荷仍受 32 MiB 限额；
- 单页 JSON ≤32 KiB，响应封套另预留预算；
- 报告按1024字符安全分片，截断和总数明确标记。

这些是有界预览，不是全部记录无损同步。
SQL返回数量有界，但精确总数聚合仍与历史规模有关；尚未完成大型真实来源性能验收。

## 页面与只读边界

共享详情开放概览、开发脉络摘要、改动文件清单、验收报告四个标签。
历史搜索仍关闭。
远端使用独立无点击操作锚点模板，不带本地 data-node/data-batch/data-file。
toggleBatch/openNode/历史搜索仍拒绝远端。
报告按转义纯文本呈现，不渲染报告中的 HTML/图片/脚本。
保留来源版本、获取时间、离线缓存与截断提示。
未改既有目录卡片部署 pfkoc/b66 的来源筛选能力。

## 验证证据（公司机）

统一选定回归：
`C:\Users\JOSHUA~1\AppData\Local\Temp\forge-engineering-integrated-bY7cNv`
- 20份测试，201/201，exit0；
- fail/cancelled/skipped均0；
- 源码和测试摘要前后不变；
- 运行期间HEAD/index/status不变；
- tracked diff --check exit0，不等于未跟踪文件全部已审查；
- 不累加此前重复测试计数，不称全仓验收。

独立实际 Electron44 页面 + 合成API：
`C:\Users\JOSHUA~1\AppData\Local\Temp\forge-engineering-window-recheck-ljtHBY`
- renderer及window进程exit0，result.ok=true；
- errors=[]、blockedNetwork=[]；
- 四只读标签实际可切换，报告HTML转义、长路径换行、离线/截断提示、零本地历史调用；
- engineering-report.png及engineering-files.png已读取目视核对。
- 初次 `forge-engineering-window-N1RAw5` 暴露switchTab旧远端概览限制；
  修复b103并补b104回归，失败证据保留。

真实 ForgeService 普通工具→自动发布→回环HTTP→独立读者：
`C:\Users\JOSHUA~1\AppData\Local\Temp\forge-engineering-service-e2e-aS1uj3`
- 单项端到端测试exit0；
- CreateProject/CreateFile/SubmitReport及报告更新自动到达只读端；
- 无手动发布，源码正文未出现在目录返回；
- hub_projects和hub_lease_requests为0；
- 临时SQLite/合成凭据，不是生产跨设备验收。

## 部署顺序与回退限制

1. 最终审查本任务差分及新增文件，固定交付清单；保留公司原修改和私有配置。
2. 核对服务器实际Hub和插件加载目录、源码差额、备份/恢复入口；
   服务端manifest、依赖、身份配置不得整目录覆盖。
3. 先让Hub支持增强协议，再部署读者与发布者。
4. 默认不开启真实engineeringDetails；确认共享范围后再开启。
5. 真实新来源读回报告/批次/文件，验证来源版本一致及原只读边界。
6. 家中离线或未升级时不得宣称家中报告已共享。
7. 最后更新工程Todo、报告和源码交接。

表结构未变不等于旧代码可读新数据：
- v2封套进入 publisher journal 或 catalog_sources.payload 后，
  旧实现只识别v1数组，不能直接切回旧二进制读取这些载荷。
- 旧客户端仍可从新版Hub读取旧形态目录/Todo响应；
  这不意味着旧Hub可打开已存v2的目录库。
- 回退必须保留已发布版本、待确认请求与审计证据；
  不回卷线上数据库、不删除日志或降低版本计数来凑兼容。

本轮尚未提交或推送源码；实际公司磁盘已修改，不代表常驻进程加载了新实现。
服务器未部署，生产凭据/共享配置/租约未更改，也未重启服务。
不得将本轮201项隔离回归或合成截图说成生产验收完成。

## 最终静态审查与交付清单（2026-10-22，公司）

本轮确认执行端 JOSHUASHEN-PC6，工程根 D:\VCP\VCPChat，
personal/main HEAD=6e5ea72460512658e735926f5b6a7aa9837c418a。
默认工作区为旁侧 forge-sync，不作为本工程施工目标。

本任务履历 b67 至 b106 的 30 个文件已完成静态差分及新增文件审查，
目前未发现产品代码阻断项；这不是完整兼容性、性能或生产验收。
本轮未重跑测试，不将上一轮201项重复计数。
下列白名单为交付范围，不等于已提交或已发布。

### 产品源码：15个

- ProjectForgemodules/projectforge.js
- VCPDistributedServer/Plugin/ProjectForge/catalogBrowser.js
- VCPDistributedServer/Plugin/ProjectForge/catalogCollect.js
- VCPDistributedServer/Plugin/ProjectForge/catalogConfig.js
- VCPDistributedServer/Plugin/ProjectForge/catalogHost.js
- VCPDistributedServer/Plugin/ProjectForge/catalogPublishJournal.js
- VCPDistributedServer/Plugin/ProjectForge/catalogPublisher.js
- VCPDistributedServer/Plugin/ProjectForge/catalogSourceStore.js
- VCPDistributedServer/Plugin/ProjectForge/catalogView.js
- VCPDistributedServer/Plugin/ProjectForge/hubNetworkClient.js
- VCPDistributedServer/Plugin/ProjectForge/hubNetworkServer.js
- VCPDistributedServer/Plugin/ProjectForge/catalogEngineeringCollect.js（新增）
- VCPDistributedServer/Plugin/ProjectForge/catalogEngineeringDetail.js（新增）
- VCPDistributedServer/Plugin/ProjectForge/catalogEngineeringInventory.js（新增）
- VCPDistributedServer/Plugin/ProjectForge/catalogEngineeringPages.js（新增）

### 测试：13个

- tests/project-forge-catalog-browser.test.js
- tests/project-forge-catalog-config.test.js
- tests/project-forge-catalog-host.test.js
- tests/project-forge-catalog-renderer.test.js
- tests/project-forge-catalog-service.test.js
- tests/project-forge-catalog-view.test.js
- tests/project-forge-network.test.js
- tests/project-forge-catalog-engineering-collect.test.js（新增）
- tests/project-forge-catalog-engineering-detail.test.js（新增）
- tests/project-forge-catalog-engineering-inventory.test.js（新增）
- tests/project-forge-catalog-engineering-journal.test.js（新增）
- tests/project-forge-catalog-engineering-pages.test.js（新增）
- tests/project-forge-catalog-engineering-source.test.js（新增）

### 验收脚本与文档：2个

- scripts/test-forge-engineering-window.cjs（新增）
- docs/projectforge-engineering-detail-layer1.md（新增，本文）

合计18个已有文件修改、12个新增文件。不得全量暂存dirty工作区。
projectforge.js叠加既有卡片接入；本层增量须相对卡片基线
46f908037fafd5f5dab91741dc9d1380ed475970审查，不能把整份HEAD差异归为本层。
卡片JS/CSS/HTML实测磁盘blob与该提交原字节一致；不重做pfkoc/b66部署。
Git相对其他提交比较时，当前索引未跟踪的卡片模块曾显示为删除，
但磁盘文件存在且摘要匹配，不据此执行恢复。

### 保护证据与未完成项

本轮指纹检查点：
D:\VCP\Handoffs\Evidence\forge-engineering-review-6caff2c6cfe443d385aaae3d7d324fa1\delivery-review-checkpoint.json

记录30个交付文件、13个既有源码保护项的SHA256/大小、HEAD、
索引摘要、Git状态及三份卡片基线blob。
该检查点建立于本轮只读审查之后、本文追加之前；
不是本任务实现前的保护基线，也不是完整工作区备份或恢复演练。
未复制或读取私有config.env正文；运行数据与其他未列文件不属于13项源码保护证明。

此前三处Temp测试证据被FileOperator目录白名单拒绝，未通过其他通道绕过读取。
随后用户将三组目录复制至允许的D:\VCP目录，已完成目标端证据读取与源码绑定核对；
Temp原件未读取，未执行原件与副本的复制前后摘要比较，原结果中的历史路径不改写。

### 用户复制后的测试证据复核

证据根：
D:\VCP\Handoffs\Evidence\forge-engineering-tests-20261022

三个子目录：
- forge-engineering-integrated-bY7cNv
- forge-engineering-window-recheck-ljtHBY
- forge-engineering-service-e2e-aS1uj3

复核结果：
- 统一回归日志：20份测试，201/201；fail/cancelled/skipped均0，结果记录exitCode=0。
- 实际Electron44合成API窗口：renderer/window退出码均0，window/result.json与日志均ok=true，errors及blockedNetwork为空。
- 独立服务闭环日志：1/1，失败/取消/跳过0，结果记录exitCode=0；此项与统一回归重叠，不累计为202项。
- 当前磁盘逐项SHA256核对：统一清单69项、窗口4项、服务44项全部一致；
  117条绑定记录实际覆盖69个唯一源码/测试路径，不表示完整依赖闭包均已盘点。
- engineering-report.png与engineering-files.png已重新读取目视核对：
  HTML标签显示为文字，长路径换行，来源版本、离线缓存和截断提示可见；
  不执行脚本及零本地历史调用结论依赖窗口断言，不仅凭截图。
- 本次未重跑测试、未执行历史维护脚本；源码HEAD仍为6e5ea72460512658e735926f5b6a7aa9837c418a。

绑定清单：
evidence-binding-cc9e711e616d46889b8f3b3e5bc7e78c.json
SHA256：E9CFC83695CB46EC8D76CF0837485F4BC0FF0C1A867406325FABD52D1CF5A83E

该清单位于上述证据根，记录22份复制后的结果/日志/截图的摘要与大小，
以及117条源码绑定记录；写入后已回读校验数量。
不包含Electron profile/session或fixture preload，不是全目录备份；
不证明Temp原件与副本逐字节相等，也不替代生产跨设备验收。

以上为b109/n115阶段记录。后续用户已授权独立交付分支的验证、提交与推送，
不包含合并personal/main、生产部署或开启共享。

## 独立源码交付（2026-10-22）

- 分支：handoff/forge-engineering-detail-layer1-20261022
- 隔离工作树：D:\VCP\Handoffs\forge-engineering-detail-layer1-20261022
- 基线：46f908037fafd5f5dab91741dc9d1380ed475970，继承工作区启动修复及卡片接入。
- 实现提交：33e95b42fae08dda0fcd532cd143380dcca23c93。
- 实现提交仅29个源码/测试/脚本文件，本文单独作为后继文档提交；
  总交付白名单仍为30文件，未重复提交卡片或冷启动修复。
- 提交前后逐文件核对Git blob与已验收源码原字节一致，暂存diff检查exit0。
- 在隔离树重新运行同一20文件选定回归：201/201，exit0，
  fail/cancelled/skipped均0；不与前次201项相加，不称全仓测试。
- 69项测试来源摘要均匹配，测试期间源码与隔离树status未变。
- 本机现有node_modules通过junction借用，package清单文本一致；
  没有安装依赖或重建原生模块，不代表全新安装可复现验收。
- checkout曾将36个已验证基线文件转为CRLF，已仅在隔离树恢复HEAD blob原字节；
  这些文件与基线内容一致但可能仍显示工作树修改，未纳入实现提交。
  不修改全局/仓库Git配置，不清洗公司原工作树。
- 公司原工作树HEAD、索引、Git状态及43个登记文件的摘要保护通过；
  原树保持personal/main@6e5ea724，未切换、暂存或提交。
- 实现提交及隔离回归证据：
  D:\VCP\Handoffs\Evidence\forge-engineering-publication-20261022
  implementation-commit.json、implementation-staged.patch、
  isolated-tests-result.json、isolated-tests.stdout、original-protection.json。
- 隔离TAP SHA256：
  2f2e88df665562e1df3d37bbeffbc47a8e3489269eee808db89ebc85b9a75f59。

本文写入时实现已本地提交，推送尚待执行；不得仅凭本文声称远端已发布。
实际发布须核对远端同名分支最终SHA，且该SHA的实现父链包含上述实现提交。
证据目录不纳入源码提交；私有配置、运行数据、数据库、依赖、截图和临时材料不发布。
生产部署、共享范围及真实跨端详情验收仍需另行确认。
工程继续active，Todo #4保持doing，不提交accepted。