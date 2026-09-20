# macOS Community DMG

Apple Silicon / macOS 13+ 实验性开发构建。`sh macos/build-dmg.sh` 校验固定的
官方 DMG SHA-256 与签名，只修改临时副本，连接实际应用的内存与渲染优化，
重新签名并生成 DMG。安装后不需要 Node、Python 或 Xcode。官方已安装应用不变。

所有**已实现且兼容 macOS 的优化**默认启用：512 MiB V8 old-space、原生物理
占用/压力监控、后台节流、Markdown 动画减量、屏外绘制跳过、隐藏且空闲窗口
在严重压力下释放未使用缓存，以及有界诊断文件。屏外绘制不是 DOM 虚拟化。

这不是完整应用/单 agent 的 1 GiB 硬上限，也没有验证 500–900 MiB 目标。
Linux cgroup、inotify、Linux reaper 及未接入的 MCP/工具调度/React 虚拟化不能
仅靠开关移植，详见 `profile.json` 的 `notPorted`。不会解锁账户功能或系统权限。

应用是 ad-hoc 开发签名，未经 Developer ID 签名/公证。仅在验证来源后使用系统
对单个应用的批准界面；不要关闭 Gatekeeper、SIP、sandbox 或 TLS 检查。
重签名可能影响钥匙串/原生集成；保留官方应用回退。不要同时运行两个版本。
上游自动更新可能覆盖修改，更新后应使用经过审查的新固定版本重新构建。

安全模式（先完全退出）：
`open -a '/Applications/Codex Community.app' --args --community-safe-mode`

测试覆盖真实未登录应用启动、优化接口、代码签名和 DMG；不代表已测试登录、
真实 agent、长会话或 Intel Mac。完整说明见 [英文文档](README.md)。
