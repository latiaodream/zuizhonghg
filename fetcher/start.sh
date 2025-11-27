#!/bin/bash

# 皇冠赛事抓取服务启动脚本

echo "🚀 启动皇冠赛事抓取服务..."

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "❌ 错误: .env 文件不存在"
    echo "请先复制 .env.example 为 .env 并配置账号密码"
    echo "  cp .env.example .env"
    echo "  nano .env"
    exit 1
fi

# 检查是否已编译
if [ ! -d dist ]; then
    echo "📦 首次运行，正在编译..."
    npm run build
fi

# 检查 PM2 是否安装
if ! command -v pm2 &> /dev/null; then
    echo "❌ 错误: PM2 未安装"
    echo "请先安装 PM2:"
    echo "  npm install -g pm2"
    exit 1
fi

# 停止旧进程（如果存在）
pm2 stop crown-fetcher 2>/dev/null || true

# 启动服务
pm2 start ecosystem.config.js

# 显示状态
echo ""
echo "✅ 服务已启动"
echo ""
pm2 status

echo ""
echo "📊 查看日志:"
echo "  pm2 logs crown-fetcher"
echo ""
echo "🛑 停止服务:"
echo "  pm2 stop crown-fetcher"
echo ""
echo "🔄 重启服务:"
echo "  pm2 restart crown-fetcher"
echo ""

