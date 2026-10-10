/** Short-lived, opaque handoff tickets for the native OAuth completion page. */
const crypto = require('crypto');
const { client } = require('../../redis');

const COMPLETION_TTL_SECONDS = 5 * 60;
const TICKET_PREFIX = 'oauthcompletion:';

function hashTicket(ticket) {
  return crypto.createHash('sha256').update(String(ticket)).digest('hex');
}

async function createCompletion(payload) {
  const ticket = crypto.randomBytes(32).toString('base64url');
  await client.setEx(
    `${TICKET_PREFIX}${hashTicket(ticket)}`,
    COMPLETION_TTL_SECONDS,
    JSON.stringify(payload),
  );
  return ticket;
}

async function getCompletion(ticket) {
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(ticket)) return null;
  const raw = await client.get(`${TICKET_PREFIX}${hashTicket(ticket)}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { createCompletion, getCompletion, COMPLETION_TTL_SECONDS };
