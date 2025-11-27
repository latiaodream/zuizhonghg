#!/usr/bin/env ts-node
/**
 * Odds-API.io 数据同步脚本
 * 
 * 用法：
 * npm run sync:oddsapi
 * 
 * 或者使用 PM2 定时任务：
 * pm2 start ecosystem.config.js --only oddsapi-sync
 */

import { OddsApiService } from '../services/oddsapi.service';

async function main() {
    console.log('🚀 开始同步 Odds-API.io 数据...');
    console.log(`⏰ 时间: ${new Date().toLocaleString()}`);
    
    try {
        // 同步足球数据
        const result = await OddsApiService.syncData('football');
        
        console.log('\n✅ 同步完成！');
        console.log(`📊 统计:`);
        console.log(`   - 赛事: ${result.events} 场`);
        console.log(`   - 赔率: ${result.odds} 场`);
        console.log(`⏰ 完成时间: ${new Date().toLocaleString()}\n`);
        
        process.exit(0);
    } catch (error: any) {
        console.error('\n❌ 同步失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();

