#!/bin/bash

# 定时更新皇冠-iSports映射文件
# 建议每小时执行一次

set -e

# 项目根目录
PROJECT_ROOT="/www/wwwroot/aibcbot.top"
BACKEND_DIR="$PROJECT_ROOT/backend"
FETCHER_DIR="$PROJECT_ROOT/fetcher-isports"

# 日志文件
LOG_FILE="$BACKEND_DIR/logs/mapping-update.log"
mkdir -p "$BACKEND_DIR/logs"

# 记录日志
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "============================================================"
log "🔄 开始更新映射文件"
log "============================================================"

# 1. 进入 backend 目录
cd "$BACKEND_DIR"

# 2. 从 fetcher-isports 提取皇冠比赛列表（不再直接调用皇冠API）
log "📥 从 fetcher-isports 提取比赛列表..."
if npm run crown:fetch-gids >> "$LOG_FILE" 2>&1; then
    log "✅ 比赛列表提取成功"
else
    log "❌ 比赛列表提取失败"
    exit 1
fi

# 3. 重新生成映射文件
log "🔄 重新生成映射文件..."
if ISPORTS_API_KEY="${ISPORTS_API_KEY}" npm run crown:build-map >> "$LOG_FILE" 2>&1; then
    log "✅ 映射文件生成成功"
else
    log "❌ 映射文件生成失败"
    exit 1
fi

# 4. 重启 fetcher-isports 服务
log "🔄 重启 fetcher-isports 服务..."
if /www/server/nodejs/v22.18.0/bin/pm2 restart crown-fetcher-isports >> "$LOG_FILE" 2>&1; then
    log "✅ 服务重启成功"
else
    log "❌ 服务重启失败"
    exit 1
fi

log "============================================================"
log "✅ 映射文件更新完成"
log "============================================================"
log ""

# 清理超过7天的日志
find "$BACKEND_DIR/logs" -name "mapping-update.log.*" -mtime +7 -delete 2>/dev/null || true

exit 0

