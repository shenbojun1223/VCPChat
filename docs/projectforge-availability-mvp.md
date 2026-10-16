# Forge 本地 availability 门禁与接收库升级

## 产品目标与本轮交付

**跨设备接续由系统自动保存、上传和取回，不依赖用户提醒或 Agent 自觉提交。**
Git 在当前开发阶段只负责源码交接与恢复点，不是将产品体验降级为人工 commit/push。
未来依然需要自动检查点、后台传输、全局工程映射、认证、租约写入口和失租停止；
本轮只完成其前置的“工程尚未发布时不可提前使用”门禁。

内部库 `projectAvailability.js` 与 Store/工具/GUI 集成，验证环境为 Windows 公司机
JOSHUASHEN-PC6 的旁侧工作树 `D:\VCP\VCPChat-ForgeSync`、合成 bundle 和临时数据库。
没有升级真实业务库，没有更新当前运行的客户端或服务器常驻插件，
没有新增生产 Import/Takeover 工具或 HTTP 入口。

## 状态与兼容性

本地 Forge schema **4**：
- projects.availability = `ready | pending`，独立于 status 和 deleted_at。
- 普通新建、既有工程迁移默认 ready；accepted 等业务状态不代表可用性。
- pending 工程的 deleted_at 保持 null，不再借用软删除隐藏。
- getProject/listProjects 即使 includeDeleted 也不展示 pending，没有 includePending 开关。
- 普通带工程 ID 的 Store 读取/写入、工具、GUI 详情、恢复/删除/清除均拒绝 pending。
- 全局历史搜索过滤 pending；指定工程的 SearchHistory 沿用“不可用/不存在则拒绝”契约。

便携 records bundle 仍为 format v1 / schema **3**，不序列化本机 availability。
新版 export/import 需要新版 ProjectStore 提供的本地 schema4。
普通 bundle 校验/创建副本不自动启用收据扩展；显式接管才初始化收据。
普通 importProjectBundle 仍是内部“记录副本”接口，不是经过物化的完整接管入口，
不得绕过协调器直接开放给生产调用者。

## 事务与普通入口守卫

### 同一接收库的项目访问

projectAvailability.installStoreGuards 为已有方法安装固定清单的守卫：
- reads 在读事务中检查项目状态再查询；
- writes 使用 BEGIN IMMEDIATE，将检查和变更放在同一写入保留内；
- 删除/恢复/purge 批量请求先预检全部 ID，任一个 pending 则整笔拒绝；
- 调用链内部嵌套事务沿用 better-sqlite3 savepoint，不宣称外层未提交数据已持久化；
- getProject/listProjects/searchNodes 直接在查询条件中控制可见性；
- 增加 Store 新方法时必须审查守卫清单；这不是数据库权限系统。

`PROJECT_UNAVAILABLE` 表示当前普通访问被拒绝。
底层 db、blob 存取和内部 completeProjectImport 仍是可信能力，
没有被宣称为能抵御管理员或任意 SQL 调用的安全沙箱。

### 目标目录防别名绕过

仅隐藏工程 ID 不足以隔离目录：不能让普通 CreateProject 登记同一路径的新工程来绕过。
同一库内：
- pending 根及父子重叠路径对普通新建、改 root、bundle 导入导出保留；
- CreateProject 在 mkdir 之前检查，检查/同步 mkdir/登记同处写入保留，避免 await 间隙；
- 新 pending 接管根还拒绝与任何既有工程根重叠，包括软删除记录；
- 普通 fileOf 检查最终文件路径，避免旧父工程访问 pending 子目录；
- FindSymbol/Trace workspace 扫描遇 pending 保守拒绝整个扫描，而不是返回半份结果；
- AST 每个异步阶段返回后复查目录保留，防止扫描等待期间新增 pending 后把结果返回。

这只协调**同一接收库**内的词法绝对路径。
不提供跨库全局锁、恶意 symlink/junction/硬链接别名防护或 OS 文件权限隔离。
文件系统和 SQLite 仍非共同原子事务；mkdir 之后若 SQL 失败，目录可能残留。
进程外写者和其他数据库不能靠这些守卫自动停止，调用者仍需协调写者。

## 收据 v2 与清除墓碑

project_import_receipts v2：
- project_id 可空，引用 projects(id)，ON DELETE SET NULL；
- original_project_id 永久保留，阻止清除后随机 ID 被再次使用；
- state = `pending | complete | purged`；
- purged_at 记录清除时间；result/ID 映射和绑定仍留作幂等墓碑；
- 目标 destination_key 继续保留，不能把旧请求悄悄换成一个新目标。

pending 工程普通 purge 拒绝；完成工程沿用普通工具“先软删再确认清除”的流程。
Store 底层 purgeProjects 沿用可信内部调用语义，不新增其已有软删前置限制。
项目删除与 complete→purged 收据更新同事务；故障时二者一起回滚。
触发器同时防止 raw DELETE 清除 pending，并为 complete raw DELETE 留下墓碑；
这不意味着任意 raw SQL 更新也会被限制。

原 requestId 的 start/resume/takeover、幂等导入和完成门在 purged 后返回 `IMPORT_PURGED`，
不会因回执重放创建第二个工程或再次写文件。
getTask 仍可读出原 projectId 与 purged 状态，ready/filesystemVerified 均 false。
普通清除只删元数据，保留已发布工作树；“重新导入”为显式新请求，不能冒充旧请求恢复。
墓碑/发布日志取消、保留期和空间回收策略仍未实现，不能无限部署而不规划容量。

## 旧库与旧 v1 收据迁移

构造新版 ProjectStore 时，在一个 BEGIN IMMEDIATE 内：
1. 创建/补齐 schema 列及索引；
2. 检查版本，识别旧 v1 收据；
3. 对旧 pending 检查原软删隔离标记、关联工程和完整元数据指纹；
4. 将旧收据表换为 v2，保留接收库身份、requestId、ID 映射和发布绑定；
5. 旧 pending 改为 availability=pending，清除临时软删标记，恢复 source_deleted_by；
6. 校验收据/工程状态一致性及孤儿 pending，安装清除触发器；
7. 最后写本地 schema_version=4 并提交。

任一步报错则回滚表结构、记录及版本；构造失败关闭连接。
旧 pending 若已被手动恢复、元数据漂移、接收库身份损坏或版本不支持，则拒绝迁移。
旧 complete 可以已有后续正常修改/软删；迁移不强制它仍等于原导入指纹，
但旧请求恢复仍按既有漂移规则拒绝，不覆盖后续工作。
无收据扩展的普通旧库只迁移 schema4，不自动创建收据。
声明版本4的库也会检查收据和 availability 一致性，拒绝孤儿 pending。

**上线前必须停旧进程、备份数据库并确认升级顺序。**
旧 schema3 Store 没有新守卫，而且旧构造代码会覆盖版本标记；
不能让旧客户端与新客户端同时打开同一库，不能把旧程序当作兼容降级方案。
本轮故障测试覆盖进程退出和事务回滚，不承诺突然断电、数据库旧备份回退或恶意篡改。
生产没有执行本迁移。

## 本机验收

测试在现有 Electron Node 模式下显式等待，未安装依赖或重建原生模块。
12 个 `tests/project-forge*.test.js` 共 **235/235 通过**，
exit=0，fail/cancelled/skipped均0；其中 availability 专项 **83/83**。
专项是235项的子集，不能加成318个不同用例。

专项覆盖：
- 25个 Store 方法的 pending 访问阻断；
- 21个工具命令、ResolveEdit旧票据、列表/搜索及GUI详情/批次/节点/恢复/删除；
- 批量操作 pending 位于首/尾时全部回滚；
- 新建/改root/普通bundle导入绕过和旧父工程文件入口；
- complete purge、请求墓碑、旧ID保留、SQL失败回滚及重开库；
- v1 pending/complete迁移，4种损坏拒绝，版本写入故障全回滚；
- 3个真实 process.exit(73) 点：ADD COLUMN、收据表RENAME、旧表DROP；
- 4个独立SQLite连接48次普通修改尝试均拒绝；
- 7项AST扫描门禁/异步竞态：既有pending零扫描，FindSymbol初次/重试，
  Trace preload、首次facts、补充facts期间新增pending不返回结果。

首次专项75/76：SearchHistory测试错把指定不可用工程的既有拒绝契约写成空列表，
只修测试并补全局搜索不泄露断言，没有修改生产逻辑迁就测试。
随后76/76及228/228通过；补7项竞态后最终83/83及235/235通过。

本机证据根：
`D:\VCP\Handoffs\Evidence\forge-availability-office-20261016-01`
- `availability-targeted-03/tests.tap`
  SHA-256 `e540b2228896c623e662b2877456281ae2c4aff30127d39cd2f8583629bf1ac24`
- `availability-full-02/tests.tap`
  SHA-256 `d81e23ce96d2626f63fff0ae4d073a1bd1a4499a563e75d2a790f56b929a809cb`
- 各目录 summary.json 包含源码 SHA-256；测试时 HEAD 仍171d138a，
  验证对象是这些未提交文件，不是171d138a旧实现。发布前须核对记录字节与提交一致。
- 独立 Forge 审计：工程pw8b4，construction.db，未使用业务工程库。
- 公司旧D:\VCP\VCPChat保持personal/main=19e1283f，六份未跟踪源码/文档、
  原索引和HEAD经测试前后指纹保护；旁侧工作树代码独立修改。

这是本机库级与工具/GUI门面回归，不是全应用GUI操作验收，
不是服务器新版复测、断电恢复或真实跨设备自动接续终验。
旧协调库的服务器104/104仅适用于此前版本，不能套用到schema4新版本。

## 下一阶段

本轮到此停止，不继续新增服务：
1. 在另一环境核对同一Git版本并复测；
2. Hub可信bundle内容存储、全局工程与本机路径映射；
3. 认证网络接口与后台自动发布/取回触发；
4. 把写租约/心跳接入实际写入口，失租必须停止Worker；
5. 验收真实跨设备自动交接：只同步最后成功上传检查点，未上传断网内容不可能凭空出现。

**“系统自动同步”是产品目标，不是本轮已交付状态。**
本轮只为自动同步补齐本地不可用状态、旧库升级和普通入口门禁。