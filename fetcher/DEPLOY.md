# 皇冠赛事抓取服务部署指南

## 功能说明

本服务直接从皇冠 API 抓取赛事数据，支持三种类型：
- **滚球（live）**：正在进行的比赛
- **今日（today）**：今天的比赛
- **早盘（early）**：明天及以后的比赛

每次抓取循环会依次获取这三种类型的赛事，合并后保存到 `data/latest-matches.json` 文件。

## 部署步骤

### 1. 配置环境变量

```bash
cd fetcher
cp .env.example .env
nano .env
```

修改以下配置：
```env
# 皇冠账号（必填）
CROWN_USERNAME=your_username
CROWN_PASSWORD=your_password

# 皇冠站点（选择可用的备用站点）
CROWN_BASE_URL=https://hga026.com

# 抓取间隔（建议 3000-5000ms）
FETCH_INTERVAL=3000
```

**备用站点列表：**
- hga026.com
- hga027.com
- hga030.com
- hga035.com
- hga038.com
- hga039.com
- hga050.com
- mos011.com
- mos022.com
- mos033.com
- mos055.com
- mos066.com
- mos100.com

### 2. 安装依赖

```bash
npm install
```

### 3. 编译代码

```bash
npm run build
```

### 4. 启动服务

#### 开发模式（测试用）
```bash
npm run dev
```

#### 生产模式（使用 PM2）
```bash
# 启动服务
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs crown-fetcher

# 查看实时日志
pm2 logs crown-fetcher --lines 100

# 停止服务
pm2 stop crown-fetcher

# 重启服务
pm2 restart crown-fetcher

# 删除服务
pm2 delete crown-fetcher
```

### 5. 设置开机自启（可选）

```bash
# 保存 PM2 进程列表
pm2 save

# 生成开机启动脚本
pm2 startup
```

## 验证服务

### 1. 检查服务状态

```bash
pm2 status
```

应该看到 `crown-fetcher` 状态为 `online`。

### 2. 查看日志

```bash
pm2 logs crown-fetcher --lines 50
```

应该看到类似以下输出：
```
✅ [14:30:15] 滚球抓取成功 | 比赛数: 45
✅ [14:30:16] 今日抓取成功 | 比赛数: 60
✅ [14:30:17] 早盘抓取成功 | 比赛数: 45
✅ [14:30:17] 总计: 150 场 (滚球: 45, 今日: 60, 早盘: 45) | 成功率: 100.0%
```

### 3. 检查数据文件

```bash
cat data/latest-matches.json | jq '.matchCount'
```

应该看到比赛数量。

### 4. 检查数据更新时间

```bash
cat data/latest-matches.json | jq '.timestamp'
```

时间戳应该是最近的。

## 监控和维护

### 查看统计信息

服务每分钟会打印一次统计信息：
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

### 常见问题

#### 1. 登录失败

**症状：** 日志显示 "❌ 登录失败: 账号或密码错误"

**解决方法：**
- 检查 `.env` 文件中的账号密码是否正确
- 尝试更换备用站点
- 确认账号未被锁定

#### 2. 抓取失败

**症状：** 日志显示 "❌ 抓取失败"

**解决方法：**
- 检查网络连接
- 尝试更换备用站点
- 检查账号是否在线（可能被其他地方登录）

#### 3. 会话过期

**症状：** 日志显示 "⚠️ 检测到重复登录，会话已失效"

**解决方法：**
- 服务会自动重新登录
- 如果频繁出现，检查是否有其他程序使用同一账号

#### 4. 数据文件不更新

**症状：** `data/latest-matches.json` 时间戳不更新

**解决方法：**
```bash
# 重启服务
pm2 restart crown-fetcher

# 查看日志找出原因
pm2 logs crown-fetcher --lines 100
```

### 日志文件位置

- 输出日志：`logs/out.log`
- 错误日志：`logs/error.log`

### 清理日志

```bash
# 清空 PM2 日志
pm2 flush crown-fetcher

# 或手动删除日志文件
rm -f logs/*.log
```

## 性能优化

### 调整抓取间隔

根据服务器性能和需求调整 `FETCH_INTERVAL`：
- **高频更新**：3000ms（3秒）- 适合滚球实时性要求高的场景
- **标准更新**：5000ms（5秒）- 平衡性能和实时性
- **低频更新**：10000ms（10秒）- 减少服务器负载

注意：每次抓取会依次获取三种类型的赛事，实际间隔会更长。

### 内存限制

如果服务占用内存过高，可以调整 `ecosystem.config.js` 中的 `max_memory_restart`：
```javascript
max_memory_restart: '500M'  // 默认 500MB
```

## 与主程序集成

主程序会自动读取 `fetcher/data/latest-matches.json` 文件：

1. 后端优先读取 `fetcher-isports/data/latest-matches.json`（iSports 数据）
2. 如果不可用，回退到 `fetcher/data/latest-matches.json`（皇冠数据）
3. 后端会根据前端选择的 `showtype` 自动过滤赛事

无需修改主程序代码，只需确保本服务正常运行即可。

## 停止服务

如果需要停止使用皇冠 API 抓取，改用 iSports API：

```bash
# 停止皇冠抓取服务
pm2 stop crown-fetcher

# 启动 iSports 抓取服务
cd ../fetcher-isports
pm2 start ecosystem.config.js
```

## 更新服务

```bash
# 停止服务
pm2 stop crown-fetcher

# 拉取最新代码
git pull

# 重新编译
npm run build

# 启动服务
pm2 start crown-fetcher
```

