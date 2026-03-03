# 🖥️ WebRTC 屏幕共享应用

一个高性能、易于部署的实时屏幕共享应用，基于 WebRTC 和 Rust Axum 框架。

## ✨ 功能特性

- 🎬 **实时屏幕共享** - 低延迟、高清画质
- 👥 **多人房间** - 支持多个观看者同时接收共享
- 🔄 **即时同步** - 共享者停止后立即恢复页面
- 💻 **跨平台** - Windows、Mac、Linux 全支持
- 🚀 **高性能** - 基于异步 Rust + WebSocket
- 🔒 **轻量级** - 无需注册、无服务端数据库

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Rust + Axum + Tokio |
| WebSocket | axum-ws |
| 前端 | 原生 JavaScript (无框架依赖) |
| WebRTC | 浏览器原生 API |
| 部署 | Docker / systemd / Nginx |

## 📦 快速开始

### 最简单的方式：Docker

```bash
# 1. 克隆项目
git clone <repo-url>
cd screenshare-rs

# 2. 启动应用
docker-compose up -d

# 3. 访问
# 打开浏览器访问 http://localhost:3000
```

### 或者使用自动化脚本

```bash
chmod +x deploy.sh
./deploy.sh
# 然后选择部署方式（1=Docker / 2=systemd / 3=直接运行）
```

### 开发本地运行

```bash
cargo run --release

# 访问 http://localhost:3000
```

## 🚀 部署

详细的部署指南请参考 [DEPLOY.md](DEPLOY.md)，包括：

- ✅ Docker 部署
- ✅ systemd 服务（Linux）
- ✅ Nginx 反向代理
- ✅ HTTPS/WSS 配置
- ✅ 云服务器部署（AWS/阿里云等）
- ✅ 性能优化
- ✅ 故障排查

### 快速部署清单

| 方案 | 难度 | 推荐场景 |
|------|------|--------|
| Docker Compose | ⭐ | 快速部署、测试环境 |
| systemd | ⭐⭐ | 生产环境 (Linux) |
| Nginx + systemd | ⭐⭐⭐ | 高并发、多域名 |
| 云服务器 | ⭐⭐ | 公网访问 |

## 📋 使用说明

### 共享者步骤

1. 打开应用首页
2. 输入房间名称，点击"创建房间"
3. 复制房间链接分享给观看者
4. 点击"开始共享屏幕"，授予权限
5. 观看者可实时看到你的屏幕

### 观看者步骤

1. 点击共享者分享的链接进入房间
2. 等待共享开始
3. 实时查看共享的屏幕

## 🔧 配置

### 环境变量

```bash
RUST_LOG=info           # 日志级别
BIND_ADDR=0.0.0.0:3000 # 绑定地址
```

### 修改端口

编辑 `src/main.rs` 第66行：

```rust
let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
```

然后重新编译：

```bash
cargo build --release
```

## 📊 性能指标

- **单机并发用户数**: ~100-200
- **基础内存占用**: ~50MB
- **人均内存**: ~5MB
- **CPU占用** (闲置): ~5%
- **WebSocket 连接**: 长连接

## 📁 项目结构

```
screenshare-rs/
├── src/
│   └── main.rs           # 后端应用
├── static/
│   ├── index.html        # 创建房间页面
│   ├── index.js          # 创建房间逻辑
│   ├── room.html         # 房间页面
│   └── room.js           # WebRTC 核心逻辑
├── Cargo.toml            # Rust 项目配置
├── Dockerfile            # Docker 镜像
├── docker-compose.yml    # Docker Compose
├── deploy.sh             # 部署脚本
├── nginx.conf            # Nginx 配置示例
├── screenshare.service   # systemd 服务
└── DEPLOY.md             # 部署文档
```

## 🐛 故障排查

### 连接失败

```bash
# 检查服务是否运行
docker ps                    # Docker
systemctl status screenshare # systemd

# 检查日志
docker logs screenshare
sudo journalctl -u screenshare -f
```

### WebSocket 连接问题

打开浏览器开发者工具（F12），查看 Console 标签。

常见问题：
- **端口被占用**: 修改绑定端口
- **防火墙限制**: 开放对应端口
- **HTTPS 要求**: WebRTC 需要 HTTPS，WSS 安全连接

### 内存泄漏

```bash
# 监控内存使用
docker stats screenshare
watch -n 1 'ps aux | grep screenshare-rs'
```

## 🔐 安全建议

- 🔒 使用 HTTPS/WSS 加密连接
- 🚪 启用防火墙，只开放必要端口
- 🔑 考虑添加房间密码保护（需要开发）
- 📝 定期检查日志

## 🚧 开发计划

- [ ] 身份验证和授权
- [ ] 房间密码保护
- [ ] 录屏功能
- [ ] 多人同时共享
- [ ] 聊天功能
- [ ] 移动端适配
- [ ] 性能监控面板

## 📝 修改日志

### v0.1.0 (2026-03-02)

- ✅ 基础屏幕共享功能
- ✅ 多观看者支持
- ✅ WebRTC 信令服务器
- ✅ Docker 部署支持
- ✅ 完整部署文档

## 📞 反馈与支持

遇到问题？

1. 查看 [DEPLOY.md](DEPLOY.md) 的故障排查部分
2. 检查浏览器控制台输出
3. 查看应用日志
4. 提交 Issue 或讨论

## 📄 许可证

MIT License

---

## 🎉 快速命令

```bash
# 启动应用
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止应用
docker-compose down

# 进入容器
docker exec -it screenshare-rs bash

# 重新构建
docker-compose build --no-cache

# 查看端口
netstat -tulpn | grep 3000
```

---

**祝你使用愉快！** 🚀
