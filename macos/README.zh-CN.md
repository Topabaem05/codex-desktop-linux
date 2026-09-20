# macOS Community DMG

Apple Silicon / macOS 13+ 实验性开发版。`sh macos/build-dmg.sh` 校验官方
固定 DMG 与签名，在临时副本中接入真实应用优化、更新 ASAR 完整性信息、
重新签名并生成 DMG。不会修改已安装的官方应用。

默认启用所有已实现且兼容的优化：512 MiB V8 old-space、物理占用与压力监控、
后台节流、Markdown 动画减量、屏外绘制跳过、隐藏空闲窗口的未使用缓存释放、
有界状态文件。信任范围限已核实的 `app://-/` 和应用内文件地址。屏外绘制
不是 DOM 虚拟化；500–900 MiB/agent 仍未验证，不是 macOS 1 GiB 内核硬上限。
Linux cgroup/inotify/reaper 与尚未接入的 MCP、调度、React 模块不假称启用。

开发签名非 Developer ID/公证。原 APNs、应用组和共享钥匙串权限声明已移除。
远程推送不可用，登录/原生 Computer Use 兼容性未认证。不得关闭 Gatekeeper、
SIP、sandbox 或 TLS；仅验证来源后使用单应用批准。保留官方版，不同时运行。
上游更新可能覆盖修改。完整细节见 [英文说明](README.md) 和 [签名说明](SIGNING.md)。

安全模式（先退出）：
`open -a '/Applications/Codex Community.app' --args --community-safe-mode`

成功 CI 验证真实未登录启动与 DMG；失败工件只有日志，不是可用安装包。
不代表已测试登录、真实多 agent、长会话、Intel Mac 或所有 macOS 版本。
