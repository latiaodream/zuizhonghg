import { promises as fs } from 'fs';
import { chromium, Browser, BrowserContext, Page, BrowserContextOptions, Frame, Locator } from 'playwright';
import { CrownAccount } from '../types';
import { query } from '../models/database';
import { CrownApiClient } from './crown-api-client';
import { getRedisClient } from './redis-client';

const PLAYWRIGHT_HEADLESS = (process.env.PLAYWRIGHT_HEADLESS ?? 'true').toLowerCase();
const isHeadless = ['1', 'true', 'yes', 'y'].includes(PLAYWRIGHT_HEADLESS);

const DEFAULT_CROWN_BASE_URL = 'https://hga038.com';
const DEFAULT_BASE_URL_FAIL_COOLDOWN_MS = 60000;
const DEFAULT_BASE_URL_FAIL_THRESHOLD = 5;

interface BetRequest {
  betType: string;
  betOption: string;
  amount: number;
  odds: number;
  platformAmount?: number;
  discount?: number;
  match_id?: number;
  matchId?: number;
  bet_type?: string;
  bet_option?: string;
  crown_match_id?: string;
  crownMatchId?: string;
  home_team?: string;
  homeTeam?: string;
  away_team?: string;
  awayTeam?: string;
  league_name?: string;
  leagueName?: string;
  match_time?: string;
  matchTime?: string;
  match_status?: string;
  matchStatus?: string;
  current_score?: string;
  currentScore?: string;
  match_period?: string;
  matchPeriod?: string;
  market_category?: string;
  marketCategory?: string;
  market_scope?: string;
  marketScope?: string;
  market_side?: string;
  marketSide?: string;
  market_line?: string;
  marketLine?: string;
  market_index?: number;
  marketIndex?: number;
  market_wtype?: string;
  marketWtype?: string;
  market_rtype?: string;
  marketRtype?: string;
  market_chose_team?: string;
  marketChoseTeam?: string;
  spread_gid?: string;  // 盘口专属 gid（用于副盘口）
  spreadGid?: string;
}

interface CrownLoginResult {
  success: boolean;
  message: string;
  sessionInfo?: any;
  needsCredentialChange?: boolean;
}

interface CrownBetResult {
  success: boolean;
  message: string;
  betId?: string;
  actualOdds?: number;
  platformAmount?: number;
  crownAmount?: number;
  rawSelectionId?: string;
  errorCode?: string;  // 皇冠错误代码
}

interface CrownWagerItem {
  ticketId: string;
  gold: string;
  winGold: string;
  resultText?: string;
  score?: string;
  league?: string;
  teamH?: string;
  teamC?: string;
  ballActRet?: string;
  ballActClass?: string;
  wagerDate?: string;
  betWtype?: string;
  rawXml?: string;
  normalizedHome?: string;
  normalizedAway?: string;
  normalizedLeague?: string;
}

interface CrownWagerEvalResult {
  ok: boolean;
  reason?: string;
  xml?: string;
  items?: CrownWagerItem[];
}

interface FinancialSnapshot {
  balance: number | null;
  credit: number | null;
  balanceSource: string;
  creditSource: string;
}

interface RawFieldInfo {
  key: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  labelText: string;
  surroundingText: string;
  visible: boolean;
  sectionKey?: string;
}

interface RawActionInfo {
  key: string;
  text: string;
  type: string;
  tagName: string;
  visible: boolean;
  sectionKey?: string;
}

type CredentialChangeFormType = 'loginId' | 'password';

type FrameLike = Page | Frame;

type LoginDetectionResult = { status: 'success' | 'error' | 'timeout'; message?: string; debug?: Record<string, any> };

interface PasscodeState {
  userData: {
    username?: string;
    mid?: string;
    four_pwd?: string;
    msg?: string;
    abox4pwd_notshow?: string;
    passwd_safe?: string;
  };
  memSet: {
    passcode?: string;
    fourPwd?: string;
  };
  cookies: string;
}

interface PasscodeInputMeta {
  id: string;
  name: string;
  type: string;
  placeholder: string;
  className: string;
  maxLength?: number;
  inputMode?: string;
  ariaLabel?: string;
  labelText?: string;
  containerId?: string;
  containerClasses?: string;
}

interface PasscodeGroup {
  context: FrameLike;
  inputs: Array<{ locator: Locator; meta: PasscodeInputMeta }>;
  containerId?: string;
  containerClasses?: string;
  key: string;
  score: number;
  marker?: string;
}

interface PasscodeHandlingResult {
  success: boolean;
  passcode?: string;
  mode?: 'setup' | 'input' | 'keypad';
  reason?: string;
}

interface CredentialChangeSelectors {
  formType: CredentialChangeFormType;
  newUsername?: string;
  newPassword?: string;
  confirmPassword?: string;
  oldUsername?: string;
  oldPassword?: string;
  submitButton?: string;
  checkButton?: string;
  sectionKey?: string;
}

interface CredentialChangeDetectionResult {
  target: Page | Frame;
  selectors: CredentialChangeSelectors;
  contextDescription: string;
  rawFields: RawFieldInfo[];
  rawActions: RawActionInfo[];
}

interface CredentialChangeOutcome {
  success: boolean;
  message: string;
  usernameChanged: boolean;
  passwordChanged: boolean;
  formType: CredentialChangeFormType;
  skipLoginId?: boolean;
}

interface BaseUrlHealth {
  failCount: number;
  lastFailure: number;
  lastSuccess: number;
}

interface CredentialChangeOutcome {
  success: boolean;
  message: string;
  usernameChanged: boolean;
  passwordChanged: boolean;
  formType: CredentialChangeFormType;
  skipLoginId?: boolean;
}

export class CrownAutomationService {
  private browser: Browser | null = null;
  private accountBrowsers: Map<number, Browser> = new Map();
  private contexts: Map<number, BrowserContext> = new Map();
  private pages: Map<number, Page> = new Map();
  private bettingFrames: Map<number, Frame> = new Map();
  private orderFrames: Map<number, Frame> = new Map();
  private lastBettingRefresh: Map<number, number> = new Map();
  private sessionInfos: Map<number, any> = new Map();
  private passcodeCache: Map<number, string> = new Map();
  private lastHeartbeats: Map<number, number> = new Map();
  private apiLoginSessions: Map<number, number> = new Map(); // 纯 API 登录会话，value 是登录时间戳
  private apiUids: Map<number, string> = new Map(); // 纯 API 登录的 UID，key 是 accountId，value 是 uid
  private loginLocks: Map<number, Promise<{ success: boolean; message: string }>> = new Map(); // 登录锁，防止同一账号同时登录
  // 系统默认账号（仅用于抓取赛事，不落库）
  private systemLastBeat: number = 0;
  private systemLastLogin: number = 0;
  private systemUsername: string = '';
  private systemLoginFailCount: number = 0;  // 系统登录失败计数
  private systemLoginCooldownUntil: number = 0;  // 系统登录冷却时间戳
  private lastPasscodeRejected: boolean = false;
  private fetchWarmupPromise: Promise<void> | null = null;
  private warmupScheduled = false;
  private balanceDebugCaptured: Set<number> = new Set();
  private onlineStatusTimer: NodeJS.Timeout | null = null;
  private onlineStatusRunning = false;
  private onlineStatusIntervalMs = 60000;
  private onlineHeartbeatTtlMs = 120000;
  private delayScale = 1;
  private baseUrlCandidates: string[] = [];
  private activeBaseUrl: string = DEFAULT_CROWN_BASE_URL;
  private baseUrlHealth: Map<string, BaseUrlHealth> = new Map();
  private baseUrlFailCooldownMs: number = DEFAULT_BASE_URL_FAIL_COOLDOWN_MS;
  private baseUrlHardFailThreshold: number = DEFAULT_BASE_URL_FAIL_THRESHOLD;
  private sportConfig = {
    gtype: 'ft',
    showtype: 'today',
    rtype: 'r',
  };

  constructor() {
    // 延迟初始化浏览器，避免启动时崩溃
    this.scheduleFetchWarmup();
    this.onlineStatusIntervalMs = this.resolveInterval(
      process.env.CROWN_ONLINE_CHECK_INTERVAL_MS,
      60000,
      15000,
    );
    this.onlineHeartbeatTtlMs = this.resolveInterval(
      process.env.CROWN_ONLINE_HEARTBEAT_TTL_MS,
      120000,
      30000,
    );
    this.baseUrlFailCooldownMs = this.resolveInterval(
      process.env.CROWN_BASE_URL_FAIL_COOLDOWN_MS,
      DEFAULT_BASE_URL_FAIL_COOLDOWN_MS,
      5000,
    );
    this.baseUrlHardFailThreshold = this.resolvePositiveInteger(
      process.env.CROWN_BASE_URL_FAIL_THRESHOLD,
      DEFAULT_BASE_URL_FAIL_THRESHOLD,
      1,
    );
    this.baseUrlCandidates = this.resolveBaseUrlCandidates();
    this.activeBaseUrl = this.baseUrlCandidates[0];
    if (this.activeBaseUrl) {
      this.ensureBaseUrlHealth(this.activeBaseUrl);
    }
    this.delayScale = this.resolveDelayScale(process.env.CROWN_AUTOMATION_DELAY_SCALE);

    // 🔄 从数据库恢复会话（延迟 3 秒执行，确保数据库连接已建立）
    console.log('⏰ 设置会话恢复定时器，将在 3 秒后执行...');
    setTimeout(() => {
      console.log('⏰ 会话恢复定时器触发！');
      this.restoreSessionsFromDatabase().catch(err => {
        console.error('❌ 会话恢复失败:', err);
      });
    }, 3000);

    this.startOnlineMonitor();
  }

  /**
   * 生成随机账号（6-10位，字母+数字，至少2个字母1个数字）
   */
  private generateUsername(length = 8): string {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const all = letters + digits;

    for (let attempt = 0; attempt < 20; attempt++) {
      let result = '';
      for (let i = 0; i < length; i++) {
        result += all[Math.floor(Math.random() * all.length)];
      }
      const letterCount = Array.from(result).filter(c => letters.includes(c)).length;
      const digitCount = Array.from(result).filter(c => digits.includes(c)).length;
      if (letterCount >= 2 && digitCount >= 1) {
        return result;
      }
    }
    // 兜底
    return `acc${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 生成随机密码（6-12位，字母+数字，至少2个字母1个数字）
   */
  private generatePassword(length = 8): string {
    const lettersLower = 'abcdefghijklmnopqrstuvwxyz';
    const lettersUpper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const all = lettersLower + lettersUpper + digits;

    for (let attempt = 0; attempt < 20; attempt++) {
      let result = '';
      for (let i = 0; i < length; i++) {
        result += all[Math.floor(Math.random() * all.length)];
      }
      const letterCount = Array.from(result).filter(c =>
        lettersLower.includes(c) || lettersUpper.includes(c)
      ).length;
      const digitCount = Array.from(result).filter(c => digits.includes(c)).length;
      if (letterCount >= 2 && digitCount >= 1) {
        return result;
      }
    }
    // 兜底
    return `Pwd${Math.random().toString(36).slice(2, 6)}123`;
  }

  /**
   * 🔄 从数据库恢复会话信息
   * 在后端启动时调用，恢复所有有效的登录会话
   */
  private async restoreSessionsFromDatabase() {
    try {
      console.log('🔄 正在从数据库恢复会话信息...');

      const result = await query(
        `SELECT id, api_uid, api_login_time, username
         FROM crown_accounts
         WHERE api_uid IS NOT NULL
           AND api_login_time IS NOT NULL
           AND is_enabled = true`
      );

      const now = Date.now();
      const apiSessionTtl = 2 * 60 * 60 * 1000; // 2 小时
      let restoredCount = 0;
      let expiredCount = 0;

      for (const row of result.rows) {
        const accountId = Number(row.id);
        const uid = row.api_uid;
        const loginTime = Number(row.api_login_time);

        // 检查会话是否过期
        if ((now - loginTime) < apiSessionTtl) {
          // 会话仍然有效，恢复到内存
          this.apiLoginSessions.set(accountId, loginTime);
          this.apiUids.set(accountId, uid);
          // 同时更新数据库 is_online 状态
          await query(
            `UPDATE crown_accounts SET is_online = true WHERE id = $1`,
            [accountId]
          );
          restoredCount++;
          console.log(`✅ 恢复会话: accountId=${accountId}, username=${row.username}, uid=${uid}`);
        } else {
          // 会话已过期，清除数据库记录
          expiredCount++;
          await query(
            `UPDATE crown_accounts
             SET api_uid = NULL,
                 api_login_time = NULL,
                 is_online = false
             WHERE id = $1`,
            [accountId]
          );
          console.log(`⏰ 会话已过期: accountId=${accountId}, username=${row.username}`);
        }
      }

      console.log(`🔄 会话恢复完成: 恢复 ${restoredCount} 个，过期 ${expiredCount} 个`);
    } catch (error) {
      console.error('❌ 从数据库恢复会话失败:', error);
    }
  }

  private scheduleFetchWarmup() {
    if (this.warmupScheduled) {
      return;
    }
    this.warmupScheduled = true;
    setTimeout(() => {
      this.ensureFetchWarmup().catch((error) => {
        console.error('❌ 赛事抓取账号预热失败:', error);
      });
    }, 1500);
  }

  private ensureFetchWarmup(): Promise<void> {
    if (this.fetchWarmupPromise) {
      return this.fetchWarmupPromise;
    }
    this.fetchWarmupPromise = this.warmupFetchAccounts()
      .catch((error) => {
        console.error('❌ 预热抓取账号时出错:', error);
      })
      .finally(() => {
        this.fetchWarmupPromise = null;
      });
    return this.fetchWarmupPromise;
  }

  private async warmupFetchAccounts() {
    // 已禁用数据库账号预热功能，只使用独立抓取服务
    console.log('ℹ️ 数据库账号预热已禁用，使用独立抓取服务');
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (closeErr) {
        console.warn('⚠️ 关闭失效浏览器实例时出错:', closeErr);
      } finally {
        this.browser = null;
      }
    }

    await this.initBrowser();

    if (!this.browser) {
      throw new Error('浏览器初始化失败');
    }

    return this.browser;
  }

  private isMobileDevice(deviceType?: string): boolean {
    if (!deviceType) {
      return false;
    }
    const normalized = deviceType.toLowerCase();
    return /(iphone|ios|android|mobile)/.test(normalized);
  }

  private randomizeViewport(baseWidth: number, baseHeight: number, jitter = 4) {
    const offset = (range: number) => Math.floor(Math.random() * (range * 2 + 1)) - range;
    return {
      width: Math.max(320, baseWidth + offset(jitter)),
      height: Math.max(480, baseHeight + offset(jitter)),
    };
  }

  private getViewportConfig(deviceType?: string) {
    const normalized = (deviceType || '').toLowerCase();

    const mobileProfiles = [
      { matcher: /iphone\s?14/, width: 390, height: 844, scale: 3 },
      { matcher: /iphone\s?13/, width: 390, height: 844, scale: 3 },
      { matcher: /iphone|ios/, width: 375, height: 812, scale: 3 },
      { matcher: /android/, width: 412, height: 915, scale: 2.75 },
      { matcher: /mobile/, width: 414, height: 896, scale: 2.5 },
    ];

    for (const profile of mobileProfiles) {
      if (profile.matcher.test(normalized)) {
        return {
          viewport: this.randomizeViewport(profile.width, profile.height, 6),
          deviceScaleFactor: profile.scale,
          isMobile: true,
          hasTouch: true,
        };
      }
    }

    if (this.isMobileDevice(deviceType)) {
      return {
        viewport: this.randomizeViewport(414, 896, 6),
        deviceScaleFactor: 2.5,
        isMobile: true,
        hasTouch: true,
      };
    }

    const desktopViewports = [
      { width: 1920, height: 1080 },
      { width: 1680, height: 1050 },
      { width: 1600, height: 900 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
      { width: 1366, height: 768 },
    ];

    const choice = desktopViewports[Math.floor(Math.random() * desktopViewports.length)];
    return {
      viewport: this.randomizeViewport(choice.width, choice.height, 10),
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    };
  }

  private async findFirstVisibleSelector(page: Page, selectors: string[], timeout = 10000): Promise<string> {
    const start = Date.now();
    const stepTimeout = Math.max(Math.floor(timeout / selectors.length), 1000);

    for (const selector of selectors) {
      const remaining = timeout - (Date.now() - start);
      if (remaining <= 0) {
        break;
      }

      try {
        await page.waitForSelector(selector, {
          timeout: Math.min(stepTimeout, Math.max(remaining, 500)),
          state: 'visible',
        });
        return selector;
      } catch {
        // 尝试下一个选择器
      }
    }

    throw new Error(`未能找到可见的元素: ${selectors.join(', ')}`);
  }

  private async getVisibleText(page: Page, selectors: string[]): Promise<string | null> {
    for (const selector of selectors) {
      try {
        const element = await page.waitForSelector(selector, { timeout: 1000, state: 'visible' });
        const text = await element.textContent();
        if (text) {
          return text.trim();
        }
      } catch {
        // 继续
      }
    }
    return null;
  }

  private async waitForLoginResult(page: Page, timeout = 30000): Promise<{ status: 'success' | 'error' | 'timeout'; message?: string; debug?: Record<string, any> }> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      let state: { status: 'success' | 'error' | 'pending'; message?: string; debug?: Record<string, any> } | null = null;
      try {
        state = await page.evaluate<{
          status: 'success' | 'error' | 'pending';
          message?: string;
          debug?: Record<string, any>;
        }>(() => {
          const globalObj = globalThis as any;
          const doc = globalObj?.document as any;
          const win = globalObj?.window as any;

        const getDisplay = (selector: string): 'visible' | 'hidden' => {
          const el = doc?.querySelector?.(selector) as any;
          if (!el) {
            return 'hidden';
          }
          const style = win?.getComputedStyle?.(el);
          const visible = !!style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          if (!visible && typeof el?.offsetParent !== 'undefined') {
            return el.offsetParent !== null ? 'visible' : 'hidden';
          }
          return visible ? 'visible' : 'hidden';
        };

        const homeVisible = getDisplay('#home_show') === 'visible';
        const loginHidden = getDisplay('#acc_show') === 'hidden';
        const alertVisible = getDisplay('#C_alert_confirm') === 'visible' || getDisplay('#alert_confirm') === 'visible';
        const kickVisible = getDisplay('#alert_kick') === 'visible';

        const textErrorVisible = getDisplay('#text_error') === 'visible';
        const errorText = textErrorVisible ? (doc?.querySelector?.('#text_error')?.innerText || '').trim() : null;

        const topWindow = win?.top as any;
        const userData = topWindow?.userData || {};
        const memSet = topWindow?.memSet || {};

        const fourPwdRaw = typeof userData?.four_pwd === 'string' ? userData.four_pwd : '';
        const fourPwdNormalized = (fourPwdRaw || '').toString().trim().toLowerCase();
        const fourPwdSignals = !!fourPwdNormalized
          && !['', 'n', 'no', 'none', 'false', '0', 'complete', 'success', 'done'].includes(fourPwdNormalized)
          && (
            ['new', 'second', 'third', 'again', 'reset', 'set', 'pending', 'need', 'require', 'required', 'retry', 'y', 'yes'].includes(fourPwdNormalized)
            || /passcode|4pwd|four\s*pwd|四位|四碼|简易|簡易/.test(fourPwdNormalized)
          );

        const memPasscodeRaw = typeof memSet?.passcode === 'string' ? memSet.passcode : '';
        const memPasscodeDigits = memPasscodeRaw.replace(/\D+/g, '');
        const memPasscodeSignals = memPasscodeDigits.length === 4;

        let messageFromTop = (() => {
          if (!topWindow || !topWindow.userData) {
            return null;
          }
          const { msg, code_message } = topWindow.userData;
          if (typeof msg === 'string' && /passcode|4pwd|goToPasscode/i.test(msg)) {
            return 'passcode_prompt';
          }
          if (msg && typeof msg === 'string') {
            return code_message || msg;
          }
          return null;
        })();

        if (!messageFromTop && fourPwdSignals) {
          messageFromTop = 'passcode_prompt';
        }

        const passcodeRequired = (() => {
          const accShow = doc?.querySelector?.('#acc_show') as any;
          const className = accShow?.className || '';
          const hasPassOutside = !!(accShow && accShow.classList?.contains?.('pass_outside'));
          // 额外检测是否已进入预设/输入四位码的容器
          const passcodeBox = doc?.querySelector?.('#prepasscode, .content_chgpwd, .passcode_box, .passcode_area');
          let passcodeBoxVisible = false;
          try {
            if (passcodeBox) {
              const style = win?.getComputedStyle?.(passcodeBox as any);
              passcodeBoxVisible = !!style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            }
          } catch {}
          return {
            required: hasPassOutside || passcodeBoxVisible,
            className,
          };
        })();

        const doubleLogin = (() => {
          const topWindow = win?.top as any;
          return !!(topWindow && topWindow.doubleLogin);
        })();

        if (homeVisible && loginHidden) {
          return { status: 'success' as const, debug: { homeVisible, loginHidden, alertVisible } };
        }

        const shouldPromptPasscode = passcodeRequired.required
          || (messageFromTop === 'passcode_prompt')
          || (!homeVisible && (fourPwdSignals || memPasscodeSignals));

        if (shouldPromptPasscode) {
          return {
            status: 'success' as const,
            message: 'passcode_prompt',
            debug: {
              homeVisible,
              loginHidden,
              alertVisible,
              accShowClass: passcodeRequired.className,
              fourPwd: userData?.four_pwd,
              memPasscode: memSet?.passcode,
            },
          };
        }

        if (kickVisible) {
          return {
            status: 'error' as const,
            message: 'force_logout',
            debug: { kickVisible: true },
          };
        }

        if (doubleLogin) {
          return {
            status: 'error' as const,
            message: '检测到重复登录，目标账号可能已在其他终端在线。',
            debug: { doubleLogin: true },
          };
        }

        if (errorText) {
          return { status: 'error' as const, message: errorText, debug: { errorText } };
        }

        if (messageFromTop) {
          if (messageFromTop === 'passcode_prompt') {
            return {
              status: 'success' as const,
              message: 'passcode_prompt',
              debug: {
                homeVisible,
                loginHidden,
                alertVisible,
                fourPwd: userData?.four_pwd,
                memPasscode: memSet?.passcode,
              },
            };
          }
          return { status: 'error' as const, message: messageFromTop, debug: { messageFromTop } };
        }

          return {
            status: 'pending' as const,
            debug: {
              homeVisible,
              loginHidden,
              alertVisible,
              accShowClass: passcodeRequired.className,
            },
          };
        });
      } catch (evalError) {
        console.warn('⚠️ 检测登录状态时发生异常，重试中:', evalError);
        await this.randomDelay(500, 800);
        continue;
      }

      if (!state) {
        await this.randomDelay(400, 700);
        continue;
      }
      if (state.status === 'success') {
        return { status: 'success', message: state.message, debug: state.debug };
      }

      if (state.status === 'error') {
        return { status: 'error', message: state.message, debug: state.debug };
      }

      await this.randomDelay(400, 700);
    }

    return { status: 'timeout', debug: { message: 'waitForLoginResult timeout' } };
  }

  private async handlePostLoginPrompts(page: Page) {
    // 优先处理“记住我的帐号/浏览器推荐”等登录页提示：统一点击“是/确认”继续
    try {
      const hasConfirm = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        if (!doc) return false;
        const c1 = doc.querySelector('#alert_confirm');
        const c2 = doc.querySelector('#C_alert_confirm');
        return !!(c1 || c2);
      });
      if (hasConfirm) {
        console.log('ℹ️ 检测到登录页提示容器（可能是记住帐号/浏览器推荐/确认），尝试点击“是/确认”');
        const accepted = await this.clickPasscodeConfirm(page, null).catch(() => false);
        if (!accepted) {
          // 兜底尝试点击OK/继续/Yes
          const fallback = page.locator('#C_ok_btn:visible, #ok_btn:visible, button:has-text("OK"), button:has-text("Yes"), button:has-text("Continue"), .btn_submit:has-text("OK"), .btn_submit:has-text("继续"), .btn_submit:has-text("確認"), .btn_submit:has-text("确认")').first();
          if ((await fallback.count().catch(() => 0)) > 0) {
            await fallback.click({ force: true }).catch(() => undefined);
          }
        }
        await this.randomDelay(150, 260);
      }
    } catch (e) {
      // 忽略异常，继续常规流程
    }

    const tryDismiss = async (target: Page | Frame): Promise<boolean> => {
      const confirmSelectors: Array<{ label: string; locator: ReturnType<Page['locator']> }> = [
        { label: '#C_ok_btn', locator: target.locator('#C_ok_btn') },
        { label: '#confirm_btn', locator: target.locator('#confirm_btn') },
        { label: '#alert_confirm -> #yes_btn', locator: target.locator('#alert_confirm').locator('#yes_btn') },
        { label: '#C_alert_confirm -> #C_yes_btn', locator: target.locator('#C_alert_confirm').locator('#C_yes_btn') },
        { label: '.btn_submit:has-text("确认")', locator: target.locator('.btn_submit:has-text("确认")') },
        { label: '.btn_submit:has-text("確定")', locator: target.locator('.btn_submit:has-text("確定")') },
        { label: '.btn_submit:has-text("OK")', locator: target.locator('.btn_submit:has-text("OK")') },
        { label: '.btn_submit:has-text("Yes")', locator: target.locator('.btn_submit:has-text("Yes")') },
        { label: '.btn_submit:has-text("Continue")', locator: target.locator('.btn_submit:has-text("Continue")') },
        { label: 'button:has-text("确认")', locator: target.locator('button:has-text("确认")') },
        { label: 'button:has-text("確定")', locator: target.locator('button:has-text("確定")') },
        { label: 'button:has-text("OK")', locator: target.locator('button:has-text("OK")') },
        { label: 'button:has-text("Yes")', locator: target.locator('button:has-text("Yes")') },
        { label: 'button:has-text("Continue")', locator: target.locator('button:has-text("Continue")') },
        { label: 'div.btn_submit:has-text("确认")', locator: target.locator('div.btn_submit:has-text("确认")') },
        { label: 'div.btn_submit:has-text("確定")', locator: target.locator('div.btn_submit:has-text("確定")') },
        { label: 'div.btn_submit:has-text("OK")', locator: target.locator('div.btn_submit:has-text("OK")') },
        { label: 'div.btn_submit:has-text("Yes")', locator: target.locator('div.btn_submit:has-text("Yes")') },
        { label: 'div.btn_submit:has-text("Continue")', locator: target.locator('div.btn_submit:has-text("Continue")') },
      ].filter(item => !!item.locator);

      for (const { label, locator } of confirmSelectors) {
        try {
          const candidate = locator.first();
          if (!(await candidate.isVisible({ timeout: 200 }).catch(() => false))) {
            continue;
          }

          console.log(`🟢 检测到确认提示 (${label})，尝试点击“确认”`);
          try {
            await candidate.scrollIntoViewIfNeeded?.().catch(() => undefined);
            const popupText = await candidate.evaluate((node: any) => {
              const element = node as any;
              const parent = element?.closest?.('.pop_box, .popup_content, .content_chgpwd, .popup_bottom, .box_help_btn');
              const rawText = parent?.textContent || element?.innerText || '';
              return (rawText || '').trim();
            }).catch(() => '');
            if (popupText) {
              console.log('🧾 弹窗内容:', popupText.replace(/\s+/g, ' '));
            }
          } catch (readErr) {
            console.warn('⚠️ 读取确认弹窗文本失败:', readErr);
          }

          await candidate.click({ timeout: 2000, force: true }).catch(async (clickErr) => {
            console.warn('⚠️ 点击“确认”失败，尝试tap:', clickErr);
            const box = await candidate.boundingBox().catch(() => null);
            if (box) {
              await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            } else {
              throw clickErr;
            }
          });

          await this.randomDelay(200, 400);
          return true;
        } catch (confirmErr) {
          console.warn(`⚠️ 处理确认弹窗 (${label}) 失败:`, confirmErr);
        }
      }

      const cancelSelectors: Array<{ label: string; locator: ReturnType<Page['locator']> }> = [
        { label: '#C_alert_confirm -> #C_no_btn', locator: target.locator('#C_alert_confirm').locator('#C_no_btn') },
        { label: '#alert_confirm -> #no_btn', locator: target.locator('#alert_confirm').locator('#no_btn') },
        { label: '.btn_passcode_cancel', locator: target.locator('.btn_passcode_cancel') },
        { label: '#btn_pwd4_no', locator: target.locator('#btn_pwd4_no') },
        { label: 'getByRole(button, 否, exact)', locator: target.getByRole?.('button', { name: '否', exact: true }) as any },
        { label: 'getByRole(button, 否)', locator: target.getByRole?.('button', { name: '否' }) as any },
        { label: 'text="否"', locator: target.locator('text="否"') },
        { label: 'text=否', locator: target.locator('text=否') },
        { label: 'button:has-text("No")', locator: target.locator('button:has-text("No")') },
        { label: 'button:has-text("Cancel")', locator: target.locator('button:has-text("Cancel")') },
        { label: 'button:has-text("Not Now")', locator: target.locator('button:has-text("Not Now")') },
        { label: 'button:has-text("Later")', locator: target.locator('button:has-text("Later")') },
        { label: 'text="No"', locator: target.locator('text="No"') },
        { label: 'text="Cancel"', locator: target.locator('text="Cancel"') },
        { label: 'text="Not Now"', locator: target.locator('text="Not Now"') },
        { label: 'text="Later"', locator: target.locator('text="Later"') },
        { label: '.btn_cancel', locator: target.locator('.btn_cancel') },
        { label: 'xpath: exact', locator: target.locator("xpath=//*[text()='否']") },
        { label: 'xpath: contains', locator: target.locator("xpath=//*[contains(normalize-space(), '否')]") },
      ].filter(item => !!item.locator);

      for (const { label, locator } of cancelSelectors) {
        try {
          const candidate = locator.first();
          if (!(await candidate.isVisible({ timeout: 200 }).catch(() => false))) {
            continue;
          }

          let popupText = '';
          try {
            await candidate.scrollIntoViewIfNeeded?.().catch(() => undefined);
            const meta = await candidate.evaluate((node: any) => {
              const element = node as any;
              const parent = element?.closest?.('#alert_confirm, #C_alert_confirm, .popup_content, .content_chgpwd, .popup_bottom, .box_help_btn, .pop_box');
              const insideModal = !!parent;
              const rawText = parent?.textContent || element?.innerText || '';
              const parentHtml = parent?.innerHTML || '';
              return { insideModal, text: (rawText || '').trim(), parentHtml };
            }).catch(() => ({ insideModal: false, text: '', parentHtml: '' }));
            if (!meta.insideModal) {
              console.log(`ℹ️ 跳过“否” (${label})：未检测到弹窗容器`);
              continue;
            }
            popupText = meta.text || '';
            if (popupText) {
              console.log('🧾 弹窗内容:', popupText.replace(/\s+/g, ' '));
            }
            if (meta.parentHtml) {
              console.log('🧾 弹窗结构片段:', meta.parentHtml.replace(/\s+/g, ' ').slice(0, 400));
            }
          } catch (readErr) {
            console.warn('⚠️ 读取弹窗文本失败:', readErr);
          }

          const selectorHint = (label || '').toLowerCase();
          const isPasswordPage = /修改密码|change password|請修改|请修改/.test(popupText);
          const isPasscodeControl = /passcode|pwd4/.test(selectorHint);
          const isPasscodePrompt = isPasscodeControl || /简易密码|簡易密碼|四位|四碼|4位|4碼|passcode|4-?digit|four\s*digit|simple\s*password|set\s*passcode|setup\s*passcode/i.test(popupText);
          const isRememberAccountPrompt = /记住我的帐号|記住我的帳號|记住帳號|记得帐号|remember\s+my\s+account|remember\s*(me|account|username)|save\s*(account|username)/i.test(popupText);

          if (isPasswordPage) {
            console.log('ℹ️ 检测到密码修改页面提示，跳过“否”按钮，等待表单处理');
            continue;
          }

          if (isPasscodePrompt) {
            console.log('ℹ️ 检测到四位安全码提示，交由专用流程处理');
            continue;
          }

          if (isRememberAccountPrompt) {
            console.log('ℹ️ 检测到记住账号提示，改为点击“是”继续');
            const accepted = await this.clickPasscodeConfirm(target, null).catch(() => false);
            if (accepted) {
              await this.randomDelay(200, 400);
              return true;
            }
            console.warn('⚠️ 记住账号提示点击“是”失败，继续尝试“否”');
            try {
              await candidate.click({ timeout: 1500, force: true });
              await this.randomDelay(200, 400);
              return true;
            } catch (noErr) {
              console.warn('⚠️ 点击“否”关闭记住账号提示失败:', noErr);
            }
          }

          console.log(`ℹ️ 跳过点击“否” (${label})`);
          continue;

         return true;
       } catch (err) {
         // 如果 locator 不支持 first/isVisible 等，忽略该候选
       }
     }

      return false;
    };

    const start = Date.now();
    let handledAny = false;
    while (Date.now() - start < 15000) {
      let handledThisRound = false;
      const frames = [page, ...page.frames()];
      for (const frame of frames) {
        if (await tryDismiss(frame)) {
          handledAny = true;
          handledThisRound = true;
        }
      }

      if (!handledThisRound) {
        const stillVisible = await page.locator('#C_alert_confirm:visible, #alert_confirm:visible, .box_help_btn:visible').count();
        if (stillVisible === 0) {
          break;
        }
      }

      await this.randomDelay(200, 350);
    }

    if (handledAny) {
      console.log('✅ 已处理简易密码提示');
    }
  }

  private normalizeFieldText(info: RawFieldInfo): string {
    const chunks = [
      info.name,
      info.id,
      info.placeholder,
      info.ariaLabel,
      info.labelText,
      info.surroundingText,
    ]
      .filter(Boolean)
      .map(value => value.toLowerCase().trim().replace(/\s+/g, ' '));
    return chunks.join(' ');
  }

  private matchKeywords(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword));
  }

  private async submitPasswordChange(
    page: Page,
    account: CrownAccount,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; message?: string }> {
    const trimmedNewPassword = newPassword.trim();
    const trimmedCurrentPassword = currentPassword.trim();

    // 0) 前置检查：新旧密码不能相同
    if (trimmedNewPassword === trimmedCurrentPassword) {
      console.warn('⚠️ 新密码与当前密码相同，无需修改');
      return {
        success: false,
        message: '新密码不能与当前密码相同，请使用不同的密码',
      };
    }

    // 1) 尝试强制展示改密容器
    await page.evaluate(() => {
      const d = (globalThis as any).document;
      const acc = d?.querySelector?.('#chgAcc_show');
      if (acc && (acc as any).style && (acc as any).style.display === 'none') {
        (acc as any).style.display = '';
      }
      const pwd = d?.querySelector?.('#chgPwd_show');
      if (pwd && (pwd as any).style && (pwd as any).style.display === 'none') {
        (pwd as any).style.display = '';
      }
    }).catch(() => undefined);

    // 2) 优先等待可见；若不可见则继续兜底操作
    let hasVisiblePassword = false;
    try {
      await page.locator('#password').first().waitFor({ state: 'visible', timeout: 5000 });
      hasVisiblePassword = true;
    } catch {}

    const setValue = async (selector: string, value: string) => {
      const field = page.locator(selector).first();
      const count = await field.count().catch(() => 0);
      if (count === 0) return false;
      const visible = await field.isVisible().catch(() => false);
      if (visible) {
        try {
          await field.fill('');
          await this.randomDelay(60, 120);
          if (value) await field.type(value, { delay: Math.floor(Math.random() * 60) + 40 });
          return true;
        } catch {}
      }
      // 不可见，直接用 evaluate 赋值
      try {
        await field.evaluate((el, val) => {
          (el as any).value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        return true;
      } catch {}
      return false;
    };

    // 3) 填写旧/新/确认密码（无论可见性）
    await setValue('#oldpassword', trimmedCurrentPassword);
    await setValue('input[name="oldpassword"]', trimmedCurrentPassword);

    await this.hideLoadingOverlay(page).catch(() => undefined);

    let filledNew = (await setValue('#password', trimmedNewPassword))
      || (await setValue('input[name="password"]', trimmedNewPassword))
      || (await setValue('#pwd', trimmedNewPassword))
      || (await setValue('input[name="pwd"]', trimmedNewPassword));
    let filledRe = (await setValue('#REpassword', trimmedNewPassword))
      || (await setValue('input[name="REpassword"]', trimmedNewPassword))
      || (await setValue('#pwd_confirm', trimmedNewPassword))
      || (await setValue('input[name="pwd_confirm"]', trimmedNewPassword));

    if (!filledNew || !filledRe) {
      // 兜底：在改密容器内批量定位密码输入框并填充
      try {
        const outcome = await page.evaluate((payload: any) => {
          const newPwd = String(payload?.newPwd || '');
          const oldPwd = String(payload?.oldPwd || '');
          const d = (globalThis as any).document as any;
          const container = d.querySelector('.content_chgpwd') || d.querySelector('#chgPwd_show') || d.querySelector('#chgAcc_show');
          if (!container) return { ok: false, reason: 'no_container' };
          const all = Array.from(container.querySelectorAll('input[type="password"], input[name*="password" i]')) as any[];
          const visible = (el: any) => {
            const s = (globalThis as any).getComputedStyle?.(el);
            const r = el.getBoundingClientRect?.();
            return !!s && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && !!r && r.width > 0 && r.height > 0;
          };
          let fields = all.filter(el => visible(el));
          if (fields.length === 0 && all.length > 0) {
            fields = all;
          }
          if (fields.length === 0) return { ok: false, reason: 'no_password_inputs' };
          if (fields.length === 1) {
            fields[0].value = newPwd;
            fields[0].dispatchEvent(new Event('input', { bubbles: true }));
            fields[0].dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, mode: 'single' };
          }
          if (fields.length === 2) {
            fields[0].value = newPwd;
            fields[1].value = newPwd;
            for (const el of fields) {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { ok: true, mode: 'pair' };
          }
          // 假定 [旧, 新, 确认]
          fields[0].value = oldPwd;
          fields[1].value = newPwd;
          fields[2].value = newPwd;
          for (const el of fields.slice(0, 3)) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { ok: true, mode: 'triple' };
        }, { newPwd: trimmedNewPassword, oldPwd: trimmedCurrentPassword });
        if (outcome?.ok) {
          filledNew = true;
          filledRe = true;
          console.log(`✅(pwd) 通过容器定位填入密码 (mode=${outcome.mode || 'unknown'})`);
        } else {
          console.warn(`⚠️ 通过容器定位密码字段失败: ${outcome?.reason || 'unknown'}`);
        }
      } catch (e) {
        console.warn('⚠️ 通过容器定位密码字段异常:', e);
      }
    }
    if (!filledNew || !filledRe) {
      console.warn('⚠️ 无法填写新密码或确认密码（字段不存在或赋值失败）');
    }

    const submitSelectors = [
      '#greenBtn:visible',
      'div.btn_submit:has-text("提交")',
      '.btn_submit:has-text("确认")',
      '.btn_submit:has-text("確認")',
      'button:has-text("提交")',
      'button:has-text("确认")',
      'button:has-text("確定")',
      'input[type="submit"]',
    ];

    let submitClicked = false;
    for (const selector of submitSelectors) {
      console.log(`🔎(pwd) 检测提交按钮候选: ${selector}`);
      const button = page.locator(selector).first();
      try {
        if ((await button.count().catch(() => 0)) === 0) {
          continue;
        }
        const visible = await button.isVisible({ timeout: 500 }).catch(() => false);
        if (!visible) {
          // 尝试直接用 evaluate 触发 click
          try {
            await button.evaluate((el: any) => el.click());
            console.log(`🖲️(pwd) 直接触发点击: ${selector}`);
            submitClicked = true;
            break;
          } catch {}
          continue;
        }
        console.log(`🖲️(pwd) 点击提交按钮: ${selector}`);
        await button.click({ force: true, timeout: 4000 }).catch(() => undefined);
        submitClicked = true;
        break;
      } catch (clickErr) {
        console.warn('⚠️ 点击改密提交按钮失败:', clickErr);
      }
    }

    if (!submitClicked) {
      // 最后一次兜底：直接查找 #greenBtn 并强制点击
      try {
        const clicked = await page.evaluate(() => {
          const d = (globalThis as any).document;
          const btn = d?.querySelector?.('#greenBtn') as any;
          if (btn) { btn.click(); return true; }
          const anyBtn = d?.querySelector?.('.btn_submit');
          if (anyBtn && typeof (anyBtn as any).click === 'function') { (anyBtn as any).click(); return true; }
          return false;
        });
        if (clicked) {
          console.log('🖲️(pwd) 兜底点击改密提交按钮(#greenBtn/.btn_submit)');
          submitClicked = true;
        }
      } catch {}
      if (!submitClicked) {
        return { success: false, message: '未找到可点击的改密提交按钮' };
      }
    }

    await this.randomDelay(400, 700);

    const errorText = await page
      .locator('#chgpwd_text_error:visible, .text_error:visible')
      .first()
      .textContent()
      .catch(() => null);
    if (errorText && errorText.trim()) {
      const msg = errorText.trim();
      const samePwdHint = /新密码.*不一样|不可与.*相同|must\s*be\s*different|not\s*the\s*same/i;
      if (samePwdHint.test(msg) && trimmedCurrentPassword === trimmedNewPassword) {
        console.log('ℹ️ 检测到“新旧密码相同”提示，目标新密码与现用密码一致，视为已满足目标，跳过改密提交');
        account.password = trimmedNewPassword;
        return { success: true };
      }
      return { success: false, message: msg };
    }

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => null),
      page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined),
    ]);

    await this.randomDelay(400, 700);

    const loginVisible = await page.locator('#usr').isVisible({ timeout: 8000 }).catch(() => false);
    if (!loginVisible) {
      return { success: false, message: '改密提交后未返回登录界面' };
    }

    console.log('✅ 改密页面提交成功，准备重新登录验证');
    account.password = trimmedNewPassword;
    return { success: true };
  }

  private async hideLoadingOverlay(target: Page | Frame): Promise<void> {
    await target.evaluate(() => {
      const selectors = ['#body_loading', '#loading', '.body_loading', '.loading'];
      for (const selector of selectors) {
        const el = (globalThis as any).document?.querySelector?.(selector) as any;
        if (el) {
          el.style.display = 'none';
          el.style.visibility = 'hidden';
          el.style.pointerEvents = 'none';
        }
      }
    }).catch(() => undefined);
  }

  private async ensurePasswordForm(page: Page): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { console.log(`[[init_pwd.ensure]] attempt=${attempt} url=${page.url()}`); } catch {}
      // 判定1：任何一个改密容器可见即认为已展示
      try {
        const containerVisible = await page
          .locator('.content_chgpwd:visible, #chgPwd_show:visible, #chgAcc_show:visible')
          .count()
          .catch(() => 0);
        console.log(`[[init_pwd.ensure]] containersVisible=${containerVisible}`);
        if (containerVisible > 0) {
          return true;
        }
      } catch {}

      // 判定2：常见密码字段可见
      const passwordField = page.locator('#password:visible, input[name="password"]:visible, #REpassword:visible, input[name="REpassword"]:visible').first();
      try {
        await this.hideLoadingOverlay(page).catch(() => undefined);
        await passwordField.waitFor({ state: 'visible', timeout: 2000 });
        console.log('[[init_pwd.ensure]] password field visible');
        return true;
      } catch {
        // 未出现则尝试唤起改密页面
      }

      // 额外尝试：点击页面上的入口/菜单文案以打开“设置新凭证/修改密码”
      try {
        const triggerTexts = [
          '设置新凭证', '設置新憑證', '设置凭证', '新凭证',
          '修改密码', '變更密碼', '更新密码', '更新憑證',
          '帐号与密码', '账号与密码', '安全设置', '安全',
        ];
        const triggerLocator = page.locator(triggerTexts
          .map(t => `a:has-text("${t}"), button:has-text("${t}"), div:has-text("${t}")`).join(', '));
        const count = await triggerLocator.count().catch(() => 0);
        if (count > 0) {
          console.log(`[[init_pwd.ensure]] triggers found=${count}, try click first`);
          await triggerLocator.first().click({ timeout: 2000, force: true }).catch(() => undefined);
        }
      } catch {}

      await this.acknowledgeCredentialPrompts(page, 4000).catch(() => undefined);
      // 多路径尝试强制打开改密页面（登录页/首页均尝试）
      await page.evaluate(() => {
        const g = (globalThis as any);
        const topWin = g?.top || g;
        // 多种路径尝试：从登录页、首页直接进入改密/改账号
        try { topWin?.goToPage?.('acc_show', 'chgPwd_show', () => undefined, {}); } catch {}
        try { topWin?.goToPage?.('acc_show', 'chgAcc_show', () => undefined, {}); } catch {}
        try { topWin?.goToPage?.('home_show', 'chgPwd_show', () => undefined, {}); } catch {}
        try { topWin?.goToPage?.('home_show', 'chgAcc_show', () => undefined, {}); } catch {}
        try { topWin?.goToPage?.('chgPwd_show'); } catch {}
        try { topWin?.goToPage?.('chgAcc_show'); } catch {}
        try { topWin?.show_prepasscode?.(); } catch {}
        try {
          // 某些页面会通过事件切换
          if (typeof topWin?.dispatchEvent === 'function') {
            topWin.dispatchEvent('show_prepasscode', {});
            topWin.dispatchEvent('show_back_4pwd', {});
          }
        } catch {}
      }).catch(() => undefined);

      await this.randomDelay(600, 900);
    }

    return false;
  }

  private pickCredentialFields(rawFields: RawFieldInfo[]): CredentialChangeSelectors | null {
    if (!rawFields || rawFields.length === 0) {
      return null;
    }

    const KEY_ACCOUNT = ['账号', '帳號', '帳户', '帳戶', '帐号', 'account', 'acc', 'user id', 'userid', 'username', 'user', 'login id', 'loginid', 'login', 'member', '使用者', '会员'];
    const KEY_PASSWORD = ['密码', '密碼', 'password', 'passcode', 'pwd'];
    const KEY_NEW = ['新', 'new', '重新', '變更', '变更', '更新', '重设', '重設'];
    const KEY_OLD = ['旧', '舊', '原', '目前', '当前', '現有', 'existing', 'current', 'old'];
    const KEY_CONFIRM = [
      '确认',
      '確認',
      '再次',
      '重复',
      '重覆',
      '再',
      'confirm',
      'again',
      'retype',
      're-enter',
      'repassword',
      're_password',
      're-pass',
      're pass',
      'repwd',
    ];

    let newUsername: RawFieldInfo | null = null;
    let oldUsername: RawFieldInfo | null = null;
    let newPassword: RawFieldInfo | null = null;
    let oldPassword: RawFieldInfo | null = null;
    let confirmPassword: RawFieldInfo | null = null;

    const accountCandidates: RawFieldInfo[] = [];
    const passwordCandidates: RawFieldInfo[] = [];

    for (const field of rawFields) {
      if (!field.visible) {
        continue;
      }

      const lowerType = (field.type || '').toLowerCase();
      if (['button', 'submit', 'checkbox', 'radio'].includes(lowerType)) {
        continue;
      }

      const combined = this.normalizeFieldText(field);
      const isAccountField = this.matchKeywords(combined, KEY_ACCOUNT);
      const isPasswordField = field.type === 'password' || this.matchKeywords(combined, KEY_PASSWORD);
      const isNew = this.matchKeywords(combined, KEY_NEW);
      const isOld = this.matchKeywords(combined, KEY_OLD);
      const isConfirm = this.matchKeywords(combined, KEY_CONFIRM);

      if (isAccountField) {
        if (!newUsername && isNew) {
          newUsername = field;
        } else if (!oldUsername && isOld) {
          oldUsername = field;
        } else {
          accountCandidates.push(field);
        }
        continue;
      }

      if (isPasswordField) {
        if (!newPassword && isNew && !isConfirm) {
          newPassword = field;
        } else if (!confirmPassword && isConfirm) {
          confirmPassword = field;
        } else if (!oldPassword && isOld) {
          oldPassword = field;
        } else {
          passwordCandidates.push(field);
        }
      }
    }

    if (!newUsername && accountCandidates.length > 0) {
      newUsername = accountCandidates.shift() || null;
    }

    if (!newPassword && passwordCandidates.length > 0) {
      newPassword = passwordCandidates.shift() || null;
    }

    if (!confirmPassword && passwordCandidates.length > 0) {
      confirmPassword = passwordCandidates.shift() || null;
    }

    // 兜底：直接通过 ID/name 识别皇冠改密表单的固定字段
    if (!newPassword || !confirmPassword) {
      for (const field of rawFields) {
        if (!field.visible) continue;
        if (field.type !== 'password') continue;

        // #password 或 name="password" 通常是新密码
        if (!newPassword && (field.id === 'password' || field.name === 'password')) {
          newPassword = field;
          continue;
        }

        // #REpassword 或 name="REpassword" 通常是确认密码
        if (!confirmPassword && (field.id === 'repassword' || field.name === 'repassword' || field.id === 'confirmpassword' || field.name === 'confirmpassword')) {
          confirmPassword = field;
          continue;
        }
      }
    }

    const hasNewUsername = !!newUsername;
    const hasPasswordPair = !!(newPassword && confirmPassword);

    let formType: CredentialChangeFormType | null = null;

    if (hasNewUsername && !hasPasswordPair) {
      formType = 'loginId';
    } else if (hasPasswordPair) {
      formType = 'password';
    }

    if (!formType) {
      return null;
    }

    const sectionKey =
      newUsername?.sectionKey ||
      newPassword?.sectionKey ||
      confirmPassword?.sectionKey ||
      oldUsername?.sectionKey ||
      oldPassword?.sectionKey ||
      undefined;

    return {
      formType,
      newUsername: newUsername ? `[data-codex-field="${newUsername.key}"]` : undefined,
      newPassword: newPassword ? `[data-codex-field="${newPassword.key}"]` : undefined,
      confirmPassword: confirmPassword ? `[data-codex-field="${confirmPassword.key}"]` : undefined,
      oldUsername: oldUsername ? `[data-codex-field="${oldUsername.key}"]` : undefined,
      oldPassword: oldPassword ? `[data-codex-field="${oldPassword.key}"]` : undefined,
      sectionKey,
    };
  }

  private pickSubmitAction(rawActions: RawActionInfo[], preferredSectionKey?: string): string | undefined {
    if (!rawActions || rawActions.length === 0) {
      return undefined;
    }

    const KEY_SUBMIT = ['确认', '確認', '确定', '確定', '提交', '送出', '变更', '修改', '更新', 'ok', 'submit', 'save'];

    const visibleActions = rawActions.filter(action => action.visible);

    const orderedActions = preferredSectionKey
      ? [
        ...visibleActions.filter(action => action.sectionKey && action.sectionKey === preferredSectionKey),
        ...visibleActions.filter(action => !action.sectionKey || action.sectionKey !== preferredSectionKey),
      ]
      : visibleActions;

    for (const action of orderedActions) {
      const text = (action.text || '').toLowerCase();
      if (this.matchKeywords(text, KEY_SUBMIT)) {
        return `[data-codex-action="${action.key}"]`;
      }
    }

    const fallback = orderedActions.find(action => action.tagName === 'button' || action.type === 'submit');
    if (fallback) {
      return `[data-codex-action="${fallback.key}"]`;
    }

    return undefined;
  }

  private async extractCredentialChangeSelectors(target: Page | Frame, contextDescription: string): Promise<CredentialChangeDetectionResult | null> {
    try {
      const extraction = await target.evaluate(({
        fieldAttr,
        actionAttr,
        sectionAttr,
      }: { fieldAttr: string; actionAttr: string; sectionAttr: string }) => {
        const doc = (globalThis as any).document as any;
        if (!doc?.querySelectorAll) {
          return { fields: [], actions: [] };
        }

        const ensureSectionKey = (element: any) => {
          if (!element || typeof element.closest !== 'function') {
            return '';
          }
          const sectionSelectors = [
            '.chg_acc',
            '.chg_pwd',
            '.chgpwd',
            '.chgid_input',
            '.input_chgpwd',
            '.content_chgpwd',
            '#chgAcc_show',
            '#chgPwd_show',
            'form',
          ];
          for (const selector of sectionSelectors) {
            const container = element.closest(selector);
            if (container) {
              const existing = container.getAttribute?.(sectionAttr);
              if (existing) {
                return existing;
              }
              const key = `${sectionAttr}-${Math.random().toString(36).slice(2, 10)}`;
              container.setAttribute?.(sectionAttr, key);
              return key;
            }
          }
          const fallback = element.closest?.('[id]') || element.parentElement;
          if (fallback) {
            const existing = fallback.getAttribute?.(sectionAttr);
            if (existing) {
              return existing;
            }
            const key = `${sectionAttr}-${Math.random().toString(36).slice(2, 10)}`;
            fallback.setAttribute?.(sectionAttr, key);
            return key;
          }
          return '';
        };

        const inputs = Array.from(doc.querySelectorAll('input') || []);
        const fields = inputs.map((rawInput: any, index: number) => {
          const input = rawInput as any;
          const key = `${fieldAttr}-${index}-${Math.random().toString(36).slice(2, 8)}`;
          input.setAttribute?.(fieldAttr, key);

          const labelElement = typeof input.closest === 'function' ? input.closest('label') : null;
          const parentText = input.parentElement ? (input.parentElement.textContent || '') : '';
          const siblingText = input.parentElement?.previousElementSibling ? (input.parentElement.previousElementSibling.textContent || '') : '';
          const ancestor = typeof input.closest === 'function' ? input.closest('tr, .form-group, .box_help_btn, .box_help, .box, .content, .wrapper, .row, .item') : null;
          const ancestorText = ancestor ? (ancestor.textContent || '') : '';

          const rect = typeof input.getBoundingClientRect === 'function' ? input.getBoundingClientRect() : { width: 0, height: 0 };
          const win = (globalThis as any).window as any;
          const style = win?.getComputedStyle ? win.getComputedStyle(input) : { display: 'block', visibility: 'visible', opacity: '1' };
          const opacityValue = parseFloat((style.opacity as string) || '1');
          const visible = !(style.display === 'none' || style.visibility === 'hidden' || opacityValue === 0 || rect.width === 0 || rect.height === 0);
          const sectionKey = ensureSectionKey(input);

          return {
            key,
            type: (input.getAttribute?.('type') || '').toLowerCase(),
            name: (input.getAttribute?.('name') || '').toLowerCase(),
            id: (input.getAttribute?.('id') || '').toLowerCase(),
            placeholder: (input.getAttribute?.('placeholder') || '').toLowerCase(),
            ariaLabel: (input.getAttribute?.('aria-label') || '').toLowerCase(),
            labelText: ((labelElement?.textContent || '').trim() || '').toLowerCase(),
            surroundingText: [parentText, siblingText, ancestorText]
              .filter(Boolean)
              .map(text => String(text).trim().toLowerCase())
              .join(' '),
            visible,
            sectionKey,
          } as RawFieldInfo;
        });

        const actionElements = Array.from(
          doc.querySelectorAll('button, input[type="submit"], a, [role="button"], .btn_submit, .btn_cancel, .btn_confirm, .btn_choose') || []
        );
        const actions = actionElements.map((rawElement: any, index: number) => {
          const element = rawElement as any;
          const key = `${actionAttr}-${index}-${Math.random().toString(36).slice(2, 8)}`;
          element.setAttribute?.(actionAttr, key);
          const text = ((element.textContent || element.getAttribute?.('value') || '') ?? '').trim().toLowerCase();
          const type = (element.getAttribute?.('type') || '').toLowerCase();
          const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : { width: 0, height: 0 };
          const win = (globalThis as any).window as any;
          const style = win?.getComputedStyle ? win.getComputedStyle(element) : { display: 'block', visibility: 'visible', opacity: '1' };
          const opacityValue = parseFloat((style.opacity as string) || '1');
          const visible = !(style.display === 'none' || style.visibility === 'hidden' || opacityValue === 0 || rect.width === 0 || rect.height === 0);
          const sectionKey = ensureSectionKey(element);
          return {
            key,
            text,
            type,
            tagName: (element.tagName || '').toLowerCase(),
            visible,
            sectionKey,
          } as RawActionInfo;
        });

        return { fields, actions };
      }, { fieldAttr: 'data-codex-field', actionAttr: 'data-codex-action', sectionAttr: 'data-codex-section' });

      if (!extraction || !extraction.fields?.length) {
        return null;
      }

      const selectors = this.pickCredentialFields(extraction.fields);
      if (!selectors) {
        return null;
      }

      const submitSelector = this.pickSubmitAction(extraction.actions, selectors.sectionKey);
      if (submitSelector) {
        selectors.submitButton = submitSelector;
      }

      if (selectors.formType === 'loginId') {
        const checkAction = extraction.actions.find(action => this.matchKeywords(action.text, ['check', '检查', '檢查', '檢測', '检测']));
        if (checkAction) {
          selectors.checkButton = `[data-codex-action="${checkAction.key}"]`;
        }
      }

      return {
        target,
        selectors,
        contextDescription,
        rawFields: extraction.fields,
        rawActions: extraction.actions,
      };
    } catch (error) {
      console.warn('⚠️ 提取改密表单元素失败:', error);
      return null;
    }
  }

  private async detectCredentialChangeForm(page: Page, timeout = 20000): Promise<CredentialChangeDetectionResult | null> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const contexts: Array<Page | Frame> = [page, ...page.frames()];
      for (const ctx of contexts) {
        const contextDescription = ctx === page
          ? 'page:main'
          : `frame:${(ctx as any).name?.() || (ctx as any).url?.() || 'unknown'}`;
        const detection = await this.extractCredentialChangeSelectors(ctx, contextDescription);
        if (detection) {
          console.log('🔍 检测到皇冠改密页面元素。上下文:', detection.contextDescription);
          return detection;
        }
      }
      await this.randomDelay(250, 400);
    }
    return null;
  }


  private async typeIntoField(target: Page | Frame, selector: string, value: string) {
    if (!selector) {
      return;
    }
    const locator = target.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 8000 });
    await locator.click({ force: true }).catch(() => undefined);
    await locator.fill('');
    await this.randomDelay(120, 300);
    await locator.type(value, { delay: 80 }).catch(async () => {
      await locator.evaluate((el, text) => {
        const element = el as any;
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('keyup', { bubbles: true }));
      }, value);
    });
    await locator.evaluate((el) => {
      const element = el as any;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('keyup', { bubbles: true }));
    }).catch(() => undefined);

    await target.evaluate(() => {
      const doc = (globalThis as any).document;
      if (!doc) return;
      const input = doc.querySelector('#username') as any;
      if (input) {
        input.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      const checkBtn = doc.querySelector('#check_name') as any;
      if (checkBtn && checkBtn.classList && checkBtn.classList.contains('unable')) {
        checkBtn.classList.remove('unable');
      }
    }).catch(() => undefined);
  }

  private async acknowledgeCredentialPrompts(page: Page, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      let handled = false;

      // 过去这里会点击“否”拒绝四位密码；为避免误判，取消该操作

      // 处理改密相关的确认按钮（皇冠hga038特有）
      const buttonCandidates = page.locator(
        '#C_yes_btn:visible, #C_ok_btn:visible, #ok_btn:visible, #yes_btn:visible, ' +
        '.popup_bottom .btn_submit:visible, .box_help_btn .btn_submit:visible, ' +
        '#kick_ok_btn:visible, #info_close:visible, #R_info_close:visible, #message_ok:visible'
      );

      const count = await buttonCandidates.count().catch(() => 0);
      if (count > 0) {
        console.log(`🔎 检测到确认弹窗按钮候选数量: ${count}`);
        try {
          const firstHandle = buttonCandidates.first();
          const text = await firstHandle.innerText().catch(() => '');
          console.log(`🖲️ 尝试点击确认按钮: ${text || '[无文本]'} (first)`);
          await firstHandle.click({ force: true, timeout: 4000 });
          console.log('✅ 已点击确认按钮');
          handled = true;
        } catch (err) {
          console.warn('⚠️ 点击改密提示确认按钮失败:', err);
        }
        await this.randomDelay(500, 800);
      }

      // 检查改密容器是否已显示
      const chgAccVisible = await page.locator('#chgAcc_show:visible, #chgPwd_show:visible').count().catch(() => 0);
      if (chgAccVisible > 0) {
        console.log('✅ 改密容器已显示');
        await this.randomDelay(500, 1000);
        break;
      }

      if (!handled) {
        const popupCount = await page
          .locator('#C_alert_ok:visible, #alert_ok:visible, #C_msg_ok:visible, #msg_ok:visible, #alert_kick:visible, #C_alert_confirm:visible')
          .count()
          .catch(() => 0);
        if (popupCount === 0) {
          break;
        }
      }

      await this.randomDelay(250, 400);
    }
  }

  private async resolvePostLoginState(page: Page): Promise<'success' | 'force_logout' | 'pending' | 'password_change'> {
    await this.acknowledgeCredentialPrompts(page, 5000).catch(() => undefined);

    const kickVisible = await page.locator('#alert_kick:visible').count().catch(() => 0);
    if (kickVisible > 0) {
      await page.locator('#kick_ok_btn:visible').click({ timeout: 5000 }).catch(() => undefined);
      await this.randomDelay(400, 700);
      const pwdVisibleAfterKick = await page.locator('#chgAcc_show:visible').count().catch(() => 0);
      if (pwdVisibleAfterKick > 0) {
        return 'success';
      }
      await this.navigateToLogin(page, { waitForNetworkIdle: true, waitForLoginSelector: true }).catch((gotoErr: any) => {
        console.warn('⚠️ 处理强制登出后刷新登录页失败:', gotoErr);
      });
      return 'force_logout';
    }

    const homeVisible = await page.locator('#home_show').isVisible().catch(() => false);
    const loginVisible = await page.locator('#acc_show').isVisible().catch(() => false);
    if (homeVisible && !loginVisible) {
      return 'success';
    }

    const pwdFormVisible = await page.locator('#chgAcc_show:visible').count().catch(() => 0);
    if (pwdFormVisible > 0) {
      return 'success';
    }

    const forcePwdChangeVisible = await page.locator('.content_chgpwd:visible, #chgPwd_show:visible').count().catch(() => 0);
    if (forcePwdChangeVisible > 0) {
      return 'password_change';
    }

    return 'pending';
  }

  private async applyCredentialChange(
    detection: CredentialChangeDetectionResult,
    currentAccount: CrownAccount,
    nextCredentials: { username: string; password: string },
    page: Page,
  ): Promise<CredentialChangeOutcome> {
    const { target, selectors } = detection;

    console.log('🛠️ 开始填写改密表单');

    let usernameChanged = false;
    let passwordChanged = false;

    if (selectors.formType === 'loginId') {
      let usernameSelector = selectors.newUsername;
      if (!usernameSelector) {
        const fallbackSelectors = ['#username', '#chgAcc_show .userid', 'input.userid'];
        for (const fallback of fallbackSelectors) {
          const count = await target.locator(fallback).count().catch(() => 0);
          if (count > 0) {
            usernameSelector = fallback;
            break;
          }
        }
      }

      if (!usernameSelector) {
        return {
          success: false,
          message: '未找到新的登录账号输入框，无法继续初始化',
          usernameChanged,
          passwordChanged,
          formType: selectors.formType,
        };
      }

      const loginIdLocator = target.locator(usernameSelector).first();
      const loginIdVisible = await loginIdLocator.isVisible().catch(() => false);
      if (!loginIdVisible) {
        console.log('ℹ️ 登录账号输入框不可见，默认账号已更新，跳过登录账号变更阶段');
        return {
          success: true,
          message: '登录账号无需更新',
          usernameChanged,
          passwordChanged,
          formType: selectors.formType,
          skipLoginId: true,
        };
      }

      await this.typeIntoField(target, usernameSelector, nextCredentials.username.trim());

      // 移除检查按钮的 unable 类（皇冠hga038特有）
      await target.evaluate(() => {
        const doc = (globalThis as any).document;
        if (!doc) return;
        const checkBtn = doc.querySelector('#check_name');
        if (checkBtn && checkBtn.classList && checkBtn.classList.contains('unable')) {
          checkBtn.classList.remove('unable');
        }
      }).catch(() => undefined);

      await this.randomDelay(300, 500);

      const checkSelectors: string[] = [];
      if (selectors.checkButton) {
        checkSelectors.push(selectors.checkButton);
      }
      // 皇冠hga038特定的检查按钮选择器
      checkSelectors.push('#check_name:visible', '.btn_choose:visible');

      if (!selectors.checkButton) {
        checkSelectors.push('#login_btn');
      }

      let checkClicked = false;
      for (const checkSelector of checkSelectors) {
        console.log(`🔎 检测检查按钮候选: ${checkSelector}`);
        try {
          const checkButton = target.locator(checkSelector).first();
          if ((await checkButton.count()) === 0) {
            continue;
          }
          if (await checkButton.isVisible({ timeout: 500 }).catch(() => false)) {
            console.log(`🔍 点击检查按钮: ${checkSelector}`);
            await checkButton.click({ timeout: 5000, force: true }).catch(() => undefined);
            checkClicked = true;
            await this.randomDelay(800, 1200);
            break;
          }
        } catch {
          // ignore individual selector failures
        }
      }

      if (!checkClicked) {
        console.log('⚠️ 未找到可点击的检查按钮，继续执行');
      }

      const errorLocator = target.locator('#chgid_text_error');
      const hasError = await errorLocator.isVisible({ timeout: 4000 }).catch(() => false);
      if (hasError) {
        const errorText = (await errorLocator.textContent().catch(() => ''))?.trim();
        if (errorText) {
          const normalized = errorText.toLowerCase();
          const isPositive = /(无人使用|可使用|可用|available|尚未使用)/.test(normalized);
          const isNegative = /(已有人|已被|重复|不可|错误|錯誤|失败|失敗|不符|請重新|格式不符)/.test(normalized);
          if (isPositive && !isNegative) {
            console.log(`✅ 登录账号校验通过: ${errorText}`);
          } else {
            return {
              success: false,
              message: errorText,
              usernameChanged,
              passwordChanged,
              formType: selectors.formType,
            };
          }
        }
      }

      usernameChanged = true;
      currentAccount.username = nextCredentials.username.trim();
    } else {
      if (selectors.oldUsername) {
        await this.typeIntoField(target, selectors.oldUsername, (currentAccount.username || '').trim());
      }
      if (selectors.oldPassword) {
        await this.typeIntoField(target, selectors.oldPassword, (currentAccount.password || '').trim());
      }

      if (!selectors.newPassword || !selectors.confirmPassword) {
        return {
          success: false,
          message: '未找到新的皇冠密码输入框',
          usernameChanged,
          passwordChanged,
          formType: selectors.formType,
        };
      }

      if (selectors.newUsername) {
        await this.typeIntoField(target, selectors.newUsername, nextCredentials.username.trim());
        usernameChanged = true;
        currentAccount.username = nextCredentials.username.trim();
      }

      await this.typeIntoField(target, selectors.newPassword, nextCredentials.password.trim());
      await this.typeIntoField(target, selectors.confirmPassword, nextCredentials.password.trim());
      passwordChanged = true;
    }

    const submitCandidates: string[] = [];
    if (selectors.submitButton) {
      submitCandidates.push(selectors.submitButton);
    }

    // 皇冠hga038特定的提交按钮（优先级从高到低）
    if (selectors.formType === 'loginId') {
      submitCandidates.push(
        '#login_btn:visible',                    // 皇冠创建账号提交按钮（DIV元素）
        '.btn_submit:visible',                   // 通用提交按钮类
      );
    } else {
      submitCandidates.push(
        '#greenBtn:visible',                     // 皇冠改密提交按钮
        '.btn_submit:visible',                   // 通用提交按钮类
      );
    }

    submitCandidates.push(
      '#login_btn',
      '#greenBtn',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("确认")',
      'button:has-text("確認")',
      'button:has-text("确定")',
      'button:has-text("確定")',
      'a:has-text("确认")',
      'a:has-text("確認")',
      '.btn_submit:has-text("提交")',
      '.btn_submit:has-text("确认")',
      '.btn_submit:has-text("確認")',
      'div.btn_submit:has-text("提交")',
      'div.btn_submit:has-text("确认")',
      'div.btn_submit:has-text("確認")',
      'div:has-text("提交")',
    );

    let submitFound = false;
    for (const selector of submitCandidates) {
      console.log(`🔎 检测提交按钮候选: ${selector}`);
      try {
        const button = target.locator(selector).first();
        if ((await button.count()) === 0) {
          continue;
        }

        await button.scrollIntoViewIfNeeded().catch(() => undefined);

        const dialogPromise = page.waitForEvent('dialog', { timeout: 15000 }).catch(() => null);

        try {
          console.log(`🖲️ 点击提交按钮: ${selector}`);
          await button.click({ timeout: 8000, force: true });
        } catch (clickErr) {
          console.warn(`⚠️ 点击提交按钮失败 (${selector})，错误:`, clickErr);
          continue;
        }

        submitFound = true;
        const dialog = await dialogPromise;
        if (dialog) {
          const dialogMessage = dialog.message();
          console.log('📢 改密弹窗提示:', dialogMessage);
          await dialog.accept().catch(() => undefined);
          if (/失败|錯誤|error|无效|不符|重复|重复/.test(dialogMessage)) {
            return {
              success: false,
              message: dialogMessage,
              usernameChanged,
              passwordChanged,
              formType: selectors.formType,
            };
          }
        }

        break;
      } catch (error) {
        console.warn(`⚠️ 尝试使用提交选择器 ${selector} 时失败:`, error);
      }
    }

    if (!submitFound) {
      return {
        success: false,
        message: '未找到改密提交按钮，请人工确认页面结构',
        usernameChanged,
        passwordChanged,
        formType: selectors.formType,
      };
    }

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => null),
      page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined),
    ]);

    await this.acknowledgeCredentialPrompts(page).catch(() => undefined);

    if (selectors.formType === 'loginId') {
      await page.locator('#password[type="password"], input[name="password"][type="password"]').first().waitFor({
        timeout: 12000,
        state: 'visible',
      }).catch(() => undefined);
    }

    await this.randomDelay(600, 1000);

    const loginVisible = await page.locator('#usr').isVisible({ timeout: 8000 }).catch(() => false);

    if (!loginVisible) {
      if (selectors.formType === 'loginId') {
        console.log('ℹ️ 登录账号更新已提交，等待继续执行后续初始化步骤');
        return {
          success: true,
          message: '登录账号更新完成',
          usernameChanged,
          passwordChanged,
          formType: selectors.formType,
        };
      }

      const errorCandidate = await target
        .locator('.text_danger, .text-error, .error, .error-text, .msg-error, .alert-danger, .note_msg')
        .first()
        .textContent()
        .catch(() => null);

      if (errorCandidate) {
        const trimmed = errorCandidate.trim();
        if (trimmed) {
          return { success: false, message: trimmed, usernameChanged, passwordChanged, formType: selectors.formType };
        }
      }

      const dialogInfo = await page.evaluate(() => {
        const doc = (globalThis as any).document as any;
        const container = doc?.querySelector?.('.pop_box, .alert_box, #alert_msg');
        return container ? (container.textContent || '').trim() : null;
      }).catch(() => null);

      if (dialogInfo && /失败|錯誤|error|无效|不符/.test(dialogInfo)) {
        return { success: false, message: dialogInfo, usernameChanged, passwordChanged, formType: selectors.formType };
      }

      return {
        success: false,
        message: '未检测到改密成功提示，请人工核对是否已完成',
        usernameChanged,
        passwordChanged,
        formType: selectors.formType,
      };
    }

    console.log('✅ 改密已提交，页面返回登录界面');
    return {
      success: true,
      message: '改密已完成，将使用新凭证重新登录验证',
      usernameChanged,
      passwordChanged,
      formType: selectors.formType,
    };
  }


  private async performLoginWithCredentials(page: Page, username: string, password: string, account?: CrownAccount): Promise<{ success: boolean; message?: string }> {
    const ensureLoginForm = async () => {
      try {
        await page.waitForSelector('#usr', { timeout: 8000 });
      } catch {
        await this.navigateToLogin(page, { waitForNetworkIdle: true, waitForLoginSelector: true });
      }
    };

    let lastFailureMessage: string | null = null;
    this.lastPasscodeRejected = false;
    const maxAttempts = 2;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await ensureLoginForm();

      await this.humanLikeType(page, '#usr', username.trim());
      await this.randomDelay(300, 600);
      await this.humanLikeType(page, '#pwd', password.trim());
      await this.randomDelay(500, 900);

      const loginButton = page.locator('#btn_login').first();
      if ((await loginButton.count()) === 0) {
        return { success: false, message: '未找到登录按钮' };
      }

      try {
        await loginButton.waitFor({ state: 'visible', timeout: 10000 });
      } catch {
        await loginButton.waitFor({ state: 'attached', timeout: 5000 }).catch(() => undefined);
      }

      await loginButton.scrollIntoViewIfNeeded().catch(() => undefined);

      await page.waitForFunction((selector) => {
        const g = globalThis as any;
        const doc = g?.document as any;
        if (!doc?.querySelector) {
          return false;
        }
        const el = doc.querySelector(selector);
        if (!el) {
          return false;
        }
        const style = g?.getComputedStyle ? g.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
          return false;
        }
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      }, '#btn_login', { timeout: 10000 }).catch(() => undefined);

      try {
        await loginButton.click({ delay: 120 });
      } catch (clickError) {
        console.warn('⚠️ 登录按钮点击失败，尝试使用 force 选项:', clickError);
        await loginButton.click({ delay: 120, force: true }).catch((forceError) => {
          throw forceError;
        });
      }

      // 先尝试处理登录页的通用提示（记住账号/浏览器推荐等），优先点击“是/确认”
      await this.handlePostLoginPrompts(page).catch(() => undefined);

      let loginResult = await this.waitForLoginResult(page, 18000);
      if (account) {
        loginResult = await this.resolvePasscodePrompt(page, account, loginResult);
      } else if (loginResult.status === 'success' && loginResult.message === 'passcode_prompt') {
        return { success: false, message: 'passcode_prompt' };
      }

      if (loginResult.status === 'success') {
        await this.handlePostLoginPrompts(page).catch(() => undefined);
        return { success: true };
      }

      if (loginResult.status === 'error') {
        const failureMessage = this.composeLoginFailureMessage(loginResult.message, loginResult.debug);
        if (loginResult.message === 'force_logout') {
        const state = await this.resolvePostLoginState(page);
        if (state === 'success') {
          await this.handlePostLoginPrompts(page).catch(() => undefined);
          return { success: true };
        }
        if (state === 'password_change') {
          return { success: false, message: 'password_change_required' };
        }
        await this.randomDelay(6000, 9000);
        continue;
      }
        return { success: false, message: failureMessage };
      }

      if (loginResult.status === 'timeout') {
        const timeoutMessage = this.composeLoginFailureMessage(loginResult.message, loginResult.debug, '登录超时，请稍后重试');
        const fallbackState = await this.resolvePostLoginState(page);
        if (fallbackState === 'success') {
          await this.handlePostLoginPrompts(page).catch(() => undefined);
          return { success: true };
        }
        if (fallbackState === 'force_logout') {
          continue;
        }
        if (fallbackState === 'password_change') {
          return { success: false, message: 'password_change_required' };
        }
        lastFailureMessage = timeoutMessage;
      } else {
        lastFailureMessage = this.composeLoginFailureMessage(loginResult.message, loginResult.debug);
      }

      await this.randomDelay(400, 700);
    }

    if (await this.isPasscodePromptVisible(page).catch(() => false)) {
      console.log('[performLoginWithCredentials] passcode prompt remains visible, aborting with prompt');
      return { success: false, message: 'passcode_prompt' };
    }
    console.log('[performLoginWithCredentials] returning default failure:', lastFailureMessage);
    return { success: false, message: lastFailureMessage || '登录失败，请检查账号或稍后再试' };
  }

  private async initBrowser() {
    try {
      this.browser = await chromium.launch({
        headless: isHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
        ],
      });
      console.log('🚀 Playwright浏览器启动成功');
    } catch (error) {
      console.error('❌ 浏览器启动失败:', error);
      throw error;
    }
  }

  // 创建反检测浏览器上下文
  private async createStealthContext(account: CrownAccount, storageState?: BrowserContextOptions['storageState']): Promise<BrowserContext> {
    let browser: Browser;

    const usePerAccountProxy = !!(account.proxy_enabled && account.proxy_host && account.proxy_port && account.proxy_type);

    const launchProxyBrowser = async () => {
      const protocol = (account.proxy_type || '').toLowerCase();
      const server = `${protocol}://${account.proxy_host}:${account.proxy_port}`;
      const newBrowser = await chromium.launch({
        headless: isHeadless,
        proxy: {
          server,
          username: account.proxy_username || undefined,
          password: account.proxy_password || undefined,
        },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
        ],
      });
      this.accountBrowsers.set(account.id, newBrowser);
      console.log(`🌐 已为账号 ${account.username} 启用专用代理浏览器: ${server}`);
      return newBrowser;
    };

    let usingProxyBrowser = false;

    if (usePerAccountProxy) {
      const existing = this.accountBrowsers.get(account.id);
      if (existing && existing.isConnected()) {
        browser = existing;
        usingProxyBrowser = true;
      } else {
        try {
          browser = await launchProxyBrowser();
          usingProxyBrowser = true;
        } catch (e) {
          console.error('❌ 启动代理浏览器失败:', e);
          browser = await this.ensureBrowser();
          usingProxyBrowser = false;
        }
      }
    } else {
      browser = await this.ensureBrowser();
    }

    const contextOptions: BrowserContextOptions = {
      userAgent: account.user_agent || this.generateUserAgent(account.device_type || 'desktop'),
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      permissions: [],
      javaScriptEnabled: true,
      bypassCSP: true,
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    };
    if (storageState) {
      contextOptions.storageState = storageState;
    }

    // 代理已在浏览器层处理（per-account 浏览器）。context 无需再次配置。

    const viewportConfig = this.getViewportConfig(account.device_type);
    contextOptions.viewport = viewportConfig.viewport;
    contextOptions.deviceScaleFactor = viewportConfig.deviceScaleFactor;
    contextOptions.isMobile = viewportConfig.isMobile;
    contextOptions.hasTouch = viewportConfig.hasTouch;

    let context: BrowserContext | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        context = await browser.newContext(contextOptions);
        break;
      } catch (error) {
        console.error('❌ 创建浏览器上下文失败:', error);
        if (attempt === 1) {
          throw error;
        }

        if (usingProxyBrowser) {
          const existing = this.accountBrowsers.get(account.id);
          if (existing) {
            try { await existing.close(); } catch {}
            this.accountBrowsers.delete(account.id);
          }
          try {
            browser = await launchProxyBrowser();
            usingProxyBrowser = true;
          } catch (launchError) {
            console.error('❌ 重新启动代理浏览器失败，回退到共享浏览器:', launchError);
            browser = await this.ensureBrowser();
            usingProxyBrowser = false;
          }
        } else {
          if (!usePerAccountProxy && this.browser) {
            try { await this.browser.close(); } catch {}
            this.browser = null;
          }
          browser = await this.ensureBrowser();
        }
      }
    }

    if (!context) {
      throw new Error('无法创建浏览器上下文');
    }

    // 注入反检测脚本
    await context.addInitScript(`
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            {
              name: 'Chrome PDF Plugin',
              filename: 'internal-pdf-viewer',
              description: 'Portable Document Format',
            },
          ],
        });

        const permissions = window.navigator.permissions;
        if (permissions && permissions.query) {
          const originalQuery = permissions.query.bind(permissions);
          permissions.query = (parameters) => {
            const name = parameters?.name;
            if (name === 'notifications') {
              const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';
              return Promise.resolve({ state: permission });
            }
            return originalQuery(parameters);
          };
        }

        if (window.screen) {
          Object.defineProperty(window.screen, 'colorDepth', { get: () => 24 });
          Object.defineProperty(window.screen, 'pixelDepth', { get: () => 24 });
        }
      } catch (stealthError) {
        console.warn('⚠️ 反检测脚本执行异常:', stealthError);
      }
    `);

    return context;
  }

  // 生成用户代理字符串
  private generateUserAgent(deviceType: string): string {
    const chromeVersion = '120.0.0.0';
    const webkitVersion = '537.36';

    switch (deviceType) {
      case 'iPhone 14':
        return `Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1`;
      case 'iPhone 13':
        return `Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.7 Mobile/15E148 Safari/604.1`;
      case 'Android':
        return `Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/${webkitVersion} (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/${webkitVersion}`;
      default:
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${webkitVersion} (KHTML, like Gecko) Chrome/${chromeVersion} Safari/${webkitVersion}`;
    }
  }

  // 随机延迟
  private async randomDelay(min: number = 1000, max: number = 3000) {
    const scale = Math.min(Math.max(this.delayScale, 0.1), 1);
    const scaledMin = Math.max(20, Math.floor(min * scale));
    const scaledMax = Math.max(scaledMin, Math.floor(max * scale));
    const delay = Math.floor(Math.random() * (scaledMax - scaledMin + 1)) + scaledMin;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private extractSnapshotTimestamp(fileName: string): number {
    const match = fileName.match(/-(\d+)\.(?:html|png)$/);
    if (!match) {
      return 0;
    }
    return Number(match[1]) || 0;
  }

  private async pruneSnapshotArtifacts(prefixes: string[], keep = 6): Promise<void> {
    try {
      const entries = await fs.readdir('.', { withFileTypes: true });
      const targets = entries
        .filter(entry => entry.isFile() && prefixes.some(prefix => entry.name.startsWith(prefix)))
        .map(entry => ({ name: entry.name, timestamp: this.extractSnapshotTimestamp(entry.name) }))
        .sort((a, b) => b.timestamp - a.timestamp);

      if (targets.length <= keep) {
        return;
      }

      const toDelete = targets.slice(keep);
      await Promise.allSettled(toDelete.map(item => fs.unlink(item.name)));
    } catch (err) {
      console.warn('⚠️ 清理旧的调试快照失败:', err);
    }
  }

  private async collectLoginDebugState(page: Page) {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await page.evaluate(() => {
          const topWin = (globalThis as any).top || (globalThis as any);
          const doc = (globalThis as any).document;
          const acc = doc?.querySelector?.('#acc_show');
          const style = acc ? ((globalThis as any).getComputedStyle?.(acc) || acc.style || {}) : {};
          const passcodeContainers = doc?.querySelectorAll?.('#prepasscode, .content_chgpwd, .passcode_box, .passcode_area');
          const hasPasscodeContainer = !!(passcodeContainers && passcodeContainers.length > 0);
          const alertVisible = !!doc?.querySelector?.('#C_alert_confirm.on, #alert_confirm.on, .popup_content.on, .pop_box.on');
          const accHtml = acc?.outerHTML || null;
          const loginFormVisible = acc ? style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' : null;
          return {
            accDisplay: style.display || null,
            accClass: acc?.className || null,
            loginFormVisible,
            accHtml,
            alertVisible,
            hasPasscodeContainer,
            userData: {
              msg: topWin?.userData?.msg,
              four_pwd: topWin?.userData?.four_pwd,
              mid: topWin?.userData?.mid,
              abox4pwd_notshow: topWin?.userData?.abox4pwd_notshow,
              passwd_safe: topWin?.userData?.passwd_safe,
              errorCode: topWin?.errorCode,
            },
            memSet: {
              passcode: topWin?.memSet?.passcode,
              fourPwd: topWin?.memSet?.fourPwd,
            },
            requestRetry: topWin?.RequestRetry,
            topMessage: topWin?.userData?.msg || topWin?.memSet?.msg,
            currentUrl: (globalThis as any).location?.href || null,
          };
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retriable = /execution context was destroyed|cannot find context/i.test(message);
        if (retriable && attempt < maxAttempts - 1) {
          await this.randomDelay(200, 400);
          continue;
        }
        throw err;
      }
    }
    return null;
  }

  private normalizeLoginMessage(raw?: string | null): string | undefined {
    if (!raw) {
      return undefined;
    }
    const trimmed = String(raw).trim();
    if (!trimmed) {
      return undefined;
    }

    const lower = trimmed.toLowerCase();
    if (lower === 'force_logout') {
      return '检测到系统强制登出提示，请稍后重试';
    }
    if (lower === 'passcode_prompt') {
      return '当前账号需要输入四位安全码，请在人工模式下完成后再试';
    }
    if (lower === 'passcode_dismiss_failed') {
      return '无法自动拒绝四位安全码，请人工处理安全码后再试';
    }
    if (lower === 'passcode_post_state_pending') {
      return '已拒绝四位安全码，但系统仍未进入主页，请人工登录确认';
    }
    if (lower === 'password_change_required') {
      return '皇冠提示需要修改密码，请在系统中执行“初始化账号”完成改密后再尝试登录';
    }
    if (lower === 'waitforloginresult timeout') {
      return '登录检测超时';
    }

    return trimmed;
  }

  private formatLoginDebug(debug?: Record<string, any>): string | undefined {
    if (!debug) {
      return undefined;
    }

    const entries: string[] = [];
    const push = (key: string) => {
      const value = (debug as any)[key];
      if (value === undefined || value === null) {
        return;
      }
      if (typeof value === 'boolean') {
        entries.push(`${key}=${value ? 'true' : 'false'}`);
        return;
      }
      if (typeof value === 'object') {
        try {
          entries.push(`${key}=${JSON.stringify(value)}`);
        } catch {
          entries.push(`${key}=[object]`);
        }
        return;
      }
      entries.push(`${key}=${String(value)}`);
    };

    push('homeVisible');
    push('loginHidden');
    push('alertVisible');
    push('kickVisible');
    push('accShowClass');
    push('message');

    if (entries.length === 0) {
      return undefined;
    }

    return `登录检测信息(${entries.join(', ')})`;
  }

  private composeLoginFailureMessage(message?: string | null, debug?: Record<string, any>, fallback = '登录失败，请检查账号或稍后再试'): string {
    const normalized = this.normalizeLoginMessage(message);
    if (normalized) {
      return normalized;
    }
    const debugText = this.formatLoginDebug(debug);
    if (debugText) {
      return debugText;
    }
    return fallback;
  }

  private async isPasscodePromptVisible(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const doc = (globalThis as any).document as any;
      const acc = doc?.querySelector?.('#acc_show');
      const classList = acc?.classList;
      if (!classList || typeof classList.contains !== 'function') {
        return false;
      }
      return classList.contains('pass_outside');
    }).catch(() => false);
  }

  private async dismissPasscodePrompt(page: Page): Promise<boolean> {
    const visible = await this.isPasscodePromptVisible(page);
    if (!visible) {
      return false;
    }

    console.log('🛡️ 检测到四位安全码提示（不再点击“否”），交由专用流程处理');

    try {
      const snippet = await page.evaluate(() => {
        const doc = (globalThis as any).document as any;
        const container = doc?.querySelector?.('#acc_show');
        return container ? container.innerHTML : '';
      });
      const fileName = `passcode-debug-${Date.now()}.html`;
      await fs.writeFile(fileName, snippet || '');
      console.log(`📝 已导出安全码调试片段: ${fileName}`);
    } catch (dumpErr) {
      console.warn('⚠️ 导出安全码调试片段失败:', dumpErr);
    }

    // 不再自动点击“否”，统一交由 handlePasscodeRequirement 处理
    return false;
  }

  private normalizeTextToken(value?: string | null): string {
    if (!value) {
      return '';
    }
    return value
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[\s\n\r]+/g, '')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/主队|主隊/g, '主')
      .replace(/客队|客隊/g, '客');
  }

  private async detectBettingNoticeInContext(context: FrameLike): Promise<string | null> {
    try {
      return await context.evaluate(() => {
        const doc = (globalThis as any).document as any;
        if (!doc || !doc.body) {
          return null;
        }

        const checkText = (input?: string | null): string | null => {
          if (!input) {
            return null;
          }
          const normalized = input.replace(/\s+/g, ' ').trim();
          if (!normalized) {
            return null;
          }
          const rules: Array<{ pattern: RegExp; message: string }> = [
            { pattern: /目前.{0,6}(没有|無).{0,4}(赛事|賽事)/i, message: '目前没有任何赛事' },
            { pattern: /(网路|網路|网络|網絡).{0,8}(不稳定|不穩定).{0,8}(重新更新|请重新更新|請重新更新)/i, message: '网路不稳定，请重新更新' },
          ];
          for (const rule of rules) {
            if (rule.pattern.test(normalized)) {
              return rule.message;
            }
          }
          return null;
        };

        const candidateSelectors = [
          '#show_null',
          '#no_game_msg',
          '#wagers_none',
          '.box_nodata',
          '.list_nodata',
          '.noevent',
          '.no-event',
          '.no_data',
          '.no-data',
          '.noGame',
          '.no-event-txt',
          '.message',
          '.msg_event',
          '.alert',
          '.box_league .no_data',
          '.box_league .noevent',
          '#div_show .no_data',
          '#div_show .noevent',
          '#div_show .no_game',
        ];

        for (const selector of candidateSelectors) {
          try {
            const elements = Array.from(doc.querySelectorAll?.(selector) || []) as any[];
            for (const element of elements) {
              const text = element?.textContent || element?.innerText || '';
              const match = checkText(text);
              if (match) {
                return match;
              }
            }
          } catch {
            // ignore selector errors
          }
        }

        const bodyText = doc.body.innerText || doc.body.textContent || '';
        const bodyMatch = checkText(bodyText);
        if (bodyMatch) {
          return bodyMatch;
        }

        return null;
      });
    } catch {
      return null;
    }
  }

  private async detectBettingNotice(page: Page): Promise<string | null> {
    const contexts: FrameLike[] = [page, ...page.frames()];
    for (const ctx of contexts) {
      const notice = await this.detectBettingNoticeInContext(ctx);
      if (notice) {
        return notice;
      }
    }
    return null;
  }

  private normalizeTeamToken(value?: string | null): string {
    if (!value) {
      return '';
    }
    return value
      .toLowerCase()
      .replace(/[\s\n\r]+/g, '')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/主队|主隊/g, '主')
      .replace(/客队|客隊/g, '客');
  }

  private matchWagerByTeams(
    wagers: CrownWagerItem[],
    leagueName?: string | null,
    homeTeam?: string | null,
    awayTeam?: string | null,
  ): CrownWagerItem | null {
    const leagueToken = this.normalizeTeamToken(leagueName);
    const homeToken = this.normalizeTeamToken(homeTeam);
    const awayToken = this.normalizeTeamToken(awayTeam);

    const candidates = wagers.filter((item) => {
      if (!item.normalizedHome || !item.normalizedAway) {
        return false;
      }
      const homeMatch = homeToken ? item.normalizedHome.includes(homeToken) : true;
      const awayMatch = awayToken ? item.normalizedAway.includes(awayToken) : true;
      if (!homeMatch || !awayMatch) {
        return false;
      }
      if (leagueToken && item.normalizedLeague) {
        return item.normalizedLeague.includes(leagueToken);
      }
      return true;
    });

    if (candidates.length === 0) {
      return null;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    return candidates.sort((a, b) => (b.ticketId || '').localeCompare(a.ticketId || ''))[0];
  }

  public findMatchingWager(
    wagers: CrownWagerItem[],
    leagueName?: string | null,
    homeTeam?: string | null,
    awayTeam?: string | null,
  ): CrownWagerItem | null {
    return this.matchWagerByTeams(wagers, leagueName, homeTeam, awayTeam);
  }

  private async ensureFootballTodayView(page: Page, accountId?: number): Promise<void> {
    await page.bringToFront().catch(() => undefined);

    if (!/\/betting/i.test(page.url())) {
      try {
        await page.goto('/betting', { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (err) {
        console.warn('⚠️ 跳转至 /betting 失败（忽略）:', err);
      }
      await this.randomDelay(350, 620);
    }

    this.sportConfig.gtype = 'ft';
    this.sportConfig.showtype = 'today';
    this.sportConfig.rtype = 'r';

    await page.evaluate(() => {
      try {
        const topWin: any = (globalThis as any).top || globalThis;
        if (!topWin) {
          return;
        }
        topWin.choice_gtype = 'ft';
        topWin.choice_showtype = 'today';
        topWin.choice_rtype = 'r';
      } catch {
        // ignore access errors
      }
    }).catch(() => undefined);

    const getContexts = (): FrameLike[] => {
      const cachedBetting = this.bettingFrames.get(page as unknown as number);
      if (cachedBetting && !cachedBetting.isDetached()) {
        return [cachedBetting, ...page.frames()];
      }
      return [page, ...page.frames()];
    };

    const detectNotice = async (): Promise<string | null> => {
      return this.detectBettingNotice(page);
    };

    const clickSelector = async (candidates: string[], label: string, optional = false): Promise<void> => {
      const deadline = Date.now() + 8000;
      let seen = false;
      while (Date.now() < deadline) {
        for (const ctx of getContexts()) {
          for (const selector of candidates) {
            const locator = ctx.locator(selector);
            const count = await locator.count().catch(() => 0);
            if (count === 0) {
              continue;
            }
            seen = true;
            try {
              const alreadyActive = await locator.first().evaluate((el) => {
                const element = el as any;
                if (!element) {
                  return false;
                }
                const className = element.className || '';
                const ariaSelected = element.getAttribute?.('aria-selected') || '';
                if (/\b(active|on|selected|focus)\b/i.test(className)) {
                  return true;
                }
                if (ariaSelected && ariaSelected.toLowerCase() === 'true') {
                  return true;
                }
                return false;
              }).catch(() => false);
              if (alreadyActive) {
                return;
              }
            } catch {
              // ignore state detection errors
            }
            try {
              await locator.first().waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
              await locator.first().click({ delay: 60 });
              console.log(`🧭 已点击 ${label}: ${selector}`);
              await this.randomDelay(200, 360);
              return;
            } catch (clickErr) {
              console.warn(`⚠️ 点击 ${label} (${selector}) 失败，重试中:`, clickErr);
            }
          }
        }
        const notice = await detectNotice();
        if (notice) {
          throw new Error(notice);
        }
        await this.randomDelay(220, 360);
      }
      if (!seen && optional) {
        console.log(`ℹ️ 未检测到 ${label} (${candidates.join(', ')})，可能不需要点击`);
        return;
      }
      const notice = await detectNotice();
      if (notice) {
        throw new Error(notice);
      }
      throw new Error(`未能定位或点击 ${label}，请确认页面结构是否变更`);
    };

    const hasVisibleLeague = async (): Promise<boolean> => {
      const contexts = getContexts();
      for (const ctx of contexts) {
        const visible = await ctx
          .evaluate(() => {
            const doc = (globalThis as any).document as any;
            if (!doc) {
              return false;
            }
            const nodes = Array.from(doc.querySelectorAll('.box_league'));
            const isVisible = (el: any): boolean => {
              if (!el) {
                return false;
              }
              const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
              if (style) {
                if (style.display === 'none' || style.visibility === 'hidden') {
                  return false;
                }
                const opacity = parseFloat(style.opacity || '1');
                if (!Number.isNaN(opacity) && opacity === 0) {
                  return false;
                }
              }
              const rect = (el as any).getBoundingClientRect?.();
              if (rect && rect.width > 1 && rect.height > 1) {
                return true;
              }
              const offsetWidth = (el as any).offsetWidth ?? 0;
              const offsetHeight = (el as any).offsetHeight ?? 0;
              return offsetWidth > 1 && offsetHeight > 1;
            };
            return nodes.some(node => isVisible(node));
          })
          .catch(() => false);
        if (visible) {
          return true;
        }
      }
      return false;
    };

    const waitForLeague = async (): Promise<void> => {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (await hasVisibleLeague()) {
          return;
        }
        const notice = await detectNotice();
        if (notice) {
          throw new Error(notice);
        }
        await this.randomDelay(220, 360);
      }
      const notice = await detectNotice();
      if (notice) {
        throw new Error(notice);
      }
      throw new Error('未能加载足球今日盘口列表，请检查页面状态');
    };

    await clickSelector(['#symbol_ft', '#symbol_FT', '#sel_gtype_FT', '[data-sport="ft"]'], '足球导航');
    await clickSelector(['#today_page', '#page_today', '#today', '#sel_showtype_today', '[data-showtype="today"]'], '今日赛事');
    await clickSelector(['#league_tab_mix', '#league_tab_R', '#league_tab_r', '[data-rtype="r"]'], '让球/混合过关标签', true);

    await waitForLeague();
    console.log('✅ 已定位至足球-今日-赛前页面');
    if (accountId !== undefined) {
      this.lastBettingRefresh.delete(accountId);
    }
  }

  private async reloadBettingList(page: Page, accountId?: number): Promise<void> {
    const cacheKey = Number.isFinite(accountId) ? Number(accountId) : -1;
    const now = Date.now();
    const last = this.lastBettingRefresh.get(cacheKey) || 0;
    if (now - last < 1200) {
      return;
    }
    try {
      const reloadButton = page.locator('#refresh_right, #btn_refresh, .btn_refresh, button:has-text("刷新")').first();
      if (await reloadButton.count() > 0 && await reloadButton.isVisible()) {
        await reloadButton.click({ timeout: 2000 }).catch(() => undefined);
        await this.randomDelay(600, 900);
        this.lastBettingRefresh.set(cacheKey, Date.now());
        return;
      }
    } catch (err) {
      console.warn('⚠️ 点击刷新按钮失败（忽略）:', err);
    }

    await page.evaluate(() => {
      const topWin: any = (globalThis as any).top || globalThis;
      try {
        topWin.show_odds?.('today');
      } catch {}
      try {
        topWin.reload_league?.();
      } catch {}
      try {
        topWin.asyncMenu?.('FT', 'FT_today');
      } catch {}
    }).catch(() => undefined);
    await this.randomDelay(600, 900);
    this.lastBettingRefresh.set(cacheKey, Date.now());
  }

  private resolveBetSuffix(betRequest: BetRequest): string | null {
    const typeRaw = betRequest.betType ?? (betRequest as any).bet_type ?? '';
    const optionRaw = betRequest.betOption ?? (betRequest as any).bet_option ?? '';
    const typeText = this.normalizeTextToken(typeRaw);
    const optionText = this.normalizeTextToken(optionRaw);

    const typeMatches = (...keywords: string[]): boolean =>
      keywords.some((kw) => kw && typeText.includes(this.normalizeTextToken(kw)));

    const optionMatches = (...keywords: string[]): boolean =>
      keywords.some((kw) => kw && optionText.includes(this.normalizeTextToken(kw)));

    const mappingCandidates: Array<{ match: () => boolean; resolve: () => string | null }> = [
      {
        match: () => typeMatches('让球', '讓球', 'handicap', 're'),
        resolve: () => {
          if (optionMatches('主', 'home', 'h')) return 'REH';
          if (optionMatches('客', 'away', 'c')) return 'REC';
          return null;
        },
      },
      {
        match: () => typeMatches('大/小', '大小', 'over', 'under', 'rou'),
        resolve: () => {
          if (optionMatches('大', 'over', 'o')) return 'ROUC';  // 大 = Over
          if (optionMatches('小', 'under', 'u')) return 'ROUH'; // 小 = Under
          return null;
        },
      },
      {
        match: () => typeMatches('独赢', '獨贏', 'moneyline', '独勝', 'win'),
        resolve: () => {
          if (optionMatches('主', 'home', 'h')) return 'RMH';
          if (optionMatches('客', 'away', 'c')) return 'RMC';
          if (optionMatches('和', '平', 'draw', 'tie')) return 'RMN';
          return null;
        },
      },
      {
        match: () => typeMatches('下个进球', '下一球', '下個進球', 'nextgoal'),
        resolve: () => {
          if (optionMatches('主', 'home', 'h')) return 'RGH';
          if (optionMatches('客', 'away', 'c')) return 'RGC';
          if (optionMatches('无', '無', 'none', 'no', 'n')) return 'RGN';
          return null;
        },
      },
      {
        match: () => typeMatches('双方球队进球', '双方进球', '雙方進球', 'bothscores', 'btts'),
        resolve: () => {
          if (optionMatches('是', 'yes', 'y')) return 'RTSY';
          if (optionMatches('否', 'no', 'n')) return 'RTSN';
          return null;
        },
      },
      {
        match: () => typeMatches('单/双', '单双', '單雙', 'odd', 'even'),
        resolve: () => {
          if (optionMatches('单', 'odd', 'o')) return 'REOO';
          if (optionMatches('双', 'even', 'e')) return 'REOE';
          return null;
        },
      },
      {
        match: () => typeMatches('队伍1进球', '隊伍1進球', 'team1goal', '主队进球', '主隊進球'),
        resolve: () => {
          if (optionMatches('大', 'over', 'o')) return 'ROUHO';
          if (optionMatches('小', 'under', 'u')) return 'ROUHU';
          return null;
        },
      },
      {
        match: () => typeMatches('队伍2进球', '隊伍2進球', 'team2goal', '客队进球', '客隊進球'),
        resolve: () => {
          if (optionMatches('大', 'over', 'o')) return 'ROUCO';
          if (optionMatches('小', 'under', 'u')) return 'ROUCU';
          return null;
        },
      },
    ];

    for (const candidate of mappingCandidates) {
      try {
        if (candidate.match()) {
          const suffix = candidate.resolve();
          if (suffix) {
            return suffix;
          }
        }
      } catch (err) {
        console.warn('resolveBetSuffix candidate error:', err);
      }
    }

    return null;
  }

  // 模拟人类输入
  private maskPasscode(passcode: string): string {
    if (!passcode) {
      return '';
    }
    if (passcode.length <= 1) {
      return '*';
    }
    const headLength = Math.min(2, passcode.length - 1);
    return `${passcode.slice(0, headLength)}${'*'.repeat(passcode.length - headLength)}`;
  }

  private normalizePasscode(value?: string | null): string | null {
    if (!value) {
      return null;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length === 4) {
      return digits;
    }
    if (digits.length > 4) {
      return digits.slice(0, 4);
    }
    return null;
  }

  private isFourPwdPending(value?: string | null): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.toString().trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (['n', 'no', 'none', 'false', '0', 'complete', 'success', 'done'].includes(normalized)) {
      return false;
    }
    const keywords = ['new', 'second', 'third', 'again', 'reset', 'set', 'pending', 'need', 'require', 'required', 'retry', 'y', 'yes'];
    if (keywords.includes(normalized)) {
      return true;
    }
    return /passcode|4pwd|four\s*pwd|四位|四碼|简易|簡易/.test(normalized);
  }

  private generatePasscode(account: CrownAccount): string {
    const baseId = Math.abs(account.id ?? 0) || 1;
    const timeSeed = Date.now() % 10000;
    let candidate = ((baseId * 7919 + timeSeed) % 10000).toString().padStart(4, '0');
    const banned = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '1122', '1212', '6969']);
    let offset = 0;
    while (banned.has(candidate)) {
      offset += 97;
      candidate = ((baseId * 7919 + timeSeed + offset) % 10000).toString().padStart(4, '0');
    }
    return candidate;
  }

  private async persistPasscode(
    account: CrownAccount,
    passcode: string,
    normalizedStored: string,
    mode: 'setup' | 'input' | 'keypad',
  ): Promise<void> {
    if (mode === 'setup' || normalizedStored !== passcode) {
      try {
        await query(
          `UPDATE crown_accounts
             SET passcode = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [passcode, account.id],
        );
        console.log('💾 已将简易密码写入数据库');
      } catch (err) {
        console.warn('⚠️ 保存简易密码到数据库失败:', err);
      }
    }
  }

  private computePasscodeContainerScore(meta: PasscodeInputMeta): number {
    let score = 0;
    const containerId = (meta.containerId || '').toLowerCase();
    const containerClasses = (meta.containerClasses || '').toLowerCase();
    const combined = `${containerId} ${containerClasses}`;
    if (/passcode|pwd4|4pwd|prepass/.test(containerId)) {
      score += 5;
    }
    if (/passcode|pwd4|4pwd|prepass/.test(containerClasses)) {
      score += 4;
    }
    if (/content_chgpwd|popup_bottom|popup_content|pop_box|passcode/.test(containerClasses)) {
      score += 2;
    }
    if (/alert_confirm|confirm/.test(combined)) {
      score += 1;
    }
    if (/box_help_btn|msg_popup/.test(containerClasses)) {
      score += 1;
    }
    if (meta.maxLength && meta.maxLength <= 6) {
      score += 1;
    }
    return score;
  }

  private isLikelyPasscodeInput(meta: PasscodeInputMeta): boolean {
    const id = (meta.id || '').toLowerCase();
    const name = (meta.name || '').toLowerCase();
    const classes = (meta.className || '').toLowerCase();
    const placeholder = (meta.placeholder || '').toLowerCase();
    const label = (meta.labelText || '').toLowerCase();
    const aria = (meta.ariaLabel || '').toLowerCase();
    const type = (meta.type || '').toLowerCase();
    const inputMode = (meta.inputMode || '').toLowerCase();
    const maxLength = meta.maxLength ?? 0;

    if (/input_pwd4|btn_pwd4|passcode/.test(classes) || /passcode|pwd4|4pwd/.test(id)) {
      return true;
    }

    const combined = `${id} ${name} ${classes} ${placeholder} ${label} ${aria}`;
    const isPasswordLike = type === 'password' || type === 'tel' || type === 'number';
    const hasPasscodeKeyword = /passcode|pwd4|4pwd|簡易|簡碼|简易|简码|四位|4位/.test(combined);
    const hasPasswordWord = /密码|密碼|passcode|簡易|四位|4位|四碼|4碼/.test(combined);

    if (hasPasscodeKeyword && isPasswordLike) {
      return true;
    }

    if (isPasswordLike && hasPasswordWord && maxLength > 0 && maxLength <= 6) {
      return true;
    }

    if (isPasswordLike && (inputMode === 'numeric' || inputMode === 'tel') && maxLength > 0 && maxLength <= 6) {
      return true;
    }

    if (hasPasswordWord && maxLength === 4) {
      return true;
    }

    return false;
  }

  private async collectPasscodeGroups(page: Page): Promise<PasscodeGroup[]> {
    const contexts: FrameLike[] = [page, ...page.frames()];
    const groups: PasscodeGroup[] = [];

    for (const context of contexts) {
      const inputs = context.locator('input:not([type="hidden"]):not([disabled])');
      const total = await inputs.count().catch(() => 0);
      for (let i = 0; i < total; i += 1) {
        const locator = inputs.nth(i);
        let visible = false;
        try {
          visible = await locator.isVisible({ timeout: 200 }).catch(() => false);
        } catch {
          visible = false;
        }
        if (!visible) {
          continue;
        }

        const meta = await locator.evaluate((el) => {
          const element = el as any;
          const doc = element?.ownerDocument || (globalThis as any).document;
          const labelNode = element?.closest ? element.closest('label') : null;
          const labelText = labelNode?.textContent?.trim() || '';
          const ariaLabelId = element?.getAttribute ? element.getAttribute('aria-labelledby') || '' : '';
          let ariaLabel = element?.getAttribute ? (element.getAttribute('aria-label') || '') : '';
          if (!ariaLabel && ariaLabelId) {
            const parts = ariaLabelId
              .split(/\s+/)
              .map((idPart: string) => doc?.getElementById?.(idPart)?.textContent?.trim() || '')
              .filter(Boolean);
            ariaLabel = parts.join(' ').trim();
          }
          const parent = element?.closest
            ? element.closest('#prepasscode, .content_chgpwd, #alert_confirm, #C_alert_confirm, .popup_bottom, .popup_content, .pop_box, .passcode_box, .passcode_area, #passcode_main, .passcode_main, .oth_prepass_box')
            : null;
          const maxLengthAttr = element?.getAttribute ? element.getAttribute('maxlength') : null;
          return {
            id: element?.id || '',
            name: element?.getAttribute ? element.getAttribute('name') || '' : '',
            type: ((element?.getAttribute ? element.getAttribute('type') : '') || '').toLowerCase(),
            placeholder: element?.getAttribute ? element.getAttribute('placeholder') || '' : '',
            className: element?.className || '',
            maxLength: maxLengthAttr ? parseInt(maxLengthAttr, 10) || undefined : undefined,
            inputMode: element?.getAttribute ? element.getAttribute('inputmode') || '' : '',
            ariaLabel,
            labelText,
            containerId: parent?.id || '',
            containerClasses: parent?.className || '',
          } as PasscodeInputMeta;
        }).catch(() => null as PasscodeInputMeta | null);

        if (!meta || !this.isLikelyPasscodeInput(meta)) {
          continue;
        }

        const key = `${meta.containerId || ''}::${meta.containerClasses || ''}`;
        let group = groups.find((g) => g.context === context && g.key === key);
        if (!group) {
          group = {
            context,
            inputs: [],
            containerId: meta.containerId,
            containerClasses: meta.containerClasses,
            key,
            score: this.computePasscodeContainerScore(meta),
          };
          groups.push(group);
        }
        group.inputs.push({ locator, meta });
        group.score = Math.max(group.score, this.computePasscodeContainerScore(meta) + group.inputs.length);
      }
    }

    return groups
      .filter((group) => group.inputs.length > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (b.inputs.length !== a.inputs.length) {
          return b.inputs.length - a.inputs.length;
        }
        return 0;
      });
  }

  private async clickNumericPasscodeKey(context: FrameLike, digit: string): Promise<boolean> {
    const selectors = [
      `#panel #num_${digit}`,
      `#panel span#num_${digit}`,
      `.oth_pass_keyboard #num_${digit}`,
      `.oth_pass_keyboard span#num_${digit}`,
      `#num_${digit}`,
      `[data-num="${digit}"]`,
      `[data-value="${digit}"]`,
      `[data-val="${digit}"]`,
      `.passcode_key[data-num="${digit}"]`,
      `.passcode_key[data-value="${digit}"]`,
      `.passcode_key:has-text("${digit}")`,
      `button:has-text("${digit}")`,
    ];

    for (const selector of selectors) {
      const success = await context.evaluate(
        ([selectorIn, valueIn]: [string, string]) => {
          const doc = (globalThis as any).document;
        if (!doc) {
          return false;
        }
        const candidate = doc.querySelector(selectorIn);
        if (!candidate) {
          return false;
        }
        const ensureVisible = (node: any) => {
          if (!node || !node.style) {
            return;
          }
          node.style.opacity = '1';
          node.style.visibility = 'visible';
          if (!node.style.display || node.style.display === 'none') {
            node.style.display = 'inline-block';
          }
        };
        ensureVisible(candidate as any);
        const parent = (candidate as any)?.closest?.('.oth_pass_keyboard, #panel, .all_outside') as any;
        ensureVisible(parent);

        const trigger = (node: any) => {
          if (!node) return false;
          try {
            node.click?.();
            node.dispatchEvent?.(new Event('click', { bubbles: true, cancelable: true }));
            const MouseEvt = (globalThis as any).MouseEvent;
            if (typeof MouseEvt === 'function') {
              const evt = new MouseEvt('mousedown', { bubbles: true, cancelable: true });
              node.dispatchEvent?.(evt);
              const up = new MouseEvt('mouseup', { bubbles: true, cancelable: true });
              node.dispatchEvent?.(up);
            }
            const TouchEvt = (globalThis as any).TouchEvent;
            if (typeof TouchEvt === 'function') {
              const touchStart = new TouchEvt('touchstart', { bubbles: true, cancelable: true });
              node.dispatchEvent?.(touchStart);
              const touchEnd = new TouchEvt('touchend', { bubbles: true, cancelable: true });
              node.dispatchEvent?.(touchEnd);
            }
            return true;
          } catch {
            return false;
          }
        };

        if (trigger(candidate)) {
          return true;
        }

        const alt = doc.getElementById(`num_${valueIn}`);
        if (alt && alt !== candidate && trigger(alt)) {
          return true;
        }

          return false;
        },
        [selector, digit] as [string, string],
      ).catch(() => false);

      if (success) {
        return true;
      }
    }

    const fallback = await context.evaluate((value: string) => {
      const doc = (globalThis as any).document;
      if (!doc) {
        return false;
      }
      const collected: any[] = [];
      const pushIfNeeded = (node: any) => {
        if (node && !collected.includes(node)) {
          collected.push(node);
        }
      };
      pushIfNeeded(doc.querySelector(`#panel #num_${value}`));
      pushIfNeeded(doc.querySelector(`.oth_pass_keyboard #num_${value}`));
      pushIfNeeded(doc.getElementById(`num_${value}`));
      pushIfNeeded(doc.querySelector(`[data-num="${value}"]`));
      pushIfNeeded(doc.querySelector(`[data-value="${value}"]`));
      pushIfNeeded(doc.querySelector(`[data-val="${value}"]`));
      pushIfNeeded(doc.querySelector(`.passcode_key[data-num="${value}"]`));
      const triggerClick = (target: any) => {
        if (!target) {
          return false;
        }
        try {
          target.click?.();
          return true;
        } catch {}
        try {
          const MouseEvt = (globalThis as any).MouseEvent || (globalThis as any).Event;
          const TouchEvt = (globalThis as any).TouchEvent;
          if (typeof MouseEvt === 'function') {
            const evt = new MouseEvt('click', { bubbles: true, cancelable: true });
            target.dispatchEvent?.(evt);
          }
          if (typeof TouchEvt === 'function') {
            const touchStart = new TouchEvt('touchstart', { bubbles: true, cancelable: true });
            target.dispatchEvent?.(touchStart);
            const touchEnd = new TouchEvt('touchend', { bubbles: true, cancelable: true });
            target.dispatchEvent?.(touchEnd);
          }
          const PointerCtor = (globalThis as any).PointerEvent;
          if (typeof PointerCtor === 'function') {
            const pointerDown = new PointerCtor('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' });
            target.dispatchEvent?.(pointerDown);
            const pointerUp = new PointerCtor('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' });
            target.dispatchEvent?.(pointerUp);
          }
          return true;
        } catch {}
        return false;
      };
      for (const node of collected) {
        if (triggerClick(node)) {
          return true;
        }
      }
      return false;
    }, digit).catch(() => false);

    return !!fallback;
  }

  private async waitForNumericPasscodeResult(page: Page, timeout = 16000): Promise<{ dismissed: boolean; errorText?: string }> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const status = await page.evaluate(() => {
        const aggregate = {
          containerVisible: false,
          errorText: '',
          loginVisible: false,
          activeCount: 0,
        };

        const inspectDocument = (doc: any) => {
          if (!doc) {
            return;
          }

          const getVisible = (node: any) => {
            if (!node) {
              return false;
            }
            const style = (doc.defaultView || (globalThis as any).window)?.getComputedStyle?.(node);
            if (!style) {
              return false;
            }
            if (style.display === 'none' || style.visibility === 'hidden') {
              return false;
            }
            const opacity = Number.parseFloat(style.opacity || '1');
            return Number.isNaN(opacity) ? true : opacity > 0.05;
          };

          const container = doc.querySelector('#prepasscode, .content_chgpwd, .passcode_box, .passcode_area, #passcode_main, .passcode_main, .oth_prepass_box');
          if (container && getVisible(container)) {
            aggregate.containerVisible = true;
          }

          const errorNode = doc.getElementById('oth_pass_err');
          if (!aggregate.errorText && errorNode && getVisible(errorNode)) {
            aggregate.errorText = (errorNode.textContent || '').trim();
          }

          const loginNode = doc.getElementById('acc_show');
          if (loginNode && getVisible(loginNode)) {
            aggregate.loginVisible = true;
          }

          const emptyBar = doc.querySelector('#empty_bar');
          if (emptyBar) {
            const count = Array.from(emptyBar.querySelectorAll('.active')).length;
            if (count > aggregate.activeCount) {
              aggregate.activeCount = count;
            }
          }
        };

        try {
          inspectDocument((globalThis as any).document);
        } catch {}

        try {
          const frames = Array.from((globalThis as any).frames || []) as any[];
          for (const rawFrame of frames) {
            try {
              const frame = rawFrame as any;
              inspectDocument(frame && frame.document ? frame.document : null);
            } catch {}
          }
        } catch {}

        return aggregate;
      }).catch(() => ({ containerVisible: false, errorText: '', loginVisible: false, activeCount: 0 }));

      if (status.errorText) {
        return { dismissed: false, errorText: status.errorText };
      }

      const filledCount = Number(status.activeCount || 0);
      if (filledCount >= 4) {
        return { dismissed: true };
      }

      if (!status.containerVisible || !status.loginVisible) {
        return { dismissed: true };
      }

      await this.randomDelay(240, 380);
    }

    return { dismissed: false };
  }

  private async tryHandlePasscodeKeypad(
    page: Page,
    passcode: string,
  ): Promise<{ found: boolean; success?: boolean; reason?: string; errorText?: string }> {
    const sanitized = (passcode || '').replace(/\D/g, '');
    if (sanitized.length !== 4) {
      return { found: false };
    }

    const contexts: FrameLike[] = [page, ...page.frames()];
    let keypadContext: FrameLike | null = null;
    let keypadMeta: { digits: number; indicators: number } | null = null;

    for (let scanAttempt = 0; scanAttempt < 12 && !keypadContext; scanAttempt += 1) {
      for (const context of contexts) {
        const contextName = (context as any).name?.() || (context === page ? 'page' : 'frame');
        try {
          const detected = await context.evaluate(() => {
            const doc = (globalThis as any).document;
            if (!doc) {
              return null;
            }

          const countVisible = (nodes: any): number => {
            const list = Array.isArray(nodes) ? nodes : Array.from(nodes || []);
            let visibleCount = 0;
            for (const node of list) {
              if (!node) {
                continue;
              }
              const style = (globalThis as any).window?.getComputedStyle?.(node as any);
              if (!style) {
                continue;
              }
              if (style.display === 'none' || style.visibility === 'hidden') {
                continue;
              }
              const opacity = Number.parseFloat(style.opacity || '1');
              if (!Number.isNaN(opacity) && opacity <= 0.05) {
                continue;
              }
              visibleCount += 1;
            }
            return visibleCount;
          };

          const digitCandidates = doc.querySelectorAll(
            '#panel [id^="num_"], .oth_pass_keyboard [id^="num_"], .passcode_key, .passcode-btn, .passcode_num, .passcode-num',
          );
          const digitsVisible = countVisible(digitCandidates);

          const indicatorCandidates = doc.querySelectorAll('#empty_bar .empty, #empty_bar li, .oth_pass_circle li');
          const indicatorsVisible = countVisible(indicatorCandidates);

          if (digitsVisible === 0 && indicatorsVisible === 0) {
            return null;
          }

          return {
            digits: digitsVisible,
            indicators: indicatorsVisible,
          };
            return {
              digits: digitsVisible,
              indicators: indicatorsVisible,
            };
          });

          console.log('[passcode_keypad_detect]', {
            attempt: scanAttempt,
            context: contextName,
            digits: detected?.digits ?? 0,
            indicators: detected?.indicators ?? 0,
          });

          if (detected && detected.digits > 0) {
            keypadContext = context;
            keypadMeta = detected;
            break;
          }
        } catch (err) {
          console.warn(`⚠️ 检测数字简易密码面板失败 (${contextName}):`, err);
        }
      }

      if (!keypadContext) {
        await this.randomDelay(140, 260);
      }
    }

    if (!keypadContext || !keypadMeta) {
      console.log('ℹ️ 数字简易密码面板未检测到，跳过 keypad 输入处理');
      return { found: false };
    }

    console.log(
      `🕹️ 检测到数字简易密码面板，按键数 ${keypadMeta.digits}，指示器 ${keypadMeta.indicators}，使用按键输入 ${this.maskPasscode(sanitized)}`,
    );

    for (const digit of sanitized.split('')) {
      const clicked = await this.clickNumericPasscodeKey(keypadContext, digit);
      if (!clicked) {
        console.warn(`⚠️ 找不到用于输入数字 ${digit} 的按键`);
        return { found: true, success: false, reason: `keypad_digit_${digit}_missing` };
      }
      console.log(`🕹️ 已点击数字 ${digit}`);
      await this.randomDelay(90, 170);
    }

    this.lastPasscodeRejected = false;

    const result = await this.waitForNumericPasscodeResult(page, 18000);
    if (result.errorText) {
      return { found: true, success: false, reason: 'keypad_rejected', errorText: result.errorText };
    }
    if (!result.dismissed) {
      return { found: true, success: false, reason: 'keypad_dismiss_timeout' };
    }

    return { found: true, success: true };
  }

  private async setPasscodeMarker(group: PasscodeGroup): Promise<string | null> {
    if (!group.inputs.length) {
      return null;
    }
    const marker = `passcode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const applied = await group.inputs[0].locator.evaluate((node, mark) => {
        const scope = node.closest('#prepasscode, .content_chgpwd, #alert_confirm, #C_alert_confirm, .popup_bottom, .popup_content, .pop_box, .passcode_box, .passcode_area, #passcode_main, .passcode_main, .oth_prepass_box');
        if (scope) {
          scope.setAttribute('data-passcode-marker', mark);
          return true;
        }
        return false;
      }, marker);
      if (applied) {
        return marker;
      }
    } catch (err) {
      console.warn('⚠️ 标记简易密码弹窗失败:', err);
    }
    return null;
  }

  private async clearPasscodeMarker(context: FrameLike, marker?: string | null): Promise<void> {
    if (!marker) {
      return;
    }
    try {
      await context.evaluate((mark) => {
        const doc = (globalThis as any).document;
        if (!doc) {
          return;
        }
        const nodes = Array.from(doc.querySelectorAll(`[data-passcode-marker="${mark}"]`)) as any[];
        nodes.forEach((node: any) => node.removeAttribute('data-passcode-marker'));
      }, marker);
    } catch {
      // 忽略清理错误
    }
  }

  private async ensurePasscodeInterface(page: Page, tag: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ensured = await page.evaluate((attemptIndex) => {
        const globalScope = (globalThis as any);
        const doc = globalScope?.document as any;
        const topWin = (globalScope?.top || globalScope) as any;
        if (!doc) {
          return false;
        }

        const hasContainer = () => doc.querySelector('#prepasscode, .content_chgpwd, .passcode_box, .passcode_area, .oth_prepass_box');
        if (hasContainer()) {
          return true;
        }

        const accShow = doc.querySelector('#acc_show');
        if (accShow && accShow.classList && !accShow.classList.contains('pass_outside')) {
          accShow.classList.add('pass_outside');
        }

        try {
          const cookieManager = topWin?.CookieManager2 || topWin?.CookieManager;
          if (cookieManager && typeof cookieManager.set === 'function') {
            const pidValue = `auto_${Date.now()}`;
            cookieManager.set('PID', pidValue);
            const uidValue = topWin?.userData?.passwd_safe || `uid_${Date.now()}`;
            cookieManager.set('UID', uidValue);
          } else {
            const hasPid = (doc.cookie || '').split(';').some((entry: string) => entry.trim().toLowerCase().startsWith('pid='));
            if (!hasPid) {
              const cookieValue = `PID=${btoa(`auto_${Date.now()}`)}; path=/; SameSite=None`;
              doc.cookie = cookieValue;
            }
          }
        } catch {}

        const revealButtonIds = ['btn_pwd4', 'btn_pwd4_yes', 'btn_passcode_ok'];
        for (const id of revealButtonIds) {
          const btn = doc.getElementById(id) as any;
          if (!btn) {
            continue;
          }
          try {
            btn.style.display = '';
          } catch {}
          try {
            btn.removeAttribute?.('disabled');
          } catch {}
          try {
            btn.click?.();
          } catch {}
        }

        const confirmButtons = doc.querySelectorAll('#btn_pwd4_yes, #btn_passcode_ok, #C_yes_btn, #yes_btn, .btn_passcode_confirm');
        confirmButtons.forEach((element: any) => {
          try {
            element.click?.();
          } catch {}
        });

        const tryInvoke = (obj: any) => {
          if (!obj) {
            return;
          }
          const candidates = ['show_prepasscode', 'prepasscode', 'goToPrePasscode'];
          for (const key of candidates) {
            const fn = obj[key];
            if (typeof fn === 'function') {
              try {
                fn.call(obj, {});
              } catch {}
            }
          }
        };

        tryInvoke(topWin);
        tryInvoke(topWin?.login_index);
        tryInvoke(topWin?.loginIndex);
        tryInvoke(topWin?.loginindex);
        tryInvoke(topWin?.login);
        tryInvoke(topWin?.loginObj);
        tryInvoke(topWin?.loginIndexObj);
        tryInvoke(topWin?.loginIndexInstance);
        tryInvoke(topWin?.parentClass);

        const possibleStores = ['login_index_obj', 'loginIndexObj', 'loginObj', 'login_index'];
        for (const store of possibleStores) {
          tryInvoke(topWin?.[store]);
        }

        if (attemptIndex >= 1 && typeof (globalThis as any).login_index === 'function') {
          try {
            const inst = new (globalThis as any).login_index(globalThis, doc);
            inst.init?.();
            inst.show_prepasscode?.();
          } catch {}
        }

        const triggerShowPrepasscode = (candidate: any) => {
          if (!candidate) {
            return;
          }
          try {
            if (typeof candidate.show_prepasscode === 'function') {
              candidate.show_prepasscode();
            }
          } catch {}
          try {
            if (typeof candidate.goToPage === 'function') {
              candidate.goToPage('acc_show', 'prepasscode', () => undefined, {});
            }
          } catch {}
          try {
            if (typeof candidate.dispatchEvent === 'function') {
              candidate.dispatchEvent('show_prepasscode', {});
            }
          } catch {}
        };

        try {
          const pc = topWin?.parentClass;
          const candidateTargets: any[] = [];
          if (pc) {
            candidateTargets.push(pc);
            if (typeof pc.getThis === 'function') {
              try { candidateTargets.push(pc.getThis('loginFrame')); } catch {}
              try { candidateTargets.push(pc.getThis('prepasscode')); } catch {}
              try { candidateTargets.push(pc.getThis('alertFrame')); } catch {}
            }
            if (pc?.myhash && typeof pc.myhash === 'object') {
              for (const key of ['loginFrame', 'prepasscode', 'alertFrame']) {
                if (pc.myhash[key]) {
                  candidateTargets.push(pc.myhash[key]);
                }
              }
            }
          }
          for (const target of candidateTargets) {
            triggerShowPrepasscode(target);
          }
          if (pc && typeof pc.dispatchEvent === 'function') {
            pc.dispatchEvent('show_prepasscode', {});
            pc.dispatchEvent('show_back_4pwd', {});
          }
        } catch {}

        if (typeof (globalScope as any).login_index === 'function') {
          try {
            const registry = globalScope as any;
            if (!registry.__codexLoginIndex) {
              const created = new registry.login_index(registry, doc);
              created.init?.();
              registry.__codexLoginIndex = created;
            }
            const instance = registry.__codexLoginIndex;
            if (instance) {
              try {
                instance.show_prepasscode?.();
              } catch {}
              try {
                instance.dispatchEvent?.('show_prepasscode', {});
              } catch {}
              try {
                instance.dispatchEvent?.('show_back_4pwd', {});
              } catch {}
            }
          } catch {}
        }

        if (!doc.getElementById('prepasscode')) {
          try {
            if (typeof topWin?.chk_acc === 'function') {
              topWin.chk_acc();
            }
          } catch {}
          try {
            if (typeof topWin?.loginSuccess === 'function') {
              topWin.loginSuccess();
            }
          } catch {}
          try {
            if (typeof topWin?.show_prepasscode === 'function') {
              topWin.show_prepasscode();
            }
          } catch {}
        }

        const acc = doc.querySelector('#prepasscode, .content_chgpwd, .passcode_box, .passcode_area, .oth_prepass_box');
        if (acc) {
          return true;
        }

        if (attemptIndex >= 1) {
          const url = topWin?.m2_url || topWin?.m_url;
          if (url && typeof topWin?.goToPage === 'function') {
            try {
              topWin.goToPage('acc_show', 'prepasscode', () => undefined, {});
            } catch {}
          }
        }

        return !!hasContainer();
      }, attempt).catch(() => false);

      if (ensured) {
        return true;
      }

      await this.randomDelay(200, 400);
    }

    await this.dumpPasscodeContext(page, `ensure-failed-${tag}`);
    return false;
  }

  private async syncPasscodeViaApi(page: Page, fallbackPasscode?: string): Promise<boolean> {
    try {
      const result = await page.evaluate(async (fallback) => {
        const globalScope = (globalThis as any);
        const topWin = (globalScope?.top || globalScope) as any;
        const doc = globalScope?.document as any;
        if (!topWin || !topWin.userData) {
          return { ok: false, reason: 'missing_state' };
        }

        const normalizeDigits = (value: any) => String(value ?? '').replace(/\D/g, '').slice(0, 4);

        if (!topWin.memSet) {
          topWin.memSet = {};
        }

        const passcodeCandidate = (() => {
          const fallbackCandidate = normalizeDigits(fallback);
          if (fallbackCandidate.length === 4) {
            return fallbackCandidate;
          }
          const memCandidate = normalizeDigits(topWin.memSet?.passcode || topWin.memSet?.fourPwd || '');
          if (memCandidate.length === 4) {
            return memCandidate;
          }
          return '';
        })();

        if (!passcodeCandidate) {
          return { ok: false, reason: 'missing_passcode' };
        }

        topWin.memSet.passcode = passcodeCandidate;

        const paramString = typeof topWin.param === 'string' ? topWin.param : '';
        const params = new URLSearchParams();
        params.set('p', 'checkPassCode');

        if (paramString) {
          paramString.split('&').forEach((segment: string) => {
            if (!segment) {
              return;
            }
            const [rawKey, ...rest] = segment.split('=');
            if (!rawKey) {
              return;
            }
            const key = rawKey.trim();
            const value = rest.join('=').trim();
            if (key) {
              params.append(key, value);
            }
          });
        }

        const today = new Date().toISOString().slice(0, 10);
        const inputCode = [
          topWin.userData.passwd_safe || '',
          passcodeCandidate,
          topWin.userData.mid || '',
          'N',
          today,
        ].join('|');

        params.set('inputCode', inputCode);
        params.set('action', 'SET');

        const targetUrl = topWin.m2_url || (doc?.location ? `${doc.location.origin}/transform.php` : '');
        if (!targetUrl) {
          return { ok: false, reason: 'missing_target_url' };
        }

        let responseText = '';
        try {
          const response = await globalScope.fetch(targetUrl, {
            method: 'POST',
            body: params.toString(),
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });
          responseText = await response.text();
        } catch (fetchErr) {
          return { ok: false, reason: `fetch_error:${String(fetchErr)}` };
        }

        const codeMatch = responseText.match(/<code>(\d+)<\/code>/i);
        const dataMatch = responseText.match(/<data>([^<]*)<\/data>/i);
        if (!codeMatch) {
          return { ok: false, reason: 'code_missing', text: responseText.slice(0, 200) };
        }

        const code = codeMatch[1];
        if (code !== '484') {
          return { ok: false, reason: `code_${code}`, text: responseText.slice(0, 200) };
        }

        const pidRaw = dataMatch ? dataMatch[1] : '';
        if (!pidRaw) {
          return { ok: false, reason: 'pid_missing', text: responseText.slice(0, 200) };
        }

        try {
          const cookieManager = topWin?.CookieManager2 || topWin?.CookieManager;
          const encodedPid = encodeURIComponent(pidRaw);
          if (cookieManager && typeof cookieManager.set === 'function') {
            cookieManager.set('PID', encodedPid, 3650);
            if (topWin?.userData?.passwd_safe) {
              cookieManager.set('UID', topWin.userData.passwd_safe, 3650);
            }
          } else if (doc) {
            doc.cookie = `PID=${encodedPid}; path=/; SameSite=None`;
          }
          if (topWin?.userData) {
            topWin.userData.secondSet4pwd = 'Y';
          }
          if (topWin?.memSet) {
            topWin.memSet.passcode = passcodeCandidate;
          }
          try {
            if (typeof topWin.goToHomePage === 'function') {
              topWin.goToHomePage();
            } else if (topWin?.util && typeof topWin.util.topGoToUrl === 'function') {
              const targetUrl = topWin.util.getWebUrl?.() || (doc?.location ? doc.location.href : '');
              if (targetUrl) {
                topWin.util.topGoToUrl(targetUrl, topWin.userData || {});
              }
            }
            if (typeof topWin.loginSuccess === 'boolean') {
              topWin.loginSuccess = true;
            }
          } catch {}
        } catch (cookieErr) {
          return { ok: false, reason: `cookie_error:${String(cookieErr)}` };
        }

        let homeUrl: string | undefined;
        try {
          if (topWin?.util && typeof topWin.util.getWebUrl === 'function') {
            homeUrl = topWin.util.getWebUrl();
          }
        } catch {}

        if (!homeUrl) {
          try {
            const origin = doc?.location?.origin || '';
            homeUrl = origin ? `${origin}/` : undefined;
          } catch {}
        }

        return { ok: true, homeUrl };
      });

      if (result?.ok) {
        console.log('[passcode_sync] homeUrl candidate:', result.homeUrl);
        if (result.homeUrl) {
          try {
            await page.goto(result.homeUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 30000,
            });
          } catch (gotoErr) {
            console.warn('[passcode_sync] 无法直接跳转首页:', gotoErr);
          }
        }
        console.log('[passcode_sync] server sync succeeded');
        return true;
      }

      console.log('[passcode_sync] server sync failed', result);
    } catch (err) {
      console.warn('[passcode_sync] exception', err);
    }
    return false;
  }

  private async clickPasscodeConfirm(context: FrameLike, marker?: string | null): Promise<boolean> {
    const keypadOnly = await context.evaluate(() => {
      try {
        const doc = (globalThis as any).document;
        if (!doc) {
          return false;
        }
        const container = doc.querySelector('#oth_pass_set.oth_pass_box, .oth_prepass_box');
        if (!container || container.getAttribute('style')?.includes('display: none')) {
          return false;
        }
        const hasKeyboard = !!container.querySelector('.oth_pass_keyboard');
        if (!hasKeyboard) {
          return false;
        }
        const confirmCandidate = container.querySelector('#btn_pwd4, #btn_pwd4_yes, #btn_passcode_ok, .btn_passcode_confirm, button.btn_passcode_confirm');
        return !confirmCandidate;
      } catch {
        return false;
      }
    }).catch(() => false);

    if (keypadOnly) {
      console.log('ℹ️ 检测到仅数字键盘的四位码界面，无需点击确认按钮');
      return true;
    }

    const candidateSelectors = [
      '#btn_passcode_ok',
      '#btn_pwd4_yes',
      '#btn_pwd4',
      '#C_yes_btn',
      '#C_ok_btn',
      '#yes_btn',
      '.btn_passcode_confirm',
      '.btn_submit:has-text("确认")',
      '.btn_submit:has-text("確定")',
      '.btn_submit:has-text("OK")',
      '.btn_submit:has-text("Yes")',
      '.btn_submit:has-text("Continue")',
      'button:has-text("OK")',
      'button:has-text("Yes")',
      'button:has-text("Continue")',
      '.btn_submit:has-text("是")',
      'button:has-text("确认")',
      'button:has-text("確定")',
      'button:has-text("OK")',
      'button:has-text("Yes")',
      'button:has-text("Continue")',
      'button:has-text("是")',
      '[role="button"]:has-text("确认")',
      '[role="button"]:has-text("確定")',
      '[role="button"]:has-text("OK")',
      '[role="button"]:has-text("Yes")',
      '[role="button"]:has-text("Continue")',
      '[role="button"]:has-text("是")',
      'text="确认"',
      'text="確定"',
      'text="OK"',
      'text="Yes"',
      'text="Continue"',
      'text="是"',
      'text="设定"',
      'text="設定"',
      'text="Set"',
      'text="Proceed"',
      'text="Next"',
    ];

    const scopeLocators: Locator[] = [];
    if (marker) {
      const scope = context.locator(`[data-passcode-marker="${marker}"]`);
      if ((await scope.count().catch(() => 0)) > 0) {
        scopeLocators.push(scope);
      }
    }
    scopeLocators.push(
      context.locator('#C_alert_confirm'),
      context.locator('#alert_confirm'),
      context.locator('.content_chgpwd'),
      context.locator('.popup_bottom'),
      context.locator('body'),
    );

    for (const scope of scopeLocators) {
      for (const selector of candidateSelectors) {
        const candidate = scope.locator(selector).first();
        if ((await candidate.count().catch(() => 0)) === 0) {
          continue;
        }
        try {
          const styleInfo = await candidate.evaluate((node: any) => {
            const win = (globalThis as any).window || globalThis;
            const style = win?.getComputedStyle?.(node);
            return {
              display: style?.display,
              visibility: style?.visibility,
              opacity: style ? parseFloat(style.opacity || '0') : 0,
            };
          }).catch(() => null);

          if (styleInfo && (styleInfo.display === 'none' || styleInfo.visibility === 'hidden' || styleInfo.opacity === 0)) {
            continue;
          }

          const visible = await candidate.isVisible().catch(() => false);
          if (!visible) {
            await candidate.evaluate((node: any) => {
              try {
                if (node && node.style) {
                  node.style.display = '';
                  node.style.visibility = 'visible';
                  node.style.opacity = '1';
                }
                const container = node?.closest?.('.popup_bottom, .popup_content, #alert_confirm, #C_alert_confirm, body');
                if (container && container.style) {
                  container.style.display = '';
                  container.style.visibility = 'visible';
                  container.style.opacity = '1';
                }
              } catch {}
            }).catch(() => undefined);
          }

          try {
            await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
          } catch {}
          try {
            await candidate.evaluate((node: any) => {
              try {
                if (typeof node?.scrollIntoView === 'function') {
                  node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' } as any);
                }
                const parent = node?.closest?.('.popup_bottom, .popup_content, #alert_confirm, #C_alert_confirm');
                if (parent && typeof parent.scrollIntoView === 'function') {
                  parent.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' } as any);
                }
              } catch {}
            }).catch(() => undefined);
          } catch {}

          await candidate.click({ timeout: 2000, force: true });
          await this.randomDelay(150, 260);
          return true;
        } catch (err) {
          console.warn(`⚠️ 点击简易密码确认按钮失败 (${selector}):`, err);
          try {
            await candidate.evaluate((node: any) => {
              try {
                if (node && node.style) {
                  node.style.display = '';
                  node.style.visibility = 'visible';
                  node.style.opacity = '1';
                }
              } catch {}
              if (typeof node?.click === 'function') {
                node.click();
                return true;
              }
              try {
                node?.dispatchEvent?.(new Event('click', { bubbles: true, cancelable: true }));
                return true;
              } catch {}
              return false;
            });
            await this.randomDelay(150, 260);
            return true;
          } catch {
            // 继续尝试其他元素
          }
        }
      }
    }
    return false;
  }

  private async waitForPasscodeDismiss(page: Page, timeout = 12000): Promise<boolean> {
    try {
      await page.waitForFunction(() => {
        const doc = (globalThis as any).document;
        if (!doc) {
          return true;
        }
        const acc = doc.querySelector('#acc_show');
        const hasPassOutside = acc?.classList?.contains('pass_outside');
        if (hasPassOutside) {
          return false;
        }
        const passcodeSelectors = '#prepasscode, .passcode_box, .passcode_area, #passcode_main, .passcode_main, .oth_prepass_box';
        const visiblePasscodeContainer = doc.querySelector(passcodeSelectors);
        if (visiblePasscodeContainer) {
          const win = (globalThis as any).window || globalThis;
          const style = win.getComputedStyle?.(visiblePasscodeContainer as any);
          if (style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            return false;
          }
        }
        const markerExists = doc.querySelector('[data-passcode-marker]');
        return !markerExists;
      }, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  private async dumpPasscodeDebug(page: Page, fileName: string) {
    try {
      const snippet = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        if (!doc) {
          return '';
        }
        const acc = doc.querySelector('#acc_show');
        if (acc) {
          return acc.innerHTML;
        }
        return doc.documentElement?.outerHTML || '';
      });
      await fs.writeFile(fileName, snippet || '');
      console.log(`📝 已导出安全码调试片段: ${fileName}`);
    } catch (err) {
      console.warn('⚠️ 导出安全码调试片段失败:', err);
    }
  }

  private async dumpPasscodeContext(page: Page, tag: string): Promise<void> {
    const timestamp = Date.now();
    const baseName = `passcodeCtx-${tag}-${timestamp}`;

    try {
      const contextData: Record<string, any> = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const topWin = (globalThis as any).top || (globalThis as any);
        const selectors = [
          '#alert_confirm',
          '#C_alert_confirm',
          '#prepasscode',
          '.content_chgpwd',
          '.passcode_box',
          '.passcode_area',
          '#acc_show',
          '#chgAcc_show',
          '#home_show',
          '#sysreq_show',
        ];

        const serializeNode = (node: any) => {
          if (!node) {
            return null;
          }
          const win = (globalThis as any).window || globalThis;
          const style = win?.getComputedStyle?.(node);
          const visible = !!style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          return {
            tagName: node.tagName,
            id: node.id,
            className: node.className,
            display: style?.display,
            visibility: style?.visibility,
            opacity: style?.opacity,
            outerHTML: node.outerHTML?.slice(0, 4000) || '',
            visible,
          };
        };

        const selectorInfo: Record<string, any> = {};
        selectors.forEach((selector) => {
          try {
            const node = doc?.querySelector?.(selector);
            selectorInfo[selector] = serializeNode(node);
          } catch (err) {
            selectorInfo[selector] = { error: String(err) };
          }
        });

        const active = doc?.activeElement;

       let topKeys: string[] = [];
        let topKeyMatches: string[] = [];
        try {
          const keys = Object.keys(topWin || {});
          if (Array.isArray(keys)) {
            topKeys = keys.filter((key: string) => typeof key === 'string').slice(0, 120);
            topKeyMatches = keys
              .filter((key: string) => /login|pass|pwd|four|code/i.test(key))
              .slice(0, 120);
          }
        } catch (err) {
          topKeys = [`error:${String(err)}`];
        }

        const topKeyDetails: Record<string, string> = {};
       topKeyMatches.forEach((key) => {
          try {
            const value = (topWin as any)[key];
            const valueType = value === null ? 'null' : typeof value;
            topKeyDetails[key] = valueType;
          } catch (detailErr) {
            topKeyDetails[key] = `error:${String(detailErr)}`;
          }
        });

       let myhashKeys: string[] = [];
       try {
         const mh = (topWin as any).myhash;
         if (mh && typeof mh === 'object') {
           myhashKeys = Object.keys(mh);
         }
       } catch {}

       let frameKeys: string[] = [];
       try {
         const keys = Object.keys(topWin || {});
         frameKeys = keys.filter((key: string) => /frame|parent|dispatch/i.test(key)).slice(0, 120);
       } catch {}

        let utilKeys: string[] = [];
        try {
          const utilObj = (topWin as any).util;
          if (utilObj && typeof utilObj === 'object') {
            utilKeys = Object.keys(utilObj).slice(0, 200);
          }
        } catch {}

        return {
          url: (globalThis as any).location?.href,
          timestamp: Date.now(),
          selectorInfo,
          activeElement: active ? serializeNode(active) : null,
          accShowClass: doc?.querySelector?.('#acc_show')?.className || null,
          bodyClass: doc?.body?.className || null,
          topKeys,
          topKeyMatches,
          topKeyDetails,
          myhashKeys,
          frameKeys,
          utilKeys,
        };
      });

      const frameInfos = await Promise.all(page.frames().map(async (frame) => {
        try {
          const frameData = await frame.evaluate(() => {
            const doc = (globalThis as any).document;
            const win = (globalThis as any).window || globalThis;
            const captureInputs = () => {
              const results: Array<Record<string, any>> = [];
              const inputs = doc?.querySelectorAll?.('input');
              if (!inputs) {
                return results;
              }
              inputs.forEach((input: any) => {
                try {
                  const id = input?.id || '';
                  const name = input?.name || '';
                  const type = (input?.type || '').toLowerCase();
                  const placeholder = input?.placeholder || '';
                  const maxLength = Number.parseInt(input?.getAttribute?.('maxlength') || '', 10) || null;
                  const className = input?.className || '';
                  const valueLength = typeof input?.value === 'string' ? input.value.length : null;
                  const keywords = `${id} ${name} ${className} ${placeholder}`.toLowerCase();
                  const hasKeyword = /pass|code|pwd|4位|四位|簡|简|pin/.test(keywords) || (maxLength !== null && maxLength <= 6);
                  if (!hasKeyword) {
                    return;
                  }
                  const style = win?.getComputedStyle?.(input);
                  const visible = !!style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                  results.push({
                    id,
                    name,
                    type,
                    placeholder,
                    className,
                    maxLength,
                    valueLength,
                    visible,
                    outerHTML: input?.outerHTML?.slice(0, 400) || '',
                  });
                } catch (innerErr) {
                  results.push({ error: String(innerErr) });
                }
              });
              return results;
            };

            return {
              url: (globalThis as any).location?.href,
              title: doc?.title,
              frameName: (globalThis as any).name || null,
              passcodeInputs: captureInputs(),
            };
          });
          return {
            name: frame.name(),
            url: frame.url(),
            data: frameData,
          };
        } catch (err) {
          return {
            name: frame.name(),
            url: frame.url(),
            error: String(err),
          };
        }
      }));

      contextData.frames = frameInfos;
      await fs.writeFile(`${baseName}.json`, JSON.stringify(contextData, null, 2));
      console.log(`🧾 已导出安全码上下文: ${baseName}.json`);
    } catch (err) {
      console.warn('⚠️ 导出安全码上下文失败:', err);
    }

    try {
      await page.screenshot({ path: `${baseName}.png`, fullPage: true });
      console.log(`🖼️ 已保存安全码上下文截图: ${baseName}.png`);
    } catch (err) {
      console.warn('⚠️ 保存安全码上下文截图失败:', err);
    }

    const frames = page.frames();
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index];
      try {
        const frameElement = await frame.frameElement().catch(() => null);
        if (!frameElement) {
          continue;
        }
        const framePath = `${baseName}-frame-${index}.png`;
        await frameElement.screenshot({ path: framePath });
        console.log(`🖼️ 已保存安全码子框架截图: ${framePath}`);
      } catch (err) {
        console.warn(`⚠️ 保存子框架截图失败 (index=${index}):`, err);
      }
    }
  }

  private async evaluatePasscodeState(page: Page): Promise<PasscodeState | null> {
    try {
      return await page.evaluate(() => {
        const topWin = (globalThis as any).top || (globalThis as any);
        const userData = topWin?.userData || {};
        const memSet = topWin?.memSet || {};
        return {
          userData: {
            username: userData.username,
            mid: userData.mid,
            four_pwd: userData.four_pwd,
            msg: userData.msg,
            abox4pwd_notshow: userData.abox4pwd_notshow,
            passwd_safe: userData.passwd_safe,
          },
          memSet: {
            passcode: memSet.passcode,
            fourPwd: memSet.fourPwd,
          },
          cookies: (globalThis as any).document?.cookie || '',
        } as PasscodeState;
      });
    } catch (err) {
      console.warn('⚠️ 获取 passcode 状态失败:', err);
      return null;
    }
  }

  private async handlePasscodeRequirement(page: Page, account: CrownAccount): Promise<PasscodeHandlingResult> {
    console.log('🛡️ 检测到四位安全码提示，准备处理');
    this.lastPasscodeRejected = false;

    const state = await this.evaluatePasscodeState(page);
    if (state) {
      console.log('[passcode_state]', JSON.stringify(state));
    }

    const storedPasscode = this.normalizePasscode(account.passcode);
    const cachedPasscode = this.normalizePasscode(this.passcodeCache.get(account.id));
    const statePasscode = this.normalizePasscode(state?.memSet?.passcode);

    try {
      const promptDisabledEarly = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const node = doc?.querySelector?.('#text_error, .text_error');
        if (!node) {
          return false;
        }
        const text = (node.textContent || '').toLowerCase();
        if (!text) {
          return false;
        }
        const hasPasscodeKeyword = /passcode|four|四位|簡易|简易|4位/.test(text);
        const hasDisableKeyword = /disabled|禁用|禁止|不可|無法|不能|已被|based on security|security/.test(text);
        return hasPasscodeKeyword && hasDisableKeyword;
      });
      if (promptDisabledEarly) {
        console.log('ℹ️ 检测到简易密码被禁用提示（登录阶段），直接进入改密流程');
        await page.evaluate(() => {
          const globalScope = (globalThis as any);
          const topWin = globalScope?.top || globalScope;
          try { topWin?.goToPage?.('acc_show', 'chgAcc_show', () => undefined, {}); } catch {}
          try { topWin?.goToPage?.('acc_show', 'chgPwd_show', () => undefined, {}); } catch {}
        }).catch(() => undefined);
        const normalizedStoredEarly = storedPasscode || '';
        let finalPasscodeEarly = storedPasscode || cachedPasscode || statePasscode;
        if (!finalPasscodeEarly) {
          finalPasscodeEarly = this.generatePasscode(account);
        }
        account.passcode = finalPasscodeEarly;
        this.passcodeCache.set(account.id, finalPasscodeEarly);
        try {
          await this.persistPasscode(account, finalPasscodeEarly, normalizedStoredEarly, 'input');
        } catch (persistErr) {
          console.warn('⚠️ 保存简易密码失败:', persistErr);
        }
        return {
          success: true,
          passcode: finalPasscodeEarly,
          mode: 'input',
        };
      }
    } catch (disableErr) {
      console.warn('⚠️ 判断简易密码禁用提示失败:', disableErr);
    }

    let groups: PasscodeGroup[] = [];
    await this.ensurePasscodeInterface(page, 'initial');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      groups = await this.collectPasscodeGroups(page);
      if (groups.length > 0) {
        break;
      }

      const confirmClicked = await this.clickPasscodeConfirm(page, null);
      if (confirmClicked) {
        console.log('🟢 已确认设置四位简易密码，等待输入表单出现');
        await this.randomDelay(400, 700);
        await this.ensurePasscodeInterface(page, `after-confirm-${attempt}`);
        continue;
      }

      if (attempt === 0) {
        await this.dumpPasscodeContext(page, 'passcode-context-confirm');
      }

      await this.ensurePasscodeInterface(page, `retry-${attempt}`);
      await this.randomDelay(300, 500);
    }

    console.log('[passcode_debug] groups after retries:', groups.length);

    let passcode = storedPasscode || cachedPasscode || statePasscode;

    if (!passcode) {
      passcode = this.generatePasscode(account);
      console.log(`🔐 生成新的简易密码 ${this.maskPasscode(passcode)}`);
    } else {
      console.log(`🔐 使用已有的简易密码 ${this.maskPasscode(passcode)}`);
    }

    this.passcodeCache.set(account.id, passcode);
    account.passcode = passcode;

    const normalizedStored = storedPasscode || '';

    if (groups.length === 0) {
      const keypadAttempt = await this.tryHandlePasscodeKeypad(page, passcode);
      if (keypadAttempt.found) {
        if (keypadAttempt.success) {
          await this.persistPasscode(account, passcode, normalizedStored, 'keypad');
          return { success: true, passcode, mode: 'keypad' };
        }

        if (keypadAttempt.reason === 'keypad_rejected') {
          this.lastPasscodeRejected = true;
        }

        console.warn(`⚠️ 数字简易密码面板处理失败: ${keypadAttempt.reason || 'unknown'}`);
        if (keypadAttempt.errorText) {
          console.warn(`ℹ️ 面板提示: ${keypadAttempt.errorText}`);
        }

        if (keypadAttempt.reason && /keypad_digit/i.test(keypadAttempt.reason)) {
          console.log('ℹ️ 数字键盘按键不可用，视为简易密码被禁用，继续改密流程');
          await page.evaluate(() => {
            const globalScope = (globalThis as any);
            const topWin = globalScope?.top || globalScope;
            try { topWin?.goToPage?.('acc_show', 'chgAcc_show', () => undefined, {}); } catch {}
            try { topWin?.goToPage?.('acc_show', 'chgPwd_show', () => undefined, {}); } catch {}
          }).catch(() => undefined);
          await this.persistPasscode(account, passcode, normalizedStored, 'keypad');
          return { success: true, passcode, mode: 'keypad' };
        }
      }

      console.log('[passcode_sync] attempting API fallback');
      const apiSynced = await this.syncPasscodeViaApi(page, passcode);
      if (apiSynced) {
        await this.randomDelay(400, 700);
        const postState = await this.resolvePostLoginState(page);
        if (postState === 'success') {
          const resolvedPasscode = this.normalizePasscode(state?.memSet?.passcode)
            || this.normalizePasscode(account.passcode)
            || this.normalizePasscode(this.passcodeCache.get(account.id))
            || this.generatePasscode(account);
          console.log('[passcode_sync] 已通过服务端同步直接进入主页');
          account.passcode = resolvedPasscode;
          this.passcodeCache.set(account.id, resolvedPasscode);
          await this.persistPasscode(account, resolvedPasscode, normalizedStored, 'input');
          return { success: true, passcode: resolvedPasscode, mode: 'input' };
        }

        if (postState === 'password_change') {
          console.warn('⚠️ 同步后仍需要修改密码，无法自动处理四位码');
          return { success: false, reason: 'password_change_required' };
        }

        await this.ensurePasscodeInterface(page, 'after-sync');
        groups = await this.collectPasscodeGroups(page);
      }
    }

    if (groups.length === 0) {
      let passwordChangeVisible = await page
        .locator('.content_chgpwd:visible, #chgPwd_show:visible, #chgAcc_show:visible')
        .count()
        .catch(() => 0);

      if (passwordChangeVisible === 0) {
        passwordChangeVisible = await page
          .locator('.content_chgpwd, #chgPwd_show, #chgAcc_show')
          .count()
          .catch(() => 0);
      }

      if (passwordChangeVisible > 0) {
        console.log('ℹ️ 检测到皇冠强制改密页面，跳过四位码流程');
        return { success: true, mode: 'input' };
      }

      try {
        const promptDisabled = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          const node = doc?.querySelector?.('#text_error, .text_error');
          if (!node) {
            return false;
          }
          const text = (node.textContent || '').toLowerCase();
          if (!text) {
            return false;
          }
          const hasPasscodeKeyword = /passcode|four|四位|簡易|简易|4位/.test(text);
          const hasDisableKeyword = /disabled|禁用|禁止|不可|無法|不能|已被|based on security|security/.test(text);
          return hasPasscodeKeyword && hasDisableKeyword;
        });
        if (promptDisabled) {
          console.log('ℹ️ 四位简易密码已被禁用，跳过 passcode 处理');
          await page.evaluate(() => {
            const globalScope = (globalThis as any);
            const topWin = globalScope?.top || globalScope;
            try {
              topWin?.goToPage?.('acc_show', 'chgPwd_show', () => undefined, {});
            } catch {}
            try {
              topWin?.goToPage?.('acc_show', 'chgAcc_show', () => undefined, {});
            } catch {}
            try {
              topWin?.show_prepasscode?.();
            } catch {}
            try {
              if (typeof topWin?.dispatchEvent === 'function') {
                topWin.dispatchEvent('show_prepasscode', {});
                topWin.dispatchEvent('show_back_4pwd', {});
              }
            } catch {}
          }).catch(() => undefined);
          const normalizedPass = this.normalizePasscode(account.passcode);
          if (normalizedPass) {
            return { success: true, passcode: normalizedPass, mode: 'input' };
          }
          return { success: true, mode: 'input' };
        }
      } catch (disableErr) {
        console.warn('⚠️ 判断四位密码禁用状态失败:', disableErr);
      }

      console.warn('⚠️ 未找到四位安全码输入框，无法自动处理');
      await this.dumpPasscodeContext(page, 'passcode-context-missing');
      await this.dumpPasscodeDebug(page, `passcode-missing-${Date.now()}.html`);
      return { success: false, reason: 'inputs_not_found' };
    }

    const group = groups[0];
    const mode: 'setup' | 'input' = group.inputs.length >= 2 ? 'setup' : 'input';

    const marker = await this.setPasscodeMarker(group);

    try {
      if (mode === 'input' && state?.userData?.four_pwd === 'second') {
        console.log('ℹ️ 检测到 four_pwd=second，准备使用已有简易密码重新输入');
        try {
          const confirmText = await group.context
            .locator('#C_alert_confirm:visible, #alert_confirm:visible, .popup_content:visible')
            .allInnerTexts()
            .catch(() => []);
          if (confirmText && confirmText.length > 0) {
            console.log('🧾 四位码提示文本:', confirmText.map(text => text.replace(/\s+/g, ' ')).join(' | '));
          }
        } catch (innerErr) {
          console.warn('⚠️ 获取四位码提示文本失败:', innerErr);
        }
      }

      const fieldsToFill = group.inputs.slice(0, mode === 'setup' ? 2 : 1);
      for (const candidate of fieldsToFill) {
        await candidate.locator.fill('');
        await this.randomDelay(60, 120);
        await candidate.locator.type(passcode, { delay: Math.floor(Math.random() * 50) + 65 });
        await this.randomDelay(100, 200);
      }
    } catch (err) {
      console.warn('⚠️ 简易密码输入时发生异常:', err);
      await this.clearPasscodeMarker(group.context, marker);
      await this.dumpPasscodeDebug(page, `passcode-input-fail-${Date.now()}.html`);
      return { success: false, reason: 'input_failed', mode };
    }

    const clicked = await this.clickPasscodeConfirm(group.context, marker);
    if (!clicked) {
      await this.clearPasscodeMarker(group.context, marker);
      await this.dumpPasscodeDebug(page, `passcode-confirm-missing-${Date.now()}.html`);
      return { success: false, reason: 'confirm_not_found', mode };
    }

    await this.clearPasscodeMarker(group.context, marker);

    const dismissed = await this.waitForPasscodeDismiss(page, 16000);
    if (!dismissed) {
      console.warn('⚠️ 四位安全码提示未按预期消失');
      await this.dumpPasscodeDebug(page, `passcode-dismiss-timeout-${Date.now()}.html`);
      return { success: false, reason: 'dismiss_timeout', mode };
    }

    await this.persistPasscode(account, passcode, normalizedStored, mode);

    return { success: true, passcode, mode };
  }

  private async resolvePasscodePrompt(page: Page, account: CrownAccount, initialResult: LoginDetectionResult): Promise<LoginDetectionResult> {
    let attempts = 0;
    let result = initialResult;

    while (attempts < 3) {
      const message = (result.message || '').toLowerCase();
      let requiresPasscode = (result.status === 'success' && message === 'passcode_prompt')
        || (result.status === 'error' && message === 'passcode_prompt');

      if (requiresPasscode) {
        try {
          const promptDisabled = await page.evaluate(() => {
            const doc = (globalThis as any).document;
            const node = doc?.querySelector?.('#text_error, .text_error');
            if (!node) {
              return false;
            }
            const text = (node.textContent || '').toLowerCase();
            if (!text) {
              return false;
            }
            const hasPasscodeKeyword = /passcode|four|四位|簡易|简易|4位/.test(text);
            const hasDisableKeyword = /disabled|禁用|禁止|不可|無法|不能|已被|based on security|security/.test(text);
            return hasPasscodeKeyword && hasDisableKeyword;
          });
          if (promptDisabled) {
            console.log('ℹ️ 检测到系统提示四位密码禁用，直接进入改密流程');
            await page.evaluate(() => {
              const globalScope = (globalThis as any);
              const topWin = globalScope?.top || globalScope;
              try {
                topWin?.goToPage?.('acc_show', 'chgPwd_show', () => undefined, {});
              } catch {}
              try {
                topWin?.goToPage?.('acc_show', 'chgAcc_show', () => undefined, {});
              } catch {}
              try {
                topWin?.show_prepasscode?.();
              } catch {}
            }).catch(() => undefined);
            requiresPasscode = false;
          }
        } catch (promptErr) {
          console.warn('⚠️ 检查四位密码禁用提示失败:', promptErr);
        }
      }

      if (!requiresPasscode && result.status === 'timeout') {
        try {
          requiresPasscode = await this.isPasscodePromptVisible(page);
        } catch {
          requiresPasscode = false;
        }

        if (!requiresPasscode) {
          requiresPasscode = await page.evaluate(() => {
            const doc = (globalThis as any).document;
            if (!doc) {
              return false;
            }
            const yesBtn = doc.querySelector('#btn_pwd4_yes, #btn_passcode_ok, #C_yes_btn, #yes_btn, .btn_passcode_confirm');
            const passcodeBox = doc.querySelector('#prepasscode, .content_chgpwd, .passcode_box, .passcode_area');
            if (passcodeBox) {
              const style = (globalThis as any).window?.getComputedStyle?.(passcodeBox as any);
              if (style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                return true;
              }
            }
            if (yesBtn) {
              const parent = (yesBtn as any).closest?.('#alert_confirm, #C_alert_confirm, .popup_bottom, .popup_content');
              const text = parent?.textContent || '';
              return /四位|4位|简易|簡易|passcode|簡碼|简码/.test(text);
            }
            return false;
          }).catch(() => false);
        }
      }

      if (!requiresPasscode) {
        try {
          const state = await this.evaluatePasscodeState(page);
          if (state) {
            const passcodeFromState = this.normalizePasscode(state.memSet?.passcode);
            const fourPwdPending = this.isFourPwdPending(state.userData?.four_pwd);
            const msgNormalized = (state.userData?.msg || '').toString().trim().toLowerCase();
            if (fourPwdPending || (passcodeFromState && msgNormalized !== 'success' && msgNormalized !== 'done')) {
              requiresPasscode = true;
              console.log('[passcode_state_hint]', JSON.stringify(state));
            }
          }
        } catch (stateErr) {
          console.warn('⚠️ 读取 passcode 状态失败:', stateErr);
        }
      }

      if (!requiresPasscode && this.lastPasscodeRejected) {
        requiresPasscode = true;
      }

      if (!requiresPasscode) {
        try {
          const promptDisabled = await page.evaluate(() => {
            const doc = (globalThis as any).document;
            const textNode = doc?.querySelector?.('#text_error, .text_error');
            if (!textNode) {
              return false;
            }
            const text = (textNode.textContent || '').toLowerCase();
            if (!text) {
              return false;
            }
            const hasPasscodeKeyword = /passcode|four|四位|簡易|简易|4位/.test(text);
            const hasDisableKeyword = /disabled|禁用|禁止|不可|無法|不能|已被|based on security|security/.test(text);
            return hasPasscodeKeyword && hasDisableKeyword;
          });
          if (promptDisabled) {
            console.log('ℹ️ 系统提示四位密码被禁用，跳过 passcode 流程');
            return result;
          }
        } catch (promptErr) {
          console.warn('⚠️ 检查四位密码禁用提示失败:', promptErr);
        }
        return result;
      }

      attempts += 1;
      const handling = await this.handlePasscodeRequirement(page, account);
      if (!handling.success) {
        let messageKey = 'passcode_setup_failed';
        if (handling.reason === 'inputs_not_found') {
          messageKey = 'passcode_prompt_not_found';
        } else if (handling.reason === 'password_change_required') {
          messageKey = 'password_change_required';
        }
        return {
          status: 'error',
          message: messageKey,
          debug: { reason: handling.reason, mode: handling.mode },
        };
      }

      await this.randomDelay(400, 700);
      const passwordChangeVisible = await page
        .locator('.content_chgpwd:visible, #chgPwd_show:visible, #chgAcc_show:visible')
        .count()
        .catch(() => 0);
      if (passwordChangeVisible > 0) {
        console.log('ℹ️ 四位码处理完成后检测到改密页面');
        return {
          status: 'error',
          message: 'password_change_required',
          debug: { reason: 'password_change_after_passcode' },
        };
      }
      result = await this.waitForLoginResult(page, 20000);
    }

    return result;
  }

  private async humanLikeType(page: Page, selector: string, text: string) {
    try {
      console.log(`  ⏳ 等待输入框 ${selector} 可见...`);
      const input = page.locator(selector);
      await input.waitFor({ state: 'visible', timeout: 10000 });
      console.log(`  ✅ 输入框 ${selector} 已可见`);

      console.log(`  🖱️  点击输入框 ${selector}...`);
      await input.click();
      await this.randomDelay(80, 150);

      console.log(`  🗑️  清空输入框内容...`);
      await input.fill('');
      await this.randomDelay(80, 150);

      console.log(`  ⌨️  开始输入内容 (${text.length} 个字符)...`);
      // 逐字符输入，模拟真实打字速度
      for (const char of text) {
        await input.type(char, { delay: Math.floor(Math.random() * 100) + 50 });
      }
      console.log(`  ✅ 输入完成`);

      await this.randomDelay(100, 300);
    } catch (error) {
      console.error(`  ❌ 输入失败 ${selector}:`, error);
      throw error;
    }
  }

  // 登录皇冠账号
  async loginAccount(account: CrownAccount): Promise<CrownLoginResult> {
    console.log('[[loginAccount_version_v2]]', account.username);
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      console.log(`🔐 开始登录账号: ${account.username}`);
      this.lastPasscodeRejected = false;

      // 确保浏览器已初始化
      if (!this.browser) {
        await this.initBrowser();
      }

      // 创建新的浏览器上下文
      context = await this.createStealthContext(account);
      page = await context.newPage();

      // 设置请求拦截器
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();

        const blockedKeywords = ['webdriver', 'automation', 'ghost', 'headless'];
        if (blockedKeywords.some(keyword => url.toLowerCase().includes(keyword))) {
          await route.abort();
          return;
        }

        await route.continue();
      });

      // 访问皇冠登录页面
      await this.navigateToLogin(page, { waitForNetworkIdle: true });

      await page.waitForFunction(() => {
        const doc = (globalThis as any).document as any;
        const username = doc?.querySelector?.('#usr');
        const password = doc?.querySelector?.('#pwd');
        return !!(username && password);
      }, { timeout: 25000 });

      // 强力移除所有可能遮挡输入框的元素
      console.log('🔧 开始移除登录页所有遮挡元素...');
      const removedCount = await page.evaluate(() => {
        const globalObj = globalThis as any;
        const doc = globalObj?.document;
        if (!doc) return 0;

        let count = 0;

        // 1. 移除所有弹窗类元素
        const popupSelectors = [
          '.popup', '.popup_bottom', '.popup_center', '.popup_game',
          '.popup_bet', '.popup_toast', '[id*="alert"]', '[id*="popup"]',
          '[class*="modal"]', '[class*="dialog"]', '[class*="overlay"]',
          '[id*="mask"]', '[class*="mask"]'
        ];

        popupSelectors.forEach((selector: string) => {
          try {
            const elements = doc.querySelectorAll(selector);
            elements.forEach((el: any) => {
              if (el && el.parentNode) {
                el.parentNode.removeChild(el);
                count++;
              }
            });
          } catch (e) {
            // 忽略选择器错误
          }
        });

        // 2. 移除所有 z-index > 100 的元素（通常是遮罩层）
        const allElements = doc.querySelectorAll('*');
        allElements.forEach((el: any) => {
          try {
            const style = globalObj.window?.getComputedStyle?.(el);
            const zIndex = style ? parseInt(style.zIndex || '0', 10) : 0;
            if (zIndex > 100 && el.id !== 'usr' && el.id !== 'pwd' && el.id !== 'btn_login') {
              if (el.parentNode) {
                el.parentNode.removeChild(el);
                count++;
              }
            }
          } catch (e) {
            // 忽略处理错误
          }
        });

        return count;
      });
      console.log(`✅ 已移除 ${removedCount} 个遮挡元素`);
      await this.randomDelay(500, 800);

      // 确保语言切换为简体中文，避免控件命名差异
      try {
        const langCn = page.locator('#lang_cn');
        if (await langCn.count().catch(() => 0)) {
          const isActive = await langCn.evaluate((el) => {
            const className = (el?.className || '').toString();
            return className.split(/\s+/).includes('on');
          }).catch(() => false);
          if (!isActive) {
            console.log('🌐 切换登录语言为简体中文');
            await langCn.click({ timeout: 3000, force: true }).catch((err) => {
              console.warn('⚠️ 切换语言失败:', err);
            });
            await this.randomDelay(300, 500);
          }
        }
      } catch (langErr) {
        console.warn('⚠️ 检查登录语言时出现异常:', langErr);
      }

      // 填写账号密码
      console.log(`🔑 准备填写账号: ${account.username}`);
      await this.humanLikeType(page, '#usr', account.username.trim());
      console.log('✅ 账号填写完成');

      await this.randomDelay(400, 700);

      console.log('🔐 准备填写密码...');
      await this.humanLikeType(page, '#pwd', account.password.trim());
      console.log('✅ 密码填写完成');

      await this.randomDelay(400, 700);

      // 点击登录按钮
      const loginButton = page.locator('#btn_login').first();
      if (await loginButton.count() === 0) {
        throw new Error('未找到登录按钮');
      }

      try {
        await loginButton.waitFor({ state: 'visible', timeout: 10000 });
      } catch {
        await loginButton.waitFor({ state: 'attached', timeout: 5000 }).catch(() => undefined);
      }
      await loginButton.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.waitForFunction((selector) => {
        const g = globalThis as any;
        const doc = g?.document as any;
        if (!doc?.querySelector) {
          return false;
        }
        const el = doc.querySelector(selector);
        if (!el) {
          return false;
        }
        const style = g?.getComputedStyle ? g.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
          return false;
        }
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      }, '#btn_login', { timeout: 10000 }).catch(() => undefined);

      try {
        await loginButton.click({ delay: 100 });
      } catch (clickError) {
        console.warn('⚠️ 登录按钮点击失败，尝试使用 force 选项:', clickError);
        await loginButton.click({ delay: 100, force: true }).catch((forceError) => {
          throw forceError;
        });
      }

      // 登录后优先处理登录页的通用提示（记住账号/浏览器推荐等），尽快推进到下一步
      await this.handlePostLoginPrompts(page).catch(() => undefined);

      const loginResultPromise = this.waitForLoginResult(page, 18000);
      const passcodeWatcher = page
        .waitForFunction((selector) => {
          const g = globalThis as any;
          const doc = g?.document as any;
          const el = doc?.querySelector?.(selector);
          if (!el) {
            return false;
          }
          const classList = el.classList;
          return !!(classList && typeof classList.contains === 'function' && classList.contains('pass_outside'));
        }, '#acc_show', { timeout: 15000 })
        .then(() => ({
          status: 'success' as const,
          message: 'passcode_prompt',
          debug: { source: 'passcode_watch' },
        }))
        .catch(() => null);

      // 等待登录结果
      let loginResult = await Promise.race([loginResultPromise, passcodeWatcher]) as Awaited<ReturnType<typeof this.waitForLoginResult>> | null;

      if (!loginResult) {
        loginResult = await loginResultPromise;
      } else if (loginResult.message === 'passcode_prompt') {
        loginResultPromise.catch(() => null);
      }

      console.log('🔎 登录检测结果:', loginResult);

      loginResult = await this.resolvePasscodePrompt(page, account, loginResult);

      if (loginResult.status === 'error' && loginResult.message === 'force_logout') {
        console.log('🚨 检测到踢人弹窗，尝试处理...');

        // 尝试点击踢人确认按钮
        try {
          const kickButton = page.locator('#alert_kick .btn_send, #alert_kick button');
          const isVisible = await kickButton.isVisible().catch(() => false);
          if (isVisible) {
            await kickButton.click({ force: true });
            console.log('✅ 已点击踢人确认按钮');
            await this.randomDelay(800, 1200);
          }
        } catch (e) {
          console.log('⚠️ 点击踢人按钮失败:', e);
        }

        // 重新检查登录状态
        const recheckResult = await this.waitForLoginResult(page, 10000);
        console.log('🔍 处理踢人弹窗后重新检查:', recheckResult);

        if (recheckResult.status === 'success') {
          loginResult = { status: 'success' };
        } else {
          const fallbackState = await this.resolvePostLoginState(page);
          if (fallbackState === 'success') {
            loginResult = { status: 'success' };
          } else {
            loginResult = { status: 'error', message: 'force_logout' };
          }
        }
      }

      const credentialChange = await this.detectCredentialChangeForm(page, 8000).catch(() => null);

      if (loginResult.status === 'success' || credentialChange) {
        if (loginResult.status === 'success') {
          await this.handlePostLoginPrompts(page);
        }
        const sessionInfo = {
          cookies: await context.cookies(),
          storageState: await context.storageState(),
          url: page.url(),
          userAgent: await page.evaluate(() => navigator.userAgent),
        };

        this.contexts.set(account.id, context);
        this.pages.set(account.id, page);
        this.sessionInfos.set(account.id, sessionInfo);
        this.lastHeartbeats.set(account.id, Date.now());
        if (account.id === 0) {
          this.systemLastBeat = Date.now();
          this.systemLastLogin = Date.now();
        }

        const needsChange = !!credentialChange;

        if (needsChange) {
          console.log(`⚠️ 账号 ${account.username} 登录后检测到强制改密页面`);
        } else {
          console.log(`✅ 账号 ${account.username} 登录成功`);
        }

        if (!needsChange && account.id > 0) {
          try {
            await query(
              `INSERT INTO crown_account_sessions (account_id, session_data, updated_at)
               VALUES ($1, $2, CURRENT_TIMESTAMP)
               ON CONFLICT (account_id) DO UPDATE
                 SET session_data = EXCLUDED.session_data,
                     updated_at = CURRENT_TIMESTAMP`,
              [account.id, sessionInfo]
            );
          } catch (sessionError) {
            console.error('⚠️ 保存会话信息失败:', sessionError);
          }

          try {
            const financial = await this.getAccountFinancialSnapshot(account.id);
            if (financial.balance !== null) {
              await query(
                `UPDATE crown_accounts
                   SET balance = $1, is_online = true, last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [financial.balance, account.id]
              );
            } else {
              await query(
                `UPDATE crown_accounts
                   SET is_online = true, last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [account.id]
              );
            }
          } catch (balanceError) {
            console.warn('⚠️ 登录后刷新余额失败（忽略）:', balanceError);
          }
        }

        return {
          success: true,
          message: needsChange ? '登录成功，需修改密码' : '登录成功',
          sessionInfo,
          needsCredentialChange: needsChange,
        };
      }

      let finalMessage = loginResult.message;
      const passcodeStillVisible = await this.isPasscodePromptVisible(page);
      if (passcodeStillVisible) {
        finalMessage = 'passcode_prompt';
      }
      if (finalMessage === 'passcode_prompt') {
        try {
          const passcodeState = await page.evaluate(() => {
            const topWin = (globalThis as any).top || (globalThis as any);
            const userData = topWin?.userData || {};
            const memSet = topWin?.memSet || {};
            return {
              userData: {
                username: userData.username,
                mid: userData.mid,
                four_pwd: userData.four_pwd,
                msg: userData.msg,
                abox4pwd_notshow: userData.abox4pwd_notshow,
                passwd_safe: userData.passwd_safe,
              },
              memSet: {
                passcode: memSet.passcode,
                fourPwd: memSet.fourPwd,
              },
              cookies: (globalThis as any).document?.cookie || '',
            };
          });
          console.log('[passcode_state]', JSON.stringify(passcodeState));
        } catch (stateErr) {
          console.warn('⚠️ 采集 passcode 状态失败:', stateErr);
        }
      }
      console.log('[loginAccount] rawMessage:', loginResult.message, 'finalMessage:', finalMessage);
      const failureMessage = this.composeLoginFailureMessage(
        finalMessage,
        loginResult.debug,
      );
      console.log('[[debug_marker_after_failure]]');
      try {
        const debugState = await this.collectLoginDebugState(page);
        if (debugState) {
          console.log('[login_debug_state]', debugState);
        } else {
          console.warn('⚠️ 未能收集登录调试状态（返回空）');
        }
      } catch (debugErr) {
        console.warn('⚠️ 获取登录调试状态失败:', debugErr);
      }
      console.log(`❌ 账号 ${account.username} 登录失败: ${failureMessage}`);
      try {
        const noBtnCount = await page.locator('#C_no_btn').count();
        console.log(`🔁 #C_no_btn 元素数量: ${noBtnCount}`);
      } catch (locError) {
        console.warn('⚠️ 检查 #C_no_btn 时出错:', locError);
      }
      try {
        await page.screenshot({ path: `login-fail-${account.username}-${Date.now()}.png`, fullPage: true });
        const html = await page.content();
        await fs.writeFile(`login-fail-${account.username}-${Date.now()}.html`, html);
        await this.pruneSnapshotArtifacts([
          `login-fail-${account.username}-`,
          `login-error-${account.username}-`,
          'passcode-',
        ]);
      } catch (screenshotError) {
        console.warn('⚠️ 无法保存失败截图:', screenshotError);
      }

      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);

      return {
        success: false,
        message: failureMessage,
      };

    } catch (error) {
      console.error(`❌ 账号 ${account.username} 登录出错:`, error);
      try {
        if (page) {
          await page.screenshot({ path: `login-error-${account.username}-${Date.now()}.png`, fullPage: true });
          const html = await page.content();
          await fs.writeFile(`login-error-${account.username}-${Date.now()}.html`, html);
          await this.pruneSnapshotArtifacts([
            `login-fail-${account.username}-`,
            `login-error-${account.username}-`,
            'passcode-',
          ]);
        }
      } catch (screenshotError) {
        console.error('⚠️ 保存失败截图时出错:', screenshotError);
      }
      const existingContext = this.contexts.get(account.id);
      if (existingContext) {
        await existingContext.close().catch(() => undefined);
        this.contexts.delete(account.id);
      }
      this.pages.delete(account.id);
      this.sessionInfos.delete(account.id);

      return {
        success: false,
        message: error instanceof Error ? error.message : `登录出错: ${String(error)}`,
      };
    }
  }

  async initializeAccountCredentials(
    account: CrownAccount,
    nextCredentials: { username: string; password: string },
  ): Promise<{ success: boolean; message: string; updatedCredentials: { username: string; password: string } }> {
    console.log(`🧩 开始自动初始化账号 ${account.username}`);
    // 1) 先用当前库中密码尝试登录；如失败且疑似“密码错误”，再用目标新密码回退尝试，
    //    以覆盖“之前已被人工或其他流程改为目标密码”的情况。
    let loginResult = await this.loginAccountWithApi(account);
    if (!loginResult.success) {
      const msg = (loginResult.message || '').toString();
      const looksWrongPwd = /不正确|錯誤|incorrect|invalid/i.test(msg);
      if (looksWrongPwd) {
        console.log('ℹ️ 使用数据库密码登录失败，尝试用目标新密码直接登录以检查是否已改密');
        const fallbackAccount: CrownAccount = { ...account, password: nextCredentials.password } as CrownAccount;
        const retry = await this.loginAccountWithApi(fallbackAccount);
        if (retry.success) {
          // 已是目标密码：直接返回成功，并让调用方用新密码更新数据库
          await this.logoutAccount(account.id).catch(() => undefined);
          console.log('✅ 使用目标新密码直接登录成功，视为已完成改密');
          return {
            success: true,
            message: '已是目标密码，无需再次改密',
            updatedCredentials: { username: account.username, password: nextCredentials.password },
          };
        }
      }
      await this.logoutAccount(account.id).catch(() => undefined);
      return {
        success: false,
        message: loginResult.message || '登录失败，无法初始化账号',
        updatedCredentials: { username: account.username, password: account.password },
      };
    }

    let page = this.pages.get(account.id);
    let context = this.contexts.get(account.id);

    if (!page || !context) {
      await this.logoutAccount(account.id).catch(() => undefined);
      return {
        success: false,
        message: '未获得有效的浏览器会话，请稍后重试',
        updatedCredentials: { username: account.username, password: account.password },
      };
    }

    try {
      let handledAny = false;
      let latestUsername = (account.username || '').trim();
      let latestPassword = (account.password || '').trim();
      let passwordChanged = false;

      let attempt = 0;
      let repeatedLoginIdCount = 0;
      let loginIdCompleted = false;
      let forcedPasswordReveal = false;
      while (attempt < 6) {
        console.log(`[[init_pwd]] loop attempt=${attempt}`);
        const detection = await this.detectCredentialChangeForm(page, attempt === 0 ? 20000 : 8000);
        console.log(`[[init_pwd]] detection=${detection ? detection.selectors.formType : 'null'}`);
        if (!detection) {
          if (loginIdCompleted && !passwordChanged) {
            if (!forcedPasswordReveal) {
              forcedPasswordReveal = true;
              console.log('ℹ️ 尝试强制打开改密页面');
              await this.acknowledgeCredentialPrompts(page, 8000).catch(() => undefined);
              await page.evaluate(() => {
                const globalScope = (globalThis as any);
                const topWin = globalScope?.top || globalScope;
                try { topWin?.goToPage?.('acc_show', 'chgPwd_show', () => undefined, {}); } catch {}
                try { topWin?.goToPage?.('acc_show', 'chgAcc_show', () => undefined, {}); } catch {}
                try { topWin?.show_prepasscode?.(); } catch {}
              }).catch(() => undefined);
              await this.randomDelay(500, 800);
              const passwordFormForced = await page
                .locator('.content_chgpwd:visible, #chgPwd_show:visible, #chgAcc_show:visible')
                .count()
                .catch(() => 0);
              if (passwordFormForced > 0) {
                console.log('✅ 已强制展示改密页面，重新检测');
                forcedPasswordReveal = true;
                continue;
              }
            }

            await this.acknowledgeCredentialPrompts(page, 8000).catch(() => undefined);
            const loginFieldVisible = await page.locator('#usr:visible').count().catch(() => 0);
            if (loginFieldVisible > 0) {
              console.log('🔁 未检测到密码改密页面，重新登录后再试');
              const reLoginResult = await this.performLoginWithCredentials(page, latestUsername, latestPassword, account);
              if (!reLoginResult.success) {
                return {
                  success: false,
                  message: reLoginResult.message
                    ? `登录账号更新成功，但重新登录失败: ${reLoginResult.message}`
                    : '登录账号更新成功，但重新登录失败',
                  updatedCredentials: { username: latestUsername, password: latestPassword },
                };
              }
              await this.acknowledgeCredentialPrompts(page).catch(() => undefined);
              attempt += 1;
              await this.randomDelay(600, 900);
              continue;
            }
          }

          // 即使未处于“登录账号更新完成”阶段，只要页面能强制唤起改密表单，也直接尝试提交
          const ensured = await this.ensurePasswordForm(page);
          console.log(`[[init_pwd]] ensurePasswordForm=${ensured}`);
          if (!passwordChanged && ensured) {
            console.log('ℹ️ 未检测到改密表单选择器，但页面已显示或可唤起改密内容，尝试直接提交');
            const passwordResult = await this.submitPasswordChange(page, account, latestPassword, nextCredentials.password);
            if (!passwordResult.success) {
              return {
                success: false,
                message: passwordResult.message || '改密提交失败',
                updatedCredentials: { username: latestUsername, password: latestPassword },
              };
            }
            passwordChanged = true;
            latestPassword = nextCredentials.password.trim();
            handledAny = true;

            console.log('✅ 密码已更新，重新登录以验证');
            const verifyAfterPassword = await this.performLoginWithCredentials(page, latestUsername, latestPassword, account);
            if (!verifyAfterPassword.success) {
              return {
                success: false,
                message: verifyAfterPassword.message || '使用新密码重新登录失败',
                updatedCredentials: { username: latestUsername, password: latestPassword },
              };
            }

            await this.acknowledgeCredentialPrompts(page).catch(() => undefined);
            await this.randomDelay(600, 900);
            continue;
          }

          if (!handledAny) {
            // 作为最后一次兜底，即便未能确保表单展示，仍尝试直接提交一次，便于产生日志与页面错误提示
            console.log('ℹ️ 未检测到改密页面，尝试盲提交一次以采集错误与结构');
            try {
              const url = page.url();
              const visCnt = await page.locator('.content_chgpwd:visible, #chgPwd_show:visible, #chgAcc_show:visible').count().catch(() => -1);
              console.log(`[[init_pwd]] blind-submit precheck url=${url} containersVisible=${visCnt}`);
            } catch {}
            const blindSubmit = await this.submitPasswordChange(page, account, latestPassword, nextCredentials.password);
            if (blindSubmit.success) {
              passwordChanged = true;
              latestPassword = nextCredentials.password.trim();
              handledAny = true;
              console.log('✅ 盲提交改密成功，重新登录以验证');
              const verifyAfterPassword = await this.performLoginWithCredentials(page, latestUsername, latestPassword, account);
              if (!verifyAfterPassword.success) {
                return {
                  success: false,
                  message: verifyAfterPassword.message || '使用新密码重新登录失败',
                  updatedCredentials: { username: latestUsername, password: latestPassword },
                };
              }
            } else {
              // 盲提交失败则直接返回该错误信息（其中包含(pwd)点击尝试日志）
              return {
                success: false,
                message: blindSubmit.message || '未检测到皇冠改密页面，请确认账号是否需要初始化',
                updatedCredentials: { username: account.username, password: account.password },
              };
            }
          }
          break;
        }

        console.log(`🔄 当前改密阶段: ${detection.selectors.formType}`);

        if (loginIdCompleted && detection.selectors.formType === 'loginId') {
          repeatedLoginIdCount += 1;
          // 如果多次仍停留在创建账号表单，主动尝试唤起并提交密码改密表单
          if (repeatedLoginIdCount > 2) {
            console.log('ℹ️ 登录账号已更新，但仍停留在账号创建表单，尝试直接进入密码改密流程');
            const ensured = await this.ensurePasswordForm(page);
            if (ensured) {
              const passwordResult = await this.submitPasswordChange(page, account, latestPassword, nextCredentials.password);
              if (!passwordResult.success) {
                return {
                  success: false,
                  message: passwordResult.message || '改密提交失败',
                  updatedCredentials: { username: latestUsername, password: latestPassword },
                };
              }
              passwordChanged = true;
              latestPassword = nextCredentials.password.trim();
              handledAny = true;
              console.log('✅ 密码已更新，重新登录以验证');
              const verifyAfterPassword = await this.performLoginWithCredentials(page, latestUsername, latestPassword, account);
              if (!verifyAfterPassword.success) {
                return {
                  success: false,
                  message: verifyAfterPassword.message || '使用新密码重新登录失败',
                  updatedCredentials: { username: latestUsername, password: latestPassword },
                };
              }
              await this.acknowledgeCredentialPrompts(page).catch(() => undefined);
              await this.randomDelay(600, 900);
              continue;
            }
          }
          if (repeatedLoginIdCount > 5) {
            console.warn('⚠️ 登录账号已更新，但仍检测到账号创建表单，可能需要人工确认');
            break;
          }
          console.log('ℹ️ 登录账号已更新，等待密码改密页面出现');
          await this.randomDelay(800, 1200);
          continue;
        }

        repeatedLoginIdCount = 0;

        const changeResult = await this.applyCredentialChange(detection, account, nextCredentials, page);
        attempt += 1;
        if (!changeResult.success) {
          // 在失败时采集页面结构，便于诊断
          try {
            const html = await page.content();
            await fs.writeFile(`init-fail-${account.username}-${Date.now()}.html`, html);
          } catch {}
          return {
            success: false,
            message: changeResult.message,
            updatedCredentials: { username: latestUsername, password: latestPassword },
          };
        }

        handledAny = true;
        if (changeResult.skipLoginId) {
          console.log('ℹ️ 登录账号阶段无需处理，直接进入密码改密流程');
          await this.acknowledgeCredentialPrompts(page, 8000).catch(() => undefined);
          await this.randomDelay(600, 900);
          continue;
        }
        if (changeResult.formType === 'loginId') {
          await this.acknowledgeCredentialPrompts(page, 8000).catch(() => undefined);
          loginIdCompleted = true;
        }
        if (changeResult.usernameChanged) {
          latestUsername = nextCredentials.username.trim();
          try {
            const originalUsername = account.original_username || account.username;
            await query(
              `UPDATE crown_accounts
                 SET username = $1,
                     initialized_username = $1,
                     original_username = COALESCE(original_username, $2),
                     updated_at = CURRENT_TIMESTAMP
               WHERE id = $3`,
              [latestUsername, originalUsername, account.id],
            );
            console.log(`✅ 数据库用户名已更新为 ${latestUsername}`);
          } catch (syncError) {
            console.error('⚠️ 同步数据库用户名失败:', syncError);
          }
          account.username = latestUsername;
        }
        if (changeResult.passwordChanged) {
          latestPassword = nextCredentials.password.trim();
          passwordChanged = true;
          account.password = latestPassword;
        }

        if (changeResult.formType === 'loginId') {
          await this.acknowledgeCredentialPrompts(page, 8000).catch(() => undefined);
          const loginFieldVisible = await page.locator('#usr:visible').count().catch(() => 0);
          if (loginFieldVisible > 0) {
            console.log('🔁 登录账号已更新，重新登录以继续密码修改');
            const reLoginResult = await this.performLoginWithCredentials(page, latestUsername, latestPassword, account);
            if (!reLoginResult.success) {
              return {
                success: false,
                message: reLoginResult.message
                  ? `登录账号更新成功，但重新登录失败: ${reLoginResult.message}`
                  : '登录账号更新成功，但重新登录失败',
                updatedCredentials: { username: latestUsername, password: latestPassword },
              };
            }
            await this.acknowledgeCredentialPrompts(page).catch(() => undefined);
            await this.randomDelay(600, 900);
            continue;
          }
        }

        await this.randomDelay(600, 900);
    }

      if (context) {
        await context.close().catch(() => undefined);
      }
      this.contexts.delete(account.id);
      this.pages.delete(account.id);

      if (loginIdCompleted && !passwordChanged) {
        return {
          success: false,
          message: '登录账号已更新，但未能修改密码，请确认页面是否出现改密表单',
          updatedCredentials: { username: latestUsername, password: latestPassword },
        };
      }

      context = await this.createStealthContext(account);
      page = await context.newPage();
      this.contexts.set(account.id, context);
      this.pages.set(account.id, page);

      const verifyUsername = handledAny ? latestUsername : account.username;
      const verifyPassword = passwordChanged ? nextCredentials.password : account.password;

      const verifyLogin = await this.performLoginWithCredentials(page, verifyUsername, verifyPassword, account);
      if (!verifyLogin.success) {
        return {
          success: false,
          message: verifyLogin.message || '改密完成，但使用新凭证登录失败',
          updatedCredentials: { username: verifyUsername, password: verifyPassword },
        };
      }

      console.log(`✅ 账号 ${account.username} 改密并验证登录成功`);
      return {
        success: true,
        message: '初始化成功',
        updatedCredentials: { username: verifyUsername, password: verifyPassword },
      };
    } finally {
      await this.logoutAccount(account.id).catch(() => undefined);
    }
  }

  /**
   * 使用纯 API 方式初始化账号（替代 Playwright 自动化）
   */
  async initializeAccountWithApi(
    account: CrownAccount,
    nextCredentials: { username: string; password: string },
  ): Promise<{ success: boolean; message: string; updatedCredentials: { username: string; password: string } }> {
    console.log(`🚀 使用纯 API 方式初始化账号: ${account.username}`);
    console.log(`📱 设备类型: ${account.device_type || 'iPhone 14'}`);
    console.log(`🌐 代理配置: ${account.proxy_enabled ? '已启用' : '未启用'}`);

    // 构建 API 客户端配置
    const apiClient = new CrownApiClient({
      baseUrl: this.activeBaseUrl,
      deviceType: account.device_type || 'iPhone 14',
      userAgent: account.user_agent,
      proxy: {
        enabled: account.proxy_enabled || false,
        type: account.proxy_type,
        host: account.proxy_host,
        port: account.proxy_port,
        username: account.proxy_username,
        password: account.proxy_password,
      },
    });

    try {
      const result = await apiClient.initializeAccount(
        account.username,
        account.password,
        nextCredentials.username,
        nextCredentials.password,
      );

      // 如果成功，更新数据库
      if (result.success && result.updatedCredentials) {
        try {
          const originalUsername = account.original_username || account.username;
          await query(
            `UPDATE crown_accounts
               SET username = $1,
                   password = $2,
                   initialized_username = $1,
                   original_username = COALESCE(original_username, $3),
                   updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [
              result.updatedCredentials.username,
              result.updatedCredentials.password,
              originalUsername,
              account.id,
            ],
          );
          console.log(`✅ 数据库已更新: ${result.updatedCredentials.username}`);
        } catch (dbError) {
          console.error('⚠️ 更新数据库失败:', dbError);
        }
      }

      return result;

    } catch (error) {
      console.error('❌ API 初始化失败:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '初始化失败',
        updatedCredentials: { username: account.username, password: account.password },
      };
    } finally {
      await apiClient.close();
    }
  }

  /**
   * 使用纯 API 方式登录账号（替代 Playwright 自动化）
   */
  async loginAccountWithApi(
    account: CrownAccount,
  ): Promise<{ success: boolean; message: string }> {
    // 检查是否有正在进行的登录
    const existingLock = this.loginLocks.get(account.id);
    if (existingLock) {
      console.log(`🔒 账号 ${account.username} 正在登录中，等待现有登录完成...`);
      return existingLock;
    }

    // 创建登录锁
    const loginPromise = this.doLoginAccountWithApi(account);
    this.loginLocks.set(account.id, loginPromise);

    try {
      const result = await loginPromise;
      return result;
    } finally {
      // 登录完成后删除锁
      this.loginLocks.delete(account.id);
    }
  }

  /**
   * 实际执行 API 登录的内部方法
   */
  private async doLoginAccountWithApi(
    account: CrownAccount,
  ): Promise<{ success: boolean; message: string }> {
    console.log(`🚀 使用纯 API 方式登录账号: ${account.username}`);
    console.log(`📱 设备类型: ${account.device_type || 'iPhone 14'}`);
    console.log(`🌐 代理配置: ${account.proxy_enabled ? '已启用' : '未启用'}`);

    // 构建 API 客户端配置
    const apiClient = new CrownApiClient({
      baseUrl: this.activeBaseUrl,
      deviceType: account.device_type || 'iPhone 14',
      userAgent: account.user_agent,
      proxy: {
        enabled: account.proxy_enabled || false,
        type: account.proxy_type,
        host: account.proxy_host,
        port: account.proxy_port,
        username: account.proxy_username,
        password: account.proxy_password,
      },
    });

    try {
      // 🔥 检查是否需要初始化
      if (account.init_type && account.init_type !== 'none') {
        console.log(`🔄 账号需要初始化 (init_type=${account.init_type})，自动执行初始化流程...`);

        // 生成新的账号和密码
        const newUsername = this.generateUsername();
        const newPassword = this.generatePassword();
        console.log(`🔑 生成新凭据: username=${newUsername}, password=${newPassword}`);

        // 执行初始化
        const initResult = await this.initializeAccountWithApi(account, {
          username: newUsername,
          password: newPassword,
        });

        if (!initResult.success) {
          return {
            success: false,
            message: `初始化失败: ${initResult.message}`,
          };
        }

        console.log(`✅ 初始化成功，新账号: ${initResult.updatedCredentials?.username}`);

        // 更新账号信息用于后续登录
        account.username = initResult.updatedCredentials?.username || newUsername;
        account.password = initResult.updatedCredentials?.password || newPassword;

        // 🔥 初始化成功后，更新 init_type 为 'none'，避免下次登录再次初始化
        try {
          await query(
            `UPDATE crown_accounts SET init_type = 'none', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [account.id],
          );
          console.log(`✅ 已更新 init_type 为 'none'，下次登录将直接登录`);
        } catch (updateErr) {
          console.warn('⚠️ 更新 init_type 失败:', updateErr);
        }
      }

      const loginResp = await apiClient.login(account.username, account.password);

      if (loginResp.msg === '105') {
        // 登录失败
        return {
          success: false,
          message: loginResp.code_message || '账号或密码错误',
        };
      }

      if (loginResp.msg === '106') {
        // 需要初始化（强制改密）- 自动处理
        console.log(`🔄 皇冠要求强制改密 (msg=106)，自动执行初始化...`);

        const newUsername = this.generateUsername();
        const newPassword = this.generatePassword();

        const initResult = await this.initializeAccountWithApi(account, {
          username: newUsername,
          password: newPassword,
        });

        if (!initResult.success) {
          return {
            success: false,
            message: `初始化失败: ${initResult.message}`,
          };
        }

        // 用新凭据重新登录
        account.username = initResult.updatedCredentials?.username || newUsername;
        account.password = initResult.updatedCredentials?.password || newPassword;

        // 🔥 强制改密成功后，更新 init_type 为 'none'
        try {
          await query(
            `UPDATE crown_accounts SET init_type = 'none', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [account.id],
          );
          console.log(`✅ 已更新 init_type 为 'none'（强制改密后）`);
        } catch (updateErr) {
          console.warn('⚠️ 更新 init_type 失败:', updateErr);
        }

        const retryResp = await apiClient.login(account.username, account.password);
        if (retryResp.msg !== '109' && retryResp.msg !== '100') {
          return {
            success: false,
            message: `初始化后登录失败: ${retryResp.code_message || '未知错误'}`,
          };
        }
      }

      // 登录成功（msg=109 或 msg=100）
      console.log('✅ 纯 API 登录成功');

      // 记录纯 API 登录会话和 UID
      const loginTime = Date.now();
      const uid = loginResp.uid;
      const cookies = apiClient.getCookies(); // 获取 Cookie

      this.apiLoginSessions.set(account.id, loginTime);
      if (uid) {
        this.apiUids.set(account.id, uid);
        console.log(`📝 已记录纯 API 登录会话: accountId=${account.id}, uid=${uid}, loginTime=${loginTime}, mapSize=${this.apiLoginSessions.size}`);
      } else {
        console.log(`📝 已记录纯 API 登录会话: accountId=${account.id}, loginTime=${loginTime}, mapSize=${this.apiLoginSessions.size}`);
      }

      // 💾 持久化会话信息到数据库（包括 Cookie）
      try {
        await query(
          `UPDATE crown_accounts
           SET api_uid = $1,
               api_login_time = $2,
               api_cookies = $3,
               is_online = true,
               last_login_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [uid || null, loginTime, cookies || null, account.id]
        );
        console.log(`💾 会话信息已持久化到数据库: accountId=${account.id}, cookies=${cookies ? '已保存' : '无'}`);
      } catch (dbError) {
        console.error('⚠️ 持久化会话信息失败:', dbError);
      }

      // 等待 1 秒让皇冠服务器同步会话后再进行后续操作
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 登录后先预热一次赛事列表，使会话行为尽量与网页一致
      try {
        console.log('📋 登录后预热赛事列表 (FT/live/RB)...');
        await apiClient.getGameList({
          gtype: 'ft',
          showtype: 'live',
          rtype: 'rb',
          ltype: '3',
          sorttype: 'L',
          langx: 'zh-cn',
        });
      } catch (warmupError) {
        console.warn('⚠️ 登录后预热赛事列表失败（忽略）:', warmupError instanceof Error ? warmupError.message : warmupError);
      }

      // 获取余额和信用额度
      if (uid) {
        try {
          const balanceData = await apiClient.getBalance(uid);
          if (balanceData) {
            const balance = balanceData.balance || 0;
            const credit = balanceData.credit || 0;
            console.log(`💰 余额同步成功: 余额=${balance}, 信用额度=${credit}`);

            // 更新数据库余额和信用额度
            await query(
              `UPDATE crown_accounts
               SET balance = $1, credit = $2, updated_at = CURRENT_TIMESTAMP
               WHERE id = $3`,
              [balance, credit, account.id]
            );
          }
        } catch (balanceError) {
          console.warn('⚠️ 获取余额失败，但登录成功:', balanceError);
        }
      }

      return {
        success: true,
        message: '登录成功',
      };

    } catch (error) {
      console.error('❌ API 登录失败:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '登录失败',
      };
    } finally {
      await apiClient.close();
    }
  }

  /**
   * 登出账号（清除会话信息）
   */
  async logoutAccount(accountId: number): Promise<boolean> {
    try {
      console.log(`🚪 登出账号: accountId=${accountId}`);

      // 从内存中删除会话
      this.apiLoginSessions.delete(accountId);
      this.apiUids.delete(accountId);

      // 从数据库中清除会话信息
      await query(
        `UPDATE crown_accounts
         SET api_uid = NULL,
             api_login_time = NULL,
             is_online = false,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [accountId]
      );

      console.log(`✅ 账号 ${accountId} 已登出`);
      return true;
    } catch (error) {
      console.error(`❌ 登出账号 ${accountId} 失败:`, error);
      return false;
    }
  }

  // ===== 系统内置账号（用于抓取赛事） =====
  private getSystemAccount(): CrownAccount {
    const username = process.env.CROWN_SYSTEM_USERNAME || '';
    const password = process.env.CROWN_SYSTEM_PASSWORD || '';
    if (!username || !password) {
      throw new Error('未配置系统抓取账号(CROWN_SYSTEM_USERNAME/CROWN_SYSTEM_PASSWORD)');
    }
    const device = process.env.CROWN_SYSTEM_DEVICE || 'iPhone 14';
    const proxyEnabled = (process.env.CROWN_SYSTEM_PROXY_ENABLED || 'false').toLowerCase() === 'true';
    const proxyType = process.env.CROWN_SYSTEM_PROXY_TYPE;
    const proxyHost = process.env.CROWN_SYSTEM_PROXY_HOST;
    const proxyPort = process.env.CROWN_SYSTEM_PROXY_PORT ? Number(process.env.CROWN_SYSTEM_PROXY_PORT) : undefined;
    const proxyUser = process.env.CROWN_SYSTEM_PROXY_USERNAME;
    const proxyPass = process.env.CROWN_SYSTEM_PROXY_PASSWORD;

    this.systemUsername = username;

    // 构造最小必需字段，其他随意填充默认
    const nowIso = new Date().toISOString();
    return {
      id: 0,
      user_id: 0,
      group_id: 0,
      username,
      password,
      display_name: 'SYSTEM',
      platform: 'crown',
      game_type: '足球',
      source: 'system',
      share_count: 0,
      currency: 'CNY',
      discount: 1,
      note: '',
      balance: 0,
      credit: 0,
      stop_profit_limit: 0,
      device_type: device,
      user_agent: undefined,
      proxy_enabled: !!proxyEnabled,
      proxy_type: proxyType,
      proxy_host: proxyHost,
      proxy_port: proxyPort,
      proxy_username: proxyUser,
      proxy_password: proxyPass,
      football_prematch_limit: 0,
      football_live_limit: 0,
      basketball_prematch_limit: 0,
      basketball_live_limit: 0,
      is_enabled: true,
      init_type: 'full' as const,
      is_online: true,
      last_login_at: nowIso,
      status: 'active',
      error_message: undefined,
      created_at: nowIso,
      updated_at: nowIso,
    };
  }

  // 辅助方法：导航到登录页面
  private async navigateToLogin(page: Page, options?: { waitForNetworkIdle?: boolean; waitForLoginSelector?: boolean }): Promise<void> {
    const loginUrl = `${this.activeBaseUrl}/app/member/login.php`;
    await page.goto(loginUrl, {
      waitUntil: options?.waitForNetworkIdle ? 'networkidle' : 'domcontentloaded',
      timeout: 30000
    });

    if (options?.waitForLoginSelector) {
      await page.waitForSelector('#usr', { timeout: 10000 }).catch(() => {
        console.warn('⚠️ 等待登录表单超时');
      });
    }
  }

  // 辅助方法：获取会话预热阈值（毫秒）
  private getWarmSessionThreshold(): number {
    return 5 * 60 * 1000; // 5分钟
  }

  // 辅助方法：检查会话是否还活着
  private async checkSessionAlive(page: Page): Promise<boolean> {
    try {
      if (page.isClosed()) {
        return false;
      }

      // 尝试执行简单的页面操作来检查会话
      const isAlive = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        return doc && doc.readyState === 'complete';
      }).catch(() => false);

      return isAlive;
    } catch (error) {
      return false;
    }
  }

  // 辅助方法：清理会话
  private async cleanupSession(accountId: number): Promise<void> {
    try {
      const page = this.pages.get(accountId);
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
      this.pages.delete(accountId);
      this.contexts.delete(accountId);
      this.bettingFrames.delete(accountId);
      this.orderFrames.delete(accountId);
      this.sessionInfos.delete(accountId);

      if (accountId === 0) {
        this.systemLastBeat = 0;
      }
    } catch (error) {
      console.error(`清理会话失败 (accountId=${accountId}):`, error);
    }
  }

  private async ensureSystemSession(): Promise<Page | null> {
    const now = Date.now();

    // 1. 检查现有系统会话（优先使用已登录的系统账号）
    let page = this.pages.get(0) || null;
    if (page && !page.isClosed()) {
      if (now - this.systemLastBeat < this.getWarmSessionThreshold()) {
        // 近期检查过，直接返回
        return page;
      }
      // 检查会话是否还活着
      if (await this.checkSessionAlive(page)) {
        this.systemLastBeat = now;
        this.systemLoginFailCount = 0; // 重置失败计数
        return page;
      }
      // 会话失效，清理
      await this.cleanupSession(0);
    }

    // 2. 系统账号会话失效，检查是否有用户账号在线（避免打开新浏览器）
    const userAccount = await this.findAvailableUserAccount();
    if (userAccount) {
      // 有用户账号在线，直接使用，不尝试登录系统账号
      return userAccount;
    }

    // 3. 没有任何在线账号，检查是否在冷却期
    if (now < this.systemLoginCooldownUntil) {
      const waitSeconds = Math.ceil((this.systemLoginCooldownUntil - now) / 1000);
      console.log(`⏳ 系统账号登录冷却中，还需等待 ${waitSeconds} 秒`);
      return null;
    }

    // 4. 检查失败次数
    if (this.systemLoginFailCount >= 3) {
      const cooldownMs = 5 * 60 * 1000; // 5分钟冷却
      this.systemLoginCooldownUntil = now + cooldownMs;
      console.log(`❌ 系统账号登录失败次数过多(${this.systemLoginFailCount}次)，进入冷却期 5 分钟`);
      this.systemLoginFailCount = 0;
      return null;
    }

    // 5. 系统账号登录已禁用，使用独立抓取服务
    console.log('ℹ️ 系统账号登录已禁用，使用独立抓取服务');
    return null;
  }

  // 查找可用的用户账号作为后备（优先使用标记为"用于抓取"的账号）
  private async findAvailableUserAccount(): Promise<Page | null> {
    // 1. 优先查找标记为"用于抓取"的在线账号
    try {
      const fetchAccounts = await query(
        `SELECT id FROM crown_accounts
         WHERE use_for_fetch = true AND is_enabled = true
         ORDER BY last_login_at DESC NULLS LAST`
      );

      for (const row of fetchAccounts.rows) {
        const accountId = row.id;
        const page = this.pages.get(accountId);

        if (page && !page.isClosed()) {
          console.log(`📌 使用标记为"赛事抓取"的账号 ID=${accountId}`);
          return page;
        }
      }
    } catch (err) {
      console.log(`⚠️ 查询赛事抓取账号失败:`, err);
    }

    // 2. 如果没有标记的账号，使用任何在线的用户账号
    for (const [accountId, page] of this.pages.entries()) {
      if (accountId === 0) continue; // 跳过系统账号

      if (page && !page.isClosed()) {
        console.log(`📌 使用普通在线账号 ID=${accountId} 作为后备`);
        return page;
      }
    }

    console.log(`⚠️ 没有可用账号抓取比赛`);
    return null;
  }

  // 公共方法：获取比赛列表（兼容旧接口）
  async fetchMatches(accountId: number, opts?: {
    gtype?: string; showtype?: string; rtype?: string; ltype?: string; sorttype?: string
  }): Promise<{ matches: any[]; xml?: string }> {
    // 直接调用系统抓取方法（不依赖特定账号）
    return await this.fetchMatchesSystem(opts);
  }

  // 公共方法：触发预热
  triggerFetchWarmup(): void {
    this.scheduleFetchWarmup();
  }

  // 公共方法：获取今日注单（占位实现）
  async fetchTodayWagers(accountId: number): Promise<CrownWagerItem[]> {
    console.warn(`⚠️ fetchTodayWagers 方法尚未完整实现 (accountId=${accountId})`);
    return [];
  }

  // 公共方法：获取账号财务摘要
  async getAccountFinancialSummary(accountId: number): Promise<FinancialSnapshot> {
    // 优先使用 API 方式获取余额
    const uid = this.apiUids.get(accountId);
    if (uid) {
      try {
        // 查询账号配置（包括 Cookie）
        const accountResult = await query(
          `SELECT username, device_type, user_agent, proxy_enabled, proxy_type, proxy_host, proxy_port, proxy_username, proxy_password, api_cookies
           FROM crown_accounts WHERE id = $1`,
          [accountId]
        );

        if (accountResult.rows.length > 0) {
          const account = accountResult.rows[0];

          // 创建 API 客户端
          const apiClient = new CrownApiClient({
            baseUrl: this.activeBaseUrl,
            deviceType: account.device_type || 'iPhone 14',
            userAgent: account.user_agent,
            proxy: {
              enabled: account.proxy_enabled || false,
              type: account.proxy_type,
              host: account.proxy_host,
              port: account.proxy_port,
              username: account.proxy_username,
              password: account.proxy_password,
            },
          });

          // 恢复 Cookie
          if (account.api_cookies) {
            apiClient.setCookies(account.api_cookies);
          }

          // 获取余额（会自动获取最新版本号）
          const balanceData = await apiClient.getBalance(uid);
          await apiClient.close();

          if (balanceData) {
            return {
              balance: balanceData.balance,
              credit: balanceData.credit,
              balanceSource: 'api',
              creditSource: 'api'
            };
          }
        }
      } catch (error) {
        console.warn(`⚠️ API 获取余额失败 (accountId=${accountId}):`, error);
      }
    }

    // 回退到页面方式获取
    return await this.getAccountFinancialSnapshot(accountId);
  }

  // 公共方法：获取外部IP（占位实现）
  async getExternalIP(accountId: number): Promise<string | null> {
    console.warn(`⚠️ getExternalIP 方法尚未完整实现 (accountId=${accountId})`);
    return null;
  }

  // 公共方法：获取账号信用额度
  async getAccountCredit(accountId: number): Promise<number | null> {
    const financial = await this.getAccountFinancialSnapshot(accountId);
    return financial.credit;
  }

  async fetchMatchesSystem(opts?: {
    gtype?: string; showtype?: string; rtype?: string; ltype?: string; sorttype?: string
  }): Promise<{ matches: any[]; xml?: string }> {
    const defaults = { gtype: 'ft', showtype: 'live', rtype: 'rb', ltype: '3', sorttype: 'L' };
    const params = { ...defaults, ...(opts || {}) };

    try {
      // 使用纯 API 方式抓取赛事
      return await this.fetchMatchesWithApi(params);
    } catch (error) {
      console.error('系统抓取赛事失败:', error);
      return { matches: [] };
    }
  }

  // 使用纯 API 方式抓取赛事（已禁用，只使用独立抓取服务）
  private async fetchMatchesWithApi(params: {
    gtype: string; showtype: string; rtype: string; ltype: string; sorttype: string
  }): Promise<{ matches: any[]; xml?: string }> {
    console.log('ℹ️ 数据库账号抓取已禁用，请使用独立抓取服务');
    return { matches: [] };
  }

  private async prepareApiClient(accountId: number): Promise<{ success: boolean; client?: CrownApiClient; message: string }> {
    // 【重要】如果该账号正在登录中，等待登录完成
    const existingLock = this.loginLocks.get(accountId);
    if (existingLock) {
      console.log(`🔒 账号 ${accountId} 正在登录中，等待登录完成后再准备客户端...`);
      await existingLock;
      console.log(`🔓 账号 ${accountId} 登录完成，继续准备客户端`);
    }

    let apiLoginTime = this.apiLoginSessions.get(accountId);
    let uid = this.apiUids.get(accountId);

    // 如果内存中没有会话信息，尝试从数据库恢复
    if (!apiLoginTime || !uid) {
      console.log(`🔄 内存中没有会话信息，尝试从数据库恢复 (accountId=${accountId})`);
      const dbResult = await query(
        `SELECT api_uid, api_login_time FROM crown_accounts WHERE id = $1 AND is_online = true`,
        [accountId]
      );

      if (dbResult.rows.length > 0 && dbResult.rows[0].api_uid && dbResult.rows[0].api_login_time) {
        const dbUid = dbResult.rows[0].api_uid;
        const dbLoginTime = Number(dbResult.rows[0].api_login_time);

        // 检查数据库中的会话是否过期
        const now = Date.now();
        const apiSessionTtl = 2 * 60 * 60 * 1000; // 2 小时
        if (now - dbLoginTime < apiSessionTtl) {
          // 恢复到内存
          this.apiLoginSessions.set(accountId, dbLoginTime);
          this.apiUids.set(accountId, dbUid);
          apiLoginTime = dbLoginTime;
          uid = dbUid;
          console.log(`✅ 已从数据库恢复会话: accountId=${accountId}, uid=${dbUid}`);
        } else {
          console.log(`⚠️ 数据库中的会话已过期 (age=${Math.round((now - dbLoginTime) / 1000 / 60)}分钟)`);
        }
      }
    }

    if (!apiLoginTime || !uid) {
      return {
        success: false,
        message: '账号未登录（缺少纯 API 会话）',
      };
    }

    const now = Date.now();
    const apiSessionTtl = 2 * 60 * 60 * 1000; // 2 小时
    if (now - apiLoginTime >= apiSessionTtl) {
      return {
        success: false,
        message: '账号会话已过期，请重新登录',
      };
    }

    const accountResult = await query(
      `SELECT username, device_type, user_agent, proxy_enabled, proxy_type, proxy_host, proxy_port, proxy_username, proxy_password, api_cookies
         FROM crown_accounts WHERE id = $1`,
      [accountId]
    );

    if (accountResult.rows.length === 0) {
      return {
        success: false,
        message: '账号不存在',
      };
    }

    const row = accountResult.rows[0];

    const apiClient = new CrownApiClient({
      baseUrl: this.activeBaseUrl,
      deviceType: row.device_type || 'iPhone 14',
      userAgent: row.user_agent,
      proxy: {
        enabled: row.proxy_enabled || false,
        type: row.proxy_type,
        host: row.proxy_host,
        port: row.proxy_port,
        username: row.proxy_username,
        password: row.proxy_password,
      },
    });

    apiClient.setUid(uid);
    if (row.api_cookies) {
      apiClient.setCookies(row.api_cookies);
      console.log('🍪 已恢复 Cookie 到 API 客户端');
    } else {
      console.warn('⚠️ 数据库中没有保存 Cookie，可能无法获取赔率');
    }

    console.log(`✅ API 客户端准备完成: accountId=${accountId}, uid=${uid}, 代理=${row.proxy_enabled ? `${row.proxy_type}://${row.proxy_host}:${row.proxy_port}` : '未启用'}`);

    return { success: true, client: apiClient, message: '准备完成' };
  }

  private async lookupLatestOdds(
    apiClient: CrownApiClient,
    betRequest: BetRequest
  ): Promise<{
    success: boolean;
    message: string;
    oddsResult?: any;
    variant?: { wtype: string; rtype: string; chose_team: string };
    crownMatchId?: string;
    reasonCode?: string;
  }> {
    const crownMatchId = (betRequest.crown_match_id ?? betRequest.crownMatchId ?? '').toString().trim();
    if (!crownMatchId) {
      console.error('❌ 缺少皇冠比赛 ID (crown_match_id)');
      console.error('   betRequest:', JSON.stringify(betRequest, null, 2));
      return {
        success: false,
        message: '缺少皇冠比赛 ID，无法下注。请确保比赛已在皇冠映射表中。',
        reasonCode: 'MISSING_CROWN_GID',
      };
    }

    const { wtype: baseWtype, rtype: baseRtype, chose_team: baseChoseTeam } = this.convertBetTypeToApiParams(
      betRequest.betType,
      betRequest.betOption,
      {
        homeName: betRequest.home_team || betRequest.homeTeam,
        awayName: betRequest.away_team || betRequest.awayTeam,
      },
      {
        marketCategory: betRequest.market_category ?? betRequest.marketCategory,
        marketScope: betRequest.market_scope ?? betRequest.marketScope,
        marketSide: betRequest.market_side ?? betRequest.marketSide,
      }
    );

    const overrideWtypeRaw = betRequest.market_wtype ?? betRequest.marketWtype;
    const overrideRtypeRaw = betRequest.market_rtype ?? betRequest.marketRtype;
    const overrideChoseTeamRaw = betRequest.market_chose_team ?? betRequest.marketChoseTeam;

    console.log(`🔍 下注参数覆盖值:`, {
      market_wtype: overrideWtypeRaw,
      market_rtype: overrideRtypeRaw,
      market_chose_team: overrideChoseTeamRaw,
      base_wtype: baseWtype,
      base_rtype: baseRtype,
      base_chose_team: baseChoseTeam,
    });

    const sanitize = (value?: string | null) => {
      const trimmed = (value ?? '').toString().trim();
      return trimmed ? trimmed.toUpperCase() : undefined;
    };

    const effectiveParams = {
      wtype: sanitize(overrideWtypeRaw) ?? baseWtype,
      rtype: sanitize(overrideRtypeRaw) ?? baseRtype,
      chose_team: (sanitize(overrideChoseTeamRaw) as 'H' | 'C' | 'N' | undefined) ?? baseChoseTeam,
    };

    console.log(`✅ 最终使用的参数:`, effectiveParams);

    const variants = this.buildBetVariants(effectiveParams);

    let oddsResult: any = null;
    let selectedVariant: { wtype: string; rtype: string; chose_team: string } | null = null;
    let lastErrorMessage = '';
    let lastErrorCode: string | undefined;

    const maxRetries = 3;
    const retryDelay = 2000;

    // 提取盘口线参数和盘口专属 gid
    const spreadValue = betRequest.market_line ?? betRequest.marketLine ?? '';
    const spreadGid = betRequest.spread_gid ?? betRequest.spreadGid ?? '';
    // 优先使用盘口专属 gid（用于副盘口），否则使用主比赛 gid
    const effectiveGid = spreadGid || crownMatchId;
    console.log('📊 盘口线:', spreadValue || '未指定');
    console.log('📊 盘口专属 GID:', spreadGid || '未指定（使用主 GID）');
    console.log('📊 实际使用 GID:', effectiveGid);

    for (const variant of variants) {
      console.log('🎯 尝试获取赔率组合:', variant, '盘口线:', spreadValue || '(主盘口)', 'gid:', effectiveGid);
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`🔄 获取赔率 [${variant.wtype}/${variant.rtype}] gid=${effectiveGid} spread=${spreadValue || '主盘口'} 尝试 ${attempt}/${maxRetries}`);
        oddsResult = await apiClient.getLatestOdds({
          gid: effectiveGid,
          gtype: 'FT',
          wtype: variant.wtype,
          chose_team: variant.chose_team,
          spread: spreadValue || undefined,  // 传递盘口线参数
        });

        if (oddsResult.success) {
          selectedVariant = variant;
          console.log('✅ 获取赔率成功:', oddsResult);
          break;
        }

        lastErrorMessage = oddsResult.message || oddsResult.code || '未知错误';
        lastErrorCode = oddsResult.code || oddsResult.errormsg;

        // 处理会话失效错误：直接返回错误（会话清除和重新登录在上层处理）
        if (oddsResult.code === 'DOUBLE_LOGIN') {
          console.log('⚠️ 检测到重复登录，会话已失效');
          return {
            success: false,
            message: '账号在其他地方登录，当前会话已失效。请重新登录账号。',
            crownMatchId,
            reasonCode: 'DOUBLE_LOGIN',
          };
        }

        if (oddsResult.code === 'SESSION_EXPIRED') {
          console.log('⚠️ 检测到会话失效 (1X014)');
          return {
            success: false,
            message: '会话已失效，请重新登录账号。',
            crownMatchId,
            reasonCode: 'SESSION_EXPIRED',
          };
        }

        if (oddsResult.code === 'MARKET_CLOSED' && attempt < maxRetries) {
          console.log(`⏳ 盘口暂时封盘，等待 ${retryDelay / 1000} 秒后重试...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        if (attempt === maxRetries) {
          console.log('⚠️ 该组合获取赔率失败:', oddsResult);
        }
      }

      if (selectedVariant) {
        break;
      }
    }

    if (!selectedVariant || !oddsResult?.success) {
      const message = (lastErrorCode === '555' || lastErrorMessage === 'MARKET_CLOSED')
        ? '盘口已封盘或暂时不可投注'
        : `获取赔率失败: ${lastErrorMessage || '未知错误'}`;
      return {
        success: false,
        message,
        crownMatchId: effectiveGid, // 返回实际使用的 gid
        reasonCode: lastErrorCode,
      };
    }

    return {
      success: true,
      message: '获取赔率成功',
      oddsResult,
      variant: selectedVariant,
      crownMatchId: effectiveGid, // 返回实际使用的 gid（可能是盘口专属 gid）
    };
  }

  async fetchLatestOdds(accountId: number, betRequest: BetRequest): Promise<{
    success: boolean;
    message: string;
    closed?: boolean;
    oddsResult?: any;
    variant?: { wtype: string; rtype: string; chose_team: string };
    crownMatchId?: string;
    reasonCode?: string;
  }> {
    let prepared = await this.prepareApiClient(accountId);
    
    // 如果 prepareApiClient 失败，尝试自动重新登录
    if (!prepared.success || !prepared.client) {
      console.log('⚠️ API 客户端准备失败:', prepared.message, '，尝试自动重新登录...');
      
      // 检查账号是否启用
      const accountCheck = await query(
        'SELECT * FROM crown_accounts WHERE id = $1 AND is_enabled = true',
        [accountId]
      );
      
      if (accountCheck.rows.length > 0) {
        console.log('🔄 账号已启用，尝试自动登录...');
        try {
          const loginResult = await this.loginAccount(accountCheck.rows[0] as CrownAccount);
          if (loginResult.success) {
            console.log('✅ 自动登录成功');
            // 重新准备 API 客户端
            prepared = await this.prepareApiClient(accountId);
          } else {
            console.log('❌ 自动登录失败:', loginResult.message);
            // 更新数据库状态
            await query(
              `UPDATE crown_accounts SET is_online = false WHERE id = $1`,
              [accountId]
            );
          }
        } catch (loginError: any) {
          console.error('❌ 自动登录异常:', loginError.message);
        }
      }
      
      // 再次检查
      if (!prepared.success || !prepared.client) {
        return {
          success: false,
          message: prepared.message,
        };
      }
    }

    let apiClient = prepared.client;
    try {
      let lookup = await this.lookupLatestOdds(apiClient, betRequest);
      
      // 处理会话失效错误：尝试自动重新登录
      const sessionExpiredCodes = ['DOUBLE_LOGIN', 'SESSION_EXPIRED'];
      if (!lookup.success && sessionExpiredCodes.includes(lookup.reasonCode || '')) {
        console.log('⚠️ 会话已失效 (accountId=' + accountId + ', reason=' + lookup.reasonCode + ')，尝试自动重新登录...');

        // 【重要】立即清除内存和数据库中的旧会话，防止其他请求恢复到已失效的会话
        this.apiLoginSessions.delete(accountId);
        this.apiUids.delete(accountId);
        await query(
          `UPDATE crown_accounts SET api_uid = NULL, api_login_time = NULL, api_cookies = NULL, is_online = false WHERE id = $1`,
          [accountId]
        );
        console.log('🗑️ 已清除旧会话信息（内存+数据库）');

        await apiClient.close();

        // 检查账号是否启用，如果启用则尝试自动重新登录
        const accountCheck = await query(
          'SELECT is_enabled, username, password FROM crown_accounts WHERE id = $1',
          [accountId]
        );

        if (accountCheck.rows.length > 0 && accountCheck.rows[0].is_enabled) {
          console.log('🔄 账号已启用，尝试自动重新登录（使用 API 登录）...');
          try {
            // 获取完整账号信息用于登录
            const fullAccountResult = await query('SELECT * FROM crown_accounts WHERE id = $1', [accountId]);
            if (fullAccountResult.rows.length === 0) {
              throw new Error('账号不存在');
            }
            const account = fullAccountResult.rows[0] as CrownAccount;
            // 使用 API 登录而不是浏览器登录
            const loginResult = await this.loginAccountWithApi(account);
            if (loginResult.success) {
              console.log('✅ 自动重新登录成功，等待 2 秒后重新获取赔率...');
              // 等待 2 秒让皇冠服务器同步会话
              await new Promise((resolve) => setTimeout(resolve, 2000));
              // 重新准备 API 客户端
              const newPrepared = await this.prepareApiClient(accountId);
              if (newPrepared.success && newPrepared.client) {
                apiClient = newPrepared.client;
                // 重新获取赔率
                lookup = await this.lookupLatestOdds(apiClient, betRequest);
              }
            } else {
              console.log('❌ 自动重新登录失败:', loginResult.message);
            }
          } catch (reloginError: any) {
            console.error('❌ 自动重新登录异常:', reloginError.message);
          }
        } else {
          // 账号未启用，更新数据库状态
          await query(
            `UPDATE crown_accounts SET is_online = false, api_uid = NULL, api_login_time = NULL WHERE id = $1`,
            [accountId]
          );
          console.log('📝 账号未启用或不存在，已设为离线');
        }
      }
      
      if (!lookup.success) {
        return {
          success: false,
          message: lookup.message,
          closed: lookup.reasonCode === '555' || lookup.reasonCode === 'MARKET_CLOSED',
          reasonCode: lookup.reasonCode,
          crownMatchId: lookup.crownMatchId,
        };
      }

      return {
        success: true,
        message: lookup.message,
        oddsResult: lookup.oddsResult,
        variant: lookup.variant,
        crownMatchId: lookup.crownMatchId,
      };
    } finally {
      await apiClient.close();
    }
  }

  // 使用纯 API 方式下注
  private async placeBetWithApi(accountId: number, betRequest: BetRequest): Promise<CrownBetResult> {
    let apiClient: CrownApiClient | null = null;
    try {
      const prepared = await this.prepareApiClient(accountId);
      if (!prepared.success || !prepared.client) {
        return {
          success: false,
          message: prepared.message,
        };
      }

      apiClient = prepared.client;

      const lookup = await this.lookupLatestOdds(apiClient, betRequest);
      if (!lookup.success || !lookup.oddsResult || !lookup.variant || !lookup.crownMatchId) {
        // 处理 doubleLogin 错误：清除会话
        if (lookup.reasonCode === 'DOUBLE_LOGIN') {
          console.log('⚠️ 清除账号会话 (accountId=' + accountId + ')');
          this.apiLoginSessions.delete(accountId);
          this.apiUids.delete(accountId);
        }

        return {
          success: false,
          message: lookup.message,
        };
      }

      const oddsResult = lookup.oddsResult;
      const chosenVariant = lookup.variant;
      const crownMatchId = lookup.crownMatchId;

      console.log('🎯 最终下注参数:', {
        gid: crownMatchId,
        wtype: chosenVariant.wtype,
        rtype: chosenVariant.rtype,
        chose_team: chosenVariant.chose_team,
        amount: betRequest.amount,
        odds: betRequest.odds,
      });

      const latestOdds = oddsResult.ioratio || betRequest.odds.toString();
      console.log('💰 执行下注...');
      console.log(`   使用赔率: ${latestOdds} (原始赔率: ${betRequest.odds})`);

      // 判断是否是滚球：
      // 1. wtype 包含 'E' (如 RE, ROU, HRE, HROU) 表示滚球
      // 2. 或者 match_status === 'live' 表示滚球
      const wtypeUpper = chosenVariant.wtype.toUpperCase();
      const isRunningBall = wtypeUpper.includes('E') ||
                           betRequest.match_status === 'live' ||
                           betRequest.matchStatus === 'live';

      console.log('📊 下注参数详情:', {
        gid: crownMatchId,
        wtype: chosenVariant.wtype,
        rtype: chosenVariant.rtype,
        chose_team: chosenVariant.chose_team,
        ioratio: latestOdds,
        gold: betRequest.amount.toString(),
        con: oddsResult.con,
        ratio: oddsResult.ratio,
        isRB: isRunningBall ? 'Y' : 'N',
        match_status: betRequest.match_status || betRequest.matchStatus,
      });

      const betResult = await apiClient.placeBet({
        gid: crownMatchId,
        gtype: 'FT',
        wtype: chosenVariant.wtype,
        rtype: chosenVariant.rtype,
        chose_team: chosenVariant.chose_team,
        ioratio: latestOdds,
        gold: betRequest.amount.toString(),
        con: oddsResult.con,
        ratio: oddsResult.ratio,
        isRB: isRunningBall ? 'Y' : 'N',
      });

      console.log('📥 下注响应:', betResult);

      if (betResult.code === '560' || betResult.ticket_id) {
        return {
          success: true,
          message: '下注成功',
          betId: betResult.ticket_id,
          actualOdds: parseFloat(betResult.ioratio || latestOdds),
        };
      }

      // 处理错误消息
      let errorMessage = betResult.msg || '下注失败';
      const errorCode = betResult.errormsg || betResult.code;

      // 导入错误代码映射
      const { formatCrownError } = require('../utils/crown-error-codes');

      if (errorCode) {
        errorMessage = formatCrownError(errorCode, betResult.msg);
      } else if (betResult.code === '555' && betResult.errormsg === '1X006') {
        errorMessage = `赔率已变化 (原: ${betRequest.odds}, 新: ${latestOdds})，请重新下注`;
      }

      return {
        success: false,
        message: errorMessage,
        errorCode: errorCode,
      };
    } catch (error: any) {
      console.error('❌ 纯 API 下注失败:', error);
      return {
        success: false,
        message: error.message || '下注失败',
      };
    } finally {
      if (apiClient) {
        await apiClient.close();
      }
    }
  }

  // 将下注类型和选项转换为 API 参数
  private convertBetTypeToApiParams(
    betType: string,
    betOption: string,
    context?: { homeName?: string; awayName?: string },
    meta?: { marketCategory?: string | null | undefined; marketScope?: string | null | undefined; marketSide?: string | null | undefined },
  ): {
    wtype: string;
    rtype: string;
    chose_team: string;
  } {
    console.log(`🔄 转换下注参数: betType="${betType}", betOption="${betOption}"`);

    const normalize = (value?: string | null) => (value || '').replace(/\s+/g, '').toLowerCase();
    const typeNormalized = normalize(betType);
    const optionNormalized = normalize(betOption);
    const homeNameNormalized = normalize(context?.homeName);
    const awayNameNormalized = normalize(context?.awayName);
    const metaCategoryNormalized = normalize(meta?.marketCategory);
    const metaScopeNormalized = normalize(meta?.marketScope);
    const metaSideNormalized = normalize(meta?.marketSide);

    const containsHomeKeyword =
      optionNormalized.includes('主') ||
      optionNormalized.includes('主队') ||
      optionNormalized.includes('主場') ||
      optionNormalized.includes('主场') ||
      optionNormalized.includes('home');
    const containsAwayKeyword =
      optionNormalized.includes('客') ||
      optionNormalized.includes('客队') ||
      optionNormalized.includes('客場') ||
      optionNormalized.includes('客场') ||
      optionNormalized.includes('away');
    const optionContainsHome = homeNameNormalized ? optionNormalized.includes(homeNameNormalized) : false;
    const optionContainsAway = awayNameNormalized ? optionNormalized.includes(awayNameNormalized) : false;

    const fallbackHalfDetection = () =>
      optionNormalized.includes('半') ||
      typeNormalized.includes('半') ||
      optionNormalized.includes('1h') ||
      optionNormalized.includes('half');

    const scopeFromMeta =
      metaScopeNormalized === 'half' || metaScopeNormalized === '1h' ? 'half'
        : metaScopeNormalized === 'full' || metaScopeNormalized === 'ft' ? 'full'
          : null;

    const isHalfMarket = scopeFromMeta === 'half'
      ? true
      : scopeFromMeta === 'full'
        ? false
        : fallbackHalfDetection();

    const isHomeSelection = metaSideNormalized === 'home' || (!metaSideNormalized && (containsHomeKeyword || optionContainsHome));
    const isAwaySelection = metaSideNormalized === 'away' || (!metaSideNormalized && (containsAwayKeyword || optionContainsAway));
    const isDrawSelection = metaSideNormalized === 'draw';
    const isOverSelection = metaSideNormalized === 'over';
    const isUnderSelection = metaSideNormalized === 'under';

    // 默认滚球独赢（RMH）
    let wtype = isHalfMarket ? 'HRM' : 'RM';
    let rtype = isHalfMarket ? 'HRMH' : 'RMH';
    let chose_team: 'H' | 'C' | 'N' = 'H';

    const parseHandicap = () => {
      wtype = isHalfMarket ? 'HRE' : 'RE';
      if (metaSideNormalized === 'away' || (isAwaySelection && !isHomeSelection)) {
        rtype = isHalfMarket ? 'HREC' : 'REC';
        chose_team = 'C';
      } else {
        rtype = isHalfMarket ? 'HREH' : 'REH';
        chose_team = 'H';
      }
    };

    const parseMoneyline = () => {
      wtype = isHalfMarket ? 'HRM' : 'RM';
      if (metaSideNormalized === 'away' || (isAwaySelection && !isHomeSelection && !isDrawSelection)) {
        rtype = isHalfMarket ? 'HRMC' : 'RMC';
        chose_team = 'C';
      } else if (
        metaSideNormalized === 'draw' ||
        optionNormalized.includes('和') ||
        optionNormalized.includes('和局') ||
        optionNormalized.includes('draw') ||
        optionNormalized.includes('x')
      ) {
        rtype = isHalfMarket ? 'HRMN' : 'RMN';
        chose_team = 'N';
      } else {
        rtype = isHalfMarket ? 'HRMH' : 'RMH';
        chose_team = 'H';
      }
    };

    const parseOverUnder = () => {
      wtype = isHalfMarket ? 'HROU' : 'ROU';
      if (isOverSelection || optionNormalized.includes('大') || optionNormalized.includes('over')) {
        rtype = isHalfMarket ? 'HROUC' : 'ROUC';
        chose_team = 'C';
      } else {
        rtype = isHalfMarket ? 'HROUH' : 'ROUH';
        chose_team = 'H';
      }
    };

    const resolvedByMeta = (() => {
      switch (metaCategoryNormalized) {
        case 'handicap':
        case 'asianhandicap':
          parseHandicap();
          return true;
        case 'moneyline':
          parseMoneyline();
          return true;
        case 'overunder':
        case 'ou':
          parseOverUnder();
          return true;
        default:
          return false;
      }
    })();

    if (!resolvedByMeta) {
      if (typeNormalized.includes('让球') || typeNormalized.includes('handicap') || typeNormalized.includes('讓球')) {
        parseHandicap();
      } else if (typeNormalized.includes('独赢') || typeNormalized.includes('moneyline') || typeNormalized.includes('獨贏')) {
        parseMoneyline();
      } else if (typeNormalized.includes('大小') || typeNormalized.includes('大/小') || typeNormalized.includes('over') || typeNormalized.includes('under')) {
        parseOverUnder();
      } else {
        // 无法明确识别时默认独赢主队
        parseMoneyline();
      }
    }

    console.log(`✅ 转换结果: wtype="${wtype}", rtype="${rtype}", chose_team="${chose_team}" (half=${isHalfMarket}, metaCategory=${metaCategoryNormalized || 'n/a'}, metaSide=${metaSideNormalized || 'n/a'})`);
    return { wtype, rtype, chose_team };
  }

  private buildBetVariants(base: { wtype: string; rtype: string; chose_team: string }) {
    const fallbackMap: Record<string, string[]> = {
      RE: ['R'],
      R: ['RE'],
      RO: ['RE'],
      RCO: ['RE'],
      ROU: ['OU'],
      OU: ['ROU'],
      ROUHO: ['ROU', 'OUHO', 'OU'],
      OUHO: ['ROUHO', 'ROU'],
      ROUCO: ['ROU', 'OUCO', 'OU'],
      OUCO: ['ROUCO', 'ROU'],
      RM: ['M'],
      M: ['RM'],
      HRE: ['HR'],
      HR: ['HRE'],
      HROU: ['HOU'],
      HOU: ['HROU'],
      HROUHO: ['HROU', 'HOUHO', 'HOU'],
      HOUHO: ['HROUHO', 'HROU'],
      HROUCO: ['HROU', 'HOUCO', 'HOU'],
      HOUCO: ['HROUCO', 'HROU'],
      HRM: ['HM'],
      HM: ['HRM'],
    };

    const variants: Array<{ wtype: string; rtype: string; chose_team: string }> = [];
    const seen = new Set<string>();

    const normalize = (value: string) => value.toUpperCase();

    const replaceRtypePrefix = (rtype: string, from: string, to: string) => {
      const upperRtype = rtype.toUpperCase();
      const fromUpper = from.toUpperCase();
      const toUpper = to.toUpperCase();
      if (upperRtype.startsWith(fromUpper)) {
        return toUpper + rtype.slice(fromUpper.length);
      }
      return toUpper;
    };

    const pushVariant = (wtype: string, rtype: string) => {
      const key = `${normalize(wtype)}|${normalize(rtype)}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      variants.push({ wtype: normalize(wtype), rtype: normalize(rtype), chose_team: base.chose_team });
    };

    pushVariant(base.wtype, base.rtype);

    const primaryUpper = normalize(base.wtype);
    const fallbacks = fallbackMap[primaryUpper] || [];
    for (const fallback of fallbacks) {
      const derivedRtype = replaceRtypePrefix(base.rtype, primaryUpper, fallback);
      pushVariant(fallback, derivedRtype);
    }

    return variants;
  }

  // 执行下注（仅支持纯 API 方式）
  async placeBet(accountId: number, betRequest: BetRequest): Promise<CrownBetResult> {
    // 检查纯 API 会话
    const apiLoginTime = this.apiLoginSessions.get(accountId);
    const uid = this.apiUids.get(accountId);

    if (!apiLoginTime || !uid) {
      return {
        success: false,
        message: '账号未登录（缺少纯 API 会话）',
      };
    }

    const now = Date.now();
    const apiSessionTtl = 2 * 60 * 60 * 1000; // 2 小时
    if (now - apiLoginTime >= apiSessionTtl) {
      return {
        success: false,
        message: '账号会话已过期，请重新登录',
      };
    }

    console.log(`📌 使用纯 API 方式下注 (账号 ID=${accountId}, UID=${uid})`);
    return await this.placeBetWithApi(accountId, betRequest);
  }

  private async getAccountFinancialSnapshot(accountId: number): Promise<FinancialSnapshot> {
    const snapshot: FinancialSnapshot = {
      balance: null,
      credit: null,
      balanceSource: 'unknown',
      creditSource: 'unknown',
    };

    const page = this.pages.get(accountId);
    if (!page) {
      console.warn(`⚠️ [financial] 无页面上下文，账号 ${accountId}`);
      return snapshot;
    }

    const normalizeNumber = (value: any): number | null => {
      if (value === null || value === undefined) {
        return null;
      }
      const str = String(value).replace(/[\u00A0\s]+/g, ' ').trim();
      if (!str) {
        return null;
      }
      const match = str.match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/);
      if (!match) {
        return null;
      }
      const numeric = parseFloat(match[0].replace(/,/g, ''));
      return Number.isFinite(numeric) ? numeric : null;
    };

    const mergeValue = (key: 'balance' | 'credit', value: number | null, source: string) => {
      if (value === null) {
        return;
      }
      if (key === 'balance' && snapshot.balance === null) {
        snapshot.balance = value;
        snapshot.balanceSource = source;
      }
      if (key === 'credit' && snapshot.credit === null) {
        snapshot.credit = value;
        snapshot.creditSource = source;
      }
    };

    try {
      await page
        .waitForFunction(() => {
          const topWin = (globalThis as any).top || (globalThis as any);
          const param: any = topWin?.param;
          return typeof param === 'string' && param.includes('uid=');
        }, { timeout: 8000 })
        .catch(() => undefined);

      await page
        .waitForFunction(() => {
          const topWin = (globalThis as any).top || (globalThis as any);
          const userData: any = topWin?.userData || {};

          const numericFields = [
            userData?.cash,
            userData?.money,
            userData?.balance,
            userData?.wallet,
            userData?.maxcredit,
            userData?.maxCredit,
            userData?.oldCredit,
            userData?.credit,
          ];

          return numericFields.some((val) => {
            if (val === null || val === undefined) {
              return false;
            }
            const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
            return Number.isFinite(num);
          });
        }, { timeout: 8000 })
        .catch(() => undefined);

      const userData = await page.evaluate(() => {
        const topWin = (globalThis as any).top || (globalThis as any);
        return topWin?.userData || {};
      }).catch(() => ({}));

      if (userData) {
        const cash = normalizeNumber(userData.cash);
        const money = normalizeNumber(userData.money);
        const balance = normalizeNumber(userData.balance);
        const wallet = normalizeNumber(userData.wallet);

        mergeValue('balance', cash, 'userData.cash');
        mergeValue('balance', money, 'userData.money');
        mergeValue('balance', balance, 'userData.balance');
        mergeValue('balance', wallet, 'userData.wallet');

        const maxcredit = normalizeNumber(userData.maxcredit);
        const maxCredit = normalizeNumber(userData.maxCredit);
        const oldCredit = normalizeNumber(userData.oldCredit);
        const credit = normalizeNumber(userData.credit);

        mergeValue('credit', maxcredit, 'userData.maxcredit');
        mergeValue('credit', maxCredit, 'userData.maxCredit');
        mergeValue('credit', oldCredit, 'userData.oldCredit');
        mergeValue('credit', credit, 'userData.credit');
      }

      const topData = await page.evaluate(() => {
        const topWin = (globalThis as any).top || (globalThis as any);
        const param: any = topWin?.param;
        if (typeof param !== 'string') {
          return null;
        }
        const match = param.match(/maxcredit=([^&]+)/);
        return match ? match[1] : null;
      }).catch(() => null);

      if (topData) {
        const topCredit = normalizeNumber(topData);
        mergeValue('credit', topCredit, 'top.param.maxcredit');
      }

      const frames = page.frames();
      for (const frame of frames) {
        try {
          const frameData = await frame.evaluate(() => {
            const doc = (globalThis as any).document;
            const balanceEl = doc?.querySelector?.('#balance, .balance, [id*="balance"], [class*="balance"]');
            const creditEl = doc?.querySelector?.('#credit, .credit, [id*="credit"], [class*="credit"]');
            return {
              balance: balanceEl?.textContent || balanceEl?.innerText || null,
              credit: creditEl?.textContent || creditEl?.innerText || null,
            };
          }).catch(() => null);

          if (frameData) {
            const frameBalance = normalizeNumber(frameData.balance);
            const frameCredit = normalizeNumber(frameData.credit);
            mergeValue('balance', frameBalance, `frame[${frame.name() || frame.url()}].balance`);
            mergeValue('credit', frameCredit, `frame[${frame.name() || frame.url()}].credit`);
          }
        } catch {
          // Ignore frame errors
        }
      }
    } catch (error) {
      console.warn(`⚠️ [financial] 获取账号 ${accountId} 财务快照失败:`, error);
    }

    return snapshot;
  }

  // 辅助方法：解析环境变量为时间间隔（毫秒）
  private resolveInterval(envValue: string | undefined, defaultValue: number, minValue: number): number {
    if (!envValue) {
      return defaultValue;
    }
    const parsed = parseInt(envValue, 10);
    if (!Number.isFinite(parsed) || parsed < minValue) {
      return defaultValue;
    }
    return parsed;
  }

  // 辅助方法：解析环境变量为正整数
  private resolvePositiveInteger(envValue: string | undefined, defaultValue: number, minValue: number): number {
    if (!envValue) {
      return defaultValue;
    }
    const parsed = parseInt(envValue, 10);
    if (!Number.isFinite(parsed) || parsed < minValue) {
      return defaultValue;
    }
    return parsed;
  }

  // 辅助方法：解析延迟缩放因子
  private resolveDelayScale(envValue: string | undefined): number {
    if (!envValue) {
      return 1;
    }
    const parsed = parseFloat(envValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 1;
    }
    return Math.min(Math.max(parsed, 0.1), 10); // 限制在 0.1 到 10 之间
  }

  // 辅助方法：解析基础 URL 候选列表
  private resolveBaseUrlCandidates(): string[] {
    // 优先使用单一 CROWN_BASE_URL（例如 https://hga026.com）
    if (process.env.CROWN_BASE_URL) {
      const url = process.env.CROWN_BASE_URL.trim();
      if (url) return [url];
    }
    const envUrls = process.env.CROWN_BASE_URL_CANDIDATES;
    if (envUrls) {
      const urls = envUrls.split(',').map(url => url.trim()).filter(Boolean);
      if (urls.length > 0) {
        return urls;
      }
    }
    // 默认候选列表
    return [DEFAULT_CROWN_BASE_URL];
  }

  // 公共方法：检查账号是否在线（纯 API 会话）
  isAccountOnline(accountId: number): boolean {
    const apiLoginTime = this.apiLoginSessions.get(accountId);
    const uid = this.apiUids.get(accountId);

    if (!apiLoginTime || !uid) {
      return false;
    }

    const now = Date.now();
    const apiSessionTtl = 2 * 60 * 60 * 1000; // 2 小时

    return (now - apiLoginTime) < apiSessionTtl;
  }

  // 公共方法：获取账号的 API UID
  getApiUid(accountId: number): string | undefined {
    return this.apiUids.get(accountId);
  }

  // 公共方法：获取活跃会话数量
  getActiveSessionCount(): number {
    let count = 0;
    const now = Date.now();
    const apiSessionTtl = 2 * 60 * 60 * 1000; // 2 小时

    for (const [accountId, loginTime] of this.apiLoginSessions.entries()) {
      const uid = this.apiUids.get(accountId);
      if (uid && (now - loginTime) < apiSessionTtl) {
        count++;
      }
    }

    return count;
  }

  // 公共方法：获取系统状态
  getSystemStatus(): any {
    return {
      isRunning: true,
      activeApiSessions: this.getActiveSessionCount(),
      totalApiSessions: this.apiLoginSessions.size,
    };
  }

  // 辅助方法：确保基础 URL 健康状态
  private ensureBaseUrlHealth(url: string): void {
    // 初始化 URL 健康状态
    if (!this.baseUrlHealth.has(url)) {
      this.baseUrlHealth.set(url, {
        failCount: 0,
        lastFailure: 0,
        lastSuccess: 0,
      });
    }
  }

  // 启动在线状态监控
  private startOnlineMonitor(): void {
    if (this.onlineStatusTimer) {
      return;
    }

    // 定期检查账号在线状态
    this.onlineStatusTimer = setInterval(() => {
      if (this.onlineStatusRunning) {
        return;
      }

      this.onlineStatusRunning = true;
      this.updateOnlineStatus()
        .catch((error) => {
          console.error('❌ 更新在线状态失败:', error);
        })
        .finally(() => {
          this.onlineStatusRunning = false;
        });
    }, this.onlineStatusIntervalMs);
  }

  // 更新账号在线状态
  private async updateOnlineStatus(): Promise<void> {
    try {
      // 获取所有启用的账号
      const result = await query('SELECT id, is_online FROM crown_accounts WHERE is_enabled = true');
      const accounts = result.rows as Array<{ id: number; is_online: boolean }>;

      const now = Date.now();

      for (const account of accounts) {
        const accountId = account.id;
        const isOnline = this.isAccountOnline(accountId);

        // 如果在线状态发生变化，更新数据库
        if (isOnline !== account.is_online) {
          await query(
            `UPDATE crown_accounts
             SET is_online = $1,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
            [isOnline, accountId]
          );
        }
      }
    } catch (error) {
      console.error('❌ 更新在线状态时出错:', error);
    }
  }

  /**
   * 批量映射赛事名称（英文/繁体 → 简体中文）
   */
  private async mapMatchNames(matches: any[]): Promise<any[]> {
    try {
      // 收集所有需要映射的名称
      const leagueNames = new Set<string>();
      const teamNames = new Set<string>();

      for (const match of matches) {
        if (match.league) leagueNames.add(match.league);
        if (match.home) teamNames.add(match.home);
        if (match.away) teamNames.add(match.away);
      }

      // 批量查询映射
      const leagueMap = new Map<string, string>();
      const teamMap = new Map<string, string>();

      if (leagueNames.size > 0) {
        const leagueResult = await query(
          `SELECT name_zh_tw, name_en, name_zh_cn FROM league_aliases
           WHERE name_zh_tw = ANY($1) OR name_en = ANY($1)`,
          [Array.from(leagueNames)]
        );
        for (const row of leagueResult.rows) {
          const displayName = row.name_zh_cn || row.name_zh_tw || row.name_en;
          if (row.name_zh_tw) leagueMap.set(row.name_zh_tw, displayName);
          if (row.name_en) leagueMap.set(row.name_en, displayName);
        }
      }

      if (teamNames.size > 0) {
        const teamResult = await query(
          `SELECT name_zh_tw, name_en, name_zh_cn FROM team_aliases
           WHERE name_zh_tw = ANY($1) OR name_en = ANY($1)`,
          [Array.from(teamNames)]
        );
        for (const row of teamResult.rows) {
          const displayName = row.name_zh_cn || row.name_zh_tw || row.name_en;
          if (row.name_zh_tw) teamMap.set(row.name_zh_tw, displayName);
          if (row.name_en) teamMap.set(row.name_en, displayName);
        }
      }

      // 应用映射
      return matches.map(match => ({
        ...match,
        league: leagueMap.get(match.league) || match.league,
        home: teamMap.get(match.home) || match.home,
        away: teamMap.get(match.away) || match.away,
      }));
    } catch (error) {
      console.error('❌ 映射赛事名称失败:', error);
      return matches; // 失败时返回原始数据
    }
  }

  // 解析 XML 赛事数据
  private async parseMatchesFromXml(xml: string): Promise<any[]> {
    try {
      const { XMLParser } = require('fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xml);

      const ec = parsed?.serverresponse?.ec;
      if (!ec) {
        console.log('⚠️ XML 中没有赛事数据');
        return [];
      }

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

      console.log(`📊 解析到 ${allGames.length} 场赛事`);

      // 先提取原始数据
      const rawMatches = allGames.map((game: any) => {
        const gid = pickString(game, ['GID']);
        const gidm = pickString(game, ['GIDM']);
        const ecid = pickString(game, ['ECID']);
        const league = pickString(game, ['LEAGUE']);
        const home = pickString(game, ['TEAM_H', 'TEAM_H_E', 'TEAM_H_TW']);
        const away = pickString(game, ['TEAM_C', 'TEAM_C_E', 'TEAM_C_TW']);
        const time = pickString(game, ['DATETIME', 'TIME'], new Date().toISOString());
        const scoreH = pickString(game, ['SCORE_H']);
        const scoreC = pickString(game, ['SCORE_C']);
        const score = (scoreH || scoreC) ? `${scoreH || '0'}-${scoreC || '0'}` : pickString(game, ['SCORE']);
        const retime = pickString(game, ['RETIMESET']);
        let period = '';
        let clock = '';
        if (retime.includes('^')) {
          const [p, c] = retime.split('^');
          period = (p || '').trim();
          clock = (c || '').trim();
        } else {
          period = pickString(game, ['SE_NOW']);
          clock = pickString(game, ['TIMER']);
        }
        const runningStatus = pickString(game, ['RUNNING', 'STATUS']);
        const matchStatus = runningStatus || (period ? 'live' : '');
        const markets = this.parseMarketsFromEvent(game);

        return {
          gid,
          gidm,
          ecid,
          league,
          home,
          away,
          time,
          score,
          status: matchStatus,
          period,
          clock,
          markets,
          more: pickString(game, ['MORE']),
          counts: {
            handicap: pickString(game, ['R_COUNT']),
            overUnder: pickString(game, ['OU_COUNT']),
            correctScore: pickString(game, ['PD_COUNT']),
            corners: pickString(game, ['CN_COUNT']),
            winners: pickString(game, ['WI_COUNT']),
            specials: pickString(game, ['SFS_COUNT']),
            penalties: pickString(game, ['PK_COUNT']),
          },
          raw: game,
        };
      }).filter(m => m.gid);

      // 批量映射名称（英文/繁体 → 简体中文）
      const matches = await this.mapMatchNames(rawMatches);

      return matches;
    } catch (error) {
      console.error('❌ 解析 XML 赛事数据失败:', error);
      return [];
    }
  }

  // 解析 get_game_more 返回的 XML，提取所有盘口
  private parseMoreMarketsFromXml(xml: string): {
    handicapLines: any[];
    overUnderLines: any[];
    halfHandicapLines: any[];
    halfOverUnderLines: any[];
    halfMoneyline?: { home?: string; draw?: string; away?: string };
  } {
    try {
      const { XMLParser } = require('fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xml);

      // 检查盘口是否关闭
      const allClose = parsed?.serverresponse?.all_close;
      const games = parsed?.serverresponse?.game;

      if (allClose === 'Y') {
        console.log('⚠️ 盘口已关闭');
        // 即使盘口关闭，也尝试解析 game 数据（可能还有数据）
        if (!games) {
          console.log('   且没有 game 数据，跳过');
          return { handicapLines: [], overUnderLines: [], halfHandicapLines: [], halfOverUnderLines: [], halfMoneyline: undefined };
        }
        console.log('   但仍尝试解析 game 数据...');
      }

      if (!games) {
        console.log('⚠️ get_game_more XML 中没有 game 数据');
        const responseStr = JSON.stringify(parsed?.serverresponse, null, 2) || 'undefined';
        console.log('📋 完整响应:', responseStr.substring(0, Math.min(500, responseStr.length)));
        return { handicapLines: [], overUnderLines: [], halfHandicapLines: [], halfOverUnderLines: [], halfMoneyline: undefined };
      }

      const gameArray = Array.isArray(games) ? games : [games];
      console.log(`🔍 找到 ${gameArray.length} 个 game 元素`);

      const handicapLines: any[] = [];
      const overUnderLines: any[] = [];
      const halfHandicapLines: any[] = [];
      let halfMoneyline: { home?: string; draw?: string; away?: string } | undefined;

      const halfOverUnderLines: any[] = [];

      for (let i = 0; i < gameArray.length; i++) {
        const game = gameArray[i];
        console.log(`  🎮 Game ${i + 1}:`, JSON.stringify(game, null, 2).substring(0, 300));

        //   wtype                CN   
        const wtype = this.pickString(game, ['WTYPE', 'wtype', 'type']).toUpperCase();
        if (/CN/.test(wtype)) {
          continue;
        }
        // 若字段名中包含 CN（如角球专用字段），也直接跳过
        const __keys = Object.keys(game || {});
        if (__keys.some(k => /CN/i.test(String(k)))) {
          continue;
        }
        // 仅保留我们前端已支持的主要玩法；不强制依赖 WTYPE 存在
        // 理由：部分 more 节点缺少 WTYPE，但可由字段名准确识别（R/RE、OU/ROU、HR/HRE、HOU/HROU、HM/HRM）
        // 下方抽取逻辑会基于字段来源标注 wtype，仅收集这些标准玩法

        // 打印所有 ratio 和 ior 字段用于调试
        const debugFields: any = {};
        for (const key of Object.keys(game)) {
          if (key.toLowerCase().includes('ratio') || key.toLowerCase().includes('ior')) {
            debugFields[key] = game[key];
          }
        }
        if (Object.keys(debugFields).length > 0) {
          console.log(`    📊 所有赔率字段:`, JSON.stringify(debugFields, null, 2));
        }

        // 提取让球盘口（兼容：滚球 RE；今日/早盘 R）
        const hasRE = !!this.pickString(game, ['RATIO_RE', 'ratio_re']);
        const hasR = !!this.pickString(game, ['RATIO_R', 'ratio_r']);
        const handicapLine = this.pickString(game, ['RATIO_RE', 'ratio_re', 'RATIO_R', 'ratio_r']);
        const handicapHome = this.pickString(game, ['IOR_REH', 'ior_REH', 'IOR_RH', 'ior_RH', 'ior_rh']);
        const handicapAway = this.pickString(game, ['IOR_REC', 'ior_REC', 'IOR_RC', 'ior_RC', 'ior_rc']);

        if ((hasRE || hasR) && handicapLine && (handicapHome || handicapAway)) {
          const master = this.pickString(game, ['@_master', 'master']);
          const gameGid = this.pickString(game, ['GID', 'gid', '@_id']);
          const hwtype = (hasRE ? 'RE' : hasR ? 'R' : 'RE');
          const homeRtype = hwtype === 'RE' ? 'REH' : 'RH';
          const awayRtype = hwtype === 'RE' ? 'REC' : 'RC';
          handicapLines.push({
            line: handicapLine,
            home: handicapHome,
            away: handicapAway,
            wtype: hwtype,
            home_rtype: homeRtype,
            away_rtype: awayRtype,
            home_chose_team: 'H',
            away_chose_team: 'C',
            gid: gameGid, // 盘口专用 gid
          });
          console.log(`    ✅ 让球 [${hwtype}] [Game ${i + 1}, master=${master}, gid=${gameGid}]: ${handicapLine} (${handicapHome} / ${handicapAway})`);
        }

        // 提取大小球盘口（仅主大小球，排除角球/球队进球等）
        const hasROU = !!this.pickString(game, ['RATIO_ROUO', 'ratio_rouo', 'RATIO_ROUU', 'ratio_rouu']);
        const hasOU = !!this.pickString(game, ['RATIO_OUO', 'ratio_ouo', 'RATIO_OUU', 'ratio_ouu']);
        const ouLineMain = this.pickString(game, ['RATIO_ROUO', 'ratio_rouo', 'RATIO_ROUU', 'ratio_rouu', 'RATIO_OUO', 'ratio_ouo', 'RATIO_OUU', 'ratio_ouu']);
        const ouOverMain = this.pickString(game, ['ior_ROUC', 'IOR_ROUC', 'ior_OUC', 'IOR_OUC']);
        const ouUnderMain = this.pickString(game, ['ior_ROUH', 'IOR_ROUH', 'ior_OUH', 'IOR_OUH']);

        if ((hasROU || hasOU) && ouLineMain && (ouOverMain || ouUnderMain)) {
          const nums = (ouLineMain || '').match(/[0-9.]+/g) || [];
          const avg = nums.length ? nums.map(parseFloat).reduce((a,b)=>a+b,0)/nums.length : NaN;
          if (!(Number.isFinite(avg) && avg > 6)) {
            const master = this.pickString(game, ['@_master', 'master']);
            const gameGid = this.pickString(game, ['GID', 'gid', '@_id']);
            const owtype = (hasROU ? 'ROU' : 'OU');
            const overRtype = owtype === 'ROU' ? 'ROUC' : 'OUC';
            const underRtype = owtype === 'ROU' ? 'ROUH' : 'OUH';
            overUnderLines.push({
              line: ouLineMain,
              over: ouOverMain,
              under: ouUnderMain,
              wtype: owtype,
              over_rtype: overRtype,
              under_rtype: underRtype,
              over_chose_team: 'C',
              under_chose_team: 'H',
              gid: gameGid, // 盘口专用 gid
            });
            console.log(`    ✅ 大小 [${owtype}] [Game ${i + 1}, master=${master}, gid=${gameGid}]: ${ouLineMain} (大:${ouOverMain} / 小:${ouUnderMain})`);
          }
        }

        // 提取半场让球盘口（兼容：HRE；HR）
        const hasHRE = !!this.pickString(game, ['RATIO_HRE', 'ratio_hre']);
        const hasHR = !!this.pickString(game, ['RATIO_HR', 'ratio_hr']);
        const halfHandicapLine = this.pickString(game, ['RATIO_HRE', 'ratio_hre', 'RATIO_HR', 'ratio_hr']);
        const halfHandicapHome = this.pickString(game, ['IOR_HREH', 'ior_HREH', 'IOR_HRH', 'ior_HRH', 'ior_hrh']);
        const halfHandicapAway = this.pickString(game, ['IOR_HREC', 'ior_HREC', 'IOR_HRC', 'ior_HRC', 'ior_hrc']);

        if (halfHandicapLine && (halfHandicapHome || halfHandicapAway)) {
          const master = this.pickString(game, ['@_master', 'master']);
          const gameGid = this.pickString(game, ['GID', 'gid', '@_id']);
          const hwtype = (hasHRE ? 'HRE' : hasHR ? 'HR' : 'HRE');
          const homeRtype = hwtype === 'HRE' ? 'HREH' : 'HRH';
          const awayRtype = hwtype === 'HRE' ? 'HREC' : 'HRC';
          halfHandicapLines.push({
            line: halfHandicapLine,
            home: halfHandicapHome,
            away: halfHandicapAway,
            wtype: hwtype,
            home_rtype: homeRtype,
            away_rtype: awayRtype,
            home_chose_team: 'H',
            away_chose_team: 'C',
            gid: gameGid, // 盘口专用 gid
          });
          console.log(`    ✅ 半场让球 [${hwtype}] [Game ${i + 1}, master=${master}, gid=${gameGid}]: ${halfHandicapLine} (${halfHandicapHome} / ${halfHandicapAway})`);
        }

        // 提取半场大小球盘口（仅主大小球，排除角球/球队进球等）
        const hasHROU = !!this.pickString(game, ['RATIO_HROUO', 'ratio_hrouo', 'RATIO_HROUU', 'ratio_hrouu']);
        const hasHOU = !!this.pickString(game, ['RATIO_HOUO', 'ratio_houo', 'RATIO_HOUU', 'ratio_houu']);
        const halfOuLine = this.pickString(game, ['RATIO_HROUO', 'ratio_hrouo', 'RATIO_HROUU', 'ratio_hrouu', 'RATIO_HOUO', 'ratio_houo', 'RATIO_HOUU', 'ratio_houu']);
        const halfOuOver = this.pickString(game, ['ior_HROUC', 'IOR_HROUC', 'ior_HOUC', 'IOR_HOUC']); // over
        const halfOuUnder = this.pickString(game, ['ior_HROUH', 'IOR_HROUH', 'ior_HOUH', 'IOR_HOUH']); // under

        if ((hasHROU || hasHOU) && halfOuLine && (halfOuOver || halfOuUnder)) {
          const numsH = (halfOuLine || '').match(/[0-9.]+/g) || [];
          const avgH = numsH.length ? numsH.map(parseFloat).reduce((a,b)=>a+b,0)/numsH.length : NaN;
          if (!(Number.isFinite(avgH) && avgH > 3.5)) {
            const master = this.pickString(game, ['@_master', 'master']);
            const gameGid = this.pickString(game, ['GID', 'gid', '@_id']);
            const howtype = (hasHROU ? 'HROU' : 'HOU');
            const overRtype = howtype === 'HROU' ? 'HROUC' : 'HOUC';
            const underRtype = howtype === 'HROU' ? 'HROUH' : 'HOUH';
            halfOverUnderLines.push({
              line: halfOuLine,
              over: halfOuOver,
              under: halfOuUnder,
              wtype: howtype,
              over_rtype: overRtype,
              under_rtype: underRtype,
              over_chose_team: 'C',
              under_chose_team: 'H',
              gid: gameGid, // 盘口专用 gid
            });
            console.log(`    ✅ 半场大小 [${howtype}] [Game ${i + 1}, master=${master}, gid=${gameGid}]: ${halfOuLine} (大:${halfOuOver} / 小:${halfOuUnder})`);
          }
        }

        // 半场独赢（兼容 HRM/HM）
        const halfMlHome = this.pickString(game, ['IOR_HRMH', 'ior_HRMH', 'IOR_HMH', 'ior_HMH']);
        const halfMlDraw = this.pickString(game, ['IOR_HRMN', 'ior_HRMN', 'IOR_HMN', 'ior_HMN']);
        const halfMlAway = this.pickString(game, ['IOR_HRMC', 'ior_HRMC', 'IOR_HMC', 'ior_HMC']);
        if (halfMlHome || halfMlDraw || halfMlAway) {
          const master = this.pickString(game, ['@_master', 'master']);
          if (!halfMoneyline || master === 'Y') {
            halfMoneyline = { home: halfMlHome, draw: halfMlDraw, away: halfMlAway };
          }
        }
      }

      console.log(`📊 解析到 ${handicapLines.length} 个让球盘口, ${overUnderLines.length} 个大小球盘口`);
      console.log(`📊 解析到 ${halfHandicapLines.length} 个半场让球盘口, ${halfOverUnderLines.length} 个半场大小球盘口`);
      return { handicapLines, overUnderLines, halfHandicapLines, halfOverUnderLines, halfMoneyline };

    } catch (error) {
      console.error('❌ 解析 get_game_more XML 失败:', error);
      return { handicapLines: [], overUnderLines: [], halfHandicapLines: [], halfOverUnderLines: [] };
    }
  }

  // 仅解析 get_game_more 中的角球盘口（全场角球让球 / 大小）
  private parseCornerMarketsFromXml(xml: string): {
    cornerHandicapLines: any[];
    cornerOverUnderLines: any[];
  } {
    try {
      const { XMLParser } = require('fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xml);

      const games = parsed?.serverresponse?.game;
      if (!games) {
        return { cornerHandicapLines: [], cornerOverUnderLines: [] };
      }

      const gameArray = Array.isArray(games) ? games : [games];

      const cornerHandicapLines: any[] = [];
      const cornerOverUnderLines: any[] = [];

      const pickString = (source: any, candidateKeys: string[]): string => {
        if (!source) return '';
        for (const key of candidateKeys) {
          if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
            return String(source[key]).trim();
          }
          const attrKey = `@_${key}`;
          if (source[attrKey] !== undefined && source[attrKey] !== null && source[attrKey] !== '') {
            return String(source[attrKey]).trim();
          }
        }
        return '';
      };

      for (const game of gameArray) {
        const wtypeRaw = pickString(game, ['WTYPE', 'wtype', 'type']);
        const rtypeRaw = pickString(game, ['RTYPE', 'rtype']);
        const wtype = (wtypeRaw || rtypeRaw || '').toUpperCase();

        const mode = pickString(game, ['@_mode', 'mode']);
        const ptype = pickString(game, ['@_ptype', 'ptype']);
        const teamH = pickString(game, ['TEAM_H', 'team_h']);
        const teamC = pickString(game, ['TEAM_C', 'team_c']);

        const isCorner = mode === 'CN' || /CN/.test(wtype) || ptype?.includes('角球') || teamH?.includes('角球') || teamC?.includes('角球');
        const isCard = mode === 'RN' || ptype?.includes('罰牌') || teamH?.includes('罰牌') || teamC?.includes('罰牌');

        // 跳过罚牌盘口
        if (isCard) {
          continue;
        }

        if (!isCorner) {
          continue;
        }

        // 角球让球盘口
        const cornerHandicapLine = pickString(game, ['RATIO_CNRH', 'RATIO_CNRC', 'ratio_cnrh', 'ratio_cnrc', 'ratio']);
        const cornerHandicapHome = pickString(game, ['IOR_CNRH', 'ior_CNRH', 'ior_cnrh']);
        const cornerHandicapAway = pickString(game, ['IOR_CNRC', 'ior_CNRC', 'ior_cnrc']);
        const cornerGid = pickString(game, ['GID', 'gid', '@_id']);
        if (cornerHandicapLine && cornerHandicapHome && cornerHandicapAway) {
          cornerHandicapLines.push({ line: cornerHandicapLine, home: cornerHandicapHome, away: cornerHandicapAway, gid: cornerGid });
        }

        // 角球大小盘口
        const cornerOuLine = pickString(game, ['RATIO_CNOUO', 'RATIO_CNOUU', 'ratio_cnouo', 'ratio_cnouu', 'ratio_o', 'ratio_u']);
        const cornerOuOver = pickString(game, ['IOR_CNOUH', 'ior_CNOUH', 'ior_cnouh']);
        const cornerOuUnder = pickString(game, ['IOR_CNOUC', 'ior_CNOUC', 'ior_cnouc']);
        if (cornerOuLine && cornerOuOver && cornerOuUnder) {
          cornerOverUnderLines.push({ line: cornerOuLine, over: cornerOuOver, under: cornerOuUnder, gid: cornerGid });
        }
      }

      return { cornerHandicapLines, cornerOverUnderLines };
    } catch (error) {
      console.error('❌ 解析 get_game_more 角球盘口失败:', error);
      return { cornerHandicapLines: [], cornerOverUnderLines: [] };
    }
  }

  private async loadAccountById(accountId: number): Promise<CrownAccount | null> {
    const result = await query('SELECT * FROM crown_accounts WHERE id = $1 LIMIT 1', [accountId]);
    if (result.rows.length === 0) {
      return null;
    }
    return result.rows[0] as CrownAccount;
  }

  private async pickAccountForApi(): Promise<CrownAccount | null> {
    try {
      let result = await query(
        `SELECT * FROM crown_accounts
         WHERE use_for_fetch = true AND is_enabled = true
         ORDER BY last_login_at DESC NULLS LAST
         LIMIT 1`
      );
      if (result.rows.length === 0) {
        result = await query(
          `SELECT * FROM crown_accounts
           WHERE is_enabled = true
           ORDER BY last_login_at DESC NULLS LAST
           LIMIT 1`
        );
      }
      if (result.rows.length > 0) {
        return result.rows[0] as CrownAccount;
      }

      // Fallback: 使用环境变量中的抓取账号（无需数据库）
      const envUser = process.env.CROWN_FETCH_USERNAME || process.env.CROWN_SYSTEM_USERNAME;
      const envPass = process.env.CROWN_FETCH_PASSWORD || process.env.CROWN_SYSTEM_PASSWORD;
      const envBase = (process.env.CROWN_BASE_URL || '').trim();
      if (envUser && envPass) {
        console.warn('⚠️ 没有数据库账号，使用环境变量抓取账号');
        const synthetic: any = {
          id: -1,
          username: envUser,
          password: envPass,
          base_url: envBase || undefined,
          proxy_enabled: false,
          device_type: 'iPhone 14',
          user_agent: undefined,
        };
        return synthetic as CrownAccount;
      }
      console.warn('⚠️ 没有可用于抓取的账号（数据库为空且未配置 CROWN_FETCH_USERNAME）');
      return null;
    } catch (error) {
      console.error('⚠️ 查找抓取账号失败:', error);
      return null;
    }
  }

  async fetchMoreMarkets(params: {
    gid: string;
    lid?: string;
    gtype?: string;
    showtype?: string;
    ltype?: string;
    isRB?: string;
    accountId?: number;
  }): Promise<{
    handicapLines: any[];
    overUnderLines: any[];
    halfHandicapLines: any[];
    halfOverUnderLines: any[];
    halfMoneyline?: { home?: string; draw?: string; away?: string };
  }> {
    const showtype = (params.showtype || 'live').toLowerCase();
    const gtype = params.gtype || 'ft';
    const ltype = params.ltype || '3';
    const isRB = params.isRB || (showtype === 'live' ? 'Y' : 'N');

    // Redis 缓存键
    const cacheKey = `crown:more_markets:${params.gid}:${showtype}:${gtype}`;
    const redis = getRedisClient();

    // 尝试从 Redis 读取缓存
    if (redis.isAvailable()) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const data = JSON.parse(cached);
          console.log(`✅ Redis 缓存命中: ${params.gid}`);
          return data;
        }
      } catch (error) {
        console.error('❌ Redis 读取失败:', error);
      }
    }

    // 缓存未命中，调用 API
    let account: CrownAccount | null = null;
    if (params.accountId) {
      account = await this.loadAccountById(Number(params.accountId));
    } else {
      account = await this.pickAccountForApi();
    }

    if (!account) {
      console.warn('⚠️ 无可用账号获取更多盘口');
      return { handicapLines: [], overUnderLines: [], halfHandicapLines: [], halfOverUnderLines: [] };
    }

    let prepared = await this.prepareApiClient(account.id);
    if (!prepared.success || !prepared.client) {
      const loginResult = await this.loginAccountWithApi(account);
      if (!loginResult.success) {
        console.error(`❌ 账号 ${account.username} API 登录失败:`, loginResult.message);
        return { handicapLines: [], overUnderLines: [], halfHandicapLines: [], halfOverUnderLines: [], halfMoneyline: undefined };
      }
      prepared = await this.prepareApiClient(account.id);
      if (!prepared.success || !prepared.client) {
        console.error(`❌ 无法获取账号 ${account.username} 的 API 客户端:`, prepared.message);
        return { handicapLines: [], overUnderLines: [], halfHandicapLines: [], halfOverUnderLines: [], halfMoneyline: undefined };
      }
    }

    const client = prepared.client!;
    try {
      const req: any = {
        gid: String(params.gid),
        gtype,
        showtype,
        ltype,
        isRB,
      };
      if (params.lid) req.lid = String(params.lid);
      const xml = await client.getGameMore(req);

      if (typeof xml !== 'string' || xml.trim() === '') {
        return { handicapLines: [], overUnderLines: [], halfHandicapLines: [], halfOverUnderLines: [], halfMoneyline: undefined };
      }

      const result = this.parseMoreMarketsFromXml(xml);

      // 存入 Redis 缓存
      if (redis.isAvailable()) {
        try {
          // 滚球缓存 2 分钟，今日缓存 5 分钟
          const ttl = showtype === 'live' ? 120 : 300;
          await redis.setex(cacheKey, ttl, JSON.stringify(result));
          console.log(`✅ Redis 缓存已保存: ${params.gid} (TTL: ${ttl}s)`);
        } catch (error) {
          console.error('❌ Redis 写入失败:', error);
        }
      }

      return result;
    } catch (error) {
      console.error('❌ 调用 get_game_more 失败:', error);
      return { handicapLines: [], overUnderLines: [], halfHandicapLines: [], halfOverUnderLines: [] };
    } finally {
      await client.close();
    }
  }

  // 提取 get_game_more XML 中的角球盘口（让球 / 大小）
  async fetchCornerMarkets(params: {
    gid: string;
    lid?: string;
    gtype?: string;
    showtype?: string;
    ltype?: string;
    isRB?: string;
    accountId?: number;
  }): Promise<{ cornerHandicapLines: any[]; cornerOverUnderLines: any[] }> {
    const showtype = (params.showtype || 'live').toLowerCase();
    const gtype = params.gtype || 'ft';
    const ltype = params.ltype || '3';
    const isRB = params.isRB || (showtype === 'live' ? 'Y' : 'N');

    const cacheKey = `crown:corner_markets:${params.gid}:${showtype}:${gtype}`;
    const redis = getRedisClient();

    if (redis.isAvailable()) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const data = JSON.parse(cached);
          return data;
        }
      } catch (error) {
        console.error('❌ Redis 读取角球盘口缓存失败:', error);
      }
    }

    let account: CrownAccount | null = null;
    if (params.accountId) {
      account = await this.loadAccountById(Number(params.accountId));
    } else {
      account = await this.pickAccountForApi();
    }

    if (!account) {
      console.warn('⚠️ 无可用账号获取角球盘口');
      return { cornerHandicapLines: [], cornerOverUnderLines: [] };
    }

    let prepared = await this.prepareApiClient(account.id);
    if (!prepared.success || !prepared.client) {
      const loginResult = await this.loginAccountWithApi(account);
      if (!loginResult.success) {
        console.error(`❌ 账号 ${account.username} API 登录失败（角球盘口）:`, loginResult.message);
        return { cornerHandicapLines: [], cornerOverUnderLines: [] };
      }
      prepared = await this.prepareApiClient(account.id);
      if (!prepared.success || !prepared.client) {
        console.error(`❌ 无法获取账号 ${account.username} 的 API 客户端（角球盘口）:`, prepared.message);
        return { cornerHandicapLines: [], cornerOverUnderLines: [] };
      }
    }

    const client = prepared.client!;
    try {
      const req: any = {
        gid: String(params.gid),
        gtype,
        showtype,
        ltype,
        isRB,
      };
      if (params.lid) req.lid = String(params.lid);
      const xml = await client.getGameMore(req);

      if (typeof xml !== 'string' || xml.trim() === '') {
        return { cornerHandicapLines: [], cornerOverUnderLines: [] };
      }

      const result = this.parseCornerMarketsFromXml(xml);

      if (redis.isAvailable()) {
        try {
          const ttl = showtype === 'live' ? 120 : 300;
          await redis.setex(cacheKey, ttl, JSON.stringify(result));
        } catch (error) {
          console.error('❌ Redis 写入角球盘口缓存失败:', error);
        }
      }

      return result;
    } catch (error) {
      console.error('❌ 调用 get_game_more 获取角球盘口失败:', error);
      return { cornerHandicapLines: [], cornerOverUnderLines: [] };
    } finally {
      await client.close();
    }
  }

  // 辅助方法：从对象中提取字符串值
  private pickString(obj: any, keys: string[]): string {
    if (!obj) return '';
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
        return String(obj[key]).trim();
      }
      const attrKey = `@_${key}`;
      if (obj[attrKey] !== undefined && obj[attrKey] !== null && obj[attrKey] !== '') {
        return String(obj[attrKey]).trim();
      }
      const lowerKey = key.toLowerCase();
      for (const currentKey of Object.keys(obj)) {
        if (currentKey.toLowerCase() === lowerKey || currentKey.toLowerCase() === `@_${lowerKey}`) {
          const value = obj[currentKey];
          if (value !== undefined && value !== null && value !== '') {
            return String(value).trim();
          }
        }
      }
    }
    return '';
  }

  // 解析赛事的盘口数据
  private parseMarketsFromEvent(event: any): any {
    const markets: any = { full: {}, half: {} };

    const pick = (keys: string[]): string => {
      return this.pickString(event, keys);
    };

    const addHandicapLine = (
      target: any[],
      ratioKeys: string[],
      homeKeys: string[],
      awayKeys: string[],
      meta?: {
        wtype?: string;
        homeRtype?: string;
        awayRtype?: string;
        homeChoseTeam?: string;
        awayChoseTeam?: string;
      },
    ) => {
      const line = pick(ratioKeys);
      const home = pick(homeKeys);
      const away = pick(awayKeys);
      if (line || home || away) {
        target.push({
          line,
          home,
          away,
          wtype: meta?.wtype,
          home_rtype: meta?.homeRtype,
          away_rtype: meta?.awayRtype,
          home_chose_team: meta?.homeChoseTeam,
          away_chose_team: meta?.awayChoseTeam,
        });
      }
    };

    const addOverUnderLine = (
      target: any[],
      ratioKeysO: string[],
      ratioKeysU: string[],
      overKeys: string[],
      underKeys: string[],
      meta?: {
        wtype?: string;
        overRtype?: string;
        underRtype?: string;
        overChoseTeam?: string;
        underChoseTeam?: string;
      },
    ) => {
      const overLine = pick(ratioKeysO);
      const underLine = pick(ratioKeysU);
      const line = overLine || underLine;
      const over = pick(overKeys);
      const under = pick(underKeys);
      if (line || over || under) {
        target.push({
          line,
          over,
          under,
          wtype: meta?.wtype,
          over_rtype: meta?.overRtype,
          under_rtype: meta?.underRtype,
          over_chose_team: meta?.overChoseTeam,
          under_chose_team: meta?.underChoseTeam,
        });
      }
    };

    try {
      const moneyline = {
        home: pick(['IOR_RMH', 'IOR_MH']),
        draw: pick(['IOR_RMN', 'IOR_MN', 'IOR_RMD']),
        away: pick(['IOR_RMC', 'IOR_MC']),
      };
      if (moneyline.home || moneyline.draw || moneyline.away) {
        markets.moneyline = { ...moneyline };
        markets.full.moneyline = { ...moneyline };
      }

      const handicapLines: Array<{ line: string; home: string; away: string }> = [];
      addHandicapLine(
        handicapLines,
        ['RATIO_RE', 'RATIO_R'],
        ['IOR_REH', 'IOR_RH'],
        ['IOR_REC', 'IOR_RC'],
        {
          wtype: 'RE',
          homeRtype: 'REH',
          awayRtype: 'REC',
          homeChoseTeam: 'H',
          awayChoseTeam: 'C',
        },
      );
      if (handicapLines.length > 0) {
        markets.handicap = { ...handicapLines[0] };
        markets.full.handicap = { ...handicapLines[0] };
        markets.full.handicapLines = handicapLines;
      }

      const ouLines: Array<{ line: string; over: string; under: string }> = [];
      // 主盘口
      addOverUnderLine(
        ouLines,
        ['RATIO_ROUO', 'RATIO_OUO'],
        ['RATIO_ROUU', 'RATIO_OUU'],
        ['IOR_ROUC', 'IOR_OUC'],
        ['IOR_ROUH', 'IOR_OUH'],
        {
          wtype: 'ROU',
          overRtype: 'ROUC',
          underRtype: 'ROUH',
          overChoseTeam: 'C',
          underChoseTeam: 'H',
        },
      );
      if (ouLines.length > 0) {
        markets.ou = { ...ouLines[0] };
        markets.full.ou = { ...ouLines[0] };
        markets.full.overUnderLines = ouLines;
      }

      const oddEven = {
        odd: pick(['IOR_REOO']),
        even: pick(['IOR_REOE']),
      };
      if (oddEven.odd || oddEven.even) {
        markets.full.oddEven = oddEven;
      }

      const halfMoneyline = {
        home: pick(['IOR_HRMH', 'IOR_HMH']),
        draw: pick(['IOR_HRMN', 'IOR_HMN']),
        away: pick(['IOR_HRMC', 'IOR_HMC']),
      };
      if (halfMoneyline.home || halfMoneyline.draw || halfMoneyline.away) {
        markets.half.moneyline = { ...halfMoneyline };
      }

      const halfHandicapLines: Array<{ line: string; home: string; away: string }> = [];
      addHandicapLine(
        halfHandicapLines,
        ['RATIO_HRE'],
        ['IOR_HREH'],
        ['IOR_HREC'],
        {
          wtype: 'HRE',
          homeRtype: 'HREH',
          awayRtype: 'HREC',
          homeChoseTeam: 'H',
          awayChoseTeam: 'C',
        },
      );
      if (halfHandicapLines.length > 0) {
        markets.half.handicap = { ...halfHandicapLines[0] };
        markets.half.handicapLines = halfHandicapLines;
      }

      const halfOuLines: Array<{ line: string; over: string; under: string }> = [];
      addOverUnderLine(
        halfOuLines,
        ['RATIO_HROUO'],
        ['RATIO_HROUU'],
        ['IOR_HROUH'],
        ['IOR_HROUC'],
        {
          wtype: 'HROU',
          overRtype: 'HROUC',
          underRtype: 'HROUH',
          overChoseTeam: 'C',
          underChoseTeam: 'H',
        },
      );
      if (halfOuLines.length > 0) {
        markets.half.ou = { ...halfOuLines[0] };
        markets.half.overUnderLines = halfOuLines;
      }

      const more = pick(['MORE']);
      if (more) {
        const moreNum = Number(more);
        markets.more = Number.isFinite(moreNum) ? moreNum : more;
      }

      const counts = {
        handicap: pick(['R_COUNT']),
        overUnder: pick(['OU_COUNT']),
        correctScore: pick(['PD_COUNT']),
        corners: pick(['CN_COUNT']),
        winners: pick(['WI_COUNT']),
        specials: pick(['SFS_COUNT']),
        penalties: pick(['PK_COUNT']),
      };
      markets.counts = counts;
    } catch (error) {
      console.error('❌ 解析盘口数据失败:', error);
    }

    if (Object.keys(markets.half).length === 0) {
      delete markets.half;
    }
    if (Object.keys(markets.full).length === 0) {
      delete markets.full;
    }
    return markets;
  }

  /**
   * 获取账号限额信息
   */
  async fetchAccountLimits(account: CrownAccount): Promise<{
    success: boolean;
    message?: string;
    limits?: {
      football: {
        prematch: number;
        live: number;
      };
      basketball: {
        prematch: number;
        live: number;
      };
    };
  }> {
    try {
      console.log(`🔍 开始获取账号 ${account.username} 的限额信息...`);

      // 使用 API 客户端登录
      const apiClient = new CrownApiClient();
      console.log(`🔧 创建 API 客户端成功`);

      const loginResult = await apiClient.login(account.username, account.password);
      console.log(`🔧 登录结果:`, loginResult);

      // 检查登录是否成功（status: '200', msg: '100' 表示成功）
      if (loginResult.status !== '200' || loginResult.msg !== '100') {
        const errorMsg = loginResult.code_message || `status: ${loginResult.status}, msg: ${loginResult.msg}`;
        console.error(`❌ 登录失败: ${errorMsg}`);
        return {
          success: false,
          message: `登录失败: ${errorMsg}`
        };
      }

      console.log(`✅ 登录成功，正在获取首页限额信息...`);
      console.log(`🔧 API 客户端 baseUrl: ${apiClient.getBaseUrl()}`);
      console.log(`🔧 登录 UID: ${loginResult.uid}`);

      // 限额信息直接在首页显示，但登录后首页可能是跳转页面
      // 需要访问会员中心首页：/app/member/FT_browse/index.php
      const homePageUrl = `${apiClient.getBaseUrl()}/app/member/FT_browse/index.php?rtype=r&langx=zh-cn`;
      console.log(`📄 会员中心 URL: ${homePageUrl}`);

      const response = await apiClient.fetch(homePageUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }
      });

      console.log(`📥 会员中心响应状态: ${response.status}, OK: ${response.ok}`);

      if (!response.ok) {
        return {
          success: false,
          message: `获取会员中心失败: HTTP ${response.status}`
        };
      }

      const html = await response.text();
      console.log(`📄 会员中心 HTML 长度: ${html.length} 字符`);

      // 解析 HTML 提取限额数据
      const limits = this.parseLimitsFromHtml(html);

      if (!limits) {
        console.error(`❌ 无法解析限额数据，HTML 前 1000 字符:`, html.substring(0, 1000));
        return {
          success: false,
          message: '无法从会员中心解析限额数据'
        };
      }

      console.log(`✅ 成功获取限额信息:`, limits);

      return {
        success: true,
        limits
      };

    } catch (error) {
      console.error('❌ 获取限额信息失败:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '获取限额信息失败'
      };
    }
  }

  /**
   * 从 HTML 中解析限额数据
   */
  private parseLimitsFromHtml(html: string): {
    football: { prematch: number; live: number };
    basketball: { prematch: number; live: number };
  } | null {
    try {
      // 查找足球限额表格
      const footballMatch = html.match(/足球[\s\S]*?<table[\s\S]*?<\/table>/i);
      if (!footballMatch) {
        console.error('❌ 未找到足球限额表格');
        return null;
      }

      const footballTable = footballMatch[0];

      // 提取足球赛前限额（让球、大小、单双的单注最高）
      const footballPrematchMatch = footballTable.match(/让球,\s*大小,\s*单双[\s\S]*?<td[^>]*>([0-9,]+)<\/td>[\s\S]*?<td[^>]*>([0-9,]+)<\/td>/i);

      // 提取足球滚球限额（滚球让球、滚球大小、滚球单双的单注最高）
      const footballLiveMatch = footballTable.match(/滚球让球,\s*滚球大小,\s*滚球单双[\s\S]*?<td[^>]*>([0-9,]+)<\/td>[\s\S]*?<td[^>]*>([0-9,]+)<\/td>/i);

      // 查找篮球限额表格
      const basketballMatch = html.match(/篮球[\s\S]*?<table[\s\S]*?<\/table>/i);
      if (!basketballMatch) {
        console.error('❌ 未找到篮球限额表格');
        return null;
      }

      const basketballTable = basketballMatch[0];

      // 提取篮球赛前限额
      const basketballPrematchMatch = basketballTable.match(/让球,\s*大小,\s*单双[\s\S]*?<td[^>]*>([0-9,]+)<\/td>[\s\S]*?<td[^>]*>([0-9,]+)<\/td>/i);

      // 提取篮球滚球限额
      const basketballLiveMatch = basketballTable.match(/滚球让球,\s*滚球大小,\s*滚球单双[\s\S]*?<td[^>]*>([0-9,]+)<\/td>[\s\S]*?<td[^>]*>([0-9,]+)<\/td>/i);

      // 解析数值（移除逗号并转换为数字）
      const parseLimit = (value: string | undefined): number => {
        if (!value) return 100000; // 默认值
        return parseInt(value.replace(/,/g, ''), 10) || 100000;
      };

      const limits = {
        football: {
          prematch: footballPrematchMatch ? parseLimit(footballPrematchMatch[2]) : 100000,
          live: footballLiveMatch ? parseLimit(footballLiveMatch[2]) : 100000,
        },
        basketball: {
          prematch: basketballPrematchMatch ? parseLimit(basketballPrematchMatch[2]) : 100000,
          live: basketballLiveMatch ? parseLimit(basketballLiveMatch[2]) : 100000,
        }
      };

      console.log('📊 解析的限额数据:', limits);
      return limits;

    } catch (error) {
      console.error('❌ 解析限额数据失败:', error);
      return null;
    }
  }
}

// 延迟创建单例实例
let crownAutomationInstance: CrownAutomationService | null = null;

export const getCrownAutomation = (): CrownAutomationService => {
  if (!crownAutomationInstance) {
    crownAutomationInstance = new CrownAutomationService();
  }
  return crownAutomationInstance;
};

export default CrownAutomationService;
