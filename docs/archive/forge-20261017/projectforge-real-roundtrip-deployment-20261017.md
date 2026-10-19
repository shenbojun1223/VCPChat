# 最新结论：-02 真实家中 A→服务器 B→原家中 A 接续及回收已通过

本节取代下方旧阶段的“真实往返未验收/blocked/review”等当前状态描述。
旧-01失败部署及修复过程保留原事实，不删除、不改写失败证据。
施工工程p0jsf；实际运行产品固定eaf5ab5e7ba26479c738c8c66aa9c051c65db78b，
实现08a258d4d8758d19e3938058a61513a102c780fc；没有为本次成功修改产品源码。
正式报告状态以本阶段最后一次SubmitReport回执为准。

## 实际两端及唯一工程

- 家中SHENBOJUN：D:\VCP\ForgeAcceptance\roundtrip-20261017-02，
  使用固定Git导出的原main.js、独立AppData、现有本机Electron44；
  GUI-only宿主启动和退出钩子实际执行。当前聊天客户端未关闭或替换。
- 服务器10_1_0_14：C:\VCP\ForgeAcceptance\roundtrip-20261017-02，
  独立实际PluginManager，通过原插件发现和direct执行桥分发普通Forge工具。
  验收副本manifest名称适配ServerProjectForge，未升级常驻插件。
- 固定Hub：hub-21e16316-4421-41e7-bc80-9f11417d2a39；
  globalId：g_601253ad-dc37-4618-b124-01c262449c91；
  origin：i_81d21e2e-a085-430f-8c05-68a87532ca8b。
- 家中工程polyy，原根workspace\source；服务器工程pm58k，根receiver-workspace\resumed。
  A返程复用同一客户端、AppData、工程库、映射库和原目录，没有新建A副本。
- Hub仅回环127.0.0.1:18767，临时HTTPS前缀/forge-roundtrip-20261017-02；
  复用443且保留TLS验证。家中诊断端点仅127.0.0.1:19224，现已回收。
- 新seed清单的实际name/origin/localId/工作区及精确字节摘要用于两端准备，
  真实RSA解密和静态/GUI工作区一致性检查通过，未复用-01凭据。

## 真实主路径与检查点

| 阶段 | 实际证据 |
|---|---|
| A首次启动 | 自动持有fence1并发布revision1 |
| A正常GUI回退 | 通过工程页历史和确认按钮回退节点2，自动发布revision2，3个历史节点 |
| B提前启动 | A仍持权时B为waiting、拒写，目标目录不存在 |
| A正常退出 | exit0/signal=null，最后检查点revision4，释放写权；不是手动交权 |
| B自动接续 | 自动取得fence2，恢复A最终revision4为本地pm58k，自动发布revision5 |
| B普通续写 | PluginManager.processToolCall执行EditCode/UpdateTodos，自动发布至revision7，4节点 |
| B正常关闭 | 原shutdown钩子发布最后revision8并释放租约，实际exit0/signal=null/error=null |
| 原A返回 | 正常启动自动更新原目录至服务器版本，取得fence3并自动发布revision9 |
| 原A继续施工 | 正常GUI回退服务器带回的节点4，新增rollback历史，自动发布revision10，5节点 |
| 原A正常退出 | exit0/signal=null，最后revision11，lease=null |

revision是检查点数量，不等于不同内容状态数量；存在相同内容的多个revision。
实际继续施工均走正常GUI/preload IPC或实际PluginManager普通Forge工具；
初始化和只读证据驱动不冒充施工。没有手调上传、发布、takeover或advanceLocal接口。

## 原目录、原历史与字节核验

- 原A本地ID始终polyy；项目数始终1；原root及目录dev/ino
  609990020 / 281474977647836保留，没有整目录替换。
- 原节点ID1/2/3、批次ID1/2/3和Todo ID1/2/3保留；
  原节点/批次行逐字段不变，Todo状态按远端推进。
  本次没有创建Capture记录，未据空集合核验宣称真实Capture跨设备收录已验收。
- B接收时项目元数据、Todo、历史与主键映射逐字段核对，
  只有一个工程、导入收据、映射和物化任务。
- 回程接收服务器新增节点4，原A本地库升schema6，有一个project_update_jobs记录；
  更新标记已清除，最终映射revision11，无未确认发布或冻结载荷。
- 文件为UTF-8 BOM与CRLF：
  A初始/最终“家中初始版本”23字节，SHA256
  f2216d30cc3dd7d36ea81689414f2743d418417d742f96edaca590b2e5feb8dc；
  B续写及A刚返回时“服务器接续完成”26字节，SHA256
  0b98b729bd5e2bfccbbee223c098e1301f4f58d5ef376f33d7bae326f88fde75。
- 最终globalId不变，revision11，holder=SHENBOJUN-roundtrip-20261017-02，
  fence3，lease=null，5个历史节点；最终bundle摘要：
  f38d62c3c74c96d180a2e0bab0980f04e2bf16439908dbdea454052399605364。
- 验收工程Todo1/2 done、Todo3 pending，未为完成度改写它；
  原A返程GUI新增rollback与自动检查点已经证明续写。
  返程GUI实际署名KerrKerr，作为原始审计事实保留，不改为Kerr。

## 完整回收与现场保护

- A首次退出PID38184，返程退出PID26668；B PID20228；
  Hub PID23924，均取得实际exit0回执，signal=null；
  B/Hub监督进程消失，临时进程及18767/19224监听消失。
- Caddy仅在内容匹配本轮安装候选时恢复本轮备份原字节并reloadExit0；
  ACL未变，原SHA256：
  3cd7b9130ad175651a5c6cfe33f04af6dc4d1aedceb89f047959e639f31d48cd。
  原业务上游200，临时路由已移除。
- 服务器residentProtected=true；家中原HEAD/索引/status/七份改动未变，
  48份冻结文件未变，产品受跟踪源码未变。
- 验收数据、映射、private配置和证据保留仓库外；
  停服/移除路由不等于凭据热撤销，没有宣称热撤销。
- 两端常驻插件、业务库和Provider配置未替换或迁移。
  文档及仓库外驱动尚未创建Git提交或推送；不把本机归档当跨机源码交付。

## 权威证据与限定结论

家中：
D:\VCP\Handoffs\Evidence\forge-real-roundtrip-home-20261017-02；
同实例evidence目录含home-first-handoff.json、original-A-before-return.json、
server-handoff.json、home-return-original-verified.json、home-return-continued.json、
home-return-handoff.json、client-first-exit.json、client-return-exit.json及GUI截图；
家中证据根home-final-protection.json和roundtrip-final-expectation.json。
服务器：
C:\VCP\ForgeAcceptance\roundtrip-20261017-02\evidence，
receiver-waiting-before-handoff.json、receiver-takeover-verified.json、
receiver-continue-verified.json、server-handoff.json、
acceptance-deployment-closed.json、closure-independent-verification.json及最终bundle。
服务器operations目录forge-real-roundtrip-20261017-02含receiver-exit.json、hub-exit.json。
closure摘要经服务器独立复算：
b4eff6f2425a16c936800b6b0fe1e402a4a30f62317a01dd76f0391c4d1d8d87。
家中server-closure-receipt.json为工具回传转录，
不宣称已在家中复制并复算服务器原始回收文件。

已完成的是一个可丢弃工程、两台真实设备、一个固定Hub的A→B→原A原目录接续。
不是日常常驻同步上线、真实PI/公司机接入、任意外部编辑器隔离或整仓依赖备份。
本次真实载荷主要为中文/BOM/CRLF及Todo/历史；439项覆盖的二进制、增删移动、
失租/碰撞/中断等反例不冒称本次真实两机逐项重演。
不是额外A→B第二次回程；服务器保留副本现落后最终A版本，不要盲启旧宿主。
不自动扩功能或升级业务现场。

---
## -01 历史：部署提案与失败回收记录

> **-01 历史结果：首次部署初始化失败并完成回收；后继 -02 真实往返成功，以本文顶部记录及最终正式报告为准。**
> 下文“拟定/未启动”是部署前提案，不能覆盖本节实际事实。
> 固定版本 eaf5ab5e；工程 p0jsf 的真实往返 Todo #3 保持 blocked，不提交 accepted。

## 本次实际结果与回收

- 主人明确批准后使用两个全新隔离根、一个可丢弃工程、一条临时HTTPS路由。
  家中原工程 p7g81，根目录 D:\VCP\ForgeAcceptance\roundtrip-20261017-01\workspace\source；
  origin i_fe748cb9-8613-418c-8f0f-3f3e452067b8；
  Hub hub-e2e56fc0-59bb-4ea2-9516-76e42ab057b6；
  globalId g_92774c7d-9011-4839-88b4-cc04ecefb0de。
- 家中通过真实HTTPS认证核验Hub身份，TLS校验开启。独立原始main.js客户端成功启动；
  Hub仅监听127.0.0.1:18766；Caddy临时前缀实际安装且reloadExit0。
  这些是部署与传输事实，不是工程接续成功。
- 首次注册阻断：seed工程名称为“真实原目录往返验收（可丢弃）”，
  部署脚本预登记Hub名称仍为“真实双设备验收（可丢弃）”。
  HubStore.registerProject对同origin/localProjectId但不同name必然返回REQUEST_CONFLICT。
  这是部署驱动复用遗漏，不是原目录更新逻辑的功能断言失败。
  控制器已建立，本地映射为空，无冻结发布载荷；Hub最终revision0/fence0/bundleHash=null/lease=null。
  服务器B从未启动，接收目标不存在，没有任何真实A→B交权，更未发生B→A。
- 另见seed登记的forge-acceptance与GUI配置forge-roundtrip不一致；
  该差异已记录，不冒称为本次已证实的注册阻断根因。
  既有本地目录白名单允许读取并不保证所有跨端目标字段一致。
- 工程已绑定，updateProject受Writer.assertWrite守卫；无租约不允许修改。
  Hub无现成改名接口。未改SQLite、未删绑定/映射/更新标记、未伪造租约，
  未重建工程或重置现场来绕过冲突；产品实现与测试未修改。
- A经正常electronAPI.closeApp→app.quit退出：PID48448，exit0/signal=null，
  退出回执2026-10-16T19:35:58.295Z。进程与19223诊断监听均消失。
  此次没有写权，不能把正常退出称为交权成功。
- 回收后Hub PID24552真实exit0/signal=null/error=null，
  回执2026-10-16T19:38:45.313Z；Hub及监督进程均消失，18766不再监听。
  Caddy只在现内容等于本轮候选时恢复原字节，reloadExit0，
  原SHA256=3cd7b9130ad175651a5c6cfe33f04af6dc4d1aedceb89f047959e639f31d48cd；
  ACL未变、临时路由移除、原业务上游200。
- 服务器常驻两仓/Forge源码保护通过；家中原HEAD/索引/status/七份改动未变，
  48份冻结文件未变，seed文件字节未变。
  旁侧树仍为eaf5ab5e，唯一新增仓库文件为本记录；记录编辑后摘要另算，
  不将编辑前d43ca932a7c27d488c3c472cfe04e4aa49d5a49457dc4dc86e2fe1e637237442a冒充最终摘要。
- 回收不等于数据销毁或凭据热撤销。验收数据库、private文件与失败证据全部保留仓库外，
  两端常驻插件未替换，业务库未打开或迁移。

权威证据：
- 服务器 C:\VCP\ForgeAcceptance\roundtrip-20261017-01\evidence\acceptance-deployment-aborted.json：
  outcome=aborted-before-first-checkpoint、accepted=false、realRoundtripVerified=false、
  receiverNeverStarted=true、errors=[]、ok=true。这里ok只指失败回收完整，不指往返通过。
- 服务器同根abort-close-planned.json、abort-caddy-restored.json、abort-resident-after.json；
  operations目录 C:\VCP\ClaudeBridge\operations\forge-real-roundtrip-20261017-01\hub-exit.json。
- 家中 D:\VCP\ForgeAcceptance\roundtrip-20261017-01\evidence：
  initial-A-authorization-diagnosis.json、initial-A-hub-registration-diagnosis.json、
  failed-bootstrap-close-planned.json、failed-bootstrap-closed.json、client-exit.json。
- 家中 D:\VCP\Handoffs\Evidence\forge-real-roundtrip-home-20261017-01：
  home-protection-after-abort.json、server-verification-receipt.json及候选/源码清单。

服务器439/439、exit0的同版隔离回归仍有效；真实双设备往返仍缺证据，
不把它降格成产品全回归失败，也不升级成真实往返成功。
后续如获准重新验收，应先修仓库外provisioning驱动：
从同一实际seed身份清单读取name/origin/localId及工作区身份，两端初始化前严格比对；
不再分别硬编码。失败现场保持封存，不增加改名API、解除门禁或通用部署平台。
本次归档不代表批准新一轮部署。

---

## 原部署前提案（历史；实际结果以上节为准）

工程：p0jsf；本页是部署清单，不是已部署或真实往返通过声明。
固定运行源码：eaf5ab5e7ba26479c738c8c66aa9c051c65db78b；
实现：08a258d4d8758d19e3938058a61513a102c780fc。
运行副本只来自固定 Git 对象，不混入本页或现场未提交代码。

## 1. 唯一目标与当前门槛

家中 SHENBOJUN 的 A 正常 Forge 施工、后台自动发布，正常退出交权；
服务器 10_1_0_14 的 B 自动接续、正常工具续写并交权；
重新启动原 A，自动更新原目录、原本地工程，随后正常 Forge 再施工并自动发布。
两端只对应一个 globalId；各自本地 projectId/root 和已有历史 ID 保留。
本地未发布改动、未结束 Capture、未知路径碰撞或身份/授权漂移必须停止，不合并、不 force。

已实测：
- 家中既有冻结专项37/37、全量439/439、exit0；不是本轮重跑。
- 本轮服务器 Node22.22.1、better-sqlite3 12.4.1，同 Git 导出18文件串行439/439、
  exit0，fail/cancelled/skipped0，invalidHandle=false。
- 服务器源码指纹未变，常驻两仓HEAD/索引/status/原修改/Forge源码及Caddy摘要保护通过。
- 家中原HEAD/索引/status/七份原修改和48份冻结文件保护通过。
- 两端覆盖重叠，不相加算878项；这些都不能代替真实双设备往返。

服务器最终证据：
C:\VCP\ClaudeBridge\operations\forge-roundtrip-verify-20261017-01\retry-02\evidence
TAP SHA256：fa2c677a160ee54b752a19d1aeb98aa2179aabdaafab25b8f2e590c34458ffae。
独立服务器Get-FileHash复算通过；家中仅保存回执，未声称已复制并本机复算原TAP。
首轮误写文档勘误白名单的预检失败、retry-01漏宿主输入导致431/439的失败证据保留。
retry-02只补同Git的main.js、modules/ipc/projectForgeHandlers.js和本机现有dotenv依赖，
未修改实现/测试，未跳项。

48份家中冻结文件都未漂移；29份未改动基线是严格LF→CRLF检出差异，
本轮11份实现/测试与Git逐字节一致。两种表示均记录摘要；
服务器使用原始Git字节重新冻结测试，不把两种表示冒称为原始字节相同。

## 2. 仅新增的隔离现场

以下均为拟用目录，实际创建前再次确认不存在；冲突就停止，不覆盖或自动清理。

家中根：
D:\VCP\ForgeAcceptance\roundtrip-20261017-01
- client：固定Git版本的独立真实客户端，使用现有本机Electron44及匹配依赖。
- app-data：独立AppData；不复制当前聊天、Provider配置或运行密钥。
- workspace\source：A工程根；初始化后固定，回程不得另建工程/目录。
- private\forge.db、mapping.db、publication.db：仅本次验收的新库。
- private\auto-resume.json、home.token：受信配置与独立凭据，限制ACL。
- evidence：启动、退出、自动检查点、身份、字节、Todo、历史及保护回执。

服务器根：
C:\VCP\ForgeAcceptance\roundtrip-20261017-01
- source：固定Git对象导出的Forge源码和实际宿主所需文件。
- toolbox-host：独立真实PluginManager/direct执行桥，仅发现验收Forge；
  宿主受跟踪JS闭包需固定指纹，不复制业务配置，不使用常驻工具HTTP入口冒充独立实例。
- receiver-workspace\resumed：B首次接收目标，接收前必须不存在；建立后固定。
- private\forge.db、mapping.db、publication.db：B独立新库。
- private\hub.db、content.db、network.db：单个Hub的独立新库。
- private\auto-resume.json、server.token及Hub授权文件：新建、限制ACL、不输出明文。
- evidence及普通工具inbox/results：仅本次验收操作与证据。

工作区别名拟为forge-roundtrip，各宿主只授权上述工程工作区，不登记业务根。
B首次不预建工程目标目录，只建其父工作区。
不安装依赖、不跨机复制node_modules、不让旧程序打开新版验收库。
projectUpdate继续使用接收库内恢复记录，不新增数据库、协议或服务框架。

## 3. 单Hub与临时网络

拟定：
- Hub只监听服务器127.0.0.1:18766，启用前复核端口空闲。
- 家中入口：https://119.91.115.95/forge-roundtrip-20261017-01
- Caddy仅为该固定前缀增加剥前缀代理，固定上游Host=127.0.0.1:18766；
  保留现有站点/TLS/业务路由，不新增公网端口或防火墙规则。
- B可使用同Hub的回环HTTP入口；回环不免除原身份认证、租约及工程授权。
- 家中TLS完整验证，禁止跳过证书验证或跟随任意重定向。
- 先无凭据核验证书；再验证Hub身份和已批准的设备/工程范围。
- 若需本机GUI诊断，仅监听127.0.0.1，端口启用前检查，退出后回收。

Caddy写入前保存原字节、摘要和ACL，先验证候选，再reload。
本轮只读原摘要：
3cd7b9130ad175651a5c6cfe33f04af6dc4d1aedceb89f047959e639f31d48cd。
部署前不一致就停止复核，不能覆盖后续业务配置变化。
本项涉及真实配置修改，须在明确批准本清单后执行。

## 4. 身份、启用与正常入口

- 新建一个可丢弃A工程，全局ID/两端本地ID由实际回执取得，写入证据，不预编造。
- A设备拟为SHENBOJUN-roundtrip-20261017-01；
  B设备拟为SERVER-roundtrip-20261017-01。
- 两端使用全新随机凭据，不读取或复用上一轮private目录。
- A首次注册权限只授权这个全新、只含一个工程的验收origin，不使用通配origin。
  B取得globalId后精确授权该工程。需如实记录A首次注册权限与最终权限，
  不把origin范围冒称为更窄的project范围，也不宣称系统具备热撤销。
  若收紧凭据，必须在宿主停服边界替换并重新核验，不扩建认证接口。
- 凭据不进Git/聊天/日志，必要跨机提供采用现有一次性公钥加密封装流程。
- 原AUTORESUME_CONFIG_PATH入口、独立tokenFile、工作区白名单和正常退出钩子不变。
- 不关当前聊天客户端，不重启常驻VCPToolBox；只启动/停止独立验收实例。
- 一次性seed/provision与只读证据核验可用仓库外驱动；
  实际接续不能通过手调上传、发布、advanceLocal或takeover接口冒充自动流程。
- A正常客户端/GUI与preload IPC，B实际PluginManager.processToolCall普通Forge命令。
  真实PI、Capture进程生命周期适配不在此阶段。

## 5. 三段验收与停止条件

1. A普通Forge写入中文/BOM/CRLF文件，保留旧历史ID，后台自动发布；
   正常应用退出、最后检查点和交权确认后才允许B取得写权。
2. B自动接收同globalId，普通EditCode/UpdateTodos等续写并后台发布，
   正常宿主shutdown交权。保存B本地projectId/root和历史映射。
3. 启动原A客户端、原AppData/库/映射，自动推进原workspace\source；
   核验原projectId/root/既有历史ID未变，字节/Todo/履历与已发布检查点相符。
   再执行一次普通Forge修改并观察自动发布，然后正常退出交权。

固定一个小型验收载荷，覆盖中文/BOM/CRLF；可通过普通工具增删/移动文件。
已测的37项故障反例不在真实环境重复扩张；未知冲突或未发布改动须直接停止。
版本数以回执为准，相同内容可产生不同revision，不预设数量。
每次交权核验租约结果；没捕获exit0就只说shutdown和进程退出事实。
有未确认发布、授权/身份漂移、租约不确定、未知字节或旧进程时不强行推进。
不合并、不强抢有效租约、不force、不手改库/映射/更新标记解除拒写。

## 6. 回收和授权边界

- 正常退出独立客户端和服务器宿主，核对最终检查点与租约释放；
  无法确认释放则保留不确定状态，必要时等TTL，不假报成功。
- 正常关闭Hub，核实验收进程和监听消失。
- Caddy若仍等于本轮已安装候选，恢复本轮备份原字节并reload；
  若被他人改动，停止并报告，不盲覆盖。
- 检查原业务上游、站点和两端原现场指纹。
- 新验收库、工作树、private及失败恢复证据保留仓库外，不自动删除或purge。
- 不把停服或移除路由称为凭据已热撤销。
- 不替换常驻插件、不迁移/复制业务库、不接公司机、不做离线合并/多Worker/DAG。
- Forge只搬登记文件及其历史，不是整仓备份、依赖同步或PI会话漫游。

提案制定时仅完成同版隔离回归，尚未部署。此后已获主人批准并执行上述限定部署，
但在A首次注册处因预登记名称不一致失败，随后已完成回收；详见顶部实际记录。
授权范围仅两个新隔离根、一个新可丢弃工程、一个回环Hub、
上述单条临时HTTPS路由、专用凭据及回收步骤，不自动延伸为新一轮部署授权。

## 后续：部署驱动身份一致性修复——仅离线候选验证

主人要求继续后，仅在仓库外独立修复目录修改候选，未重开部署。
原失败部署、脚本、库、映射、凭据与证据保持封存。
Todo #5 的离线修复完成，不改变 #3 blocked 或整体验收 review 状态。

### 最小修正

- seed 候选从实际 ProjectStore/WorkspaceResolver 结果输出 name、originId、
  localProjectId、root/subpath、完整 workspace（id/alias/path/enabled）、公钥字节摘要。
  清单保留精确 UTF-8 字节摘要；不再由 Hub 与 GUI 各自硬编码另一套名称或工作区 ID。
- Hub 候选从同一清单生成注册载荷，并将清单摘要及实际注册字段写入准备回执；
  加密封装包含 sourceSha256。公钥字节、清单形状及同一验收实例检查在创建输出之前完成。
- home 配置候选在解密凭据或输出配置之前核对清单与 Hub 回执；
  静态 WORKSPACES 使用完整 JSON 工作区，GUI settings 使用相同 id/alias/path/enabled，
  activeWorkspaceId 也一致，不再引入 ws_forge_roundtrip_home 等不同 ID。
- receiver 候选在复制宿主闭包、创建配置前核对相同清单/回执；
  本地接收路径仍在服务器验收根内，workspaceId/alias 与输入身份一致。
- 各驱动要求显式新根，拒绝使用封存的 roundtrip-20261017-01；
  没有选择或创建下一轮部署实例。这不是绕过旧绑定或继续失败工程的手段。

### 冻结离线结果与接续位置

家中候选：
D:\VCP\Handoffs\Evidence\forge-provisioning-repair-20261017-01
- prepare-home-acceptance.cjs、seed-home.cjs、configure-home.cjs、identity.cjs。
- local-frozen-01：20/20、exit0，fail/cancelled/skipped0；TAP与前后源码指纹已核实。
- 覆盖纯身份校验、fromActual 生成器和 VM 执行 home 配置候选；
  名称/origin/localId/工作区/摘要不一致时，在解密与输出副作用前拒绝。
- prepare-home/seed 候选通过语法检查；本轮未真实执行它们或连接 Electron/SQLite 进行 seed 联调。
- 本机原 summary 中 serverDriverVerified=false 是当时历史，不改写旧回执。

服务器实际通过的候选：
C:\VCP\ClaudeBridge\operations\forge-provisioning-repair-20261017-01\retry-01
- identity.cjs、prepare-hub.cjs、prepare-receiver-host.cjs、server-identity.test.cjs；
  使用 retry-01 内的测试版本，不将父目录旧测试误称为最终通过版本。
- 20/20、exit0，fail/cancelled/skipped0；TAP在服务器独立复算一致。
- VM直接执行两个候选，但文件系统、命令、数据库构造和加密均为测试记录器；
  正常路径核对实际身份的注册/回执/封装和receiver配置，反例检查副作用前拒绝。
- 首轮 server-frozen-01 为19/20、exit1：夹具错误地为Hub预放入其本应独占新建的
  prepared.json。仅在retry-01修测试夹具，候选驱动未改；首轮TAP与源码证据保留。
- 两端共享identity.cjs原始字节相同，SHA256：
  176c87e45c942e1488088538ce3d6758df25d0ec17587a9eea35edf16c38d5c1。

### 限定结论

这两组20项是不同侧驱动的限定离线验证，不是重跑439项，也不代替真实部署或A→B→A。
旧驱动/失败证据、产品受跟踪源码和Caddy保持未变；未打开实际数据库、
未创建验收实例、未启动监听或修改路由；未提交/推送Git。
家中聚合回执位于修复目录repair-receipt.json，家中原始TAP/summary就地读取，
服务器部分是工具回传转录，未声称已在家中复制并复算服务器原TAP。

仍需：明确下一轮部署授权和隔离实例，核对候选输入文件/准备回执的实际传递，
以及普通宿主启动、退出、路由和回收驱动与新显式根的接线。
这些运行脚本未因本轮VM测试而自动适配或验收；不要直接启动旧-01驱动。
无须新增改名API、解除写门或通用部署平台；#3保持blocked。