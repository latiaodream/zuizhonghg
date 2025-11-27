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
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Group, GroupCreateRequest, TablePagination } from '../types';
import { groupApi, accountApi } from '../services/api';
import dayjs from 'dayjs';

const { Title } = Typography;
const { Search } = Input;

interface GroupWithStats extends Group {
  account_count: number;
}

const GroupsPage: React.FC = () => {
  const [groups, setGroups] = useState<GroupWithStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [pagination, setPagination] = useState<TablePagination>({
    current: 1,
    pageSize: 20,
    total: 0,
  });

  // 模态框状态
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      setLoading(true);

      // 获取分组列表
      const groupsResponse = await groupApi.getGroups();
      if (groupsResponse.success && groupsResponse.data) {
        // 获取账号列表来统计每个分组的账号数量
        const accountsResponse = await accountApi.getAccounts();
        const accounts = accountsResponse.success ? accountsResponse.data || [] : [];

        // 计算每个分组的账号数量
        const groupsWithStats = groupsResponse.data.map(group => {
          const accountCount = accounts.filter(acc => acc.group_id === group.id).length;
          return {
            ...group,
            account_count: accountCount,
          };
        });

        setGroups(groupsWithStats);
        setPagination(prev => ({
          ...prev,
          total: groupsWithStats.length,
        }));
      }
    } catch (error) {
      console.error('Failed to load groups:', error);
      message.error('加载分组列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = () => {
    setEditingGroup(null);
    form.resetFields();
    setFormModalVisible(true);
  };

  const handleEditGroup = (group: Group) => {
    setEditingGroup(group);
    form.setFieldsValue(group);
    setFormModalVisible(true);
  };

  const handleDeleteGroup = async (id: number, accountCount: number) => {
    if (accountCount > 0) {
      message.warning('该分组下还有账号，无法删除');
      return;
    }

    try {
      const response = await groupApi.deleteGroup(id);
      if (response.success) {
        message.success('分组删除成功');
        loadGroups();
      }
    } catch (error) {
      console.error('Failed to delete group:', error);
      message.error('删除分组失败');
    }
  };

  const handleFormSubmit = async () => {
    try {
      const values: GroupCreateRequest = await form.validateFields();

      let response;
      if (editingGroup) {
        // 编辑模式
        response = await groupApi.updateGroup(editingGroup.id, values);
      } else {
        // 新增模式
        response = await groupApi.createGroup(values);
      }

      if (response.success) {
        message.success(editingGroup ? '分组更新成功' : '分组创建成功');
        setFormModalVisible(false);
        loadGroups();
      }
    } catch (error) {
      console.error('Failed to save group:', error);
      message.error('保存分组失败');
    }
  };

  const handleFormCancel = () => {
    setFormModalVisible(false);
    form.resetFields();
    setEditingGroup(null);
  };

  // 过滤分组数据
  const filteredGroups = groups.filter(group =>
    group.name.toLowerCase().includes(searchText.toLowerCase()) ||
    (group.description && group.description.toLowerCase().includes(searchText.toLowerCase()))
  );

  // 表格列定义
  const columns: ColumnsType<GroupWithStats> = [
    {
      title: '分组名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (text: string) => (
        <Space>
          <TeamOutlined style={{ color: '#1890ff' }} />
          <span style={{ fontWeight: 500 }}>{text}</span>
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => text || <span style={{ color: '#999' }}>无描述</span>,
    },
    {
      title: '账号数量',
      dataIndex: 'account_count',
      key: 'account_count',
      width: 120,
      render: (count: number) => (
        <Space>
          <UserOutlined style={{ color: '#52c41a' }} />
          <span style={{ fontWeight: 500 }}>{count}</span>
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 180,
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record: GroupWithStats) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEditGroup(record)}
            />
          </Tooltip>
          <Popconfirm
            title={
              record.account_count > 0
                ? `该分组下有 ${record.account_count} 个账号，无法删除`
                : '确定删除这个分组吗？'
            }
            onConfirm={() => handleDeleteGroup(record.id, record.account_count)}
            okText="确定"
            cancelText="取消"
            disabled={record.account_count > 0}
          >
            <Tooltip title={record.account_count > 0 ? '分组下有账号，无法删除' : '删除'}>
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={record.account_count > 0}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={2}>分组管理</Title>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={8} md={6}>
            <Search
              placeholder="搜索分组"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: '100%' }}
            />
          </Col>
          <Col xs={24} sm={16} md={18}>
            <Space>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreateGroup}
              >
                新增分组
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={loadGroups}
              >
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={filteredGroups}
          rowKey="id"
          loading={loading}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) =>
              `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
          }}
          scroll={{ x: 1000 }}
        />
      </Card>

      {/* 分组表单模态框 */}
      <Modal
        title={editingGroup ? '编辑分组' : '新增分组'}
        open={formModalVisible}
        onOk={handleFormSubmit}
        onCancel={handleFormCancel}
        maskClosable={false}
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            name="name"
            label="分组名称"
            rules={[
              { required: true, message: '请输入分组名称' },
              { min: 2, message: '分组名称至少2个字符' },
              { max: 50, message: '分组名称最多50个字符' },
            ]}
          >
            <Input placeholder="请输入分组名称" />
          </Form.Item>

          <Form.Item
            name="description"
            label="分组描述"
            rules={[
              { max: 200, message: '描述最多200个字符' },
            ]}
          >
            <Input.TextArea
              placeholder="请输入分组描述（可选）"
              rows={3}
              showCount
              maxLength={200}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default GroupsPage;
