# ==================== 构建阶段 ====================
# 注意：multi-stage，Go builder + 运行期用 scratch/alpine 可保持镜像 < 50MB
FROM golang:1.25-alpine AS builder

# 国内网络访问 proxy.golang.org 会超时，使用七牛镜像加速依赖下载
ENV GOPROXY=https://goproxy.cn,direct

WORKDIR /app

# 先复制 go.mod / go.sum 以便缓存 go mod download
COPY go.mod go.sum ./
RUN go mod download

# 源代码 + 运行期静态资源（构建阶段 COPY . 即可，构建后只拷所需目录到下一阶段）
COPY . .

# 纯静态编译：无 CGO + 去掉调试信息减小体积
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o baoshitd-server .

# ==================== 运行阶段 ====================
FROM alpine:latest

# 时区：上海
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata ca-certificates wget && \
    ln -snf /usr/share/zoneinfo/$TZ /localtime && \
    echo $TZ > /etc/timezone

WORKDIR /app

# 二进制
COPY --from=builder /app/baoshitd-server ./baoshitd-server
# 静态资源 & 配置（项目硬性约束：镜像里必须包含静态 Web 资源 + OpenAPI spec）
COPY --from=builder /app/web        ./web
COPY --from=builder /app/api        ./api
COPY --from=builder /app/conf       ./conf
COPY --from=builder /app/assets     ./assets

# 日志目录（按项目约束日志写到 ./logs/，且以非 root 运行时必须可写）
RUN mkdir -p /app/logs

# 非 root 用户运行（项目硬性约束 security）
RUN addgroup -S appgroup && \
    adduser  -S appuser  -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

# 监听端口（必须与 main.go 默认一致，可通过环境变量 TD_PORT 覆盖）
EXPOSE 8080

# 健康检查：调 /api/health（wget 来自 alpine busybox 版本够用）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

# 启动（保持 shell-form，方便环境变量生效）
ENTRYPOINT ["./baoshitd-server"]
