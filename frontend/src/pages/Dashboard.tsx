import React, { useState, useEffect } from 'react';
import {
  Layout, Card, Statistic, Row, Col, Table, Button, Tag, Space,
  Typography, message, List, Avatar, Progress, Alert
} from 'antd';
import {
  CrownOutlined, UserOutlined, DollarCircleOutlined,
  RocketOutlined, PlayCircleOutlined, PauseCircleOutlined,
  ReloadOutlined, SettingOutlined, LogoutOutlined
} from '@ant-design/icons';
import axios from 'axios';

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

interface CrownAccount {
  id: number;
  username: string;
  display_name: string;
  balance?: number;
  status: 'online' | 'offline';
  last_login?: string;
}

interface AutomationStatus {
  activeSessionCount: number;
  accounts: CrownAccount[];
  systemStatus: string;
}

const Dashboard: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<CrownAccount[]>([]);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);

  useEffect(() => {
    fetchAutomationStatus();
    const interval = setInterval(fetchAutomationStatus, 10000); // 每10秒刷新
    return () => clearInterval(interval);
  }, []);

  const fetchAutomationStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/crown-automation/status', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setAutomationStatus(response.data.data);
        setAccounts(response.data.data.accounts);
      }
    } catch (error) {
      console.error('获取状态失败:', error);
    }
  };

  const handleLogin = async (accountId: number) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `/api/crown-automation/login/${accountId}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        message.success(`账号 ${accountId} 登录成功`);
        fetchAutomationStatus();
      } else {
        message.error(response.data.error || '登录失败');
      }
    } catch (error) {
      message.error('登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async (accountId: number) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `/api/crown-automation/logout/${accountId}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        message.success(`账号 ${accountId} 登出成功`);
        fetchAutomationStatus();
      } else {
        message.error(response.data.error || '登出失败');
      }
    } catch (error) {
      message.error('登出失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchLogin = async () => {
    const accountIds = accounts.filter(acc => !acc.status || acc.status === 'offline').map(acc => acc.id);
    if (accountIds.length === 0) {
      message.info('没有可登录的账号');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        '/api/crown-automation/batch-login',
        { accountIds },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        message.success(response.data.message);
        fetchAutomationStatus();
      } else {
        message.error(response.data.error || '批量登录失败');
      }
    } catch (error) {
      message.error('批量登录失败');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: '账号名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string, record: CrownAccount) => (
        <Space>
          <Avatar size="small" icon={<UserOutlined />} />
          <div>
            <div style={{ fontWeight: 'bold' }}>{record.display_name}</div>
            <Text type="secondary" style={{ fontSize: '12px' }}>{text}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'online' ? 'green' : 'default'}>
          {status === 'online' ? '在线' : '离线'}
        </Tag>
      ),
    },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
      render: (balance?: number) => (
        <Text strong style={{ color: balance ? '#52c41a' : '#8c8c8c' }}>
          {balance ? `¥${balance.toFixed(2)}` : '未知'}
        </Text>
      ),
    },
    {
      title: '最后登录',
      dataIndex: 'last_login',
      key: 'last_login',
      render: (time?: string) => (
        <Text type="secondary">
          {time ? new Date(time).toLocaleString() : '从未登录'}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: CrownAccount) => (
        <Space size="middle">
          {record.status === 'online' ? (
            <Button
              size="small"
              icon={<PauseCircleOutlined />}
              onClick={() => handleLogout(record.id)}
              loading={loading}
            >
              登出
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => handleLogin(record.id)}
              loading={loading}
            >
              登录
            </Button>
          )}
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setSelectedAccount(record.id)}
          >
            设置
          </Button>
        </Space>
      ),
    },
  ];

  const onlineCount = accounts.filter(acc => acc.status === 'online').length;
  const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <CrownOutlined style={{ fontSize: '24px', color: 'white', marginRight: '12px' }} />
          <Title level={3} style={{ color: 'white', margin: 0 }}>
            智投系统 - 皇冠足球管理平台
          </Title>
        </div>
        <Button
          type="text"
          icon={<LogoutOutlined />}
          style={{ color: 'white' }}
          onClick={() => {
            localStorage.removeItem('token');
            window.location.href = '/';
          }}
        >
          退出登录
        </Button>
      </Header>

      <Layout>
        <Content style={{ margin: '24px 24px 0', overflow: 'initial' }}>
          <Alert
            message="系统运行正常"
            description={`当前有 ${onlineCount} 个皇冠账号在线，系统状态：${automationStatus?.systemStatus || '未知'}`}
            type="success"
            showIcon
            style={{ marginBottom: '24px' }}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={fetchAutomationStatus}>
                刷新状态
              </Button>
            }
          />

          <Row gutter={16} style={{ marginBottom: '24px' }}>
            <Col span={6}>
              <Card>
                <Statistic
                  title="在线账号"
                  value={onlineCount}
                  suffix={`/ ${accounts.length}`}
                  prefix={<UserOutlined />}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="总余额"
                  value={totalBalance}
                  precision={2}
                  prefix={<DollarCircleOutlined />}
                  valueStyle={{ color: '#cf1322' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="活跃会话"
                  value={automationStatus?.activeSessionCount || 0}
                  prefix={<RocketOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="系统状态"
                  value="正常"
                  valueStyle={{ color: '#3f8600' }}
                />
                <Progress
                  percent={100}
                  size="small"
                  showInfo={false}
                  strokeColor="#52c41a"
                  style={{ marginTop: '8px' }}
                />
              </Card>
            </Col>
          </Row>

          <Card
            title="皇冠账号管理"
            extra={
              <Space>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleBatchLogin}
                  loading={loading}
                >
                  批量登录
                </Button>
                <Button icon={<ReloadOutlined />} onClick={fetchAutomationStatus}>
                  刷新
                </Button>
              </Space>
            }
          >
            <Table
              columns={columns}
              dataSource={accounts}
              rowKey="id"
              size="middle"
              pagination={false}
            />
          </Card>
        </Content>
      </Layout>
    </Layout>
  );
};

export default Dashboard;
