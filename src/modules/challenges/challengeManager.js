/**
 * challengeManager — Centralized challenge question lifecycle module.
 *
 * This is the ONLY seam for creating, listing, selecting, verifying, and
 * deleting challenge questions.  Route adapters should be thin HTTP wrappers.
 *
 * Design invariants:
 *   - Challenge selection avoids ORDER BY RAND() (count-based random instead)
 *   - Session state is stored in Redis with a 30-min TTL
 *   - Answer verification is case-insensitive, trimmed, bcrypt-compared
 *   - Admin CRUD operations are audit-logged by the caller (admin routes)
 */

const bcrypt = require('bcrypt');
const { pool } = require('../../db');
const { client } = require('../../redis');

// ─── Constants ────────────────────────────────────────────────

const CHALLENGE_SESSION_TTL = 30 * 60; // 30 minutes
const MAX_ATTEMPTS = 3;

// ─── Selection (count-based random, no ORDER BY RAND()) ──────

/**
 * Pick a random enabled challenge using COUNT + OFFSET.
 * Falls back gracefully when no enabled challenges exist.
 *
 * @param {number} [excludeId] - optional ID to exclude (for "give me another")
 * @returns {Promise<{ id: number, question: string } | null>}
 */
async function pickRandomEnabled(excludeId) {
  let countSql = 'SELECT COUNT(*) as cnt FROM challenge_questions WHERE enabled = 1';
  const countParams = [];

  if (excludeId) {
    countSql += ' AND id <> ?';
    countParams.push(excludeId);
  }

  const [countRows] = await pool.execute(countSql, countParams);
  const total = countRows[0].cnt;
  if (total === 0) return null;

  const offset = Math.floor(Math.random() * total);

  let selectSql = 'SELECT id, question FROM challenge_questions WHERE enabled = 1';
  const selectParams = [];
  if (excludeId) {
    selectSql += ' AND id <> ?';
    selectParams.push(excludeId);
  }
  // OFFSET cannot be parameterized in prepared statements; safe integer interpolation
  selectSql += ` LIMIT 1 OFFSET ${offset}`;

  const [rows] = await pool.execute(selectSql, selectParams);
  return rows[0] || null;
}

// ─── Session helpers ─────────────────────────────────────────

function sessionKey(csrfToken) {
  return `challenge_session:${csrfToken || 'anonymous'}`;
}

// ─── Public interface ────────────────────────────────────────

/**
 * Get a random enabled challenge and start a verification session.
 *
 * @param {string} csrfToken - from req.cookies.csrf_token
 * @returns {Promise<{ challenge_id: number|null, question: string|null }>}
 */
async function getRandomChallenge(csrfToken) {
  const challenge = await pickRandomEnabled();
  if (!challenge) return { challenge_id: null, question: null };

  const key = sessionKey(csrfToken);
  await client.setEx(key, CHALLENGE_SESSION_TTL, JSON.stringify({
    question_id: challenge.id,
    attempts: 0,
  }));

  return { challenge_id: challenge.id, question: challenge.question };
}

/**
 * Verify a challenge answer within an active session.
 *
 * Returns one of several status shapes:
 *   { verified: true }
 *   { verified: false, code, attemptsLeft, newChallenge }
 *   { error: code }
 *
 * @param {string} csrfToken
 * @param {number|string} challengeId
 * @param {string} answer
 * @returns {Promise<object>}
 */
async function verifyChallengeAnswer(csrfToken, challengeId, answer) {
  const key = sessionKey(csrfToken);
  const sessionData = await client.get(key);

  if (!sessionData) {
    return { error: 'CHALLENGE_EXPIRED' };
  }

  const session = JSON.parse(sessionData);
  if (session.question_id !== parseInt(challengeId)) {
    return { error: 'CHALLENGE_MISMATCH' };
  }

  const [rows] = await pool.execute(
    'SELECT answer_hash FROM challenge_questions WHERE id = ? AND enabled = 1',
    [challengeId]
  );
  if (rows.length === 0) {
    return { error: 'CHALLENGE_NOT_FOUND' };
  }

  const match = await bcrypt.compare(
    String(answer).trim().toLowerCase(),
    rows[0].answer_hash
  );

  if (match) {
    await client.del(key);
    return { verified: true };
  }

  // Wrong answer
  session.attempts += 1;
  if (session.attempts >= MAX_ATTEMPTS) {
    await client.del(key);
    return { error: 'CHALLENGE_FAILED' };
  }

  await client.setEx(key, CHALLENGE_SESSION_TTL, JSON.stringify(session));

  // Give a new question (exclude current)
  const newChallenge = await pickRandomEnabled(session.question_id);
  if (!newChallenge) {
    return { error: 'CHALLENGE_FAILED' };
  }

  session.question_id = newChallenge.id;
  await client.setEx(key, CHALLENGE_SESSION_TTL, JSON.stringify(session));

  return {
    verified: false,
    code: 'WRONG_ANSWER',
    attemptsLeft: MAX_ATTEMPTS - session.attempts,
    newChallenge: { challenge_id: newChallenge.id, question: newChallenge.question },
  };
}

/**
 * Verify a challenge answer during registration.
 * Unlike verifyChallengeAnswer, this does NOT issue a new question on failure —
 * it simply returns success/failure. The session is consumed on success.
 *
 * @param {string} csrfToken
 * @param {number|string} challengeId
 * @param {string} answer
 * @returns {Promise<{ success: boolean, code?: string }>}
 */
async function verifyForRegistration(csrfToken, challengeId, answer) {
  const key = sessionKey(csrfToken);
  const sessionData = await client.get(key);

  if (!sessionData) {
    return { success: false, code: 'CHALLENGE_EXPIRED' };
  }

  const session = JSON.parse(sessionData);
  if (session.question_id !== parseInt(challengeId)) {
    return { success: false, code: 'CHALLENGE_MISMATCH' };
  }

  const [qRows] = await pool.execute(
    'SELECT answer_hash FROM challenge_questions WHERE id = ? AND enabled = 1',
    [challengeId]
  );
  if (qRows.length === 0) {
    return { success: false, code: 'CHALLENGE_NOT_FOUND' };
  }

  const match = await bcrypt.compare(
    String(answer || '').trim().toLowerCase(),
    qRows[0].answer_hash
  );

  if (!match) {
    return { success: false, code: 'CHALLENGE_FAILED' };
  }

  await client.del(key);
  return { success: true };
}

/**
 * Check if any challenge questions are enabled (i.e., verification is required).
 *
 * @returns {Promise<boolean>}
 */
async function isChallengeRequired() {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) as count FROM challenge_questions WHERE enabled = 1'
  );
  return rows[0].count > 0;
}

// ─── Admin CRUD ──────────────────────────────────────────────

/**
 * List all challenge questions (for admin panel).
 * @returns {Promise<Array>}
 */
async function listChallenges() {
  const [rows] = await pool.execute(
    'SELECT id, question, enabled, created_at FROM challenge_questions ORDER BY created_at DESC'
  );
  return rows;
}

/**
 * Create a new challenge question.
 *
 * @param {string} question
 * @param {string} answer
 * @returns {Promise<{ id: number }>}
 */
async function createChallenge(question, answer) {
  const answer_hash = await bcrypt.hash(String(answer).trim().toLowerCase(), 10);
  const [result] = await pool.execute(
    'INSERT INTO challenge_questions (question, answer_hash) VALUES (?, ?)',
    [question, answer_hash]
  );
  return { id: result.insertId };
}

/**
 * Update a challenge question.
 *
 * @param {number} id
 * @param {{ question?: string, answer?: string, enabled?: boolean }} data
 * @returns {Promise<{ updated: boolean }>}
 */
async function updateChallenge(id, data) {
  const updates = [];
  const params = [];

  if (data.question !== undefined) {
    updates.push('question = ?');
    params.push(data.question);
  }
  if (data.answer !== undefined) {
    const answer_hash = await bcrypt.hash(String(data.answer).trim().toLowerCase(), 10);
    updates.push('answer_hash = ?');
    params.push(answer_hash);
  }
  if (data.enabled !== undefined) {
    updates.push('enabled = ?');
    params.push(data.enabled ? 1 : 0);
  }

  if (updates.length === 0) return { updated: false };

  params.push(id);
  const [result] = await pool.execute(
    `UPDATE challenge_questions SET ${updates.join(', ')} WHERE id = ?`,
    params
  );

  return { updated: result.affectedRows > 0 };
}

/**
 * Delete a challenge question.
 *
 * @param {number} id
 * @returns {Promise<{ deleted: boolean }>}
 */
async function deleteChallenge(id) {
  const [result] = await pool.execute('DELETE FROM challenge_questions WHERE id = ?', [id]);
  return { deleted: result.affectedRows > 0 };
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  getRandomChallenge,
  verifyChallengeAnswer,
  verifyForRegistration,
  isChallengeRequired,
  listChallenges,
  createChallenge,
  updateChallenge,
  deleteChallenge,
  // Exposed for testing
  _pickRandomEnabled: pickRandomEnabled,
  _sessionKey: sessionKey,
  CHALLENGE_SESSION_TTL,
  MAX_ATTEMPTS,
};
