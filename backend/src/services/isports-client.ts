/**
 * iSportsAPI 客户端
 * 用于获取皇冠赔率数据
 */

import axios, { AxiosInstance } from 'axios';

export interface ISportsMatch {
  matchId: string;
  leagueId: string;
  leagueName: string;
  leagueShortName: string;
  matchTime: number;
  status: number;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  homeHalfScore: number;
  awayHalfScore: number;
}

export interface ISportsHandicap {
  matchId: string;
  companyId: string;
  initialHandicap: string;
  initialHome: string;
  initialAway: string;
  instantHandicap: string;
  instantHome: string;
  instantAway: string;
  maintenance: boolean;
  inPlay: boolean;
  changeTime: number;
  close: boolean;
}

export interface ISportsEuropeOdds {
  matchId: string;
  companyId: string;
  initialHome: string;
  initialDraw: string;
  initialAway: string;
  instantHome: string;
  instantDraw: string;
  instantAway: string;
  changeTime: number;
  close: boolean;
}

export interface ISportsOverUnder {
  matchId: string;
  companyId: string;
  initialHandicap: string;
  initialOver: string;
  initialUnder: string;
  instantHandicap: string;
  instantOver: string;
  instantUnder: string;
  changeTime: number;
  close: boolean;
}

export interface ISportsOddsData {
  handicap: ISportsHandicap[];
  europeOdds: ISportsEuropeOdds[];
  overUnder: ISportsOverUnder[];
  handicapHalf?: ISportsHandicap[];
  overUnderHalf?: ISportsOverUnder[];
}

export class ISportsClient {
  private apiKey: string;
  private baseUrl: string;
  private client: AxiosInstance;

  constructor(apiKey: string, baseUrl: string = 'http://api.isportsapi.com/sport/football') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
    });
  }

  /**
   * 获取赛程
   */
  async getSchedule(date?: string): Promise<ISportsMatch[]> {
    try {
      const dateParam = date || new Date().toISOString().split('T')[0];
      const response = await this.client.get('/schedule/basic', {
        params: {
          api_key: this.apiKey,
          date: dateParam,
        },
      });

      if (response.data.code === 0) {
        return response.data.data;
      } else {
        throw new Error(`获取赛程失败: ${response.data.message}`);
      }
    } catch (error: any) {
      console.error('获取赛程失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取主盘口赔率
   * @param matchIds 可选，指定比赛ID列表
   * @param companyIds 可选，指定博彩公司ID列表（默认只获取皇冠 companyId=3）
   */
  async getMainOdds(matchIds?: string[], companyIds: string[] = ['3']): Promise<ISportsOddsData> {
    try {
      const params: any = {
        api_key: this.apiKey,
      };

      if (matchIds && matchIds.length > 0) {
        params.matchId = matchIds.join(',');
      }

      if (companyIds && companyIds.length > 0) {
        params.companyId = companyIds.join(',');
      }

      const response = await this.client.get('/odds/main', { params });

      if (response.data.code === 0) {
        const data = response.data.data;
        return {
          handicap: this.parseHandicap(data.handicap || []),
          europeOdds: this.parseEuropeOdds(data.europeOdds || []),
          overUnder: this.parseOverUnder(data.overUnder || []),
          handicapHalf: this.parseHandicap(data.handicapHalf || []),
          overUnderHalf: this.parseOverUnder(data.overUnderHalf || []),
        };
      } else {
        throw new Error(`获取赔率失败: ${response.data.message}`);
      }
    } catch (error: any) {
      console.error('获取赔率失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取实时赔率变化（过去 20 秒内变化的赔率）
   * 用于实时更新赔率数据
   * @param matchIds 可选，指定比赛ID列表
   * @param companyIds 可选，指定博彩公司ID列表（默认只获取皇冠 companyId=3）
   */
  async getOddsChanges(matchIds?: string[], companyIds: string[] = ['3']): Promise<ISportsOddsData> {
    try {
      const params: any = {
        api_key: this.apiKey,
      };

      if (matchIds && matchIds.length > 0) {
        params.matchId = matchIds.join(',');
      }

      if (companyIds && companyIds.length > 0) {
        params.companyId = companyIds.join(',');
      }

      const response = await this.client.get('/odds/main/changes', { params });

      if (response.data.code === 0) {
        const data = response.data.data;
        return {
          handicap: this.parseHandicap(data.handicap || []),
          europeOdds: this.parseEuropeOdds(data.europeOdds || []),
          overUnder: this.parseOverUnder(data.overUnder || []),
          handicapHalf: this.parseHandicap(data.handicapHalf || []),
          overUnderHalf: this.parseOverUnder(data.overUnderHalf || []),
        };
      } else {
        throw new Error(`获取赔率变化失败: ${response.data.message}`);
      }
    } catch (error: any) {
      console.error('获取赔率变化失败:', error.message);
      throw error;
    }
  }

  /**
   * 解析让球盘数据
   */
  private parseHandicap(data: string[]): ISportsHandicap[] {
    return data.map((item) => {
      const parts = item.split(',');
      return {
        matchId: parts[0],
        companyId: parts[1],
        initialHandicap: parts[2],
        initialHome: parts[3],
        initialAway: parts[4],
        instantHandicap: parts[5],
        instantHome: parts[6],
        instantAway: parts[7],
        maintenance: parts[8] === 'true',
        inPlay: parts[9] === 'true',
        changeTime: parseInt(parts[10]),
        close: parts[11] === 'true',
      };
    });
  }

  /**
   * 解析独赢盘数据
   */
  private parseEuropeOdds(data: string[]): ISportsEuropeOdds[] {
    return data.map((item) => {
      const parts = item.split(',');
      return {
        matchId: parts[0],
        companyId: parts[1],
        initialHome: parts[2],
        initialDraw: parts[3],
        initialAway: parts[4],
        instantHome: parts[5],
        instantDraw: parts[6],
        instantAway: parts[7],
        changeTime: parseInt(parts[8]),
        close: parts[9] === 'true',
      };
    });
  }

  /**
   * 解析大小球数据
   */
  private parseOverUnder(data: string[]): ISportsOverUnder[] {
    return data.map((item) => {
      const parts = item.split(',');
      return {
        matchId: parts[0],
        companyId: parts[1],
        initialHandicap: parts[2],
        initialOver: parts[3],
        initialUnder: parts[4],
        instantHandicap: parts[5],
        instantOver: parts[6],
        instantUnder: parts[7],
        changeTime: parseInt(parts[8]),
        close: parts[9] === 'true',
      };
    });
  }

  /**
   * 转换为皇冠 API 格式
   * 用于兼容现有系统
   */
  convertToCrownFormat(match: ISportsMatch, odds: ISportsOddsData) {
    // 查找该比赛的皇冠赔率
    const handicap = odds.handicap.find((h) => h.matchId === match.matchId && h.companyId === '3');
    const europeOdds = odds.europeOdds.find((e) => e.matchId === match.matchId && e.companyId === '3');
    const overUnder = odds.overUnder.find((o) => o.matchId === match.matchId && o.companyId === '3');
    const handicapHalf = odds.handicapHalf?.find((h) => h.matchId === match.matchId && h.companyId === '3');
    const overUnderHalf = odds.overUnderHalf?.find((o) => o.matchId === match.matchId && o.companyId === '3');

    return {
      // 基本信息
      gid: match.matchId,
      league: match.leagueName,
      team_h: match.homeName,
      team_c: match.awayName,
      timer: new Date(match.matchTime * 1000).toISOString(),
      
      // 让球盘
      ratio: handicap?.instantHandicap || '0',
      ratio_o: handicap?.instantHome || '0',
      ratio_u: handicap?.instantAway || '0',
      
      // 独赢盘
      ior_RH: europeOdds?.instantHome || '0',
      ior_RN: europeOdds?.instantDraw || '0',
      ior_RC: europeOdds?.instantAway || '0',
      
      // 大小球
      ratio_uo: overUnder?.instantHandicap || '0',
      ratio_uo_o: overUnder?.instantOver || '0',
      ratio_uo_u: overUnder?.instantUnder || '0',
      
      // 半场让球盘
      ratio_h: handicapHalf?.instantHandicap || '0',
      ratio_ho: handicapHalf?.instantHome || '0',
      ratio_hu: handicapHalf?.instantAway || '0',
      
      // 半场大小球
      ratio_huo: overUnderHalf?.instantHandicap || '0',
      ratio_huo_o: overUnderHalf?.instantOver || '0',
      ratio_huo_u: overUnderHalf?.instantUnder || '0',
      
      // 状态
      more: 1, // 有更多盘口
      strong: parseFloat(handicap?.instantHandicap || '0') > 0 ? 'H' : 'C',
    };
  }
}

