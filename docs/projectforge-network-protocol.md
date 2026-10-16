# Forge 网络检查点协议与独立网络库验收

> 后继候选：`work/forge-autoresume-20261016`，基于 `9f77c05c`。
> 见 [projectforge-autoresume-mvp.md](projectforge-autoresume-mvp.md)：
> 异步网络已接入持久映射、协作写门与后台检查点，本机冻结380/380；
> 尚未真实跨设备/PI验收或部署。下文保留独立网络库阶段的历史范围与证据。
基线 c0d7555e；公司可见 V工程 p2ube，家中接续工程 pvui2；所有网络测试使用合成数据。
本轮不部署常驻插件、不迁移业务库、不上传真实配置、不启用后台调度。

## 边界

- 独立 Node HTTP/HTTPS 服务；默认随机端口、仅 127.0.0.1。
- 非回环监听必须 TLS；客户端拒绝非回环明文 HTTP、重定向、URL 凭证和跨源凭证转发。
- 受信启动配置提供随机 bearer token、deviceId、明确 originIds/projectIds、read/write/register 权限。
  不提供远程管理或密钥写入入口；测试密钥随机生成、不得写入日志/提交。
- holder 必须等于认证 deviceId；origin 注册只许配置允许的 originId。
- 项目读写只许其 originId 或 globalProjectId 在该 principal 允许范围；禁止 wildcard。
- 上传：检查作用域和有效 lease，按并发与正文限额读取，再复查 lease，再存可信内容；
  独立持久网络收据绑定 Hub/内容库身份、projectId/hash，之后才允许网络发布。
  上传不发布；收据不授予租约；不能猜其他工程 hash 直接发布。
- 下载仅 GET 某工程已发布 revision，不提供全局内容 hash GET。
- 内容库、网络收据和 Hub 版本非共同原子；中断留下孤立内容可以重试补收据，
  不承诺断电/旧备份回退。数据保留和 GC 沿用现有限制。
- 请求严格字段白名单、正文/响应长度、连接并发、总时限；拒绝压缩、浏览器 Origin、
  歧义认证头、非预期 Host、查询参数和编码路径；不信任代理头。
- 错误只返回稳定 code，不回显 bearer、leaseId、正文、堆栈或本机路径。
- 客户端固定 origin 和 Hub identity，下载重新检查完整摘要和 bundle。
- 租约获取/续租/释放/发布保留 Hub fence、严格过期、requestId/CAS。
- 断线/超时的写入结果可能已提交；不自动改 requestId 重试，不宣称 exactly-once 网络。
- 远程 I/O 为 async，不把现有同步 ProjectSync 强塞成伪同步接口。
  本轮先交付网络服务/客户端与真实 HTTP 合成端到端；本地持久映射接入须独立验证，
  不以临时内存映射冒充 ProjectSync 的持久恢复。
- 真实写入口失租停止、后台触发、已有目录版本推进另阶段。

## 路由 v1

认证后：
- GET /v1/identity
- POST /v1/projects （originId/localProjectId/name）
- GET /v1/projects/:globalId
- POST /v1/projects/:globalId/lease/acquire
- POST /v1/projects/:globalId/lease/renew
- POST /v1/projects/:globalId/lease/release
- PUT /v1/projects/:globalId/bundles/:sha256 （二进制 bundle，lease 凭据放指定头）
- POST /v1/projects/:globalId/revisions （lease 凭据、requestId、expectedRevision、bundleHash）
- GET /v1/projects/:globalId/revisions/:revision
- GET /v1/projects/:globalId/revisions/:revision/bundle

## 验收门槛

未授权/跨工程/伪造holder、错误Hash/损坏包/无上传收据/失租上传发布、
重放/CAS、正文超限/慢请求/错误响应/重定向、服务重启收据、
真实 HTTP A上传发布→B下载复验→新目录接管，及已有304项回归。
结果以落盘 TAP 和退出码为准；冻结实现的实际验收与遗留问题见下文。

## 当前实现的额外限制

- `X-PF-Hub-Id` 是受信服务执行前的身份防错针，不替代 TLS 身份验证，
  也不能阻止恶意服务器接收发往其 origin 的 bearer。Hub ID 必须从可信渠道配置。
- HTTPS 必须验证证书与目标 IP；非回环使用明确本机 IP 监听，不支持 wildcard bind、
  DNS Host 别名、反向代理信任或自动发现。回环 HTTP 只用于受信本机／合成测试。
- 权限和凭证由启动方显式注入；本轮无凭证签发、远程配置、热撤销或持久密钥管理。
  变更授权需关闭服务并以新配置重建，调用方负责安全分发凭证。
- 连接／正文的 I/O 存活时间有上限；整包校验和 SQLite 调用是同步操作，
  JavaScript 定时器不能抢占同步 CPU/磁盘阻塞，不宣称硬实时执行截止。
- 逻辑并发限制不是每设备速率限流；不防御同机管理员、raw SQL、磁盘损坏、
  拒绝服务资源耗尽或旧数据库备份混搭。
- 服务与客户端不提供自动重试或重同步调度；本轮网络接管复用 ProjectTakeover，
  不宣称已把异步网络客户端接进同步 ProjectSync 的持久映射协议。

## 冻结实现与验收结论 — 2026-10-16

实现提交：`d69b76e0c664e4519a343fa8d30eba5577e4f31c`，
父提交：`c0d7555e2a773acb34cdb19366aa80956b25d773`。
发布分支：`work/forge-network-20261016`；文档后继不改变已测源码。

**结论：独立认证网络库通过限定范围验收，不是生产部署或后台自动接续上线。**

| 环境与模式 | 实际结果 |
|---|---|
| 公司 JOSHUASHEN-PC6，Electron 44 / 内嵌 Node 24.18.1，网络专项 | 39/39，exit 0 |
| 同机最终源码，文件级串行全量 15 文件 | 343/343，exit 0 |
| 服务器 10_1_0_14，Node 22.22.1，默认文件并行 | 343/343，exit 0 |
| 同服务器同提交，文件级串行 | 343/343，exit 0 |

以上成功轮次 fail/cancelled/skipped 均 0。
网络专项39项是343项子集，两端与重复轮次有重叠，不相加为不同用例。
文件级串行没有跳过测试，用例内部四独立 SQLite 连接竞争测试保留。
服务器从精确 Git 对象导出，核实提交父链、7文件变更白名单及原始字节；
导出源码前后摘要不变，常驻仓库 HEAD、索引、既有修改保护检查通过。
家中 SHENBOJUN 只取回同一提交并核对旧现场，没有冒称在家中重新运行全量。

### 成功与失败都保留

- 实测真实 HTTP/TLS：A 上传、持租约发布，B 下载复验，再由 ProjectTakeover
  在新目录恢复代码、Todo、履历；保留 BOM/CRLF/中文/二进制，重复接管不多建工程。
- 认证设备与工程作用域、禁止猜摘要发布、有效租约、requestId/CAS、错误 Hub 写前拒绝、
  配额、慢头/慢正文、并发上限、拒绝重定向与下载复验均有反例。
- 三个真实服务子进程 `process.exit(73)` 中断点：
  `upload-content-stored`、`upload-receipt-committed`、`revision-published`。
  同库重启并以原请求恢复，内容/网络收据/Hub版本仍非共同原子。
- 内容完整复验后重新取时检查租约：首次发布与重放在严格到期边界均拒绝，
  发布时间使用最终核验时刻；测试确定性推进时钟，不靠 sleep。
- TLS 首次增补轮35/36失败，是夹具在初始化注册时未信任合成自签CA。
  原生HTTPS独立诊断确认信任CA成功、不信任拒绝；只修夹具，未关闭证书校验。
- 最终源码在公司默认文件并行全量中出现343个断言通过、另1个文件级失败：
  接管文件27断言通过后报 `PostQueuedCompletionStatus(6)`，
  进程退出码 `2147483651`。该失败轮总计344项结果、exit 1，不能当全绿。
  原接管测试本轮未修改；单文件三轮27/27及串行343/343通过。
  **根因未证实，未宣称已修复；服务器两种模式成功不抹掉此运行时遗留。**

### 证据位置与 TAP SHA-256

公司证据（不随 Git）：`D:\VCP\Handoffs\Evidence\forge-network-office-20261016-01`。
- `network-targeted-04/tests.tap`：
  `11805fa4a2cfaa4bfa98dc7aa0843623681407728d2f66cc672d87f6e962fe7d`
- `network-full-serial-01/tests.tap`：
  `6c583c89484228bf9a27144dd673969cc37b19460e9091c620e7582c5decd0b9`
- 失败轮 `network-full-02/tests.tap`：
  `2020d89cbefb0f509ab56c3a6e2ec9a3e2050e44d9eea2d82ee58ade2dc996ac`

服务器：`C:\VCP\ClaudeBridge\operations\forge-network-verify-20261016-01\evidence`。
- `full-default/tests.tap`：
  `dd440d663ec0a3efd1613aeaed62de455646ccafbcf3c4a684f739c3eb049cf8`
- `full-serial/tests.tap`：
  `fe7372a910d322c80968bd9bdd22c0924eafcd8f2a4d58fb22d68de75be60e33`
- `summary.json`、`source-manifest.json`、`resident-before.json`、`resident-after.json`
  保存版本、字节清单与保护结果；两份TAP已在服务器重新计算摘要核对。
  复测于2026-10-16 19:46完成，不把此前无启动回执的请求冒称后台已运行。

## 下一步只做用户主路径，不再扩建平台

目标：公司/家中/服务器施工能由系统自动交接同一全局工程，
携带已登记代码、Todo与履历，不靠主人提醒或 Agent 自觉 commit/push。
复用已有 ProjectForge、ServerProjectForge 与 Worker/PI 能力；
Git发布这里只保全开发成果，不是产品自动同步。

下一轮限定一个固定 Hub、一个显式启用工程：
A 自动生成并发布检查点 → 安全交出写权 →
B 启动后自动发现并在新目录恢复同一工程 → 继续施工。
需要把异步网络与既有持久映射、正常Forge生命周期/写入口连接起来，
并验证失租停止；不另造通用同步平台、Worker/DAG调度或服务发现层。
先不做已有目录自动覆盖、双向合并、离线双写。

本轮没有替换本机或服务器常驻插件，没有迁移业务库或上传真实工程。
当前网络客户端与同步 ProjectSync 仍未接通，后台触发和实际施工失租停止尚未交付。
生产启用须另行核对范围、停旧进程、备份及凭据安全配置。
换机先检查旧现场，取施工分支至旁侧工作树并登记正常V工程；
工程ID、数据库、依赖和凭据不随Git，禁止覆盖原业务库或清理脏工作区。