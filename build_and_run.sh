#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "开始编译项目..."

# 编译项目
cargo build --release

if [ $? -ne 0 ]; then
    echo "编译失败！"
    exit 1
fi

echo "编译成功！"

# 停止已运行的进程
pkill -f "target/release/screenshare-rs" 2>/dev/null
sleep 1

# 在后台启动项目
nohup ./target/release/screenshare-rs >/dev/null 2>&1 &

echo "项目已在后台启动！"
