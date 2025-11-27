#!/usr/bin/env ts-node
/**
 * 清理重复的名称映射数据
 * 
 * 规则：
 * - 如果多条记录的 name_en 相同
 * - 保留有 name_zh_cn 的记录
 * - 删除没有 name_zh_cn 的记录
 * - 如果都有或都没有 name_zh_cn，保留 id 最小的（最早创建的）
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'bclogin_system',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

console.log(`📊 数据库连接信息:`);
console.log(`   Host: ${process.env.DB_HOST || 'localhost'}`);
console.log(`   Port: ${process.env.DB_PORT || '5432'}`);
console.log(`   Database: ${process.env.DB_NAME || 'bclogin_system'}`);
console.log(`   User: ${process.env.DB_USER || 'postgres'}`);
console.log(``);

interface DuplicateGroup {
  name_en: string;
  count: number;
  ids: number[];
  has_zh_cn: boolean[];
  zh_cn_values: (string | null)[];
}

async function findDuplicates(tableName: 'league_aliases' | 'team_aliases'): Promise<DuplicateGroup[]> {
  const query = `
    SELECT 
      name_en,
      COUNT(*) as count,
      ARRAY_AGG(id ORDER BY id) as ids,
      ARRAY_AGG(CASE WHEN name_zh_cn IS NOT NULL AND name_zh_cn != '' THEN true ELSE false END ORDER BY id) as has_zh_cn,
      ARRAY_AGG(name_zh_cn ORDER BY id) as zh_cn_values
    FROM ${tableName}
    WHERE name_en IS NOT NULL AND name_en != ''
    GROUP BY name_en
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, name_en
  `;

  const result = await pool.query(query);
  return result.rows;
}

async function cleanupDuplicates(tableName: 'league_aliases' | 'team_aliases', dryRun: boolean = true): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 检查表: ${tableName}`);
  console.log(`${'='.repeat(80)}\n`);

  const duplicates = await findDuplicates(tableName);

  if (duplicates.length === 0) {
    console.log(`✅ 没有发现重复数据\n`);
    return;
  }

  console.log(`⚠️  发现 ${duplicates.length} 组重复数据\n`);

  let totalToDelete = 0;
  const deleteIds: number[] = [];

  for (const group of duplicates) {
    console.log(`\n📋 英文名: "${group.name_en}"`);
    console.log(`   重复数量: ${group.count}`);
    console.log(`   记录详情:`);

    // 找出要保留的记录
    let keepId: number | null = null;

    // 优先保留有 name_zh_cn 的记录
    const withZhCnIndex = group.has_zh_cn.findIndex(has => has === true);
    if (withZhCnIndex !== -1) {
      keepId = group.ids[withZhCnIndex];
      console.log(`   ✅ 保留: ID=${keepId} (有简体中文: "${group.zh_cn_values[withZhCnIndex]}")`);
    } else {
      // 如果都没有 name_zh_cn，保留 id 最小的
      keepId = group.ids[0];
      console.log(`   ✅ 保留: ID=${keepId} (最早创建，但无简体中文)`);
    }

    // 标记要删除的记录
    for (let i = 0; i < group.ids.length; i++) {
      const id = group.ids[i];
      if (id !== keepId) {
        const zhCn = group.zh_cn_values[i];
        console.log(`   ❌ 删除: ID=${id} (简体中文: ${zhCn ? `"${zhCn}"` : '无'})`);
        deleteIds.push(id);
        totalToDelete++;
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 统计:`);
  console.log(`   - 重复组数: ${duplicates.length}`);
  console.log(`   - 待删除记录数: ${totalToDelete}`);
  console.log(`${'='.repeat(80)}\n`);

  if (deleteIds.length === 0) {
    console.log(`✅ 没有需要删除的记录\n`);
    return;
  }

  if (dryRun) {
    console.log(`🔍 这是预览模式，不会实际删除数据`);
    console.log(`   如需实际删除，请运行: npm run cleanup:aliases:execute\n`);
  } else {
    console.log(`⚠️  准备删除 ${deleteIds.length} 条记录...`);
    console.log(`   待删除的 ID: ${deleteIds.join(', ')}\n`);

    // 确认删除
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('❓ 确认删除这些记录吗？(yes/no): ', (answer: string) => {
        rl.close();
        resolve(answer);
      });
    });

    if (answer.toLowerCase() !== 'yes') {
      console.log(`\n❌ 已取消删除操作\n`);
      return;
    }

    // 执行删除
    const deleteQuery = `DELETE FROM ${tableName} WHERE id = ANY($1)`;
    const result = await pool.query(deleteQuery, [deleteIds]);

    console.log(`\n✅ 删除完成！`);
    console.log(`   实际删除记录数: ${result.rowCount}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧹 清理重复的名称映射数据`);
  console.log(`${'='.repeat(80)}`);
  console.log(`\n模式: ${dryRun ? '🔍 预览模式（不会删除数据）' : '⚠️  执行模式（会实际删除数据）'}\n`);

  try {
    // 清理联赛表
    await cleanupDuplicates('league_aliases', dryRun);

    // 清理球队表
    await cleanupDuplicates('team_aliases', dryRun);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ 清理完成！`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error(`\n❌ 错误:`, error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

