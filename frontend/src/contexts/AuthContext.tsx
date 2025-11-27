import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { User, LoginRequest, RegisterRequest } from '../types';
import { authApi } from '../services/api';
import { message } from 'antd';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<boolean>;
  register: (userData: RegisterRequest) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  // 角色检查工具函数
  isAdmin: boolean;
  isAgent: boolean;
  isStaff: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 角色检查
  const isAdmin = user?.role === 'admin';
  const isAgent = user?.role === 'agent' || user?.role === 'admin';
  const isStaff = !!user; // 所有已认证用户

  // 初始化检查本地存储的token
  useEffect(() => {
    const clearStoredAuth = () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
    };

    const initAuth = async () => {
      const storedToken = localStorage.getItem('token');
      const storedUserRaw = localStorage.getItem('user');

      if (!storedToken || !storedUserRaw) {
        setIsLoading(false);
        return;
      }

      let parsedUser: User | null = null;
      try {
        parsedUser = JSON.parse(storedUserRaw) as User;
      } catch (parseError) {
        console.warn('无法解析本地缓存的用户信息，已清除缓存。', parseError);
        clearStoredAuth();
        setIsLoading(false);
        return;
      }

      setToken(storedToken);
      setUser(parsedUser);

      try {
        // 验证 token 是否仍然有效
        const response = await authApi.getCurrentUser();
        if (response.success && response.data) {
          setUser(response.data);
          localStorage.setItem('user', JSON.stringify(response.data));
        } else if (response.error) {
          console.warn('自动登录校验失败:', response.error);
          clearStoredAuth();
        }
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
          clearStoredAuth();
        } else {
          console.warn('自动登录校验请求失败，保留原登录状态。', error);
        }
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (credentials: LoginRequest): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await authApi.login(credentials);

      if (response.success && response.token && response.user) {
        const newToken = response.token;
        const newUser = response.user;

        // 保存到状态
        setToken(newToken);
        setUser(newUser);

        // 保存到本地存储
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));

        message.success('登录成功');
        return true;
      } else {
        message.error(response.error || '登录失败');
        return false;
      }
    } catch (error: any) {
      console.error('Login error:', error);
      message.error(error.response?.data?.error || '登录失败，请检查网络连接');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: RegisterRequest): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await authApi.register(userData);

      if (response.success && response.token && response.user) {
        const newToken = response.token;
        const newUser = response.user;

        // 保存到状态
        setToken(newToken);
        setUser(newUser);

        // 保存到本地存储
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));

        message.success('注册成功');
        return true;
      } else {
        message.error(response.error || '注册失败');
        return false;
      }
    } catch (error: any) {
      console.error('Register error:', error);
      message.error(error.response?.data?.error || '注册失败，请检查网络连接');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    message.success('已退出登录');
  };

  const isAuthenticated = !!user && !!token;

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    login,
    register,
    logout,
    isAuthenticated,
    isAdmin,
    isAgent,
    isStaff,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
