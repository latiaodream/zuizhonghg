# bclogin-system 部署指南

## 服务器信息
- 部署目录: `/www/wwwroot/www.aibcbot.top`
- 数据库: PostgreSQL
  - 数据库名: `hgnew`
  - 用户名: `hgnew`
  - 密码: `GxdNSnmeN6pxTHk4`

## 部署步骤

### 1. 上传代码

将以下目录/文件上传到服务器 `/www/wwwroot/www.aibcbot.top`:

```
backend/          # 后端代码
frontend/         # 前端代码
database/         # 数据库脚本
deploy/           # 部署配置
package.json      # 根目录 package.json (如果有)
```

**不需要上传的目录:**
```
node_modules/     # 服务器上重新安装
.git/             # Git 目录
*.log             # 日志文件
```

### 2. SSH 登录服务器执行

```bash
cd /www/wwwroot/www.aibcbot.top

# 复制环境配置
cp deploy/env.production backend/.env

# 安装后端依赖
cd backend
npm install --production

# 安装前端依赖并构建
cd ../frontend
npm install
npm run build

# 初始化数据库（首次部署或重建）
cd ..
bash deploy/init-db.sh

# 启动服务
cd backend
pm2 start npm --name "bclogin-backend" -- start

# 查看日志
pm2 logs bclogin-backend
```

### 3. Nginx 配置

确保 Nginx 配置指向:
- 前端静态文件: `/www/wwwroot/www.aibcbot.top/frontend/dist`
- API 代理: `proxy_pass http://127.0.0.1:3001`

## 常用命令

```bash
# 查看服务状态
pm2 status

# 重启后端
pm2 restart bclogin-backend

# 查看日志
pm2 logs bclogin-backend

# 停止服务
pm2 stop bclogin-backend
```

## 数据库操作

```bash
# 连接数据库
psql -h 127.0.0.1 -U hgnew -d hgnew

# 重建数据库（会清空所有数据）
bash deploy/init-db.sh
```

