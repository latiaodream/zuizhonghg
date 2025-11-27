import XLSX from 'xlsx';
import { nameAliasService } from './name-alias-service';

/**
 * 相似度计算（Levenshtein 距离）
 */
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  if (longer.includes(shorter)) {
    return 0.8 + (shorter.length / longer.length) * 0.2;
  }
  
  const editDistance = levenshteinDistance(s1, s2);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(s1: string, s2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
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

  return matrix[s2.length][s1.length];
}

export interface ImportResult {
  success: boolean;
  type: 'league' | 'team';
  updated: number;
  skipped: number;
  notFound: number;
  total: number;
  errors: string[];
}

/**
 * 从 Excel 文件导入联赛翻译
 */
export async function importLeaguesFromExcel(filePath: string): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    type: 'league',
    updated: 0,
    skipped: 0,
    notFound: 0,
    total: 0,
    errors: [],
  };

  try {
    // 读取 Excel 文件
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    if (rawData.length === 0) {
      result.errors.push('Excel 文件为空');
      return result;
    }

    // 获取所有联赛
    const allLeagues = await nameAliasService.getAllLeagues();
    result.total = rawData.length;

    // 遍历每一行
    for (const row of rawData) {
      if (!row || row.length < 2) {
        result.skipped++;
        continue;
      }

      const englishName = row[0];
      const chineseName = row[1];

      if (!englishName || !chineseName) {
        result.skipped++;
        continue;
      }

      const englishNameTrimmed = String(englishName).trim();

      // 多策略匹配联赛
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
          result.updated++;
        } catch (error: any) {
          result.errors.push(`更新联赛 ${league.id} (${englishName}) 失败: ${error.message}`);
        }
      } else {
        result.notFound++;
      }
    }

    result.success = true;
    return result;

  } catch (error: any) {
    result.errors.push(`导入失败: ${error.message}`);
    return result;
  }
}

/**
 * 从 Excel 文件导入球队翻译
 */
export async function importTeamsFromExcel(filePath: string): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    type: 'team',
    updated: 0,
    skipped: 0,
    notFound: 0,
    total: 0,
    errors: [],
  };

  try {
    // 读取 Excel 文件
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    if (rawData.length === 0) {
      result.errors.push('Excel 文件为空');
      return result;
    }

    // 获取所有球队
    const allTeams = await nameAliasService.getAllTeams();
    result.total = rawData.length;

    // 遍历每一行
    for (const row of rawData) {
      if (!row || row.length < 2) {
        result.skipped++;
        continue;
      }

      const englishName = row[0];
      const chineseName = row[1];

      if (!englishName || !chineseName) {
        result.skipped++;
        continue;
      }

      const englishNameTrimmed = String(englishName).trim();

      // 多策略匹配球队
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
          result.updated++;
        } catch (error: any) {
          result.errors.push(`更新球队 ${team.id} (${englishName}) 失败: ${error.message}`);
        }
      } else {
        result.notFound++;
      }
    }

    result.success = true;
    return result;

  } catch (error: any) {
    result.errors.push(`导入失败: ${error.message}`);
    return result;
  }
}

