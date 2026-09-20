# 第三版优化

仅限 Apple Silicon / macOS 13+ 开发测试版。仍为临时签名，未公证；原有
Keychain、APNs、Computer Use 兼容性限制不变。详见 [英文说明](OPTIMIZATION_V3.md)。

本版为明确配置的本地 stdio MCP 加入原生生命周期管理器。它建立独立的
会话/进程组，保留参数、环境、工作目录和输出。输入使用固定 64 KiB 缓冲。
连接关闭、父进程退出或收到终止信号后，先给予宽限期，再向其拥有的组发送
TERM 和 KILL。组长在清理完成前不被回收，避免误杀复用的 PID/进程组。
远程 MCP、HTTP、禁用项、纯元数据请求及安全模式不进行此包装。

普通取消订阅不会终止仍有效的传输。没有新增立即卸载线程接口，也不清理
历史未包装的进程。主动脱离进程组、管理器本身被 KILL、其他构建工具或
fork bomb 均不在保证范围内。需要常驻的服务器可自行在其环境表中设置：

```toml
[mcp_servers.my_server.env]
CODEX_COMMUNITY_MCP_KEEPALIVE = "1"
```

首个非空文本块立即交付，后续保留 75ms 批处理。此项不是模型网络延迟保证。
启动默认值保持不变；完全退出应用后，可单次比较启动设置：

```bash
CODEX_COMMUNITY_ABLATION=no-heap \
  '/Applications/Codex Community.app/Contents/MacOS/CodexCommunity'
```

可用值为 `none`、`no-heap`、`no-observer`、`upstream-highlight`。最后一项仅恢复
四个语法工作线程，保留优化后的 AST 缓存数量。未知值会报错。安全模式：

```bash
open -a '/Applications/Codex Community.app' --args --community-safe-mode
```

构建包含真实 Rust 后端回收测试、普通/安全启动、每个配置预热后两次启动
测量，以及 DMG 签名/挂载检查。查看 CI 证据了解实际结果；不保证所有逃逸
子进程可回收、整体更快或每个代理始终低于 1GiB。安装文件后缀为 `opt3-dev.dmg`。
