# AGY 原生工具展示：2026-11-17 客户端交付点

## 当前结论与执行端
- 客户端工程 ptc7x，JOSHUASHEN-PC6，真实运行源码 D:/VCP/VCPChat。不是 D:/VCP/VCPChat-ForgeSync，也不是服务器 C:/VCP/VCPChat。
- 服务器桥工程 pfvgt：C:/VCP/ForgeProjects/antigravity-bridge；VCP消费测试工程 pwnn4：C:/VCP/VCPToolBox。
- 用户授权继续推进原生调用显示；本阶段实现及隔离客户端验证完成。没有启用8799事件发送，没有重载原客户端或任何运行服务，没有真实AGY模型调用。
- 下阶段先核对渠道31有效透传配置，再经明确授权启用8799、择空闲单次重载；原客户端需在对话收口后刷新。不能沿用上一阶段拒绝续答的重载授权。
- 原生执行继续拒绝；参数/结果 detailsPolicy=withheld；卡片不转为VCP请求、不产生执行权限。

## 实现（b270–b287）
- nativeToolEvents.js 新增 normalizeNativeToolFrame：单choice/index0、chat.completion.chunk、finish_reason=null、无error；元数据requestId等于外层帧id。delta仅接受{}或{content:""}。
- 实测VCP StreamHandler会在空delta补入content空串。最初只认{}不兼容；已据真实handler夹具及源码收窄修正，无需改生产VCP处理器。
- mainChatStreamConsumer在原串行prepare中验证帧，随后进入原有有界归并；无效元数据不展示不保存，正文保持原通道。VCP同消息可含多个上游请求，requestId+callId分离，迟到旧流不能复活。
- 此关联检查不是来源认证：上游仍可自报匹配的两个ID。卡片文本明确仅上游报告、不代表批准或独立执行核验。
- running文案改为“调用已发起（CLI 报告）”；当前真实文本ERROR仍显示“失败（CLI 报告）”，不凭TOOL_ERROR/nonce字符串把展示状态升级为已审计拒绝。
- Electron暴露原卡片挂在横向message-item根节点，挤压正文。nativeToolCards现挂直属.details-and-bubble-wrapper纵向列，位于Markdown之外，兼容旧根位置迁移并保留折叠状态；有界textContent投影，无执行按钮、脚本或参数结果。

## 测试与失败保留
1. 客户端七文件回归最终70/70，exit0，无跳过，7297.8266ms（布局修复前）。
   - .evidence/native-display-binding-a72e1bc1eedf4496a7bc70dee491da8e/final-v4.log 和 final-v4-result.json。
   - 初始新增函数测试确实红；首联合69通过/1失败为新增finishReason断言把归一completed误写stop，实读chatEventContract后仅修测试。
   - final-v3命令参数误拼--test-timeoutout，Node exit9，未执行测试；不改判为成功。
2. 布局修复后两个相关文件25/25，exit0，无跳过，5622.1357ms。
   - .evidence/native-display-layout-e426893d4a1748dfb3948464e6309a61/{test.log,result.json,smoke.log}。
   - 70与25是不同版本的重叠组，不相加，不声称最终一次95项联合回归。
3. 桥pfvgt b1021/b1022：已有Node假CLI+真实deny hook+临时HTTP，组合展示与通用拒绝续答，最终定向4/4通过，1143.017ms。有展示但缺审计/hook故障/未结束调用仍零正文、原错误、无成功stop/DONE；门控正文不提前释放。
   - evidence/native-display-continuation-10d07bba0bd0451db2f9448f212830f6/。
   - 首三文件联合98项：93通过/3失败/2跳过保持失败。三失败为新增泄漏正则误中既有ignored_parameters；仅修断言，未重跑全组，最终focused-v2.log为4项通过。
4. VCP pwnn4 b1023/b1024：真实StreamHandler+依赖替身，最终2/2通过，160.5861ms。外层id/object与内部元数据保持，delta补空content；正文不混元数据，工具执行0，续轮请求0；错误+DONE不冒充业务成功。
   - 同服务器证据目录vcp-consumer-v2.log及结果，independent-readback.json已独立核对11项源码/测试与保存证据。
   - 初次2项失败揭示空content兼容，原vcp-consumer.log保留；不改生产handler。

## 隔离Electron烟测（真实客户端、合成上游）
scripts/test-native-tool-display-electron.mjs；Node启动独立Electron，VCPCHAT_APP_DATA_DIR临时目录，VCPCHAT_E2E_TEST=1，关闭分布式服务及助手；仅本机合成SSE，不连接真实VCP/NewAPI/AGY，不操作原用户话题。
- 第一笔 azKgOm：请求0，发送前超时，窗口exit0/监听关闭。旧驱动同次evaluate内填输入并click；后拆步、等待按钮send且enabled、使用Puppeteer点击并补日志。不追认初次唯一根因已证明。
- 第二笔 X0XXOc：2笔合成chat请求，实时卡片及真实历史已有证据；新增预期错误地要求失败content空串，实际streamManager保留“[系统错误] 上游响应返回错误”。整项passed=false保持，未做重载。截图同时暴露横向布局问题。
- 修复后 Sa4Lxw：2笔合成chat请求，passed=true，exit0。第一笔running卡片在正文释放前可见，随后failed报告与正常回答；第二笔缺终态unknown及上游失败，历史finishReason=failed并保留系统错误提示。不能把该路径说成磁盘空正文消息。
- 实际历史由正常发送→IPC→主进程→流消费者→Admission持久化写出；重载隔离窗口后两张卡片恢复，history字节SHA256保持。没有重发已完成请求，request数仍2。
- 几何：两卡片宽434.2000px，等于内容列；正文宽271.2125/211.8875px；belowText=true、fitsColumn=true，均在Markdown之外且无执行控件。
- 证据：.evidence/native-display-electron-Sa4Lxw/{intent.json,result.json,history.json,live.png,reloaded.png,stderr.log}。
- result SHA256 af72d0c59eafc2b651b38644d3e185c122071db1ef13d200d2858c0024f06655。
- history SHA256 e7240cd604acaa0c9d253728f27e84040a929fe7ba3204389f8c4391aa2cccd3。
- 主控另次读回结果、截图和磁盘副本，复核布局4项当前源码hash一致；测试子进程已退出、两个监听端口为空，原客户端PID264776仍为D:/VCP/VCPChat下Electron。PID仅是本次观测，不作未来操作目标。
- 临时隔离profile及失败证据保留，不删除活跃profile；原客户端未刷新，磁盘版本不等于其内存已加载版本。
- 最终nativeToolCards SHA256 9b1a3aa45f5c73b06bcc008d3a6e19ca10eb55f81e1c59a5fe2dd33fd6d2c7f5；
  smoke script f9ff60aadb4bc357fbd44a8c9c2f78a4d8370140ae2a97a0bfcaaccf3e94d730。
- git diff --check任务文件通过；原PowerShellExecutor config.env及audio_server.exe等他人改动保留，无提交推送。

## 未完成范围
- 8799 nativeToolEvents入口未启用；本阶段没有修改start-manual-patch-v2.mjs。
- 当前渠道31有效force_format/thinking_to_content及真实AGY→NewAPI→VCP→原客户端整链未验收。此前隔离NewAPI合成透传成功不能拼接为当前渠道已通过。
- source=agy-native只是标签，帧一致性不是独立认证；展示层不能作执行授权或安全沙箱。
- 跨设备同步仍存在指纹忽略nativeToolEvents和空正文过滤限制；本机错误文本保留不等于一般空正文同步已修。
- 非流式、侧聊/独立窗口/语音全部消费者、全部主题布局未整体认证；此次实机为classic主窗口。
- 60原生工具全覆盖、图片ACP续答、受控原生执行不在本次交付范围。原strict/六项deny/通配hook/生产Agent不动。
- 不重复通过的烟测；新线上问题按新请求定位。原始工具回执在topic_1794885509656的mark_history。

## 17:17更新：8799展示发送已启用（优先于上文“未启用”状态）
- 用户对上线计划回复“继续”，服务器pfvgt b1026/n1118开启startBridge的nativeToolEvents并暴露native_tool_display；b1027/n1119补四模型展示接线，路由与Carbon适配器联合32/32通过、exit0、无跳过。无真实模型请求。
- 17:16:25.831–17:16:27.132（+08）仅一次PM2 restart8，PID23016→12060、restarts9→10，autorestart=false。新health确认streaming_sse_metadata/vcp_native_tool/schema1/withheld，native_execution_allowed=false、nonstream_enabled=false。原通用拒绝续答与其余配置保持。
- 8798/VCP/NewAPI进程、端口归属和其他PM2白名单记录未变；渠道31仅GET，受检配置摘要保持，无渠道/计价写入、无pm2 save。公开源码支持nil setting走零值与OpenAI原样转发分支，但并未独立验证运行二进制、缓存最终设置或实际渠道31事件。
- 17:17另次读回部署证据及22项当前摘要通过，服务器证据C:/VCP/ForgeProjects/antigravity-bridge/evidence/native-display-enable-20261117-v1/{reload-observation.json,deployment-readback.json,test-result.json,test.log}，最新交接为桥docs/NATIVE-EVENTS-HANDOFF-20261116.md第二十六阶段。
- 当前客户端未由Kerr刷新，磁盘代码不等于原窗口已加载。用户在本轮结束后刷新并保持流式输出，再正常使用原模型别名。真实AGY→渠道31→VCP→原客户端仍runtimeEventTested=false；无原生调用时不应显示卡片。
- 不重复重载或已通过的Electron烟测；上线联调Todo4仍doing，跨设备同步、非流式、全部消费者/主题和来源认证等限制保持。维护窗口结束，无在途实验。