# Forge 公司接续交接 — 2026-10-20

## 先看结论

本交接更新的是运行现场核实结果，不改 Forge 实现。
原集成验收 pojwg 的612项选定回归仍仅对应其固定实现，不等于公司部署验收。

| 端 | 已确认事实 | 未确认事项 |
| --- | --- | --- |
| 家中 SHENBOJUN | 主目录 Forge 所选29份 js/cjs/json/exe 与固定发布树原字节一致；main.js、modules/ipc/projectForgeHandlers.js也一致 | 未据此证明全部进程内模块的实际加载版本 |
| 服务器 | 四文件新版候选已在服务器完成隔离验证 | 常驻ServerProjectForge仍未替换或重载 |
| 公司 | 已提供唯一固定源码入口 | 公司当前文件、进程、配置、绑定与写权均未实时核实 |

不要继续把旧文档“家中尚未部署”的阶段记录当作最新磁盘事实。
也不要因家中Git HEAD较旧，就重复覆盖已经对齐的Forge文件。

## 唯一实现取件入口

- 个人仓库：`shenbojun1223/VCPChat`
- 发布分支：`work/forge-official-integration-20261019`
- 固定取件提交：`1d7df76b621a9a88472211633e0b8ed502bab6c0`
- 实现合并提交：`61f8424f7e6d302e77a59778648b18d095acbd5a`
- 本文若作为后继发布，只是交接文档；实现仍固定为上述版本。
- 首读：`docs/projectforge-official-integration-20261019.md`
- `eaf5ab5e` 为旧基线，不再作为新版取件目标。

家中核验目录：
- 主目录：`D:\VCP\VCPChat`
- 发布树：`D:\VCP\VCPChat-ForgeNetwork\.integrations\official-20261019`

29文件比较不包括设备配置、依赖、数据库或其他全部客户端文件。

## 四份产品文件的固定摘要

相对前端目录 `VCPDistributedServer/Plugin/ProjectForge/`：

| 文件 | SHA256 |
| --- | --- |
| ProjectForgeService.js | fdd203f01df38b7b3f85b5926c2debbcf3f5f630c39cee0afd1e56befc77d657 |
| args.js | 501ffb571b1bf245143f45c75de9a6e3178690704c178f813bebde87fc34eb9c |
| indexerClient.js | 510552366e2b65fd848cec0cf387f48099a27764d0910eef329c1597773dd7a1 |
| bin/win32-x64/projectforge_indexer.exe | 5887246606fad5abe81a5c48978e5b5bb387fa0dd978801ef5dc595df051abe4 |

EXE大小17896960字节，协议3。三个JS与配套EXE须作为已验证组合交付，不凭协议号相同就任意混用旧二进制。

## 服务器验证边界

服务器候选来自上述固定Git提交；仅叠加四文件，沿用服务器源码副本。
保留服务器manifest、插件内fileKit、依赖与设备配置，不复制生产配置或业务数据库进测试。

- wrapped initialize：11/11编辑契约通过，exit0。
- flat initialize与静态临时工作区：同一套11/11通过，exit0。
- 两种初始化方式不是22个不同用例。
- 新EXE：JS、Shell、PowerShell合成文本预期符号及行号边界通过，正常shutdown exit0。
- Shell/PowerShell文本没有执行。几何Outline是近似结构识别，不是完整语义AST支持。
- 测试监测的候选和生产源文件未变；JS网络拦截attempts=0，不是OS沙箱。
- 不代表实际PluginManager重载、生产数据库升级或新版跨设备往返已验收。

服务器证据：
`C:\VCP\ClaudeBridge\operations\forge-unify-source-EKTanX`
子目录：`server-contract-01`、`server-flat-contract-01`、`indexer-smoke-01`。
完整服务器交接单为该目录下的`HANDOFF.md`。

## 明天在公司按这个顺序做

1. 确认机器名、客户端实际加载根目录，以及Git状态和已有worktree。
2. 保护公司独有未提交源码、设备配置和工程数据，不执行盲目pull、reset --hard、clean或整目录覆盖。
3. 从个人仓库fetch明确的发布分支，核实固定提交存在；不在公司重新做一次合并。
4. 对实际Forge目录、宿主接线与EXE做摘要对账。已一致则不重装。
5. 不一致时先审查本机差异、依赖与Electron ABI，再形成白名单及受控退出/启动计划。新worktree不会自动成为客户端加载根。
6. 不跨机复制node_modules、生产数据库、设备ID、控制凭据或租约。
7. 查询当前Hub映射与写权，不照抄历史revision16/fence8。
8. 源码版本一致后，再验证指定工程的自动保存和接续；已有可丢弃试点成功不等于公司端或所有业务工程已经接通。

## 暂停与保护

后端官方集成最新发布为`63be75913af544014f7bfe25ed2e2f741a911e03`，但生产整体升级暂停；只有PowerShell诊断入口已单独授权上线。
真实知识库备份、迁移和恢复演练尚未开始。

服务器Forge是常驻有状态插件。没有受控退出和一致性数据备份前，不热替换并假称已生效，不启动另一个进程共享生产库。
当前交付状态是“固定源码、家中磁盘对齐及服务器隔离候选验证完成”，不是“三端全部部署统一”。