import axios, { AxiosInstance } from 'axios';
import { parseStringPromise } from 'xml2js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * 皇冠网站纯 API 客户端
 * 使用 HTTP 请求替代 Playwright 自动化
 */

interface LoginResponse {
  status: string;
  msg: string;
  code_message?: string;
  username?: string;
  uid?: string;
  mid?: string;
  passwd_safe?: string;
  [key: string]: any;
}

interface ApiResponse {
  status: string;
  err?: string;
  [key: string]: any;
}

interface ProxyConfig {
  enabled: boolean;
  type?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

interface ClientConfig {
  baseUrl?: string;
  deviceType?: string;
  userAgent?: string;
  proxy?: ProxyConfig;
}

export class CrownApiClient {
  private baseUrl: string;
  private version: string;
  private httpClient: AxiosInstance;
  private deviceType: string;
  private userAgent: string;
  private proxyConfig: ProxyConfig;
  private uid: string | null = null;  // 用户登录后的 UID
  private cookies: string = '';  // 保存 Cookie 字符串

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl || 'https://hga038.com';
    this.version = '2025-10-16-fix342_120'; // 默认版本，会动态更新
    this.deviceType = config.deviceType || 'iPhone 14';
    this.userAgent = config.userAgent || this.generateUserAgent(this.deviceType);
    this.proxyConfig = config.proxy || { enabled: false };

    // 创建 HTTP 客户端配置
    const axiosConfig: any = {
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      timeout: 30000,
    };

    // 配置代理
    if (this.proxyConfig.enabled && this.proxyConfig.host && this.proxyConfig.port) {
      const proxyAgent = this.createProxyAgent();
      if (proxyAgent) {
        axiosConfig.httpAgent = proxyAgent;
        axiosConfig.httpsAgent = proxyAgent;
        console.log(`🌐 使用代理: ${this.proxyConfig.type}://${this.proxyConfig.host}:${this.proxyConfig.port}`);
      }
    }

    this.httpClient = axios.create(axiosConfig);

    // 添加响应拦截器来自动保存 Cookie（合并而不是覆盖）
    this.httpClient.interceptors.response.use(
      (response) => {
        const setCookieHeader = response.headers['set-cookie'];
        if (setCookieHeader && Array.isArray(setCookieHeader)) {
          // 解析现有 Cookie 为 Map
          const cookieMap = new Map<string, string>();
          if (this.cookies) {
            this.cookies.split('; ').forEach(pair => {
              const idx = pair.indexOf('=');
              if (idx > 0) {
                const name = pair.substring(0, idx);
                const value = pair.substring(idx + 1);
                cookieMap.set(name, value);
              }
            });
          }

          // 合并新的 Cookie（只更新/添加，不删除）
          setCookieHeader.forEach(cookie => {
            const parts = cookie.split(';');
            const nameValue = parts[0]; // 只保留 name=value 部分
            const idx = nameValue.indexOf('=');
            if (idx > 0) {
              const name = nameValue.substring(0, idx);
              const value = nameValue.substring(idx + 1);
              // 只有当值为空时才删除，保留 "deleted" 值的 Cookie（如 loadBB=deleted）
              if (value === '') {
                cookieMap.delete(name);
              } else {
                cookieMap.set(name, value);
              }
            }
          });

          // 重建 Cookie 字符串
          const newCookies = Array.from(cookieMap.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');

          if (newCookies !== this.cookies) {
            this.cookies = newCookies;
            console.log('🍪 已合并 Cookie:', this.cookies);
          }
        }
        return response;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // 添加请求拦截器来自动发送 Cookie
    this.httpClient.interceptors.request.use(
      (config) => {
        if (this.cookies) {
          config.headers['Cookie'] = this.cookies;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );
  }

  /**
   * 生成 User-Agent
   */
  private generateUserAgent(deviceType: string): string {
    const chromeVersion = '120.0.0.0';
    const webkitVersion = '537.36';

    switch (deviceType) {
      case 'iPhone 14':
        return 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
      case 'iPhone 13':
        return 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.7 Mobile/15E148 Safari/604.1';
      case 'Android':
        return `Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/${webkitVersion} (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/${webkitVersion}`;
      default:
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${webkitVersion} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${webkitVersion}`;
    }
  }

  /**
   * 创建代理 Agent
   */
  private createProxyAgent(): any {
    if (!this.proxyConfig.host || !this.proxyConfig.port) {
      return null;
    }

    const auth = this.proxyConfig.username && this.proxyConfig.password
      ? `${this.proxyConfig.username}:${this.proxyConfig.password}@`
      : '';

    const proxyUrl = `${this.proxyConfig.type || 'http'}://${auth}${this.proxyConfig.host}:${this.proxyConfig.port}`;

    try {
      if (this.proxyConfig.type === 'socks5' || this.proxyConfig.type === 'socks4') {
        return new SocksProxyAgent(proxyUrl);
      } else {
        return new HttpsProxyAgent(proxyUrl);
      }
    } catch (error) {
      console.error('❌ 创建代理 Agent 失败:', error);
      return null;
    }
  }

  /**
   * 生成假的 BlackBox 设备指纹
   * 不再使用 Playwright，直接生成一个假的 BlackBox
   */
  private async getBlackBox(): Promise<string> {
    console.log(`🔐 生成假的 BlackBox 设备指纹 (设备: ${this.deviceType})...`);

    // 生成一个看起来像真实 BlackBox 的字符串
    // 真实的 BlackBox 格式大概是：0400xxxxx@xxxxx@xxxxx;xxxxx
    const timestamp = Date.now();
    const random1 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const random2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const random3 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const random4 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const random5 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // 生成一个类似真实 BlackBox 的字符串（长度约 200-300 字符）
    const fakeBlackBox = `0400${random1}${random2}@${random3}@${random4};${random5}${timestamp}`;

    console.log('✅ 假 BlackBox 生成成功，长度:', fakeBlackBox.length);
    return fakeBlackBox;
  }

  /**
   * 获取版本号，并确保设置必要的 Cookie
   */
  private async getVersion(): Promise<string> {
    try {
      // 先设置 loadBB Cookie（皇冠服务器需要这个）
      this.cookies = 'loadBB=1';

      const response = await this.httpClient.get('/');
      const html = response.data;
      const match = html.match(/top\.ver\s*=\s*'([^']+)'/);
      if (match) {
        this.version = match[1];
        console.log('✅ 版本号获取成功:', this.version);
      }

      // 确保 loadBB=deleted 存在（如果服务器没有返回，手动添加）
      if (!this.cookies.includes('loadBB=')) {
        this.cookies = 'loadBB=deleted; ' + this.cookies;
      }

      return this.version;
    } catch (error) {
      console.warn('⚠️ 获取版本号失败，使用默认版本:', this.version);
      return this.version;
    }
  }

  /**
   * 解析 XML 响应
   */
  private async parseXmlResponse(xml: string): Promise<any> {
    try {
      const result = await parseStringPromise(xml, {
        explicitArray: false,
        ignoreAttrs: false,
      });
      return result.serverresponse || result;
    } catch (error) {
      console.error('❌ XML 解析失败:', error);
      throw new Error('响应格式错误');
    }
  }

  /**
   * 登录 API（带重试机制）
   * 注意：重试次数设置为 1，避免短时间内多次失败导致账号被锁定
   */
  async login(username: string, password: string, retries = 1): Promise<LoginResponse> {
    console.log(`🔐 开始登录: ${username}`);

    // 获取最新版本号
    await this.getVersion();

    // 获取 BlackBox
    const blackbox = await this.getBlackBox();

    // Base64 编码 UserAgent
    const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
    const encodedUA = Buffer.from(userAgent).toString('base64');

    // 构建请求参数（与抓包保持一致，使用简体中文 zh-cn）
    const params = new URLSearchParams({
      p: 'chk_login',
      langx: 'zh-cn',  // 使用简体中文版本
      ver: this.version,
      username,
      password,
      app: 'N',
      auto: 'CFHFID',
      blackbox,
      userAgent: encodedUA,
    });

    // 重试机制（默认只尝试 1 次，避免账号被锁定）
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (attempt > 1) {
          const delay = attempt * 2000; // 2秒、4秒（如果需要重试）
          console.log(`⏳ 等待 ${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        console.log(`🔄 尝试登录 (${attempt}/${retries})...`);
        const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, params.toString());
        const data = await this.parseXmlResponse(response.data);

        const loginResponse = data as LoginResponse;
        console.log('📥 登录响应:', {
          status: loginResponse.status,
          msg: loginResponse.msg,
          username: loginResponse.username,
          uid: loginResponse.uid,
        });

        if (loginResponse.msg === '100' && loginResponse.status !== 'success') {
          loginResponse.status = 'success';
        }

        // msg='100' 或 '109' 都表示登录成功
        // msg='105' 表示账号密码错误
        // msg='106' 表示需要初始化（强制改密）
        if (loginResponse.status === 'success' || loginResponse.msg === '100' || loginResponse.msg === '109') {
          if (loginResponse.uid) {
            this.uid = loginResponse.uid;
            console.log('✅ UID 已保存:', this.uid);
          }
          return loginResponse;
        }

        console.error('❌ 登录失败:', loginResponse);
        throw new Error(loginResponse.code_message || '登录失败');

      } catch (error: any) {
        console.error(`❌ 登录失败 (尝试 ${attempt}/${retries}):`, error.code || error.message);

        // 如果是最后一次尝试，抛出错误
        if (attempt === retries) {
          throw error;
        }

        // 只有网络错误才重试，密码错误等业务错误直接抛出
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
          console.log('🔄 网络错误，准备重试...');
          continue;
        }

        // 其他错误直接抛出
        throw error;
      }
    }

    // 不应该到达这里
    throw new Error('登录失败：所有重试都失败了');
  }

  /**
   * 提交新密码 API
   */
  async changePassword(
    uid: string,
    originalUsername: string,
    newPassword: string
  ): Promise<ApiResponse> {
    console.log(`🔑 开始修改密码: ${originalUsername}`);

    const params = new URLSearchParams({
      p: 'chg_newpwd',
      ver: this.version,
      username: originalUsername,
      new_password: newPassword,
      chg_password: newPassword,
      uid,
      langx: 'zh-cn',
    });

    try {
      const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, params.toString());
      const data = await this.parseXmlResponse(response.data);

      console.log('📥 修改密码响应:', data);

      // 判断是否成功：检查响应中是否包含成功的标志
      // 通常成功的响应会有 status='200' 或包含"成功"的消息
      if (data.status === '200' || (data.msg && data.msg.includes('成功'))) {
        return {
          status: 'Success',
          ...data,
        } as ApiResponse;
      } else {
        return {
          status: 'Failed',
          err: data.err || data.msg || '修改密码失败',
          ...data,
        } as ApiResponse;
      }

    } catch (error) {
      console.error('❌ 修改密码失败:', error);
      throw error;
    }
  }

  /**
   * 提交新账号 API
   */
  async changeUsername(
    uid: string,
    currentUsername: string,
    newUsername: string
  ): Promise<ApiResponse> {
    console.log(`👤 开始修改账号: ${currentUsername} -> ${newUsername}`);

    const params = new URLSearchParams({
      p: 'chg_passwd_safe',
      ver: this.version,
      username: currentUsername,
      chk_name: newUsername,
      uid,
      langx: 'zh-cn',
    });

    try {
      const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, params.toString());
      const data = await this.parseXmlResponse(response.data);

      console.log('📥 修改账号响应:', data);

      // 判断是否成功：检查 chg_long_user 字段是否包含"成功"
      if (data.chg_long_user && data.chg_long_user.includes('成功')) {
        return {
          status: 'Success',
          ...data,
        } as ApiResponse;
      } else {
        return {
          status: 'Failed',
          err: data.str_user || '修改账号失败',
          ...data,
        } as ApiResponse;
      }

    } catch (error) {
      console.error('❌ 修改账号失败:', error);
      throw error;
    }
  }

  /**
   * 检查会员设置 API
   */
  async checkMemberSettings(uid: string): Promise<string> {
    console.log('🔍 检查会员设置...');

    const params = new URLSearchParams({
      p: 'memSet',
      langx: 'zh-cn',
      uid,
      action: 'check',
    });

    try {
      const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, params.toString());
      
      console.log('📥 会员设置响应:', response.data);

      return response.data;

    } catch (error) {
      console.error('❌ 检查会员设置失败:', error);
      throw error;
    }
  }

  /**
   * 完整的初始化流程
   */
  async initializeAccount(
    originalUsername: string,
    originalPassword: string,
    newUsername: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string; updatedCredentials: { username: string; password: string } }> {
    try {
      console.log(`🔐 开始初始化账号流程...`);
      console.log(`📋 原始账号: ${originalUsername}`);
      console.log(`📋 新账号: ${newUsername}`);

      // 1. 登录
      console.log(`🔄 步骤1: 尝试登录原始账号...`);
      const loginResp = await this.login(originalUsername, originalPassword);

      console.log(`📥 登录响应:`, {
        status: loginResp.status,
        msg: loginResp.msg,
        code_message: loginResp.code_message,
        uid: loginResp.uid
      });

      if (loginResp.status === 'error' || loginResp.msg === '105') {
        console.error(`❌ 登录失败: ${loginResp.code_message || '账号或密码错误'}`);
        return {
          success: false,
          message: loginResp.code_message || '登录失败，账号或密码错误',
          updatedCredentials: { username: originalUsername, password: originalPassword },
        };
      }

      const uid = loginResp.uid!;
      const originalUsernameFromServer = loginResp.username!;

      // 2. 检查是否需要初始化
      // 注意：Crown 的 API 行为不一致，有时首次登录也返回 msg=109
      // 策略：无论 msg 是什么，都尝试修改账号和密码
      // 如果修改成功，说明需要初始化；如果失败，说明已经初始化过了

      console.log(`📋 登录状态: msg=${loginResp.msg}`);

      if (loginResp.msg === '105') {
        // 登录失败
        return {
          success: false,
          message: loginResp.code_message || '登录失败，账号或密码错误',
          updatedCredentials: { username: originalUsername, password: originalPassword },
        };
      }

      // 3. 尝试修改账号和密码
      console.log('🚀 尝试修改账号和密码...');

      // 4. 修改账号（如果需要）
      let finalUsername = originalUsernameFromServer;
      if (newUsername && newUsername !== originalUsernameFromServer) {
        console.log(`📝 尝试修改账号: ${originalUsernameFromServer} -> ${newUsername}`);
        const changeUsernameResp = await this.changeUsername(uid, originalUsernameFromServer, newUsername);

        if (changeUsernameResp.status === 'Success') {
          console.log('✅ 账号修改成功');
          finalUsername = newUsername;
        } else {
          // 修改账号失败，可能是账号已经初始化过了
          console.log('⚠️ 修改账号失败:', changeUsernameResp.err);

          // 如果错误信息表明账号已经初始化，直接返回
          if (changeUsernameResp.err && (
            changeUsernameResp.err.includes('已') ||
            changeUsernameResp.err.includes('不能') ||
            changeUsernameResp.err.includes('无法')
          )) {
            return {
              success: true,
              message: '账号已初始化，无需再次操作',
              updatedCredentials: { username: originalUsername, password: originalPassword },
            };
          }

          return {
            success: false,
            message: changeUsernameResp.err || '修改账号失败',
            updatedCredentials: { username: originalUsername, password: originalPassword },
          };
        }
      }

      // 5. 修改密码
      console.log(`🔑 尝试修改密码`);
      const changePwdResp = await this.changePassword(uid, originalUsernameFromServer, newPassword);

      if (changePwdResp.status === 'Success') {
        console.log('✅ 密码修改成功');
      } else {
        // 修改密码失败，可能是账号已经初始化过了
        console.log('⚠️ 修改密码失败:', changePwdResp.err);

        // 如果错误信息表明账号已经初始化，直接返回
        if (changePwdResp.err && (
          changePwdResp.err.includes('已') ||
          changePwdResp.err.includes('不能') ||
          changePwdResp.err.includes('无法')
        )) {
          return {
            success: true,
            message: '账号已初始化，无需再次操作',
            updatedCredentials: { username: originalUsername, password: originalPassword },
          };
        }

        return {
          success: false,
          message: changePwdResp.err || '修改密码失败',
          updatedCredentials: { username: finalUsername, password: originalPassword },
        };
      }

      // 6. 检查会员设置（简易密码提示，可忽略）
      await this.checkMemberSettings(uid).catch(() => undefined);

      return {
        success: true,
        message: '初始化成功',
        updatedCredentials: { username: finalUsername, password: newPassword },
      };

    } catch (error) {
      console.error('❌ 初始化失败 - 捕获异常:', error);
      console.error('❌ 错误详情:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : '初始化过程中发生错误',
        updatedCredentials: { username: originalUsername, password: originalPassword },
      };
    }
  }

  /**
   * 获取账号余额 API
   */
  async getBalance(uid: string): Promise<{ balance: number; credit: number } | null> {
    console.log(`💰 开始获取余额，UID: ${uid}`);

    // 确保有最新的版本号
    if (!this.version || this.version === '2025-10-16-fix342_120') {
      await this.getVersion();
    }

    const params = new URLSearchParams({
      p: 'get_member_data',
      ver: this.version,
      change: 'all',
      langx: 'zh-cn',
      uid,
    });

    try {
      const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, params.toString());
      const xmlData = response.data;

      console.log('📥 余额响应 (XML):', xmlData.substring(0, 200));

      // 解析 XML 中的余额和额度
      const extractTagValue = (text: string, tagNames: string[]): number | null => {
        for (const tag of tagNames) {
          const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
          const match = text.match(regex);
          if (match && match[1]) {
            const val = parseFloat(match[1]);
            if (!isNaN(val)) return val;
          }
        }
        return null;
      };

      const balance = extractTagValue(xmlData, ['cash', 'balance']) || 0;
      const credit = extractTagValue(xmlData, ['maxcredit', 'credit']) || 0;

      console.log('💰 余额解析结果:', { balance, credit });

      return { balance, credit };

    } catch (error) {
      console.error('❌ 获取余额失败:', error);
      return null;
    }
  }

  /**
   * 获取赛事列表 API
   *
   * @param params 查询参数
   * @returns 赛事列表
   */
  async getGameList(params: {
    gtype?: string;       // 比赛类型 (ft=足球, bk=篮球等)
    showtype?: string;    // 显示类型 (live=滚球, today=今日, early=早盘)
    rtype?: string;       // 盘口类型 (rb=滚球)
    ltype?: string;       // 联赛类型
    sorttype?: string;    // 排序类型 (L=联赛)
    langx?: string;       // 语言 (zh-cn=简体, zh-tw=繁体)
  } = {}): Promise<any> {
    console.log('📋 开始获取赛事列表...');

    if (!this.uid) {
      throw new Error('未登录，无法获取赛事列表');
    }

    const timestamp = Date.now().toString();

    const requestParams = new URLSearchParams({
      uid: this.uid,
      ver: this.version,
      // 默认使用简体中文，与实际网页登录和抓包保持一致
      langx: params.langx || 'zh-cn',
      p: 'get_game_list',
      p3type: '',
      date: '',
      gtype: params.gtype || 'ft',
      showtype: params.showtype || 'live',
      rtype: params.rtype || 'rb',
      ltype: params.ltype || '3',
      filter: '',
      cupFantasy: 'N',
      sorttype: params.sorttype || 'L',
      specialClick: '',
      isFantasy: 'N',
      ts: timestamp,
    });

    try {
      console.log('📤 发送赛事列表请求...');
      console.log('   比赛类型:', params.gtype || 'ft');
      console.log('   显示类型:', params.showtype || 'live');

      const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, requestParams.toString());

      // 返回原始 XML 字符串，而不是解析后的 JSON
      const xmlString = response.data;

      // 打印原始 XML 的前 2000 个字符用于调试(包含完整的第一场赛事数据)
      console.log('📥 原始 XML 响应（前 2000 字符）:', xmlString.substring(0, 2000));

      // 仅用于日志记录，解析一下看看有多少赛事
      try {
        const data = await this.parseXmlResponse(xmlString);
        console.log('📥 赛事列表响应:', {
          code: data.code,
          gameCount: data.game ? (Array.isArray(data.game) ? data.game.length : 1) : 0,
        });
      } catch (parseError) {
        console.log('⚠️  解析响应用于日志失败（忽略）');
      }

      return xmlString;

    } catch (error: any) {
      console.error('❌ 获取赛事列表失败:', error.code || error.message);
      throw error;
    }
  }

  /**
   * 清理资源（现在不需要了，因为不再使用 Playwright）
   */
  async close(): Promise<void> {
    // 不再需要清理浏览器资源
  }

  /**
   * 获取比赛的所有玩法和盘口（更多盘口）
   *
   * @param params 查询参数
   * @param params.gid 比赛ID（从赛事列表获取，对应 ecid）
   * @param params.lid 联赛ID（从赛事列表获取）
   * @param params.gtype 比赛类型（ft=足球, bk=篮球等）
   * @param params.showtype 显示类型（live=滚球, today=今日, early=早盘）
   * @param params.ltype 联赛类型
   * @param params.isRB 是否滚球（Y/N）
   *
   * @returns 返回包含所有玩法和盘口的 XML 数据
   */
  async getGameMore(params: {
    gid: string;          // 比赛ID (ecid)
    lid: string;          // 联赛ID
    gtype?: string;       // 比赛类型 (ft=足球, bk=篮球等)
    showtype?: string;    // 显示类型 (live=滚球, today=今日, early=早盘)
    ltype?: string;       // 联赛类型
    isRB?: string;        // 是否滚球 (Y/N)
  }): Promise<any> {
    console.log('📋 获取比赛所有玩法...');

    if (!this.uid) {
      throw new Error('未登录，无法获取比赛玩法');
    }

    const timestamp = Date.now().toString();

    const requestParams = new URLSearchParams({
      uid: this.uid,
      ver: this.version,
      // 与实际网页登录保持一致，使用简体中文
      langx: 'zh-cn',
      p: 'get_game_more',
      gtype: params.gtype || 'ft',
      showtype: params.showtype || 'live',
      ltype: params.ltype || '3',
      isRB: params.isRB || 'Y',
      lid: params.lid,
      specialClick: '',
      mode: 'NORMAL',
      from: 'game_more',
      filter: 'All',
      ts: timestamp,
      ecid: params.gid,
    });

    try {
      console.log('📤 发送获取更多玩法请求...');
      console.log('   比赛ID:', params.gid);
      console.log('   联赛ID:', params.lid);

      const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, requestParams.toString());

      // 返回原始 XML 字符串
      const xmlString = response.data;

      console.log('📥 获取更多玩法响应（前 2000 字符）:', xmlString.substring(0, 2000));

      return xmlString;

    } catch (error: any) {
      console.error('❌ 获取更多玩法请求失败:', error.code || error.message);
      throw error;
    }
  }

  /**
   * 获取比赛最新赔率和状态（⭐ 下注前必须调用）
   *
   * 这是下注流程中最关键的一步！必须在下注前调用此方法获取最新赔率。
   *
   * 为什么必须调用：
   * 1. 赛事列表中的赔率可能已过时
   * 2. 盘口可能已关闭
   * 3. 赔率实时变化
   * 4. 需要验证赛事是否可下注
   *
   * wtype 选择策略：
   * - 先尝试 'RM'（滚球独赢）
   * - 如果失败（code=555），再尝试 'M'（今日独赢）
   * - 记住成功的 wtype，下注时使用相同的值
   *
   * @param params 查询参数
   * @param params.gid 比赛ID（从赛事列表获取）
   * @param params.gtype 比赛类型（FT=足球, BK=篮球等）
   * @param params.wtype 玩法类型（RM=滚球独赢, M=今日独赢, R=让球, OU=大小球等）
   * @param params.chose_team 选择的队伍（H=主队, C=客队, N=和局）
   *
   * @returns 成功时返回：
   *   {
   *     success: true,
   *     ioratio: '3.10',        // 最新赔率
   *     ratio: '3000',          // 赔率比例（赔率 * 1000）
   *     con: '0',               // 让球数
   *     gold_gmin: '50',        // 最小下注金额
   *     gold_gmax: '9523',      // 最大下注金额
   *     team_name_h: '主队名',
   *     team_name_c: '客队名',
   *     league_name: '联赛名',
   *     ...
   *   }
   *
   * @returns 失败时返回：
   *   {
   *     success: false,
   *     code: '555',            // 错误代码（555=盘口关闭）
   *     message: '错误信息',
   *     ...
   *   }
   *
   * @example
   * // 先尝试 RM
   * let odds = await client.getLatestOdds({
   *   gid: '8209619',
   *   gtype: 'FT',
   *   wtype: 'RM',
   *   chose_team: 'H',
   * });
   *
   * let usedWtype = 'RM';
   *
   * // 失败则尝试 M
   * if (!odds.success && odds.code === '555') {
   *   odds = await client.getLatestOdds({
   *     gid: '8209619',
   *     gtype: 'FT',
   *     wtype: 'M',
   *     chose_team: 'H',
   *   });
   *   usedWtype = 'M';
   * }
   *
   * // 下注时使用相同的 wtype
   * if (odds.success) {
   *   await client.placeBet({
   *     wtype: usedWtype,
   *     rtype: usedWtype === 'RM' ? 'RMH' : 'MH',
   *     ioratio: odds.ioratio,
   *     ...
   *   });
   * }
   */
  async getLatestOdds(params: {
    gid: string;          // 比赛ID
    gtype: string;        // 比赛类型 (FT=足球, BK=篮球等)
    wtype: string;        // 玩法类型 (RM=独赢, R=让球, OU=大小球等)
    chose_team: string;   // 选择的队伍 (H=主队, C=客队, N=和局)
    spread?: string;      // 盘口线（让球数/大小球线）
    con?: string;         // 盘口线（同 spread，兼容下注接口参数名）
  }): Promise<any> {
    console.log('🔄 获取最新赔率...');

    if (!this.uid) {
      throw new Error('未登录，无法获取赔率');
    }

    // 获取盘口线参数（优先用 con，兼容 spread）
    const conValue = params.con || params.spread || '';

    const requestParams = new URLSearchParams({
      p: `${params.gtype}_order_view`,
      uid: this.uid,
      ver: this.version,
      langx: 'zh-cn',
      odd_f_type: 'H',
      gid: params.gid,
      gtype: params.gtype,
      wtype: params.wtype,
      chose_team: params.chose_team,
    });

    // 如果有盘口线，添加 con 参数
    if (conValue) {
      requestParams.set('con', conValue);
    }

    try {
      console.log('📤 发送获取赔率请求...');
      console.log('   比赛ID:', params.gid);
      console.log('   玩法:', params.wtype);
      console.log('   选择:', params.chose_team);
      console.log('   盘口线:', conValue || '(主盘口)');

      const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, requestParams.toString());

      // 打印原始响应以调试
      console.log('📥 原始赔率响应（前 500 字符）:', typeof response.data === 'string' ? response.data.substring(0, 500) : JSON.stringify(response.data).substring(0, 500));

      // 检查是否包含 doubleLogin 错误
      if (typeof response.data === 'string' && response.data.includes('doubleLogin')) {
        console.log('⚠️ 检测到重复登录，会话已失效');
        this.uid = null; // 清除 UID
        return {
          success: false,
          code: 'DOUBLE_LOGIN',
          message: '账号在其他地方登录，当前会话已失效。请重新登录。',
        };
      }

      // 检查是否是纯文本错误响应
      if (typeof response.data === 'string' && !response.data.trim().startsWith('<')) {
        const errorText = response.data.trim();
        console.log('⚠️ 收到非 XML 响应:', errorText);

        // 处理已知的错误代码
        if (errorText === 'CheckEMNU' || errorText.includes('CheckEMNU')) {
          console.log('❌ 会话无效 (CheckEMNU)，需要重新登录');
          return {
            success: false,
            code: 'SESSION_EXPIRED',
            message: '会话已过期或无效，请重新登录账号。',
          };
        }

        // 处理 VariableStandard 错误（通常表示会话失效或参数错误）
        if (errorText === 'VariableStandard' || errorText === 'Variable Standard') {
          console.log('❌ 收到 VariableStandard 响应，可能是会话失效或参数错误');
          return {
            success: false,
            code: 'SESSION_EXPIRED',
            message: '会话已失效或请求参数错误，请重新登录账号。',
          };
        }

        console.log('❌ 无效的响应格式:', errorText);
        return {
          success: false,
          code: 'INVALID_RESPONSE',
          message: `API 返回错误: ${errorText}`,
        };
      }

      const data = await this.parseXmlResponse(response.data);

      console.log('📥 赔率响应:', {
        code: data.code,
        ioratio: data.ioratio,
        ratio: data.ratio,
        con: data.con,
        gold_gmin: data.gold_gmin,
        gold_gmax: data.gold_gmax,
      });

      // 检查是否成功（code=501 表示成功）
      if (data.code === '501') {
        return {
          success: true,
          ioratio: data.ioratio,
          ratio: data.ratio,
          con: data.con,
          spread: data.spread,
          gold_gmin: data.gold_gmin,
          gold_gmax: data.gold_gmax,
          maxcredit: data.maxcredit,
          team_name_h: data.team_name_h,
          team_name_c: data.team_name_c,
          league_name: data.league_name,
          score: data.score,
          ...data,
        };
      } else {
        console.log('❌ 获取赔率失败');
        console.log('   错误代码:', data.code);

        // 检查是否是会话失效错误（1X014 = 登入失败，请重新登录）
        const errormsg = data.errormsg || '';
        if (errormsg === '1X014' || errormsg.includes('1X014')) {
          console.log('⚠️ 检测到会话失效 (1X014)，需要重新登录');
          this.uid = null; // 清除 UID
          // 注意：...data 放在前面，避免覆盖 code 和 message
          return {
            ...data,
            success: false,
            code: 'SESSION_EXPIRED',
            message: '会话已失效，请重新登录账号',
          };
        }

        return {
          ...data,
          success: false,
          code: data.code,
          message: data.msg || '获取赔率失败',
        };
      }

    } catch (error: any) {
      console.error('❌ 获取赔率请求失败:', error.code || error.message);
      throw error;
    }
  }

  /**
   * 下注 API（基于实际抓取的参数实现）
   *
   * ⚠️ 重要：下注前必须先调用 getLatestOdds() 获取最新赔率！
   *
   * 关键要点：
   * 1. wtype 必须与 getLatestOdds() 中成功的 wtype 一致
   * 2. ioratio、ratio、con 必须使用 getLatestOdds() 返回的值
   * 3. 最小下注金额：50 RMB
   * 4. rtype 必须与 wtype 对应：
   *    - wtype=RM → rtype=RMH/RMC/RMN
   *    - wtype=M → rtype=MH/MC/MN
   *    - wtype=R → rtype=RH/RC
   *    - wtype=OU → rtype=OUH/OUC
   *
   * @param params 下注参数
   * @param params.gid 比赛ID（从赛事列表获取）
   * @param params.gtype 比赛类型（FT=足球, BK=篮球等）
   * @param params.wtype 玩法类型（必须与 getLatestOdds 中成功的 wtype 一致）
   * @param params.rtype 下注选项（RMH=滚球独赢主队, MH=今日独赢主队等）
   * @param params.chose_team 选择的队伍（H=主队, C=客队, N=和局）
   * @param params.ioratio 赔率（从 getLatestOdds 获取）
   * @param params.gold 下注金额（最低50）
   * @param params.con 让球数（从 getLatestOdds 获取，默认'0'）
   * @param params.ratio 赔率比例（从 getLatestOdds 获取）
   * @param params.autoOdd 自动接受赔率变化（Y/N，默认Y）
   * @param params.isRB 是否滚球（Y/N）
   * @param params.imp 重要比赛标记（Y/N，默认N）
   * @param params.ptype 盘口类型（默认空字符串）
   * @param params.isYesterday 是否昨日比赛（Y/N，默认N）
   * @param params.f 未知参数（默认'1R'）
   *
   * @returns 成功时返回：
   *   {
   *     success: true,
   *     ticket_id: '22820903129',  // 注单号
   *     nowcredit: '11011',        // 当前余额
   *     gold: '50',                // 下注金额
   *     ioratio: '3.10',           // 赔率
   *     team_h: '主队名',
   *     team_c: '客队名',
   *     league: '联赛名',
   *     ...
   *   }
   *
   * @returns 失败时返回：
   *   {
   *     success: false,
   *     code: '555',               // 错误代码
   *     message: '错误信息',
   *     ...
   *   }
   *
   * @example
   * // 完整的下注流程
   * const client = new CrownApiClient();
   *
   * // 1. 登录
   * const loginResult = await client.login('username', 'password');
   *
   * // 2. 获取赛事列表
   * const gameList = await client.getGameList({
   *   gtype: 'ft',
   *   showtype: 'today',
   *   rtype: 'r',
   * });
   *
   * const game = gameList.ec[0].game;
   *
   * // 3. 获取最新赔率（关键步骤）
   * let odds = await client.getLatestOdds({
   *   gid: game.GID,
   *   gtype: 'FT',
   *   wtype: 'RM',
   *   chose_team: 'H',
   * });
   *
   * let usedWtype = 'RM';
   *
   * // 失败则尝试 M
   * if (!odds.success) {
   *   odds = await client.getLatestOdds({
   *     gid: game.GID,
   *     gtype: 'FT',
   *     wtype: 'M',
   *     chose_team: 'H',
   *   });
   *   usedWtype = 'M';
   * }
   *
   * // 4. 下注（使用相同的 wtype）
   * if (odds.success) {
   *   const betResult = await client.placeBet({
   *     gid: game.GID,
   *     gtype: 'FT',
   *     wtype: usedWtype,                          // 使用相同的 wtype
   *     rtype: usedWtype === 'RM' ? 'RMH' : 'MH',  // 对应的 rtype
   *     chose_team: 'H',
   *     ioratio: odds.ioratio,                     // 使用最新赔率
   *     gold: '50',
   *     con: odds.con,                             // 使用最新 con
   *     ratio: odds.ratio,                         // 使用最新 ratio
   *     autoOdd: 'Y',
   *     isRB: 'N',
   *     imp: 'N',
   *     ptype: '',
   *     isYesterday: 'N',
   *     f: '1R',
   *   });
   *
   *   if (betResult.success) {
   *     console.log('下注成功！注单号:', betResult.ticket_id);
   *   }
   * }
   */
  async placeBet(params: {
    gid: string;          // 比赛ID
    gtype: string;        // 比赛类型 (FT=足球, BK=篮球等)
    wtype: string;        // 玩法类型 (RM=独赢, R=让球, OU=大小球等)
    rtype: string;        // 下注选项 (RMH=独赢主队, RMC=独赢客队, RH=让球主队, RC=让球客队等)
    chose_team: string;   // 选择的队伍 (H=主队, C=客队, N=和局)
    ioratio: string;      // 赔率 (如 "1.06")
    gold: string;         // 下注金额 (如 "50")，最低50
    con?: string;         // 让球数 (如 "0")
    ratio?: string;       // 赔率比例 (如 "1360" = 1.36 * 1000)
    autoOdd?: string;     // 自动接受赔率变化 (Y/N)，默认Y
    isRB?: string;        // 是否滚球 (Y/N)
    imp?: string;         // 重要比赛标记 (Y/N)
    ptype?: string;       // 盘口类型
    isYesterday?: string; // 是否昨日比赛 (Y/N)
    f?: string;           // 未知参数 (如 "1R")
  }): Promise<any> {
    console.log('🎯 开始下注:', params);

    if (!this.uid) {
      throw new Error('未登录，无法下注');
    }

    // 验证最低下注金额
    const goldAmount = parseFloat(params.gold);
    if (goldAmount < 50) {
      throw new Error('下注金额不能低于 50 RMB');
    }

    // 获取当前时间戳
    const timestamp = Date.now().toString();

    // 构建下注请求参数（基于实际抓取的参数）
    const betParams = new URLSearchParams({
      p: `${params.gtype}_bet`,  // 操作类型：FT_bet, BK_bet 等
      uid: this.uid,
      ver: this.version,
      // 与最新抓包保持一致，使用简体中文
      langx: 'zh-cn',
      odd_f_type: 'H',           // 赔率格式类型（香港盘）
      golds: params.gold,        // 注意：是 golds 不是 gold
      gid: params.gid,
      gtype: params.gtype,
      wtype: params.wtype,
      rtype: params.rtype,
      chose_team: params.chose_team,
      ioratio: params.ioratio,
      con: params.con || '0',
      ratio: params.ratio || Math.round(parseFloat(params.ioratio) * 1000).toString(),
      autoOdd: params.autoOdd || 'Y',
      timestamp: timestamp,
      timestamp2: '',
      isRB: params.isRB || 'N',
      imp: params.imp || 'N',
      ptype: params.ptype || '',
      isYesterday: params.isYesterday || 'N',
      f: params.f || '1R',
    });

    try {
      console.log('📤 发送下注请求...');
      console.log('   比赛ID:', params.gid);
      console.log('   玩法:', params.wtype);
      console.log('   选项:', params.rtype);
      console.log('   赔率:', params.ioratio);
      console.log('   金额:', params.gold);

      const response = await this.httpClient.post(`/transform.php?ver=${this.version}`, betParams.toString());
      const data = await this.parseXmlResponse(response.data);

      console.log('📥 下注响应:', data);

      // 如果失败，显示完整响应 XML 以便调试
      if (data.code !== '560' && !data.ticket_id) {
        console.log('⚠️  完整响应 XML:', response.data.substring(0, 1000));
      }

      // 检查下注是否成功（code=560 表示成功）
      if (data.code === '560' || data.ticket_id) {
        console.log('✅ 下注成功！');
        console.log('   注单号:', data.ticket_id);
        console.log('   下注金额:', data.gold);
        console.log('   当前余额:', data.nowcredit);
        console.log('   最大额度:', data.maxcredit);
        console.log('   比赛:', `${data.team_h} vs ${data.team_c}`);
        console.log('   联赛:', data.league);

        return {
          success: true,
          ticket_id: data.ticket_id,
          gold: data.gold,
          nowcredit: data.nowcredit,
          maxcredit: data.maxcredit,
          ioratio: data.ioratio,
          team_h: data.team_h,
          team_c: data.team_c,
          league: data.league,
          date: data.date,
          time: data.time,
          score_h: data.score_h,
          score_c: data.score_c,
          ...data,
        };
      } else {
        console.log('❌ 下注失败');
        console.log('   错误代码:', data.code);
        console.log('   错误信息:', data.msg || data.message || '未知错误');

        return {
          success: false,
          code: data.code,
          message: data.msg || data.message || '下注失败',
          ...data,
        };
      }

    } catch (error: any) {
      console.error('❌ 下注请求失败:', error.code || error.message);
      throw error;
    }
  }

  /**
   * 获取当前的 Cookie
   */
  getCookies(): string {
    return this.cookies;
  }

  /**
   * 设置 Cookie
   */
  setCookies(cookies: string): void {
    this.cookies = cookies;
    console.log('🍪 已设置 Cookie:', this.cookies);
  }

  /**
   * 获取当前的 UID
   */
  getUid(): string | null {
    return this.uid;
  }

  /**
   * 设置 UID
   */
  setUid(uid: string): void {
    this.uid = uid;
    console.log('✅ 已设置 UID:', this.uid);
  }

  /**
   * 获取基础 URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * 获取账号额度设置（包含限额信息）
   * @param gtype 游戏类型，默认 'FT'（足球）
   */
  async getAccountSettings(gtype: string = 'FT'): Promise<any> {
    console.log(`📊 获取账号额度设置 (gtype=${gtype})...`);

    if (!this.uid) {
      throw new Error('未登录，无法获取账号设置');
    }

    const params = new URLSearchParams({
      uid: this.uid,
      ver: this.version,
      // 与官网保持一致，使用简体中文
      langx: 'zh-cn',
      p: 'get_account_set',
      gtype: gtype,
    });

    try {
      const response = await this.httpClient.post('/transform.php', params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.cookies,
        },
      });

      console.log('✅ 账号设置响应 (完整):', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ 获取账号设置失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取账号下注历史记录
   * @param params 查询参数
   */
  async getHistoryData(params: {
    gtype?: string;
    isAll?: string;
    startdate?: string;
    enddate?: string;
    filter?: string;
  } = {}): Promise<any> {
    console.log(`📜 获取下注历史记录...`);

    if (!this.uid) {
      throw new Error('未登录，无法获取历史记录');
    }

    const commonHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': this.cookies,
    };

    // 预热接口，保持与官网一致的调用流程
    const warmupParams = new URLSearchParams({
      p: 'history_data',
      uid: this.uid,
      ver: this.version,
      langx: 'zh-cn',
    });

    try {
      await this.httpClient.post('/transform.php', warmupParams.toString(), {
        headers: commonHeaders,
      });
    } catch (warmupError: any) {
      console.warn('⚠️ 历史记录预热失败（将继续尝试获取数据）:', warmupError?.message || warmupError);
    }

    const requestParams = new URLSearchParams({
      p: 'get_history_data',
      uid: this.uid,
      ver: this.version,
      langx: 'zh-cn',
      gtype: params.gtype || 'ALL',
      isAll: params.isAll || 'N',
      startdate: params.startdate || '',
      enddate: params.enddate || '',
      filter: params.filter || 'Y',
    });

    try {
      const response = await this.httpClient.post('/transform.php', requestParams.toString(), {
        headers: commonHeaders,
      });

      let payload = response.data;

      // 处理特殊响应
      if (typeof payload === 'string') {
        const trimmed = payload.trim();

        // 处理 "VariableStandard" 响应（表示没有历史记录）
        if (trimmed === 'VariableStandard' || trimmed === 'Variable Standard') {
          console.log('📭 没有历史记录（VariableStandard）');
          return {
            total_gold: '0',
            total_vgold: '0',
            total_winloss: '0',
            history: []
          };
        }

        // 尝试解析 XML 响应
        if (trimmed.startsWith('<?xml')) {
          console.log('📥 收到 XML 格式的历史记录响应');
          console.log('📄 原始 XML（前 1000 字符）:', trimmed.substring(0, 1000));

          try {
            const parsed = await this.parseXmlResponse(payload);
            console.log('✅ XML 解析成功，完整结构:', JSON.stringify(parsed, null, 2));

            // 处理 "-" 值（表示没有数据）
            const normalizeValue = (val: any): string => {
              if (val === '-' || val === '' || val === null || val === undefined) {
                return '0';
              }
              return String(val);
            };

            return {
              ...parsed,
              total_gold: normalizeValue(parsed.total_gold),
              total_vgold: normalizeValue(parsed.total_vgold),
              total_winloss: normalizeValue(parsed.total_winloss),
              total_winloss_calss: parsed.total_winloss_calss || 'winloss_black',
              history: parsed.history || []
            };
          } catch (xmlError: any) {
            console.error('❌ XML 解析失败:', xmlError?.message || xmlError);
            throw new Error('历史记录响应格式错误');
          }
        }

        // 尝试解析 JSON 响应（向后兼容）
        const cleaned = trimmed.replace(/^\uFEFF/, '');
        try {
          payload = JSON.parse(cleaned);
          console.log('✅ 历史记录响应（JSON）:', JSON.stringify(payload).substring(0, 500));
          return payload;
        } catch (parseError: any) {
          console.warn('⚠️ 未知的响应格式:', trimmed);
          // 返回空数据而不是抛出错误
          return {
            total_gold: '0',
            total_vgold: '0',
            total_winloss: '0',
            history: []
          };
        }
      }

      console.log('✅ 历史记录响应:', JSON.stringify(payload).substring(0, 500));
      return payload;
    } catch (error: any) {
      console.error('❌ 获取历史记录失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取今日下注记录
   * @param params 查询参数
   */
  async getTodayWagers(params: {
    gtype?: string;
    chk_cw?: string;
  } = {}): Promise<any> {
    console.log(`📋 获取今日下注记录...`);

    if (!this.uid) {
      throw new Error('未登录，无法获取今日下注');
    }

    const timestamp = Date.now();
    const requestParams = new URLSearchParams({
      p: 'get_today_wagers',
      uid: this.uid,
      langx: 'zh-cn',
      LS: 'g',
      selGtype: params.gtype || 'ALL',
      chk_cw: params.chk_cw || 'N',
      ts: timestamp.toString(),
      format: 'json',
      db_slow: 'N',
    });

    try {
      const response = await this.httpClient.post('/transform.php', requestParams.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.cookies,
        },
      });

      console.log('✅ 今日下注响应:', JSON.stringify(response.data).substring(0, 500));
      return response.data;
    } catch (error: any) {
      console.error('❌ 获取今日下注失败:', error.message);
      throw error;
    }
  }

  /**
   * 通用 fetch 方法（用于获取 HTML 页面等）
   */
  async fetch(url: string, options: any = {}): Promise<any> {
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;

    console.log(`🔧 fetch() - 当前 Cookie: ${this.cookies || '(无)'}`);
    console.log(`🔧 fetch() - 当前 UID: ${this.uid || '(无)'}`);

    const config: any = {
      method: options.method || 'GET',
      url: fullUrl,
      headers: {
        ...this.httpClient.defaults.headers,
        ...options.headers,
      },
    };

    if (options.body) {
      config.data = options.body;
    }

    try {
      const response = await this.httpClient.request(config);
      console.log(`🔧 fetch() - 响应状态: ${response.status}`);
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        text: async () => response.data,
        json: async () => response.data,
      };
    } catch (error: any) {
      console.error(`🔧 fetch() - 请求失败:`, error.message);
      return {
        ok: false,
        status: error.response?.status || 500,
        text: async () => error.response?.data || '',
        json: async () => ({}),
      };
    }
  }
}
