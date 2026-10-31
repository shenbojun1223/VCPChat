# ProjectForge 子代理只读委托看板

工程：`p3aa6`。开发分支：`work/forge-subagents-20261031`。
基线：`473be7d47c857170dcc880b682d4e856bdc587c7`。

## 功能与边界

本地概览和远端计划共用 `ProjectForgemodules/projectforge-todos.js`：

- 委托监视卡、离散步骤条、Todo 委托详情、执行角色筛选、原始备注展开。
- 每个 Todo 的单笔委托分别显示；相同执行角色只合并筛选胶囊，不合并卡片。
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
键值中的分号/换行本身没有转义语法，复杂自由文本应留在原始备注中，不作为协议值。

常用键及英文别名：

| 含义 | 兼容键 |
| --- | --- |
| 执行分身 | 执行分身、执行角色、subagent、executor、role |
| 派工方 | 派工方、派工人、assignedBy、delegatedBy |
| 委托阶段 | 委托阶段、阶段、stage、phase |
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
- “已核验但不通过”“核验未通过”等明确失败 → review + 核验退回。
- 其余值 → unknown。

单条 `truncated` 是字段名列表，如 `['note']` 或 `['title']`：
截断备注只读取完整键值前缀中的身份信息，不据此推导阶段；标题截断不影响完整备注。
任务数小于已知 progress.total 时只显示“仅展示部分任务”，不令其他完整任务的阶段失效。

## 向前兼容输入，不代表后端已支持

解析器也接受经过白名单规范化的单个 `todo.subagent` 对象：

```js
{
  role: 'MemoMaster',
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

本轮仅交付隔离开发树源码、测试和文档，未更新实际运行目录、未推送、未重启。
家中实际加载目录在开工时核验为 `D:\VCP\VCPChat`，仍保持原基线。
原 ForgeNetwork 分支落后该基线 236 个提交，因此从已核验完整基线建隔离工作树，而非全量同步或覆盖运行目录。

本轮 Electron 测试加载真实 HTML/CSS/脚本，但 API 与数据是合成的：
不等于生产数据库、真实远端同步、真实分身会话或真实产物核验的端到端验收。
实际运行目录更新和真实数据烟测另按当前授权安排。