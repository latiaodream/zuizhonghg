/**
 * 导出 iSports 联赛和球队的英文名称到 CSV
 * 用于通过 ChatGPT 翻译成简体中文
 */

import { createObjectCsvWriter } from 'csv-writer';
import path from 'path';
import { nameAliasService } from '../src/services/name-alias-service';
import type { LeagueAlias, TeamAlias } from '../src/types';

async function exportToCSV() {
  console.log('============================================================');
  console.log('📤 导出 iSports 联赛和球队英文名称');
  console.log('============================================================\n');

  // 1. 导出联赛
  console.log('📋 导出联赛...');
  const leagues: LeagueAlias[] = await nameAliasService.getAllLeagues();

  // 过滤出有英文名称的联赛
  const leaguesWithEn = leagues.filter((l: LeagueAlias) => l.name_en && l.name_en.trim() !== '');

  console.log(`✅ 找到 ${leaguesWithEn.length} 个有英文名称的联赛`);

  const leagueCsvWriter = createObjectCsvWriter({
    path: path.join(__dirname, '../../exports/leagues-en.csv'),
    header: [
      { id: 'id', title: 'ID' },
      { id: 'canonical_key', title: 'Canonical Key' },
      { id: 'name_en', title: 'English Name' },
      { id: 'name_zh_tw', title: 'Traditional Chinese (iSports)' },
      { id: 'name_crown_zh_cn', title: 'Simplified Chinese (Crown)' },
    ],
    encoding: 'utf8',
  });

  await leagueCsvWriter.writeRecords(
    leaguesWithEn.map((l: LeagueAlias) => ({
      id: l.id,
      canonical_key: l.canonical_key,
      name_en: l.name_en || '',
      name_zh_tw: l.name_zh_tw || '',
      name_crown_zh_cn: l.name_crown_zh_cn || '',
    }))
  );

  console.log(`✅ 联赛已导出到: exports/leagues-en.csv\n`);

  // 2. 导出球队
  console.log('📋 导出球队...');
  const teams: TeamAlias[] = await nameAliasService.getAllTeams();

  // 过滤出有英文名称的球队
  const teamsWithEn = teams.filter((t: TeamAlias) => t.name_en && t.name_en.trim() !== '');

  console.log(`✅ 找到 ${teamsWithEn.length} 个有英文名称的球队`);

  const teamCsvWriter = createObjectCsvWriter({
    path: path.join(__dirname, '../../exports/teams-en.csv'),
    header: [
      { id: 'id', title: 'ID' },
      { id: 'canonical_key', title: 'Canonical Key' },
      { id: 'name_en', title: 'English Name' },
      { id: 'name_zh_tw', title: 'Traditional Chinese (iSports)' },
      { id: 'name_crown_zh_cn', title: 'Simplified Chinese (Crown)' },
    ],
    encoding: 'utf8',
  });

  await teamCsvWriter.writeRecords(
    teamsWithEn.map((t: TeamAlias) => ({
      id: t.id,
      canonical_key: t.canonical_key,
      name_en: t.name_en || '',
      name_zh_tw: t.name_zh_tw || '',
      name_crown_zh_cn: t.name_crown_zh_cn || '',
    }))
  );

  console.log(`✅ 球队已导出到: exports/teams-en.csv\n`);

  console.log('============================================================');
  console.log('✅ 导出完成！');
  console.log('📊 统计：');
  console.log(`   - 联赛: ${leaguesWithEn.length} 个`);
  console.log(`   - 球队: ${teamsWithEn.length} 个`);
  console.log('\n💡 下一步：');
  console.log('   1. 打开 exports/leagues-en.csv 和 exports/teams-en.csv');
  console.log('   2. 复制 "English Name" 列到 ChatGPT');
  console.log('   3. 让 ChatGPT 翻译成简体中文');
  console.log('   4. 将翻译结果填入 "Simplified Chinese (Crown)" 列');
  console.log('   5. 使用导入脚本更新数据库');
  console.log('============================================================');

  process.exit(0);
}

exportToCSV().catch((error) => {
  console.error('❌ 导出失败:', error);
  process.exit(1);
});

