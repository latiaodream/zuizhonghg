# 皇冠赛事抓取服务

独立的赛事抓取服务，与主程序完全分离，直接从皇冠 API 抓取赛事数据。

## 特点

- ✅ **独立运行**：不依赖主程序，单独的 PM2 进程
- ✅ **多类型抓取**：同时抓取滚球、今日、早盘三种类型的赛事
- ✅ **会话持久化**：登录后保存会话，重启不需要重新登录
- ✅ **自动重连**：会话过期自动重新登录
- ✅ **数据持久化**：抓取的数据保存到文件，主程序可以读取
- ✅ **避免频繁登录**：减少账号被锁风险

## 安装

```bash
cd fetcher
npm install
npm run build
```

## 配置

复制 `.env.example` 为 `.env` 并修改：

```bash
cp .env.example .env
nano .env
```

配置项：
- `CROWN_USERNAME`: 皇冠账号
- `CROWN_PASSWORD`: 皇冠密码
- `CROWN_BASE_URL`: 皇冠站点地址（备用站点：hga026.com, hga027.com, hga030.com 等）
- `FETCH_INTERVAL`: 抓取间隔（毫秒），建议 3000-5000，默认 3000
  - 注意：每次抓取会依次获取滚球、今日、早盘三种类型，实际间隔会更长
- `SESSION_CHECK_INTERVAL`: 会话检查间隔（毫秒），默认 300000（5分钟）
- `DATA_DIR`: 数据存储目录，默认 ./data

## 启动

### 开发模式
```bash
npm run dev
```

### 生产模式
```bash
# 使用 PM2 启动
pm2 start ecosystem.config.js

# 查看日志
pm2 logs crown-fetcher

# 查看状态
pm2 status

# 停止
pm2 stop crown-fetcher

# 重启
pm2 restart crown-fetcher
```

## 数据文件

抓取的数据保存在 `data/latest-matches.json`：

```json
{
  "timestamp": 1234567890,
  "matches": [...],
  "matchCount": 150,
  "breakdown": {
    "live": 45,
    "today": 60,
    "early": 45
  }
}
```

主程序可以读取这个文件获取最新的赛事数据。

### 赛事数据结构

每场比赛包含以下字段：
- `gid`: 比赛 ID
- `league`: 联赛名称
- `home`: 主队名称
- `away`: 客队名称
- `time`: 比赛时间
- `score`: 比分
- `showtype`: 赛事类型（live=滚球, today=今日, early=早盘）
- `markets`: 盘口数据（让球、大小球、独赢等）

## 会话管理

- 登录后会话保存在 `data/session.json`
- 会话有效期 2 小时
- 每 5 分钟检查一次会话有效性
- 会话失效自动重新登录
- 重启服务会尝试加载已保存的会话

## 监控

服务每分钟打印一次统计信息：
- 运行时长
- 总抓取次数
- 成功/失败次数
- 成功率
- 登录次数
- 最新比赛数（分类统计：滚球、今日、早盘）

### 抓取流程

每次抓取循环会依次执行：
1. 检查登录状态，如需要则重新登录
2. 抓取滚球赛事（showtype=live, rtype=rb）
3. 延迟 500ms
4. 抓取今日赛事（showtype=today, rtype=r）
5. 延迟 500ms
6. 抓取早盘赛事（showtype=early, rtype=r）
7. 合并所有赛事并保存到文件
8. 等待下一个抓取周期

## 日志

PM2 日志位置：
- 输出日志：`logs/out.log`
- 错误日志：`logs/error.log`

