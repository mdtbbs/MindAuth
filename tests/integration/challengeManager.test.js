/**
 * Unit tests for challengeManager — the centralized challenge lifecycle module.
 *
 * Tests verify:
 *   - Random selection avoids ORDER BY RAND() (count-based)
 *   - Session creation and expiry
 *   - Answer verification (correct, wrong, max attempts)
 *   - Registration verification
 *   - Admin CRUD operations
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

process.env.USE_MEMORY_REDIS = '1';
process.env.NODE_ENV = 'test';

const { pool, closePool, runMigrations } = require('../../src/db');
const { client } = require('../../src/redis');
const challengeManager = require('../../src/modules/challenges/challengeManager');
const bcrypt = require('bcrypt');

// Integration test: requires a live MySQL test database (RUN_INTEGRATION=1).
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe('challengeManager', { skip: !RUN_INTEGRATION }, () => {
  before(async () => {
    await runMigrations(pool);
  });

  after(async () => {
    await closePool();
  });

  beforeEach(async () => {
    // Clean up challenge questions
    await pool.execute('DELETE FROM challenge_questions');
  });

  describe('isChallengeRequired', () => {
    it('returns false when no enabled challenges exist', async () => {
      const result = await challengeManager.isChallengeRequired();
      assert.equal(result, false);
    });

    it('returns true when enabled challenges exist', async () => {
      const answer_hash = await bcrypt.hash('answer', 4);
      await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['What is 1+1?', answer_hash]
      );
      const result = await challengeManager.isChallengeRequired();
      assert.equal(result, true);
    });

    it('returns false when only disabled challenges exist', async () => {
      const answer_hash = await bcrypt.hash('answer', 4);
      await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 0)',
        ['What is 1+1?', answer_hash]
      );
      const result = await challengeManager.isChallengeRequired();
      assert.equal(result, false);
    });
  });

  describe('getRandomChallenge', () => {
    it('returns null when no enabled challenges', async () => {
      const result = await challengeManager.getRandomChallenge('test-csrf');
      assert.equal(result.challenge_id, null);
      assert.equal(result.question, null);
    });

    it('returns a challenge and creates a session', async () => {
      const answer_hash = await bcrypt.hash('answer', 4);
      const [insertResult] = await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Test question?', answer_hash]
      );

      const result = await challengeManager.getRandomChallenge('test-csrf');
      assert.equal(result.challenge_id, insertResult.insertId);
      assert.equal(result.question, 'Test question?');

      // Session should exist in Redis
      const sessionKey = `challenge_session:test-csrf`;
      const sessionData = await client.get(sessionKey);
      assert.ok(sessionData);
      const session = JSON.parse(sessionData);
      assert.equal(session.question_id, insertResult.insertId);
      assert.equal(session.attempts, 0);
    });
  });

  describe('verifyChallengeAnswer', () => {
    it('returns verified:true for correct answer', async () => {
      const answer_hash = await bcrypt.hash('correct', 4);
      const [insertResult] = await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Q?', answer_hash]
      );

      // Create a session
      await challengeManager.getRandomChallenge('csrf-verify');

      const result = await challengeManager.verifyChallengeAnswer('csrf-verify', insertResult.insertId, 'correct');
      assert.equal(result.verified, true);

      // Session should be deleted
      const sessionData = await client.get('challenge_session:csrf-verify');
      assert.equal(sessionData, null);
    });

    it('returns error for expired session', async () => {
      const result = await challengeManager.verifyChallengeAnswer('nonexistent', 1, 'answer');
      assert.equal(result.error, 'CHALLENGE_EXPIRED');
    });

    it('returns error for mismatched challenge_id', async () => {
      const answer_hash = await bcrypt.hash('answer', 4);
      const [insertResult] = await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Q?', answer_hash]
      );
      await challengeManager.getRandomChallenge('csrf-mismatch');

      const result = await challengeManager.verifyChallengeAnswer('csrf-mismatch', 99999, 'answer');
      assert.equal(result.error, 'CHALLENGE_MISMATCH');
    });

    it('returns WRONG_ANSWER with new question on wrong answer', async () => {
      // Create two enabled challenges
      const hash1 = await bcrypt.hash('answer1', 4);
      const hash2 = await bcrypt.hash('answer2', 4);
      await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Q1?', hash1]
      );
      await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Q2?', hash2]
      );

      const initial = await challengeManager.getRandomChallenge('csrf-wrong');
      const result = await challengeManager.verifyChallengeAnswer('csrf-wrong', initial.challenge_id, 'wrong');

      assert.equal(result.verified, false);
      assert.equal(result.code, 'WRONG_ANSWER');
      assert.equal(result.attemptsLeft, 2);
      assert.ok(result.newChallenge);
      assert.ok(result.newChallenge.challenge_id);
    });

    it('returns CHALLENGE_FAILED after 3 wrong attempts', async () => {
      const hash1 = await bcrypt.hash('answer1', 4);
      const hash2 = await bcrypt.hash('answer2', 4);
      await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Q1?', hash1]
      );
      await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Q2?', hash2]
      );

      const initial = await challengeManager.getRandomChallenge('csrf-fail');

      // Attempt 1 — wrong
      let result = await challengeManager.verifyChallengeAnswer('csrf-fail', initial.challenge_id, 'wrong');
      assert.equal(result.verified, false);
      let currentId = result.newChallenge.challenge_id;

      // Attempt 2 — wrong
      result = await challengeManager.verifyChallengeAnswer('csrf-fail', currentId, 'wrong');
      assert.equal(result.verified, false);
      currentId = result.newChallenge.challenge_id;

      // Attempt 3 — wrong → should fail
      result = await challengeManager.verifyChallengeAnswer('csrf-fail', currentId, 'wrong');
      assert.equal(result.error, 'CHALLENGE_FAILED');
    });
  });

  describe('verifyForRegistration', () => {
    it('returns success for correct answer', async () => {
      const answer_hash = await bcrypt.hash('reg-answer', 4);
      const [insertResult] = await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Reg Q?', answer_hash]
      );
      await challengeManager.getRandomChallenge('csrf-reg');

      const result = await challengeManager.verifyForRegistration('csrf-reg', insertResult.insertId, 'reg-answer');
      assert.equal(result.success, true);
    });

    it('returns failure for wrong answer', async () => {
      const answer_hash = await bcrypt.hash('reg-answer', 4);
      const [insertResult] = await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Reg Q?', answer_hash]
      );
      await challengeManager.getRandomChallenge('csrf-reg2');

      const result = await challengeManager.verifyForRegistration('csrf-reg2', insertResult.insertId, 'wrong');
      assert.equal(result.success, false);
      assert.equal(result.code, 'CHALLENGE_FAILED');
    });
  });

  describe('Admin CRUD', () => {
    it('createChallenge inserts and returns id', async () => {
      const result = await challengeManager.createChallenge('Admin Q?', 'Admin A');
      assert.ok(result.id > 0);

      const [rows] = await pool.execute('SELECT question FROM challenge_questions WHERE id = ?', [result.id]);
      assert.equal(rows[0].question, 'Admin Q?');
    });

    it('listChallenges returns all challenges', async () => {
      await challengeManager.createChallenge('Q1', 'A1');
      await challengeManager.createChallenge('Q2', 'A2');

      const challenges = await challengeManager.listChallenges();
      assert.equal(challenges.length, 2);
    });

    it('updateChallenge updates question text', async () => {
      const { id } = await challengeManager.createChallenge('Old Q', 'A');
      const result = await challengeManager.updateChallenge(id, { question: 'New Q' });
      assert.equal(result.updated, true);

      const [rows] = await pool.execute('SELECT question FROM challenge_questions WHERE id = ?', [id]);
      assert.equal(rows[0].question, 'New Q');
    });

    it('updateChallenge toggles enabled', async () => {
      const { id } = await challengeManager.createChallenge('Q', 'A');
      const result = await challengeManager.updateChallenge(id, { enabled: false });
      assert.equal(result.updated, true);

      const [rows] = await pool.execute('SELECT enabled FROM challenge_questions WHERE id = ?', [id]);
      assert.equal(rows[0].enabled, 0);
    });

    it('deleteChallenge removes the challenge', async () => {
      const { id } = await challengeManager.createChallenge('Delete Me', 'A');
      const result = await challengeManager.deleteChallenge(id);
      assert.equal(result.deleted, true);

      const [rows] = await pool.execute('SELECT id FROM challenge_questions WHERE id = ?', [id]);
      assert.equal(rows.length, 0);
    });

    it('deleteChallenge returns false for non-existent id', async () => {
      const result = await challengeManager.deleteChallenge(99999);
      assert.equal(result.deleted, false);
    });
  });

  describe('_pickRandomEnabled', () => {
    it('returns null when no enabled challenges', async () => {
      const result = await challengeManager._pickRandomEnabled();
      assert.equal(result, null);
    });

    it('excludes specified id', async () => {
      const hash = await bcrypt.hash('a', 4);
      const [r1] = await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Q1', hash]
      );
      await pool.execute(
        'INSERT INTO challenge_questions (question, answer_hash, enabled) VALUES (?, ?, 1)',
        ['Q2', hash]
      );

      const result = await challengeManager._pickRandomEnabled(r1.insertId);
      assert.ok(result);
      assert.notEqual(result.id, r1.insertId);
    });
  });
});
