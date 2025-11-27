import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore - opencc-js 没有类型定义
import { Converter } from 'opencc-js';

/**
 * iSportsAPI 语言包服务
 * 用于获取繁体中文的联赛、球队、球员名称
 */

interface LanguageData {
  leagues?: Array<{
    leagueId: string;
    name_tc: string;
  }>;
  teams?: Array<{
    teamId: string;
    name_tc: string;
  }>;
  players?: Array<{
    playerId: string;
    name_tc: string;
  }>;
}

interface LanguageCache {
  leagues: Map<string, string>; // leagueId -> name_tc
  teams: Map<string, string>;   // teamId -> name_tc
  players: Map<string, string>; // playerId -> name_tc
  lastUpdated: number;
}

export class ISportsLanguageService {
  private apiKey: string;
  private baseUrl: string;
  private client: AxiosInstance;
  private cache: LanguageCache;
  private cacheFile: string;
  private cacheExpiry: number = 24 * 60 * 60 * 1000; // 24小时
  private converter: any; // 繁简转换器

  constructor(apiKey: string, cacheDir: string = './data') {
    this.apiKey = apiKey;
    this.baseUrl = 'http://api.isportsapi.com/sport';
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
    });

    this.cacheFile = path.join(cacheDir, 'language-cache.json');
    this.cache = {
      leagues: new Map(),
      teams: new Map(),
      players: new Map(),
      lastUpdated: 0,
    };

    // 初始化繁简转换器（繁体转简体）
    this.converter = Converter({ from: 'tw', to: 'cn' });

    // 确保缓存目录存在
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // 加载缓存
    this.loadCache();
  }

  /**
   * 从文件加载缓存
   */
  private loadCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
        this.cache.leagues = new Map(data.leagues || []);
        this.cache.teams = new Map(data.teams || []);
        this.cache.players = new Map(data.players || []);
        this.cache.lastUpdated = data.lastUpdated || 0;
        console.log(`✅ 已加载语言包缓存: ${this.cache.leagues.size} 联赛, ${this.cache.teams.size} 球队`);
      }
    } catch (error: any) {
      console.error('⚠️  加载语言包缓存失败:', error.message);
    }
  }

  /**
   * 保存缓存到文件
   */
  private saveCache(): void {
    try {
      const data = {
        leagues: Array.from(this.cache.leagues.entries()),
        teams: Array.from(this.cache.teams.entries()),
        players: Array.from(this.cache.players.entries()),
        lastUpdated: this.cache.lastUpdated,
      };
      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`💾 已保存语言包缓存: ${this.cache.leagues.size} 联赛, ${this.cache.teams.size} 球队`);
    } catch (error: any) {
      console.error('⚠️  保存语言包缓存失败:', error.message);
    }
  }

  /**
   * 检查缓存是否过期
   */
  private isCacheExpired(): boolean {
    const now = Date.now();
    return now - this.cache.lastUpdated > this.cacheExpiry;
  }

  /**
   * 获取繁体中文语言包数据
   */
  async fetchLanguageData(): Promise<LanguageData | null> {
    try {
      console.log('📥 获取繁体中文语言包...');
      const response = await this.client.get('/languagetc', {
        params: {
          api_key: this.apiKey,
          sport: 'football',
        },
      });

      if (response.data.code === 0) {
        // API 返回的 data 是数组，第一个元素包含 leagues, teams, players
        const dataArray = response.data.data;
        if (Array.isArray(dataArray) && dataArray.length > 0) {
          const data = dataArray[0];
          console.log(`✅ 获取成功: ${data.leagues?.length || 0} 联赛, ${data.teams?.length || 0} 球队, ${data.players?.length || 0} 球员`);
          return data;
        } else {
          console.error('❌ 语言包数据格式错误:', response.data);
          return null;
        }
      } else {
        console.error('❌ 获取语言包失败:', response.data);
        return null;
      }
    } catch (error: any) {
      console.error('❌ 获取语言包失败:', error.message);
      return null;
    }
  }

  /**
   * 更新缓存
   */
  async updateCache(): Promise<boolean> {
    const data = await this.fetchLanguageData();
    if (!data) {
      return false;
    }

    // 更新联赛缓存
    if (data.leagues) {
      this.cache.leagues.clear();
      for (const league of data.leagues) {
        this.cache.leagues.set(league.leagueId, league.name_tc);
      }
    }

    // 更新球队缓存
    if (data.teams) {
      this.cache.teams.clear();
      for (const team of data.teams) {
        this.cache.teams.set(team.teamId, team.name_tc);
      }
    }

    // 更新球员缓存
    if (data.players) {
      this.cache.players.clear();
      for (const player of data.players) {
        this.cache.players.set(player.playerId, player.name_tc);
      }
    }

    this.cache.lastUpdated = Date.now();
    this.saveCache();
    return true;
  }

  /**
   * 确保缓存可用（如果过期则更新）
   */
  async ensureCache(): Promise<void> {
    if (this.cache.leagues.size === 0 || this.isCacheExpired()) {
      console.log('🔄 语言包缓存过期或为空，正在更新...');
      await this.updateCache();
    }
  }

  /**
   * 获取联赛的繁体中文名称
   */
  getLeagueName(leagueId: string): string | null {
    return this.cache.leagues.get(leagueId) || null;
  }

  /**
   * 获取球队的繁体中文名称
   */
  getTeamName(teamId: string): string | null {
    return this.cache.teams.get(teamId) || null;
  }

  /**
   * 获取球队的简体中文名称（繁体转简体）
   */
  getTeamNameSimplified(teamId: string): string | null {
    const traditionalName = this.cache.teams.get(teamId);
    if (!traditionalName) return null;
    return this.converter(traditionalName);
  }

  /**
   * 根据英文名称查找简体中文名称
   * 遍历所有球队，返回第一个匹配的简体中文名称
   */
  findTeamNameByEnglishName(englishName: string): string | null {
    // 由于语言包只有 teamId -> name_tc 的映射
    // 我们需要从赛程数据中获取 teamId，然后查找中文名称
    // 这个方法在映射脚本中会被优化使用
    return null;
  }

  /**
   * 获取所有球队的简体中文名称（用于映射脚本）
   */
  getAllTeamsSimplified(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [teamId, traditionalName] of this.cache.teams.entries()) {
      result.set(teamId, this.converter(traditionalName));
    }
    return result;
  }

  /**
   * 获取球员的繁体中文名称
   */
  getPlayerName(playerId: string): string | null {
    return this.cache.players.get(playerId) || null;
  }

  /**
   * 批量获取球队名称
   */
  getTeamNames(teamIds: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const teamId of teamIds) {
      const name = this.getTeamName(teamId);
      if (name) {
        result.set(teamId, name);
      }
    }
    return result;
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return {
      leagues: this.cache.leagues.size,
      teams: this.cache.teams.size,
      players: this.cache.players.size,
      lastUpdated: new Date(this.cache.lastUpdated).toISOString(),
      isExpired: this.isCacheExpired(),
    };
  }
}

// 单例实例
let languageServiceInstance: ISportsLanguageService | null = null;

/**
 * 获取语言包服务实例
 */
export function getLanguageService(apiKey?: string, cacheDir?: string): ISportsLanguageService {
  if (!languageServiceInstance) {
    if (!apiKey) {
      throw new Error('首次调用需要提供 API Key');
    }
    languageServiceInstance = new ISportsLanguageService(apiKey, cacheDir);
  }
  return languageServiceInstance;
}

