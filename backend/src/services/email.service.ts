import { query } from '../models/database';
import nodemailer from 'nodemailer';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    this.initTransporter();
  }

  private initTransporter() {
    const emailHost = process.env.EMAIL_HOST;
    const emailPort = process.env.EMAIL_PORT;
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailHost || !emailPort || !emailUser || !emailPass) {
      console.warn('⚠️ 邮件服务未配置，邮件功能将不可用');
      return;
    }

    const config: EmailConfig = {
      host: emailHost,
      port: parseInt(emailPort),
      secure: parseInt(emailPort) === 465, // 465 使用 SSL，587 使用 TLS
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    };

    this.transporter = nodemailer.createTransport(config);
    console.log('✅ 邮件服务初始化成功');
  }

  /**
   * 生成 6 位数字验证码
   */
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * 发送验证码邮件
   */
  async sendVerificationCode(
    userId: number,
    email: string,
    type: 'email_binding' | 'login_verification'
  ): Promise<{ success: boolean; message: string; code?: string }> {
    if (!this.transporter) {
      return {
        success: false,
        message: '邮件服务未配置',
      };
    }

    try {
      // 生成验证码
      const code = this.generateCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟后过期

      // 保存验证码到数据库
      await query(
        `INSERT INTO verification_codes (user_id, email, code, type, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, email, code, type, expiresAt]
      );

      // 发送邮件
      const subject = type === 'email_binding' ? '绑定邮箱验证码' : '登录验证码';
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1890ff;">智投系统 - ${subject}</h2>
          <p>您好，</p>
          <p>您的验证码是：</p>
          <div style="background-color: #f0f2f5; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1890ff;">
            ${code}
          </div>
          <p style="color: #666; margin-top: 20px;">验证码有效期为 10 分钟，请尽快使用。</p>
          <p style="color: #999; font-size: 12px; margin-top: 40px;">
            如果这不是您的操作，请忽略此邮件。
          </p>
        </div>
      `;

      await this.transporter.sendMail({
        from: `"智投系统" <${process.env.EMAIL_USER}>`,
        to: email,
        subject,
        html,
      });

      console.log(`✅ 验证码邮件已发送到 ${email}`);
      return {
        success: true,
        message: '验证码已发送',
        code: process.env.NODE_ENV === 'development' ? code : undefined, // 开发环境返回验证码
      };
    } catch (error: any) {
      console.error('❌ 发送验证码邮件失败:', error);
      return {
        success: false,
        message: '发送验证码失败',
      };
    }
  }

  /**
   * 验证验证码
   */
  async verifyCode(
    userId: number,
    email: string,
    code: string,
    type: 'email_binding' | 'login_verification'
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 查找未使用且未过期的验证码
      const result = await query(
        `SELECT id, code, expires_at
         FROM verification_codes
         WHERE user_id = $1 AND email = $2 AND type = $3 AND used = FALSE
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, email, type]
      );

      if (result.rows.length === 0) {
        return {
          success: false,
          message: '验证码不存在或已使用',
        };
      }

      const record = result.rows[0];

      // 检查是否过期
      if (new Date() > new Date(record.expires_at)) {
        return {
          success: false,
          message: '验证码已过期',
        };
      }

      // 验证码是否匹配
      if (record.code !== code) {
        return {
          success: false,
          message: '验证码错误',
        };
      }

      // 标记为已使用
      await query(
        `UPDATE verification_codes SET used = TRUE WHERE id = $1`,
        [record.id]
      );

      // 如果是邮箱绑定，更新用户邮箱验证状态
      if (type === 'email_binding') {
        await query(
          `UPDATE users SET email_verified = TRUE, email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [email, userId]
        );
      }

      return {
        success: true,
        message: '验证成功',
      };
    } catch (error: any) {
      console.error('❌ 验证验证码失败:', error);
      return {
        success: false,
        message: '验证失败',
      };
    }
  }

  /**
   * 清理过期的验证码
   */
  async cleanupExpiredCodes(): Promise<void> {
    try {
      await query(
        `DELETE FROM verification_codes WHERE expires_at < NOW()`,
        []
      );
      console.log('✅ 已清理过期验证码');
    } catch (error) {
      console.error('❌ 清理过期验证码失败:', error);
    }
  }
}

export const emailService = new EmailService();
