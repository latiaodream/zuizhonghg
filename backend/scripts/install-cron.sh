#!/bin/bash

# 安装定时任务到系统 crontab
# 每小时更新一次映射文件

set -e

PROJECT_ROOT="/www/wwwroot/aibcbot.top"
SCRIPT_PATH="$PROJECT_ROOT/backend/scripts/cron-update-mapping.sh"

echo "============================================================"
echo "📦 安装定时任务"
echo "============================================================"

# 1. 确保脚本有执行权限
chmod +x "$SCRIPT_PATH"
echo "✅ 脚本权限设置完成"

# 2. 检查是否已经存在该定时任务
if crontab -l 2>/dev/null | grep -q "cron-update-mapping.sh"; then
    echo "⚠️  定时任务已存在，将先删除旧任务"
    crontab -l 2>/dev/null | grep -v "cron-update-mapping.sh" | crontab -
fi

# 3. 添加新的定时任务
# 每小时的第5分钟执行（避免整点高峰）
(crontab -l 2>/dev/null; echo "5 * * * * ISPORTS_API_KEY=GvpziueL9ouzIJNj $SCRIPT_PATH") | crontab -

echo "✅ 定时任务已添加"
echo ""
echo "📋 当前定时任务列表:"
crontab -l | grep "cron-update-mapping.sh"
echo ""
echo "============================================================"
echo "✅ 安装完成"
echo "============================================================"
echo ""
echo "💡 提示:"
echo "   - 定时任务将在每小时的第5分钟执行"
echo "   - 日志文件: $PROJECT_ROOT/backend/logs/mapping-update.log"
echo "   - 查看日志: tail -f $PROJECT_ROOT/backend/logs/mapping-update.log"
echo "   - 手动执行: $SCRIPT_PATH"
echo "   - 卸载任务: crontab -l | grep -v 'cron-update-mapping.sh' | crontab -"
echo ""

