import 'dotenv/config';
import fs from 'fs';
import path from 'path';

/**
 * 诊断 iSports 数据问题
 * 分析为什么 iSports 数据这么少
 */

async function main() {
  console.log('============================================================');
  console.log('🔍 诊断 iSports 数据问题');
  console.log('============================================================\n');

  // 1. 检查 fetcher-isports 的数据文件
  const fetcherDataDir = path.resolve(process.cwd(), '../fetcher-isports/data');
  
  console.log('📂 检查 fetcher-isports 数据目录:\n');
  
  if (!fs.existsSync(fetcherDataDir)) {
    console.log('❌ fetcher-isports/data 目录不存在\n');
    return;
  }

  const files = fs.readdirSync(fetcherDataDir);
  console.log(`找到 ${files.length} 个文件:\n`);
  
  files.forEach(file => {
    const filePath = path.join(fetcherDataDir, file);
    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    const mtime = stats.mtime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`  - ${file}`);
    console.log(`    大小: ${sizeKB} KB`);
    console.log(`    修改时间: ${mtime}\n`);
  });

  // 2. 分析 latest-matches.json
  console.log('============================================================');
  console.log('📊 分析 latest-matches.json');
  console.log('============================================================\n');

  const latestMatchesPath = path.join(fetcherDataDir, 'latest-matches.json');
  
  if (!fs.existsSync(latestMatchesPath)) {
    console.log('❌ latest-matches.json 不存在\n');
    return;
  }

  const latestData = JSON.parse(fs.readFileSync(latestMatchesPath, 'utf-8'));
  const matches = latestData.matches || [];

  console.log(`总比赛数: ${matches.length} 场`);
  console.log(`更新时间: ${new Date(latestData.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`);

  // 按数据源分类
  const bySource: { [key: string]: any[] } = {};
  matches.forEach((match: any) => {
    const source = match.source || 'unknown';
    if (!bySource[source]) {
      bySource[source] = [];
    }
    bySource[source].push(match);
  });

  console.log('按数据源分类:');
  Object.entries(bySource).forEach(([source, matches]) => {
    console.log(`  ${source}: ${matches.length} 场`);
  });
  console.log('');

  // 按联赛分类
  const byLeague: { [key: string]: any[] } = {};
  matches.forEach((match: any) => {
    const league = match.league || match.league_name || '未知联赛';
    if (!byLeague[league]) {
      byLeague[league] = [];
    }
    byLeague[league].push(match);
  });

  console.log(`按联赛分类 (共 ${Object.keys(byLeague).length} 个联赛):`);
  const sortedLeagues = Object.entries(byLeague)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);

  sortedLeagues.forEach(([league, matches], index) => {
    console.log(`  ${index + 1}. ${league}: ${matches.length} 场`);
  });
  console.log('');

  // 3. 检查 crown-match-map.json
  console.log('============================================================');
  console.log('📊 分析 crown-match-map.json');
  console.log('============================================================\n');

  const crownMapPath = path.join(fetcherDataDir, 'crown-match-map.json');
  
  if (!fs.existsSync(crownMapPath)) {
    console.log('❌ crown-match-map.json 不存在\n');
  } else {
    const mapData = JSON.parse(fs.readFileSync(crownMapPath, 'utf-8'));
    console.log(`生成时间: ${new Date(mapData.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    console.log(`已匹配: ${mapData.matched?.length || 0} 场`);
    console.log(`未匹配: ${mapData.unmatched?.length || 0} 场\n`);

    if (mapData.matched && mapData.matched.length > 0) {
      console.log('匹配示例 (前5场):');
      mapData.matched.slice(0, 5).forEach((m: any, index: number) => {
        console.log(`  ${index + 1}. Crown GID: ${m.crown_gid} <-> iSports ID: ${m.isports_match_id}`);
        console.log(`     相似度: ${(m.similarity * 100).toFixed(1)}%`);
        console.log(`     皇冠: ${m.crown?.league} | ${m.crown?.home} vs ${m.crown?.away}`);
        console.log(`     iSports: ${m.isports?.leagueName} | ${m.isports?.homeName} vs ${m.isports?.awayName}\n`);
      });
    }
  }

  // 4. 对比皇冠数据
  console.log('============================================================');
  console.log('📊 对比皇冠数据');
  console.log('============================================================\n');

  const crownGidsPath = path.resolve(process.cwd(), 'crown-gids.json');
  
  if (!fs.existsSync(crownGidsPath)) {
    console.log('❌ crown-gids.json 不存在\n');
  } else {
    const crownData = JSON.parse(fs.readFileSync(crownGidsPath, 'utf-8'));
    const crownMatches = crownData.matches || [];

    console.log(`皇冠比赛总数: ${crownMatches.length} 场`);
    console.log(`iSports 比赛总数: ${matches.length} 场`);
    console.log(`覆盖率: ${((matches.length / crownMatches.length) * 100).toFixed(1)}%\n`);

    // 按 showtype 分类皇冠数据
    const crownByShowtype: { [key: string]: any[] } = {};
    crownMatches.forEach((match: any) => {
      const showtype = match.source_showtype || 'unknown';
      if (!crownByShowtype[showtype]) {
        crownByShowtype[showtype] = [];
      }
      crownByShowtype[showtype].push(match);
    });

    console.log('皇冠数据按类型分类:');
    Object.entries(crownByShowtype).forEach(([showtype, matches]) => {
      console.log(`  ${showtype}: ${matches.length} 场`);
    });
    console.log('');
  }

  // 5. 检查 fetcher-isports 日志
  console.log('============================================================');
  console.log('💡 诊断建议');
  console.log('============================================================\n');

  console.log('可能的原因:');
  console.log('  1. fetcher-isports 服务未运行或运行异常');
  console.log('  2. iSportsAPI 返回的数据很少');
  console.log('  3. 数据过滤条件太严格');
  console.log('  4. 映射匹配阈值太高\n');

  console.log('建议检查:');
  console.log('  1. 查看 fetcher-isports 服务日志:');
  console.log('     pm2 logs crown-fetcher-isports --lines 100\n');
  console.log('  2. 检查 fetcher-isports 配置:');
  console.log('     cat ../fetcher-isports/.env\n');
  console.log('  3. 手动触发一次数据抓取:');
  console.log('     cd ../fetcher-isports && npm run dev\n');
  console.log('  4. 检查 iSportsAPI 响应:');
  console.log('     查看日志中的 API 响应数据量\n');

  // 6. 生成详细报告
  const reportPath = path.resolve(process.cwd(), 'isports-diagnosis-report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    files: files.map(file => {
      const filePath = path.join(fetcherDataDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        mtime: stats.mtime,
      };
    }),
    latestMatches: {
      total: matches.length,
      bySource: Object.entries(bySource).map(([source, matches]) => ({
        source,
        count: matches.length,
      })),
      byLeague: sortedLeagues.map(([league, matches]) => ({
        league,
        count: matches.length,
      })),
      updateTime: latestData.timestamp,
    },
    crown: crownGidsPath && fs.existsSync(crownGidsPath) ? {
      total: JSON.parse(fs.readFileSync(crownGidsPath, 'utf-8')).matches?.length || 0,
    } : null,
    mapping: crownMapPath && fs.existsSync(crownMapPath) ? {
      matched: JSON.parse(fs.readFileSync(crownMapPath, 'utf-8')).matched?.length || 0,
      unmatched: JSON.parse(fs.readFileSync(crownMapPath, 'utf-8')).unmatched?.length || 0,
    } : null,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 详细报告已保存到: ${reportPath}\n`);

  console.log('============================================================');
  console.log('✅ 诊断完成');
  console.log('============================================================\n');
}

main().catch((error) => {
  console.error('❌ 诊断失败:', error);
  process.exit(1);
});

