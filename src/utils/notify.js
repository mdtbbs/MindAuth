const { pool } = require('../db');
const { sendEmail } = require('./email');

async function getUserEmail(userId) {
  const [rows] = await pool.execute('SELECT email FROM users WHERE id = ?', [userId]);
  return rows[0]?.email || null;
}

async function createNotification({ user_id, type, title, content, ip_address, user_agent, sendEmail: shouldSendEmail = false }) {
  try {
    await pool.execute(
      `INSERT INTO user_notifications (user_id, type, title, content, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        type,
        title,
        content || null,
        ip_address || null,
        user_agent ? String(user_agent).slice(0, 200) : null,
      ]
    );
  } catch (err) {
    console.warn('[Notify] DB write failed:', err.message);
  }

  if (shouldSendEmail) {
    try {
      const email = await getUserEmail(user_id);
      if (email) {
        await sendEmail({
          to: email,
          subject: `[MindAuth] ${title}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #ff6b35;">${title}</h2>
              <p>${content || ''}</p>
              ${ip_address ? `<p style="color: #666; font-size: 12px;">IP: ${ip_address}</p>` : ''}
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="color: #999; font-size: 12px;">此邮件由 MindAuth 自动发送，请勿回复。</p>
            </div>
          `,
        });
      }
    } catch (err) {
      console.warn('[Notify] email send failed:', err.message);
    }
  }
}

module.exports = { createNotification };
