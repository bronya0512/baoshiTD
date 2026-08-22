package db

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisHolder 包装 go-redis v9 *redis.Client
type RedisHolder struct {
	*redis.Client
	Addr string
	DB   int
}

// ConnectRedis 读 TD_REDIS_ADDR / TD_REDIS_PWD / TD_REDIS_DB；空表示"请求走内存"返回 (nil, nil)
// 失败返回 err，由上层决定 fallback
func ConnectRedis() (*RedisHolder, error) {
	addr := os.Getenv("TD_REDIS_ADDR")
	pwd := os.Getenv("TD_REDIS_PWD")
	dbi, _ := strconv.Atoi(os.Getenv("TD_REDIS_DB"))
	if addr == "" {
		return nil, nil
	}
	r := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     pwd,
		DB:           dbi,
		DialTimeout:  4 * time.Second,
		ReadTimeout:  4 * time.Second,
		WriteTimeout: 4 * time.Second,
		PoolSize:     16,
		MinIdleConns: 2,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if err := r.Ping(ctx).Err(); err != nil {
		_ = r.Close()
		return nil, fmt.Errorf("redis ping %s failed: %w", addr, err)
	}
	log.Printf("[db-redis] ✅ 连接成功 addr=%s db=%d", addr, dbi)
	return &RedisHolder{Client: r, Addr: addr, DB: dbi}, nil
}
