import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CrownClient } from './crown-client';

// 加载环境变量
dotenv.config();

const config = {
  username: process.env.CROWN_USERNAME || '',
  password: process.env.CROWN_PASSWORD || '',
  baseUrl: process.env.CROWN_BASE_URL || 'https://hga026.com',
  // 不同类型比赛的更新间隔（毫秒）
  liveInterval: parseInt(process.env.LIVE_INTERVAL || '2000'),    // 滚球: 2秒
  todayInterval: parseInt(process.env.TODAY_INTERVAL || '10000'), // 今日: 10秒
  earlyInterval: parseInt(process.env.EARLY_INTERVAL || '3600000'), // 早盘: 1小时
  sessionCheckInterval: parseInt(process.env.SESSION_CHECK_INTERVAL || '300000'),
  dataDir: process.env.DATA_DIR || './data',
};

// 验证配置
if (!config.username || !config.password) {
  console.error('❌ 缺少必要配置: CROWN_USERNAME 和 CROWN_PASSWORD');
  process.exit(1);
}

// 创建数据目录
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

// 创建客户端
const client = new CrownClient({
  baseUrl: config.baseUrl,
  username: config.username,
  password: config.password,
  dataDir: config.dataDir,
});

// 统计信息
let stats = {
  startTime: Date.now(),
  totalFetches: 0,
  successFetches: 0,
  failedFetches: 0,
  lastFetchTime: {
    live: 0,
    today: 0,
    early: 0,
  },
  lastMatchCount: {
    live: 0,
    today: 0,
    early: 0,
    total: 0,
  },
  loginCount: 0,
};

/**
 * 抓取单个类型的赛事
 */
async function fetchShowtype(showtype: string, name: string, rtype: string) {
  try {
    const result = await client.fetchMatches({
      showtype: showtype,
      gtype: 'ft',
      rtype: rtype,
    });

    stats.totalFetches++;

    if (result.success) {
      stats.successFetches++;
      stats.lastFetchTime[showtype as 'live' | 'today' | 'early'] = Date.now();
      stats.lastMatchCount[showtype as 'live' | 'today' | 'early'] = result.matches.length;
      console.log(
        `✅ [${new Date().toLocaleTimeString()}] ${name}抓取成功 | 比赛数: ${result.matches.length}`
      );
      return result.matches;
    } else {
      stats.failedFetches++;
      console.error(`❌ [${new Date().toLocaleTimeString()}] ${name}抓取失败: ${result.error}`);
      return [];
    }
  } catch (error: any) {
    stats.failedFetches++;
    console.error(`❌ [${new Date().toLocaleTimeString()}] ${name}抓取异常:`, error.message);
    return [];
  }
}

/**
 * 保存所有比赛数据到文件
 */
function saveMatches(liveMatches: any[], todayMatches: any[], earlyMatches: any[]) {
  const allMatches = [...liveMatches, ...todayMatches, ...earlyMatches];
  stats.lastMatchCount.total = allMatches.length;

  const dataFile = path.join(config.dataDir, 'latest-matches.json');
  const tmpFile = dataFile + '.tmp';
  const payload = JSON.stringify({
    timestamp: Date.now(),
    matches: allMatches,
    matchCount: allMatches.length,
    breakdown: {
      live: liveMatches.length,
      today: todayMatches.length,
      early: earlyMatches.length,
    },
  });
  // 原子写入：先写临时文件，再重命名替换，避免读到半写入状态
  fs.writeFileSync(tmpFile, payload);
  fs.renameSync(tmpFile, dataFile);

  console.log(
    `✅ [${new Date().toLocaleTimeString()}] 总计: ${allMatches.length} 场 (滚球: ${liveMatches.length}, 今日: ${todayMatches.length}, 早盘: ${earlyMatches.length}) | 成功率: ${((stats.successFetches / stats.totalFetches) * 100).toFixed(1)}%`
  );
}

// 缓存各类型的比赛数据
let cachedMatches = {
  live: [] as any[],
  today: [] as any[],
  early: [] as any[],
};

/**
 * 滚球抓取循环 - 每2秒
 */
let isFetchingLive = false;
async function fetchLiveLoop() {
  if (isFetchingLive) return;
  isFetchingLive = true;
  try {
    const loggedIn = await client.ensureLoggedIn();
    if (!loggedIn) {
      console.error('❌ 登录失败，等待下次重试...');
      stats.failedFetches++;
      return;
    }

    cachedMatches.live = await fetchShowtype('live', '滚球', 'rb');
    saveMatches(cachedMatches.live, cachedMatches.today, cachedMatches.early);
  } catch (error: any) {
    stats.failedFetches++;
    console.error(`❌ [${new Date().toLocaleTimeString()}] 滚球抓取异常:`, error.message);
  } finally {
    isFetchingLive = false;
  }
}

/**
 * 今日赛事抓取循环 - 每10秒
 */
let isFetchingToday = false;
async function fetchTodayLoop() {
  if (isFetchingToday) return;
  isFetchingToday = true;
  try {
    const loggedIn = await client.ensureLoggedIn();
    if (!loggedIn) {
      console.error('❌ 登录失败，等待下次重试...');
      stats.failedFetches++;
      return;
    }

    cachedMatches.today = await fetchShowtype('today', '今日', 'r');
    saveMatches(cachedMatches.live, cachedMatches.today, cachedMatches.early);
  } catch (error: any) {
    stats.failedFetches++;
    console.error(`❌ [${new Date().toLocaleTimeString()}] 今日抓取异常:`, error.message);
  } finally {
    isFetchingToday = false;
  }
}

/**
 * 早盘赛事抓取循环 - 每1小时
 */
let isFetchingEarly = false;
async function fetchEarlyLoop() {
  if (isFetchingEarly) return;
  isFetchingEarly = true;
  try {
    const loggedIn = await client.ensureLoggedIn();
    if (!loggedIn) {
      console.error('❌ 登录失败，等待下次重试...');
      stats.failedFetches++;
      return;
    }

    cachedMatches.early = await fetchShowtype('early', '早盘', 'r');
    saveMatches(cachedMatches.live, cachedMatches.today, cachedMatches.early);
  } catch (error: any) {
    stats.failedFetches++;
    console.error(`❌ [${new Date().toLocaleTimeString()}] 早盘抓取异常:`, error.message);
  } finally {
    isFetchingEarly = false;
  }
}

/**
 * 定期检查会话
 */
async function sessionCheckLoop() {
  try {
    const isValid = await client.checkSession();
    if (!isValid) {
      console.log('⚠️ 会话失效，将在下次抓取时重新登录');
    } else {
      console.log(`✅ [${new Date().toLocaleTimeString()}] 会话有效`);
    }
  } catch (error: any) {
    console.error('❌ 会话检查失败:', error.message);
  }
}

/**
 * 打印统计信息
 */
function printStats() {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;

  console.log('\n' + '='.repeat(60));
  console.log('📊 运行统计');
  console.log('='.repeat(60));
  console.log(`⏱️  运行时长: ${hours}小时 ${minutes}分钟 ${seconds}秒`);
  console.log(`📈 总抓取次数: ${stats.totalFetches}`);
  console.log(`✅ 成功次数: ${stats.successFetches}`);
  console.log(`❌ 失败次数: ${stats.failedFetches}`);
  console.log(`📊 成功率: ${stats.totalFetches > 0 ? ((stats.successFetches / stats.totalFetches) * 100).toFixed(1) : 0}%`);
  console.log(`🔐 登录次数: ${stats.loginCount}`);
  console.log(`⚽ 最新比赛数: ${stats.lastMatchCount.total} (滚球: ${stats.lastMatchCount.live}, 今日: ${stats.lastMatchCount.today}, 早盘: ${stats.lastMatchCount.early})`);
  console.log(`🕐 滚球最后抓取: ${stats.lastFetchTime.live > 0 ? new Date(stats.lastFetchTime.live).toLocaleString() : '未开始'}`);
  console.log(`🕐 今日最后抓取: ${stats.lastFetchTime.today > 0 ? new Date(stats.lastFetchTime.today).toLocaleString() : '未开始'}`);
  console.log(`🕐 早盘最后抓取: ${stats.lastFetchTime.early > 0 ? new Date(stats.lastFetchTime.early).toLocaleString() : '未开始'}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * 启动服务
 */
async function start() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 皇冠赛事抓取服务启动');
  console.log('='.repeat(60));
  console.log(`📍 站点: ${config.baseUrl}`);
  console.log(`👤 账号: ${config.username}`);
  console.log(`⏱️  滚球更新间隔: ${config.liveInterval}ms (${config.liveInterval / 1000}秒)`);
  console.log(`⏱️  今日更新间隔: ${config.todayInterval}ms (${config.todayInterval / 1000}秒)`);
  console.log(`⏱️  早盘更新间隔: ${config.earlyInterval}ms (${config.earlyInterval / 60000}分钟)`);
  console.log(`🔍 会话检查间隔: ${config.sessionCheckInterval}ms`);
  console.log(`💾 数据目录: ${config.dataDir}`);
  console.log('='.repeat(60) + '\n');

  // 初始登录
  console.log('🔐 初始登录...');
  const loginResult = await client.login();
  if (loginResult.success) {
    stats.loginCount++;
    console.log('✅ 初始登录成功\n');
  } else {
    console.error(`❌ 初始登录失败: ${loginResult.error}`);
    console.error('⚠️ 将在抓取时重试登录\n');
  }

  // 启动不同频率的抓取循环
  setInterval(fetchLiveLoop, config.liveInterval);   // 滚球: 2秒
  setInterval(fetchTodayLoop, config.todayInterval); // 今日: 10秒
  setInterval(fetchEarlyLoop, config.earlyInterval); // 早盘: 1小时

  // 启动会话检查循环
  setInterval(sessionCheckLoop, config.sessionCheckInterval);

  // 每分钟打印一次统计信息
  setInterval(printStats, 60000);

  // 立即执行一次所有类型的抓取
  fetchLiveLoop();
  fetchTodayLoop();
  fetchEarlyLoop();
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n⚠️ 收到退出信号，正在保存数据...');
  printStats();
  console.log('👋 服务已停止\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️ 收到终止信号，正在保存数据...');
  printStats();
  console.log('👋 服务已停止\n');
  process.exit(0);
});

// 启动
start().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});

