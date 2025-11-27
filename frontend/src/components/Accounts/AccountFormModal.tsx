import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Switch,
  InputNumber,
  Row,
  Col,
  Tabs,
  Card,
  Space,
  message,
  Divider,
  Button,
  Tooltip,
  Radio,
  Alert,
} from 'antd';
import type { CrownAccount, Group, CrownAccountCreateRequest, InitType } from '../../types';
import { accountApi, groupApi, crownApi } from '../../services/api';
import { ReloadOutlined, CheckCircleOutlined, KeyOutlined, SyncOutlined } from '@ant-design/icons';
import { generateAccountPassword, generateAccountUsername } from '../../utils/credentials';

const { Option } = Select;

const DEVICE_OPTIONS = [
  'iPhone 17',
  'iPhone 16',
  'iPhone 15',
  'iPhone 14',
  'iPhone 13',
  'iPhone 12',
  'iPhone 11',
  'iPhone Xs',
  'iPhone X',
  'iPhone 8',
  'iPhone 7',
  'iPhone 6s',
  'iPhone 6',
  'Android',
  'Desktop',
];

interface AccountFormModalProps {
  visible: boolean;
  account: CrownAccount | null;
  groups: Group[];
  onCancel: () => void;
  onSubmit: () => void;
  onGroupCreated?: (group: Group) => void;
}

const AccountFormModal: React.FC<AccountFormModalProps> = ({
  visible,
  account,
  groups,
  onCancel,
  onSubmit,
  onGroupCreated,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [localGroups, setLocalGroups] = useState<Group[]>(groups);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [initType, setInitType] = useState<InitType>('full');
  const [fetchingLimits, setFetchingLimits] = useState(false);
  const [limitsData, setLimitsData] = useState<any>(null); // 存储完整的限额数据

  // 格式化金额，处理 null/undefined
  const formatLimit = useCallback((value: any): string => {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    const num = Number(value);
    if (Number.isNaN(num)) {
      return '-';
    }
    return num.toLocaleString();
  }, []);

  const regenerateCredential = useCallback((field: 'username' | 'password') => {
    const value = field === 'username' ? generateAccountUsername() : generateAccountPassword();
    form.setFieldsValue({ [field]: value });
  }, [form]);

  const handleFetchLimits = useCallback(async () => {
    try {
      // 验证必填字段
      const username = form.getFieldValue('username');
      const password = form.getFieldValue('password');

      if (!username || !password) {
        message.warning('请先填写账号和密码');
        return;
      }

      setFetchingLimits(true);
      message.loading({ content: '正在获取账号额度设置...', key: 'fetchLimits', duration: 0 });

      // 如果是编辑模式且账号已存在，使用账号ID
      if (account?.id) {
        const response = await crownApi.getAccountSettings(account.id, 'FT');

        if (response.success && response.data) {
          console.log('账号设置响应:', response.data);

          // 解析 XML 数据并自动填充到表单
          const xmlData = response.data;

          const parsedLimits: any = { football: {}, basketball: {} };

          if (typeof xmlData === 'string' && xmlData.includes('<FT>')) {
            // 解析足球限额
            const ftMatch = xmlData.match(/<FT>(.*?)<\/FT>/s);
            if (ftMatch) {
              const ftContent = ftMatch[1];

              // 提取限额值的辅助函数
              const extractLimits = (tag: string): { max: number | null; min: number | null } => {
                const maxRegex = new RegExp(`<${tag}><max>([^<]+)<\\/max>`);
                const minRegex = new RegExp(`<${tag}><min>([^<]+)<\\/min>`);
                const maxMatch = ftContent.match(maxRegex);
                const minMatch = ftContent.match(minRegex);
                return {
                  max: maxMatch ? parseInt(maxMatch[1].replace(/,/g, ''), 10) : null,
                  min: minMatch ? parseInt(minMatch[1].replace(/,/g, ''), 10) : null,
                };
              };

              // 提取所有限额类型
              parsedLimits.football.R = extractLimits('R');     // 让球、大小、单双
              parsedLimits.football.RE = extractLimits('RE');   // 滚球让球、滚球大小、滚球单双
              parsedLimits.football.M = extractLimits('M');     // 独赢、滚球独赢
              parsedLimits.football.DT = extractLimits('DT');   // 其他
              parsedLimits.football.RDT = extractLimits('RDT'); // 滚球其他

              // 填充到表单（保持向后兼容）
              form.setFieldsValue({
                football_prematch_limit: parsedLimits.football.R.max,
                football_live_limit: parsedLimits.football.RE.max,
              });
            }
          }

          // 获取篮球限额
          const bkResponse = await crownApi.getAccountSettings(account.id, 'BK');
          if (bkResponse.success && bkResponse.data) {
            const bkXmlData = bkResponse.data;

            if (typeof bkXmlData === 'string' && bkXmlData.includes('<BK>')) {
              const bkMatch = bkXmlData.match(/<BK>(.*?)<\/BK>/s);
              if (bkMatch) {
                const bkContent = bkMatch[1];

                const extractLimits = (tag: string): { max: number | null; min: number | null } => {
                  const maxRegex = new RegExp(`<${tag}><max>([^<]+)<\\/max>`);
                  const minRegex = new RegExp(`<${tag}><min>([^<]+)<\\/min>`);
                  const maxMatch = bkContent.match(maxRegex);
                  const minMatch = bkContent.match(minRegex);
                  return {
                    max: maxMatch ? parseInt(maxMatch[1].replace(/,/g, ''), 10) : null,
                    min: minMatch ? parseInt(minMatch[1].replace(/,/g, ''), 10) : null,
                  };
                };

                // 提取所有限额类型
                parsedLimits.basketball.DT = extractLimits('DT');  // 其他
                parsedLimits.basketball.M = extractLimits('M');    // 独赢、滚球独赢
                parsedLimits.basketball.R = extractLimits('R');    // 让球、大小、单双
                parsedLimits.basketball.RE = extractLimits('RE');  // 滚球让球、滚球大小、滚球单双

                form.setFieldsValue({
                  basketball_prematch_limit: parsedLimits.basketball.R.max,
                  basketball_live_limit: parsedLimits.basketball.RE.max,
                });
              }
            }
          }

          // 保存完整的限额数据
          setLimitsData(parsedLimits);

          message.success({
            content: '限额信息已自动填充',
            key: 'fetchLimits',
            duration: 3
          });
        } else {
          message.error({ content: response.error || '获取额度设置失败', key: 'fetchLimits' });
        }
      } else {
        // 新增模式：需要先创建临时账号或使用其他方式
        message.warning({ content: '请先保存账号后再获取额度设置', key: 'fetchLimits' });
      }
    } catch (error) {
      console.error('获取限额信息失败:', error);
      message.error({ content: '获取限额信息失败', key: 'fetchLimits' });
    } finally {
      setFetchingLimits(false);
    }
  }, [form, account]);

  useEffect(() => {
    setLocalGroups(groups);
  }, [groups]);

  useEffect(() => {
    if (visible) {
      if (account) {
        // 编辑模式 - 将代理字段转换为 proxy_url 格式
        let proxyUrl = '';
        if (account.proxy_enabled && account.proxy_host && account.proxy_port) {
          const type = (account.proxy_type || 'http').toLowerCase();
          if (account.proxy_username && account.proxy_password) {
            proxyUrl = `${type}://${account.proxy_username}:${account.proxy_password}@${account.proxy_host}:${account.proxy_port}`;
          } else {
            proxyUrl = `${type}://${account.proxy_host}:${account.proxy_port}`;
          }
        }
        form.setFieldsValue({
          ...account,
          stop_profit_limit: account.stop_profit_limit ?? 0,
          proxy_url: proxyUrl,
        });
        setProxyEnabled(account.proxy_enabled);
        setInitType(account.init_type || 'full');

        // 如果账号有 limits_data，加载它
        if (account.limits_data) {
          try {
            const parsed = typeof account.limits_data === 'string'
              ? JSON.parse(account.limits_data)
              : account.limits_data;
            setLimitsData(parsed);
          } catch (error) {
            console.error('解析 limits_data 失败:', error);
            setLimitsData(null);
          }
        } else {
          setLimitsData(null);
        }
      } else {
        // 新增模式
        form.resetFields();
        setProxyEnabled(false);
        setInitType('full');
        setLimitsData(null); // 重置限额数据
        // 设置默认值（不包括账号和密码，由用户填写原始账号密码）
        form.setFieldsValue({
          init_type: 'full',
          game_type: '足球',
          source: '自有',
          currency: 'CNY',
          discount: 1.0,
          note: '高',
          stop_profit_limit: 0,
          device_type: 'iPhone 14',
          proxy_enabled: false,
          football_prematch_limit: 100000,
          football_live_limit: 100000,
          basketball_prematch_limit: 100000,
          basketball_live_limit: 100000,
        });
      }
    } else {
      // 关闭弹窗时重置限额数据
      setLimitsData(null);
    }
  }, [visible, account, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const requestData: CrownAccountCreateRequest = {
        ...values,
        proxy_enabled: proxyEnabled,
      };

      // 根据初始化类型处理账号字段
      const initType = values.init_type || 'none';

      // username 和 password 始终是原始账号和密码
      requestData.original_username = values.username;

      if (initType === 'none') {
        // 不需要初始化：不需要生成新账号和密码
        requestData.initialized_username = undefined;
      } else if (initType === 'password_only') {
        // 仅修改密码：不需要生成新账号，但需要生成新密码
        requestData.initialized_username = undefined;
      } else if (initType === 'full') {
        // 完整初始化：需要生成新账号和新密码
        // initialized_username 由后端自动生成
        requestData.initialized_username = undefined;
      }

      // 处理代理设置
      if (proxyEnabled && values.proxy_url) {
        // 解析代理URL: socks5://user:pass@host:port 或 http://host:port
        const proxyUrl = values.proxy_url.trim();
        const match = proxyUrl.match(/^(https?|socks5):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/i);
        if (match) {
          requestData.proxy_type = match[1].toUpperCase();
          requestData.proxy_username = match[2] || undefined;
          requestData.proxy_password = match[3] || undefined;
          requestData.proxy_host = match[4];
          requestData.proxy_port = parseInt(match[5], 10);
        }
        delete (requestData as any).proxy_url;
      } else {
        requestData.proxy_type = undefined;
        requestData.proxy_host = undefined;
        requestData.proxy_port = undefined;
        requestData.proxy_username = undefined;
        requestData.proxy_password = undefined;
        delete (requestData as any).proxy_url;
      }

      let response;
      if (account) {
        // 编辑模式
        response = await accountApi.updateAccount(account.id, requestData);
      } else {
        // 新增模式
        response = await accountApi.createAccount(requestData);
      }

      if (response.success) {
        message.success(account ? '账号更新成功' : '账号创建成功');

        // 新增模式不自动获取限额，需要账号登录后才能获取

        onSubmit();
      } else {
        // 显示后端返回的错误信息
        message.error(response.error || '保存账号失败');
      }
    } catch (error: any) {
      console.error('Failed to save account:', error);
      // 显示更详细的错误信息
      const errorMessage = error?.response?.data?.error || error?.message || '保存账号失败';
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setProxyEnabled(false);
    onCancel();
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      message.warning('请输入分组名称');
      return;
    }

    try {
      setCreatingGroup(true);
      const response = await groupApi.createGroup({ name });
      if (response.success && response.data) {
        const createdGroup = response.data;
        setLocalGroups(prev => (
          prev.some(group => group.id === createdGroup.id)
            ? prev
            : [...prev, createdGroup]
        ));
        form.setFieldsValue({ group_id: createdGroup.id });
        onGroupCreated?.(createdGroup);
        setNewGroupName('');
        message.success('分组创建成功');
      } else {
        message.error(response.error || '创建分组失败');
      }
    } catch (error) {
      console.error('Failed to create group:', error);
      message.error('创建分组失败');
    } finally {
      setCreatingGroup(false);
    }
  };

  return (
    <Modal
      title={account ? '编辑账号' : '新增账号'}
      open={visible}
      onOk={handleSubmit}
      onCancel={handleCancel}
      confirmLoading={loading}
      width={800}
      maskClosable={false}
    >
      <Form
        form={form}
        layout="vertical"
        size="small"
        style={{ marginTop: -8 }}
        onValuesChange={(changedValues, allValues) => {
          if ('proxy_enabled' in changedValues) {
            setProxyEnabled(allValues.proxy_enabled);
          }

          // 用户选择初始化类型
          if ('init_type' in changedValues) {
            setInitType(changedValues.init_type);
          }
        }}
      >
        <Tabs
          defaultActiveKey="basic"
          items={[
            {
              key: 'basic',
              label: '基本信息',
              children: (
                <>
                  <Row gutter={12}>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="group_id"
                        label="所属分组"
                        rules={[{ required: true, message: '请选择分组' }]}
                        style={{ marginBottom: 12 }}
                      >
                        <Select
                          placeholder="选择分组"
                          dropdownRender={(menu) => (
                            <>
                              {menu}
                              <Divider style={{ margin: '4px 0' }} />
                              <Space style={{ padding: '0 8px 4px' }}>
                                <Input
                                  placeholder="新分组名称"
                                  value={newGroupName}
                                  onChange={(e) => setNewGroupName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleCreateGroup();
                                    }
                                  }}
                                  size="small"
                                />
                                <Button
                                  type="link"
                                  size="small"
                                  onClick={handleCreateGroup}
                                  loading={creatingGroup}
                                >
                                  新增
                                </Button>
                              </Space>
                            </>
                          )}
                        >
                          {localGroups.map(group => (
                            <Option key={group.id} value={group.id}>
                              {group.name}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="username"
                        label="原始账号"
                        tooltip="皇冠账号的原始用户名"
                        rules={[
                          { required: true, message: '请输入原始账号' },
                          { min: 3, message: '账号至少3个字符' },
                        ]}
                        style={{ marginBottom: 12 }}
                      >
                        <Input placeholder="请输入原始账号" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="password"
                        label="原始密码"
                        tooltip="皇冠账号的原始密码"
                        rules={[{ required: true, message: '请输入原始密码' }]}
                        style={{ marginBottom: 12 }}
                      >
                        <Input
                          placeholder="请输入原始密码"
                          type="password"
                          autoComplete="new-password"
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={12}>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="passcode"
                        label="简易密码"
                        tooltip="可选，四位简易登录密码"
                        style={{ marginBottom: 12 }}
                      >
                        <Input placeholder="四位数字" maxLength={4} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={16}>
                      <Form.Item
                        name="display_name"
                        label="显示名称"
                        tooltip="可选，用于在系统中显示的名称"
                        style={{ marginBottom: 12 }}
                      >
                        <Input placeholder="可选，用于显示的名称" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Divider orientation="left" style={{ fontSize: '13px', fontWeight: 500, margin: '8px 0' }}>
                    初始化设置
                  </Divider>

                  <Form.Item
                    name="init_type"
                    style={{ marginBottom: 8 }}
                  >
                    <Radio.Group>
                      <Space size="middle">
                        <Tooltip title="直接使用原始账号和密码登录">
                          <Radio value="none">
                            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                            不初始化
                          </Radio>
                        </Tooltip>
                        <Tooltip title="保持账号不变，系统自动生成新密码">
                          <Radio value="password_only">
                            <KeyOutlined style={{ color: '#1890ff', marginRight: 4 }} />
                            仅改密码
                          </Radio>
                        </Tooltip>
                        <Tooltip title="系统自动生成新账号和新密码">
                          <Radio value="full">
                            <SyncOutlined style={{ color: '#faad14', marginRight: 4 }} />
                            完整初始化
                          </Radio>
                        </Tooltip>
                      </Space>
                    </Radio.Group>
                  </Form.Item>

                  <Divider orientation="left" style={{ fontSize: '13px', fontWeight: 500, margin: '8px 0' }}>
                    其他信息
                  </Divider>

                  <Row gutter={12}>
                    <Col xs={12} sm={4}>
                      <Form.Item name="game_type" label="类型" style={{ marginBottom: 12 }}>
                        <Select>
                          <Option value="足球">足球</Option>
                          <Option value="篮球">篮球</Option>
                          <Option value="综合">综合</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item name="source" label="来源" style={{ marginBottom: 12 }}>
                        <Select>
                          <Option value="自有">自有</Option>
                          <Option value="代理">代理</Option>
                          <Option value="合作">合作</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item name="currency" label="货币" style={{ marginBottom: 12 }}>
                        <Select>
                          <Option value="CNY">CNY</Option>
                          <Option value="USD">USD</Option>
                          <Option value="EUR">EUR</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item
                        name="discount"
                        label="折扣"
                        tooltip="皇冠金额=平台金额÷折扣"
                        rules={[{
                          required: true,
                          message: '请输入',
                        }, {
                          validator: (_, value) => {
                            if (value === undefined || value === null) return Promise.resolve();
                            const numeric = Number(value);
                            if (Number.isNaN(numeric) || numeric <= 0 || numeric > 1) {
                              return Promise.reject(new Error('0-1之间'));
                            }
                            return Promise.resolve();
                          },
                        }]}
                        style={{ marginBottom: 12 }}
                      >
                        <InputNumber min={0.01} max={1} step={0.01} precision={2} placeholder="0.80" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item name="note" label="备注" style={{ marginBottom: 12 }}>
                        <Select>
                          <Option value="高">高</Option>
                          <Option value="中">中</Option>
                          <Option value="低">低</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item name="device_type" label="设备" style={{ marginBottom: 12 }}>
                        <Select placeholder="选择设备">
                          {DEVICE_OPTIONS.map(device => (
                            <Option key={device} value={device}>{device}</Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ),
            },
            {
              key: 'proxy',
              label: '代理设置',
              children: (
                <>
                  <Row gutter={12}>
                    <Col xs={8} sm={4}>
                      <Form.Item name="proxy_enabled" label="启用" valuePropName="checked" style={{ marginBottom: 12 }}>
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col xs={16} sm={20}>
                      <Form.Item
                        name="proxy_url"
                        label="代理链接"
                        style={{ marginBottom: 8 }}
                        rules={proxyEnabled ? [{ required: true, message: '请输入代理链接' }] : []}
                      >
                        <Input
                          placeholder="socks5://user:pass@host:port"
                          disabled={!proxyEnabled}
                        />
                      </Form.Item>
                      <div style={{ fontSize: 11, color: '#999', marginTop: -4 }}>
                        示例: socks5://aVhZ526k:DW7LPhiE@91.124.222.142:48651 或 http://127.0.0.1:8080
                      </div>
                    </Col>
                  </Row>
                </>
              ),
            },
            {
              key: 'limits',
              label: '限额设置',
              children: (
                <>
                  <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
                    <Col flex="auto">
                      <span style={{ color: '#666', fontSize: 12 }}>手动输入限额或从皇冠获取</span>
                    </Col>
                    <Col>
                      <Button
                        type="primary"
                        size="small"
                        icon={<SyncOutlined spin={fetchingLimits} />}
                        onClick={handleFetchLimits}
                        loading={fetchingLimits}
                        disabled={!account?.id}
                      >
                        {account?.id ? '获取限额' : '保存后可用'}
                      </Button>
                    </Col>
                  </Row>

                  <Row gutter={12}>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="stop_profit_limit"
                        label="止盈金额"
                        tooltip="达到该金额后停止自动下注"
                        rules={[
                          { required: true, message: '必填' },
                          { validator: async (_, value) => { if (Number(value) < 0) throw new Error('不能为负'); } },
                        ]}
                        style={{ marginBottom: 12 }}
                      >
                        <InputNumber min={0} step={100} precision={2} placeholder="0" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={8}>
                      <Form.Item name="football_prematch_limit" label="足球赛前" style={{ marginBottom: 12 }}>
                        <InputNumber min={0} placeholder="100000" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={8}>
                      <Form.Item name="football_live_limit" label="足球滚球" style={{ marginBottom: 12 }}>
                        <InputNumber min={0} placeholder="100000" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col xs={24} sm={8} />
                    <Col xs={12} sm={8}>
                      <Form.Item name="basketball_prematch_limit" label="篮球赛前" style={{ marginBottom: 12 }}>
                        <InputNumber min={0} placeholder="100000" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={8}>
                      <Form.Item name="basketball_live_limit" label="篮球滚球" style={{ marginBottom: 12 }}>
                        <InputNumber min={0} placeholder="100000" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>

                  {limitsData && limitsData.football && Object.keys(limitsData.football).length > 0 && (
                    <Card title="足球限额详情" size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: '8px 12px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                            <th style={{ padding: '6px 4px', textAlign: 'left', fontWeight: 600 }}>类型</th>
                            <th style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>单场最高</th>
                            <th style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>单注最高</th>
                          </tr>
                        </thead>
                        <tbody>
                          {limitsData.football.R && (
                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '6px 4px' }}>让球/大小/单双</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.R.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.R.min)}</td>
                            </tr>
                          )}
                          {limitsData.football.RE && (
                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '6px 4px' }}>滚球让球/大小/单双</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.RE.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.RE.min)}</td>
                            </tr>
                          )}
                          {limitsData.football.M && (
                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '6px 4px' }}>独赢/滚球独赢</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.M.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.M.min)}</td>
                            </tr>
                          )}
                          {limitsData.football.DT && (
                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '6px 4px' }}>其他</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.DT.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.DT.min)}</td>
                            </tr>
                          )}
                          {limitsData.football.RDT && (
                            <tr>
                              <td style={{ padding: '6px 4px' }}>滚球其他</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.RDT.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.football.RDT.min)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </Card>
                  )}

                  {limitsData && limitsData.basketball && Object.keys(limitsData.basketball).length > 0 && (
                    <Card title="篮球限额详情" size="small" style={{ marginBottom: 8 }} bodyStyle={{ padding: '8px 12px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                            <th style={{ padding: '6px 4px', textAlign: 'left', fontWeight: 600 }}>类型</th>
                            <th style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>单场最高</th>
                            <th style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600 }}>单注最高</th>
                          </tr>
                        </thead>
                        <tbody>
                          {limitsData.basketball.R && (
                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '6px 4px' }}>让球/大小/单双</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.basketball.R.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.basketball.R.min)}</td>
                            </tr>
                          )}
                          {limitsData.basketball.RE && (
                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '6px 4px' }}>滚球让球/大小/单双</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.basketball.RE.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.basketball.RE.min)}</td>
                            </tr>
                          )}
                          {limitsData.basketball.M && (
                            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '6px 4px' }}>独赢/滚球独赢</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.basketball.M.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.basketball.M.min)}</td>
                            </tr>
                          )}
                          {limitsData.basketball.DT && (
                            <tr>
                              <td style={{ padding: '6px 4px' }}>其他</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.basketball.DT.max)}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatLimit(limitsData.basketball.DT.min)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </Card>
                  )}
                </>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
};

export default AccountFormModal;
