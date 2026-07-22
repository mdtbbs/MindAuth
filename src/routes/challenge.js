const express = require('express');
const router = express.Router();
const challengeManager = require('../modules/challenges/challengeManager');

// GET /challenge/random - Get a random challenge question
router.get('/random', async (req, res) => {
  try {
    const csrfToken = req.cookies.csrf_token || 'anonymous';
    const result = await challengeManager.getRandomChallenge(csrfToken);

    if (!result.challenge_id) {
      return res.json({ success: true, challenge_id: null, question: null, message: '暂无问答题' });
    }

    res.json({ success: true, challenge_id: result.challenge_id, question: result.question });
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
    const result = await challengeManager.verifyChallengeAnswer(csrfToken, challenge_id, challenge_answer);

    if (result.error) {
      const statusMap = {
        CHALLENGE_EXPIRED: 400,
        CHALLENGE_MISMATCH: 400,
        CHALLENGE_NOT_FOUND: 400,
        CHALLENGE_FAILED: 400,
      };
      const messageMap = {
        CHALLENGE_EXPIRED: '验证已过期，请刷新获取新题',
        CHALLENGE_MISMATCH: '题目不匹配',
        CHALLENGE_NOT_FOUND: '题目不存在',
        CHALLENGE_FAILED: '问答验证失败次数过多，请稍后再试',
      };
      return res.status(statusMap[result.error] || 400).json({
        success: false,
        code: result.error,
        message: messageMap[result.error] || '验证失败',
      });
    }

    if (result.verified) {
      return res.json({ success: true, verified: true });
    }

    // Wrong answer — return new question
    res.json({
      success: false,
      code: result.code,
      message: '答案错误，请重试',
      attempts_left: result.attemptsLeft,
      new_challenge_id: result.newChallenge.challenge_id,
      new_question: result.newChallenge.question,
    });
  } catch (err) {
    console.error('[Challenge] verify error:', err);
    res.status(500).json({ success: false, message: '验证失败' });
  }
});

module.exports = router;
