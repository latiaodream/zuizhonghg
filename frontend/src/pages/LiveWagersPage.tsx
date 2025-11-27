import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Space, Tag, message, Spin, Empty, Tabs, DatePicker } from 'antd';
import { ReloadOutlined, DollarOutlined, HistoryOutlined, CloudOutlined } from '@ant-design/icons';
import { crownApi } from '../services/api';
import dayjs from 'dayjs';

interface Wager {
  ticket_id?: string;
  league?: string;
  team_h?: string;
  team_c?: string;
  score?: string;
  bet_type?: string;
  bet_team?: string;
  spread?: string;
  odds?: string;
  gold?: string;
  win_gold?: string;
  status?: string;
  wager_time?: string;
  account_id?: number;
  account_username?: string;
}

const LiveWagersPage: React.FC = () => {
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [localWagers, setLocalWagers] = useState<Wager[]>([]);
  const [loading, setLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('live');
  const [selectedDate, setSelectedDate] = useState<dayjs.Dayjs>(dayjs().subtract(1, 'day'));

  const fetchWagers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await crownApi.getAllWagers();
      if (response.success && response.data) {
        setWagers(response.data.wagers || []);
        setLastUpdated(dayjs().format('HH:mm:ss'));
        if (response.data.errors?.length > 0) {
          message.warning(`${response.data.errors.length} 个账号获取失败`);
        }
      } else {
        message.error(response.error || '获取注单失败');
      }
    } catch (error: any) {
      message.error(error.message || '获取注单失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLocalWagers = useCallback(async () => {
    setLocalLoading(true);
    try {
      const response = await crownApi.getLocalWagers({ 
        date: selectedDate.format('YYYY-MM-DD'),
        limit: 200 
      });
      if (response.success && response.data) {
        setLocalWagers(response.data.wagers || []);
      } else {
        message.error(response.error || '获取本地记录失败');
      }
    } catch (error: any) {
      message.error(error.message || '获取本地记录失败');
    } finally {
      setLocalLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (activeTab === 'live') {
      fetchWagers();
      const timer = setInterval(fetchWagers, 30000);
      return () => clearInterval(timer);
    }
  }, [fetchWagers, activeTab]);

  useEffect(() => {
    if (activeTab === 'local') {
      fetchLocalWagers();
    }
  }, [fetchLocalWagers, activeTab]);

  const columns = [
    {
      title: '账号',
      dataIndex: 'account_username',
      key: 'account_username',
      width: 100,
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '联赛',
      dataIndex: 'league',
      key: 'league',
      width: 150,
      ellipsis: true,
    },
    {
      title: '比赛',
      key: 'match',
      width: 200,
      render: (_: any, record: any) => (
        <div>
          <div>{record.team_h_show || record.team_h} vs {record.team_c_show || record.team_c}</div>
          {record.score && <Tag color="red" style={{ marginTop: 2 }}>{record.score}</Tag>}
        </div>
      ),
    },
    {
      title: '投注',
      key: 'bet',
      width: 180,
      render: (_: any, record: any) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.wtype || record.bet_type}</div>
          <div style={{ color: '#1890ff' }}>
            {record.result || record.bet_team} {record.concede || record.spread} @ <span style={{ color: '#52c41a' }}>{record.ioratio || record.odds}</span>
          </div>
        </div>
      ),
    },
    {
      title: '金额',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (_: any, record: any) => (
        <div>
          <div>投注: <b>{record.gold}</b></div>
          <div style={{ color: '#52c41a' }}>可赢: {record.win_gold}</div>
        </div>
      ),
    },
    {
      title: '注单号',
      key: 'ticket_id',
      width: 140,
      render: (_: any, record: any) => <span style={{ fontSize: 11, color: '#666' }}>{record.w_id || record.ticket_id}</span>,
    },
    {
      title: '时间',
      key: 'wager_time',
      width: 100,
      render: (_: any, record: any) => {
        const time = record.addtime || record.adddate || record.wager_time;
        if (!time) return '-';
        // 如果只是时间格式如 "20:41:27"，直接显示
        if (/^\d{2}:\d{2}:\d{2}$/.test(time)) return time;
        return dayjs(time).format('HH:mm:ss');
      },
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: any, record: any) => {
        const status = record.ball_act_ret || record.status;
        if (status === '确认' || status === 'confirmed') {
          return <Tag color="success">已确认</Tag>;
        }
        return <Tag color="processing">{status || '待确认'}</Tag>;
      },
    },
  ];

  const renderTable = (data: Wager[], isLoading: boolean) => {
    if (isLoading && data.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#999' }}>正在获取注单...</div>
        </div>
      );
    }
    if (data.length === 0) {
      return <Empty description="暂无注单记录" />;
    }
    return (
      <Table
        columns={columns}
        dataSource={data}
        rowKey={(record) => record.ticket_id || `${record.account_id}-${Math.random()}`}
        pagination={{ pageSize: 20 }}
        size="small"
        scroll={{ x: 1000 }}
      />
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={
          <Space>
            <DollarOutlined />
            <span>注单记录</span>
          </Space>
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'live',
              label: (
                <span>
                  <CloudOutlined /> 实时获取
                  {lastUpdated && <span style={{ fontSize: 11, color: '#999', marginLeft: 8 }}>({lastUpdated})</span>}
                </span>
              ),
              children: (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <Button
                      type="primary"
                      icon={<ReloadOutlined spin={loading} />}
                      onClick={fetchWagers}
                      loading={loading}
                    >
                      刷新
                    </Button>
                    <span style={{ marginLeft: 16, color: '#666', fontSize: 12 }}>
                      从在线账号实时获取皇冠注单（每30秒自动刷新）
                    </span>
                  </div>
                  {renderTable(wagers, loading)}
                </div>
              ),
            },
            {
              key: 'local',
              label: (
                <span>
                  <HistoryOutlined /> 本地记录
                </span>
              ),
              children: (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <Space>
                      <DatePicker
                        value={selectedDate}
                        onChange={(date) => date && setSelectedDate(date)}
                        allowClear={false}
                      />
                      <Button
                        icon={<ReloadOutlined spin={localLoading} />}
                        onClick={fetchLocalWagers}
                        loading={localLoading}
                      >
                        刷新
                      </Button>
                    </Space>
                    <span style={{ marginLeft: 16, color: '#666', fontSize: 12 }}>
                      显示已保存到本地的注单记录
                    </span>
                  </div>
                  {renderTable(localWagers, localLoading)}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default LiveWagersPage;
