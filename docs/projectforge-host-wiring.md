# Forge 实际宿主接线（施工中）

基线02bd558933cb31b111d6e56cc7113e8b16eb9497，前轮工程pn0ma已accepted。
本轮正常可见工程p3rhq，分支work/forge-host-wiring-20261016。

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
TAP SHA256：6dd7fa2129f7e5b5731a350c4d2c2e2a8537807c9e4483e69bb1004e0bb804a7b。

## 实际部署提案（未批准、未执行）

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