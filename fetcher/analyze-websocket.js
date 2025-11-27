/**
 * 分析皇冠网站的 WebSocket 协议
 * 
 * 这个脚本会：
 * 1. 使用 Puppeteer 打开皇冠网站
 * 2. 登录账号
 * 3. 监听所有 WebSocket 连接
 * 4. 记录 WebSocket 消息
 * 5. 分析消息格式
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const config = {
  baseUrl: 'https://hga026.com',
  username: 'pWtx91F0jC',
  password: 'aa123123',
  outputDir: './websocket-analysis',
};

// 创建输出目录
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// WebSocket 消息记录
const wsMessages = [];
let messageCount = 0;

async function analyzeCrownWebSocket() {
  console.log('🚀 启动 WebSocket 分析...\n');
  
  const browser = await puppeteer.launch({
    headless: false, // 显示浏览器，方便调试
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // 监听所有请求
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('ws://') || url.includes('wss://')) {
      console.log('🔗 WebSocket 连接:', url);
    }
  });

  // 监听控制台消息
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('WebSocket') || text.includes('ws://') || text.includes('wss://')) {
      console.log('📝 控制台:', text);
    }
  });

  // 使用 CDP (Chrome DevTools Protocol) 监听 WebSocket
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');

  client.on('Network.webSocketCreated', ({ requestId, url }) => {
    console.log('\n✅ WebSocket 创建:', url);
    console.log('   Request ID:', requestId);
  });

  client.on('Network.webSocketFrameSent', ({ requestId, timestamp, response }) => {
    console.log('\n📤 发送 WebSocket 消息:');
    console.log('   Request ID:', requestId);
    console.log('   Payload:', response.payloadData);
    
    wsMessages.push({
      type: 'sent',
      timestamp,
      requestId,
      payload: response.payloadData,
    });
  });

  client.on('Network.webSocketFrameReceived', ({ requestId, timestamp, response }) => {
    messageCount++;
    console.log(`\n📥 接收 WebSocket 消息 #${messageCount}:`);
    console.log('   Request ID:', requestId);
    console.log('   Payload:', response.payloadData.substring(0, 200));
    
    wsMessages.push({
      type: 'received',
      timestamp,
      requestId,
      payload: response.payloadData,
    });

    // 每收到 10 条消息保存一次
    if (messageCount % 10 === 0) {
      saveMessages();
    }
  });

  client.on('Network.webSocketClosed', ({ requestId, timestamp }) => {
    console.log('\n❌ WebSocket 关闭:');
    console.log('   Request ID:', requestId);
  });

  try {
    // 1. 访问首页
    console.log('📍 访问首页:', config.baseUrl);
    await page.goto(config.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. 查找登录入口
    console.log('\n🔍 查找登录入口...');
    
    // 尝试多种可能的登录按钮选择器
    const loginSelectors = [
      'a[href*="login"]',
      'button:has-text("登录")',
      'a:has-text("登录")',
      '.login-btn',
      '#login-btn',
    ];

    let loginButton = null;
    for (const selector of loginSelectors) {
      try {
        loginButton = await page.$(selector);
        if (loginButton) {
          console.log('✅ 找到登录按钮:', selector);
          break;
        }
      } catch (e) {}
    }

    if (loginButton) {
      await loginButton.click();
      await page.waitForTimeout(2000);
    }

    // 3. 输入账号密码
    console.log('\n🔐 输入账号密码...');
    
    // 尝试多种可能的输入框选择器
    const usernameSelectors = [
      'input[name="username"]',
      'input[name="user"]',
      'input[type="text"]',
      '#username',
      '#user',
    ];

    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      '#password',
    ];

    // 输入用户名
    for (const selector of usernameSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.type(config.username);
          console.log('✅ 输入用户名:', selector);
          break;
        }
      } catch (e) {}
    }

    // 输入密码
    for (const selector of passwordSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.type(config.password);
          console.log('✅ 输入密码:', selector);
          break;
        }
      } catch (e) {}
    }

    // 4. 点击登录按钮
    console.log('\n🚀 点击登录...');
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("登录")',
      '.submit-btn',
    ];

    for (const selector of submitSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          console.log('✅ 点击登录按钮:', selector);
          break;
        }
      } catch (e) {}
    }

    await page.waitForTimeout(3000);

    // 5. 导航到滚球页面
    console.log('\n⚽ 导航到滚球页面...');
    const liveSelectors = [
      'a[href*="live"]',
      'a:has-text("滚球")',
      'a:has-text("即时")',
      '.live-btn',
    ];

    for (const selector of liveSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          console.log('✅ 点击滚球按钮:', selector);
          break;
        }
      } catch (e) {}
    }

    await page.waitForTimeout(3000);

    // 6. 等待并监听 WebSocket 消息
    console.log('\n👂 开始监听 WebSocket 消息...');
    console.log('   按 Ctrl+C 停止监听\n');

    // 持续监听 5 分钟
    await page.waitForTimeout(300000);

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
  } finally {
    // 保存所有消息
    saveMessages();
    
    console.log('\n📊 分析完成！');
    console.log(`   总共收到 ${messageCount} 条 WebSocket 消息`);
    console.log(`   数据已保存到: ${config.outputDir}`);
    
    await browser.close();
  }
}

function saveMessages() {
  if (wsMessages.length === 0) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(config.outputDir, `ws-messages-${timestamp}.json`);
  
  fs.writeFileSync(filename, JSON.stringify(wsMessages, null, 2));
  console.log(`\n💾 已保存 ${wsMessages.length} 条消息到: ${filename}`);
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n⚠️ 收到退出信号，正在保存数据...');
  saveMessages();
  process.exit(0);
});

// 启动
analyzeCrownWebSocket().catch(console.error);

