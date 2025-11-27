import 'dotenv/config';
import fs from 'fs';
import path from 'path';

/**
 * 列出所有联赛和比赛
 */

async function main() {
  console.log('============================================================');
  console.log('📋 列出所有联赛和比赛');
  console.log('============================================================\n');

  // 读取皇冠数据
  const crownGidsPath = path.resolve(process.cwd(), 'crown-gids.json');
  
  if (!fs.existsSync(crownGidsPath)) {
    console.log('❌ crown-gids.json 不存在，请先运行: npm run crown:fetch-gids');
    process.exit(1);
  }

  const crownData = JSON.parse(fs.readFileSync(crownGidsPath, 'utf-8'));
  const matches = crownData.matches || [];

  // 按联赛分组
  const leagueGroups: { [key: string]: any[] } = {};

  matches.forEach((match: any) => {
    const league = match.league || '未知联赛';
    if (!leagueGroups[league]) {
      leagueGroups[league] = [];
    }
    leagueGroups[league].push(match);
  });

  // 排序并显示
  const sortedLeagues = Object.entries(leagueGroups)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`📊 共有 ${sortedLeagues.length} 个联赛，${matches.length} 场比赛\n`);
  console.log('============================================================\n');

  sortedLeagues.forEach(([league, matches], index) => {
    console.log(`${index + 1}. ${league} (${matches.length} 场)`);
    
    // 显示前3场比赛
    matches.slice(0, 3).forEach((match: any) => {
      console.log(`   - ${match.home} vs ${match.away} (${match.datetime})`);
    });
    
    if (matches.length > 3) {
      console.log(`   ... 还有 ${matches.length - 3} 场\n`);
    } else {
      console.log('');
    }
  });

  console.log('============================================================');
  console.log('✅ 列表完成');
  console.log('============================================================\n');

  // 保存联赛列表
  const outputPath = path.resolve(process.cwd(), 'leagues-list.txt');
  const output = sortedLeagues.map(([league, matches]) => {
    return `${league} (${matches.length} 场)\n` +
      matches.map((m: any) => `  - ${m.home} vs ${m.away} (${m.datetime})`).join('\n');
  }).join('\n\n');

  fs.writeFileSync(outputPath, output);
  console.log(`📄 详细列表已保存到: ${outputPath}\n`);
}

main().catch((error) => {
  console.error('❌ 列表失败:', error);
  process.exit(1);
});

