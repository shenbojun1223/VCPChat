# Forge 网络检查点协议（施工中）

基线 c0d7555e；可见 V工程 p2ube；所有网络测试使用合成数据。
本轮不部署常驻插件、不迁移业务库、不上传真实配置、不启用后台调度。

## 边界

- 独立 Node HTTP/HTTPS 服务；默认随机端口、仅 127.0.0.1。
- 非回环监听必须 TLS；客户端拒绝非回环明文 HTTP、重定向、URL 凭证和跨源凭证转发。
- 受信启动配置提供随机 bearer token、deviceId、明确 originIds/projectIds、read/write/register 权限。
  不提供远程管理或密钥写入入口；测试密钥随机生成、不得写入日志/提交。
- holder 必须等于认证 deviceId；origin 注册只许配置允许的 originId。
- 项目读写只许其 originId 或 globalProjectId 在该 principal 允许范围；禁止 wildcard。
- 上传：检查作用域和有效 lease，限流限额读取，再复查 lease，再存可信内容；
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
结果以落盘 TAP 和退出码为准；未完成验证前本页不声明验收。

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