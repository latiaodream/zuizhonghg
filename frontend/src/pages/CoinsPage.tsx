import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  message,
  Typography,
  Row,
  Col,
  Select,
  DatePicker,
  Statistic,
  Modal,
  Form,
  Input,
  InputNumber,
  Alert,
  Tabs,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  DollarOutlined,
  RiseOutlined,
  FallOutlined,
  SearchOutlined,
  BarChartOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { CoinTransaction, CrownAccount, TablePagination, CoinStats, User } from '../types';
import { coinApi, accountApi, agentApi, staffApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const CoinsPage: React.FC = () => {
  const { user, isAdmin, isAgent } = useAuth();
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [accounts, setAccounts] = useState<CrownAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [stats, setStats] = useState<CoinStats['transaction_summary']>({});
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  React.useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 用户列表（用于充值和转账）
  const [agents, setAgents] = useState<User[]>([]);
  const [staffList, setStaffList] = useState<User[]>([]);

  // 模态框状态
  const [manualFormVisible, setManualFormVisible] = useState(false);
  const [rechargeFormVisible, setRechargeFormVisible] = useState(false);
  const [transferFormVisible, setTransferFormVisible] = useState(false);
  const [form] = Form.useForm();
  const [rechargeForm] = Form.useForm();
  const [transferForm] = Form.useForm();

  const [pagination, setPagination] = useState<TablePagination>({
    current: 1,
    pageSize: 20,
    total: 0,
  });

  useEffect(() => {
    loadAccounts();
    loadTransactions();
    loadBalance();
    loadAnalytics();
    loadUsers();
  }, [selectedType, dateRange]);

  const loadUsers = async () => {
    try {
      if (isAdmin) {
        // Admin 可以看到所有代理
        const response = await agentApi.getAgentList();
        if (response.success && response.data) {
          setAgents(response.data);
        }
      }
      if (isAgent) {
        // Agent 可以看到自己的员工
        const response = await staffApi.getStaffList();
        if (response.success && response.data) {
          setStaffList(response.data);
        }
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const loadAccounts = async () => {
    try {
      const response = await accountApi.getAccounts();
      if (response.success && response.data) {
        setAccounts(response.data);
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
    }
  };

  const loadTransactions = async () => {
    try {
      setLoading(true);
      const params: any = {};

      if (selectedType) params.type = selectedType;
      if (dateRange) {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      }

      const response = await coinApi.getTransactions(params);
      if (response.success && response.data) {
        setTransactions(response.data.transactions);
        setStats(response.data.stats.transaction_summary);
        setPagination(prev => ({
          ...prev,
          total: response.data!.transactions.length,
        }));
      }
    } catch (error) {
      console.error('Failed to load transactions:', error);
      message.error('加载金币流水失败');
    } finally {
      setLoading(false);
    }
  };

  const loadBalance = async () => {
    try {
      const response = await coinApi.getBalance();
      if (response.success && response.data) {
        setCurrentBalance(response.data.balance);
      }
    } catch (error) {
      console.error('Failed to load balance:', error);
    }
  };

  const loadAnalytics = async () => {
    try {
      const response = await coinApi.getAnalytics('7d');
      if (response.success && response.data) {
        setAnalyticsData(response.data);
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  };

  const handleCreateManualTransaction = () => {
    setManualFormVisible(true);
    form.resetFields();
  };

  const handleManualFormSubmit = async () => {
    try {
      const values = await form.validateFields();
      const response = await coinApi.createTransaction({
        transaction_type: values.transaction_type,
        amount: values.amount,
        description: values.description,
        account_id: values.account_id,
      });

      if (response.success) {
        message.success('手动调整记录创建成功');
        setManualFormVisible(false);
        loadTransactions();
        loadBalance();
      }
    } catch (error) {
      console.error('Failed to create manual transaction:', error);
      message.error('创建调整记录失败');
    }
  };

  const handleRecharge = () => {
    setRechargeFormVisible(true);
    rechargeForm.resetFields();
  };

  const handleRechargeSubmit = async () => {
    try {
      const values = await rechargeForm.validateFields();
      const response = await coinApi.recharge({
        target_user_id: values.target_user_id,
        amount: values.amount,
        description: values.description || `充值 ${values.amount} 金币`,
      });

      if (response.success) {
        message.success(`充值成功！对方新余额：¥${response.data?.new_balance || 0}`);
        setRechargeFormVisible(false);
        loadTransactions();
        loadBalance();
        loadUsers(); // 刷新用户列表
      }
    } catch (error: any) {
      console.error('Failed to recharge:', error);
      message.error(error?.response?.data?.error || '充值失败');
    }
  };

  const handleTransfer = () => {
    setTransferFormVisible(true);
    transferForm.resetFields();
  };

  const handleTransferSubmit = async () => {
    try {
      const values = await transferForm.validateFields();
      const response = await coinApi.transfer({
        target_user_id: values.target_user_id,
        amount: values.amount,
        description: values.description || `转账 ${values.amount} 金币`,
      });

      if (response.success) {
        message.success(`转账成功！您的新余额：¥${response.data?.sender_new_balance || 0}`);
        setTransferFormVisible(false);
        loadTransactions();
        loadBalance();
        loadUsers(); // 刷新用户列表
      }
    } catch (error: any) {
      console.error('Failed to transfer:', error);
      message.error(error?.response?.data?.error || '转账失败');
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case '消耗': return 'red';
      case '返还': return 'green';
      case '充值': return 'blue';
      case '提现': return 'orange';
      case '调整': return 'purple';
      default: return 'default';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case '消耗':
      case '提现':
        return <FallOutlined style={{ color: '#ff4d4f' }} />;
      case '返还':
      case '充值':
        return <RiseOutlined style={{ color: '#52c41a' }} />;
      default:
        return <DollarOutlined />;
    }
  };

  // 表格列定义
  const columns: ColumnsType<CoinTransaction> = [
    {
      title: '交易ID',
      dataIndex: 'transaction_id',
      key: 'transaction_id',
      width: 180,
      fixed: 'left',
      render: (text: string) => (
        <Text copyable code style={{ fontSize: 11, fontFamily: 'monospace' }}>{text}</Text>
      ),
    },
    {
      title: '类型',
      dataIndex: 'transaction_type',
      key: 'transaction_type',
      width: 120,
      fixed: 'left',
      render: (type: string) => (
        <Space>
          {getTypeIcon(type)}
          <Tag color={getTypeColor(type)} style={{ fontSize: 13, padding: '4px 12px' }}>
            {type}
          </Tag>
        </Space>
      ),
    },
    {
      title: '员工',
      dataIndex: 'user_username',
      key: 'user_username',
      width: 120,
      render: (username: string) => (
        username ? (
          <Tag color="blue" style={{ fontSize: 12 }}>{username}</Tag>
        ) : (
          <Tag color="default">-</Tag>
        )
      ),
    },
    {
      title: '账号信息',
      key: 'account',
      width: 150,
      render: (_, record: CoinTransaction) => (
        record.account_username ? (
          <Space direction="vertical" size={2}>
            <Text strong style={{ fontSize: 13 }}>{record.account_username}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {record.account_display_name}
            </Text>
          </Space>
        ) : (
          <Tag color="default">系统操作</Tag>
        )
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => (
        <Text style={{ fontSize: 13 }}>{text}</Text>
      ),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 140,
      align: 'right',
      render: (amount: number) => {
        const icon = amount >= 0 ? '↑' : '↓';
        return (
          <Text
            strong
            style={{
              color: amount >= 0 ? '#52c41a' : '#ff4d4f',
              fontSize: 15,
              fontWeight: 'bold'
            }}
          >
            {icon} ¥{Math.abs(amount).toFixed(2)}
          </Text>
        );
      },
    },
    {
      title: '变动前余额',
      dataIndex: 'balance_before',
      key: 'balance_before',
      width: 130,
      align: 'right',
      render: (balance: number) => (
        <Text style={{ fontSize: 13 }}>¥{balance ? Number(balance).toFixed(2) : '0.00'}</Text>
      ),
    },
    {
      title: '变动后余额',
      dataIndex: 'balance_after',
      key: 'balance_after',
      width: 130,
      align: 'right',
      render: (balance: number) => (
        <Text strong style={{ fontSize: 14, color: '#1890ff' }}>¥{balance ? Number(balance).toFixed(2) : '0.00'}</Text>
      ),
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      align: 'center',
      render: (text: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {dayjs(text).format('MM-DD HH:mm:ss')}
        </Text>
      ),
    },
  ];

  // 统计卡片数据
  const getStatsCards = () => {
    const totalIncome = Object.entries(stats)
      .filter(([type]) => ['返还', '充值'].includes(type))
      .reduce((sum, [, data]) => sum + data.total_amount, 0);

    const totalExpense = Object.entries(stats)
      .filter(([type]) => ['消耗', '提现'].includes(type))
      .reduce((sum, [, data]) => sum + Math.abs(data.total_amount), 0);

    const totalTransactions = Object.values(stats)
      .reduce((sum, data) => sum + data.count, 0);

    return [
      {
        title: '当前余额',
        value: currentBalance,
        prefix: <DollarOutlined />,
        suffix: '元',
        valueStyle: { color: '#1890ff' },
      },
      {
        title: '总收入',
        value: totalIncome,
        prefix: <RiseOutlined />,
        suffix: '元',
        valueStyle: { color: '#52c41a' },
      },
      {
        title: '总支出',
        value: totalExpense,
        prefix: <FallOutlined />,
        suffix: '元',
        valueStyle: { color: '#ff4d4f' },
      },
      {
        title: '交易笔数',
        value: totalTransactions,
        prefix: <BarChartOutlined />,
      },
    ];
  };

  return (
    <div style={{ padding: isMobile ? 0 : '4px 8px', background: isMobile ? '#fff' : '#f0f2f5', minHeight: '100vh' }}>
      {/* 统计卡片 */}
      <Row gutter={isMobile ? 4 : 16} style={{ marginBottom: isMobile ? 4 : 12 }}>
        {getStatsCards().map((stat, index) => (
          <Col xs={12} sm={12} lg={6} key={index}>
            <Card
              bodyStyle={{ padding: isMobile ? '12px' : '20px' }}
              style={isMobile ? { borderRadius: 0 } : {}}
            >
              <Statistic
                {...stat}
                valueStyle={{ fontSize: isMobile ? 16 : 24 }}
                title={<span style={{ fontSize: isMobile ? 11 : 14 }}>{stat.title}</span>}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card bodyStyle={{ padding: 0 }} style={isMobile ? { marginBottom: 0, borderRadius: 0 } : {}}>
        <Tabs
          defaultActiveKey="transactions"
          size={isMobile ? 'small' : 'middle'}
          items={[
            {
              key: 'transactions',
              label: (
                <span style={{ fontSize: isMobile ? 12 : 14, fontWeight: 500 }}>
                  <BarChartOutlined /> 流水记录
                </span>
              ),
              children: (
                <>
                  {/* 筛选条件 */}
                  <div style={{ padding: isMobile ? '8px' : '16px 24px', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                    <Row gutter={isMobile ? [0, 8] : [16, 16]} align="middle">
                      <Col xs={12} sm={8} md={6}>
                        <Space size={4}>
                          <Text type="secondary" style={{ fontSize: isMobile ? 12 : 14 }}>类型:</Text>
                          <Select
                            placeholder={isMobile ? '类型' : '全部类型'}
                            style={{ width: isMobile ? 80 : 150 }}
                            size={isMobile ? 'small' : 'middle'}
                            allowClear
                            value={selectedType}
                            onChange={setSelectedType}
                            options={[
                              { label: '全部', value: '' },
                              { label: '消耗', value: '消耗' },
                              { label: '返还', value: '返还' },
                              { label: '充值', value: '充值' },
                              { label: '提现', value: '提现' },
                              { label: '调整', value: '调整' },
                            ]}
                          />
                        </Space>
                      </Col>
                      <Col xs={12} sm={10} md={10}>
                        <Space size={4}>
                          {!isMobile && <Text type="secondary">日期:</Text>}
                          <RangePicker
                            value={dateRange}
                            size={isMobile ? 'small' : 'middle'}
                            style={{ width: isMobile ? '100%' : undefined }}
                            onChange={(dates) => {
                              if (dates && dates[0] && dates[1]) {
                                setDateRange([dates[0], dates[1]] as [dayjs.Dayjs, dayjs.Dayjs]);
                              } else {
                                setDateRange(null);
                              }
                            }}
                            format="YYYY-MM-DD"
                            placeholder={['开始日期', '结束日期']}
                          />
                        </Space>
                      </Col>
                      <Col xs={24} sm={6} md={8} style={{ textAlign: 'right' }}>
                        <Space wrap>
                          {(isAdmin || isAgent) && (
                            <Button
                              type="primary"
                              icon={<PlusOutlined />}
                              onClick={handleRecharge}
                            >
                              充值
                            </Button>
                          )}
                          {isAgent && (
                            <Button
                              icon={<SwapOutlined />}
                              onClick={handleTransfer}
                            >
                              转账
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              icon={<PlusOutlined />}
                              onClick={handleCreateManualTransaction}
                            >
                              手动调整
                            </Button>
                          )}
                          <Button
                            icon={<ReloadOutlined />}
                            onClick={loadTransactions}
                            type="text"
                          >
                            刷新
                          </Button>
                        </Space>
                      </Col>
                    </Row>
                  </div>

                  {/* 表格 */}
                  <Table
                    columns={columns}
                    dataSource={transactions}
                    rowKey="id"
                    loading={loading}
                    pagination={{
                      ...pagination,
                      showSizeChanger: true,
                      showQuickJumper: true,
                      showTotal: (total, range) =>
                        `第 ${range[0]}-${range[1]} 条，共 ${total} 条记录`,
                      style: { padding: '16px 24px' },
                    }}
                    scroll={{ x: 1200 }}
                    size="middle"
                    rowClassName={(record, index) => index % 2 === 0 ? 'table-row-light' : 'table-row-dark'}
                  />
                </>
              ),
            },
            {
              key: 'analytics',
              label: (
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  <SearchOutlined /> 统计分析
                </span>
              ),
              children: (
                <div style={{ padding: '24px' }}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <Card
                        title={
                          <span style={{ fontSize: 15, fontWeight: 600 }}>
                            <BarChartOutlined /> 交易类型分布
                          </span>
                        }
                        bordered={false}
                        bodyStyle={{ padding: '20px' }}
                      >
                        <Space direction="vertical" style={{ width: '100%' }} size={16}>
                          {Object.entries(stats).map(([type, data]) => (
                            <div
                              key={type}
                              style={{
                                padding: '12px 16px',
                                background: '#fafafa',
                                borderRadius: '8px',
                                border: '1px solid #f0f0f0'
                              }}
                            >
                              <Row justify="space-between" align="middle">
                                <Col>
                                  <Space size={12}>
                                    {getTypeIcon(type)}
                                    <Tag color={getTypeColor(type)} style={{ fontSize: 13, padding: '4px 12px' }}>
                                      {type}
                                    </Tag>
                                  </Space>
                                </Col>
                                <Col>
                                  <Space size={16}>
                                    <Text type="secondary">{data.count} 笔</Text>
                                    <Text strong style={{ fontSize: 16, color: '#262626' }}>
                                      ¥{Math.abs(data.total_amount).toFixed(2)}
                                    </Text>
                                  </Space>
                                </Col>
                              </Row>
                            </div>
                          ))}
                        </Space>
                      </Card>
                    </Col>

                    <Col xs={24} lg={12}>
                      <Card
                        title={
                          <span style={{ fontSize: 15, fontWeight: 600 }}>
                            <RiseOutlined /> 最近7天趋势
                          </span>
                        }
                        bordered={false}
                        bodyStyle={{ padding: '20px' }}
                      >
                        {analyticsData && (
                          <Space direction="vertical" style={{ width: '100%' }} size={24}>
                            <div style={{ padding: '16px', background: '#e6f7ff', borderRadius: '8px' }}>
                              <Statistic
                                title={<span style={{ fontSize: 13 }}>7天交易笔数</span>}
                                value={analyticsData.summary.total_transactions}
                                prefix={<BarChartOutlined />}
                                valueStyle={{ fontSize: 28, fontWeight: 'bold', color: '#1890ff' }}
                              />
                            </div>
                            <div style={{
                              padding: '16px',
                              background: analyticsData.summary.net_amount >= 0 ? '#f6ffed' : '#fff1f0',
                              borderRadius: '8px'
                            }}>
                              <Statistic
                                title={<span style={{ fontSize: 13 }}>7天净收入</span>}
                                value={Math.abs(analyticsData.summary.net_amount).toFixed(2)}
                                prefix={
                                  analyticsData.summary.net_amount >= 0 ?
                                  <RiseOutlined /> :
                                  <FallOutlined />
                                }
                                valueStyle={{
                                  fontSize: 28,
                                  fontWeight: 'bold',
                                  color: analyticsData.summary.net_amount >= 0 ? '#52c41a' : '#ff4d4f'
                                }}
                                suffix="元"
                              />
                            </div>
                          </Space>
                        )}
                      </Card>
                    </Col>
                  </Row>
                </div>
              ),
            }
          ]}
        />
      </Card>

      {/* 充值模态框 */}
      <Modal
        title="充值金币"
        open={rechargeFormVisible}
        onOk={handleRechargeSubmit}
        onCancel={() => setRechargeFormVisible(false)}
        maskClosable={false}
      >
        <Alert
          message="充值说明"
          description={
            isAdmin
              ? "管理员可以给任何代理或员工充值金币（无限额）"
              : "代理可以给自己的员工充值金币（受自己余额限制）"
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Form form={rechargeForm} layout="vertical">
          <Form.Item
            name="target_user_id"
            label="充值对象"
            rules={[{ required: true, message: '请选择充值对象' }]}
          >
            <Select
              placeholder="选择要充值的用户"
              showSearch
              optionFilterProp="children"
            >
              {isAdmin && agents.map(agent => (
                <Select.Option key={agent.id} value={agent.id}>
                  {agent.username} ({agent.role === 'admin' ? '管理员' : '代理'}) - ID: {agent.id}
                </Select.Option>
              ))}
              {isAgent && staffList.map(staff => (
                <Select.Option key={staff.id} value={staff.id}>
                  {staff.username} (员工) - ID: {staff.id}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="amount"
            label="充值金额"
            rules={[
              { required: true, message: '请输入充值金额' },
              { type: 'number', min: 0.01, message: '金额必须大于0' }
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="请输入充值金额"
              addonAfter="金币"
              min={0.01}
              precision={2}
            />
          </Form.Item>

          <Form.Item
            name="description"
            label="备注"
          >
            <Input.TextArea
              rows={2}
              placeholder="可选，填写充值备注..."
            />
          </Form.Item>

          {!isAdmin && (
            <Alert
              message={`您的当前余额：¥${Number(currentBalance || 0).toFixed(2)}`}
              type="warning"
              showIcon
            />
          )}
        </Form>
      </Modal>

      {/* 转账模态框 */}
      <Modal
        title="转账金币"
        open={transferFormVisible}
        onOk={handleTransferSubmit}
        onCancel={() => setTransferFormVisible(false)}
        maskClosable={false}
      >
        <Alert
          message="转账说明"
          description="代理之间可以直接转账金币，转账后立即生效"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Form form={transferForm} layout="vertical">
          <Form.Item
            name="target_user_id"
            label="转账对象"
            rules={[{ required: true, message: '请选择转账对象' }]}
          >
            <Select
              placeholder="选择要转账的代理"
              showSearch
              optionFilterProp="children"
            >
              {agents.filter(agent => agent.id !== user?.id).map(agent => (
                <Select.Option key={agent.id} value={agent.id}>
                  {agent.username} (代理) - ID: {agent.id}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="amount"
            label="转账金额"
            rules={[
              { required: true, message: '请输入转账金额' },
              { type: 'number', min: 0.01, message: '金额必须大于0' }
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="请输入转账金额"
              addonAfter="金币"
              min={0.01}
              precision={2}
            />
          </Form.Item>

          <Form.Item
            name="description"
            label="备注"
          >
            <Input.TextArea
              rows={2}
              placeholder="可选，填写转账备注..."
            />
          </Form.Item>

          <Alert
            message={`您的当前余额：¥${Number(currentBalance || 0).toFixed(2)}`}
            type="warning"
            showIcon
          />
        </Form>
      </Modal>

      {/* 手动调整模态框 */}
      <Modal
        title="手动调整金币"
        open={manualFormVisible}
        onOk={handleManualFormSubmit}
        onCancel={() => setManualFormVisible(false)}
        maskClosable={false}
      >
        <Alert
          message="注意"
          description="手动调整会直接影响用户金币余额，请谨慎操作。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Form form={form} layout="vertical">
          <Form.Item
            name="transaction_type"
            label="调整类型"
            rules={[{ required: true, message: '请选择调整类型' }]}
          >
            <Select>
              <Select.Option value="充值">充值</Select.Option>
              <Select.Option value="提现">提现</Select.Option>
              <Select.Option value="调整">调整</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="amount"
            label="调整金额"
            rules={[
              { required: true, message: '请输入调整金额' },
              { type: 'number', message: '请输入有效数字' }
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="正数为增加，负数为减少"
              addonAfter="元"
            />
          </Form.Item>

          <Form.Item
            name="account_id"
            label="关联账号"
          >
            <Select placeholder="可选，选择关联的皇冠账号" allowClear>
              {accounts.map(account => (
                <Select.Option key={account.id} value={account.id}>
                  {account.username} ({account.display_name})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="description"
            label="调整说明"
            rules={[{ required: true, message: '请输入调整说明' }]}
          >
            <Input.TextArea
              rows={3}
              placeholder="请详细说明调整原因..."
            />
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        .table-row-light {
          background-color: #ffffff;
        }
        .table-row-dark {
          background-color: #fafafa;
        }
        .table-row-light:hover,
        .table-row-dark:hover {
          background-color: #e6f7ff !important;
        }
      `}</style>
    </div>
  );
};

export default CoinsPage;
