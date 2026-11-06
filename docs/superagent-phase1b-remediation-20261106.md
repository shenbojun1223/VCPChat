# SuperAgent Phase 1B：第一次终审后的修复记录

## 当前结论
**WIP / R3 OPEN / NOT ACCEPTED：R1、R2 已获第二次独立再审关闭，R3 启动失败路径仍未修复。** 下列首次修复与160项回归是历史快照，不代表当前所有测试通过，也不是生产验收。

- 客户端工程：p4ylk，D:\VCP\VCPChat；Todo 2/3 保持 doing。
- 服务端工程：pxx12，C:\VCP\VCPToolBox，Todo 6。
- 原独立审查 aa-delegation-1793946012527-0013ed25：执行成功，审查结论拒绝。两者不可混同，原结论不倒改。
- 第二次只读再审 aa-delegation-1793949074706-9f2e7474：执行成功；R1、R2关闭，R3未关闭。
- 本记录补写已返回的工具证据，不把归档时刻冒充测试完成时刻。
- 2026-11-06 用户要求下班前保存客户端进度，本次仅准备本地 WIP 提交；不推送、不启用生产身份、不生成生产密钥、不重启服务。

## 下班交接：R3 动态反例已复现，尚未修复
- b244 在 tests/main-chat-response-body.test.mjs 新增真实 IPC → Flowlock integration → Surface consumer 组合测试；覆盖 HTTP/transport 启动失败与保存成功/失败的四种组合。
- 已执行命令：`node --test --test-reporter=tap --test-name-pattern="Flowlock startup" tests/main-chat-response-body.test.mjs`。
- 实际结果：4 tests / 0 pass / 4 fail，R3_RED_EXIT=1；四项均在保存屏障尚未结束时观测到后台占用提前释放（held=false，期望true）。
- 原因：IPC 已发送 error 终态给消费者，但启动回执仅有 streamError；Flowlock 抛错后 pendingStream=false，finally 提前释放占用。发送 error 不等于消费者保存终态。
- 下一步：IPC 明确声明 streamTerminalDispatched；Flowlock 对已派发错误终态的请求保留占用，直到真实 Surface onSettled → finishBackgroundSend。未派发终态的准备失败仍须释放。
- 修复后要求四项转绿，再跑下列12份测试的串并行回归，并取得新的独立复核。不得删除/跳过红测或将当前提交当作可启用版本。
- 提交前重新核对14份生产源码，SHA256均匹配本文历史候选快照；本次不修代码、不重复运行已知红测，也不声称新回归通过。
- 本次提交范围仅该工程21份源码、测试及文档；排除原有 PowerShellExecutor/config.env 和 audio_engine/audio_server.exe 改动。仅本地提交不能用于另一台电脑拉取。
- 以下 R3“启动失败释放”的首次实现描述正是当前已证实的缺口；正常 streamingStarted 路径的测试通过不能覆盖该错误路径。

## 修复及证据对应
### R1：准备期取消漏接
- 原缺口：非流式在 prepareChat 等待后才登记 activeVcpRequests，取消查询没有记录；准备完成仍会 fetch。
- b226/b235：首次异步等待前登记请求 controller/preparing；准备期取消同步 abort；网络发送前 throwIfAborted；非流式/失败 finally 清理；重复请求在创建流任务前拒绝。
- b230/b231：ChatManager 自有租约取消信号，发送按钮中止先同步撤销匹配消息的本地自动发送权限；自动消费不模拟按钮点击。
- tests/main-chat-response-body.test.mjs：阻塞真实 IPC 的 prepareChat，取消后 fetch 次数为0。
- tests/chat-manager-selection-race.test.js：取消只影响本消息；保留草稿/切换/持久化屏障反例。

### R2：报告派送后关闭自动接续
- b227：prepareChat 增加 requireAutoResume，开始及登记等待完成后重新检查当前身份许可与话题存在。
- b228/b229/b234/b235/b236：主进程一次性 requestId/token/scope/messageId 凭据；发射前二次核验并消费；超时或 ACK 立即撤销，不等持久化 finalizer。
- 凭据只在最终 transport context 携带；IPC 在日志、hook、轨迹、请求体与响应 context 之前剥离。它不是宿主身份签名，不进入模型正文和聊天历史。
- tests/delegation-host.test.cjs：准备前及登记 await 期间关闭 autoResume 均拒绝；普通手动签名保留非自动资格。
- tests/delegation-dispatch.test.cjs：错误 frame/scope/token/message、重复发送、超时后但 finalizer 未结束均拒绝。
- tests/main-chat-response-body.test.mjs：真实 IPC 调用 prepareChat 时 requireAutoResume=true；撤销零 fetch；凭据不进入日志/正文/回传。
- tests/chat-manager-selection-race.test.js：凭据不进入内存及磁盘 history。
- 服务端当前许可由授权补取响应返回；本记录不承诺跨机器撤权与网络发射的全局原子事务。

### R3：后台 Flowlock 停止 session 后仍有在途请求
- b230：ChatManager 的 backgroundSendTerminals 独立于 Flowlock session，以 messageId 跟踪后台占用。
- b232：Flowlock 准备前取得占用；非流式保存或启动失败释放；streamingStarted 不释放。
- b233：真实 Surface 消费终态 onSettled 后释放，不在乐观投影完成时释放。
- tests/flowlock-timestamp-bindings.test.js：实际 integration 获取及流式启动后保留、非流式保存前保留、准备失败释放。
- tests/main-chat-surface-adapter.test.mjs：真实 consumer 在保存屏障后才通知释放，覆盖保存成功/失败。
- tests/chat-manager-selection-race.test.js：删除后台 session 不使当前单聊可取得自动接续租约。
- 丢失终态可能保守阻塞；不以超时当作安全空闲，不承诺异常条件下无限可用。

## 测试历程
- 修复前：107项，103通过/4失败。取消用例确实发生1次fetch；两项撤权用例未拒绝。后台用例因 beginBackgroundSend 未实现失败，只证明新接口未实现，不单独冒充原竞态的动态复现。
- 修复及新增接线后：160项曾159通过/1失败。失败是非流式Flowlock夹具缺少既有 handleFinalizedMessage，b242仅补齐夹具，未削弱断言或改生产行为。
- 2026-11-06 14:46:44工具回执：下列12份测试分别 concurrency=4 和1，均160/160，fail/cancelled/skipped=0，exit=0。
- 14份客户端生产源码 node --check 通过；限定源码及测试 git -c core.whitespace=cr-at-eol diff --check 返回0。
- Node MODULE_TYPELESS_PACKAGE_JSON 为警告，未修改整个项目模块类型以消除该提示。
- 服务端此前15份相关测试228/228串并行通过，系先前证据；客户端修复没有重测或改变服务端代码。

```powershell
$tests=@('tests/preload-registry.test.js','tests/main-chat-surface-adapter.test.mjs','tests/stream-consumer-registry.test.mjs','tests/delegation-host.test.cjs','tests/delegation-dispatch.test.cjs','tests/chat-manager-selection-race.test.js','tests/main-chat-stream-consumer.test.js','tests/flowlock-timestamp-bindings.test.js','tests/flowlock-upstream-error.test.mjs','tests/main-chat-flowlock-owner.test.mjs','tests/main-chat-response-body.test.mjs','tests/main-chat-send-owner.test.mjs')
node --test --test-concurrency=4 @tests
node --test --test-concurrency=1 @tests
```

## 14:46验收候选源码SHA256
以下为已返回的测试后快照，后续有改动须重新核验，不泛化为整个工作树。
```text
modules/services/delegationIdentity.cjs ae3f43f4992bcbd62642b293f441bd47101f21cf12706ad9d9eeca36316f09f7
modules/services/delegationInbox.cjs a6b1479ab60b00eabe119f251a7d0468d3da08a474a7395b395a49ab888baf36
modules/services/delegationHost.cjs d9398cb36adb63cd9dc40c95b22b6df320031f27ba28ca2a12508e31edea607a
modules/services/delegationDispatch.cjs 71e4319caed0fe256a9151fa6f7dcecafafb8782411b667c492372f6ec903b48
modules/renderer/delegationResumeOwner.js ecb3a366faaa3e67febd8f71f7c48aefe0699fef266f874bc0f35eb858154aaf
modules/chatManager.js d0ec8bbd54d92df1bf6b40cb1e4566bcc4c68ad9f8e3f5c7eebf407afbfd55a0
modules/ipc/chatHandlers.js 06da30b6260c356fdf0b9f27c9a41e8b4223f7af6e32053d0553132840e84238
preloads/api/chat.js 8bb3a4b9ac30e0df0a331fe47e37459a17908c5ed463d8bee2917ab204959d1c
renderer.js f316fc7c7ab4ee240a2ca1f81d850f49097ceaff07cfe4b2ac94a52ec9db537c
Flowlockmodules/flowlock-integration.js 36a0afc3ecdcebebe29c80e388a35d6f41333fa970a7a8db07cc4279f8fb1c11
modules/chat/streamConsumerRegistry.js e1b46a508d5d054103de2ff28c68cb1c2cc9295fb4c9ea8eb9d651d304dceb01
modules/renderer/mainChatStreamConsumer.js b32ab3867ee1c4b65f12c5cc7049ea84d41c5163a47ed7dbab414297b218849d
modules/renderer/mainChatSurfaceAdapter.js 16095e7ac7ee6f4b6b7feaaff67a3e5135a346447a65b5a7912908ab2ca14cfb
modules/renderer/mainChatSendOwner.js 997614023b2cc96a85c94bcc67414ca8365da85afaefa7b2e91af798a17a376a
```

## 尚未验收
修复后独立再审、真实Electron现场及生产端到端均未通过登记。仅当前选中且空闲的单聊自动消费，其余话题排队；uncertain/conflict需人工核对。默认关闭、单主进程写者、容量及去重保留边界沿用服务端 docs/superagent-phase1b-code-review-20261106.md。修复记录不覆盖原拒绝记录，也不把补投变成重新派工。