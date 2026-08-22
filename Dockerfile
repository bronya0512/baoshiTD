# ==================== 构建阶段 ====================
FROM golang:1.25-alpine AS builder

# 设置工作目录
WORKDIR /app

# 安装依赖（利用缓存层，先复制 go.mod 和 go.sum）
COPY go.mod go.sum ./
RUN go mod download

# 复制源代码
COPY . .

# 编译（纯 Go，无 CGO，去除调试信息以减小体积）
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o baoshiTD .

# ==================== 运行阶段 ====================
FROM alpine:latest

# 设置时区
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone

# 复制二进制文件和静态资源
WORKDIR /app
COPY --from=builder /app/baoshiTD .
COPY --from=builder /app/web ./web
COPY --from=builder /app/api ./api

# 创建非 root 用户运行（安全）
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/health || exit 1

# 启动
ENTRYPOINT ["./baoshiTD"]
