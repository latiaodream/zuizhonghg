#!/usr/bin/env node

/**
 * Redis 和多盘口诊断脚本
 * 用于检查 Redis 是否正常工作，以及多盘口补充是否生效
 */

const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

console.log('🔍 开始诊断...\n');

// 1. 检查 .env 配置
console.log('📋 步骤 1: 检查 .env 配置');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const redisHost = envContent.match(/REDIS_HOST=(.+)/)?.[1]?.trim() || 'localhost';
  const redisPort = envContent.match(/REDIS_PORT=(.+)/)?.[1]?.trim() || '6379';
  const redisPassword = envContent.match(/REDIS_PASSWORD=(.+)/)?.[1]?.trim() || '';
  
  console.log(`   REDIS_HOST: ${redisHost}`);
  console.log(`   REDIS_PORT: ${redisPort}`);
  console.log(`   REDIS_PASSWORD: ${redisPassword ? '***已设置***' : '(未设置)'}`);
  
  // 2. 测试 Redis 连接
  console.log('\n📋 步骤 2: 测试 Redis 连接');
  const redis = new Redis({
    host: redisHost,
    port: parseInt(redisPort, 10),
    password: redisPassword || undefined,
    retryStrategy: () => null, // 不重试
    lazyConnect: true,
  });
  
  redis.connect()
    .then(async () => {
      console.log('   ✅ Redis 连接成功！');
      
      // 3. 测试读写
      console.log('\n📋 步骤 3: 测试 Redis 读写');
      await redis.set('test:diagnose', 'hello', 'EX', 10);
      const value = await redis.get('test:diagnose');
      if (value === 'hello') {
        console.log('   ✅ Redis 读写正常！');
      } else {
        console.log('   ❌ Redis 读写失败！');
      }
      
      // 4. 查看缓存键
      console.log('\n📋 步骤 4: 查看多盘口缓存');
      const keys = await redis.keys('crown:more_markets:*');
      console.log(`   找到 ${keys.length} 个缓存键`);
      
      if (keys.length > 0) {
        console.log('\n   最近的 5 个缓存：');
        for (let i = 0; i < Math.min(5, keys.length); i++) {
          const key = keys[i];
          const ttl = await redis.ttl(key);
          console.log(`   - ${key} (剩余 ${ttl} 秒)`);
        }
      } else {
        console.log('   ⚠️ 没有找到任何缓存，可能：');
        console.log('      1. 还没有用户访问过滚球/今日赛事');
        console.log('      2. 后端代码还没更新');
        console.log('      3. fast=true 跳过了盘口补充');
      }
      
      // 5. 检查后端日志
      console.log('\n📋 步骤 5: 建议检查后端日志');
      console.log('   运行以下命令查看日志：');
      console.log('   pm2 logs bclogin-backend --lines 50 | grep -E "Redis|补充盘口|缓存"');
      
      console.log('\n✅ 诊断完成！');
      
      await redis.quit();
      process.exit(0);
    })
    .catch((error) => {
      console.log('   ❌ Redis 连接失败！');
      console.log(`   错误信息: ${error.message}`);
      console.log('\n   可能的原因：');
      console.log('   1. Redis 服务未启动（运行: systemctl start redis 或 redis-server）');
      console.log('   2. Redis 端口不正确（默认 6379）');
      console.log('   3. Redis 密码不正确');
      console.log('   4. 防火墙阻止连接');
      
      console.log('\n   建议操作：');
      console.log('   1. 检查 Redis 是否运行: redis-cli ping');
      console.log('   2. 检查 Redis 端口: netstat -tlnp | grep redis');
      console.log('   3. 查看 Redis 日志: journalctl -u redis -n 50');
      
      process.exit(1);
    });
  
} else {
  console.log('   ❌ 未找到 .env 文件！');
  console.log('   请先创建 .env 文件并配置 Redis 连接信息');
  process.exit(1);
}

