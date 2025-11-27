import React from 'react';
import {
  Modal,
  Descriptions,
  Button,
  Space,
  Tag,
  Typography,
  Divider,
  Row,
  Col,
  Card,
  Statistic,
} from 'antd';
import {
  EditOutlined,
  WifiOutlined,
  DisconnectOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import type { CrownAccount } from '../../types';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface AccountDetailModalProps {
  visible: boolean;
  account: CrownAccount | null;
  onCancel: () => void;
  onEdit: (account: CrownAccount) => void;
  pendingCredentials?: { username: string; password: string };
}

const AccountDetailModal: React.FC<AccountDetailModalProps> = ({
  visible,
  account,
  onCancel,
  onEdit,
  pendingCredentials,
}) => {
  if (!account) return null;

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
    return `${numeric.toLocaleString()} 元`;
  };

  const renderProxyInfo = () => {
    if (!account.proxy_enabled) {
      return (
        <Space>
          <DisconnectOutlined style={{ color: '#d9d9d9' }} />
          <Text type="secondary">未使用代理</Text>
        </Space>
      );
    }

    return (
      <Space direction="vertical" size={4}>
        <Space>
          <WifiOutlined style={{ color: '#52c41a' }} />
          <Text strong>代理已启用</Text>
        </Space>
        <Text>
          类型: {account.proxy_type} |
          地址: {account.proxy_host}:{account.proxy_port}
        </Text>
        {account.proxy_username && (
          <Text type="secondary">
            用户名: {account.proxy_username}
          </Text>
        )}
      </Space>
    );
  };

  const renderStatusTag = () => {
    return account.is_enabled ? (
      <Tag icon={<CheckCircleOutlined />} color="success">
        启用中
      </Tag>
    ) : (
      <Tag icon={<CloseCircleOutlined />} color="error">
        已禁用
      </Tag>
    );
  };

  return (
    <Modal
      title={
        <Space>
          <span>账号详情</span>
          {renderStatusTag()}
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={800}
      footer={[
        <Button key="edit" type="primary" icon={<EditOutlined />} onClick={() => onEdit(account)}>
          编辑账号
        </Button>,
        <Button key="close" onClick={onCancel}>
          关闭
        </Button>,
      ]}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* 基本信息 */}
        <Card title="基本信息" size="small">
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="账号">{account.username}</Descriptions.Item>
            <Descriptions.Item label="显示名称">{account.display_name}</Descriptions.Item>
            <Descriptions.Item label="所属分组">
              <Tag color="blue">{account.group_name}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="游戏类型">{account.game_type}</Descriptions.Item>
            <Descriptions.Item label="来源">{account.source}</Descriptions.Item>
            <Descriptions.Item label="货币">{account.currency}</Descriptions.Item>
            <Descriptions.Item label="折扣">{formatDiscount(account.discount)}</Descriptions.Item>
            <Descriptions.Item label="止盈金额">{formatAmount(account.stop_profit_limit)}</Descriptions.Item>
            <Descriptions.Item label="备注">{account.note}</Descriptions.Item>
            <Descriptions.Item label="设备类型">{account.device_type}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {dayjs(account.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {dayjs(account.updated_at).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label="最后登录">
              {account.last_login ?
                dayjs(account.last_login).format('YYYY-MM-DD HH:mm:ss') :
                <Text type="secondary">未登录</Text>
              }
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="凭证信息" size="small">
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="当前登录账号">
              <Text copyable={{ text: account.username }}>{account.username}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="当前密码">
              {account.password ? (
                <Text copyable={{ text: account.password }}>{account.password}</Text>
              ) : (
                <Text type="secondary">未同步</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="简易密码">
              {account.passcode ? (
                <Text copyable={{ text: account.passcode }}>{account.passcode}</Text>
              ) : (
                <Text type="secondary">未生成</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="原始账号">
              {account.original_username || <Text type="secondary">-</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="最新账号">
              {account.initialized_username || account.username}
            </Descriptions.Item>
            {pendingCredentials && (
              <Descriptions.Item label="待初始化账号/密码" span={2}>
                <Space direction="vertical" size={0}>
                  <span>
                    <Text type="secondary">账号：</Text>{' '}
                    <Text copyable={{ text: pendingCredentials.username }}>{pendingCredentials.username}</Text>
                  </span>
                  <span>
                    <Text type="secondary">密码：</Text>{' '}
                    <Text copyable={{ text: pendingCredentials.password }}>{pendingCredentials.password}</Text>
                  </span>
                </Space>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>

        {/* 代理设置 */}
        <Card title="代理设置" size="small">
          {renderProxyInfo()}
        </Card>

        {/* 限额设置 */}
        <Card title="限额设置" size="small">
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Card title="足球限额" size="small" type="inner">
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic
                      title="赛前限额"
                      value={account.football_prematch_limit}
                      suffix="元"
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="滚球限额"
                      value={account.football_live_limit}
                      suffix="元"
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                </Row>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card title="篮球限额" size="small" type="inner">
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic
                      title="赛前限额"
                      value={account.basketball_prematch_limit}
                      suffix="元"
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="滚球限额"
                      value={account.basketball_live_limit}
                      suffix="元"
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>
        </Card>
      </Space>
    </Modal>
  );
};

export default AccountDetailModal;
