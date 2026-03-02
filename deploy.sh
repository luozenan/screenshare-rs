#!/bin/bash

set -e

echo "🚀 WebRTC Screen Share 快速部署脚本"
echo "======================================"

# 选择部署方式
echo ""
echo "请选择部署方式："
echo "1. Docker Compose（推荐）"
echo "2. systemd 服务（Linux）"
echo "3. 直接编译运行（开发）"
echo ""
read -p "请输入选项 (1-3): " choice

case $choice in
    1)
        echo ""
        echo "🐳 使用 Docker Compose 部署..."
        
        # 检查 Docker 和 Docker Compose
        if ! command -v docker &> /dev/null; then
            echo "❌ Docker 未安装，请先安装 Docker"
            exit 1
        fi
        
        if ! command -v docker-compose &> /dev/null; then
            echo "⚠️  Docker Compose 未安装，尝试使用 docker compose..."
            DOCKER_CMD="docker compose"
        else
            DOCKER_CMD="docker-compose"
        fi
        
        echo "📦 构建镜像..."
        $DOCKER_CMD build .
        
        echo "🎯 启动容器..."
        $DOCKER_CMD up -d
        
        sleep 2
        echo "✅ 部署完成！"
        echo "📍 访问地址: http://localhost:3000"
        echo ""
        echo "常用命令："
        echo "  查看日志: $DOCKER_CMD logs -f screenshare"
        echo "  停止服务: $DOCKER_CMD down"
        echo "  查看状态: $DOCKER_CMD ps"
        ;;
        
    2)
        echo ""
        echo "🐧 使用 systemd 部署..."
        
        # 检查是否为 Linux
        if [[ ! "$OSTYPE" == "linux-gnu"* ]]; then
            echo "❌ systemd 仅支持 Linux 系统"
            exit 1
        fi
        
        # 检查是否为 root
        if [[ $EUID -ne 0 ]]; then
            echo "❌ 此操作需要 root 权限"
            exit 1
        fi
        
        echo "📦 编译 Release 版本..."
        cargo build --release
        
        echo "👤 创建应用用户..."
        useradd -r -s /bin/false screenshare 2>/dev/null || echo "⚠️  用户已存在"
        
        echo "📂 部署文件..."
        mkdir -p /opt/screenshare
        cp target/release/screenshare-rs /opt/screenshare/
        cp -r static /opt/screenshare/
        chown -R screenshare:screenshare /opt/screenshare
        chmod +x /opt/screenshare/screenshare-rs
        
        echo "⚙️  安装 systemd 服务..."
        cp screenshare.service /etc/systemd/system/
        systemctl daemon-reload
        systemctl enable screenshare
        systemctl start screenshare
        
        sleep 2
        echo "✅ 部署完成！"
        echo ""
        echo "常用命令："
        echo "  启动服务: sudo systemctl start screenshare"
        echo "  停止服务: sudo systemctl stop screenshare"
        echo "  查看状态: sudo systemctl status screenshare"
        echo "  实时日志: sudo journalctl -u screenshare -f"
        ;;
        
    3)
        echo ""
        echo "🔨 直接编译运行..."
        
        # 检查 Rust
        if ! command -v cargo &> /dev/null; then
            echo "❌ Rust 未安装，请先安装 Rust"
            echo "访问: https://rustup.rs/"
            exit 1
        fi
        
        echo "📦 编译项目..."
        cargo build --release
        
        echo "🎯 启动应用..."
        cargo run --release
        ;;
        
    *)
        echo "❌ 无效的选项"
        exit 1
        ;;
esac
