#!/usr/bin/env ts-node

/**
 * 诊断下注失败问题
 * 
 * 检查：
 * 1. fetcher-isports 数据中的字段
 * 2. 前端传递的字段
 * 3. crown_matches 表中的数据
 * 4. 模糊匹配查询结果
 */

import { query } from '../src/db';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('================================================================================');
  console.log('🔧 诊断下注失败问题');
  console.log('================================================================================\n');

  // 1. 检查 fetcher-isports 数据
  console.log('📊 步骤 1: 检查 fetcher-isports 数据');
  console.log('================================================================================\n');

  const fetcherDataPath = path.join(__dirname, '../../fetcher-isports/data/latest-matches.json');
  if (!fs.existsSync(fetcherDataPath)) {
    console.log('❌ 未找到 fetcher-isports 数据文件:', fetcherDataPath);
  } else {
    const fetcherData = JSON.parse(fs.readFileSync(fetcherDataPath, 'utf-8'));
    const matches = fetcherData.matches || [];
    console.log(`找到 ${matches.length} 场比赛\n`);

    if (matches.length > 0) {
      const sampleMatch = matches[0];
      console.log('示例比赛数据:');
      console.log('  gid:', sampleMatch.gid);
      console.log('  crown_gid:', sampleMatch.crown_gid);
      console.log('  league:', sampleMatch.league);
      console.log('  leagueName:', sampleMatch.leagueName);
      console.log('  league_name:', sampleMatch.league_name);
      console.log('  home:', sampleMatch.home);
      console.log('  homeName:', sampleMatch.homeName);
      console.log('  home_team:', sampleMatch.home_team);
      console.log('  team_h:', sampleMatch.team_h);
      console.log('  away:', sampleMatch.away);
      console.log('  awayName:', sampleMatch.awayName);
      console.log('  away_team:', sampleMatch.away_team);
      console.log('  team_c:', sampleMatch.team_c);
      console.log('  time:', sampleMatch.time);
      console.log('  match_time:', sampleMatch.match_time);
      console.log('');

      // 检查有多少比赛有 crown_gid
      const withCrownGid = matches.filter((m: any) => m.crown_gid).length;
      const withoutCrownGid = matches.length - withCrownGid;
      console.log(`有 crown_gid 的比赛: ${withCrownGid}`);
      console.log(`没有 crown_gid 的比赛: ${withoutCrownGid}\n`);

      if (withoutCrownGid > 0) {
        console.log('没有 crown_gid 的比赛示例:');
        const noGidMatch = matches.find((m: any) => !m.crown_gid);
        if (noGidMatch) {
          console.log('  gid:', noGidMatch.gid);
          console.log('  league:', noGidMatch.league);
          console.log('  home:', noGidMatch.home);
          console.log('  away:', noGidMatch.away);
          console.log('  time:', noGidMatch.time);
        }
        console.log('');
      }
    }
  }

  // 2. 检查 crown_matches 表
  console.log('📊 步骤 2: 检查 crown_matches 表');
  console.log('================================================================================\n');

  try {
    const countResult = await query('SELECT COUNT(*) FROM crown_matches');
    const count = parseInt(countResult.rows[0].count);
    console.log(`crown_matches 表中有 ${count} 条记录\n`);

    if (count > 0) {
      const sampleResult = await query('SELECT * FROM crown_matches ORDER BY created_at DESC LIMIT 3');
      console.log('最新的 3 条记录:\n');
      sampleResult.rows.forEach((row: any, idx: number) => {
        console.log(`${idx + 1}. crown_gid: ${row.crown_gid}`);
        console.log(`   crown_league: ${row.crown_league}`);
        console.log(`   crown_home: ${row.crown_home}`);
        console.log(`   crown_away: ${row.crown_away}`);
        console.log(`   match_time: ${row.match_time}`);
        console.log(`   created_at: ${row.created_at}`);
        console.log('');
      });
    }
  } catch (error: any) {
    console.error('❌ 查询 crown_matches 表失败:', error.message);
  }

  // 3. 测试模糊匹配
  console.log('📊 步骤 3: 测试模糊匹配查询');
  console.log('================================================================================\n');

  // 从 fetcher-isports 数据中取一个没有 crown_gid 的比赛
  if (fs.existsSync(fetcherDataPath)) {
    const fetcherData = JSON.parse(fs.readFileSync(fetcherDataPath, 'utf-8'));
    const matches = fetcherData.matches || [];
    const testMatch = matches.find((m: any) => !m.crown_gid);

    if (testMatch) {
      const homeName = testMatch.home || testMatch.homeName || testMatch.home_team || testMatch.team_h;
      const awayName = testMatch.away || testMatch.awayName || testMatch.away_team || testMatch.team_c;
      const leagueName = testMatch.league || testMatch.leagueName || testMatch.league_name;
      const matchTime = testMatch.time || testMatch.match_time;

      console.log('测试比赛:');
      console.log('  联赛:', leagueName);
      console.log('  主队:', homeName);
      console.log('  客队:', awayName);
      console.log('  时间:', matchTime);
      console.log('');

      if (homeName && awayName) {
        try {
          // 构建查询
          const conditions: string[] = [];
          const params: any[] = [];
          let paramIndex = 1;

          conditions.push(`crown_home ILIKE $${paramIndex++}`);
          params.push(`%${homeName}%`);

          conditions.push(`crown_away ILIKE $${paramIndex++}`);
          params.push(`%${awayName}%`);

          if (leagueName) {
            conditions.push(`crown_league ILIKE $${paramIndex++}`);
            params.push(`%${leagueName}%`);
          }

          if (matchTime) {
            const time = new Date(matchTime);
            if (Number.isFinite(time.getTime())) {
              const timeBefore = new Date(time.getTime() - 6 * 60 * 60 * 1000);
              const timeAfter = new Date(time.getTime() + 6 * 60 * 60 * 1000);
              conditions.push(`match_time BETWEEN $${paramIndex++} AND $${paramIndex++}`);
              params.push(timeBefore, timeAfter);
            }
          }

          const whereClause = conditions.join(' AND ');
          const sql = `
            SELECT crown_gid, crown_league, crown_home, crown_away, match_time
            FROM crown_matches 
            WHERE ${whereClause}
            ORDER BY created_at DESC 
            LIMIT 10
          `;

          console.log('执行查询:');
          console.log('  SQL:', sql);
          console.log('  参数:', params);
          console.log('');

          const result = await query(sql, params);
          console.log(`找到 ${result.rows.length} 个候选结果:\n`);

          if (result.rows.length > 0) {
            result.rows.forEach((row: any, idx: number) => {
              console.log(`${idx + 1}. crown_gid: ${row.crown_gid}`);
              console.log(`   crown_league: ${row.crown_league}`);
              console.log(`   crown_home: ${row.crown_home}`);
              console.log(`   crown_away: ${row.crown_away}`);
              console.log(`   match_time: ${row.match_time}`);
              console.log('');
            });
          } else {
            console.log('⚠️ 未找到匹配的比赛');
            console.log('');
            console.log('可能的原因:');
            console.log('1. crown_matches 表中没有这场比赛的数据');
            console.log('2. 球队名称不匹配（检查是否有繁简体、空格等差异）');
            console.log('3. 时间范围不匹配（±6 小时）');
            console.log('');
          }
        } catch (error: any) {
          console.error('❌ 查询失败:', error.message);
        }
      } else {
        console.log('⚠️ 测试比赛缺少主队或客队名称');
      }
    } else {
      console.log('⚠️ 所有比赛都有 crown_gid，无需测试模糊匹配');
    }
  }

  console.log('================================================================================');
  console.log('✅ 诊断完成');
  console.log('================================================================================');

  process.exit(0);
}

main().catch((error) => {
  console.error('❌ 诊断失败:', error);
  process.exit(1);
});

