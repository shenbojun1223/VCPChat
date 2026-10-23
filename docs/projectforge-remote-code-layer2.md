# Forge 远端代码查阅：最近节点快照

## 施工定位

- 家中工程 `pui7g`。
- 隔离根：`D:\VCP\VCPChat-ForgeNetwork\.integrations\remote-code-20261022`。
- 基线：`4d7d92aa020bd1bb32863e3f2b2f2785debdd6dd`，detached worktree。
- 实现及测试截至 b268；本文为后续文档节点。
- 未提交、未推送、未部署；未修改生产配置、凭据、数据库或租约，未重启生产。
- 功能及最终限定差分审查已完成，最新结论见文末；源码发布、生产部署及真实跨设备验收尚未完成。

## 用户能力

普通来源的“改动文件”可点击读取当前发布版本中该文件最近登记节点的前后快照，并用现有 CodeMirror MergeView 只读展示。

这不是远端实时磁盘读取，也不是任意文件浏览、完整历史搜索或全仓同步。
不导入工程、不申请写租约，不开放远端回退。
global 接续工程仍未支持此代码查阅入口，不借用 bundle 下载绕过权限。

来源端预先发布显式允许共享的快照；浏览端点击后才按需下载。
源码不进入普通目录/工程说明响应，不做浏览端离线源码缓存。
目录版本变化拒绝旧请求；刷新、关闭、切换工程使迟到结果失效。

## 显式共享与权限

受信配置 `publish.codeSnapshots` 默认关闭，必须是布尔值。
开启要求 `publish.engineeringDetails=true`，沿用 `allProjects=true` 的来源级范围。
目前没有单工程/单文件代码共享选择器：启用前必须审查整个来源的普通工程共享范围。

- 发布：`catalog:publish` + `catalog:code:publish`，并满足 `catalogPublishSourceIds`。
- 读取：`catalog:read` + `catalog:code:read`，并满足 `catalogOriginIds`。
- 旧权限不会自动升级；来源/工程/节点 ID 和摘要均不是授权凭据。
- 不自动检测或脱敏历史源码中的密钥。旧快照可能包含后来已删除的秘密。
- 关闭共享阻止尚未确认的 v3 请求重发，但保留冻结日志；不删除 pending、不改请求 ID。
- 关闭开关不是撤回已下载内容。权限撤销及已有共享数据处置需单独执行受控流程。

## 协议与存储

- 独立 v3 封套 `{version:3, records, details, codes}`，共享一个来源 CAS 版本及完整摘要。
- `/v1/catalog/code/publish` 发布；不降级到 v1/v2 路由。
- `/v1/catalog/code/detail` 只读 POST，固定 sourceId/localProjectId/version/digest/node。
- 字节分页使用 canonical base64，检查页连续性、总长度、最终身份绑定摘要、UTF-8 和快照文本 SHA-256。
- 返回 `binding.version` 为发布版本；外层 `version=1` 为快照格式版本，两者不混用。
- 复用持久发布日志的原请求重放、回执确认及 CAS；旧接口返回结构不含代码。
- 库表未改变不代表旧程序能读 v3：旧 Hub/发布日志实现不支持新封套，不可直接回切旧程序或回卷数据库。

## 有界范围

- 工程说明预览最多 100 文件；每文件仅最近节点的前后快照。
- 每侧原文最多 16 KiB；超过上限返回 too-large，不返回截断文本冒充全文。
- binary、unsupported-encoding、absent 与空文本明确区分。
- 单工程代码 JSON 上限 4 MiB；完整来源载荷仍受 32 MiB 限额，超限拒绝整次发布。
- 单节点分页组装上限 256 KiB；块最多 4096 字节，响应按实际 JSON 大小限制。
- 超大快照仅读取元数据，不验证被省略的正文摘要，不能宣称其正文完整性已核验。
- 同步 SQLite、JSON 验证及散列仍有 CPU 成本；未做大型真实来源性能验收。
- 发布版本读取与分页继续复核完整来源，未新增长期源码缓存或通用内容存储平台。

## 真实 gzip 集成缺陷与修复

首版简化夹具将 blobs.data 当作原始字节，遗漏真实 ProjectStore 的 gzip 存储格式。
新增真实库回归后复现 1 pass / 2 fail，exit 1。失败证据保留：
`D:\VCP\Handoffs\Evidence\forge-code-gzip-before-31f7e5156fe54091bc4abb9b5dc47577`

b263 修复：读取压缩长度与原文 size，限制压缩输入到 blobBytes+1024，
gunzipSync 设置 maxOutputLength=blobBytes，解压后检查 size 与 SHA-256。
简化夹具改用 gzip，但没有降低原有断言。真实 ProjectStore 创建、空文本、
二进制、超大文件、损坏 gzip、解压超限反例通过。

## 验证证据

### 最终统一选定回归

目录：
`D:\VCP\Handoffs\Evidence\forge-code-final-d4d4e764c95d41b6a2f0c19c8c9f1185`

- 26 份测试文件，249/249，通过；fail/cancelled/skipped 均 0，exitCode=0。
- `result.json` 保存测试列表；`tests.stdout` 为结果日志。
- `source-before.json` 记录测试前 27 个改动文件摘要；结果 sourceUnchanged=true。
- 范围：catalog 测试集合、网络及宿主接线；不是全仓测试。
- 使用现有 Electron 的 Node 模式与 NODE_PATH 解析现有依赖，无安装/重建。
- tracked `git diff --check` 成功；不代替未跟踪文件及整体交付差分审查。
- 不将此前 77、66、62、31、27 等重复/交叠轮次累加。

### 实际 Forge 自动发布与独立 HTTP 读者

包含在最终 249 项内：
正常 CreateProject/CreateFile/EditCode → gzip 快照采集 → 自动发布 → 独立 CatalogHost
经回环 HTTP 读取正确前后文本；更新后旧版本拒绝；无全局工程注册和写租约。
合成库与凭据，不是生产跨设备验收。

### 真实 Electron 页面

目录：
`D:\VCP\Handoffs\Evidence\forge-code-window-recheck-87afec11a60c45a19ecbbe9a8dff530a`

- Electron 44.0.0，实际 HTML/CSS/JS + 合成 preload API。
- `exit.json` exitCode=0；`window/result.json` ok=true。
- errors=[]、blockedNetwork=[]。
- 实际点击文件按钮，真实 CodeMirror 前后文本及两侧 readOnly 校验通过。
- 禁用回退按钮，直接调用回退/本地节点函数亦零本地操作；关闭清理通过。
- `window/remote-code-diff.png` 已读取目视核对。
- profile/session 为独立证据目录，不接生产 IPC。
- 仅将 CodeMirror 5.65.19 复制至隔离 node_modules，逐文件散列核对通过；未改运行中依赖。
  页面 Markdown 与 Diff 库使用仓库 vendor 文件。此为借用依赖烟测，不证明全新安装复现。
- 首轮窗口因继承旧文案断言失败；证据保留于
  `forge-code-window-6425b7302237415992e043ce17e2cd95`。
  首轮退出码记录为 null，不能解读为成功。修正测试断言后取得明确 exit 0。
- 页面“不包含源码”旧提示同步修正为独立共享授权说明。

## 下一步

1. 最终审查 27 个源码/测试/脚本文件及本文，复核发布撤销与权限、IPC调用方策略及交付白名单。
2. 按授权固定独立交付提交，不全量暂存主工作树，不提交依赖、证据、配置、数据库。
3. 生产启用另行核对目标宿主与加载路径，先升级 Hub 再升级客户端，默认不开启 codeSnapshots。
4. 明确来源共享范围及读写授权后，再做真实跨设备读取验收。
5. 不将源码查阅验收视为跨机接管续写验收。

## 最终审查收口（后继 b270）

本节覆盖上文“下一步”第1项及早期尚未审查的阶段描述。
- 已核查产品差分、新增快照/封套/分页模块及测试/窗口脚本，未发现本轮交付阻断项；不承诺全仓无缺陷。
- main.js 将 projectForgeHandlers 注册到 guardIpcMain + projectForge 领域守卫。
  新增 get-remote-code 自动继承主窗口及 Forge 实际顶层窗口限制，不属于 open 通道。
  applicationSender 检查真实 senderFrame/mainFrame、窗口类型、应用绝对路径；
  论坛窗口、webview、子 frame 拒绝测试通过。没有修改或放宽窗口策略。
- 新增两项 v3 宿主反例：远端提交但丢回执后关闭共享，重启零重发、冻结日志原字节保留；
  显式重新启用后仅重试原请求，不多推进版本；已确认 v3 关闭共享则以 v2 推进同一版本计数。
  已提交内容不会因关闭本机开关立即撤回；已下载内容也不能远程收回。
- 没有开放任意路径、任意 blob hash 或远端写入口，源码不作为离线缓存回退。
- 工程施工范围为29个文件：18个既有文件修改、11个新增文件（含本文）。
  node_modules 中的隔离 CodeMirror 副本、仓库外证据、配置、数据库不在交付清单内。

### 最新统一验证（替代249项作为最终测试数字）

证据：
`D:\VCP\Handoffs\Evidence\forge-code-reviewed-0e22ce00ed6c40b18ddb87112181563f`

- 28份测试文件，269/269通过，exitCode=0，fail/cancelled/skipped均0。
- 包含新增共享关闭测试及 side-pane-ipc-sender/state-subscriptions 两份回归。
- `result.json`：sourceUnchanged=true，deliveryFileCount=29，diffCheckExit=0。
- `delivery-manifest.json` 固定测试前29文件SHA256；测试期间原字节不变。
- 本节是测试后的文档更新，因此旧清单中本文摘要不再代表最新文档；
  产品源码与测试未在该验证后修改，最终交付时需重新固定包含本文的新清单。
- 暂存区为空。没有生成源码提交、推送远端、改生产配置或部署。
- 真实窗口沿用前述Electron44成功证据；本轮只增加测试和文档，没有改变已烟测UI。
- 269为本轮选定范围，不是全仓测试，也不与此前重复轮次累加。

本轮研发及限定审查完成，工程可进入 review（待验收）。
后续是明确授权下的独立源码发布，再单独确认生产共享范围和受控部署。

## 2026-10-23 源码读取来源独立授权补丁

公司接入时发现：目录凭据可读多个来源，仅增加 `catalog:code:read`
会把源码读取权扩大到所有目录来源。新增受信 principal 字段
`catalogCodeOriginIds`，缺省为空集，显式空集同样拒绝源码读取。

代码读取须同时具备 `catalog:read`、`catalog:code:read`，
并同时命中 `catalogOriginIds` 与 `catalogCodeOriginIds`。
新增字段沿用来源标识及数组上限校验；请求体不能注入白名单。
目录、工程说明、发布权限及全局工程写权不受此字段影响。
旧代码读取凭据升级后须显式配置白名单，否则拒绝读取，不继承目录范围。

本次授权配置目标：公司保留三个来源的目录读取，
源码白名单仅 `server-forge-plans`；服务器仅对该来源增加代码发布权限。
不启用公司或家中源码发布，不授予工程接管写权限。

公司真实HTTP权限、自动发布集成及原网络回归共75/75通过，exit0，
失败/取消/跳过均0；测试期间源文件未变。
证据：D:\VCP\Handoffs\Evidence\forge-code-scope-BPo67n。
这是本机补丁验证，不代表服务器已加载或真实共享已启用。

## 2026-10-23 公司部署与实际页面验收收口

本节覆盖前文“尚未部署、尚未开启共享”的阶段状态；不改变历史测试范围。

### 已部署与权限边界
- 服务器先部署 f699b20f 的14模块，再部署独立源码来源白名单补丁。
  两次独立维护均退出0、健康检查通过，各有冷备和10份SQLite校验副本
  quick_check结果；没有回卷生产数据库。
- server-forge-plans 开启工程说明及代码快照共享，发布版本2→3，pending=false。
  公司凭据保留服务器、公司、家中三个目录来源，源码白名单仅服务器来源。
  未开启公司或家中源码发布，未新增全局工程写权。
- 公司运行目录完成31文件增量更新并完整重启；原HEAD与索引未变，
  72登记保护文件不变，实际目录12份针对性测试86/86通过。
  这是工作文件更新，不是个人主分支快进。
- 公司经真实HTTPS读取服务器5个普通工程说明；4个有文件记录的工程抽样
  读取快照，文本字节数及SHA-256核验通过，另一工程为空文件清单。
  超限内容明确too-large，不宣称验证了省略正文。
- 公司、家中来源目录仍可读，源码请求均返回FORBIDDEN。

### 页面暴露的问题及修复
首次用户截图暴露文件名白块及CONTENT_NOT_FOUND，不能把先前HTTP验证
当作GUI已通过。白块来自按钮继承浅色文字却保留原生浅色背景；
CSS明确透明背景、主题文字、hover和键盘焦点样式。

窗口回焦会刷新列表，CatalogHost.listRemote清空详情缓存，
页面却仍显示原详情。旧getRemoteCode强制依赖缓存，导致点击失败。
真实HTTP集成测试先复现exit1/CONTENT_NOT_FOUND，再修改：
- 校验请求字段、当前来源条目及版本/摘要。
- 缓存缺失时在线读取同一固定版本的说明，不保留源码或新增缓存。
- 重取说明后复查关闭状态与generation，再读取源码。
- 旧版本、跨代迟到响应、权限撤销和网络失败继续拒绝。

六份相关测试52/52通过；不与75或86项交叠轮次累加。
公司真实HTTPS执行“详情→列表刷新清缓存→读取Diff”通过；
pyemj的src/slug.js，节点10、版本3，前后133/180字节及摘要一致。
用户再次完整重启后提供截图：文件名可见，实际CodeMirror前后两栏、
删除新增高亮显示正常，页头远端只读，回退控件呈禁用。
截图证明实际展示；禁止写入还由已有入口隔离测试支撑，不夸大为长期零故障。

### 证据与换机说明
- 服务器基础部署：C:\VCP\ClaudeBridge\operations\forge-code-deploy-20261023
- 权限及共享启用：C:\VCP\ClaudeBridge\operations\forge-code-scope-enable-20261023
- 公司更新：D:\VCP\Handoffs\Evidence\forge-code-company-install-20261023
- 实际跨来源读回：D:\VCP\Handoffs\Evidence\forge-code-live-read-K5j46m
- 失败复现：D:\VCP\Handoffs\Evidence\forge-code-cache-red-mKtaC6
- 修复回归：D:\VCP\Handoffs\Evidence\forge-code-cache-green-rxRFQ2
- 实际缓存缺失复测：D:\VCP\Handoffs\Evidence\forge-code-cache-live-TisUVq

后继交付限定7文件：hubNetworkServer.js、catalogHost.js、projectforge.css、
三份catalog代码网络/浏览器/服务测试及本文。
权限补丁已在服务器生效；catalogHost缓存修复和样式修复在公司客户端生效，
尚未同步家中，服务器的只发布宿主也未更新缓存修复。
换机只更新已确认差分，不复制凭据、数据库、node_modules或仓库外证据；
家中源码读取授权并未开启，不能以拉取源码代替授权。
本节写入时后继Git提交推送尚未完成，最终SHA以交付回执为准。