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

// Sessions are keyed by a browser-scoped identifier. The CSRF token used to
// serve as that identifier, but it is a 24 h value shared by every tab, and
// cookieless callers all fell into one 'anonymous' bucket.
function sessionKey(identifier) {
  return `challenge_session:${identifier}`;
}

// A session tracks several simultaneously-valid questions: with one slot per
// session, opening a second tab (or answering an older question) invalidated
// the first tab's question and the user just saw CHALLENGE_MISMATCH.
const MAX_ACTIVE_QUESTIONS = 5;

/**
 * Read the active-question map from a stored session, tolerating records
 * written before multi-question support (`{question_id, attempts}`).
 */
function activeQuestions(session) {
  if (session.active && typeof session.active === 'object') return session.active;
  return session.question_id == null ? {} : { [String(session.question_id)]: true };
}

/**
 * Resolve the identifier for the caller's challenge session.
 *
 * Uses a dedicated cookie so two browsers never share one session and a
 * cookieless caller gets its own (rather than joining everyone else's).
 *
 * @param {object} req
 * @param {object} res
 * @returns {string}
 */
function resolveSessionId(req, res) {
  const cookieName = 'challenge_session_id';
  const existing = req.cookies && req.cookies[cookieName];
  if (existing) return existing;
  const id = require('crypto').randomUUID();
  res.cookie(cookieName, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: CHALLENGE_SESSION_TTL * 1000,
  });
  return id;
}

// ─── Public interface ────────────────────────────────────────

/**
 * Get a random enabled challenge and add it to the caller's active set.
 *
 * @param {string} sessionId - from resolveSessionId() in the route layer
 * @returns {Promise<{ challenge_id: number|null, question: string|null }>}
 */
async function getRandomChallenge(sessionId) {
  const challenge = await pickRandomEnabled();
  if (!challenge) return { challenge_id: null, question: null };

  const key = sessionKey(sessionId);
  const existing = await client.get(key);
  const session = existing ? JSON.parse(existing) : { attempts: 0 };
  session.question_id = challenge.id;
  session.active = activeQuestions(session);
  session.active[String(challenge.id)] = true;

  const activeIds = Object.keys(session.active);
  if (activeIds.length > MAX_ACTIVE_QUESTIONS) {
    delete session.active[activeIds[0]];
  }

  await client.setEx(key, CHALLENGE_SESSION_TTL, JSON.stringify(session));

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
 * @param {string} sessionId
 * @param {number|string} challengeId
 * @param {string} answer
 * @returns {Promise<object>}
 */
async function verifyChallengeAnswer(sessionId, challengeId, answer) {
  const key = sessionKey(sessionId);
  const sessionData = await client.get(key);

  if (!sessionData) {
    return { error: 'CHALLENGE_EXPIRED' };
  }

  const session = JSON.parse(sessionData);
  const active = activeQuestions(session);
  // Any question the caller was handed is answerable — a second tab must not
  // invalidate the first tab's question.
  if (!active[String(challengeId)]) {
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
    // Consume only the answered question: other tabs may still hold theirs.
    // The session is dropped once nothing is left to answer, so a verified
    // session isn't reusable as a free pass.
    delete active[String(challengeId)];
    if (Object.keys(active).length === 0) {
      await client.del(key);
    } else {
      session.active = active;
      await client.setEx(key, CHALLENGE_SESSION_TTL, JSON.stringify(session));
    }
    return { verified: true };
  }

  // Wrong answer
  session.attempts = (session.attempts || 0) + 1;
  if (session.attempts >= MAX_ATTEMPTS) {
    await client.del(key);
    return { error: 'CHALLENGE_FAILED' };
  }

  // Give a new question (exclude the one just answered)
  const newChallenge = await pickRandomEnabled(challengeId);
  if (!newChallenge) {
    return { error: 'CHALLENGE_FAILED' };
  }

  delete active[String(challengeId)];
  active[String(newChallenge.id)] = true;
  session.active = active;
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
 * @param {string} sessionId
 * @param {number|string} challengeId
 * @param {string} answer
 * @returns {Promise<{ success: boolean, code?: string }>}
 */
async function verifyForRegistration(sessionId, challengeId, answer) {
  const key = sessionKey(sessionId);
  const sessionData = await client.get(key);

  if (!sessionData) {
    return { success: false, code: 'CHALLENGE_EXPIRED' };
  }

  const session = JSON.parse(sessionData);
  const active = activeQuestions(session);
  if (!active[String(challengeId)]) {
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

  // Consume only the answered question. Deleting the whole session meant a
  // second tab (or a retry after a failed registration step) lost its own
  // unanswered question. Single-use is preserved: the answered question is
  // removed, so it cannot be presented again.
  delete active[String(challengeId)];
  if (Object.keys(active).length === 0) {
    await client.del(key);
  } else {
    session.active = active;
    await client.setEx(key, CHALLENGE_SESSION_TTL, JSON.stringify(session));
  }
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
  resolveSessionId,
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
