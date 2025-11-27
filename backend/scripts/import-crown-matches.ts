import 'dotenv/config';
import { CrownApiClient } from '../src/services/crown-api-client';
import { nameAliasService } from '../src/services/name-alias-service';
import { crownMatchService } from '../src/services/crown-match-service';
import { parseStringPromise } from 'xml2js';

/**
 * 从皇冠抓取赛事并匹配到 iSports 别名库
 * - 抓取今日赛事 (showtype=today)
 * - 抓取早盘赛事 (showtype=early)
 * - 提取联赛和球队的简体中文名称
 * - 匹配到 iSports 别名库的 name_crown_zh_cn 字段
 * - 统计匹配率
 *
 * 运行示例：
 *   npm run aliases:import-crown
 */

function getArg(name: string, defaultValue?: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultValue;
}

const CROWN_USERNAME = process.env.CROWN_USERNAME || getArg('username') || '';
const CROWN_PASSWORD = process.env.CROWN_PASSWORD || getArg('password') || '';

if (!CROWN_USERNAME || !CROWN_PASSWORD) {
  console.error('❌ 缺少皇冠账号信息');
  console.error('   请设置环境变量: CROWN_USERNAME, CROWN_PASSWORD');
  console.error('   或使用参数: --username=xxx --password=xxx');
  process.exit(1);
}

interface CrownMatch {
  gid: string;
  league: string;
  home: string;
  away: string;
  datetime: string;
}

/**
 * 解析皇冠 XML 赛事列表
 */
async function parseCrownGameList(xml: string): Promise<CrownMatch[]> {
  try {
    // 打印 XML 前 1000 字符用于调试
    console.log('\n📄 XML 响应（前 1000 字符）:');
    console.log(xml.substring(0, 1000));

    const result = await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: false,
    });

    const matches: CrownMatch[] = [];
    const data = result.serverresponse || result;

    console.log('\n🔍 解析结果:');
    console.log('  - 是否有 ec:', !!data.ec);
    console.log('  - ec 类型:', Array.isArray(data.ec) ? 'array' : typeof data.ec);

    if (!data.ec) {
      console.log('⚠️  没有找到 ec 节点');
      return matches;
    }

    // ec 可能是单个对象或数组
    const ecList = Array.isArray(data.ec) ? data.ec : [data.ec];
    console.log('  - ec 数量:', ecList.length);

    for (const ec of ecList) {
      if (!ec.game) {
        console.log('  - 跳过没有 game 的 ec');
        continue;
      }

      const games = Array.isArray(ec.game) ? ec.game : [ec.game];

      console.log(`  - ec 节点, 比赛数: ${games.length}`);

      for (const game of games) {
        // 联赛名称在 game 节点的 LEAGUE 字段，不在 ec 节点
        const league = game.LEAGUE || game.$.LEAGUE || '';
        const gid = game.GID || game.$.GID || '';
        const home = game.TEAM_H || game.$.TEAM_H || '';
        const away = game.TEAM_C || game.$.TEAM_C || '';
        const datetime = game.DATETIME || game.$.DATETIME || '';

        matches.push({
          gid,
          league,
          home,
          away,
          datetime,
        });
      }
    }

    return matches;
  } catch (error: any) {
    console.error('❌ 解析 XML 失败:', error.message);
    console.error('   错误堆栈:', error.stack);
    return [];
  }
}

/**
 * 解析皇冠时间格式 "11-08 08:30a" 或 "11-08 08:30p"
 * 返回 ISO 格式字符串 "YYYY-MM-DD HH:mm:ss"
 */
function parseCrownDateTime(crownTime: string): string | undefined {
  try {
    if (!crownTime || crownTime.trim() === '') {
      return undefined;
    }

    // 格式: "11-08 08:30a" 或 "11-08 08:30p"
    const match = crownTime.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})([ap])$/i);
    if (!match) {
      console.warn(`无法解析时间格式: ${crownTime}`);
      return undefined;
    }

    const [, month, day, hour, minute, period] = match;

    // 获取当前年份和日期
    const now = new Date();
    let year = now.getFullYear();
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);

    // 构造今年的日期
    const matchDate = new Date(year, monthNum - 1, dayNum);

    // 如果比赛日期早于今天超过 30 天，认为是明年的比赛
    const diffDays = (matchDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < -30) {
      year += 1;
    }

    // 转换 12 小时制到 24 小时制
    let hourNum = parseInt(hour);
    if (period.toLowerCase() === 'p' && hourNum !== 12) {
      hourNum += 12;
    } else if (period.toLowerCase() === 'a' && hourNum === 12) {
      hourNum = 0;
    }

    // 格式化为 ISO 字符串
    const dateStr = `${year}-${monthNum.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')} ${hourNum.toString().padStart(2, '0')}:${minute}:00`;

    return dateStr;
  } catch (error) {
    console.error(`解析时间失败: ${crownTime}`, error);
    return undefined;
  }
}

/**
 * 计算字符串相似度（简单版本）
 */
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) {
    return 1.0;
  }

  // 包含关系得分更高
  if (longer.includes(shorter)) {
    return 0.8 + (shorter.length / longer.length) * 0.2;
  }

  // 计算编辑距离
  const editDistance = levenshteinDistance(s1, s2);
  return (longer.length - editDistance) / longer.length;
}

/**
 * 计算编辑距离
 */
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

/**
 * 匹配联赛名称（支持模糊匹配）
 * 优先使用 name_zh_cn（iSports 简体）匹配
 */
async function matchLeague(crownName: string): Promise<{ matched: boolean; id?: number; similarity?: number; method?: string }> {
  try {
    const allLeagues = await nameAliasService.getAllLeagues();

    // 1. 精确匹配 name_zh_cn（iSports 简体）
    for (const league of allLeagues) {
      if (league.name_zh_cn === crownName) {
        return { matched: true, id: league.id, similarity: 1.0, method: 'exact_zh_cn' };
      }
    }

    // 2. 精确匹配 name_crown_zh_cn（皇冠简体）
    for (const league of allLeagues) {
      if (league.name_crown_zh_cn === crownName) {
        return { matched: true, id: league.id, similarity: 1.0, method: 'exact_crown' };
      }
    }

    // 3. 通过别名精确匹配
    const result = await nameAliasService.resolveLeague(crownName);
    if (result && result.canonicalKey) {
      const league = await nameAliasService.getLeagueByKey(result.canonicalKey);
      if (league) {
        return { matched: true, id: league.id, similarity: 1.0, method: 'alias' };
      }
    }

    // 4. 模糊匹配（相似度 >= 0.7）
    let bestMatch: { league: any; score: number } | null = null;

    for (const league of allLeagues) {
      // 优先与 name_zh_cn 比较（iSports 简体）
      if (league.name_zh_cn) {
        const score = similarity(crownName, league.name_zh_cn);
        if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { league, score };
        }
      }

      // 与 name_crown_zh_cn 比较（皇冠简体）
      if (league.name_crown_zh_cn) {
        const score = similarity(crownName, league.name_crown_zh_cn);
        if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { league, score };
        }
      }

      // 与 name_zh_tw 比较（繁体）
      if (league.name_zh_tw) {
        const score = similarity(crownName, league.name_zh_tw);
        if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { league, score };
        }
      }
    }

    if (bestMatch) {
      return { matched: true, id: bestMatch.league.id, similarity: bestMatch.score, method: 'fuzzy' };
    }

    return { matched: false };
  } catch (error) {
    return { matched: false };
  }
}

/**
 * 匹配球队名称（支持模糊匹配）
 * 优先使用 name_zh_cn（iSports 简体）匹配
 */
async function matchTeam(crownName: string): Promise<{ matched: boolean; id?: number; similarity?: number; method?: string }> {
  try {
    const allTeams = await nameAliasService.getAllTeams();

    // 1. 精确匹配 name_zh_cn（iSports 简体）
    for (const team of allTeams) {
      if (team.name_zh_cn === crownName) {
        return { matched: true, id: team.id, similarity: 1.0, method: 'exact_zh_cn' };
      }
    }

    // 2. 精确匹配 name_crown_zh_cn（皇冠简体）
    for (const team of allTeams) {
      if (team.name_crown_zh_cn === crownName) {
        return { matched: true, id: team.id, similarity: 1.0, method: 'exact_crown' };
      }
    }

    // 3. 通过别名精确匹配
    const result = await nameAliasService.resolveTeam(crownName);
    if (result && result.canonicalKey) {
      const team = await nameAliasService.getTeamByKey(result.canonicalKey);
      if (team) {
        return { matched: true, id: team.id, similarity: 1.0, method: 'alias' };
      }
    }

    // 4. 模糊匹配（相似度 >= 0.75）
    let bestMatch: { team: any; score: number } | null = null;

    for (const team of allTeams) {
      // 优先与 name_zh_cn 比较（iSports 简体）
      if (team.name_zh_cn) {
        const score = similarity(crownName, team.name_zh_cn);
        if (score >= 0.75 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { team, score };
        }
      }

      // 与 name_crown_zh_cn 比较（皇冠简体）
      if (team.name_crown_zh_cn) {
        const score = similarity(crownName, team.name_crown_zh_cn);
        if (score >= 0.75 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { team, score };
        }
      }

      // 与 name_zh_tw 比较（繁体）
      if (team.name_zh_tw) {
        const score = similarity(crownName, team.name_zh_tw);
        if (score >= 0.75 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { team, score };
        }
      }
    }

    if (bestMatch) {
      return { matched: true, id: bestMatch.team.id, similarity: bestMatch.score, method: 'fuzzy' };
    }

    return { matched: false };
  } catch (error) {
    return { matched: false };
  }
}

async function main() {
  console.log('============================================================');
  console.log('🚀 从皇冠抓取早盘赛事并匹配到 iSports 别名库');
  console.log('============================================================');

  // 1. 登录皇冠
  console.log('\n🔐 登录皇冠...');
  const client = new CrownApiClient();

  try {
    const loginResult = await client.login(CROWN_USERNAME, CROWN_PASSWORD);

    // 检查登录是否成功（msg=100 或 status=success）
    if (loginResult.msg !== '100' && loginResult.status !== 'success') {
      console.error('❌ 登录失败:', loginResult);
      process.exit(1);
    }

    console.log('✅ 登录成功');
  } catch (error: any) {
    console.error('❌ 登录失败:', error.message);
    process.exit(1);
  }

  // 2. 获取今日赛事
  console.log('\n📥 获取今日赛事...');
  const todayXml = await client.getGameList({
    gtype: 'ft',        // 足球
    showtype: 'today',  // 今日
    rtype: 'r',         // 让球盘
    ltype: '3',
    sorttype: 'L',
    langx: 'zh-cn',     // 使用简体中文
  });

  const todayMatches = await parseCrownGameList(todayXml);
  console.log(`✅ 今日赛事: ${todayMatches.length} 场`);

  // 3. 获取早盘赛事
  console.log('\n📥 获取早盘赛事...');
  const earlyXml = await client.getGameList({
    gtype: 'ft',        // 足球
    showtype: 'early',  // 早盘
    rtype: 'r',         // 让球盘
    ltype: '3',
    sorttype: 'L',
    langx: 'zh-cn',     // 使用简体中文
  });

  const earlyMatches = await parseCrownGameList(earlyXml);
  console.log(`✅ 早盘赛事: ${earlyMatches.length} 场`);

  // 4. 合并所有赛事
  const matches = [...todayMatches, ...earlyMatches];
  console.log(`\n📊 总共获取到 ${matches.length} 场比赛 (今日: ${todayMatches.length}, 早盘: ${earlyMatches.length})`);

  // 调试：打印前 3 场比赛
  if (matches.length > 0) {
    console.log('\n📋 示例比赛（前 3 场）:');
    matches.slice(0, 3).forEach((m, i) => {
      console.log(`  [${i + 1}] ${m.league} | ${m.home} vs ${m.away} | ${m.datetime}`);
    });
  }

  if (matches.length === 0) {
    console.log('⚠️  没有找到赛事数据，结束');
    return;
  }

  // 3. 匹配并存储赛事数据
  console.log('\n📝 匹配并存储赛事数据...');
  let savedCount = 0;
  let fullyMatchedCount = 0;

  for (const match of matches) {
    // 匹配联赛
    const leagueMatch = await matchLeague(match.league);

    // 匹配主队
    const homeMatch = await matchTeam(match.home);

    // 匹配客队
    const awayMatch = await matchTeam(match.away);

    // 解析时间
    const parsedTime = parseCrownDateTime(match.datetime);

    // 调试日志
    if (savedCount < 3) {
      console.log(`\n调试第 ${savedCount + 1} 场比赛:`);
      console.log(`  GID: ${match.gid}`);
      console.log(`  联赛: ${match.league}`);
      console.log(`  主队: ${match.home}`);
      console.log(`  客队: ${match.away}`);
      console.log(`  原始时间: ${match.datetime}`);
      console.log(`  解析时间: ${parsedTime}`);
    }

    try {
      // 存储到数据库
      await crownMatchService.upsertMatch({
        crownGid: match.gid,
        crownLeague: match.league,
        crownHome: match.home,
        crownAway: match.away,
        matchTime: parsedTime,
        leagueMatched: leagueMatch.matched,
        homeMatched: homeMatch.matched,
        awayMatched: awayMatch.matched,
        leagueAliasId: leagueMatch.id,
        homeAliasId: homeMatch.id,
        awayAliasId: awayMatch.id,
        leagueMatchMethod: leagueMatch.method,
        homeMatchMethod: homeMatch.method,
        awayMatchMethod: awayMatch.method,
      });
    } catch (error) {
      console.error(`❌ 存储比赛失败 (GID: ${match.gid}):`, error);
      continue;
    }

    savedCount++;

    // 如果联赛、主队、客队都匹配成功，则更新别名表的 name_crown_zh_cn
    if (leagueMatch.matched && leagueMatch.id) {
      try {
        await nameAliasService.updateLeagueAlias(leagueMatch.id, {
          nameCrownZhCn: match.league,
        });
      } catch (e) {
        // 忽略错误
      }
    }

    if (homeMatch.matched && homeMatch.id) {
      try {
        await nameAliasService.updateTeamAlias(homeMatch.id, {
          nameCrownZhCn: match.home,
        });
      } catch (e) {
        // 忽略错误
      }
    }

    if (awayMatch.matched && awayMatch.id) {
      try {
        await nameAliasService.updateTeamAlias(awayMatch.id, {
          nameCrownZhCn: match.away,
        });
      } catch (e) {
        // 忽略错误
      }
    }

    if (leagueMatch.matched && homeMatch.matched && awayMatch.matched) {
      fullyMatchedCount++;
    }

    // 每 50 场显示一次进度
    if (savedCount % 50 === 0) {
      console.log(`   已处理 ${savedCount}/${matches.length} 场比赛...`);
    }
  }

  console.log(`✅ 已保存 ${savedCount} 场比赛到数据库`);

  // 4. 获取匹配统计
  console.log('\n📊 获取匹配统计...');
  const stats = await crownMatchService.getMatchStats();

  // 5. 显示统计结果
  console.log('\n============================================================');
  console.log('✅ 导入完成！');
  console.log('📊 匹配统计（以皇冠为基准）：');
  console.log(`   - 总比赛数: ${stats.total_matches} 场`);
  console.log(`   - 联赛匹配: ${stats.league_matched} 个 (${stats.league_match_rate.toFixed(1)}%)`);
  console.log(`   - 主队匹配: ${stats.home_matched} 个 (${stats.home_match_rate.toFixed(1)}%)`);
  console.log(`   - 客队匹配: ${stats.away_matched} 个 (${stats.away_match_rate.toFixed(1)}%)`);
  console.log(`   - 完全匹配: ${stats.fully_matched} 场 (${stats.full_match_rate.toFixed(1)}%)`);
  console.log('   （完全匹配 = 联赛、主队、客队都匹配成功）');

  // 6. 显示未匹配的联赛和球队
  const unmatchedLeagues = await crownMatchService.getUnmatchedLeagues(20);
  const unmatchedTeams = await crownMatchService.getUnmatchedTeams(20);

  if (unmatchedLeagues.length > 0) {
    console.log(`\n⚠️  未匹配的联赛（前 20 个）:`);
    unmatchedLeagues.forEach((name) => console.log(`   - ${name}`));
  }

  if (unmatchedTeams.length > 0) {
    console.log(`\n⚠️  未匹配的球队（前 20 个）:`);
    unmatchedTeams.forEach((name) => console.log(`   - ${name}`));
  }

  console.log('\n💡 提示：未匹配的联赛/球队可能是 iSports 没有的数据');
  console.log('💡 提示：可以在页面上手动添加或等待 iSports 导入脚本更新');
  console.log('💡 提示：运行 npm run aliases:export-en 导出未翻译的记录进行翻译');
}

main().catch((err) => {
  console.error('❌ 执行失败:', err?.message || err);
  process.exit(1);
});

