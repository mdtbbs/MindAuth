/**
 * Email sending utility
 * Supports console logging (development) and SMTP (production)
 */

const nodemailer = require('nodemailer');
const { pool } = require('../db');

const isDevelopment = process.env.NODE_ENV !== 'production';

async function getEmailConfig() {
  try {
    const [rows] = await pool.execute('SELECT host, port, user, password, `from`, secure FROM email_config WHERE id = 1');
    return rows[0];
  } catch (err) {
    console.error('Failed to get email config:', err);
    return null;
  }
}

function createTransporter(config) {
  if (!config || !config.host) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure === 1,
    auth: {
      user: config.user,
      pass: config.password
    }
  });
}

async function sendEmail(to, subject, htmlContent) {
  const config = await getEmailConfig();

  // Development mode or no SMTP config: log to console
  if (isDevelopment || !config || !config.host) {
    console.log('\n========== EMAIL ==========');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Content: ${htmlContent}`);
    console.log('============================\n');
    return { success: true, mode: 'console' };
  }

  // Production mode: use SMTP
  const transporter = createTransporter(config);

  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: to,
      subject: subject,
      html: htmlContent
    });

    console.log('Email sent:', info.messageId);
    return { success: true, mode: 'smtp', messageId: info.messageId };
  } catch (err) {
    console.error('SMTP send error:', err);
    throw new Error('邮件发送失败: ' + err.message);
  }
}

async function sendPasswordResetEmail(email, resetLink) {
  const subject = '密码重置请求';
  const html = `
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #3b82f6;">密码重置</h2>
      <p>您收到此邮件是因为有人请求重置您的密码。</p>
      <p style="margin: 20px 0;">
        <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 4px;">
          重置密码
        </a>
      </p>
      <p style="color: #666; font-size: 12px;">此链接将在1小时后失效。如果您没有请求重置密码，请忽略此邮件。</p>
    </div>
  `;
  return sendEmail(email, subject, html);
}

async function sendVerificationEmail(email, verifyLink) {
  const subject = '邮箱验证';
  const html = `
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #3b82f6;">验证您的邮箱</h2>
      <p>感谢您注册！请点击下方链接验证您的邮箱地址：</p>
      <p style="margin: 20px 0;">
        <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background: #22c55e; color: white; text-decoration: none; border-radius: 4px;">
          验证邮箱
        </a>
      </p>
      <p style="color: #666; font-size: 12px;">此链接将在1小时后失效。</p>
    </div>
  `;
  return sendEmail(email, subject, html);
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail, sendEmail, getEmailConfig };