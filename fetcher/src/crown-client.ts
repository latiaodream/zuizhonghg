import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import https from 'https';

interface LoginResult {
  success: boolean;
  uid?: string;
  error?: string;
}

interface FetchResult {
  success: boolean;
  matches: any[];
  timestamp: number;
  error?: string;
}

export class CrownClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private uid: string | null = null;
  private version: string = '2024102801';
  private client: AxiosInstance;
  private sessionFile: string;
  private loginTime: number = 0;
  private lastEnrichByShowtype: Record<string, number> = {}; // 各 showtype 最近一次获取更多盘口的时间
  private loginFailCount: number = 0; // 登录失败次数
  private maxLoginAttempts: number = 2; // 最大登录尝试次数

  constructor(config: { baseUrl: string; username: string; password: string; dataDir: string }) {
    this.baseUrl = config.baseUrl;
    this.username = config.username;
    this.password = config.password;
    this.sessionFile = path.join(config.dataDir, 'session.json');

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      // 禁用 SSL 证书验证（解决证书过期问题）
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });

    // 加载已保存的会话
    this.loadSession();
  }

  /**
   * 加载已保存的会话
   */
  private loadSession(): void {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const data = JSON.parse(fs.readFileSync(this.sessionFile, 'utf-8'));
        if (data.uid && data.loginTime && Date.now() - data.loginTime < 7200000) {
          this.uid = data.uid;
          this.loginTime = data.loginTime;
          console.log(`✅ 加载已保存的会话: UID=${this.uid}, 登录时间=${new Date(this.loginTime).toLocaleString()}`);
        } else {
          console.log('⚠️ 会话已过期，需要重新登录');
        }
      }
    } catch (error) {
      console.error('❌ 加载会话失败:', error);
    }
  }

  /**
   * 保存会话到文件
   */
  private saveSession(): void {
    try {
      const dir = path.dirname(this.sessionFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.sessionFile,
        JSON.stringify({
          uid: this.uid,
          loginTime: this.loginTime,
        })
      );
      console.log('✅ 会话已保存');
    } catch (error) {
      console.error('❌ 保存会话失败:', error);
    }
  }

  /**
   * 获取 BlackBox（从皇冠站点获取）
   */
  private async getBlackBox(): Promise<string> {
    try {
      const response = await this.client.get('/app/member/FT_browse/index.php?rtype=r&langx=zh-cn&mtype=3');
      const html = response.data;
      const match = html.match(/var\s+BETKEY\s*=\s*['"]([^'"]+)['"]/);
      if (match) {
        return match[1];
      }
    } catch (error) {
      console.error('⚠️ 获取 BlackBox 失败');
    }
    // 返回默认值
    return this.generateBlackBox();
  }

  /**
   * 解析 XML 响应
   */
  private parseXmlResponse(xml: string): any {
    const result: any = {};

    // 提取所有标签内容
    const tagRegex = /<(\w+)>([^<]*)<\/\1>/g;
    let match;
    while ((match = tagRegex.exec(xml)) !== null) {
      result[match[1].toLowerCase()] = match[2];
    }

    return result;
  }

  /**
   * 登录
   */
  async login(): Promise<LoginResult> {
    try {
      console.log(`🔐 开始登录: ${this.username}`);

      // 清除旧的会话数据
      this.uid = null;
      this.loginTime = 0;

      // 先获取最新版本号
      await this.updateVersion();

      // 获取 BlackBox（使用生成的假 BlackBox，因为没有会话无法获取真实的）
      const blackbox = this.generateBlackBox();
      console.log(`🔐 使用生成的 BlackBox: ${blackbox.substring(0, 20)}...`);

      // Base64 编码 UserAgent
      const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
      const encodedUA = Buffer.from(userAgent).toString('base64');

      const params = new URLSearchParams({
        p: 'chk_login',
        langx: 'zh-cn',
        ver: this.version,
        username: this.username,
        password: this.password,
        app: 'N',
        auto: 'CFHFID',
        blackbox,
        userAgent: encodedUA,
      });

      const response = await this.client.post(`/transform.php?ver=${this.version}`, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const text = response.data;
      const data = this.parseXmlResponse(text);

      console.log('📥 登录响应:', {
        status: data.status,
        msg: data.msg,
        username: data.username,
        uid: data.uid,
      });

      // 检查登录失败
      if (data.msg && data.msg.includes('密码错误次数过多')) {
        return { success: false, error: '密码错误次数过多，请联系您的上线寻求协助。' };
      }
      if (data.msg && (data.msg.includes('账号或密码错误') || data.msg.includes('帐号或密码错误'))) {
        return { success: false, error: '账号或密码错误' };
      }
      if (data.msg && data.msg.includes('账号已被锁定')) {
        return { success: false, error: '账号已被锁定' };
      }

      // 提取 UID
      if (data.uid) {
        this.uid = data.uid;
        this.loginTime = Date.now();
        this.saveSession();
        console.log(`✅ 登录成功: UID=${this.uid}`);
        return { success: true, uid: this.uid || undefined };
      }

      console.log('❌ 无法从响应中提取 UID');
      return { success: false, error: data.msg || '无法提取 UID' };
    } catch (error: any) {
      console.error('❌ 登录失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新版本号
   */
  private async updateVersion(): Promise<void> {
    try {
      const response = await this.client.get('/');
      const versionMatch = response.data.match(/ver=(\d+)/);
      if (versionMatch) {
        this.version = versionMatch[1];
      }
    } catch (error) {
      console.error('⚠️ 获取版本号失败，使用默认版本');
    }
  }

  /**
   * 生成 BlackBox 设备指纹
   * 生成一个看起来像真实 BlackBox 的字符串
   * 真实的 BlackBox 格式大概是：0400xxxxx@xxxxx@xxxxx;xxxxx
   */
  private generateBlackBox(): string {
    const timestamp = Date.now();
    const random1 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const random2 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const random3 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const random4 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const random5 = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // 生成一个类似真实 BlackBox 的字符串（长度约 200-300 字符）
    const fakeBlackBox = `0400${random1}${random2}@${random3}@${random4};${random5}${timestamp}`;

    return fakeBlackBox;
  }

  /**
   * 检查会话是否有效
   */
  async checkSession(): Promise<boolean> {
    if (!this.uid) return false;

    // 会话超过 2 小时，需要重新登录
    if (Date.now() - this.loginTime > 7200000) {
      console.log('⚠️ 会话已过期（超过2小时）');
      return false;
    }

    try {
      // 尝试获取赛事列表来验证会话
      const result = await this.fetchMatches();
      return result.success;
    } catch (error) {
      return false;
    }
  }

  /**
   * 确保已登录
   */
  async ensureLoggedIn(): Promise<boolean> {
    if (await this.checkSession()) {
      return true;
    }

    // 检查登录失败次数
    if (this.loginFailCount >= this.maxLoginAttempts) {
      console.log(`⛔ 登录失败次数已达到上限 (${this.loginFailCount}/${this.maxLoginAttempts})，停止尝试登录`);
      return false;
    }

    console.log('🔄 需要重新登录...');
    const result = await this.login();

    if (!result.success) {
      this.loginFailCount++;
      console.log(`❌ 登录失败 (${this.loginFailCount}/${this.maxLoginAttempts})`);

      if (this.loginFailCount >= this.maxLoginAttempts) {
        console.log('⛔ 已达到最大登录尝试次数，停止登录尝试');
      }
    } else {
      // 登录成功，重置失败计数
      this.loginFailCount = 0;
    }

    return result.success;
  }

  /**
   * 解析赛事 XML（使用 fast-xml-parser）
   */
  private parseMatches(xml: string): any[] {
    try {
      const { XMLParser } = require('fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xml);

      const ec = parsed?.serverresponse?.ec;
      if (!ec) {
        return [];
      }

      // 辅助函数：从对象中提取值
      const pickValue = (source: any, candidateKeys: string[]): any => {
        if (!source) return undefined;
        for (const key of candidateKeys) {
          if (source[key] !== undefined) return source[key];
          const attrKey = `@_${key}`;
          if (source[attrKey] !== undefined) return source[attrKey];
          const lowerKey = key.toLowerCase();
          for (const currentKey of Object.keys(source)) {
            if (currentKey.toLowerCase() === lowerKey) {
              return source[currentKey];
            }
            if (currentKey.toLowerCase() === `@_${lowerKey}`) {
              return source[currentKey];
            }
          }
        }
        return undefined;
      };

      const pickString = (source: any, candidateKeys: string[], fallback = ''): string => {
        const value = pickValue(source, candidateKeys);
        if (value === undefined || value === null) return fallback;
        return String(value).trim();
      };

      // 提取所有 game 元素
      const ecArray = Array.isArray(ec) ? ec : [ec];
      const allGames: any[] = [];
      for (const ecItem of ecArray) {
        const games = ecItem?.game;
        if (!games) continue;
        if (Array.isArray(games)) {
          allGames.push(...games);
        } else {
          allGames.push(games);
        }
      }

      // 解析每场比赛
      const matches = allGames.map((game: any) => {
        const gid = pickString(game, ['GID']);
        const ecid = pickString(game, ['ECID']);
        const league = pickString(game, ['LEAGUE']);
        const home = pickString(game, ['TEAM_H', 'TEAM_H_CN', 'TEAM_H_E', 'TEAM_H_TW']);
        const away = pickString(game, ['TEAM_C', 'TEAM_C_CN', 'TEAM_C_E', 'TEAM_C_TW']);
        const scoreH = pickString(game, ['SCORE_H']);
        const scoreC = pickString(game, ['SCORE_C']);
        const score = (scoreH || scoreC) ? `${scoreH || '0'}-${scoreC || '0'}` : '';

        // 解析盘口数据
        const markets: any = {
          full: {},
          half: {},
        };

        // 独赢盘口（全场）
        const moneylineHome = pickString(game, ['IOR_RMH', 'IOR_MH']);
        const moneylineDraw = pickString(game, ['IOR_RMN', 'IOR_MN', 'IOR_RMD']);
        const moneylineAway = pickString(game, ['IOR_RMC', 'IOR_MC']);
        if (moneylineHome || moneylineDraw || moneylineAway) {
          markets.moneyline = { home: moneylineHome, draw: moneylineDraw, away: moneylineAway };
          markets.full.moneyline = { home: moneylineHome, draw: moneylineDraw, away: moneylineAway };
        }

        // 全场让球盘口（支持多个盘口）
        const handicapLines: Array<{ line: string; home: string; away: string; wtype?: string }> = [];
        const handicapLine = pickString(game, ['RATIO_RE', 'RATIO_R']);
        const handicapHome = pickString(game, ['IOR_REH', 'IOR_RH']);
        const handicapAway = pickString(game, ['IOR_REC', 'IOR_RC']);
        if (handicapLine || handicapHome || handicapAway) {
          // 根据字段来源判断 wtype，避免把今日(R) 与 滚球(RE) 混为同一键，导致重复或误并
          const hasRE = !!pickString(game, ['RATIO_RE']);
          const hasR = !!pickString(game, ['RATIO_R']);
          const baseWtype = hasRE ? 'RE' : hasR ? 'R' : 'RE';
          handicapLines.push({ line: handicapLine, home: handicapHome, away: handicapAway, wtype: baseWtype });
        }
        if (handicapLines.length > 0) {
          markets.handicap = { ...handicapLines[0] };
          markets.full.handicap = { ...handicapLines[0] };
          markets.full.handicapLines = handicapLines;
        }

        // 全场大小球盘口（仅主大小球，额外的队伍进球盘口不混入）
        const ouLines: Array<{ line: string; over: string; under: string; wtype?: string }> = [];
        // 主大小球盘口（ROU 系列）：大=IOR_ROUC，小=IOR_ROUH
        const ouLineMain = pickString(game, ['RATIO_ROUO', 'RATIO_OUO', 'RATIO_ROUU', 'RATIO_OUU']);
        const ouOverMain = pickString(game, ['IOR_ROUC', 'IOR_OUC']);
        const ouUnderMain = pickString(game, ['IOR_ROUH', 'IOR_OUH']);
        if (ouLineMain || ouOverMain || ouUnderMain) {
          const hasROU = !!pickString(game, ['RATIO_ROUO', 'RATIO_ROUU']);
          const hasOU = !!pickString(game, ['RATIO_OUO', 'RATIO_OUU']);
          const baseWtype = hasROU ? 'ROU' : hasOU ? 'OU' : 'ROU';
          ouLines.push({ line: ouLineMain, over: ouOverMain, under: ouUnderMain, wtype: baseWtype });
        }
        // 注意：不要把 ROUHO/ROUHU（队伍1进球）或 ROUCO/ROUCU（队伍2进球）混入全场大小球
        if (ouLines.length > 0) {
          markets.ou = { ...ouLines[0] };
          markets.full.ou = { ...ouLines[0] };
          markets.full.overUnderLines = ouLines;
        }

        // 半场独赢
        const halfMoneylineHome = pickString(game, ['IOR_HRMH', 'IOR_HMH']);
        const halfMoneylineDraw = pickString(game, ['IOR_HRMN', 'IOR_HMN']);
        const halfMoneylineAway = pickString(game, ['IOR_HRMC', 'IOR_HMC']);
        if (halfMoneylineHome || halfMoneylineDraw || halfMoneylineAway) {
          markets.half.moneyline = { home: halfMoneylineHome, draw: halfMoneylineDraw, away: halfMoneylineAway };
        }

        // 半场让球盘口
        const halfHandicapLines: Array<{ line: string; home: string; away: string; wtype?: string }> = [];
        const halfHandicapLine = pickString(game, ['RATIO_HRE']);
        const halfHandicapHome = pickString(game, ['IOR_HREH']);
        const halfHandicapAway = pickString(game, ['IOR_HREC']);
        if (halfHandicapLine || halfHandicapHome || halfHandicapAway) {
          halfHandicapLines.push({ line: halfHandicapLine, home: halfHandicapHome, away: halfHandicapAway, wtype: 'HRE' });
        }
        if (halfHandicapLines.length > 0) {
          markets.half.handicap = { ...halfHandicapLines[0] };
          markets.half.handicapLines = halfHandicapLines;
        }

        // 半场大小球盘口
        const halfOuLines: Array<{ line: string; over: string; under: string; wtype?: string }> = [];
        const halfOuLine = pickString(game, ['RATIO_HROUO', 'RATIO_HROUU']);
        const halfOuOver = pickString(game, ['IOR_HROUC']);
        const halfOuUnder = pickString(game, ['IOR_HROUH']);
        if (halfOuLine || halfOuOver || halfOuUnder) {
          halfOuLines.push({ line: halfOuLine, over: halfOuOver, under: halfOuUnder, wtype: 'HROU' });
        }
        if (halfOuLines.length > 0) {
          markets.half.ou = { ...halfOuLines[0] };
          markets.half.overUnderLines = halfOuLines;
        }

        // 盘口计数
        const counts = {
          handicap: pickString(game, ['R_COUNT']),
          overUnder: pickString(game, ['OU_COUNT']),
          correctScore: pickString(game, ['PD_COUNT']),
          corners: pickString(game, ['CN_COUNT']),
        };
        markets.counts = counts;

        const datetime = pickString(game, ['DATETIME', 'TIME']);
        const running = pickString(game, ['RUNNING', 'STATUS']);
        const retimeset = pickString(game, ['RETIMESET', 'TIMESET']); // 比赛阶段+时间，如 "2H^93:26"

        // 转换时间格式：将 "11-07 01:00" 转换为 ISO 格式
        const convertToISO = (timeStr: string): string => {
          if (!timeStr) return '';
          try {
            // 格式: "11-07 01:00" 或 "11-07 01:00:00"
            const parts = timeStr.trim().split(/[\s-:]+/);
            if (parts.length >= 3) {
              const month = parts[0].padStart(2, '0');
              const day = parts[1].padStart(2, '0');
              const hour = parts[2]?.padStart(2, '0') || '00';
              const minute = parts[3]?.padStart(2, '0') || '00';
              const second = parts[4]?.padStart(2, '0') || '00';

              // 使用当前年份
              const year = new Date().getFullYear();

              // 构造 ISO 格式
              return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
            }
          } catch (e) {
            console.error('时间转换失败:', timeStr, e);
          }
          return timeStr;
        };

        const isoDatetime = convertToISO(datetime);

        return {
          gid,
          ecid,
          league,
          league_name: league,
          home,
          away,
          team_h: home,
          team_c: away,
          score,
          current_score: score,
          time: isoDatetime,
          datetime: isoDatetime,
          match_time: isoDatetime,
          timer: isoDatetime,
          status: running,
          state: running,
          period: retimeset || (running === '1' || running === 'Y' ? '滚球' : running === '0' || running === 'N' ? '未开赛' : ''),
          clock: retimeset || '',
          markets,
          raw: game,
        };
      });

      return matches;
    } catch (error) {
      console.error('❌ 解析赛事失败:', error);
      return [];
    }
  }

  /**
   * 抓取赛事列表（支持不同类型）
   * @param options 抓取选项
   * @param options.showtype 显示类型 (live=滚球, today=今日, early=早盘)
   * @param options.gtype 比赛类型 (ft=足球, bk=篮球等)
   * @param options.rtype 盘口类型 (rb=滚球, r=非滚球)
   */
  async fetchMatches(options?: {
    showtype?: string;
    gtype?: string;
    rtype?: string;
  }): Promise<FetchResult> {
    try {
      if (!this.uid) {
        return { success: false, matches: [], timestamp: Date.now(), error: '未登录' };
      }

      const showtype = options?.showtype || 'live';
      const gtype = options?.gtype || 'ft';
      const rtype = options?.rtype || (showtype === 'live' ? 'rb' : 'r');

      const timestamp = Date.now().toString();

      const params = new URLSearchParams({
        uid: this.uid,
        ver: this.version,
        langx: 'zh-cn',
        p: 'get_game_list',
        p3type: '',
        date: '',
        gtype,
        showtype,
        rtype,
        ltype: '3',
        filter: '',
        cupFantasy: 'N',
        sorttype: 'L',
        specialClick: '',
        isFantasy: 'N',
        ts: timestamp,
      });

      const response = await this.client.post(`/transform.php?ver=${this.version}`, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const xml = response.data;

      // 检查是否是 doubleLogin 错误
      if (xml.includes('doubleLogin')) {
        console.log('⚠️ 检测到重复登录，会话已失效');
        this.uid = null; // 清除 UID，下次会重新登录
        return { success: false, matches: [], timestamp: Date.now(), error: 'doubleLogin' };
      }

      // 解析赛事
      const matches = this.parseMatches(xml);

      // 为每场比赛添加 showtype 标记
      matches.forEach((match: any) => {
        match.showtype = showtype;
        match.source_showtype = showtype;
      });

      const now = Date.now();
      const last = this.lastEnrichByShowtype[showtype] || 0;
      if (now - last > 5000) {
        this.lastEnrichByShowtype[showtype] = now;
        await this.enrichMatches(matches, { showtype, gtype });
      }

      return {
        success: true,
        matches,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      console.error('❌ 抓取失败:', error.message);
      return { success: false, matches: [], timestamp: Date.now(), error: error.message };
    }
  }

  /**
   * 获取更多盘口信息
   */
  private mergeLines(existing: any[] | undefined, incoming: any[] | undefined) {
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return existing || [];
    }
    if (!Array.isArray(existing) || existing.length === 0) {
      return incoming;
    }
    const map = new Map<string, any>();
    const makeKey = (item: any, idx: number) => {
      const wtype = (item?.wtype || '').toString();
      const line = (item?.line || item?.ratio || `${idx}`).toString();
      return `${wtype}|${line}`;
    };
    existing.forEach((item, idx) => {
      const key = makeKey(item, idx);
      map.set(key, item);
    });
    incoming.forEach((item, idx) => {
      const key = makeKey(item, (existing?.length || 0) + idx);
      map.set(key, { ...map.get(key), ...item });
    });
    return Array.from(map.values());
  }

  private async enrichMatches(matches: any[], options: { showtype: string; gtype: string }): Promise<void> {
    if (!Array.isArray(matches) || matches.length === 0) return;
    const showtype = (options.showtype || '').toLowerCase();
    const gtype = options.gtype || 'ft';
    const isRB = showtype === 'live' ? 'Y' : 'N';

    const candidates = matches
      .filter((match) => {
        // 今日/早盘：对所有比赛都尝试获取多盘口（因为 get_game_list 不返回盘口数量信息）
        if (showtype === 'today' || showtype === 'early') {
          return true;
        }
        // 滚球：只对有多盘口标记的比赛进行补全
        const counts = match?.markets?.counts || {};
        const handicapCount = Number(counts.handicap || counts.R_COUNT || counts.r_count || 0);
        const ouCount = Number(counts.overUnder || counts.OU_COUNT || counts.ou_count || 0);
        const fullHandicap = match?.markets?.full?.handicapLines;
        const fullOu = match?.markets?.full?.overUnderLines;
        return (
          (handicapCount > 1 && (!Array.isArray(fullHandicap) || fullHandicap.length < handicapCount)) ||
          (ouCount > 1 && (!Array.isArray(fullOu) || fullOu.length < ouCount))
        );
      })
      // 优先抓取滚球比赛，然后按盘口数量降序，尽量覆盖你当前关注的比赛
      .sort((a: any, b: any) => {
        const aRun = (a.state === '1' || a.state === 'Y' || a.running === '1' || a.running === 'Y' || a.period === '滚球') ? 1 : 0;
        const bRun = (b.state === '1' || b.state === 'Y' || b.running === '1' || b.running === 'Y' || b.period === '滚球') ? 1 : 0;
        if (bRun !== aRun) return bRun - aRun;
        const ac = Number(a?.markets?.counts?.handicap || a?.markets?.counts?.R_COUNT || 0) +
                   Number(a?.markets?.counts?.overUnder || a?.markets?.counts?.OU_COUNT || 0);
        const bc = Number(b?.markets?.counts?.handicap || b?.markets?.counts?.R_COUNT || 0) +
                   Number(b?.markets?.counts?.overUnder || b?.markets?.counts?.OU_COUNT || 0);
        return bc - ac;
      })
      .slice(0, 50);

    if (candidates.length === 0) {
      return;
    }

    console.log(`🔄 [${showtype}] 开始补全多盘口，候选比赛数: ${candidates.length}`);
    let __enrichSuccess = 0;


    for (const match of candidates) {
      try {
        // 兼容 live(ecid) 与 today/early(gid) 两种ID
        const gid = match.ecid || match.gid || match.raw?.ECID || match.raw?.GID || match.raw?.gid || match.raw?.ecid;
        const lid = match.raw?.LID || match.raw?.lid || match.raw?.['@_LID'] || match.league_id || match.leagueId;

        if (!gid) continue;

        const moreXml = await this.getGameMore({
          gid: String(gid),    // 注意：接口字段名是 ecid，这里参数名沿用 gid 表示“比赛唯一ID”
          lid: String(lid),
          gtype,
          showtype,
          ltype: '3',
          isRB,
        });

        if (moreXml) {
          try {
            // 将最近一次的更多盘口响应写入调试文件（防止日志过大，仅保留最近一次）
            if (showtype !== 'live') {
              const dir = path.join(path.dirname(this.sessionFile));
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              const file = path.join(dir, 'last-more.xml');
              fs.writeFileSync(file, String(moreXml).slice(0, 200000));
            }
          } catch {}

          const { handicapLines, overUnderLines, halfHandicapLines, halfOverUnderLines, cornerHandicapLines, cornerOverUnderLines, halfMoneyline, homeTeam, awayTeam, matchTime, league } = this.parseMoreMarkets(moreXml);

          // 更新队伍名称和比赛信息（如果原始数据中缺失）
          if (homeTeam && !match.homeTeam) {
            match.homeTeam = homeTeam;
            match.home = homeTeam;
          }
          if (awayTeam && !match.awayTeam) {
            match.awayTeam = awayTeam;
            match.away = awayTeam;
          }
          if (matchTime && !match.matchTime) {
            match.matchTime = matchTime;
            match.datetime = matchTime;
          }
          if (league && !match.league) {
            match.league = league;
          }

          if (!match.markets.full) {
            match.markets.full = {};
          }
          if (!match.markets.half) {
            match.markets.half = {};
          }

          // 全场盘口
          if (handicapLines.length > 0) {
            const merged = this.mergeLines(match.markets.full.handicapLines, handicapLines);
            match.markets.full.handicapLines = merged;
            match.markets.handicap = merged[0];
            match.markets.full.handicap = merged[0];
          }

          if (overUnderLines.length > 0) {
            const merged = this.mergeLines(match.markets.full.overUnderLines, overUnderLines);
            match.markets.full.overUnderLines = merged;
            match.markets.ou = merged[0];
            match.markets.full.ou = merged[0];
          }

          // 半场盘口
          if (halfHandicapLines.length > 0) {
            const merged = this.mergeLines(match.markets.half.handicapLines, halfHandicapLines);
            match.markets.half.handicapLines = merged;
            match.markets.half.handicap = merged[0];
          }

          if (halfOverUnderLines.length > 0) {
            const merged = this.mergeLines(match.markets.half.overUnderLines, halfOverUnderLines);
            match.markets.half.overUnderLines = merged;
            match.markets.half.ou = merged[0];
          }

          // 半场独赢（若更多玩法里也带了，则补全/覆盖）
          if (halfMoneyline && (halfMoneyline.home || halfMoneyline.draw || halfMoneyline.away)) {
            match.markets.half.moneyline = { ...(match.markets.half.moneyline || {}), ...halfMoneyline };
          }

          // 角球盘口
          if (!match.markets.corners) {
            match.markets.corners = {};
          }

          if (cornerHandicapLines.length > 0) {
            const merged = this.mergeLines(match.markets.corners.handicapLines, cornerHandicapLines);
            match.markets.corners.handicapLines = merged;
            match.markets.corners.handicap = merged[0];
          }

          if (cornerOverUnderLines.length > 0) {
            const merged = this.mergeLines(match.markets.corners.overUnderLines, cornerOverUnderLines);
            match.markets.corners.overUnderLines = merged;
            match.markets.corners.ou = merged[0];
          }

          // debug 总结日志（每场一次）
          const __fullH = match?.markets?.full?.handicapLines?.length || 0;
          const __fullOU = match?.markets?.full?.overUnderLines?.length || 0;
          const __halfH = match?.markets?.half?.handicapLines?.length || 0;
          const __halfOU = match?.markets?.half?.overUnderLines?.length || 0;
          const __cornerH = match?.markets?.corners?.handicapLines?.length || 0;
          const __cornerOU = match?.markets?.corners?.overUnderLines?.length || 0;

          if (__fullH + __fullOU + __halfH + __halfOU + __cornerH + __cornerOU > 0) {
            __enrichSuccess++;
            console.log(`✅ [${match.home} vs ${match.away}] H:${__fullH} OU:${__fullOU} HH:${__halfH} HOU:${__halfOU} CH:${__cornerH} COU:${__cornerOU}`);
          } else {
            console.log(`⚠️ API返回空: ${match.home} vs ${match.away} (gid=${gid}, lid=${lid})`);
          }
        }

        // 延迟50ms避免请求过快
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        // 忽略单个比赛的错误
      }
    console.log(`✅ [${showtype}] 多盘口补全完成: ${__enrichSuccess}/${candidates.length}`);

    }
  }

  /**
   * 获取比赛的所有玩法和盘口
   */
  private async getGameMore(params: {
    gid: string;
    lid: string;
    gtype: string;
    showtype: string;
    ltype: string;
    isRB: string;
  }): Promise<string | null> {
    try {
      if (!this.uid) return null;

      const buildParams = (opt: { useEcid?: boolean; useGid?: boolean; includeLid?: boolean; langx?: string; from?: string; filter?: string }) => {
        const p = new URLSearchParams({
          uid: this.uid || '',
          ver: this.version,
          langx: opt.langx ?? 'zh-cn',
          p: 'get_game_more',
          gtype: params.gtype,
          showtype: params.showtype,
          ltype: params.ltype,
          isRB: params.isRB,
          specialClick: '',
          // mode: 'NORMAL',  // 移除 mode 参数以获取所有盘口
          from: opt.from ?? 'game_more',
          filter: opt.filter ?? 'All',
          ts: Date.now().toString(),
        });
        if (opt.includeLid !== false && params.lid) p.set('lid', params.lid);
        if (opt.useEcid) p.set('ecid', params.gid);
        if (opt.useGid) p.set('gid', params.gid);
        return p;
      };

      const attempts = [
        { label: 'ecid+gid+lid zh-cn', useEcid: true, useGid: true, includeLid: true, langx: 'zh-cn' },
        { label: 'gid+lid zh-cn', useEcid: false, useGid: true, includeLid: true, langx: 'zh-cn' },
        { label: 'ecid only zh-cn', useEcid: true, useGid: false, includeLid: false, langx: 'zh-cn' },
        { label: 'gid only zh-cn', useEcid: false, useGid: true, includeLid: false, langx: 'zh-cn' },
        { label: 'gid only zh-tw', useEcid: false, useGid: true, includeLid: false, langx: 'zh-tw' },
      ];

      for (const att of attempts) {
        const requestParams = buildParams(att);
        const res = await this.client.post(`/transform.php?ver=${this.version}`, requestParams.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const data = res?.data;
        if (data && typeof data === 'string') {
          const hasXml = data.includes('<serverresponse');
          const len = data.length;
          if (params.showtype !== 'live') {
            console.log(`ℹ️ get_game_more(${params.showtype}) [${att.label}] -> xml=${hasXml?'Y':'N'} len=${len}`);
          }
          if (hasXml) return data;
        }
        await new Promise(r => setTimeout(r, 50));
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 解析 get_game_more 返回的多个盘口
   */
  private parseMoreMarkets(xml: string): {
    handicapLines: any[];
    overUnderLines: any[];
    halfHandicapLines: any[];
    halfOverUnderLines: any[];
    cornerHandicapLines: any[];
    cornerOverUnderLines: any[];
    halfMoneyline?: { home?: string; draw?: string; away?: string };
    homeTeam?: string;
    awayTeam?: string;
    matchTime?: string;
    league?: string;
  } {
    try {
      const { XMLParser } = require('fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xml);

      const games = parsed?.serverresponse?.game;
      if (!games) {
        return {
          handicapLines: [],
          overUnderLines: [],
          halfHandicapLines: [],
          halfOverUnderLines: [],
          cornerHandicapLines: [],
          cornerOverUnderLines: [],
          halfMoneyline: undefined
        };
      }

      const gameArray = Array.isArray(games) ? games : [games];

      const handicapLines: any[] = [];
      const overUnderLines: any[] = [];
      const halfHandicapLines: any[] = [];
      const halfOverUnderLines: any[] = [];
      const cornerHandicapLines: any[] = [];
      const cornerOverUnderLines: any[] = [];
      let halfMoneyline: { home?: string; draw?: string; away?: string } | undefined;
      let homeTeam: string | undefined;
      let awayTeam: string | undefined;
      let matchTime: string | undefined;
      let league: string | undefined;

      const pickString = (source: any, candidateKeys: string[], fallback = ''): string => {
        if (!source) return fallback;
        for (const key of candidateKeys) {
          if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
            return String(source[key]).trim();
          }
          const attrKey = `@_${key}`;
          if (source[attrKey] !== undefined && source[attrKey] !== null && source[attrKey] !== '') {
            return String(source[attrKey]).trim();
          }
        }
        return fallback;
      };

      for (const game of gameArray) {
        // 提取队伍名称和比赛信息（只在第一个 game 节点提取一次）
        if (!homeTeam) {
          homeTeam = pickString(game, ['TEAM_H', 'team_h', 'TEAM_H_CN', 'team_h_cn', 'TEAM_H_E', 'TEAM_H_TW']);
        }
        if (!awayTeam) {
          awayTeam = pickString(game, ['TEAM_C', 'team_c', 'TEAM_C_CN', 'team_c_cn', 'TEAM_C_E', 'TEAM_C_TW']);
        }
        if (!matchTime) {
          matchTime = pickString(game, ['DATETIME', 'datetime', 'DATE', 'date']);
        }
        if (!league) {
          league = pickString(game, ['LEAGUE', 'league']);
        }

        const wtypeRaw = pickString(game, ['WTYPE', 'wtype', 'type']);
        const rtypeRaw = pickString(game, ['RTYPE', 'rtype']);
        const wtype = (wtypeRaw || rtypeRaw || '').toUpperCase();
        const gid = pickString(game, ['@_id', 'gid', 'GID']);
        const master = pickString(game, ['@_master', 'master']);
        const mode = pickString(game, ['@_mode', 'mode']);
        const gopen = pickString(game, ['gopen', 'GOPEN']);

        // 判断盘口类型
        const ptype = pickString(game, ['@_ptype', 'ptype']);
        const teamH = pickString(game, ['TEAM_H', 'team_h']);
        const teamC = pickString(game, ['TEAM_C', 'team_c']);

        const isCorner = mode === 'CN' || ptype?.includes('角球') || teamH?.includes('角球') || teamC?.includes('角球');
        const isCard = mode === 'RN' || ptype?.includes('罰牌') || teamH?.includes('罰牌') || teamC?.includes('罰牌');

        // 跳过罚牌数盘口
        if (isCard) {
          continue;
        }

        // 如果是角球盘口，解析角球数据
        if (isCorner) {
          // 角球让球盘口
          const cornerHandicapLine = pickString(game, ['RATIO_CNRH', 'RATIO_CNRC', 'ratio_cnrh', 'ratio_cnrc', 'ratio']);
          const cornerHandicapHome = pickString(game, ['IOR_CNRH', 'ior_CNRH', 'ior_cnrh']);
          const cornerHandicapAway = pickString(game, ['IOR_CNRC', 'ior_CNRC', 'ior_cnrc']);

          if (cornerHandicapLine && cornerHandicapHome && cornerHandicapAway) {
            cornerHandicapLines.push({
              line: cornerHandicapLine,
              home: cornerHandicapHome,
              away: cornerHandicapAway,
            });
          }

          // 角球大小球盘口
          const cornerOuLine = pickString(game, ['RATIO_CNOUO', 'RATIO_CNOUU', 'ratio_cnouo', 'ratio_cnouu', 'ratio_o', 'ratio_u']);
          const cornerOuOver = pickString(game, ['IOR_CNOUH', 'ior_CNOUH', 'ior_cnouh']);
          const cornerOuUnder = pickString(game, ['IOR_CNOUC', 'ior_CNOUC', 'ior_cnouc']);

          if (cornerOuLine && cornerOuOver && cornerOuUnder) {
            cornerOverUnderLines.push({
              line: cornerOuLine,
              over: cornerOuOver,
              under: cornerOuUnder,
            });
          }

          continue; // 处理完角球后跳过后续的进球盘口逻辑
        }


        // 全场让球（兼容 滚球RE 与 今日/早盘R；同时兼容 get_game_more 响应中的简写 ratio）
        const hasRE = !!pickString(game, ['RATIO_RE', 'ratio_re']);
        const hasR = !!pickString(game, ['RATIO_R', 'ratio_r', 'ratio']);
        const handicapLine = pickString(game, ['RATIO_RE', 'ratio_re', 'RATIO_R', 'ratio_r', 'ratio']);
        const handicapHome = pickString(game, ['IOR_REH', 'ior_REH', 'IOR_RH', 'ior_RH', 'ior_rh']);
        const handicapAway = pickString(game, ['IOR_REC', 'ior_REC', 'IOR_RC', 'ior_RC', 'ior_rc']);
        if ((hasRE || hasR) && handicapLine && (handicapHome || handicapAway)) {
          const hw = (wtype || (hasRE ? 'RE' : hasR ? 'R' : 'RE')) as string;
          handicapLines.push({ line: handicapLine, home: handicapHome, away: handicapAway, wtype: hw });
        }

        // 全场大小球（仅主大小球，排除角球/球队进球等）
        const hasROU = !!pickString(game, ['RATIO_ROUO', 'ratio_rouo', 'RATIO_ROUU', 'ratio_rouu']);
        const hasOU = !!pickString(game, ['RATIO_OUO', 'ratio_ouo', 'RATIO_OUU', 'ratio_ouu', 'ratio_o', 'ratio_u']);
        const ouLine = pickString(game, [
          'RATIO_ROUO', 'ratio_rouo', 'RATIO_ROUU', 'ratio_rouu',
          'RATIO_OUO', 'ratio_ouo', 'RATIO_OUU', 'ratio_ouu',
          'ratio_o', 'ratio_u'
        ]);
        const ouOver = pickString(game, ['IOR_ROUC', 'ior_ROUC', 'IOR_OUC', 'ior_OUC', 'ior_ouc']);
        const ouUnder = pickString(game, ['IOR_ROUH', 'ior_ROUH', 'IOR_OUH', 'ior_OUH', 'ior_ouh']);
        if ((hasROU || hasOU) && ouLine && (ouOver || ouUnder)) {
          const __nums = (ouLine || '').match(/[0-9.]+/g) || [];
          const __avg = __nums.length ? __nums.map(parseFloat).reduce((a,b)=>a+b,0)/__nums.length : NaN;
          if (!(Number.isFinite(__avg) && __avg > 6)) {
            const ow = (wtype || (hasROU ? 'ROU' : hasOU ? 'OU' : 'ROU')) as string;
            overUnderLines.push({ line: ouLine, over: ouOver, under: ouUnder, wtype: ow });
          }
        }

        // 半场让球（兼容 HRE 与 HR；同时兼容 get_game_more 的 hratio）
        const hasHRE = !!pickString(game, ['RATIO_HRE', 'ratio_hre']);
        const hasHR = !!pickString(game, ['RATIO_HR', 'ratio_hr', 'hratio']);
        const halfHandicapLine = pickString(game, ['RATIO_HRE', 'ratio_hre', 'RATIO_HR', 'ratio_hr', 'hratio']);
        const halfHandicapHome = pickString(game, ['IOR_HREH', 'ior_HREH', 'IOR_HRH', 'ior_HRH', 'ior_hrh']);
        const halfHandicapAway = pickString(game, ['IOR_HREC', 'ior_HREC', 'IOR_HRC', 'ior_HRC', 'ior_hrc']);
        if ((hasHRE || hasHR) && halfHandicapLine && (halfHandicapHome || halfHandicapAway)) {
          const hw = (wtype || (hasHRE ? 'HRE' : hasHR ? 'HR' : 'HRE')) as string;
          halfHandicapLines.push({ line: halfHandicapLine, home: halfHandicapHome, away: halfHandicapAway, wtype: hw });
        }

        // 半场大小球（仅主大小球，排除角球/球队进球等）
        const hasHROU = !!pickString(game, ['RATIO_HROUO', 'ratio_hrouo', 'RATIO_HROUU', 'ratio_hrouu']);
        const hasHOU = !!pickString(game, ['RATIO_HOUO', 'ratio_houo', 'RATIO_HOUU', 'ratio_houu', 'ratio_ho', 'ratio_hu']);
        const halfOuLine = pickString(game, [
          'RATIO_HROUO', 'ratio_hrouo', 'RATIO_HROUU', 'ratio_hrouu',
          'RATIO_HOUO', 'ratio_houo', 'RATIO_HOUU', 'ratio_houu',
          'ratio_ho', 'ratio_hu'
        ]);
        const halfOuOver = pickString(game, ['IOR_HROUC', 'ior_HROUC', 'IOR_HOUC', 'ior_HOUC', 'ior_houc']);
        const halfOuUnder = pickString(game, ['IOR_HROUH', 'ior_HROUH', 'IOR_HOUH', 'ior_HOUH', 'ior_houh']);
        if ((hasHROU || hasHOU) && halfOuLine && (halfOuOver || halfOuUnder)) {
          const __numsH = (halfOuLine || '').match(/[0-9.]+/g) || [];
          const __avgH = __numsH.length ? __numsH.map(parseFloat).reduce((a,b)=>a+b,0)/__numsH.length : NaN;
          if (!(Number.isFinite(__avgH) && __avgH > 3.5)) {
            const how = (wtype || (hasHROU ? 'HROU' : hasHOU ? 'HOU' : 'HROU')) as string;
            halfOverUnderLines.push({ line: halfOuLine, over: halfOuOver, under: halfOuUnder, wtype: how });
          }
        }

        // 半场独赢（来自 get_game_more；兼容 HRM 与 HM）
        const halfMlHome = pickString(game, ['IOR_HRMH', 'ior_HRMH', 'IOR_HMH', 'ior_HMH']);
        const halfMlDraw = pickString(game, ['IOR_HRMN', 'ior_HRMN', 'IOR_HMN', 'ior_HMN']);
        const halfMlAway = pickString(game, ['IOR_HRMC', 'ior_HRMC', 'IOR_HMC', 'ior_HMC']);
        if (halfMlHome || halfMlDraw || halfMlAway) {
          const master = pickString(game, ['@_master', 'master']);
          // 以 master=Y 优先，否则取首个有效项
          if (!halfMoneyline || master === 'Y') {
            halfMoneyline = { home: halfMlHome, draw: halfMlDraw, away: halfMlAway };
          }
        }
      }

      return {
        handicapLines,
        overUnderLines,
        halfHandicapLines,
        halfOverUnderLines,
        cornerHandicapLines,
        cornerOverUnderLines,
        halfMoneyline,
        homeTeam,
        awayTeam,
        matchTime,
        league
      };
    } catch (error) {
      console.error('❌ 解析更多盘口失败:', error);
      return {
        handicapLines: [],
        overUnderLines: [],
        halfHandicapLines: [],
        halfOverUnderLines: [],
        cornerHandicapLines: [],
        cornerOverUnderLines: []
      };
    }
  }
}
