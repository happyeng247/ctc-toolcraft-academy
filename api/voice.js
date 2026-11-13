'use strict';

const { createHmac, createHash, timingSafeEqual, randomBytes } = require('node:crypto');
const SESSION_SECONDS = 4 * 60 * 60;
const MAX_BODY_BYTES = 24 * 1024;
const MAX_TEXT_LENGTH = 10000;
const MAX_PROVIDER_ERROR_BYTES = 8 * 1024;
const TTS_MODEL = 'eleven_flash_v2_5';
const API_ROOT = 'https://api.elevenlabs.io/v1';

class VoiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function parseOrigins(value) {
  if (!value || !value.trim()) return null;
  try {
    const origins = value.split(',').map(item => {
      const url = new URL(item.trim());
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
          !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !local) ||
          url.hostname.includes('*')) throw new Error('Invalid origin');
      return url.origin;
    });
    return origins.length ? new Set(origins) : null;
  } catch { return null; }
}
function configuration(env) {
  const clean = name => typeof env[name] === 'string' ? env[name].trim() : '';
  const apiKey = clean('ELEVENLABS_API_KEY');
  const agentId = clean('ELEVENLABS_AGENT_ID');
  const voiceId = clean('ELEVENLABS_VOICE_ID');
  const accessCode = clean('VOICE_ACCESS_CODE');
  const secret = clean('VOICE_SESSION_SECRET');
  const origins = parseOrigins(clean('VOICE_ALLOWED_ORIGINS'));
  const idValid = value => /^[a-zA-Z0-9_-]{3,128}$/.test(value);
  const providerConfigured = !!apiKey && !/[\r\n]/.test(apiKey) && idValid(agentId) && idValid(voiceId);
  const authenticationConfigured = accessCode.length >= 12 && accessCode.length <= 256 && secret.length >= 32;
  return { apiKey, agentId, voiceId, accessCode, secret, origins, providerConfigured,
    authenticationConfigured, configured: providerConfigured && authenticationConfigured && !!origins };
}
function equalStrings(a, b) {
  // Fixed-size digests keep different input lengths on the same comparison path.
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function issueSession(secret, now) {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: 'academy', iat: issued,
    exp: issued + SESSION_SECONDS, nonce: randomBytes(16).toString('base64url') })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { sessionToken: `${payload}.${signature}`, expiresAt: new Date((issued + SESSION_SECONDS) * 1000).toISOString() };
}
function verifySession(token, secret, now) {
  const fail = () => { throw new VoiceError(401, 'session_required', 'Unlock voice again to continue.'); };
  if (typeof token !== 'string' || token.length > 1024) return fail();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[a-zA-Z0-9_-]+$/.test(part))) return fail();
  const expected = createHmac('sha256', secret).update(parts[0]).digest('base64url');
  if (!equalStrings(parts[1], expected)) return fail();
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return fail(); }
  const seconds = Math.floor(now / 1000);
  if (!payload || payload.v !== 1 || payload.sub !== 'academy' || !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) || payload.iat > seconds + 30 || payload.exp <= seconds ||
      payload.exp <= payload.iat || payload.exp - payload.iat > SESSION_SECONDS ||
      typeof payload.nonce !== 'string' || !/^[a-zA-Z0-9_-]{22}$/.test(payload.nonce)) return fail();
  return payload;
}
async function readBody(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new VoiceError(415, 'invalid_content_type', 'Use application/json.');
  const contentLength = req.headers['content-length'];
  if (contentLength !== undefined && (!/^\d+$/.test(String(contentLength)) || Number(contentLength) > MAX_BODY_BYTES)) {
    throw new VoiceError(413, 'request_too_large', 'This voice request is too large.');
  }
  let value = req.body;
  try {
    if (value === undefined) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > MAX_BODY_BYTES) throw new VoiceError(413, 'request_too_large', 'This voice request is too large.');
        chunks.push(bytes);
      }
      value = Buffer.concat(chunks).toString('utf8');
    }
    if (Buffer.isBuffer(value)) value = value.toString('utf8');
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      throw new VoiceError(413, 'request_too_large', 'This voice request is too large.');
    }
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    throw new VoiceError(400, 'invalid_json', 'Send a valid JSON object.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VoiceError(400, 'invalid_json', 'Send a valid JSON object.');
  return value;
}
async function readLimited(response, limit) {
  const length = response.headers.get('content-length');
  if (length && Number(length) > limit) {
    if (response.body) await response.body.cancel();
    throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.');
  }
  const reader = response.body && response.body.getReader();
  if (!reader) throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function providerFailure(status, code) {
  // Only fixed categories cross the provider boundary. Never forward its message,
  // request ID, parameter values, or an unrecognized code to the browser or logs.
  if (status === 429) return new VoiceError(429, 'provider_busy', 'The voice service is busy. Try again shortly.');
  if (status === 402 || ['quota_exceeded', 'insufficient_credits'].includes(code)) {
    return new VoiceError(402, 'provider_quota_exceeded', 'There are not enough ElevenLabs credits for this request. You can keep listening with your device voice.');
  }
  if (['invalid_api_key', 'missing_api_key', 'voice_not_found', 'agent_not_found', 'model_access_denied', 'insufficient_permissions'].includes(code)) {
    return new VoiceError(503, 'provider_not_configured', 'The private voice service needs attention from the academy owner. You can keep listening with your device voice.');
  }
  if (['max_character_limit_exceeded', 'text_too_long'].includes(code)) {
    return new VoiceError(413, 'provider_text_too_long', 'This passage is too long for ElevenLabs. Try one section at a time.');
  }
  if (status === 504) return new VoiceError(504, 'provider_timeout', 'The voice service took too long. Try again.');
  return new VoiceError(502, 'provider_unavailable', 'The voice service could not complete this request.');
}

function createHandler({ env = process.env, fetchImpl = (...args) => fetch(...args), now = Date.now, logger = console } = {}) {
  // Warm-instance limits are only best-effort. Distributed quotas need a shared store.
  const buckets = new Map();
  function limit(key, maximum, windowMs) {
    const time = now(); let bucket = buckets.get(key);
    if (!bucket || bucket.until <= time) bucket = { count: 0, until: time + windowMs };
    if (bucket.count >= maximum) {
      const error = new VoiceError(429, 'rate_limited', 'Too many requests. Try again later.');
      error.retryAfter = Math.max(1, Math.ceil((bucket.until - time) / 1000));
      throw error;
    }
    bucket.count++;
    if (buckets.size >= 10000) {
      for (const [oldKey, oldBucket] of buckets) if (oldBucket.until <= time) buckets.delete(oldKey);
      if (buckets.size >= 10000 && !buckets.has(key)) throw new VoiceError(429, 'rate_limited', 'Too many requests. Try again shortly.');
    }
    buckets.set(key, bucket);
  }
  async function provider(config, path, { body, audio = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), audio ? 45000 : 15000);
    if (timer.unref) timer.unref();
    try {
      const response = await fetchImpl(`${API_ROOT}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'xi-api-key': config.apiKey, Accept: audio ? 'audio/mpeg' : 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: controller.signal
      });
      if (!response.ok) {
        let code;
        try {
          const bytes = await readLimited(response, MAX_PROVIDER_ERROR_BYTES);
          const detail = JSON.parse(bytes.toString('utf8'))?.detail;
          code = typeof detail?.code === 'string' && detail.code ? detail.code : detail?.status;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          // Malformed and oversized error bodies remain generic; status-only
          // payment, busy, and timeout failures are still actionable.
        }
        const failure = providerFailure(response.status, code);
        logger.warn('Voice provider request failed', { status: response.status, category: failure.code });
        throw failure;
      }
      if (audio && !/^audio\/(mpeg|mp3)(;|$)/i.test(response.headers.get('content-type') || '')) {
        if (response.body) await response.body.cancel();
        throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.');
      }
      const bytes = await readLimited(response, audio ? 12 * 1024 * 1024 : 32 * 1024);
      if (audio) {
        if (!bytes.length) throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.');
        return bytes;
      }
      try { return JSON.parse(bytes.toString('utf8')); }
      catch { throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.'); }
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      if (controller.signal.aborted) throw new VoiceError(504, 'provider_timeout', 'The voice service took too long. Try again.');
      throw new VoiceError(502, 'provider_unavailable', 'The voice service could not complete this request.');
    } finally { clearTimeout(timer); }
  }
  return async function voice(req, res) {
    const json = (status, value) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    try {
      const config = configuration(env);
      const origin = req.headers.origin;
      if (origin !== undefined && (typeof origin !== 'string' || !config.origins || !config.origins.has(origin))) {
        throw new VoiceError(403, 'origin_not_allowed', 'This website is not allowed to use voice.');
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
      }
      if (req.method === 'GET') return json(200, {
        configured: config.configured,
        authenticationConfigured: config.authenticationConfigured,
        providerConfigured: config.providerConfigured,
        originsConfigured: !!config.origins
      });
      if (req.method === 'OPTIONS') {
        if (!origin) throw new VoiceError(403, 'origin_required', 'An allowed website origin is required.');
        const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);
        if (!['POST', 'GET'].includes(req.headers['access-control-request-method']) || requested.some(h => !['content-type', 'authorization'].includes(h))) {
          throw new VoiceError(403, 'invalid_preflight', 'This request is not allowed.');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '600');
        res.statusCode = 204;
        return res.end();
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST, OPTIONS');
        throw new VoiceError(405, 'method_not_allowed', 'Use POST for voice requests.');
      }
      if (!origin) throw new VoiceError(403, 'origin_required', 'An allowed website origin is required.');
      if (!config.configured) throw new VoiceError(503, 'not_configured', 'Private voice is not configured yet.');
      const body = await readBody(req);
      const allowedKeys = { login: ['action', 'code'], session: ['action', 'textOnly'], tts: ['action', 'text'], 'dictation-token': ['action'] };
      if (typeof body.action !== 'string' || !Object.hasOwn(allowedKeys, body.action)) {
        throw new VoiceError(400, 'invalid_action', 'Choose a supported voice action.');
      }
      if (Object.keys(body).some(key => !allowedKeys[body.action].includes(key))) {
        throw new VoiceError(400, 'invalid_fields', 'This voice request contains unsupported fields.');
      }
      if (body.action === 'login') {
        const peer = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        limit(`login:${createHash('sha256').update(peer).digest('hex')}`, 12, 15 * 60 * 1000);
        if (typeof body.code !== 'string' || body.code.length > 256 || !equalStrings(body.code, config.accessCode)) {
          throw new VoiceError(401, 'invalid_code', 'That access code is not correct.');
        }
        return json(200, issueSession(config.secret, now()));
      }
      const authorization = req.headers.authorization;
      const match = typeof authorization === 'string' && authorization.match(/^Bearer ([a-zA-Z0-9_.-]+)$/);
      const session = verifySession(match ? match[1] : null, config.secret, now());
      limit(`all:${session.nonce}`, 60, 60 * 1000);
      if (body.action === 'session') {
        if (body.textOnly !== undefined && typeof body.textOnly !== 'boolean') throw new VoiceError(400, 'invalid_text_only', 'textOnly must be a boolean.');
        limit(`session:${session.nonce}`, 6, 60 * 1000);
        if (body.textOnly === true) {
          const result = await provider(config, `/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(config.agentId)}&include_conversation_id=true`);
          let url;
          try { url = new URL(result.signed_url); } catch {}
          if (!url || url.protocol !== 'wss:' || url.hostname !== 'api.elevenlabs.io' || url.pathname !== '/v1/convai/conversation' || url.username || url.password) {
            throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.');
          }
          return json(200, { signedUrl: result.signed_url });
        }
        const result = await provider(config, `/convai/conversation/token?agent_id=${encodeURIComponent(config.agentId)}`);
        if (!result || typeof result.token !== 'string' || !result.token || result.token.length > 20000) throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.');
        return json(200, { conversationToken: result.token });
      }
      if (body.action === 'dictation-token') {
        limit(`dictation:${session.nonce}`, 10, 60 * 1000);
        const result = await provider(config, '/single-use-token/realtime_scribe', { body: {} });
        if (!result || typeof result.token !== 'string' || !result.token || result.token.length > 20000) throw new VoiceError(502, 'provider_response_invalid', 'The voice service returned an invalid response.');
        return json(200, { token: result.token });
      }
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_TEXT_LENGTH) throw new VoiceError(400, 'invalid_text', `Read-aloud text must contain 1–${MAX_TEXT_LENGTH} characters.`);
      limit(`tts:${session.nonce}`, 20, 60 * 1000);
      const bytes = await provider(config, `/text-to-speech/${encodeURIComponent(config.voiceId)}/stream?output_format=mp3_44100_128`, {
        audio: true, body: { text: body.text.trim(), model_id: TTS_MODEL }
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', String(bytes.length));
      return res.end(bytes);
    } catch (error) {
      const safe = error instanceof VoiceError ? error : new VoiceError(500, 'internal_error', 'Voice is temporarily unavailable.');
      if (safe.status === 429) res.setHeader('Retry-After', String(safe.retryAfter || 60));
      return json(safe.status, { error: safe.code, message: safe.message });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
