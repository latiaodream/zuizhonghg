#!/usr/bin/env ts-node

/**
 * 诊断滚球多盘口问题
 * 
 * 检查：
 * 1. 数据文件中是否有多盘口
 * 2. 后端读取后是否保留了多盘口
 * 3. enrichMatchesWithMoreMarkets 是否被调用
 * 4. Redis 缓存是否有数据
 */

import * as fs from 'fs';
import * as path from 'path';

const dataFilePaths = [
  path.join(__dirname, '../../..', 'fetcher-isports', 'data', 'latest-matches.json'),
  path.join(__dirname, '../../..', 'fetcher', 'data', 'latest-matches.json'),
];

console.log('🔍 开始诊断滚球多盘口问题...\n');

// 1. 检查数据文件
console.log('===== 第一步：检查数据文件 =====');
for (const filePath of dataFilePaths) {
  if (!fs.existsSync(filePath)) {
    console.log(`❌ 文件不存在: ${filePath}`);
    continue;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const timestamp = data.timestamp || 0;
    const age = Date.now() - timestamp;
    const matches = data.matches || [];
    
    console.log(`\n📂 文件: ${filePath}`);
    console.log(`   时间戳: ${new Date(timestamp).toLocaleString()}`);
    console.log(`   数据年龄: ${Math.floor(age / 1000)}秒`);
    console.log(`   总比赛数: ${matches.length}`);
    
    // 统计 showtype
    const breakdown = matches.reduce((acc: any, m: any) => {
      const st = m.showtype || m.source_showtype || 'unknown';
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    }, {});
    console.log(`   分类: ${JSON.stringify(breakdown)}`);
    
    // 检查滚球比赛的多盘口
    const liveMatches = matches.filter((m: any) => {
      const st = m.showtype || m.source_showtype;
      return st === 'live';
    });
    
    console.log(`\n   滚球比赛数: ${liveMatches.length}`);
    
    if (liveMatches.length > 0) {
      console.log(`\n   前 3 场滚球比赛的盘口情况:`);
      liveMatches.slice(0, 3).forEach((m: any, idx: number) => {
        const markets = m.markets || {};
        const full = markets.full || {};
        const half = markets.half || {};
        const handicapLines = full.handicapLines || [];
        const overUnderLines = full.overUnderLines || [];
        const halfHandicapLines = half.handicapLines || [];
        const halfOverUnderLines = half.overUnderLines || [];
        
        console.log(`\n   ${idx + 1}. ${m.league} | ${m.home} vs ${m.away}`);
        console.log(`      GID: ${m.gid || m.match_id || m.id}`);
        console.log(`      全场让球: ${handicapLines.length} 条`);
        console.log(`      全场大小: ${overUnderLines.length} 条`);
        console.log(`      半场让球: ${halfHandicapLines.length} 条`);
        console.log(`      半场大小: ${halfOverUnderLines.length} 条`);
        
        if (handicapLines.length > 0) {
          console.log(`      让球盘口:`);
          handicapLines.forEach((line: any, i: number) => {
            console.log(`        ${i + 1}. ${line.line || line.ratio} | ${line.home} / ${line.away}`);
          });
        }
        
        if (overUnderLines.length > 0) {
          console.log(`      大小盘口:`);
          overUnderLines.forEach((line: any, i: number) => {
            console.log(`        ${i + 1}. ${line.line || line.ratio} | ${line.over} / ${line.under}`);
          });
        }
      });
    }
    
    // 如果找到有效数据，就不再检查其他文件
    if (age < 60000 && liveMatches.length > 0) {
      console.log(`\n✅ 找到有效数据文件，停止检查其他文件`);
      break;
    }
  } catch (error: any) {
    console.error(`❌ 读取文件失败: ${error.message}`);
  }
}

console.log('\n\n===== 第二步：检查 Redis 缓存 =====');
console.log('请在服务器上运行以下命令：');
console.log('');
console.log('# 1. 查看 Redis 缓存键');
console.log('redis-cli KEYS "crown:more_markets:*" | head -10');
console.log('');
console.log('# 2. 查看某个缓存的内容');
console.log('redis-cli KEYS "crown:more_markets:*" | head -1 | xargs redis-cli GET | jq .');
console.log('');
console.log('# 3. 查看缓存的 TTL');
console.log('redis-cli KEYS "crown:more_markets:*" | head -1 | xargs redis-cli TTL');

console.log('\n\n===== 第三步：检查后端日志 =====');
console.log('请在服务器上运行以下命令：');
console.log('');
console.log('# 1. 查看盘口补充日志');
console.log('pm2 logs bclogin-backend --lines 100 --nostream | grep -E "补充盘口|enrichMatchesWithMoreMarkets"');
console.log('');
console.log('# 2. 查看 Redis 相关日志');
console.log('pm2 logs bclogin-backend --lines 100 --nostream | grep -E "Redis|缓存"');
console.log('');
console.log('# 3. 查看 SSE 推送日志');
console.log('pm2 logs bclogin-backend --lines 100 --nostream | grep -E "SSE|stream|推送"');

console.log('\n\n===== 第四步：检查前端请求 =====');
console.log('请在浏览器中：');
console.log('1. 打开开发者工具（F12）');
console.log('2. 切换到 Network 标签');
console.log('3. 刷新页面');
console.log('4. 查找 "system/stream" 请求（SSE 推送）');
console.log('5. 查看 EventStream 标签中的 "matches" 事件');
console.log('6. 检查返回的数据中是否有 markets.full.handicapLines 数组');
console.log('7. 检查数组长度是否 > 1');

console.log('\n\n===== 诊断完成 =====');
console.log('如果：');
console.log('- 数据文件中有多盘口（handicapLines.length > 1）');
console.log('- 但前端显示的数据中没有多盘口');
console.log('那么问题可能在：');
console.log('1. 后端的 enrichMatchesWithMoreMarkets 没有被调用（检查 fast 参数）');
console.log('2. 前端的 mergeMarketsData 函数丢失了多盘口数据');
console.log('3. SSE 推送的数据被前端过滤或覆盖了');

