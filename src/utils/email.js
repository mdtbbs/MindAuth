/**
 * Email sending utility
 * Supports console logging (development) and SMTP (production)
 */

const nodemailer = require('nodemailer');
const { pool } = require('../db');
const { decryptSecret } = require('./secrets');
const { buildPasswordResetEmail, buildVerificationEmail, buildRegistrationCodeEmail } = require('./emailTemplates');

const isDevelopment = process.env.NODE_ENV !== 'production';

async function getEmailConfig() {
  try {
    // 先尝试数据库配置
    const [rows] = await pool.execute('SELECT host, port, user, password, `from`, secure FROM email_config WHERE id = 1');
    const dbConfig = rows[0] ? { ...rows[0], password: decryptSecret(rows[0].password) } : rows[0];

    // 如果数据库有完整配置（包括密码），使用数据库
    if (dbConfig && dbConfig.host && dbConfig.user && dbConfig.password) {
      return dbConfig;
    }

    // 回退到环境变量
    const envConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM,
      secure: process.env.SMTP_SECURE === 'true'
    };

    if (envConfig.host && envConfig.user && envConfig.password) {
      console.log('Using SMTP config from environment variables');
      return envConfig;
    }

    // 返回数据库配置（可能不完整）
    return dbConfig;
  } catch (err) {
    console.error('Failed to get email config:', err);

    // 尝试环境变量作为最终回退
    const envConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM,
      secure: process.env.SMTP_SECURE === 'true'
    };

    if (envConfig.host && envConfig.user && envConfig.password) {
      return envConfig;
    }

    return null;
  }
}

function createTransporter(config) {
  if (!config || !config.host) {
    return null;
  }

  // 验证凭据是否有效
  if (!config.user || !config.password) {
    console.error('SMTP config missing user or password');
    return null;
  }

  // secure 在数据库里可能是 TINYINT (1/0)、布尔值、或字符串 ("1"/"0")
  // 统一转换为布尔值，避免 === 1 在 mysql2 返回 boolean 时永远 false
  const secureFlag = config.secure === true || config.secure === 1 || config.secure === '1';

  // secure: true  → 端口 465 implicit TLS，连接本身就要求 TLS
  // secure: false → 端口 587 STARTTLS，requireTLS 强制升级，拒绝裸连
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: secureFlag,
    requireTLS: !secureFlag,
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
  if (!config || !config.host || !config.user || !config.password) {
    throw new Error('邮件服务未配置，请在管理后台设置 SMTP 或配置环境变量');
  }

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

async function sendPasswordResetEmail(email, resetLink, locale) {
  const { subject, html } = buildPasswordResetEmail(locale, resetLink);
  return sendEmail(email, subject, html);
}

async function sendVerificationEmail(email, verifyLink, locale) {
  const { subject, html } = buildVerificationEmail(locale, verifyLink);
  return sendEmail(email, subject, html);
}

/**
 * Send a 6-digit email verification code for registration.
 * Used by POST /api/register/send-code before account creation.
 * @param {string} email - recipient email address
 * @param {string} code - 6-digit numeric code (plaintext, valid 5 min)
 * @returns {Promise<object>} send result
 */
async function sendRegistrationCodeEmail(email, code, locale) {
  const { subject, html } = buildRegistrationCodeEmail(locale, code);
  return sendEmail(email, subject, html);
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail, sendRegistrationCodeEmail, sendEmail, getEmailConfig };
