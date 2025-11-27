import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Typography, Space, Alert, Divider } from 'antd';
import { ReloadOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { CrownAccount } from '../../types';

const { Paragraph, Text, Title } = Typography;

interface AccountInitializeModalProps {
  open: boolean;
  account: CrownAccount | null;
  onCancel: () => void;
  onSubmit?: (payload: { username: string; password: string }) => Promise<void> | void;
  credentials?: { username: string; password: string };
  onCredentialsChange?: (values: Partial<{ username: string; password: string }>) => void;
  onRegenerate?: (field: 'username' | 'password') => void;
}

const AccountInitializeModal: React.FC<AccountInitializeModalProps> = ({
  open,
  account,
  onCancel,
  onSubmit,
  credentials,
  onCredentialsChange,
  onRegenerate,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const title = useMemo(() => {
    if (!account) {
      return '初始化账号';
    }
    return `初始化账号 - ${account.username}`;
  }, [account]);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setSubmitting(false);
      return;
    }
    if (!credentials) {
      form.resetFields();
      return;
    }
    const currentValues = form.getFieldsValue(['username', 'password']);
    const updates: Partial<{ username: string; password: string }> = {};
    if (credentials.username && credentials.username !== currentValues.username) {
      updates.username = credentials.username;
    }
    if (credentials.password && credentials.password !== currentValues.password) {
      updates.password = credentials.password;
    }
    if (Object.keys(updates).length > 0) {
      form.setFieldsValue(updates);
    }
  }, [open, credentials, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await onSubmit?.(values);
    } catch (error) {
      if (error instanceof Error) {
        console.error('初始化账号失败:', error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={handleSubmit}
      confirmLoading={submitting}
      width={560}
      okText="开始初始化"
      cancelText="取消"
      maskClosable={false}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          message="功能说明"
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text>• 皇冠账号首次登录需强制修改账号和密码</Text>
              <Text>• 系统将自动完成账号创建和密码修改流程</Text>
              <Text>• 原始账号将被保存，方便后续追溯</Text>
              <Text>• 修改成功后，账号卡片将显示：(原始账号 → 新账号)</Text>
            </Space>
          }
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 8 }}
        />

        <Divider style={{ margin: '8px 0' }}>设置新凭证</Divider>

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onValuesChange={(_, allValues: { username?: string; password?: string }) => {
            onCredentialsChange?.({
              username: allValues.username,
              password: allValues.password,
            });
          }}
        >
          <Form.Item
            name="username"
            label="新账号"
            rules={[
              { required: true, message: '请输入新账号' },
              { min: 6, max: 12, message: '账号长度为6-12个字符' },
              { pattern: /^(?=.*[a-zA-Z].*[a-zA-Z])(?=.*\d)[a-zA-Z\d]+$/, message: '至少2个字母+1个数字' }
            ]}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                6-12字符，至少2个字母+1个数字，不能有空格
              </Text>
            }
          >
            <Input
              placeholder="例如：User2024ab"
              maxLength={12}
              suffix={(
                <ReloadOutlined
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRegenerate?.('username');
                  }}
                  style={{ cursor: 'pointer', color: '#1677FF' }}
                  title="重新生成"
                />
              )}
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, max: 12, message: '密码长度为6-12个字符' },
              { pattern: /^[a-zA-Z\d]+$/, message: '只能包含字母和数字' }
            ]}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                6-12字符，字母+数字组合，不能与账号相同
              </Text>
            }
          >
            <Input.Password
              placeholder="例如：Pass2024XY"
              maxLength={12}
              suffix={(
                <ReloadOutlined
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRegenerate?.('password');
                  }}
                  style={{ cursor: 'pointer', color: '#1677FF' }}
                  title="重新生成"
                />
              )}
            />
          </Form.Item>
        </Form>

        <Alert
          message="温馨提示"
          description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              点击输入框右侧的 <ReloadOutlined style={{ margin: '0 2px' }} /> 图标可重新生成符合规则的随机凭证
            </Text>
          }
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
        />
      </Space>
    </Modal>
  );
};

export default AccountInitializeModal;
