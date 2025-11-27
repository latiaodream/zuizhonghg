/**
 * 导入翻译后的简体中文名称
 * 从 CSV 文件读取并更新数据库
 */

import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { nameAliasService } from '../src/services/name-alias-service';

interface LeagueRow {
  ID: string;
  'Canonical Key': string;
  'English Name': string;
  'Traditional Chinese (iSports)': string;
  'Simplified Chinese (Crown)': string;
}

interface TeamRow {
  ID: string;
  'Canonical Key': string;
  'English Name': string;
  'Traditional Chinese (iSports)': string;
  'Simplified Chinese (Crown)': string;
}

async function importLeagues() {
  const filePath = path.join(__dirname, '../../exports/leagues-en.csv');
  
  if (!fs.existsSync(filePath)) {
    console.log('⚠️  联赛文件不存在，跳过');
    return 0;
  }

  const rows: LeagueRow[] = [];
  
  return new Promise<number>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: LeagueRow) => {
        rows.push(row);
      })
      .on('end', async () => {
        console.log(`📋 读取到 ${rows.length} 条联赛记录`);
        
        let updated = 0;
        for (const row of rows) {
          const id = parseInt(row.ID);
          const crownName = row['Simplified Chinese (Crown)'];
          
          // 只更新有简体中文的记录
          if (crownName && crownName.trim() !== '') {
            try {
              await nameAliasService.updateLeagueAlias(id, {
                nameCrownZhCn: crownName.trim(),
              });
              updated++;
            } catch (error) {
              console.error(`❌ 更新联赛 ${id} 失败:`, error);
            }
          }
        }
        
        console.log(`✅ 更新了 ${updated} 个联赛\n`);
        resolve(updated);
      })
      .on('error', reject);
  });
}

async function importTeams() {
  const filePath = path.join(__dirname, '../../exports/teams-en.csv');
  
  if (!fs.existsSync(filePath)) {
    console.log('⚠️  球队文件不存在，跳过');
    return 0;
  }

  const rows: TeamRow[] = [];
  
  return new Promise<number>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row: TeamRow) => {
        rows.push(row);
      })
      .on('end', async () => {
        console.log(`📋 读取到 ${rows.length} 条球队记录`);
        
        let updated = 0;
        for (const row of rows) {
          const id = parseInt(row.ID);
          const crownName = row['Simplified Chinese (Crown)'];
          
          // 只更新有简体中文的记录
          if (crownName && crownName.trim() !== '') {
            try {
              await nameAliasService.updateTeamAlias(id, {
                nameCrownZhCn: crownName.trim(),
              });
              updated++;
            } catch (error) {
              console.error(`❌ 更新球队 ${id} 失败:`, error);
            }
          }
        }
        
        console.log(`✅ 更新了 ${updated} 个球队\n`);
        resolve(updated);
      })
      .on('error', reject);
  });
}

async function importTranslations() {
  console.log('============================================================');
  console.log('📥 导入翻译后的简体中文名称');
  console.log('============================================================\n');

  const leagueCount = await importLeagues();
  const teamCount = await importTeams();

  console.log('============================================================');
  console.log('✅ 导入完成！');
  console.log('📊 统计：');
  console.log(`   - 联赛: ${leagueCount} 个`);
  console.log(`   - 球队: ${teamCount} 个`);
  console.log('\n💡 下一步：');
  console.log('   1. 重新运行皇冠导入脚本进行匹配');
  console.log('   2. 查看匹配率是否提升');
  console.log('============================================================');

  process.exit(0);
}

importTranslations().catch((error) => {
  console.error('❌ 导入失败:', error);
  process.exit(1);
});

