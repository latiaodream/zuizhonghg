#!/usr/bin/env ts-node
/**
 * 诊断名称显示问题
 * 
 * 检查：
 * 1. 数据库中的翻译数据
 * 2. 名称映射逻辑
 * 3. API 返回的数据
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import axios from 'axios';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'bclogin_system',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function checkDatabase() {
  console.log('\n📊 步骤 1: 检查数据库中的翻译数据');
  console.log('='.repeat(80));

  // 检查 Stellenbosch 的数据
  const result = await pool.query(`
    SELECT 
      id,
      canonical_key,
      name_en,
      name_zh_cn,
      name_zh_tw,
      isports_team_id
    FROM team_aliases 
    WHERE name_zh_tw LIKE '%Stellenbosch%' 
       OR name_en LIKE '%Stellenbosch%'
    ORDER BY id
  `);

  console.log(`\n找到 ${result.rows.length} 条 Stellenbosch 相关记录:\n`);
  
  for (const row of result.rows) {
    console.log(`ID: ${row.id}`);
    console.log(`  canonical_key: ${row.canonical_key}`);
    console.log(`  name_en: ${row.name_en || '(空)'}`);
    console.log(`  name_zh_cn: ${row.name_zh_cn || '(空)'}`);
    console.log(`  name_zh_tw: ${row.name_zh_tw || '(空)'}`);
    console.log(`  isports_team_id: ${row.isports_team_id || '(空)'}`);
    console.log('');
  }

  // 检查是否有 name_zh_cn 为空的记录
  const emptyZhCn = await pool.query(`
    SELECT COUNT(*) as count
    FROM team_aliases 
    WHERE (name_zh_tw IS NOT NULL OR name_en IS NOT NULL)
      AND (name_zh_cn IS NULL OR name_zh_cn = '')
  `);

  console.log(`⚠️  有 ${emptyZhCn.rows[0].count} 条球队记录没有简体中文翻译\n`);

  const emptyZhCnLeague = await pool.query(`
    SELECT COUNT(*) as count
    FROM league_aliases 
    WHERE (name_zh_tw IS NOT NULL OR name_en IS NOT NULL)
      AND (name_zh_cn IS NULL OR name_zh_cn = '')
  `);

  console.log(`⚠️  有 ${emptyZhCnLeague.rows[0].count} 条联赛记录没有简体中文翻译\n`);
}

async function testNameMapping() {
  console.log('\n🔍 步骤 2: 测试名称映射逻辑');
  console.log('='.repeat(80));

  const testCases = [
    { type: 'team', name: 'Stellenbosch FC' },
    { type: 'team', name: 'Stellenbosch FC Reserves' },
    { type: 'team', name: '斯泰倫博斯' },
  ];

  for (const testCase of testCases) {
    console.log(`\n测试: ${testCase.type} = "${testCase.name}"`);
    
    const tableName = testCase.type === 'league' ? 'league_aliases' : 'team_aliases';

    // 1. 尝试匹配 name_zh_tw
    let result = await pool.query(
      `SELECT name_zh_cn, name_zh_tw, name_en FROM ${tableName} WHERE name_zh_tw = $1 LIMIT 1`,
      [testCase.name]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const displayName = row.name_zh_cn || row.name_zh_tw || row.name_en || testCase.name;
      console.log(`  ✅ 匹配 name_zh_tw`);
      console.log(`     name_zh_cn: "${row.name_zh_cn || '(空)'}"`);
      console.log(`     name_zh_tw: "${row.name_zh_tw || '(空)'}"`);
      console.log(`     name_en: "${row.name_en || '(空)'}"`);
      console.log(`     → 应该显示: "${displayName}"`);
      continue;
    }

    // 2. 尝试匹配 name_en
    result = await pool.query(
      `SELECT name_zh_cn, name_zh_tw, name_en FROM ${tableName} WHERE name_en = $1 LIMIT 1`,
      [testCase.name]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      const displayName = row.name_zh_cn || row.name_zh_tw || row.name_en || testCase.name;
      console.log(`  ✅ 匹配 name_en`);
      console.log(`     name_zh_cn: "${row.name_zh_cn || '(空)'}"`);
      console.log(`     name_zh_tw: "${row.name_zh_tw || '(空)'}"`);
      console.log(`     name_en: "${row.name_en || '(空)'}"`);
      console.log(`     → 应该显示: "${displayName}"`);
      continue;
    }

    console.log(`  ❌ 未找到映射，将显示原名: "${testCase.name}"`);
  }
}

async function checkAPI() {
  console.log('\n🌐 步骤 3: 检查 API 返回的数据');
  console.log('='.repeat(80));

  const port = process.env.PORT || 3001;
  const baseURL = `http://localhost:${port}`;

  try {
    console.log(`\n请求: GET ${baseURL}/api/isports/matches?category=today`);
    
    const response = await axios.get(`${baseURL}/api/isports/matches?category=today`, {
      timeout: 5000
    });

    if (response.data && response.data.data) {
      const matches = response.data.data;
      console.log(`\n✅ 成功获取 ${matches.length} 场赛事\n`);

      // 查找包含 Stellenbosch 的赛事
      const stellenboschMatches = matches.filter((m: any) => 
        (m.home && m.home.includes('Stellenbosch')) || 
        (m.away && m.away.includes('Stellenbosch')) ||
        (m.home_team && m.home_team.includes('Stellenbosch')) ||
        (m.away_team && m.away_team.includes('Stellenbosch'))
      );

      if (stellenboschMatches.length > 0) {
        console.log(`找到 ${stellenboschMatches.length} 场 Stellenbosch 相关赛事:\n`);
        
        for (const match of stellenboschMatches.slice(0, 3)) {
          console.log(`赛事 ID: ${match.id || match.match_id}`);
          console.log(`  联赛: ${match.league || match.league_name}`);
          console.log(`  主队: ${match.home || match.home_team}`);
          console.log(`  客队: ${match.away || match.away_team}`);
          console.log('');
        }
      } else {
        console.log('⚠️  没有找到 Stellenbosch 相关赛事');
        console.log('\n显示前 3 场赛事作为示例:\n');
        
        for (const match of matches.slice(0, 3)) {
          console.log(`赛事 ID: ${match.id || match.match_id}`);
          console.log(`  联赛: ${match.league || match.league_name}`);
          console.log(`  主队: ${match.home || match.home_team}`);
          console.log(`  客队: ${match.away || match.away_team}`);
          console.log('');
        }
      }
    } else {
      console.log('❌ API 返回数据格式不正确');
    }

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.log(`\n❌ 无法连接到后端服务 (${baseURL})`);
      console.log('   请确认后端服务是否正在运行: pm2 list');
    } else {
      console.log(`\n❌ API 请求失败:`, error.message);
    }
  }
}

async function checkSourceData() {
  console.log('\n📦 步骤 4: 检查 iSports 原始数据');
  console.log('='.repeat(80));

  const fs = require('fs');
  const dataPath = path.resolve(__dirname, '../../fetcher-isports/data/latest-matches.json');

  if (fs.existsSync(dataPath)) {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`\n✅ 找到 iSports 数据文件`);
    console.log(`   赛事总数: ${data.matches?.length || 0}`);
    console.log(`   更新时间: ${new Date(data.timestamp).toLocaleString('zh-CN')}`);

    // 查找 Stellenbosch 相关赛事
    if (data.matches) {
      const stellenboschMatches = data.matches.filter((m: any) => 
        m.homeTeamName?.includes('Stellenbosch') || 
        m.awayTeamName?.includes('Stellenbosch')
      );

      if (stellenboschMatches.length > 0) {
        console.log(`\n找到 ${stellenboschMatches.length} 场 Stellenbosch 相关赛事:\n`);
        
        for (const match of stellenboschMatches.slice(0, 2)) {
          console.log(`赛事 ID: ${match.matchId}`);
          console.log(`  联赛: ${match.leagueName}`);
          console.log(`  主队: ${match.homeTeamName}`);
          console.log(`  客队: ${match.awayTeamName}`);
          console.log('');
        }
      } else {
        console.log('\n⚠️  iSports 数据中没有 Stellenbosch 相关赛事');
      }
    }
  } else {
    console.log(`\n❌ 未找到 iSports 数据文件: ${dataPath}`);
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔧 诊断名称显示问题');
  console.log('='.repeat(80));

  try {
    await checkDatabase();
    await testNameMapping();
    await checkSourceData();
    await checkAPI();

    console.log('\n' + '='.repeat(80));
    console.log('✅ 诊断完成');
    console.log('='.repeat(80));
    console.log('\n💡 如果 API 返回的数据仍然是英文，可能的原因：');
    console.log('   1. 后端服务没有重启，缓存了旧的代码');
    console.log('   2. 前端调用的是其他接口，不是 /api/isports/matches');
    console.log('   3. iSports 原始数据中的名称与数据库中的不匹配');
    console.log('   4. 名称映射逻辑有其他问题\n');

  } catch (error) {
    console.error('\n❌ 诊断失败:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

