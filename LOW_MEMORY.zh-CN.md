# Linux 与 macOS 内存预算

[macOS Community DMG](macos/README.md) 使用经过核验的 ARM64 原生应用，
在临时副本中接入已实现的兼容优化，默认启用并生成开发签名 DMG。
它不是官方签名/公证版本。原 APNs、应用组与共享钥匙串权限声明已移除；
不承诺远程推送、登录或原生 Computer Use 集成兼容。保留官方应用回退。

[跨平台工具包](linux-features/low-memory-budget/README.md) 本身提供监控、
有界缓冲、协作式任务预算和 Linux cgroup 启动器，不修改已安装应用。
Linux 打包默认值不变。500–900 MiB 是未验证的工作负载目标，不是实测保证；
macOS 不提供这里所声称的单会话 1 GiB 硬限制。共享进程不能按对话强行拆账。

CI 会检查真实未登录应用启动和 DMG；不代表已验证登录、真实 agent、长会话
或 Intel Mac。测试：`node --test linux-features/low-memory-budget/test.js`。
Mac 先执行 `sh linux-features/low-memory-budget/native/build-macos.sh`。
