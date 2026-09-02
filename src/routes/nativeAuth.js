const express = require('express');
const nativeAuth = require('../modules/nativeAuth/nativeAuthService');

const router = express.Router();

function handle(action, successStatus = 200) {
  return async (req, res) => {
    try { res.status(successStatus).json(await action(req)); }
    catch (err) {
      if (err instanceof nativeAuth.NativeAuthError || err.code) return res.status(err.status || 400).json(nativeAuth.nativeErrorPayload(err));
      console.error('[NativeAuth] request failed:', err.message);
      return res.status(500).json({ error: { code: 'NATIVE_AUTH_UNAVAILABLE', message: '认证服务暂不可用', retryable: true, details: [] } });
    }
  };
}

router.post('/auth/transactions', handle((req) => nativeAuth.createTransaction({
  clientId: req.body?.client_id, codeChallenge: req.body?.code_challenge, codeChallengeMethod: req.body?.code_challenge_method, req,
}), 201));
router.post('/auth/transactions/:transactionId/password', handle((req) => nativeAuth.password({
  transactionId: req.params.transactionId, login: req.body?.login, password: req.body?.password, req,
})));
router.post('/auth/transactions/:transactionId/sms/send', handle((req) => nativeAuth.sendSmsChallenge({
  transactionId: req.params.transactionId, phone: req.body?.phone, req,
})));
router.post('/auth/transactions/:transactionId/sms/verify', handle((req) => nativeAuth.verifySms({
  transactionId: req.params.transactionId, challengeId: req.body?.challenge_id, phone: req.body?.phone, code: req.body?.code, req,
})));
router.post('/auth/transactions/:transactionId/qq', handle((req) => nativeAuth.qqLogin({
  transactionId: req.params.transactionId, authorizationCode: req.body?.authorization_code, req,
})));
router.post('/register', handle((req) => nativeAuth.register({
  transactionId: req.body?.transaction_id, challengeId: req.body?.challenge_id, smsCode: req.body?.sms_code,
  username: req.body?.username, password: req.body?.password, email: req.body?.email, phone: req.body?.phone, req,
})));
router.post('/phone/send', handle((req) => nativeAuth.sendPhoneVerification({
  ticket: req.get('authorization')?.replace(/^Bearer\s+/i, ''), phone: req.body?.phone, req,
})));
router.post('/phone/verify', handle((req) => nativeAuth.verifyPhoneVerification({
  ticket: req.get('authorization')?.replace(/^Bearer\s+/i, ''), challengeId: req.body?.challenge_id, phone: req.body?.phone, code: req.body?.code, req,
})));

// This is a backend-only endpoint. The Android app never receives the secret.
router.post('/auth/exchange', handle((req) => nativeAuth.exchange({
  clientId: req.body?.client_id, clientSecret: req.body?.client_secret || req.get('x-mindfourm-client-secret'), code: req.body?.code, codeVerifier: req.body?.code_verifier, req,
})));

module.exports = router;
