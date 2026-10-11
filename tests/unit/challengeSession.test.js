/**
 * Unit tests for challenge session scoping.
 *
 * Two regressions are locked down here:
 *   1. Sessions were keyed by the CSRF token — a 24 h value shared by every
 *      tab — with an `'anonymous'` fallback, so a second tab overwrote the
 *      first tab's question and all cookieless callers shared one session.
 *   2. A session held a single question slot, so verifying one consumed the
 *      whole session even when another tab still held an unanswered question.
 */
process.env.USE_MEMORY_REDIS = '1';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

const questions = [];
// Deterministic stand-in for the random OFFSET: hand out enabled questions in
// id order, one per pick, so tests can reason about which question a caller got.
let pickCursor = 0;

const mockPool = {
  execute: async (sql, params) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const enabled = questions.filter((q) => q.enabled === 1);

    if (/FROM challenge_questions WHERE id = \? AND enabled = 1/.test(normalized)) {
      const row = questions.find((q) => q.id === Number(params[0]) && q.enabled === 1);
      return [row ? [{ answer_hash: row.answer_hash }] : []];
    }
    if (/COUNT\(\*\) as cnt FROM challenge_questions/.test(normalized)) {
      const exclude = params.length ? Number(params[0]) : null;
      return [[{ cnt: enabled.filter((q) => q.id !== exclude).length }]];
    }
    if (/SELECT id, question FROM challenge_questions WHERE enabled = 1/.test(normalized)) {
      const exclude = params.length ? Number(params[0]) : null;
      const candidates = enabled.filter((q) => q.id !== exclude).sort((a, b) => a.id - b.id);
      if (candidates.length === 0) return [[]];
      const row = candidates[pickCursor++ % candidates.length];
      return [[{ id: row.id, question: row.question }]];
    }
    return [[]];
  },
};

const dbPath = require.resolve('../../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: mockPool } };

const challengeManager = require('../../src/modules/challenges/challengeManager');
const { client } = require('../../src/redis');

beforeEach(() => {
  // Isolate tests: retire every question seeded by earlier cases.
  for (const q of questions) q.enabled = 0;
  pickCursor = 0;
});

async function seed(answerText) {
  const id = questions.length + 1;
  questions.push({ id, question: `Q${id}?`, answer_hash: await bcrypt.hash(answerText, 4), enabled: 1 });
  return id;
}

function fakeRes() {
  const cookies = {};
  return {
    cookies,
    cookie(name, value) { cookies[name] = value; return this; },
  };
}

test('a second tab does not invalidate the first tab question', async () => {
  await seed('one');
  await seed('two');

  const sessionId = 'unit-two-tabs';
  const first = await challengeManager.getRandomChallenge(sessionId);
  const second = await challengeManager.getRandomChallenge(sessionId);
  assert.notEqual(first.challenge_id, second.challenge_id, 'the mock hands out distinct questions');

  // Old single-slot model: the second call overwrote question_id, so the first
  // tab could never verify — it always got CHALLENGE_MISMATCH.
  const firstTry = await challengeManager.verifyForRegistration(sessionId, first.challenge_id, 'one');
  assert.equal(firstTry.success, true, 'the first tab question must still be answerable');

  const secondTry = await challengeManager.verifyForRegistration(sessionId, second.challenge_id, 'two');
  assert.equal(secondTry.success, true, 'the second tab question is answerable too');
});

test('a question never handed to the caller is rejected', async () => {
  await seed('secret');
  const sessionId = 'unit-unknown-question';
  await challengeManager.getRandomChallenge(sessionId);

  const other = await seed('other');
  const result = await challengeManager.verifyForRegistration(sessionId, other, 'other');
  assert.equal(result.success, false);
  assert.equal(result.code, 'CHALLENGE_MISMATCH');
});

test('solving one question leaves the session usable for the other', async () => {
  await seed('alpha');
  await seed('beta');

  const sessionId = 'unit-consume-one';
  const a = await challengeManager.getRandomChallenge(sessionId);
  const b = await challengeManager.getRandomChallenge(sessionId);

  const first = await challengeManager.verifyChallengeAnswer(sessionId, a.challenge_id, 'alpha');
  assert.equal(first.verified, true);

  // The session survives for the other outstanding question; it used to be
  // deleted wholesale on the first successful verification.
  const second = await challengeManager.verifyChallengeAnswer(sessionId, b.challenge_id, 'beta');
  assert.equal(second.verified, true);
});

test('resolving the last outstanding question drops the session', async () => {
  await seed('only');

  const sessionId = 'unit-consume-last';
  const q = await challengeManager.getRandomChallenge(sessionId);
  await challengeManager.verifyChallengeAnswer(sessionId, q.challenge_id, 'only');

  const raw = await client.get(challengeManager._sessionKey(sessionId));
  assert.equal(raw, null, 'must not leave a verified session usable as a free pass');
});

test('resolveSessionId mints a distinct id per caller instead of one shared bucket', () => {
  const resA = fakeRes();
  const resB = fakeRes();
  const idA = challengeManager.resolveSessionId({ cookies: {} }, resA);
  const idB = challengeManager.resolveSessionId({ cookies: {} }, resB);

  assert.ok(idA);
  assert.ok(idB);
  assert.notEqual(idA, idB, 'cookieless callers must not share a session');
  assert.ok(resA.cookies.challenge_session_id);

  const again = challengeManager.resolveSessionId({ cookies: { challenge_session_id: idA } }, fakeRes());
  assert.equal(again, idA);
});

test('wrong-answer flow issues the next question within the same session', async () => {
  await seed('right');
  await seed('wrong-target');

  const sessionId = 'unit-wrong-answer';
  const initial = await challengeManager.getRandomChallenge(sessionId);
  const result = await challengeManager.verifyChallengeAnswer(sessionId, initial.challenge_id, 'nope');

  assert.equal(result.code, 'WRONG_ANSWER');
  assert.equal(result.attemptsLeft, 2);
  assert.ok(result.newChallenge.challenge_id);

  const followed = await challengeManager.verifyChallengeAnswer(sessionId, result.newChallenge.challenge_id, 'nope');
  assert.equal(followed.code, 'WRONG_ANSWER', 'the issued replacement must be accepted as the active question');
});
