import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, Space, Divider } from 'antd';
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import type { RegisterRequest } from '../../types';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

interface RegisterFormProps {
  onSwitchToLogin: () => void;
}

const RegisterForm: React.FC<RegisterFormProps> = ({ onSwitchToLogin }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (values: RegisterRequest & { confirmPassword: string }) => {
    setLoading(true);
    const { confirmPassword, ...registerData } = values;
    const success = await register(registerData);
    setLoading(false);

    if (success) {
      navigate('/dashboard', { replace: true });
    }
  };

  return (
    <Card
      style={{
        width: 400,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      }}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <Title level={2} style={{ margin: 0, color: '#1890ff' }}>
            注册账号
          </Title>
          <Text type="secondary">创建您的智投系统账号</Text>
        </div>

        <Form
          form={form}
          name="register"
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, message: '用户名至少3个字符' },
              { max: 20, message: '用户名最多20个字符' },
              { pattern: /^[a-zA-Z0-9_]+$/, message: '用户名只能包含字母、数字和下划线' },
            ]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#94A3B8', marginRight: '8px' }} />}
              placeholder="请输入用户名"
              size="large"
              style={{ paddingLeft: '12px' }}
            />
          </Form.Item>

          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: '#94A3B8', marginRight: '8px' }} />}
              placeholder="请输入邮箱"
              size="large"
              style={{ paddingLeft: '12px' }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少6个字符' },
              { pattern: /^(?=.*[a-zA-Z])(?=.*\d)/, message: '密码必须包含字母和数字' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94A3B8', marginRight: '8px' }} />}
              placeholder="请输入密码"
              size="large"
              style={{ paddingLeft: '12px' }}
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#94A3B8', marginRight: '8px' }} />}
              placeholder="请再次输入密码"
              size="large"
              style={{ paddingLeft: '12px' }}
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              loading={loading}
              style={{ width: '100%' }}
            >
              注册
            </Button>
          </Form.Item>
        </Form>

        <Divider>
          <Text type="secondary">已有账号？</Text>
        </Divider>

        <Button
          type="link"
          size="large"
          onClick={onSwitchToLogin}
          style={{ width: '100%' }}
        >
          立即登录
        </Button>
      </Space>
    </Card>
  );
};

export default RegisterForm;
