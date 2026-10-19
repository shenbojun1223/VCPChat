# 最新结果：日常单工程接续及返回后续写已验证

本节为当前结论；下方部署准备及“当前未执行”等标题属于切换前历史。
施工工程p9b2t的最终状态以本阶段SubmitReport回执为准，不用旧阶段说明覆盖实际结果。
产品固定eaf5ab5e7ba26479c738c8c66aa9c051c65db78b，实现08a258d4d8758d19e3938058a61513a102c780fc。
目标未变：Forge自动保存工程状态，正常交权后换设备继续，不依赖人工Git搬运状态。
本次仅接通一个可丢弃试点，未批量绑定其他工程，也未增加产品架构。

## 实际接入与范围

- 家中使用日常D:\VCP\VCPChat客户端及原启动器StartVCPchat.exe；试点pdgnk，
  原目录D:\VCP\VCPChat\tmp\forge-daily-pilot-20261017-01。
- 服务器使用常驻VCPToolBox/ServerProjectForge及正常工具入口；本地试点p4dbb，
  仓库外目录C:\VCP\ForgeProjects\daily-pilot，工作区forge-pilot。
- 固定Hub为hub-ac896e1a-3f30-45f0-afc7-7c29345e57f8；
  唯一globalId为g_19defb30-7dd1-4777-a55a-156d56db4671。
  Hub、专用单工程配置与凭据保留在仓库外，沿用已有PM2和Caddy；家中HTTPS校验开启。
- 两端原Forge库路径保留，部署按白名单切换，没有安装或重建依赖。
  原服务器业务库先完成schema3→4兼容升级；单工程写门及原目录更新另按既有机制推进。
  “只同步一个工程”不等于数据库迁移仅影响一行。
- 双端仍是单写者模型：谁持有租约谁可写；客户端打开并不等于自动取得写权。

## 真实日常路径与证据

1. 家中普通Forge施工生成n116/b102并后台自动发布；节点115为原初始文件，
   试点文件“家中日常试点自动保存通过”为36字节、无末尾LF。
2. 修正后的服务器接收端在家中持权时安全等待，未创建目标目录或工程。
3. 第二轮家中进程50020正常退出，独立观察器捕获exit0。
   最后家中检查点revision6/fence3，服务器自动取得fence4并接收至p4dbb。
4. 服务器通过常驻/v1/human/tool→PluginManager普通EditCode/UpdateTodos续写，
   自动发布revision7，文件“服务器日常试点接续完成”为33字节；
   原有业务记录保留。验证作业通过暂停接收配置及既有admin重启交权，
   服务器最后检查点revision8。
5. 家中观察脚本校验服务器检查点和租约释放后，调用原StartVCPchat.exe；
   原工程pdgnk自动更新，自动发布revision9/fence5。
   该自动重开是本次一次性验证作业，不是新建的常驻重开平台。
6. 后续另有启动/交权周期，服务器取得fence6。通过正常宿主关闭/重启流程，
   家中当前客户端接回fence7并发布revision12。
   该次辅助作业因NORMAL_SHUTDOWN_NOT_VERIFIED未完成自动收尾，接收配置暂留暂停；
   不将辅助作业的失败回执改成成功，也不把它称为捕获了优雅exit0。
7. 原家中普通ProjectForge EditCode生成n118/b104，文件改为
   “家中返回后继续施工完成”，33字节；后台自动发布revision13/fence7。
   正常UpdateTodos完成Todo3，随后检查点revision14含3/3已完成Todo。
8. 服务器现有接收配置以精确原字节恢复，使用Windows支持的PM2 stop/start，
   不冒称应用优雅退出。restore-waiting-final-01/result.json为ok=true：
   接收端重新启用，owner为新主进程，映射revision11不变，无待发布记录或冻结载荷。
   当时家中持revision14/fence7，因此服务器处于安全等待。
9. 后继实查2026-10-18T05:07:23.656Z显示服务器已持fence8，检查点revision16。
   已下载验证其全部4个逻辑历史节点、文件和三个done Todo；不是当前家中持权，
   也不把历史“服务器安全等待”回执冒称永久状态。未为归档再触发交权。

施工、检查点保存与租约操作均由既有Forge宿主控制器执行；
验证作业只调用普通施工/配置/重启入口及只读检查，没有手调publish、acquire、
takeover或advanceLocal。常驻接收端保留启用；不要求主人再次退出或重启。

## 原目录与跨端历史核验

- 家中原工程pdgnk及根目录dev/ino 609990020 / 1688849860763826保留；
  原节点115/116、原批次101/102及Todo ID45/46/47保留。
- 服务器编辑接回家中为节点117/b103；家中返回续写为节点118/b104。
  跨端导入使用独立主键，不能拿家中节点ID直接在服务器bundle中查找。
- 最终逻辑审计逐节点比较内容字段、关联批次字段和Todo序号，确认映射：
  家中115/101→服务器12/12，116/102→13/13，
  117/103→14/14，118/104→15/15；4个逻辑节点全部保留。
- 之前returnEditPresent=false是跨库直接比较主键的验证器误判，
  不是编辑丢失。未修改文件、产品或数据库迎合错误断言。
- 最终文件SHA256：
  c7bd3dae1e89f5fcc8c0e8db6fcc64725afc57d0e70e2318efb574a4f4e76225；
  三个试点Todo均done，Capture记录0。未以空集合宣称真实Capture接续已验收。
- 最新已审计revision16的完整bundle摘要以
  D:\VCP\ForgePilot\daily-roundtrip-02\final-logical-history-audit.json为准；
  发表端SERVER-daily-pilot/fence8。租约实时变化，本文记录的是实查时间点。

## 失败保全、恢复与收尾

- 首次日常接收根误放在既有整仓工程pf33h的C:\VCP\VCPToolBox内，
  assertExclusiveImportRoot返回DESTINATION_EXISTS。此为部署选址遗漏，不归责用户重启。
- 原接收仅留下pending映射及planned物化任务，没有创建接收工程或发布。
  经明确停机和恢复授权，确认8业务表、sqlite_sequence与备份一致后，
  完整封存失败Forge库/mapping/journal组，恢复启用前schema4配套状态。
  未SQL删除pending、解绑或绕过目录守卫；恢复及失败证据保留。
- 仓库外新目标在绑定前核验不与旧工程重叠；保留旧工作区、原3工程和业务行。
- 服务器最终恢复作业确认旧库历史不变，其他PM2、固定Hub、Caddy、New API正常；
  当前常驻配置保留，并非前阶段独立验收的“所有服务全部回收”。
- 一次性观察、重开和续写作业均已退出，不重放旧脚本。
  旧失败及正常关停证据不足的记录保留，不通过额外重启美化结论。

## 权威记录与交付边界

家中D:\VCP\ForgePilot\daily-roundtrip-02：
home-before.json、result.json、observed-home-exit.json、server-final-checkpoint.json、
relaunch.json、return-live-inspection.json、home-return-edit-verified.json、
home-return-edited.bundle、final-logical-history-audit.json及final-audited-checkpoint.bundle。
服务器C:\VCP\ClaudeBridge\operations\forge-daily-pilot-cutover-20261017-01：
daily-roundtrip-02/result.json（真实服务器施工和首次回程）；
receiver-restore-01（旧接收完整恢复）、receiver-enable-02（无重叠新目标启用）；
return-current-home-01/result.json（正常关停核验不足、保留失败）；
restore-waiting-final-01/result.json（现有配置恢复及待命核验通过）。
家中保存的服务器回执为工具结果转录，不冒称在家中复制并复算服务器原件。

本次只验收该日常试点，不包含多工程调度、PI/公司机、任意外部编辑器隔离、
整仓依赖/密钥/会话同步或真实Capture；既有439项不重跑、不与本次用例相加。
固定Hub和两端接收配置保留运行；最近服务器持权，家中正确等待。
源码Git交付与工程状态同步是两件事；本节归档不产生Git提交或推送。
到此仅做文档和施工报告收口，不新增产品功能、不绑定其他工程、不再操作服务。

---

## 以下为部署前准备记录（历史，当前状态以上节为准）
# Forge 日常单工程试点：固定版本交付与受控切换

历史状态（部署前）：当时仅部署准备，尚未上线。现已完成顶部记录的日常单工程试点；前阶段p0jsf的独立真实往返accepted事实保持。
产品版本eaf5ab5e7ba26479c738c8c66aa9c051c65db78b，实现08a258d4d8758d19e3938058a61513a102c780fc。
目标：日常客户端/服务器自动保存一个工程，正常退出交权、换设备继续；不依赖人工Git上传工程状态。
首轮只放行一个新建可丢弃工程；不接PI、不做多工程调度、不批量同步、不新增改名/解绑API。

## 已核实的最小改动

- 家中原树D:\VCP\VCPChat仍personal/main=19e1283f，七份受跟踪改动及未跟踪现场保留。
  旁侧树D:\VCP\VCPChat-ForgeNetwork在eaf5ab5e。
- 宿主改动仅main.js、modules/ipc/projectForgeHandlers.js；
  package.json/package-lock.json和workspaceIndex.js两边原始字节一致，不安装或重建依赖。
  具体安装仍须逐文件核对部署前字节，禁止以整个分支覆盖原脏树。
- Forge插件内更新至同一固定版本，fileKit取同一提交。
  Windows索引器已在Git中，保持固定版本，不为同步需求改AST索引逻辑。
- 服务器常驻ServerProjectForge是hybridservice/direct；现有配置保留工作区和数据库路径。
  只在部署副本manifest中适配ServerProjectForge名称，不改宿主Plugin.js、不建新插件体系。
- 当前两端AUTORESUME_CONFIG_PATH均未启用。
  不将数据库路径切到空试点库以隐藏原有工程，不复制生产库让两个宿主各写一份。
- 只给新试点工程创建autoResume绑定；既有非试点工程不自动注册或上传。
  本地Forge本身的schema升级仍影响整个库，不能与“仅同步一个工程”混淆。

## 数据库与兼容硬边界

代码依据：store.js ProjectStore构造器、projectAvailability.js、projectWriteGate.js、projectUpdate.js。

1. 新Store第一次打开旧schema1/2/3库，即执行建表补列与availability/收据处理，设置schema4。
   即使AUTORESUME_CONFIG_PATH关闭也如此；本阶段尚未打开原库，当前原库实际版本未知。
2. 显式绑定工程升本地schema5；首次推进已有原目录更新启用schema6。
   旧schema5/6保留，不降为4。便携bundle版本与本地库版本分开。
3. 真正切换前停止所有打开该库的旧宿主/相关Worker；禁止新旧版本并发同库。
4. 不修改meta、删除绑定/更新标记来“回退”。不承诺旧客户端可以读新版库。
5. 部署前可用SQLite只读连接核实版本、表和工程计数，不实例化ProjectStore做探测。
   数据及日志路径由配置/源码推导，不能凭目录名猜实际库。
6. 回退需要恢复同一停机备份组里的代码、配置和数据库；新库里的试点或普通施工进度不会自动合并回旧备份。
   切换验证期间必须暂停普通施工；若已产生需保留的新进度，先停并保全，不能盲恢复旧库。
7. 前阶段-01失败与-02验收库/映射/private均封存，不拿验收旧副本、旧凭据充当常驻实例。
   -02服务器副本落后最终A，禁止直接盲启旧宿主。

## 交付包（准备，不执行安装）

拟定目录D:\VCP\Handoffs\ForgeDailyPilot-20261017-01。
内容：
- source：从固定Git对象导出Forge、fileKit和两处前端宿主文件，逐文件Git blob及SHA256核验。
- reference：package.json/package-lock.json仅供依赖一致性核对，不自动覆盖或安装。
- docs：p0jsf已验收记录原件和本切换清单。
- drivers/home：本机已验证的四份无密钥准备脚本原字节，仅作参考，不是日常启动命令。
- drivers/server/REFERENCES.json：服务器已验证脚本的原位置、大小及SHA256索引。
  服务器脚本仍保留服务器原处，本包未复制其原件，不冒称跨机已交付或在家中复算。
  旧脚本的-01/-02根、端口、public-tls-proof输入、输入/回执目录和退出证据阶段都与验收实例绑定，
  不直接运行这些旧脚本；常驻Hub只复用现有模块与现有系统启动方式，不另造进程管理平台。
- manifest：产品commit、文件路径/大小/blob/SHA256及本机现场保护信息。
不含数据库、config.env、AppData、token、密钥、运行日志或node_modules。
交付包是文件保全，不等于Git已提交/推送，不等于服务器已收到或安装。
不得因包存在就重放一次性初始化脚本。

## 真正切换顺序（执行前须明确停机、库升级授权）

1. 确认实际数据库/配置路径、旧进程归属和待部署文件摘要；只读核实库版本、open Capture与工程计数。
   如有未结束Capture或在途Worker，先通过正常流程结束，不能删除记录强行通过。
2. 明确停机窗口：家中当前聊天客户端也受影响；服务器重启影响现有业务连接。
   先停施工、正常退出/关闭相关旧宿主。禁止聊天中强关当前客户端。
3. 完整备份：
   - 被替换的全部现存文件及不存在项清单；两端config.env、设置文件、库路径记录。
   - 库文件和仍存在的-wal/-shm在所有连接退出后作为同一组保存，或做受控SQLite一致性备份。
     禁止只复制正在写的主.db并称完整备份。
   - 新生成的凭据放在ACL受限的仓库外，不写聊天/日志/交付包。
4. 更新精确白名单文件；保留工作区、原数据库路径和原工程。
   配置暂不启用autoResume，启动新版并核对旧工程可见/历史数量及普通功能；无需重跑439项。
   原库迁移失败或计数漂移立即停止，不删除数据兜底。
5. 通过普通Forge创建新试点工程，从实际工程/工作区读取name/origin/localId/root生成单一身份清单。
   在任何绑定前核对两端清单、Hub注册字段、完整工作区及摘要。
6. 复用已验收Hub/network/autoResume：一个固定Hub、稳定数据目录、回环监听、现有Caddy单前缀。
   专用设备/单工程凭据，TLS验证开启；只用已有系统启动方式常驻，不开发进程管理平台。
   具体稳定路径、端口、路由与启动方式在实际现场确认后写清；本清单不预设已启用。
7. 显式配置单工程AUTORESUME_CONFIG_PATH；确认GUI与分布式宿主共用一个控制器且初始化身份一致。
   不在线补调内部接管/发布来掩盖宿主接线失败。
8. 日常入口做一次试点A→B→A，检查原本地ID/目录/历史、正常退出交权和自动续写。
   这是日常宿主接入检查，不重复开发或扩大前阶段限定验收；不把已accepted事实退回。
9. 检查业务现场与备份可恢复性。失败则正常关门停机，按配套备份组回退，保留新库/日志用于诊断。
   未确认恢复成功前不放行普通施工。成功只保留试点授权，不自动绑定其他工程。

## 当前未执行

没有覆盖常驻源码、安装依赖、打开或迁移原库、设置同步凭据、启用固定Hub/路由，
没有重启客户端/服务器、创建试点同步工程或上传业务工程。
新施工工程和文档正常Forge审计不等于部署进程已打开原库做迁移。
真实库升级/停机前必须明确影响并确认，不能拿“继续准备”当成静默切换授权。

## 宿主一致性核对已完成（源码级，不是运行时启用）

- main.js 的GUI初始化与DistributedServer构造都传workspaceHandlers.workspaceService；
  workspaceHandlers导出的是同一个Object.freeze稳定对象，不是每次getter创建新门面。
- DistributedServer保留该引用，再由Plugin.js initializeServices的services原样注入。
  两端require指向同一前端插件模块路径，正常GUI/direct应复用一个控制器。
- GUI直接dotenv.parse(config.env)，分布式宿主按manifest.configSchema读取同文件值，
  缺项还可能从process.env回退。部署时须在插件config.env中显式给齐运行时身份字段：
  PROJECTFORGE_DB_PATH、AUTORESUME_CONFIG_PATH、WORKSPACES、ACTIVE_WORKSPACE、
  ALLOWED_DIRECTORIES、MAX_EDIT_FILE_SIZE、READ_MAX_FILES、READ_MAX_TOTAL_BYTES、AST_INDEX_ENABLED。
  保留原有效限制，不为试点扩大目录授权；两条初始化路径的解析值必须相同。
- 数值由Forge posInt归一化，布尔由configBool归一化，runtime签名对字符串化值比较；
  不能通过关闭分布式服务假称已验证当前日常双入口。
- 不需要修改Plugin.js、VCPDistributedServer.js或workspaceHandlers.js。
  只读源码核对不等于已经在日常实例启动，切换后仍须确认没有重复控制器或AUTO_CLEANUP_REQUIRED。

## 本次交付完成后只剩受控切换

交付物是固定产品源码、配置/备份步骤和验收驱动参考，不是可直接执行的一键安装程序。
不增加安装框架。完成字节清单和归档后，#1/#2可结项；#3仅在明确停机及原库升级授权后执行。

拟采用最少常驻组件：
- 服务器一个仓库外固定Hub目录C:\VCP\ForgeHub；单一回环端口及现有Caddy单前缀，
  在切换前实际核对空闲和路由，TLS与专用单工程授权沿用已验收机制。
- 两端沿用原Forge数据库路径，单独的mapping/publication/private配置在仓库外保存；
  仅登记新建可丢弃试点工程，既有工程不自动注册或上传。
- 家中仅更新main.js、projectForgeHandlers.js和Forge/fileKit白名单；
  服务器只更新ServerProjectForge及插件内fileKit，manifest仅适配既有插件名称。
  不覆盖其他脏文件、不安装依赖、不变更服务器宿主Plugin.js。
- 停机期间先备份再更新；开启同步前先确认原有工程仍可见。
  本包不包含原库备份，备份必须在真正停机后单独完成，不能拿源码包冒充可恢复数据库备份。