import React from 'react';
import { Button, Switch, Tag, Tooltip, Space, Typography, Popconfirm } from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  WifiOutlined,
  DisconnectOutlined,
  MobileOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  StopOutlined,
  CrownOutlined,
} from '@ant-design/icons';
import type { CrownAccount } from '../../types';

const { Text } = Typography;

interface AccountCardProps {
  account: CrownAccount;
  onEdit: (account: CrownAccount) => void;
  onDelete: (id: number) => void;
  onToggleStatus: (account: CrownAccount) => void;
  onRefresh?: (account: CrownAccount) => void;
  onLogin?: (account: CrownAccount) => void;
  onLogout?: (account: CrownAccount) => void;
  onCheckHistory?: (account: CrownAccount) => void;
}

const AccountCard: React.FC<AccountCardProps> = ({
  account,
  onEdit,
  onDelete,
  onToggleStatus,
  onRefresh,
  onLogin,
  onLogout,
  onCheckHistory,
}) => {
  const formatDiscount = (value?: number) => {
    if (!value || value <= 0) {
      return '-';
    }
    return `${(value * 100).toFixed(0)}%`;
  };

  const formatAmount = (value?: number) => {
    if (value === undefined || value === null) {
      return '-';
    }
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return '-';
    }
    return numeric.toLocaleString();
  };

  return (
    <div className="account-card">
      {/* 头部区域 - 用户头像和用户名 */}
      <div className="account-card-header">
        <div className="account-card-user">
          <div className="account-card-avatar">
            <CrownOutlined style={{ color: '#1677FF', fontSize: '20px' }} />
          </div>
          <div className="account-card-user-info">
            <Space size={6} align="center" wrap>
              <div className="account-card-username">{account.username}</div>
              <Tag color={account.is_online ? 'green' : 'default'}>
                {account.is_online ? '在线' : '离线'}
              </Tag>
              <Tag color={
                account.init_type === 'none' ? 'success' :
                account.init_type === 'password_only' ? 'processing' :
                'warning'
              }>
                {
                  account.init_type === 'none' ? '无需初始化' :
                  account.init_type === 'password_only' ? '仅改密码' :
                  '完整初始化'
                }
              </Tag>
            </Space>
            <div className="account-card-user-id">
              {account.original_username && account.initialized_username ? (
                <Tooltip title={`原始账号: ${account.original_username} → 修改后: ${account.initialized_username}`}>
                  <span style={{ cursor: 'help' }}>
                    ({account.original_username} → {account.initialized_username})
                  </span>
                </Tooltip>
              ) : account.original_username ? (
                <span>原始: {account.original_username}</span>
              ) : (
                <span>({account.display_name || 'c001gf4gm'})</span>
              )}
            </div>
          </div>
        </div>
        <div className="account-card-status-switch">
          <Switch
            checked={account.is_enabled}
            size="small"
            onChange={() => onToggleStatus(account)}
            style={{
              backgroundColor: account.is_enabled ? '#1677FF' : undefined,
            }}
          />
        </div>
      </div>

      {/* 详细信息区域 */}
      <div className="account-card-details">
        <div className="account-card-detail-row">
          <Text strong>赛事:</Text>
          <Text>{account.game_type || '足球'}</Text>
          <Text strong>来源:</Text>
          <Text>{account.source || '自有'}</Text>
          <Text strong>分享:</Text>
          <Text>{account.discount || '0'}</Text>
        </div>

        <div className="account-card-detail-row">
          <Text strong>币种:</Text>
          <Text>{account.currency || 'CNY'}</Text>
          <Text strong>折扣:</Text>
          <Text>{formatDiscount(account.discount)}</Text>
          <Text strong>备注:</Text>
          <Text>{account.note || '3失85'}</Text>
        </div>

        <div className="account-card-detail-row">
          <Text strong>设备:</Text>
          <Text>{account.device_type || 'iPhone 15'}</Text>
          <Text strong>代理:</Text>
          <Text style={{ color: account.proxy_enabled ? '#52c41a' : '#999' }}>
            {account.proxy_enabled ? '有' : '无'}
          </Text>
          <Text strong>信用额度:</Text>
          <Text>{(() => {
            const raw: any = (account as any).credit;
            const num = typeof raw === 'number' ? raw : (raw ? parseFloat(String(raw)) : NaN);
            return Number.isFinite(num) ? num.toLocaleString() : '-';
          })()}</Text>
        </div>



        <div className="account-card-detail-row">
          <Text strong>止盈:</Text>
          <Text>{(() => {
            const formatted = formatAmount(account.stop_profit_limit);
            return formatted === '-' ? '-' : `${formatted} 元`;
          })()}</Text>
        </div>



        {(account.password || account.passcode) && (
          <div className="account-card-detail-row">
            <Space size={12}>
              {account.password && (
                <span>
                  <Text strong>当前密码：</Text>
                  <Text copyable={{ text: account.password }}>{account.password}</Text>
                </span>
              )}
              {account.passcode && (
                <span>
                  <Text strong>简易码：</Text>
                  <Text copyable={{ text: account.passcode }}>{account.passcode}</Text>
                </span>
              )}
            </Space>
          </div>
        )}

        <div className="account-card-limits">
          <div className="account-card-limit-row">
            <Text strong>足球:</Text>
            <Text>[赛前]{(account.football_prematch_limit || 1100000) / 10000}万/[滚球]{(account.football_live_limit || 1100000) / 10000}万</Text>
          </div>
          <div className="account-card-limit-row">
            <Text strong>篮球:</Text>
            <Text>[赛前]{(account.basketball_prematch_limit || 1100000) / 10000}万/[滚球]{(account.basketball_live_limit || 1100000) / 10000}万</Text>
          </div>
        </div>
      </div>

      {/* 底部操作区域 */}
      <div className="account-card-actions">
        <div className="account-card-actions-center">
          <Space wrap>
            {account.is_online ? (
              <Button
                type="text"
                size="small"
                danger
                icon={<DisconnectOutlined />}
                onClick={() => onLogout?.(account)}
              >
                登出
              </Button>
            ) : (
              <Button
                type="text"
                size="small"
                icon={<WifiOutlined />}
                onClick={() => onLogin?.(account)}
              >
                登录
              </Button>
            )}
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => onRefresh?.(account)}
            >
              刷新
            </Button>
            <Button
              type="text"
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => onCheckHistory?.(account)}
            >
              查账
            </Button>
            <Button type="text" size="small" onClick={() => onEdit(account)}>
              编辑
            </Button>
            <Popconfirm
              title="确定删除这个账号吗？"
              onConfirm={() => onDelete(account.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="text" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        </div>
      </div>
    </div>
  );
};

export default AccountCard;
