# 可选目录展示扩展

## 范围与文件

- `projectforge-catalog-ui.js`：来源别名、搜索/来源筛选、三行卡片、键盘可聚焦说明。
- `projectforge-catalog-ui.css`：仅 `.pf-catalog-*` 命名空间，继承现有 `--pf-*` 主题变量；不改官方基础样式表。
- `tests/catalog-ui.test.cjs`：纯展示逻辑与 jsdom 测试。
- `tests/catalog-ui-window.cjs`：复用 `../scripts/test-forge-catalog-window.cjs` 的真实 Electron 隔离夹具。以唯一锚点插入扩展断言，锚点变化时拒绝执行，未重写原脚本。
- 不新增 IPC、网络请求、持久化设置或写操作，不修改 Hub 协议、发布器和租约。

## 官方页面最小接点

在既有统一目录页面基础上：
1. HTML 在 projectforge.css 后加载独立 CSS，在 projectforge.js 前加载独立 JS（2行）。
2. `renderProjectList` 可选调用 `filterProjects`；未加载扩展时保留原筛选。
3. 空列表及正常列表渲染后，可选调用 `enhanceList`。
4. DOMContentLoaded 中挂载来源筛选，变化时调用宿主原 `renderProjectList`。

原列表模板与事件委托保留：扩展只替换卡片内部展示，保留 li 的 data-id、选中和已删除状态。删除控件来自宿主已经生成的本地控件，远端不会带入删除控件；没有重写删除接口或保护逻辑。

合上游时先匹配这几个语义接点，不照抄行号。扩展依赖原 `.project-item`、`.project-delete-wrap` 与 data-id 约定；上游结构变化需复测。

撤除：去掉两项 HTML 资源引用即可回到原渲染（可选钩子无模块时跳过）；也可一并移除接入钩子与扩展文件。不要删除统一目录的数据/权限实现。

## 来源与时间语义

- home-forge-plans → 家中，company-forge-plans → 公司，server-forge-plans → 服务器。
- 这是现有部署的展示别名，不是身份认证、权限判断或机器探测；未知来源显示原始 sourceId。
- 本地数据缺少设备来源字段，显示“本机”，不硬编码成家中。
- global 类型显示“接续工程”，来源不等于当前租约持有者。
- 卡片只显示业务 updated_at；获取时间 observedAt 与代码历史未同步说明放入提示。
- stale 显示“只读 · 离线缓存”及可能过期说明；没有新增 TTL 或伪造“已同步”状态。
- 进度缺失时显示“待读取”，不把未知 Todo 当成 0 个。
- 筛选仅影响本次页面展示，不改变授权范围。筛选不会清空右侧已选择详情，也不自动选择其他工程。
- Tooltip 使用模块自带 CSS/ARIA，无额外 UI 框架依赖；键盘聚焦可显示。

## 验证

从仓库根执行：

```text
node --test ProjectForgemodules/tests/catalog-ui.test.cjs
electron ProjectForgemodules/tests/catalog-ui-window.cjs <新的绝对证据目录>
```

Electron 可用 `node_modules/electron/dist/electron.exe`；Windows 普通 Node 测试涉及原生模块时使用配套 Electron 的 ELECTRON_RUN_AS_NODE=1。

- 新展示测试+原 renderer/view/host-wiring 选定回归：33/33，exit0。证据：
  `D:\VCP\UpdateBackups\VCPChat\catalog-ui-check-6ET5kY`
- 多来源实际 Electron44 页面+合成 API：ok=true，exit0，页面 errors=[]，blockedNetwork=[]。
  `D:\VCP\UpdateBackups\VCPChat\catalog-ui-focus-ordered-e992158d-b927-44c4-998d-eb4fb649fc73`
- 覆盖六种来源、中文搜索、公司来源筛选、远端无删除、300/260px 卡片边界与等高、键盘提示、浅色渲染；复用原远端只读/离线/返回本地检查。
- 曾发现本地20px删除按钮与远端约17.7px标题造成高度差，统一标题 min-height:20px。
- 两次键盘夹具问题：非激活窗口不匹配 CSS :focus；激活触发真实焦点刷新覆盖临时样例。修正为先激活并等待 loadProjects，再注入多来源样例，未关闭产品刷新或放宽断言。
- 属于真实页面合成数据验收，不是生产数据视觉验收，不是全仓回归。

## 交付边界

文件写入家中实际客户端目录。已有 Forge 窗口需关闭再打开以加载页面资源；无需重启 Hub 或完整 VChat。
当前改动未提交推送，不能声称公司客户端已获得美化版本。家中已有 Git 暂存项与其他改动不属于本模块交付。