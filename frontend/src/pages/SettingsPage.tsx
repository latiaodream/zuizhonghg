import React, { useState, useEffect } from 'react';
import {
  Card,
  Descriptions,
  Button,
  Modal,
  Form,
  Input,
  message,
  Spin,
  Row,
  Col,
  Statistic,
} from 'antd';
import { LockOutlined, UserOutlined, MailOutlined, DollarOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../services/api';

interface UserCoins {
  balance: number;
  currency: string;
}

const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [coinsLoading, setCoinsLoading] = useState(true);
  const [userCoins, setUserCoins] = useState<UserCoins>({
    balance: 0,
    currency: 'CNY',
  });
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadUserCoins();
  }, []);

  const loadUserCoins = async () => {
    try {
      setCoinsLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/coins/balance', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (data.success && data.data) {
        setUserCoins({
          balance: data.data.balance || 0,
          currency: data.data.currency || 'CNY',
        });
      }
    } catch (error: any) {
      console.error('加载金币余额失败:', error);
    } finally {
      setCoinsLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const response = await authApi.changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });

      if (response.success) {
        message.success('密码修改成功，请重新登录', 2);
        setPasswordModalVisible(false);
        form.resetFields();

        // 延迟2秒后自动退出登录
        setTimeout(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          window.location.href = '/login';
        }, 2000);
      } else {
        message.error(response.error || '密码修改失败');
      }
    } catch (error: any) {
      console.error('修改密码失败:', error);
      if (error.errorFields) {
        message.error('请检查表单填写');
      } else {
        message.error(error.response?.data?.error || '密码修改失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const getRoleLabel = (role?: string) => {
    switch (role) {
      case 'admin':
        return '超级管理员';
      case 'agent':
        return '代理';
      case 'staff':
        return '员工';
      default:
        return '未知';
    }
  };

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 8px' }}>
      <Row gutter={[16, 16]}>
        {/* 账号信息卡片 */}
        <Col xs={24} lg={16}>
          <Card
            title="账号信息"
            extra={
              <Button
                type="primary"
                icon={<LockOutlined />}
                onClick={() => setPasswordModalVisible(true)}
              >
                修改密码
              </Button>
            }
          >
            <Descriptions column={1} bordered>
              <Descriptions.Item label="账号" labelStyle={{ width: '120px' }}>
                <UserOutlined style={{ marginRight: 8 }} />
                {user.username}
              </Descriptions.Item>
              <Descriptions.Item label="类型">
                {getRoleLabel(user.role)}
              </Descriptions.Item>
              <Descriptions.Item label="邮箱">
                <MailOutlined style={{ marginRight: 8 }} />
                {user.email}
              </Descriptions.Item>
              <Descriptions.Item label="金币">
                <DollarOutlined style={{ marginRight: 8 }} />
                {coinsLoading ? (
                  <Spin size="small" />
                ) : (
                  <>
                    ¥{userCoins.balance.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        {/* 金币统计卡片 */}
        <Col xs={24} lg={8}>
          <Card title="金币余额" loading={coinsLoading}>
            <Statistic
              title="当前金币"
              value={userCoins.balance}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 修改密码模态框 */}
      <Modal
        title="修改密码"
        open={passwordModalVisible}
        onOk={handlePasswordChange}
        onCancel={() => {
          setPasswordModalVisible(false);
          form.resetFields();
        }}
        confirmLoading={loading}
      >
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="旧密码"
            name="oldPassword"
            rules={[
              { required: true, message: '请输入旧密码' },
            ]}
          >
            <Input.Password placeholder="请输入旧密码" />
          </Form.Item>

          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少6个字符' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>

          <Form.Item
            label="确认新密码"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SettingsPage;
