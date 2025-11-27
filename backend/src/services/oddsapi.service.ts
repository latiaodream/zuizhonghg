import axios from 'axios';
import { query } from '../models/database';

const ODDSAPI_BASE_URL = 'https://api.odds-api.io/v3';
const ODDSAPI_KEY = '17b831ef959c4e44e4c1e587ee60364ee91b3baac528894b83be1aa017d14620';

interface OddsApiEvent {
    id: number;
    home: string;
    away: string;
    date: string;
    sport: {
        name: string;
        slug: string;
    };
    league: {
        name: string;
        slug: string;
    };
    status: string;
    scores?: {
        home: number;
        away: number;
    };
}

interface OddsApiOdds {
    id: number;
    home: string;
    away: string;
    date: string;
    sport: {
        name: string;
        slug: string;
    };
    league: {
        name: string;
        slug: string;
    };
    status: string;
    bookmakers: {
        [bookmaker: string]: Array<{
            name: string;
            updatedAt: string;
            odds: Array<{
                home?: string;
                draw?: string;
                away?: string;
                hdp?: number;
            }>;
        }>;
    };
}

export class OddsApiService {
    /**
     * 获取所有支持的运动项目
     */
    static async getSports(): Promise<any[]> {
        try {
            const response = await axios.get(`${ODDSAPI_BASE_URL}/sports`, {
                params: { apiKey: ODDSAPI_KEY }
            });
            return response.data;
        } catch (error: any) {
            console.error('❌ 获取运动项目失败:', error.message);
            throw error;
        }
    }

    /**
     * 获取赛事列表
     */
    static async getEvents(sport: string = 'football', limit: number = 1000): Promise<OddsApiEvent[]> {
        try {
            console.log(`📥 正在获取 ${sport} 赛事列表 (limit: ${limit})...`);
            const response = await axios.get(`${ODDSAPI_BASE_URL}/events`, {
                params: {
                    apiKey: ODDSAPI_KEY,
                    sport,
                    limit
                }
            });
            console.log(`✅ 获取到 ${response.data.length} 场赛事`);
            return response.data;
        } catch (error: any) {
            console.error('❌ 获取赛事列表失败:', error.message);
            throw error;
        }
    }

    /**
     * 获取单个赛事的赔率
     */
    static async getEventOdds(eventId: number): Promise<OddsApiOdds | null> {
        try {
            const response = await axios.get(`${ODDSAPI_BASE_URL}/odds`, {
                params: {
                    apiKey: ODDSAPI_KEY,
                    eventId,
                    bookmakers: 'Crown'
                }
            });
            return response.data;
        } catch (error: any) {
            console.error(`❌ 获取赛事 ${eventId} 赔率失败:`, error.message);
            return null;
        }
    }

    /**
     * 保存赛事到数据库
     */
    static async saveEvent(event: OddsApiEvent): Promise<void> {
        try {
            await query(
                `INSERT INTO oddsapi_events (
                    id, home, away, date, sport_name, sport_slug, 
                    league_name, league_slug, status, home_score, away_score, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    home = EXCLUDED.home,
                    away = EXCLUDED.away,
                    date = EXCLUDED.date,
                    sport_name = EXCLUDED.sport_name,
                    sport_slug = EXCLUDED.sport_slug,
                    league_name = EXCLUDED.league_name,
                    league_slug = EXCLUDED.league_slug,
                    status = EXCLUDED.status,
                    home_score = EXCLUDED.home_score,
                    away_score = EXCLUDED.away_score,
                    updated_at = NOW()`,
                [
                    event.id,
                    event.home,
                    event.away,
                    event.date,
                    event.sport.name,
                    event.sport.slug,
                    event.league.name,
                    event.league.slug,
                    event.status,
                    event.scores?.home || 0,
                    event.scores?.away || 0
                ]
            );
        } catch (error: any) {
            console.error(`❌ 保存赛事 ${event.id} 失败:`, error.message);
            throw error;
        }
    }

    /**
     * 保存赔率到数据库
     */
    static async saveOdds(oddsData: OddsApiOdds): Promise<void> {
        try {
            const bookmakers = oddsData.bookmakers;
            
            for (const [bookmaker, markets] of Object.entries(bookmakers)) {
                for (const market of markets) {
                    const odds = market.odds[0]; // 取第一个赔率
                    
                    if (market.name === 'ML') {
                        // 独赢
                        await query(
                            `INSERT INTO oddsapi_odds (
                                event_id, bookmaker, market_name, updated_at,
                                ml_home, ml_draw, ml_away
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (event_id, bookmaker, market_name) DO UPDATE SET
                                updated_at = EXCLUDED.updated_at,
                                ml_home = EXCLUDED.ml_home,
                                ml_draw = EXCLUDED.ml_draw,
                                ml_away = EXCLUDED.ml_away`,
                            [
                                oddsData.id,
                                bookmaker,
                                market.name,
                                market.updatedAt,
                                odds.home ? parseFloat(odds.home) : null,
                                odds.draw ? parseFloat(odds.draw) : null,
                                odds.away ? parseFloat(odds.away) : null
                            ]
                        );
                    } else if (market.name === 'Spread') {
                        // 让球
                        await query(
                            `INSERT INTO oddsapi_odds (
                                event_id, bookmaker, market_name, updated_at,
                                spread_hdp, spread_home, spread_away
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (event_id, bookmaker, market_name) DO UPDATE SET
                                updated_at = EXCLUDED.updated_at,
                                spread_hdp = EXCLUDED.spread_hdp,
                                spread_home = EXCLUDED.spread_home,
                                spread_away = EXCLUDED.spread_away`,
                            [
                                oddsData.id,
                                bookmaker,
                                market.name,
                                market.updatedAt,
                                odds.hdp || null,
                                odds.home ? parseFloat(odds.home) : null,
                                odds.away ? parseFloat(odds.away) : null
                            ]
                        );
                    } else if (market.name === 'Totals') {
                        // 大小球
                        await query(
                            `INSERT INTO oddsapi_odds (
                                event_id, bookmaker, market_name, updated_at,
                                totals_hdp, totals_over, totals_under
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (event_id, bookmaker, market_name) DO UPDATE SET
                                updated_at = EXCLUDED.updated_at,
                                totals_hdp = EXCLUDED.totals_hdp,
                                totals_over = EXCLUDED.totals_over,
                                totals_under = EXCLUDED.totals_under`,
                            [
                                oddsData.id,
                                bookmaker,
                                market.name,
                                market.updatedAt,
                                odds.hdp || null,
                                odds.home ? parseFloat(odds.home) : null,
                                odds.away ? parseFloat(odds.away) : null
                            ]
                        );
                    }
                }
            }
        } catch (error: any) {
            console.error(`❌ 保存赔率失败:`, error.message);
            throw error;
        }
    }

    /**
     * 同步赛事和赔率数据
     */
    static async syncData(sport: string = 'football'): Promise<{ events: number; odds: number }> {
        console.log(`\n🔄 开始同步 ${sport} 数据...`);
        
        try {
            // 1. 获取赛事列表
            const events = await this.getEvents(sport);
            console.log(`📊 获取到 ${events.length} 场赛事`);
            
            let savedEvents = 0;
            let savedOdds = 0;
            
            // 2. 保存赛事
            for (const event of events) {
                await this.saveEvent(event);
                savedEvents++;
            }
            console.log(`✅ 保存了 ${savedEvents} 场赛事`);
            
            // 3. 获取并保存赔率（批量处理，每次10个）
            const batchSize = 10;
            for (let i = 0; i < events.length; i += batchSize) {
                const batch = events.slice(i, i + batchSize);
                const oddsPromises = batch.map(event => this.getEventOdds(event.id));
                const oddsResults = await Promise.all(oddsPromises);
                
                for (const oddsData of oddsResults) {
                    if (oddsData && oddsData.bookmakers && Object.keys(oddsData.bookmakers).length > 0) {
                        await this.saveOdds(oddsData);
                        savedOdds++;
                    }
                }
                
                console.log(`📈 进度: ${Math.min(i + batchSize, events.length)}/${events.length} (已保存 ${savedOdds} 场赔率)`);
                
                // 避免请求过快
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log(`✅ 同步完成: ${savedEvents} 场赛事, ${savedOdds} 场赔率\n`);
            
            return { events: savedEvents, odds: savedOdds };
        } catch (error: any) {
            console.error('❌ 同步数据失败:', error.message);
            throw error;
        }
    }
}

