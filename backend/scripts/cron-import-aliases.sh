#!/bin/bash

# iSports 别名自动导入定时任务
# 每天自动导入未来 7 天有皇冠赔率的赛事

# 设置工作目录
cd /www/wwwroot/aibcbot.top/backend

# 设置日志文件
LOG_DIR="/www/wwwroot/aibcbot.top/logs"
LOG_FILE="$LOG_DIR/aliases-import-$(date +%Y%m%d).log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 记录开始时间
echo "============================================================" >> "$LOG_FILE"
echo "开始时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

# 运行导入脚本（未来 7 天）
ISPORTS_API_KEY=GvpziueL9ouzIJNj npm run aliases:import-isports -- --days=7 >> "$LOG_FILE" 2>&1

# 记录结束时间
echo "" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"
echo "结束时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# 清理 30 天前的日志
find "$LOG_DIR" -name "aliases-import-*.log" -mtime +30 -delete

# 输出到标准输出（宝塔可以看到）
echo "✅ iSports 别名导入完成，日志: $LOG_FILE"

