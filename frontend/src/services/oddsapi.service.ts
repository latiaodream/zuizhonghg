import axios from 'axios';
import type { OddsApiEvent, OddsApiLeague, OddsApiStats } from '../types/oddsapi.types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export type { OddsApiEvent, OddsApiLeague, OddsApiStats };

class OddsApiService {
    /**
     * 获取赛事列表
     */
    async getEvents(params?: {
        sport?: string;
        league?: string;
        status?: string;
        limit?: number;
        offset?: number;
    }): Promise<{ success: boolean; data: OddsApiEvent[]; total: number }> {
        const response = await axios.get(`${API_BASE_URL}/oddsapi/events`, {
            params,
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });
        return response.data;
    }

    /**
     * 获取单个赛事详情
     */
    async getEvent(id: number): Promise<{ success: boolean; data: OddsApiEvent }> {
        const response = await axios.get(`${API_BASE_URL}/oddsapi/events/${id}`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });
        return response.data;
    }

    /**
     * 获取联赛列表
     */
    async getLeagues(sport: string = 'football'): Promise<{ success: boolean; data: OddsApiLeague[] }> {
        const response = await axios.get(`${API_BASE_URL}/oddsapi/leagues`, {
            params: { sport },
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });
        return response.data;
    }

    /**
     * 手动触发数据同步
     */
    async syncData(sport: string = 'football'): Promise<{ success: boolean; message: string }> {
        const response = await axios.post(
            `${API_BASE_URL}/oddsapi/sync`,
            { sport },
            {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            }
        );
        return response.data;
    }

    /**
     * 获取统计信息
     */
    async getStats(): Promise<{ success: boolean; data: OddsApiStats }> {
        const response = await axios.get(`${API_BASE_URL}/oddsapi/stats`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
            }
        });
        return response.data;
    }
}

export default new OddsApiService();

