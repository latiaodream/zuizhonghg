import axios from 'axios';
import type { ApiResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const verificationApi = {
  /**
   * 发送验证码
   */
  sendVerificationCode: async (
    userId: number,
    email: string,
    type: 'email_binding' | 'login_verification'
  ): Promise<ApiResponse<{ code?: string }>> => {
    const response = await axios.post(`${API_BASE_URL}/auth/send-verification-code`, {
      userId,
      email,
      type,
    });
    return response.data;
  },

  /**
   * 绑定邮箱
   */
  bindEmail: async (
    userId: number,
    email: string,
    verificationCode: string
  ): Promise<ApiResponse> => {
    const response = await axios.post(`${API_BASE_URL}/auth/bind-email`, {
      userId,
      email,
      verificationCode,
    });
    return response.data;
  },

  /**
   * 获取登录历史
   */
  getLoginHistory: async (limit: number = 10): Promise<ApiResponse<any[]>> => {
    const token = localStorage.getItem('token');
    const response = await axios.get(`${API_BASE_URL}/auth/login-history`, {
      params: { limit },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  },
};

