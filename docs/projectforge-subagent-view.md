# ProjectForge 子代理只读委托看板

工程：`p3aa6`。开发分支：`work/forge-subagents-20261031`。
基线：`473be7d47c857170dcc880b682d4e856bdc587c7`。

## 功能与边界

本地概览和远端计划共用 `ProjectForgemodules/projectforge-todos.js`：

- 委托监视卡、离散步骤条、Todo 委托详情、执行角色筛选、原始备注展开。
- 每个 Todo 对应一条委托记录；相同执行角色只合并筛选胶囊，不合并卡片。联合执行角色可分别筛选，但不拆成多笔派单。记录数量不证明实际派单次数。原始标题保留。
- Todo 的 pending/doing/blocked/done 和委托的 pending/working/review/verified/unknown 独立。
- Todo done 不等于核验通过；blocked 是独立警示，只有明确核验失败证据才标记退回。
- `updated_by` 仅显示为更新者，不推导执行人、派工方。
- 路径和产物是委托约定，不证明文件存在、产物核验、访问权限或沙箱隔离。
- 来源、版本、获取时间、离线缓存、字段预览提示继续沿用现有远端界面。
- 没有可识别委托时隐藏监视席和角色筛选，不产生空占位。
- 没有新增数据库字段、IPC、依赖、轮询或派工调度能力；不回写原始备注。
- 远端委托不生成本地文件、节点或回退入口；本地已有署名历史入口保留。

## 当前真实数据入口：旧备注

当前数据库和远端计划投影传递 `note`，不会持久化或同步下面的结构化示例。
通过已有 `UpdateTodos` 为指定任务设置备注即可，显示器不要求额外写操作：

```text
执行分身=MemoMaster;派工方=Kerr;session_id=实际会话标识;delegationId=实际委托标识;委托阶段=施工中;约定写入=src/a.js;约定产物=测试报告
```

示例标识必须替换为真实信息，缺失信息直接省略，不能为了卡片完整而虚构。
分隔符支持英文/中文分号或换行；键值支持 `=`、英文/中文冒号，忽略外围空白。
中文句号仅在其后出现明确、已知的键值时建立字段边界：
`验收说明。执行分身=@鲸鱼娘#边界复测；delegationId=真实ID。状态=待核验`
身份值不吞后续说明；身份后明确阶段、核验结果不会被过滤。只读取明确键值，不从普通叙述猜负责人或通过态；英文小数点/文件扩展名不切分。
阶段/核验值中的无键句子保留，例如“核验通过。核验未通过”“核验通过。仍需确认”不能只取第一句。身份字段后的无法解释附注会阻止通过态，但不凭空推断核验退回；明确核验失败则保留退回证据。仅结尾句号不算保留意见。
路径/产物从识别到该键起保留当前分号段的剩余全文，不扫描其中的句号键值示例。
身份值中的中文句号、所有值中的分号/换行均无转义语法；复杂值应使用结构化输入或仅留在原始备注。原始备注逐字保留。
重复冲突字段不采用“最后一个胜出”；明确否定不会随冲突字段删除而消失。截断备注始终不认证通过，自由叙述不作通用语义解析。

联合角色按 `、`、中英文逗号拆分，最多32个去重项，每项512字符；复杂单角色名称不支持分隔符转义。
结构化 `roles` 有有效项时优先，非法或空数组回退合法 `role`；原角色文本保留在详情及原始备注。
缺少 ID 只表示未提供，不推断 temporary_contact 或活会话。单独验收字段不代表派工，只有明确派工/验收复合键可提供派工身份。
阶段和验收范围均为来源文本声明，不是本页面进行的产物核验；不为截图统一变绿而修改源业务备注。

常用键及英文别名：

| 含义 | 兼容键 |
| --- | --- |
| 执行分身 | 执行分身、执行角色、subagent、executor、role |
| 派工方 | 派工方、派工人、assignedBy、delegatedBy、派工方/验收、派工/验收；单独验收不算 |
| 委托阶段 | 委托阶段、阶段、状态、stage、phase |
| 会话 | session_id、sessionId、会话 |
| 委托标识 | delegationId、delegation_id、委托ID |
| 写入约定 | 约定写入、writePaths |
| 产物约定 | 约定产物、artifacts |
| 核验结果 | 核验结果、verification |

至少有执行角色、会话或委托标识之一才识别为委托；仅有阶段或更新者不算委托。
重复且冲突的键保守处理，保留原始备注。
不从任意正文中的“已完成”“已核验”子串推导核验通过。

阶段：

- 待受理 / pending / queued → pending。
- 施工中 / 进行中 / working / running → working。
- 待核验 / review，以及明确待核验/未核验描述 → review。
- 核验通过 / 已核验通过 / verified → verified，必须是明确的通过表述。
- “已完成报告，待核验” → review；单独“已完成报告”“已核验” → unknown。
- “已核验但不通过”“核验未通过”等明确失败 → review + 核验退回；矛盾字段中的否定同样保留。缺少明确失败的保留意见只降级，不标退回。
- 明确阶段字段 `审查交付已独立核验并接受` → verified，徽章和末步骤显示“审查交付已接受”，范围固定为仅审查交付、不代表未测事项或整个工程通过。
- 明确阶段字段 `限定范围验收通过：具体范围` → verified，徽章和末步骤保留“限定范围验收通过”，卡片和详情显示原大小写的范围。
- 上述两种受控扩展只接受完整肯定句头；句号后仅允许明确证据/原始日志前缀。条件、历史状态、引用或保留意见不认证通过。待验收通过后再接受、未验收通过、如果核验通过、引用的通过表述不会变绿。
- 例如真实 ps8vm #6 无明确阶段键，仍 unknown；#7 只表示审查交付接受；#9 只表示声明的限定范围。自由叙述不据此全面升级。
- 其余值或超过512字符的阶段值 → unknown。详情保留判定依据与验收范围，原始备注可展开；不打开或核验其中的证据路径。

单条 `truncated` 是字段名列表，如 `['note']` 或 `['title']`：
截断备注只读取完整键值前缀中的身份信息，不据此推导阶段；标题截断不影响完整备注。
任务数小于已知 progress.total 时只显示“仅展示部分任务”，不令其他完整任务的阶段失效。

## 向前兼容输入，不代表后端已支持

解析器也接受经过白名单规范化的单个 `todo.subagent` 对象：

```js
{
  role: 'MemoMaster', // 也接受 roles: ['MemoMaster', 'Nova']；联合执行仍为一条记录
  assignedBy: 'Kerr',
  sessionId: '真实会话标识', // 也接受 session_id
  delegationId: '真实委托标识',
  stage: 'working', // pending | working | review | verified | unknown
  writePaths: ['src/a.js'],
  artifacts: ['测试报告'],
  verification: 'pending' // 可省略；passed/verified/通过/核验通过/验收通过表示通过
}
```

- 数组、null、字符串等不当作结构化对象。
- 有意义的结构化字段优先于备注，不把整个输入对象透传给视图。
- 字符串、路径列表、阶段枚举分别校验；未知枚举不生成动态样式类。
- 显式核验失败优先显示退回；verified 搭配未知、空白或非法核验结果降为 unknown。
- 当前一个 Todo 表示一笔委托，不支持同一 Todo 内的多委托数组或事件历史。

## 阅读状态与样式

同工程刷新保留执行角色筛选、备注展开、控件焦点及实际 `.tab-body` 阅读位置。
切工程或来源重置；选中角色消失回到全部；旧详情响应不覆盖新选择。
筛选使用原生 button + aria-pressed，备注使用原生 details/summary。
复用 --pf-*，覆盖明暗主题、760px 窄窗口和 prefers-reduced-motion。

## 验收

在隔离工作树使用现有依赖进行测试；未全量安装依赖。
本轮将工作树 node_modules 设为指向原开发树依赖的本地 junction，未纳入源码提交。

```powershell
node --check ProjectForgemodules/projectforge-todos.js
node --check ProjectForgemodules/projectforge.js
node --check scripts/test-forge-subagents-window.cjs
node --check ProjectForgemodules/tests/todos.test.cjs

node --test ProjectForgemodules/tests/todos.test.cjs ProjectForgemodules/tests/remote-detail-presentation.test.cjs ProjectForgemodules/tests/catalog-ui.test.cjs tests/project-forge-catalog-renderer.test.js tests/project-forge-event-ipc.test.js tests/projectforge-topic-surface.test.mjs

# 提供尚不存在的绝对证据目录；独立用户目录、合成API、阻断外部网络
.\node_modules\electron\dist\electron.exe scripts/test-forge-subagents-window.cjs D:\absolute\new-evidence-directory

git diff --check
```

结果：

- 4 个语法检查通过；Node 回归 39/39，通过退出码 0。
- Electron 44.0.0：8 组检查通过，退出码 0，控制台错误 0，外部网络请求 0。
- 原生 Enter 产生受信任按键与 Memo 筛选点击；独立窗口明确获取焦点。
- 同工程刷新保留筛选、展开、焦点和真实滚动位置。
- 同名多委托、Todo 与阶段解耦、恶意 HTML/属性、截断范围、负向核验。
- 明暗主题、760px 概览无横向溢出、真实 Chromium reduced-motion 媒体仿真。
- 本地/远端切换、缓存/版本提示、延迟旧响应、角色消失、普通 Todo、历史入口。
- 合成桥接记录 list=5、detail=9、history=1、forbidden=0；短静默窗口未观察到新增详情轮询。
- 既有远端只读 Diff 与发布绑定、关闭/切换竞态、事件与话题入口回归通过。
- `git diff --check` 通过。

证据相对工程根：

- `.integrations/subagents-final/regression.tap`
- `.integrations/subagents-window-r4/result.json`
- `.integrations/subagents-window-r4/*.png`

r1/r2 为失败的键盘输入夹具：缺少 Windows Chromium Enter 字符事件，r2 已确认窗口与按钮有焦点。
r3 补全 keyDown/char/keyUp 后通过；r4 增加受信任事件断言及 reduced-motion 检查后通过。
前两轮不计为通过，失败证据保留。

## 发布状态与验收限制

首轮开发交付只在隔离树。主人随后授权下一步，现用 `D:\VCP\VCPChat`
已从 `473be7d4` 安全快进到首版提交 `bf956cd1b`，部署后 39/39 回归通过；
原有配置和音频改动、原有未跟踪材料保留，未推送、未重启整个客户端。
原 ForgeNetwork 分支落后基线 236 个提交，始终没有全量同步或目录覆盖。

实际内嵌工程页面已显示本地 p3aa6 的真实 Todo、更新者及原始备注。
手动打开页面后，远端详情初次读取为空；正常刷新后 `server-forge-plans` 版本199的
`ps8vm` 页面加载成功，9条 Todo、3张委托卡及远端只读/权限边界提示可见。
空白页原因未证实，不据此宣称服务故障或协议问题。
独立只读目录客户端也成功读取真实计划和施工摘要；该诊断不启动发布器、不打开业务库、不修改历史记录。

真实备注暴露中文句号兼容缺陷：Todo #6 执行人前的叙述遮蔽字段，#6/#7 委托 ID 吞入后续说明。
为此新增3项回归，先确认原解析12项通过、新增3项失败，再修复仅身份字段的句号边界。
补丁共3文件；完整针对性回归42/42通过，八组Electron合成窗口检查再次通过。
补丁提交、运行树更新及重开工程页面后的证据以工程p3aa6最新报告为准。

部署/烟测证据根：`D:\VCP\Handoffs\Evidence\forge-subagents-deploy-20261031-01`。
含部署保护校验、runtime-regression.tap、remote-read-diagnostic-r1.json、sentence-window-r1/result.json；
红绿测试在隔离树 `.integrations/sentence-parser-red.tap` 与 `sentence-parser-green.tap`。
实际页面截图由ScreenPilot留存，不包含凭据。诊断只投影来源/版本、Todo与委托元数据，不落盘完整备注或配置。

合成窗口通过不等于真实分身会话或产物核验；实际页面也只是既有已发布备注的只读展示，
不新增派工、不验证当下分身运行或磁盘产物，不将历史Todo完成推导为阶段通过。

## 只读操作增量：定位 Todo 与复制 ID

本节记录历史开发交付：基于 `dc82effe0` 的定位/复制增量已于本日17:01部署为 `38e52e4eb`。
下文“未部署”只描述当时阶段。磁盘部署不证明现有标签已重载，真实系统剪贴板验收仍未完成。
后续 Review 修复的交付与部署状态另见文末及最新工程报告，不沿用旧增量的部署结论。

- 点击委托卡片的任务标题，定位当前工程中对应的 Todo，聚焦标题并静态强调。
  身份沿用来源、工程、Todo、委托 ID 和会话 ID；同名角色不串任务。
- 卡片与 Todo 委托详情提供“复制委托 ID”“复制会话 ID”原生按钮。
  缺少对应 ID 就不显示该按钮，普通 Todo 无占位。
- 操作只在当前页面定位，或在明确点击后调用 `navigator.clipboard.writeText`。
  不读取剪贴板，不新增 IPC、依赖或权限申请，不打开会话文件、源码路径或远端同名路径。
- 复制值取当前规范化记录，不使用任意按钮文本或额外 dataset 值。
  拒绝、不可用、失败或 4 秒未完成时显示“复制未确认”，按钮恢复可用。
  同按钮等待期间阻止重复提交；切工程、刷新替换 DOM 后不显示旧回调提示。
- 超时只终止等待，无法取消浏览器底层剪贴板操作；迟到完成不再弹成功提示。
  复制成功只证明浏览器写调用已完成，不证明委托、会话或产物真实存在。
- 定位态及新增控件焦点纳入同工程刷新保持；切来源、切工程或目标消失时清理。
  定位采用即时滚动，不新增动画；保留现有角色筛选和备注展开。

### 本轮验证

新增 `ProjectForgemodules/tests/todo-actions.test.cjs`：
先确认旧实现下新增 12 项全部失败，再实现并追加 4 项边界回归。
最终 7 个测试文件共 **58/58 通过**，4 个 JS 语法检查及 `git diff --check` 通过。

```powershell
node --test ProjectForgemodules/tests/todo-actions.test.cjs ProjectForgemodules/tests/todos.test.cjs ProjectForgemodules/tests/remote-detail-presentation.test.cjs ProjectForgemodules/tests/catalog-ui.test.cjs tests/project-forge-catalog-renderer.test.js tests/project-forge-event-ipc.test.js tests/projectforge-topic-surface.test.mjs

# 独立用户目录、隐藏窗口、合成 IPC 与替身剪贴板；证据目录必须尚不存在
.\node_modules\electron\dist\electron.exe ProjectForgemodules/tests/todo-actions-window.cjs D:\absolute\new-actions-evidence
```

隐藏 Electron 44 页面烟测 **4 组通过**：
1. 真实 Chromium 定位第二笔同名角色 Todo，聚焦标题，实际滚动且不改筛选。
2. 真实页面事件接线调用浏览器剪贴板分支，成功与拒绝反馈正确。
3. 远端只读操作及同工程刷新保持定位、焦点和实际滚动位置。
4. 浅色窄窗无新增横向溢出；窗口全程隐藏，控制台错误和外部网络请求均为 0。

证据相对开发工程根：
`.integrations/todo-actions-20261031/red.tap`、`green-r1.tap`、`green-r2.tap`、
`window-r1/result.json`。

隐藏烟测使用替身剪贴板，**未读写系统剪贴板**，也未连接生产 API；
因此不宣称新复制按钮已通过生产权限、真实系统剪贴板或生产页面端到端验收。
此前首版和句号修复的真实页面验收仍有效，但不能替代本增量的运行验收。
本轮只交付开发树与本地提交，不部署、不推送、不重启、不操作用户桌面。

## 2026-10-31 Review 修复交付

开发基线 `38e52e4ebaafb865dc04d69d5ebb5466cdf93dba`，继续使用工程 `p3aa6` 和既有隔离工作树。

- P1：身份字段句号后的明确阶段/核验结果不再丢失；字段冲突保留否定证据。
  同值内否定、身份字段后无键否定或保留意见不被吞掉；未知附注阻止通过而不虚构失败。
- P2：支持 `状态=` 及明确复合派工键；审查交付接受和限定范围验收保留自身标签、
  判定依据和范围，不升级为整个工程通过。无键的复测接受仍未知。
- 联合角色规范化为数组，各角色可独立筛选、定位同一 Todo；不复制委托卡或推断派单次数。
- 卡片角色换行、阶段区靠右上、中性卡底、底部步骤与操作、紧凑 Todo 状态；
  退回步骤使用与退回徽章相同的警示红。原始标题及备注保留。

### 本轮验证与证据

- 4 个 JS 语法检查、8 个测试文件 **76/76** 回归、`git diff --check` 通过。
- Review 隐藏 Electron 44 页面 **4 组**检查通过、进程退出0：
  阶段诚实展示与退回计算颜色；明暗1280/760px无横向溢出；
  联合角色筛选/定位和远端刷新保留展开、焦点、实际滚动；reduced-motion及只读边界。
- 原定位/复制隐藏页面 **4 组**检查通过、进程退出0；使用替身剪贴板。
- 两组窗口均未显示，合成 IPC；外部请求、控制台错误均为空。
  这不是生产数据端到端、真实系统剪贴板或全仓验收。
- 最初8项P1回归为1过7挂；修复后8项与原15项解析用例均通过。
  该次 `p1-green.tap` 执行时已加入7项P2，文件总结果仍失败，不能把文件名当全绿证据。
  后续相邻边界与附注分别先红再绿；截图发现的退回步骤颜色也先用计算样式复现失败再修复。

证据相对工程根 `.integrations/review-20261031/`：

- `p1-red.tap`、`p1-green.tap`、`edge-red.tap`、`final-edge-red.tap`：过程回归，包含预期红灯。
- `green-final.tap`：最终76/76回归。
- `window-color-red/result.json`：退回颜色失败证据。
- `window-final/result.json`、`window-final/*.png`：最终Review隐藏页面结果与截图。
- `actions-final/result.json`：原定位/复制隐藏页面最终结果。
- `window-r1/result.json`：新增颜色断言前的阶段结果，不代替最终版本。

本次仅在隔离开发树修复并准备本地提交；未更新 `D:\VCP\VCPChat` 运行目录，
未推送、重启、操作用户桌面或读写系统剪贴板；未修改服务器 `ps8vm` 的源 Todo。
运行目录更新需另行授权并重新核验基线，不能从旧版已部署推断本修复已经上线。