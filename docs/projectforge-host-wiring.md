# Forge 实际宿主接线与真实单向接续验收

基线02bd558933cb31b111d6e56cc7113e8b16eb9497，前轮工程pn0ma已accepted。
本轮正常可见工程p3rhq，分支work/forge-host-wiring-20261016。

## 最新结论：真实家中 → 服务器单向接续已验证

实现与实际运行版本：`56670320be326570f3d386bcefb199dfdeaa036f`。
本页后继提交只更新文档，不改变已测试或实际运行的源码。

2026-10-16，经主人明确批准独立环境与临时路由后完成：
**家中正常客户端启动 → GUI 修改自动发布 → 正常退出交权 →
服务器独立 PluginManager 自动恢复 → 正常工具继续编辑并自动发布。**
这是两台真实主机间的网络验收，不再只是本机合成 A/B；
范围仍仅一个显式配置、可丢弃工程、新目录、家中到服务器一次接续。
不是日常常驻插件升级、业务工程自动同步上线，也不包含真实 PI 进程适配。

### 实际入口与身份

- 家中 `SHENBOJUN`，独立客户端目录
  `D:\VCP\ForgeAcceptance\single-project-20261016-01\client`，
  使用原有 Electron 运行时启动未经改写的 `main.js`，独立 AppData。
  `VCPCHAT_E2E_TEST=1` 只跳过音频预热；GUI-only 启动接线实际执行。
  Puppeteer 仅驱动正常 Launchpad、工程页按钮和 preload IPC，未替换 handler 或调用同步内部接口。
- 服务器 `10_1_0_14`，独立
  `C:\VCP\ForgeAcceptance\single-project-20261016-01\toolbox-host`。
  复制实际 `Plugin.js` 及受跟踪 JS 依赖闭包（不复制运行配置），通过原插件发现、
  `PluginManager.processToolCall` 和 `direct-hybrid-service` 执行桥调用。
  普通工程命令由仓库外 inbox 驱动；不是当前常驻服务器的 HTTP 工具入口或生产插件升级。
  Forge 源码来自同一 Git 提交，仅验收副本的 manifest 名称适配为 `ServerProjectForge`。
- 固定 Hub 回环 `127.0.0.1:18765`，临时公网入口
  `https://119.91.115.95/forge-sync`；复用 Caddy 443，剥固定前缀并固定上游 Host。
  家中通过真实 HTTPS 完成身份认证与传输，证书校验始终开启。
- Hub ID `hub-f65453a9-f06f-4a13-887b-a930273e22ba`；
  global ID `g_5138d5d1-03e3-40f7-90f8-a7fd2a479f88`。
  家中本地 ID `pklog`，服务器本地 ID `p0rjw`，不是两个独立全局工程。
  接收侧仅一个工程、一个映射、一个导入收据、一个物化任务。

### 实际检查点与操作

| 检查点 | 实际证据 |
|---|---|
| revision 1 | 家中正常应用启动后自动持租约发布，写者 `SHENBOJUN-acceptance`、fence 1 |
| revision 2 | 正常工程 GUI 回退 n2，新增 rollback 节点，后台自动发布；没有人工上传 |
| revision 3 | 家中正常 `close-app → app.quit → cleanup` 发布最终检查点、释放写权，客户端 exit 0 / signal null |
| 接管 | 服务器此前一直 waiting、拒写且目标不存在；家中交权后自动取得 fence 2，在新目录恢复 revision 3 |
| revision 4 | 服务器启动后的自动检查点，保持同一 global ID |
| revision 5 / 6 | 服务器普通 EditCode 将 hello.txt 改为“服务器接续完成”，UpdateTodos 完成 #2，后台自动发布 |
| revision 7 | 原 PluginManager shutdown 调用 Forge shutdown，发布最终检查点并释放租约；宿主关闭写门且实际进程退出 |

检查点可能包含相同内容：revision 2/3 的 hash 相同，revision 6/7 的 hash 相同；
版本数量不等于不同代码状态数量。
服务器宿主没有提前创建接收目录、没有覆盖家中旧目录；
家中退出后仅通过只读网络客户端下载服务器检查点核验，未将新版本覆盖回旧副本。

- 家中 GUI 后及服务器接管文件：UTF-8 BOM + `家中初始版本\r\n`，23 bytes；
  SHA256 `f2216d30cc3dd7d36ea81689414f2743d418417d742f96edaca590b2e5feb8dc`。
- 服务器继续编辑后：UTF-8 BOM + `服务器接续完成\r\n`，26 bytes；
  SHA256 `0b98b729bd5e2bfccbbee223c098e1301f4f58d5ef376f33d7bae326f88fde75`。
- 接管时全部 3 个历史节点、Todo 1/2、项目元数据与主键映射逐字段核对；
  服务器继续施工后 4 个节点、Todo 2/2，家中通过公网重新下载完整 bundle 独立核对。
- 最终 revision 7 / revision 6 bundle SHA256：
  `4c70915dbc029c9cc30542f75f56adb1a3c06866386000f3ea71c29fb2cf739a`。
  最终 Hub 租约为 null；服务器发布者 `SERVER-acceptance`、fence 2。

### 已回收的临时部署与现场保护

2026-10-16 23:35 收尾：家中验收客户端、服务器验收宿主、独立 Hub 均已正常停止；
宿主 shutdown 回执 failure=null，并核实进程不在；18765 和家中诊断 19222 均不再监听。
服务器启动未捕获子进程退出码，不能把“进程已退出”误写为服务器 exit 0；
家中客户端有真实 exit 0 回执。

Caddy 原文件逐字节恢复并热重载成功，SHA256：
`3cd7b9130ad175651a5c6cfe33f04af6dc4d1aedceb89f047959e639f31d48cd`。
原 `127.0.0.1:3000` 业务上游返回 200；验收路由不继续保留。
两端常驻插件、业务数据库、Provider 配置未替换或迁移。
服务器两仓 HEAD/索引/status/原修改与常驻 Forge 字节保护通过；
家中旧根仍为 personal/main `19e1283f`，HEAD/索引/status/七份原修改字节均未变。
验收库、工作树、恢复证据和 private 文件保留在仓库外，没有清库或复制进 Git。

凭据只用于独立验收，未输出明文、未提交。家中 bootstrap 授权包含新 origin 的 register/read/write，
接收端为精确 global ID 授权；本轮停服收口，没有假称已热撤销或完成 bootstrap 权限收紧。
再次启用前必须检查保留的凭据与映射、收紧授权，不得直接重跑一次性准备脚本。
旧家中副本已落后服务器版本，不支持自动覆盖升级；不要直接启动旧写者并假定可往返续写。

### 证据与明确遗留

家中证据：
- `D:\VCP\ForgeAcceptance\single-project-20261016-01\evidence`：
  `gui-revert-verified.json`、`home-handoff-verified.json`、
  `server-continued-public-verified.json`、下载的两份 bundle、GUI 截图、client-exit.json。
- `D:\VCP\Handoffs\Evidence\forge-host-wiring-home-20261016-01`：
  402 项 TAP、`publication.json`、`real-final-home-protection.json`、仓库外验收驱动。

服务器证据：
- `C:\VCP\ForgeAcceptance\single-project-20261016-01\evidence`：
  `receiver-waiting-before-handoff.json`、`receiver-takeover-verified.json`、
  `receiver-continue-verified.json`、`receiver-final-handoff.json`、
  `acceptance-deployment-closed.json`、`resident-before/after.json`。
- 同根 `receiver-results` 保存四次正常工具分发回执。
- `C:\VCP\ClaudeBridge\operations\forge-real-handoff-20261016-01`：
  原 Caddy 备份、校验/应用记录、`server-acceptance-evidence-summary.json`。
  closure 原件 SHA256 `6d8faaf2de8892c1b6b3e14817c772919ec54582185020ef44ff5525714847d7`；
  resident-before/after 原件同为
  `0a81186df6303f43540e9d3a4fcb14228d377503d6696edc7bd37fc97344cf01`。

实现的本机冻结回归仍为 402/402；本轮服务器做的是上述真实宿主验收，
没有重新跑 402 项，不将前轮 380 项或跨端重叠用例相加。
旧 Electron 默认并行收尾异常没有借此宣称修复。

未做：公司机接入、日常常驻实例配置、既有目录安全版本推进、持续往返、
真实 PI 停止/退出/Capture 适配、离线双写/合并、服务发现、多 Worker/DAG。
bundle 只含 Forge 已登记文件与引用快照，不是整仓依赖备份。
下一轮只在明确授权后接真实 PI 生命周期与收录；不自动升级业务库或重开本次临时服务。
多库/网络/文件系统非共同原子、容量/回收/GC 等沿用先前边界。

下面保留部署前记录；其中“未执行”等仅表示当时状态，以本节实际结果为准。

## 仅补三处接线

1. 显式AUTORESUME_CONFIG_PATH；空值不读凭据、不启动网络。配置为严格JSON，
   bearer单独存绝对路径tokenFile；不从Agent参数或远端工具正文设置配置。
   同步构造本地写门，然后异步联系Hub，避免启用过程先允许编辑再关门。
   目标必须由宿主现有工作区白名单授权，不给内部接管接口额外扩大权限。
2. 服务器Plugin.js调用shutdown，前端分布式宿主调用cleanup：
   Forge两者均有出口；无分布式服务时GUI/main也须完成退出清理。
   同一模块不得因GUI和分布式服务先后初始化而创建两个控制器。
3. 客户端显式pathPrefix供既有Caddy handle_path使用，不接受任意URL重定向，
   不关闭TLS验证。Hub回环监听、代理剥前缀并设置明确Host。
   代理不是新的授权者，原bearer/Hub identity/设备/工程作用域保留。

## 实际环境事实

家中SHENBOJUN=192.168.50.225；服务器10_1_0_14=10.1.0.14，非同一局域网。
公网119.91.115.95:443从家中TCP可达。服务器Caddy为C:\caddy\caddy.exe，
配置C:\caddy\Caddyfile，已有https://119.91.115.95站点及127.0.0.1:3000上游。
没有sshd。不安装SSH、不改防火墙、不输出既有密钥或整份运行配置。
Caddyfile只读勘察时SHA256=3cd7b9130ad175651a5c6cfe33f04af6dc4d1aedceb89f047959e639f31d48cd。
两端常驻Forge尚无自动接续实现，新代码只存在旁侧树和服务器隔离测试目录。

## 部署闸门

本轮代码编写与临时测试不等于已部署。
实际启用前明确：外部HTTPS前缀、回环端口、独立数据目录/工程/目标、
证书信任与device/project权限、改动文件、重启范围及回退步骤，再由主人确认。
不读搬Provider配置，不上传业务工程，不混用旧新版数据库。
首次只验家中→服务器新目录恢复；不做已有副本升级、持续往返、多Worker平台或真实PI适配。
验收必须记录两台真实主机、正常Forge入口、文件字节/Todo/历史/globalId/写权，
不能以两端各跑单机测试替代。

## 宿主接线冻结验证 — 2026-10-16

本机SHENBOJUN，旁侧树运行Electron Node模式，17份project-forge*.test.js文件级串行：
**402/402、exit0、fail/cancelled/skipped均0、invalidHandle=false**。
测试结束2026-10-16T13:31:00.700Z；21:32:40核对本轮12文件冻结摘要一致，
旧D:\VCP\VCPChat的HEAD、索引、status、七份原修改字节保护通过。
本轮新增22项是402的子集；先前96项专项也有重叠，不相加为不同用例数。
当前结果是本机受控环境验证，不是本轮服务器复测、真实跨设备或完整Electron GUI启动验收。

已落实：
- 配置开启时同步安装关闭的写门，再异步连接Hub；flat/wrapped宿主均能传配置。
- 同配置同工作区服务的GUI/direct双次初始化复用一个控制器，改绑拒绝。
- 服务端shutdown出口复用cleanup；前端GUI-only有启动和退出入口。
- Forge/分布式退出失败保留失败，但继续其他已有资源的清理，不报交权成功。
- 严格字段/身份二选一、显式路径、限长UTF8、独立tokenFile、安全静态错误。
- 工作区停用和异步下载之后复查接收目标，不突破普通工作区白名单。
- 固定pathPrefix经过真实合成HTTPS剥前缀代理跑通认证、上传发布、下载复验；
  不信任证书仍拒绝，未关闭TLS、未接入实际Caddy。

四份本轮CRLF文件已仅在旁侧树统一LF，仓库外pre-lf保存原件，
Capture cd817f7684ffb524e2becde45/b64已归档；全量测试执行规范化后的字节。
证据D:\VCP\Handoffs\Evidence\forge-host-wiring-home-20261016-01：
frozen-01.json、verification.json、original-protection.json、full-frozen-01/summary.json。
TAP SHA256：6dd7fa2129f7e5b5731a350c4d2c2e2a8537807c9e483e69bb1004e0bb804a7b。

## 原部署提案（历史：后经批准完成验收并回收，见顶部）

- 公网入口拟为https://119.91.115.95/forge-sync，复用现有443，不新增公网端口。
- Hub拟仅监听服务器127.0.0.1:18765；只读勘察时端口空闲。
  Caddy拟新增严格前缀剥离路由，显式上游Host=127.0.0.1:18765，
  其他站点/TLS/原127.0.0.1:3000业务路由保留，不放宽原Hub认证或证书校验。
- 服务器验收数据拟在C:\VCP\ForgeAcceptance\single-project-20261016-01，
  家中验收数据拟在D:\VCP\ForgeAcceptance\single-project-20261016-01；
  两者都必须不存在才创建，不搬或迁移现有业务DB。
- 两个设备各一个新随机bearer，仅授权这一个可丢弃工程；密钥/配置不进Git、聊天或日志。
  先无凭据校验证书信任，失败不以跳过验证强行接通。
- 日常入口接入需要明确选择隔离客户端及服务器插件实例，不能用另一个脚本
  调同一服务模块后就声称正常工具/GUI已接入。
  若需服务器进程重启或家中客户端切换，须单独确认时机；不强关当前聊天。
- 修改Caddy前保存原文件/摘要并验证候选配置，确认后再reload；
  失败恢复原配置。回退停止独立Hub/验收实例，保留验收库与恢复证据，
  不删除业务文件、不让旧程序打开新版验收库。

本轮仅准备以上清单，尚未添加路由/监听器、配置凭据、重启/替换常驻插件，
未上传任何真实业务工程。Todo #3/#4仍待部署授权和实际双设备证据。