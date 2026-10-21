# Forge 公司冷启动修复与家中接续

## 取件入口
- 个人仓库：shenbojun1223/VCPChat。
- 本次交接分支：handoff/forge-workspace-ready-20261021。
- 基线：6e5ea72460512658e735926f5b6a7aa9837c418a（统一计划目录实现）。
- 本次只包含 main.js、modules/ipc/workspaceHandlers.js、tests/workspace-startup-ready.test.js 和本文。
- 发布是否完成以远端分支核验回执为准，本文不是推送成功证明。
- 家中先核对 hostname、实际运行根、git status 和 HEAD。不要覆盖未提交修改，不直接 reset/clean。取回此分支后检查祖先关系和差分，再合入实际使用分支；如旧工作树有改动，优先旁侧 worktree 审查。

## 根因与修复
workspaceHandlers.initialize 原本启动异步 readSettings 后立即返回。Forge 配置启动早于工作区授权列表装载，发布初始化拒绝，之后共享实例再次 initialize 又触发保护。
- initialize 返回设置就绪 Promise；main.js 在 Forge 初始化前等待。
- 不等待后台文件索引扫描，不用固定延时。
- 读取失败向等待者拒绝；被替换或 dispose 的旧初始化不能回填工作区。

第二层 AUTO_CLEANUP_REQUIRED 是配置差异：分布式入口继承全局 ALLOWED_DIRECTORIES，GUI 仅读取插件 config.env。
公司在 Forge 私有 config.env 显式设置 `ALLOWED_DIRECTORIES=`，两端使用已登记工作区。不删除实例身份保护，不扩大授权。
该私有配置不随 Git 搬运；家中先核对本地实际配置，保留已有 AUTORESUME_CONFIG_PATH 等配置，不整文件覆盖。空额外目录配置不是撤掉所有工作区权限。

## 验证
- 修复前 4 条 readiness 契约测试失败。
- 修复后 7 份选定测试 96/96，exit 0，无失败、取消、跳过；不是全仓验收。
- 公司 16:32:15 重启后锚定真实启动日志错误 0，服务插件初始化完成；ProjectForge 查询和待办写入成功。
- 公网认证读回 company-forge-plans 版本 2，修复工程 po0uv 最新待办与备注一致，证明原客户端宿主自动发布；未另开发布器。
- 公司已读回 9 个计划、33 条 Todo。后续工程报告变更可继续产生新版本，不将版本 2 当成永久最新。
- 本机证据：
  - D:\VCP\UpdateBackups\VCPChat\workspace-ready-check-KIzqaW
  - D:\VCP\Private\ForgeCatalog-company-20261021\post-restart-publication-1792571653357.json
  - 同目录 startup-log-corrected-1792571617742.json
- 本机工程 po0uv 的 ID 与证据路径仅用于公司溯源，家中不可盲用。

## 家中剩余工作
1. 取回源码并加载修复版本。
2. 配置家中独立目录身份 SHENBOJUN-catalog（凭据通过受控加密交付，不在 Git 或聊天正文中明文传递）。
3. 发布来源 home-forge-plans，使用家中独立发布日志；读取 server-forge-plans 与 company-forge-plans。
4. 发布前核对家中工程库、已启用工作区与完整共享范围。不要复制公司或服务器的业务数据库、发布日志、设备身份或令牌。
5. 完整重启后验证家中日志、发布回执、Hub 来源摘要和真实 Todo；再验证公司能读到家中来源。
Hub 已预留家中目录权限，但家中客户端配置及双向互通尚未验收。

## 使用边界
目录只分享计划摘要、Todo 和状态，不搬源码、施工历史或写租约。
服务器工程仍可直接使用 ServerProjectForge 施工；无需为了看计划而接管工程。
本次源码交接不执行家中部署，不重启服务器，不修改已有施工写权。