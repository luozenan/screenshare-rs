#!/bin/bash


# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "开始编译项目...${NC}"

# 编译项目
cargo build --release

if [ $? -ne 0 ]; then
    echo -e "编译失败！"
    exit 1
fi

echo -e "编译成功！"

# 停止已运行的进程
pkill -f "target/release/screenshare-rs" 2>/dev/null
sleep 1

# 在后台启动项目
nohup ./target/release/screenshare-rs > /tmp/screenshare-rs.log 2>&1 &
