# WebRTC 屏幕共享应用部署指南

## 📋 目录
1. [快速开始](#快速开始)
2. [部署方案](#部署方案)
3. [配置说明](#配置说明)
4. [运维建议](#运维建议)

---

## 🚀 快速开始

### 本地运行

```bash
# 1. 克隆项目
git clone <repo-url>
cd screenshare-rs

# 2. 编译运行
cargo run --release

# 3. 访问应用
# 打开浏览器访问 http://localhost:3000
```

---

## 📦 部署方案

### 方案1：Docker 部署（推荐）

#### 前提条件
- 安装 Docker 和 Docker Compose

#### 一键启动

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f screenshare

# 停止服务
docker-compose down
```

#### 手动Docker构建

```bash
# 构建镜像
docker build -t screenshare-rs:latest .

# 运行容器
docker run -d \
  --name screenshare \
  -p 3000:3000 \
  -e RUST_LOG=info \
  screenshare-rs:latest
```

---

### 方案2：systemd 服务部署（Linux）

#### 1. 编译Release版本

```bash
cargo build --release
```

#### 2. 创建应用用户

```bash
sudo useradd -r -s /bin/false screenshare
```

#### 3. 部署二进制文件

```bash
sudo mkdir -p /opt/screenshare
sudo cp target/release/screenshare-rs /opt/screenshare/
sudo cp -r static /opt/screenshare/
sudo chown -R screenshare:screenshare /opt/screenshare
sudo chmod +x /opt/screenshare/screenshare-rs
```

#### 4. 安装 systemd 服务

```bash
sudo cp screenshare.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable screenshare
sudo systemctl start screenshare

# 查看状态
sudo systemctl status screenshare

# 查看日志
sudo journalctl -u screenshare -f
```

---

### 方案3：使用 Nginx 反向代理

#### 1. 安装 Nginx

```bash
sudo apt-get install nginx
```

#### 2. 配置 Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/screenshare
sudo ln -s /etc/nginx/sites-available/screenshare /etc/nginx/sites-enabled/
sudo nano /etc/nginx/sites-available/screenshare  # 修改域名
```

#### 3. 测试并启用

```bash
sudo nginx -t
sudo systemctl restart nginx
```

#### 4. 配置 HTTPS（可选，使用 Let's Encrypt）

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

### 方案4：云服务器部署（如 AWS/阿里云/腾讯云）

#### AWS EC2 示例

```bash
# 1. 启动 Ubuntu 实例 (t2.small 或更高)
# 2. 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 3. 克隆并部署
git clone <repo-url>
cd screenshare-rs
cargo build --release

# 4. 使用 systemd 运行（参考方案2）
```

---

## ⚙️ 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `RUST_LOG` | `info` | 日志级别: trace, debug, info, warn, error |
| `BIND_ADDR` | `0.0.0.0:3000` | 绑定地址和端口（需要代码修改） |

### 修改绑定端口（如需要）

在 [src/main.rs](src/main.rs) 的第66行修改：

```rust
let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
```

改为：
```rust
let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
```

然后重新编译。

---

## 🛠️ 运维建议

### 1. 监控和日志

```bash
# 使用 systemd 查看日志
sudo journalctl -u screenshare -f

# 使用 Docker 查看日志
docker logs -f screenshare

# 保存日志到文件
sudo journalctl -u screenshare > /var/log/screenshare.log
```

### 2. 自动重启

**systemd** 已配置 `Restart=on-failure`

**Docker** 已配置 `restart: unless-stopped`

### 3. 性能调优

```bash
# 增加文件描述符限制（处理更多并发连接）
sudo vi /etc/security/limits.conf
# 添加：
# screenshare soft nofile 65536
# screenshare hard nofile 65536

# 应用变更
sudo sysctl -p
```

### 4. 备份和恢复

```bash
# 备份项目
tar -czf screenshare-backup-$(date +%Y%m%d).tar.gz /opt/screenshare

# 备份数据库（如果将来使用）
mysqldump -u user -p database > backup.sql
```

### 5. 定期更新依赖

```bash
cargo update
cargo build --release
# 重新部署
```

### 6. 安全建议

- ✅ 使用 HTTPS/WSS（配置 Let's Encrypt 证书）
- ✅ 启用防火墙
  ```bash
  sudo ufw allow 22/tcp  # SSH
  sudo ufw allow 80/tcp   # HTTP
  sudo ufw allow 443/tcp  # HTTPS
  sudo ufw enable
  ```
- ✅ 限制并发连接数（在 Nginx 配置中）
- ✅ 定期检查日志寻找异常

### 7. 故障排查

#### 连接失败
```bash
# 检查端口是否开放
sudo netstat -tulpn | grep 3000

# 检查防火墙
sudo ufw status
```

#### WebSocket 连接问题
```bash
# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# 应用日志
RUST_LOG=debug cargo run --release
```

#### 内存泄漏
```bash
# 监控内存使用
docker stats screenshare
# 或
watch -n 1 'ps aux | grep screenshare-rs'
```

---

## 📊 性能参考

| 指标 | 值 |
|------|-----|
| 单机并发用户数 | ~100-200 |
| 内存占用 | ~50MB 基础 + 人均 ~5MB |
| CPU 占用 | ~5% (闲置) |
| WebSocket 连接 | 长连接 |

---

## 🔗 常用命令速查

```bash
# Docker 相关
docker-compose up -d          # 启动
docker-compose logs -f        # 查看日志
docker-compose down           # 停止
docker exec -it screenshare bash  # 进入容器

# systemd 相关
sudo systemctl start screenshare     # 启动
sudo systemctl stop screenshare      # 停止
sudo systemctl restart screenshare   # 重启
sudo systemctl status screenshare    # 状态
sudo journalctl -u screenshare -f    # 实时日志

# Nginx 相关
sudo nginx -t                       # 检查配置
sudo systemctl restart nginx        # 重启
sudo tail -f /var/log/nginx/error.log  # 错误日志
```

---

## 💡 下一步

- [ ] 添加身份验证
- [ ] 实现房间密码保护
- [ ] 添加录屏功能
- [ ] 支持多人同时共享
- [ ] 添加聊天功能
- [ ] 移动端适配

---

## 📞 支持

如有问题，请检查：
1. [应用日志](#监控和日志)
2. 防火墙和网络配置
3. 浏览器控制台（F12 查看）
4. 与最新依赖版本兼容性
