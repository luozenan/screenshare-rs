# 构建阶段
FROM rust:latest as builder

WORKDIR /app

# 先只复制 Cargo.toml 和 Cargo.lock，让依赖缓存分离
COPY Cargo.toml Cargo.lock ./

# 创建一个虚拟的 main.rs 来预编译依赖
RUN mkdir -p src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# 复制源代码（只有代码改变时才重新编译）
COPY src ./src
COPY static ./static

# 编译 release 版本
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
