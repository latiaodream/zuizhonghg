#!/bin/bash

# 皇冠赛事抓取服务停止脚本

echo "🛑 停止皇冠赛事抓取服务..."

pm2 stop crown-fetcher

echo ""
echo "✅ 服务已停止"
echo ""
pm2 status
echo ""

