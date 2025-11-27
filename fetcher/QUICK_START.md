# 快速开始指南

## 5 分钟快速部署

### 1. 配置账号（1分钟）

```bash
cd fetcher
cp .env.example .env
nano .env
```

修改以下两行：
```env
CROWN_USERNAME=你的账号
CROWN_PASSWORD=你的密码
```

保存并退出（Ctrl+X, Y, Enter）

### 2. 启动服务（1分钟）

```bash
./start.sh
```

### 3. 验证运行（1分钟）

```bash
# 查看日志
pm2 logs crown-fetcher --lines 20

# 应该看到类似输出：
# ✅ [14:30:15] 滚球抓取成功 | 比赛数: 45
# ✅ [14:30:16] 今日抓取成功 | 比赛数: 60
# ✅ [14:30:17] 早盘抓取成功 | 比赛数: 45
```

### 4. 检查数据（1分钟）

```bash
# 查看比赛数量
cat data/latest-matches.json | jq '.matchCount'

# 查看分类统计
cat data/latest-matches.json | jq '.breakdown'
```

## 常用命令

### 服务管理

```bash
# 启动服务
./start.sh

# 停止服务
./stop.sh

# 重启服务
pm2 restart crown-fetcher

# 查看状态
pm2 status

# 查看日志
pm2 logs crown-fetcher

# 实时日志
pm2 logs crown-fetcher --lines 100
```

### 数据查看

```bash
# 查看比赛总数
cat data/latest-matches.json | jq '.matchCount'

# 查看分类统计
cat data/latest-matches.json | jq '.breakdown'

# 查看最后更新时间
cat data/latest-matches.json | jq '.timestamp'

# 查看前3场比赛
cat data/latest-matches.json | jq '.matches[0:3]'

# 查看滚球比赛
cat data/latest-matches.json | jq '.matches[] | select(.showtype=="live") | {league, home, away}'
```

### 日志管理

```bash
# 清空日志
pm2 flush crown-fetcher

# 查看错误日志
tail -f logs/error.log

# 查看输出日志
tail -f logs/out.log
```

## 故障排查

### 问题：登录失败

```bash
# 1. 检查配置
cat .env | grep CROWN_

# 2. 尝试更换站点
nano .env
# 修改 CROWN_BASE_URL=https://hga027.com

# 3. 重启服务
pm2 restart crown-fetcher
```

### 问题：抓取失败

```bash
# 1. 查看详细日志
pm2 logs crown-fetcher --lines 50

# 2. 检查网络
ping hga026.com

# 3. 重启服务
pm2 restart crown-fetcher
```

### 问题：数据不更新

```bash
# 1. 检查服务状态
pm2 status

# 2. 查看日志
pm2 logs crown-fetcher --lines 50

# 3. 重启服务
pm2 restart crown-fetcher
```

## 配置优化

### 调整抓取间隔

编辑 `.env` 文件：
```env
# 高频更新（3秒）
FETCH_INTERVAL=3000

# 标准更新（5秒）
FETCH_INTERVAL=5000

# 低频更新（10秒）
FETCH_INTERVAL=10000
```

重启服务使配置生效：
```bash
pm2 restart crown-fetcher
```

### 更换站点

如果当前站点无法访问，尝试备用站点：

```bash
nano .env
```

修改 `CROWN_BASE_URL`：
```env
CROWN_BASE_URL=https://hga027.com
# 或
CROWN_BASE_URL=https://hga030.com
# 或
CROWN_BASE_URL=https://mos011.com
```

重启服务：
```bash
pm2 restart crown-fetcher
```

## 监控

### 实时监控

```bash
# 实时日志
pm2 logs crown-fetcher

# 实时状态
watch -n 1 'pm2 status && echo "" && cat data/latest-matches.json | jq "{matchCount, breakdown, timestamp}"'
```

### 统计信息

服务每分钟会打印统计信息：
```
📊 运行统计
============================================================
⏱️  运行时长: 1小时 23分钟 45秒
📈 总抓取次数: 276
✅ 成功次数: 275
❌ 失败次数: 1
📊 成功率: 99.6%
🔐 登录次数: 1
⚽ 最新比赛数: 150 (滚球: 45, 今日: 60, 早盘: 45)
🕐 最后抓取: 2025-11-06 14:30:17
============================================================
```

## 集成到主程序

主程序会自动读取 `fetcher/data/latest-matches.json` 文件，无需额外配置。

### 验证集成

1. 启动主程序后端
2. 访问赛事管理页面
3. 切换不同的赛事类型（滚球、今日、早盘）
4. 应该能看到对应类型的赛事

## 停止使用

如果需要停止使用皇冠 API 抓取：

```bash
# 停止服务
./stop.sh

# 或
pm2 stop crown-fetcher

# 删除服务
pm2 delete crown-fetcher
```

## 获取帮助

- 查看完整文档：`cat README.md`
- 查看部署指南：`cat DEPLOY.md`
- 查看更新日志：`cat CHANGELOG.md`

## 备用站点列表

如果主站点无法访问，按顺序尝试以下站点：

1. https://hga026.com
2. https://hga027.com
3. https://hga030.com
4. https://hga035.com
5. https://hga038.com
6. https://hga039.com
7. https://hga050.com
8. https://mos011.com
9. https://mos022.com
10. https://mos033.com
11. https://mos055.com
12. https://mos066.com
13. https://mos100.com

