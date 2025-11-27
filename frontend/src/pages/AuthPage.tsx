import React from 'react';
import { Typography } from 'antd';
import { Navigate } from 'react-router-dom';
import { RadarChartOutlined } from '@ant-design/icons';
import LoginForm from '../components/Auth/LoginForm';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

const AuthPage: React.FC = () => {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
      padding: '16px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '380px',
        background: '#FFFFFF',
        borderRadius: '16px',
        padding: '32px 24px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            width: '56px',
            height: '56px',
            margin: '0 auto 16px',
            background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 20px rgba(79, 70, 229, 0.3)',
          }}>
            <RadarChartOutlined style={{ fontSize: '28px', color: '#FFFFFF' }} />
          </div>
          <Title level={3} style={{
            color: '#111827',
            marginBottom: '4px',
            fontSize: '22px',
            fontWeight: 700
          }}>
            智投系统
          </Title>
          <Text style={{ color: '#6B7280', fontSize: '14px' }}>
            登录您的账号
          </Text>
        </div>

        {/* Login Form */}
        <LoginForm />
      </div>
    </div>
  );
};

export default AuthPage;
