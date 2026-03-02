# 构建阶段
FROM rust:1.75 as builder

WORKDIR /app

# 复制源代码
COPY . .

# 编译release版本
RUN cargo build --release

# 运行阶段
FROM debian:bookworm-slim

WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 从构建阶段复制二进制文件
COPY --from=builder /app/target/release/screenshare-rs /app/screenshare-rs

# 复制静态文件
COPY --from=builder /app/static /app/static

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV RUST_LOG=info

# 启动应用
CMD ["/app/screenshare-rs"]
