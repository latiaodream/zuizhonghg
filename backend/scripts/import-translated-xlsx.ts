/**
 * 从 Excel 文件导入翻译后的简体中文名称
 * 支持 .xlsx 和 .xls 格式
 */

import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { nameAliasService } from '../src/services/name-alias-service';

// 计算两个字符串的相似度（0-1之间）
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  // 如果一个字符串包含另一个，给予较高分数
  if (longer.includes(shorter)) {
    return 0.8 + (shorter.length / longer.length) * 0.2;
  }

  const editDistance = levenshteinDistance(s1, s2);
  return (longer.length - editDistance) / longer.length;
}

// 计算编辑距离
function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[len1][len2];
}

interface ExcelRow {
  ID?: number;
  'Canonical Key'?: string;
  'English Name'?: string;
  'Traditional Chinese (iSports)'?: string;
  'Simplified Chinese (Crown)'?: string;
  // 支持简化格式：只有英文和简体中文两列
  [key: string]: any;
}

async function importLeaguesFromExcel(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    console.log('⚠️  联赛文件不存在，跳过');
    return 0;
  }

  console.log(`📋 读取联赛文件: ${filePath}`);

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // 直接使用 header: 1 读取原始数据（不使用第一行作为表头）
  const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // 过滤掉空行
  const filteredData = rawData.filter(row => row && row[0] && row[1]);

  // 转换为对象数组
  const rows: ExcelRow[] = filteredData.map(row => ({
    col0: row[0],
    col1: row[1],
  }));

  const columnNames = ['col0', 'col1'];

  console.log(`📋 读取到 ${rows.length} 条联赛记录`);
  console.log(`📋 列格式: 第一列=英文, 第二列=简体中文`);

  // 判断是简化格式（两列）还是完整格式（五列）
  const isSimpleFormat = columnNames.length === 2;

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  if (isSimpleFormat) {
    console.log('📋 使用简化格式（英文 -> 简体中文）匹配\n');

    // 简化格式：第一列是英文，第二列是简体中文
    const enColumn = columnNames[0];
    const zhColumn = columnNames[1];

    console.log(`📋 英文列名: "${enColumn}"`);
    console.log(`📋 中文列名: "${zhColumn}"`);
    console.log(`📋 示例数据（前 3 条）:`);
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      console.log(`   [${i + 1}] ${rows[i][enColumn]} -> ${rows[i][zhColumn]}`);
    }
    console.log('');

    // 先获取所有联赛
    const allLeagues = await nameAliasService.getAllLeagues();
    console.log(`📋 数据库中共有 ${allLeagues.length} 个联赛\n`);

    for (const row of rows) {
      const englishName = row[enColumn];
      const chineseName = row[zhColumn];

      if (!englishName || !chineseName || String(chineseName).trim() === '') {
        skipped++;
        continue;
      }

      // 多策略匹配联赛
      const englishNameTrimmed = String(englishName).trim();

      // 策略1: 精确匹配 name_en
      let league = allLeagues.find(l =>
        l.name_en && l.name_en.trim().toLowerCase() === englishNameTrimmed.toLowerCase()
      );

      // 策略2: 通过 canonical_key 匹配
      if (!league) {
        const canonicalKey = nameAliasService.normalizeKey('league', englishNameTrimmed);
        league = allLeagues.find(l => l.canonical_key === canonicalKey);
      }

      // 策略3: 模糊匹配（去除特殊字符后比较）
      if (!league) {
        const normalized = englishNameTrimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
        league = allLeagues.find(l => {
          if (!l.name_en) return false;
          const dbNormalized = l.name_en.toLowerCase().replace(/[^a-z0-9]/g, '');
          return dbNormalized === normalized;
        });
      }

      // 策略4: 相似度匹配（阈值 0.8）
      if (!league) {
        const normalizedSearch = englishNameTrimmed.toLowerCase();
        let bestMatch: { league: any; score: number } | null = null;

        for (const l of allLeagues) {
          if (!l.name_en) continue;
          const normalizedDb = l.name_en.toLowerCase();
          const score = similarity(normalizedSearch, normalizedDb);

          if (score >= 0.8 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { league: l, score };
          }
        }

        if (bestMatch) {
          league = bestMatch.league;
        }
      }

      if (league) {
        try {
          await nameAliasService.updateLeagueAlias(league.id, {
            nameZhCn: String(chineseName).trim(),
          });
          updated++;
          if (updated % 10 === 0) {
            console.log(`   已更新 ${updated} 个联赛...`);
          }
        } catch (error) {
          console.error(`❌ 更新联赛 ${league.id} (${englishName}) 失败:`, error);
        }
      } else {
        notFound++;
        if (notFound <= 5) {
          console.log(`⚠️  未找到英文名称: "${englishNameTrimmed}"`);
        }
      }
    }

    if (notFound > 5) {
      console.log(`⚠️  还有 ${notFound - 5} 个未找到的联赛未显示`);
    }
  } else {
    console.log('📋 使用完整格式（ID -> 简体中文）匹配\n');

    // 完整格式：使用 ID 直接更新
    for (const row of rows) {
      const id = typeof row.ID === 'number' ? row.ID : parseInt(String(row.ID));
      const crownName = row['Simplified Chinese (Crown)'];

      if (crownName && String(crownName).trim() !== '') {
        try {
          await nameAliasService.updateLeagueAlias(id, {
            nameCrownZhCn: String(crownName).trim(),
          });
          updated++;
          if (updated % 10 === 0) {
            console.log(`   已更新 ${updated} 个联赛...`);
          }
        } catch (error) {
          console.error(`❌ 更新联赛 ${id} 失败:`, error);
        }
      } else {
        skipped++;
      }
    }
  }

  console.log(`✅ 联赛更新完成: ${updated} 个，跳过: ${skipped} 个${notFound > 0 ? `，未找到: ${notFound} 个` : ''}\n`);
  return updated;
}

async function importTeamsFromExcel(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    console.log('⚠️  球队文件不存在，跳过');
    return 0;
  }

  console.log(`📋 读取球队文件: ${filePath}`);

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // 尝试两种读取方式
  let rows: ExcelRow[] = XLSX.utils.sheet_to_json(worksheet);
  let columnNames = Object.keys(rows[0] || {});

  // 检测是否第一行是数据而不是表头
  const firstColumnName = columnNames[0] || '';
  const hasNoHeader = /[\u4e00-\u9fa5]/.test(firstColumnName) || firstColumnName.length > 50;

  if (hasNoHeader) {
    console.log('📋 检测到无表头格式，使用 header: 1 重新读取');
    // 重新读取，不使用第一行作为表头
    const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    // 转换为对象数组，使用索引作为键
    rows = rawData.map(row => ({
      col0: row[0],
      col1: row[1],
    }));
    columnNames = ['col0', 'col1'];
  }

  console.log(`📋 读取到 ${rows.length} 条球队记录`);
  console.log(`📋 检测到的列名: ${columnNames.join(', ')}`);

  // 判断是简化格式（两列）还是完整格式（五列）
  const isSimpleFormat = columnNames.length === 2;

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  if (isSimpleFormat) {
    console.log('📋 使用简化格式（英文 -> 简体中文）匹配\n');

    // 简化格式：第一列是英文，第二列是简体中文
    const enColumn = columnNames[0];
    const zhColumn = columnNames[1];

    console.log(`📋 英文列名: "${enColumn}"`);
    console.log(`📋 中文列名: "${zhColumn}"`);
    console.log(`📋 示例数据（前 3 条）:`);
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      console.log(`   [${i + 1}] ${rows[i][enColumn]} -> ${rows[i][zhColumn]}`);
    }
    console.log('');

    // 先获取所有球队
    const allTeams = await nameAliasService.getAllTeams();
    console.log(`📋 数据库中共有 ${allTeams.length} 个球队\n`);

    for (const row of rows) {
      const englishName = row[enColumn];
      const chineseName = row[zhColumn];

      if (!englishName || !chineseName || String(chineseName).trim() === '') {
        skipped++;
        continue;
      }

      // 多策略匹配球队
      const englishNameTrimmed = String(englishName).trim();

      // 策略1: 精确匹配 name_en
      let team = allTeams.find(t =>
        t.name_en && t.name_en.trim().toLowerCase() === englishNameTrimmed.toLowerCase()
      );

      // 策略2: 通过 canonical_key 匹配
      if (!team) {
        const canonicalKey = nameAliasService.normalizeKey('team', englishNameTrimmed);
        team = allTeams.find(t => t.canonical_key === canonicalKey);
      }

      // 策略3: 模糊匹配（去除特殊字符后比较）
      if (!team) {
        const normalized = englishNameTrimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
        team = allTeams.find(t => {
          if (!t.name_en) return false;
          const dbNormalized = t.name_en.toLowerCase().replace(/[^a-z0-9]/g, '');
          return dbNormalized === normalized;
        });
      }

      // 策略4: 相似度匹配（阈值 0.85，球队名称要求更严格）
      if (!team) {
        const normalizedSearch = englishNameTrimmed.toLowerCase();
        let bestMatch: { team: any; score: number } | null = null;

        for (const t of allTeams) {
          if (!t.name_en) continue;
          const normalizedDb = t.name_en.toLowerCase();
          const score = similarity(normalizedSearch, normalizedDb);

          if (score >= 0.85 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { team: t, score };
          }
        }

        if (bestMatch) {
          team = bestMatch.team;
        }
      }

      if (team) {
        try {
          await nameAliasService.updateTeamAlias(team.id, {
            nameZhCn: String(chineseName).trim(),
          });
          updated++;
          if (updated % 50 === 0) {
            console.log(`   已更新 ${updated} 个球队...`);
          }
        } catch (error) {
          console.error(`❌ 更新球队 ${team.id} (${englishName}) 失败:`, error);
        }
      } else {
        notFound++;
        if (notFound <= 10) {
          console.log(`⚠️  未找到英文名称: "${englishNameTrimmed}"`);
        }
      }
    }

    if (notFound > 10) {
      console.log(`⚠️  还有 ${notFound - 10} 个未找到的球队未显示`);
    }
  } else {
    console.log('📋 使用完整格式（ID -> 简体中文）匹配\n');

    // 完整格式：使用 ID 直接更新
    for (const row of rows) {
      const id = typeof row.ID === 'number' ? row.ID : parseInt(String(row.ID));
      const crownName = row['Simplified Chinese (Crown)'];

      if (crownName && String(crownName).trim() !== '') {
        try {
          await nameAliasService.updateTeamAlias(id, {
            nameCrownZhCn: String(crownName).trim(),
          });
          updated++;
          if (updated % 50 === 0) {
            console.log(`   已更新 ${updated} 个球队...`);
          }
        } catch (error) {
          console.error(`❌ 更新球队 ${id} 失败:`, error);
        }
      } else {
        skipped++;
      }
    }
  }

  console.log(`✅ 球队更新完成: ${updated} 个，跳过: ${skipped} 个${notFound > 0 ? `，未找到: ${notFound} 个` : ''}\n`);
  return updated;
}

async function importTranslations() {
  console.log('============================================================');
  console.log('📥 从 Excel 导入翻译后的简体中文名称');
  console.log('============================================================\n');

  const leaguesPath = path.join(__dirname, '../../exports/leagues-en.xlsx');
  const teamsPath = path.join(__dirname, '../../exports/teams-en.xlsx');

  // 也支持 .csv 文件（如果用户保存为 CSV）
  const leaguesCsvPath = path.join(__dirname, '../../exports/leagues-en.csv');
  const teamsCsvPath = path.join(__dirname, '../../exports/teams-en.csv');

  let leagueCount = 0;
  let teamCount = 0;

  // 优先使用 Excel 文件
  if (fs.existsSync(leaguesPath)) {
    leagueCount = await importLeaguesFromExcel(leaguesPath);
  } else if (fs.existsSync(leaguesCsvPath)) {
    console.log('⚠️  未找到 leagues-en.xlsx，尝试使用 leagues-en.csv');
    // 这里可以调用原来的 CSV 导入逻辑
  } else {
    console.log('⚠️  未找到联赛文件（xlsx 或 csv）');
  }

  if (fs.existsSync(teamsPath)) {
    teamCount = await importTeamsFromExcel(teamsPath);
  } else if (fs.existsSync(teamsCsvPath)) {
    console.log('⚠️  未找到 teams-en.xlsx，尝试使用 teams-en.csv');
    // 这里可以调用原来的 CSV 导入逻辑
  } else {
    console.log('⚠️  未找到球队文件（xlsx 或 csv）');
  }

  console.log('============================================================');
  console.log('✅ 导入完成！');
  console.log('📊 统计：');
  console.log(`   - 联赛: ${leagueCount} 个`);
  console.log(`   - 球队: ${teamCount} 个`);
  console.log('\n💡 下一步：');
  console.log('   1. 重新运行皇冠导入脚本进行匹配');
  console.log('   2. 查看匹配率是否提升');
  console.log('\n📝 命令：');
  console.log('   CROWN_USERNAME=WjeLaA68i0 CROWN_PASSWORD=I0FQsaTFFUHg npm run aliases:import-crown');
  console.log('============================================================');

  process.exit(0);
}

importTranslations().catch((error) => {
  console.error('❌ 导入失败:', error);
  process.exit(1);
});

