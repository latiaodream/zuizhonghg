# 更新日志

## 2025-11-06 - 支持多类型赛事抓取

### 新增功能

1. **多类型赛事抓取**
   - 支持同时抓取滚球（live）、今日（today）、早盘（early）三种类型的赛事
   - 每次抓取循环会依次获取三种类型，合并后保存到一个文件
   - 每场比赛都标记了 `showtype` 字段，便于后端过滤

2. **增强的赛事数据结构**
   - 添加了更多字段别名，确保与后端兼容
   - 包含 `league_name`, `team_h`, `team_c`, `match_time`, `timer` 等字段
   - 添加了 `showtype` 和 `source_showtype` 标记

3. **改进的统计信息**
   - 分类统计各类型赛事数量（滚球、今日、早盘）
   - 显示总计和分类的比赛数量
   - 更详细的成功率统计

### 修改的文件

1. **fetcher/src/crown-client.ts**
   - `fetchMatches()` 方法支持传入 `showtype`, `gtype`, `rtype` 参数
   - 为每场比赛添加 `showtype` 标记
   - 增强赛事数据结构，添加更多字段

2. **fetcher/src/index.ts**
   - 修改主抓取循环，依次抓取三种类型的赛事
   - 合并所有赛事并保存到一个文件
   - 更新统计信息显示

3. **fetcher/.env.example**
   - 更新配置说明
   - 添加备用站点列表
   - 调整推荐的抓取间隔

4. **fetcher/README.md**
   - 更新功能说明
   - 添加多类型抓取的说明
   - 更新数据文件格式说明

### 新增文件

1. **fetcher/DEPLOY.md**
   - 详细的部署指南
   - 常见问题解决方案
   - 监控和维护说明

2. **fetcher/start.sh**
   - 快速启动脚本
   - 自动检查环境和依赖

3. **fetcher/stop.sh**
   - 快速停止脚本

4. **fetcher/.env**
   - 环境变量配置文件模板

### 数据文件格式

保存的 `data/latest-matches.json` 格式：

```json
{
  "timestamp": 1699267817000,
  "matches": [
    {
      "gid": "3001234",
      "league": "英格兰超级联赛",
      "home": "曼彻斯特联",
      "away": "利物浦",
      "showtype": "live",
      "markets": { ... },
      ...
    }
  ],
  "matchCount": 150,
  "breakdown": {
    "live": 45,
    "today": 60,
    "early": 45
  }
}
```

### 使用方法

#### 1. 配置环境变量

```bash
cd fetcher
cp .env.example .env
nano .env
```

修改账号密码和站点地址。

#### 2. 启动服务

```bash
# 方式一：使用启动脚本
./start.sh

# 方式二：手动启动
npm run build
pm2 start ecosystem.config.js
```

#### 3. 查看日志

```bash
pm2 logs crown-fetcher
```

#### 4. 停止服务

```bash
# 方式一：使用停止脚本
./stop.sh

# 方式二：手动停止
pm2 stop crown-fetcher
```

### 与主程序集成

主程序会自动读取 `fetcher/data/latest-matches.json` 文件：

1. 后端优先读取 `fetcher-isports/data/latest-matches.json`（iSports 数据）
2. 如果不可用，回退到 `fetcher/data/latest-matches.json`（皇冠数据）
3. 后端使用 `filterMatchesByShowtype()` 函数根据前端选择的 `showtype` 自动过滤赛事

无需修改主程序代码，只需确保本服务正常运行即可。

### 性能建议

- **抓取间隔**：建议设置为 3000-5000ms
- **内存限制**：默认 500MB，可根据需要调整
- **日志管理**：定期清理日志文件

### 注意事项

1. 每次抓取会依次获取三种类型的赛事，实际间隔会比配置的 `FETCH_INTERVAL` 更长
2. 滚球赛事会获取更多盘口信息（前5场比赛）
3. 会话有效期为 2 小时，过期会自动重新登录
4. 如果检测到重复登录，会自动重新登录

### 备用站点

如果主站点无法访问，可以尝试以下备用站点：
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

### 故障排查

#### 登录失败
- 检查账号密码是否正确
- 尝试更换备用站点
- 确认账号未被锁定

#### 抓取失败
- 检查网络连接
- 查看日志找出具体原因
- 尝试重启服务

#### 数据不更新
- 检查服务是否正常运行
- 查看日志是否有错误
- 重启服务

### 后续计划

- [ ] 支持更多体育类型（篮球、网球等）
- [ ] 添加数据验证和清洗
- [ ] 支持多账号轮换
- [ ] 添加 Webhook 通知
- [ ] 性能监控和告警

