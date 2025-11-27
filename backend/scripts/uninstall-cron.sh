#!/bin/bash

# 卸载定时任务

set -e

echo "============================================================"
echo "🗑️  卸载定时任务"
echo "============================================================"

if crontab -l 2>/dev/null | grep -q "cron-update-mapping.sh"; then
    crontab -l 2>/dev/null | grep -v "cron-update-mapping.sh" | crontab -
    echo "✅ 定时任务已删除"
else
    echo "⚠️  未找到定时任务"
fi

echo ""
echo "📋 当前定时任务列表:"
crontab -l 2>/dev/null || echo "   (无定时任务)"
echo ""
echo "============================================================"
echo "✅ 卸载完成"
echo "============================================================"

