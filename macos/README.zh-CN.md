# macOS Community DMG

Apple Silicon / macOS 13+ 实验性开发版。`sh macos/build-dmg.sh` 校验官方
固定 DMG 与签名，在临时副本中接入真实应用优化、更新 ASAR 完整性信息、
重新签名并生成 DMG。不会修改已安装的官方应用。

默认启用所有已实现且兼容的优化：512 MiB V8 old-space、物理占用与压力监控、
后台节流、Markdown 动画减量、屏外绘制跳过、隐藏空闲窗口的未使用缓存释放、
有界状态文件。信任范围限已核实的 `app://-/` 和应用内文件地址。屏外绘制
不是 DOM 虚拟化；500–900 MiB/agent 仍未验证，不是 macOS 1 GiB 内核硬上限。
Linux cgroup/inotify/reaper 与尚未接入的 MCP 池化和全局工具调度不假称启用；
修订版 2 调整已有的 React 虚拟化机制，详见下文。

开发签名非 Developer ID/公证。原 APNs、应用组和共享钥匙串权限声明已移除。
远程推送不可用，登录/原生 Computer Use 兼容性未认证。不得关闭 Gatekeeper、
SIP、sandbox 或 TLS；仅验证来源后使用单应用批准。保留官方版，不同时运行。
上游更新可能覆盖修改。完整细节见 [英文说明](README.md) 和 [签名说明](SIGNING.md)。

安全模式（先退出）：
`open -a '/Applications/Codex Community.app' --args --community-safe-mode`

成功 CI 验证真实未登录启动与 DMG；失败工件只有日志，不是可用安装包。
不代表已测试登录、真实多 agent、长会话、Intel Mac 或所有 macOS 版本。

## 优化修订版 2

构建现在需要 Node.js 22+，用于真实打包代码和 Rust app-server 的 CLI 验证；
安装后的应用仍不需要另装 Node。DMG 文件名包含 `arm64-opt2-dev`。
CI 仅在验证成功后上传 DMG，诊断日志作为独立的小型 artifact 上传。

复用上游已有的会话/diff 虚拟化及 20,000 字符显示尾部：非活动历史保留
2 个、TTL 60 秒（原为 10 个、3 小时）；overscan 2→1；代码高亮 worker 4→2，
AST 缓存条目 100→32；文本每 75ms 批量更新，65,536 UTF-16 单元时立即刷新；
命令输出每 100ms 更新，完成事件仍先刷新。活动任务、审批、当前窗口和其他
订阅者不会被清理，并在真正 unsubscribe 前再次检查。安全模式恢复原参数。

仅无工具的内部临时标题/描述/摘要会话使用请求级 MCP 禁用设置，不修改
用户配置，不共享有状态 MCP 会话。读取有效项目配置后再次验证登录生命周期；
读取失败时维持原请求并记录不含秘密的计数。未实现 Rust 引擎内部全局重型
工具调度、MCP 池化或无破坏性的立即卸载；继续使用已有 unsubscribe。

一个常驻 C helper 合并内存与压力观测，正常 15 秒、压力下 5 秒采样；
异步原子状态写入只保留最新结果。同文档导航保持 preload 就绪状态。
缓存清理先检查未使用资源，效果低时退避。进程分类是 Electron 类型与原生
程序名启发式，不等于每个 agent 的精确内存归属。500–900MiB 目标仍未经真实
登录工作负载验证。开发签名、账户功能和 macOS 无硬上限等限制仍然有效。
