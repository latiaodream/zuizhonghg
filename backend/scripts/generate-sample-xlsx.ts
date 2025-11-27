import XLSX from 'xlsx';
import path from 'path';

/**
 * 生成样本 Excel 文件
 */

// 联赛样本数据
const leaguesSample = [
  ['AFC Champions League 2', '亚冠联赛2'],
  ['AFC Champions League Elite', '亚冠精英联赛'],
  ['Argentina Cup', '阿根廷杯'],
  ['Australia A-League', '澳大利亚甲级联赛'],
  ['Austria Erste Division', '奥地利甲级联赛'],
  ['Belgian Second Division', '比利时乙级联赛'],
  ['Bolivia Primera Division', '玻利维亚甲级联赛'],
  ['Botola Pro 1', '摩洛哥甲级联赛'],
  ['Brazil Serie A', '巴西甲级联赛'],
  ['Brazil Serie B', '巴西乙级联赛'],
];

// 球队样本数据
const teamsSample = [
  ['AC Milan', 'AC米兰'],
  ['Manchester United', '曼联'],
  ['Real Madrid', '皇家马德里'],
  ['Barcelona', '巴塞罗那'],
  ['Bayern Munich', '拜仁慕尼黑'],
  ['Liverpool', '利物浦'],
  ['Chelsea', '切尔西'],
  ['Arsenal', '阿森纳'],
  ['Juventus', '尤文图斯'],
  ['Inter Milan', '国际米兰'],
];

function generateSampleFile(data: string[][], filename: string) {
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  
  const outputPath = path.join(__dirname, '../../exports', filename);
  XLSX.writeFile(workbook, outputPath);
  console.log(`✅ 生成样本文件: ${outputPath}`);
}

console.log('📝 生成样本 Excel 文件...\n');

generateSampleFile(leaguesSample, 'leagues-sample.xlsx');
generateSampleFile(teamsSample, 'teams-sample.xlsx');

console.log('\n✅ 样本文件生成完成！');
console.log('\n使用说明：');
console.log('1. 样本文件格式：第一列为英文名称，第二列为简体中文翻译');
console.log('2. 不需要表头，直接从第一行开始填写数据');
console.log('3. 支持 .xlsx 和 .xls 格式');
console.log('4. 文件大小限制 10MB');
console.log('5. 导入时会使用多策略匹配（精确匹配、模糊匹配、相似度匹配）');
console.log('\n匹配策略：');
console.log('- 策略1: 精确匹配 name_en（忽略大小写）');
console.log('- 策略2: 通过 canonical_key 匹配');
console.log('- 策略3: 模糊匹配（去除特殊字符）');
console.log('- 策略4: 相似度匹配（联赛阈值0.8，球队阈值0.85）');

