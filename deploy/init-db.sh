#!/bin/bash

# ============================================
# 数据库初始化脚本
# 使用方法: bash deploy/init-db.sh
# ============================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 数据库配置
DB_HOST="127.0.0.1"
DB_PORT="5432"
DB_NAME="newhg"
DB_USER="newhg"
DB_PASSWORD="GxdNSnmeN6pxTHk4"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  数据库初始化脚本${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo -e "数据库: ${GREEN}$DB_NAME${NC}"
echo -e "用户: ${GREEN}$DB_USER${NC}"
echo ""
echo -e "${RED}警告: 这将清空数据库中的所有数据！${NC}"
read -p "确认继续? (输入 yes 确认): " confirm

if [ "$confirm" != "yes" ]; then
    echo "已取消"
    exit 0
fi

export PGPASSWORD=$DB_PASSWORD

# 检查数据库连接
echo -e "\n${YELLOW}[1/3] 检查数据库连接...${NC}"
if ! psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}无法连接到数据库，请检查配置${NC}"
    exit 1
fi
echo -e "${GREEN}数据库连接成功${NC}"

# 清空并重建表
echo -e "\n${YELLOW}[2/3] 导入数据库结构...${NC}"

# 先删除所有表
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << 'EOF'
DO $$ DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;
EOF

# 导入 schema
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$PROJECT_DIR/database/schema.sql"
echo -e "${GREEN}表结构导入完成${NC}"

# 运行迁移脚本
echo -e "\n${YELLOW}[3/3] 运行迁移脚本...${NC}"
MIGRATION_DIR="$PROJECT_DIR/database/migrations"
if [ -d "$MIGRATION_DIR" ]; then
    for migration in "$MIGRATION_DIR"/*.sql; do
        if [ -f "$migration" ]; then
            echo "  运行: $(basename $migration)"
            psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$migration" 2>/dev/null || true
        fi
    done
fi
echo -e "${GREEN}迁移完成${NC}"

echo -e "\n${YELLOW}[4/4] 创建管理员账号...${NC}"
cd "$PROJECT_DIR/backend"
node ensure-admin.js

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  数据库初始化完成！${NC}"
echo -e "${GREEN}========================================${NC}"

