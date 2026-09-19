# Linux 与 macOS 内存预算

新增的可选模块 [low-memory-budget](linux-features/low-memory-budget/README.md)
提供跨平台内存测量、有界显示缓冲、协作式任务准入、Linux cgroup 启动器及显式的
Electron 堆大小实验。默认禁用，不修改官方 macOS 应用的签名或 ASAR，也不改变
原有 Linux 打包流程。Linux 安装命令不能用于安装 macOS 应用。

500–900 MiB 是工程目标，不是已测得的性能。Linux 的 1024 MiB 上限仅适用于独立
进程域，可能触发 OOM。macOS 不提供等价的进程树硬限制，本模块会拒绝
`--hard-limit`，不会用轮询杀进程伪装成内核限制。共享 app-server 中的会话不能
分别通过操作系统限制内存。共享 UI、MCP 和浏览器成本必须计入整机总量。

在仓库根目录运行：

```sh
# macOS 先构建独立的只读观察器；不会修改 .app
sh linux-features/low-memory-budget/native/build-macos.sh
# Linux 和 macOS 通用测试
node --test linux-features/low-memory-budget/test.js
```

完整用法、风险、回滚方法见模块 README；实际 Codex 的 8 GiB 设备基准测试仍是
发布门槛。查看[设计文档](docs/superpowers/specs/2026-09-19-memory-budget-design.md)
和[英文说明](LOW_MEMORY.md)。
