const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { client } = require('../redis');
const bcrypt = require('bcrypt');

const CHALLENGE_SESSION_TTL = 30 * 60; // 30 minutes

// GET /challenge/random - Get a random challenge question
router.get('/random', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, question FROM challenge_questions WHERE enabled = 1 ORDER BY RAND() LIMIT 1'
    );
    if (rows.length === 0) {
      return res.json({ success: true, challenge_id: null, question: null, message: '暂无问答题' });
    }

    const challenge = rows[0];
    const csrfToken = req.cookies.csrf_token || 'anonymous';
    const sessionKey = `challenge_session:${csrfToken}`;

    await client.setEx(sessionKey, CHALLENGE_SESSION_TTL, JSON.stringify({
      question_id: challenge.id,
      attempts: 0,
    }));

    res.json({ success: true, challenge_id: challenge.id, question: challenge.question });
  } catch (err) {
    console.error('[Challenge] random error:', err);
    res.status(500).json({ success: false, message: '获取验证问题失败' });
  }
});

// POST /challenge/verify - Verify challenge answer (returns new question on failure)
router.post('/verify', async (req, res) => {
  try {
    const { challenge_id, challenge_answer } = req.body;
    if (!challenge_id || !challenge_answer) {
      return res.status(400).json({ success: false, code: 'MISSING_PARAMS', message: '缺少参数' });
    }

    const csrfToken = req.cookies.csrf_token || 'anonymous';
    const sessionKey = `challenge_session:${csrfToken}`;
    const sessionData = await client.get(sessionKey);

    if (!sessionData) {
      return res.status(400).json({ success: false, code: 'CHALLENGE_EXPIRED', message: '验证已过期，请刷新获取新题' });
    }

    const session = JSON.parse(sessionData);
    if (session.question_id !== parseInt(challenge_id)) {
      return res.status(400).json({ success: false, code: 'CHALLENGE_MISMATCH', message: '题目不匹配' });
    }

    const [rows] = await pool.execute(
      'SELECT answer_hash FROM challenge_questions WHERE id = ? AND enabled = 1',
      [challenge_id]
    );
    if (rows.length === 0) {
      return res.status(400).json({ success: false, code: 'CHALLENGE_NOT_FOUND', message: '题目不存在' });
    }

    const match = await bcrypt.compare(String(challenge_answer).trim().toLowerCase(), rows[0].answer_hash);

    if (match) {
      await client.del(sessionKey);
      return res.json({ success: true, verified: true });
    }

    // Wrong answer
    session.attempts += 1;
    if (session.attempts >= 3) {
      await client.del(sessionKey);
      return res.status(400).json({ success: false, code: 'CHALLENGE_FAILED', message: '问答验证失败次数过多，请稍后再试' });
    }

    await client.setEx(sessionKey, CHALLENGE_SESSION_TTL, JSON.stringify(session));

    // Give a new question
    const [newRows] = await pool.execute(
      'SELECT id, question FROM challenge_questions WHERE enabled = 1 AND id <> ? ORDER BY RAND() LIMIT 1',
      [challenge_id]
    );
    if (newRows.length === 0) {
      return res.status(400).json({ success: false, code: 'CHALLENGE_FAILED', message: '问答验证失败' });
    }

    session.question_id = newRows[0].id;
    await client.setEx(sessionKey, CHALLENGE_SESSION_TTL, JSON.stringify(session));

    res.json({
      success: false,
      code: 'WRONG_ANSWER',
      message: '答案错误，请重试',
      attempts_left: 3 - session.attempts,
      new_challenge_id: newRows[0].id,
      new_question: newRows[0].question,
    });
  } catch (err) {
    console.error('[Challenge] verify error:', err);
    res.status(500).json({ success: false, message: '验证失败' });
  }
});

module.exports = router;
