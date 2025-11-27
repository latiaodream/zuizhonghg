import React, { useState, useEffect } from 'react';
import {
  Row,
  Col,
  Card,
  Statistic,
  DatePicker,
  Select,
  Button,
  Space,
  Spin,
  message,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { betApi, staffApi, accountApi } from '../services/api';
import type { User, CrownAccount } from '../types';

const { RangePicker } = DatePicker;

interface DashboardStats {
  totalBetAmount: number;      // 投注金额
  actualAmount: number;         // 实数金额
  actualWinLoss: number;        // 实数输赢
  totalTickets: number;         // 票单数
  totalBets: number;            // 注单数
  canceledBets: number;         // 划单数（含赛中）
}

const DashboardPage: React.FC = () => {
  const { user, isAdmin, isAgent } = useAuth();
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(undefined);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [subUsers, setSubUsers] = useState<User[]>([]);
  const [accounts, setAccounts] = useState<CrownAccount[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalBetAmount: 0,
    actualAmount: 0,
    actualWinLoss: 0,
    totalTickets: 0,
    totalBets: 0,
    canceledBets: 0,
  });

  // 检测是否为移动端
  const isMobile = window.innerWidth <= 768;

  useEffect(() => {
    loadSubUsers();
    loadAccounts();
    loadDashboardData();
  }, []);

  // 加载下级用户列表
  const loadSubUsers = async () => {
    if (!isAdmin && !isAgent) return;

    try {
      const response = await staffApi.getStaffList();
      if (response.success && response.data) {
        setSubUsers(response.data);
      }
    } catch (error) {
      console.error('加载下级用户失败:', error);
    }
  };

  // 加载账号列表
  const loadAccounts = async () => {
    try {
      const response = await accountApi.getAccounts();
      if (response.success && response.data) {
        setAccounts(response.data);
      }
    } catch (error) {
      console.error('加载账号列表失败:', error);
    }
  };

  // 加载数据
  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // 构建查询参数
      const params: any = {
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
      };

      if (selectedUserId) {
        params.user_id = selectedUserId;
      }

      if (selectedAccountId) {
        params.crown_account_id = selectedAccountId;
      }

      // 获取投注统计数据
      const response = await betApi.getStats(params);

      if (response.success && response.data) {
        setStats({
          totalBetAmount: response.data.total_bet_amount || 0,
          actualAmount: response.data.actual_amount || 0,
          actualWinLoss: response.data.actual_win_loss || 0,
          totalTickets: response.data.total_tickets || 0,
          totalBets: response.data.total_bets || 0,
          canceledBets: response.data.canceled_bets || 0,
        });
      } else {
        message.error(response.error || '获取统计数据失败');
      }
    } catch (error: any) {
      console.error('加载数据失败:', error);
      message.error(error.message || '获取统计数据失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ margin: 0, padding: 0 }}>
      {/* Filter section */}
      <Card style={{ marginBottom: isMobile ? 8 : 16 }} className="glass-panel">
        <Space direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: '100%' }} wrap>
          <RangePicker
            value={dateRange}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0], dates[1]]);
              }
            }}
            size={isMobile ? 'small' : 'middle'}
            style={{ width: isMobile ? '100%' : 'auto' }}
          />

          {(isAdmin || isAgent) && (
            <Select
              placeholder="选择下级用户"
              allowClear
              value={selectedUserId}
              onChange={(value) => setSelectedUserId(value)}
              style={{ width: isMobile ? '100%' : 200 }}
              size={isMobile ? 'small' : 'middle'}
            >
              {subUsers.map((u) => (
                <Select.Option key={u.id} value={u.id}>
                  {u.username} ({u.role})
                </Select.Option>
              ))}
            </Select>
          )}

          <Select
            placeholder="选择账号"
            allowClear
            value={selectedAccountId || undefined}
            onChange={(value) => setSelectedAccountId(value || '')}
            style={{ width: isMobile ? '100%' : 200 }}
            size={isMobile ? 'small' : 'middle'}
          >
            {accounts.map((acc) => (
              <Select.Option key={acc.id} value={acc.id}>
                {acc.username}
              </Select.Option>
            ))}
          </Select>

          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={loadDashboardData}
            loading={loading}
            size={isMobile ? 'small' : 'middle'}
            style={{ width: isMobile ? '100%' : 'auto' }}
          >
            查询
          </Button>
        </Space>
      </Card>

      {/* Statistics Cards */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '50px 0' }}>
          <Spin size="large" />
        </div>
      ) : (
        <Row gutter={isMobile ? [8, 8] : [16, 16]}>
          {/* 投注金额 */}
          <Col xs={24} sm={12} lg={8}>
            <Card className="glass-panel">
              <Statistic
                title={<span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>投注金额</span>}
                value={stats.totalBetAmount}
                precision={2}
                valueStyle={{ color: '#0891B2', fontWeight: 700, fontSize: '28px' }}
              />
            </Card>
          </Col>

          {/* 实数金额 */}
          <Col xs={24} sm={12} lg={8}>
            <Card className="glass-panel">
              <Statistic
                title={<span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>实数金额</span>}
                value={stats.actualAmount}
                precision={2}
                valueStyle={{ color: '#0891B2', fontWeight: 700, fontSize: '28px' }}
              />
            </Card>
          </Col>

          {/* 实数输赢 */}
          <Col xs={24} sm={12} lg={8}>
            <Card className="glass-panel">
              <Statistic
                title={<span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>实数输赢</span>}
                value={stats.actualWinLoss}
                precision={2}
                valueStyle={{
                  color: stats.actualWinLoss >= 0 ? '#059669' : '#DC2626',
                  fontWeight: 700,
                  fontSize: '28px'
                }}
              />
            </Card>
          </Col>

          {/* 票单数 */}
          <Col xs={24} sm={12} lg={8}>
            <Card className="glass-panel">
              <Statistic
                title={<span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>票单数</span>}
                value={stats.totalTickets}
                valueStyle={{ color: '#4F46E5', fontWeight: 700, fontSize: '28px' }}
              />
            </Card>
          </Col>

          {/* 注单数 */}
          <Col xs={24} sm={12} lg={8}>
            <Card className="glass-panel">
              <Statistic
                title={<span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>注单数</span>}
                value={stats.totalBets}
                valueStyle={{ color: '#4F46E5', fontWeight: 700, fontSize: '28px' }}
              />
            </Card>
          </Col>

          {/* 划单数 */}
          <Col xs={24} sm={12} lg={8}>
            <Card className="glass-panel">
              <Statistic
                title={<span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>划单数</span>}
                value={stats.canceledBets}
                valueStyle={{ color: '#D97706', fontWeight: 700, fontSize: '28px' }}
              />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default DashboardPage;
