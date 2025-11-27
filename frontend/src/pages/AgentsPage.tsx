import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Popconfirm,
  message,
  Typography,
  Row,
  Col,
  Input,
  Modal,
  Form,
  Tag,
  InputNumber,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  UserOutlined,
  TeamOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { User, StaffCreateRequest, StaffUpdateRequest, TablePagination } from '../types';
import { agentApi, staffApi, coinApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import dayjs from 'dayjs';

const { Title } = Typography;
const { Search } = Input;

interface AgentWithStats extends User {
  staff_count: number;
  coin_balance?: number;
}

const AgentsPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const [agentList, setAgentList] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [pagination, setPagination] = useState<TablePagination>({
    current: 1,
    pageSize: 20,
    total: 0,
  });

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 模态框状态
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<User | null>(null);
  const [form] = Form.useForm();

  // 充值模态框状态
  const [rechargeModalVisible, setRechargeModalVisible] = useState(false);
  const [rechargeTarget, setRechargeTarget] = useState<User | null>(null);
  const [rechargeForm] = Form.useForm();

  useEffect(() => {
    loadAgentList();
  }, []);

  const loadAgentList = async () => {
    try {
      setLoading(true);

      // 获取代理列表
      const agentResponse = await agentApi.getAgentList();
      if (agentResponse.success && agentResponse.data) {
        // 获取员工列表来统计每个代理的员工数量
        const staffResponse = await staffApi.getStaffList();
        const staffList = staffResponse.success ? staffResponse.data || [] : [];

        // 计算每个代理的员工数量和金币余额
        const agentsWithStats = await Promise.all(
          agentResponse.data.map(async (agent) => {
            const staffCount = staffList.filter(staff =>
              staff.parent_id === agent.id || staff.agent_id === agent.id
            ).length;

            // 获取代理的金币余额
            let coinBalance = 0;
            try {
              const balanceResponse = await coinApi.getUserBalance(agent.id);
              if (balanceResponse.success && balanceResponse.data) {
                coinBalance = balanceResponse.data.balance || 0;
              }
            } catch (error) {
              console.error(`获取代理 ${agent.username} 金币余额失败:`, error);
            }

            return {
              ...agent,
              staff_count: staffCount,
              coin_balance: coinBalance,
            };
          })
        );

        setAgentList(agentsWithStats);
        setPagination(prev => ({
          ...prev,
          total: agentsWithStats.length,
        }));
      }
    } catch (error: any) {
      console.error('加载代理列表失败:', error);
      message.error(error.response?.data?.error || '加载代理列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingAgent(null);
    form.resetFields();
    setFormModalVisible(true);
  };

  const handleEdit = (agent: User) => {
    setEditingAgent(agent);
    form.setFieldsValue({
      username: agent.username,
      email: agent.email,
    });
    setFormModalVisible(true);
  };

  const handleDelete = async (agentId: number) => {
    try {
      setLoading(true);
      const response = await agentApi.deleteAgent(agentId);
      if (response.success) {
        message.success('代理删除成功');
        loadAgentList();
      } else {
        message.error(response.error || '删除失败');
      }
    } catch (error: any) {
      console.error('删除代理失败:', error);
      message.error(error.response?.data?.error || '删除代理失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      if (editingAgent) {
        // 更新代理
        const updateData: StaffUpdateRequest = {
          username: values.username,
          email: values.email,
        };
        if (values.password) {
          updateData.password = values.password;
        }

        const response = await agentApi.updateAgent(editingAgent.id, updateData);
        if (response.success) {
          message.success('代理更新成功');
          setFormModalVisible(false);
          loadAgentList();
        } else {
          message.error(response.error || '更新失败');
        }
      } else {
        // 创建代理
        const createData: StaffCreateRequest = {
          username: values.username,
          email: values.email,
          password: values.password,
        };

        const response = await agentApi.createAgent(createData);
        if (response.success) {
          message.success('代理创建成功');
          setFormModalVisible(false);
          loadAgentList();
        } else {
          message.error(response.error || '创建失败');
        }
      }
    } catch (error: any) {
      console.error('保存代理失败:', error);
      if (error.errorFields) {
        message.error('请检查表单填写');
      } else {
        message.error(error.response?.data?.error || '保存失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecharge = (agent: User) => {
    setRechargeTarget(agent);
    rechargeForm.resetFields();
    setRechargeModalVisible(true);
  };

  const handleRechargeSubmit = async () => {
    if (!rechargeTarget) return;

    try {
      const values = await rechargeForm.validateFields();
      setLoading(true);

      const response = await coinApi.recharge({
        target_user_id: rechargeTarget.id,
        amount: values.amount,
        description: values.description || `充值 ${values.amount} 金币给代理 ${rechargeTarget.username}`,
      });

      if (response.success) {
        message.success(`充值成功！对方新余额：¥${response.data?.new_balance || 0}`);
        setRechargeModalVisible(false);
        loadAgentList();
      }
    } catch (error: any) {
      console.error('充值失败:', error);
      if (error.errorFields) {
        message.error('请检查表单填写');
      } else {
        message.error(error.response?.data?.error || '充值失败');
      }
    } finally {
      setLoading(false);
    }
  };

  // 表格列定义
  const columns: ColumnsType<AgentWithStats> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
      responsive: ['md'] as any,
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      filteredValue: searchText ? [searchText] : null,
      onFilter: (value, record) =>
        record.username.toLowerCase().includes((value as string).toLowerCase()) ||
        record.email.toLowerCase().includes((value as string).toLowerCase()),
      render: (username: string, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{username}</div>
          {isMobile && (
            <>
              <div style={{ fontSize: '12px', color: '#999' }}>{record.email}</div>
              <Space size={4} style={{ marginTop: 4 }}>
                <Tag color="purple" style={{ fontSize: '11px', margin: 0 }}>代理</Tag>
                <Tag color={record.staff_count > 0 ? 'green' : 'default'} style={{ fontSize: '11px', margin: 0 }}>
                  员工: {record.staff_count}
                </Tag>
                <Tag color="gold" style={{ fontSize: '11px', margin: 0 }}>
                  ¥{(record.coin_balance || 0).toFixed(2)}
                </Tag>
              </Space>
            </>
          )}
        </div>
      ),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      responsive: ['md'] as any,
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      responsive: ['lg'] as any,
      render: (role: string) => (
        <Tag color="purple">代理</Tag>
      ),
    },
    {
      title: '员工数量',
      dataIndex: 'staff_count',
      key: 'staff_count',
      responsive: ['md'] as any,
      render: (count: number) => (
        <Tag color={count > 0 ? 'green' : 'default'} icon={<TeamOutlined />}>
          {count}
        </Tag>
      ),
    },
    {
      title: '皇冠额度',
      dataIndex: 'credit_limit',
      key: 'credit_limit',
      responsive: ['lg'] as any,
      render: (credit_limit: number) => (
        <span style={{ fontWeight: 500 }}>{credit_limit ? Number(credit_limit).toLocaleString() : '0'}</span>
      ),
    },
    {
      title: '金币余额',
      dataIndex: 'coin_balance',
      key: 'coin_balance',
      responsive: ['md'] as any,
      render: (balance: number) => (
        <Tag color="gold" icon={<DollarOutlined />}>
          ¥{(balance || 0).toFixed(2)}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      responsive: ['lg'] as any,
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      fixed: isMobile ? false : 'right',
      width: isMobile ? 100 : 240,
      render: (_, record) => (
        <Space size="small" direction={isMobile ? 'vertical' : 'horizontal'}>
          <Button
            type="primary"
            size="small"
            icon={<DollarOutlined />}
            onClick={() => handleRecharge(record)}
            style={isMobile ? { width: '100%' } : {}}
          >
            {isMobile ? '充值' : '充值'}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            style={isMobile ? { width: '100%', padding: '4px 8px' } : {}}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除"
            description={
              record.staff_count > 0
                ? '该代理还有关联的员工，确定要删除吗？'
                : '确定要删除该代理吗？'
            }
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              style={isMobile ? { width: '100%', padding: '4px 8px' } : {}}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 如果不是管理员，不显示此页面
  if (!isAdmin) {
    return (
      <Card>
        <Typography.Text type="danger">您没有权限访问此页面</Typography.Text>
      </Card>
    );
  }

  return (
    <div style={{ padding: isMobile ? 0 : '4px 8px' }}>
      <Card style={isMobile ? { margin: 0, borderRadius: 0 } : {}}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} style={{ marginTop: isMobile ? 12 : 0 }}>
            <Space direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: '100%' }}>
              <Search
                placeholder="搜索用户名或邮箱"
                allowClear
                style={{ width: isMobile ? '100%' : 250 }}
                onChange={(e) => setSearchText(e.target.value)}
                onSearch={setSearchText}
              />
              <Space style={{ width: isMobile ? '100%' : 'auto' }}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={loadAgentList}
                  loading={loading}
                  style={isMobile ? { flex: 1 } : {}}
                >
                  {isMobile ? '' : '刷新'}
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleCreate}
                  style={isMobile ? { flex: 1 } : {}}
                >
                  {isMobile ? '添加' : '添加代理'}
                </Button>
              </Space>
            </Space>
          </Col>
        </Row>

        <Table
          columns={columns}
          dataSource={agentList}
          rowKey="id"
          loading={loading}
          scroll={isMobile ? { x: 'max-content' } : undefined}
          pagination={{
            ...pagination,
            showSizeChanger: !isMobile,
            showQuickJumper: !isMobile,
            showTotal: (total) => `共 ${total} 条`,
            simple: isMobile,
            pageSize: isMobile ? 10 : pagination.pageSize,
            onChange: (page, pageSize) => {
              setPagination(prev => ({ ...prev, current: page, pageSize }));
            },
          }}
        />
      </Card>

      {/* 添加/编辑代理模态框 */}
      <Modal
        title={editingAgent ? '编辑代理' : '添加代理'}
        open={formModalVisible}
        onOk={handleFormSubmit}
        onCancel={() => {
          setFormModalVisible(false);
          form.resetFields();
        }}
        confirmLoading={loading}
        width={isMobile ? '100%' : 500}
        style={isMobile ? { top: 0, paddingBottom: 0, maxWidth: '100vw' } : {}}
      >
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, message: '用户名至少3个字符' },
            ]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            label="邮箱（可选）"
            name="email"
            rules={[
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
            tooltip="可选填写，用户首次登录时会要求绑定邮箱"
          >
            <Input placeholder="可选，首次登录时绑定" />
          </Form.Item>

          <Form.Item
            label={editingAgent ? '新密码（留空则不修改）' : '密码'}
            name="password"
            rules={editingAgent ? [] : [
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少6个字符' },
            ]}
          >
            <Input.Password placeholder={editingAgent ? '留空则不修改密码' : '请输入密码'} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 充值模态框 */}
      <Modal
        title={`充值金币 - ${rechargeTarget?.username || ''}`}
        open={rechargeModalVisible}
        onOk={handleRechargeSubmit}
        onCancel={() => {
          setRechargeModalVisible(false);
          rechargeForm.resetFields();
        }}
        confirmLoading={loading}
        width={isMobile ? '100%' : 500}
        style={isMobile ? { top: 0, paddingBottom: 0, maxWidth: '100vw' } : {}}
      >
        <Form
          form={rechargeForm}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="充值金额"
            name="amount"
            rules={[
              { required: true, message: '请输入充值金额' },
              { type: 'number', min: 0.01, message: '充值金额必须大于0' },
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="请输入充值金额"
              min={0.01}
              precision={2}
              addonBefore="¥"
            />
          </Form.Item>

          <Form.Item
            label="备注"
            name="description"
          >
            <Input.TextArea
              placeholder="选填，例如：月度充值、活动奖励等"
              rows={3}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AgentsPage;
