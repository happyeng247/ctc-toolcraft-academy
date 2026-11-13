'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../api/voice.js');

const ORIGIN = 'https://academy.example';
const ENV = {
  ELEVENLABS_API_KEY: 'mock-provider-secret-never-a-real-key',
  ELEVENLABS_AGENT_ID: 'agent_test_private', ELEVENLABS_VOICE_ID: 'voice_test_fixed',
  VOICE_ACCESS_CODE: 'a-private-test-code', VOICE_SESSION_SECRET: 'test-signing-secret-with-at-least-32-characters',
  VOICE_ALLOWED_ORIGINS: `${ORIGIN},http://localhost:4173`
};
function fixture(responder = () => Response.json({ token: 'mock-conversation-token' }), overrides = {}) {
  const calls = [], providerErrors = []; let time = Date.parse('2026-11-12T12:00:00Z');
  const handler = createHandler({ env: { ...ENV, ...overrides }, now: () => time,
    fetchImpl: async (...args) => { calls.push(args); return responder(...args); },
    logger: { warn: (...args) => providerErrors.push(args) } });
  return { handler, calls, providerErrors, advance: ms => { time += ms; } };
}
async function invoke(handler, body, options = {}) {
  const req = Readable.from(options.chunks || []);
  req.method = options.method || 'POST';
  req.headers = { origin: ORIGIN, 'content-type': 'application/json', ...options.headers };
  for (const key of options.omit || []) delete req.headers[key];
  req.socket = { remoteAddress: '127.0.0.1' };
  if (!options.chunks) req.body = body;
  const headers = {};
  let output;
  const res = { statusCode: 0, setHeader: (key, value) => { headers[key.toLowerCase()] = value; }, end: value => { output = value; } };
  await handler(req, res);
  return { status: res.statusCode, headers, bytes: output, json: () => JSON.parse(output) };
}
async function unlock(f) {
  const result = await invoke(f.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE });
  assert.equal(result.status, 200);
  return result.json().sessionToken;
}
const auth = token => ({ headers: { authorization: `Bearer ${token}` } });

test('health exposes only booleans and fails closed without configuration', async () => {
  const handler = createHandler({ env: {}, fetchImpl: () => { throw Error('must not fetch'); } });
  const response = await invoke(handler, undefined, { method: 'GET', omit: ['origin'] });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { configured: false, authenticationConfigured: false, providerConfigured: false, originsConfigured: false });
  assert.equal(response.headers['cache-control'], 'no-store');
  const configured = await invoke(fixture().handler, undefined, { method: 'GET' });
  assert.ok(Object.values(configured.json()).every(value => value === true));
});

test('rejects absent, lookalike, null, or unapproved Origin before any provider call', async () => {
  const f = fixture();
  for (const origin of [undefined, 'https://academy.example.evil.test', 'null', 'https://evil.test']) {
    const response = await invoke(f.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE },
      origin === undefined ? { omit: ['origin'] } : { headers: { origin } });
    assert.equal(response.status, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(f.calls.length, 0);
});

test('invalid origin configuration and weak secrets fail closed', async () => {
  for (const origins of ['*', `${ORIGIN}/academy/`, 'http://academy.example', `${ORIGIN},*`]) {
    const f = fixture(undefined, { VOICE_ALLOWED_ORIGINS: origins });
    const health = await invoke(f.handler, undefined, { method: 'GET', omit: ['origin'] });
    assert.equal(health.json().configured, false);
    assert.equal((await invoke(f.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE })).status, 403);
  }
  const weak = fixture(undefined, { VOICE_SESSION_SECRET: 'short' });
  assert.equal((await invoke(weak.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE })).status, 503);
});

test('CORS permits only approved methods and headers for an exact allowed origin', async () => {
  const f = fixture();
  const response = await invoke(f.handler, undefined, { method: 'OPTIONS', headers: {
    'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
  const rejected = await invoke(f.handler, undefined, { method: 'OPTIONS', headers: {
    'access-control-request-method': 'POST', 'access-control-request-headers': 'xi-api-key' } });
  assert.equal(rejected.status, 403);
});

test('login issues a four-hour signed session without calling the provider', async () => {
  const f = fixture();
  const response = await invoke(f.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE });
  assert.equal(response.status, 200);
  const result = response.json();
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(result.expiresAt, '2026-11-12T16:00:00.000Z');
  assert.equal(f.calls.length, 0);
  assert.ok(!response.bytes.includes(ENV.VOICE_ACCESS_CODE));
  assert.ok(!response.bytes.includes(ENV.ELEVENLABS_API_KEY));
});

test('wrong codes are rejected and repeated attempts are limited', async () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) assert.equal((await invoke(f.handler, { action: 'login', code: 'incorrect' })).status, 401);
  const response = await invoke(f.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE });
  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '900');
  f.advance(15 * 60 * 1000);
  assert.equal((await invoke(f.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE })).status, 200);
  assert.equal(f.calls.length, 0);
});

test('every provider action requires a valid session', async () => {
  const f = fixture();
  for (const action of ['session', 'tts', 'dictation-token']) {
    assert.equal((await invoke(f.handler, { action, ...(action === 'tts' ? { text: 'A lesson' } : {}) })).status, 401);
  }
  const token = await unlock(f);
  const [payload, signature] = token.split('.');
  const changed = `${payload}.${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`;
  assert.equal((await invoke(f.handler, { action: 'session' }, auth(changed))).status, 401);
  f.advance(4 * 60 * 60 * 1000);
  assert.equal((await invoke(f.handler, { action: 'session' }, auth(token))).status, 401);
  assert.equal(f.calls.length, 0);
});

test('rejects malformed JSON, unsupported content type, oversize byte input and extra fields', async () => {
  const f = fixture();
  assert.equal((await invoke(f.handler, '{broken')).status, 400);
  assert.equal((await invoke(f.handler, [] )).status, 400);
  assert.equal((await invoke(f.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE }, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await invoke(f.handler, { action: 'login' }, { headers: { 'content-length': '25000' } })).status, 413);
  assert.equal((await invoke(f.handler, undefined, { chunks: ['{"action":"tts","text":"', 'é'.repeat(13000), '"}'] })).status, 413);
  assert.equal((await invoke(f.handler, { action: 'toString' })).status, 400);
  assert.equal((await invoke(f.handler, { action: 'login', code: ENV.VOICE_ACCESS_CODE, admin: true })).status, 400);
  assert.equal(f.calls.length, 0);
});

test('mints WebRTC tokens with the server agent and keeps provider secrets out of browser data', async () => {
  const f = fixture(() => Response.json({ token: 'test-livekit-token', conversation_id: 'internal-id' }));
  const token = await unlock(f);
  const response = await invoke(f.handler, { action: 'session' }, auth(token));
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { conversationToken: 'test-livekit-token' });
  const [url, request] = f.calls[0];
  assert.equal(url, `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${ENV.ELEVENLABS_AGENT_ID}`);
  assert.equal(request.headers['xi-api-key'], ENV.ELEVENLABS_API_KEY);
  assert.equal(request.redirect, 'error');
  assert.equal(request.method, 'GET');
});

test('text-only sessions use single-use signed URLs and reject non-boolean selectors', async () => {
  const signedUrl = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_test&conversation_signature=test';
  const f = fixture(() => Response.json({ signed_url: signedUrl }));
  const token = await unlock(f);
  for (const textOnly of ['true', 1, null]) assert.equal((await invoke(f.handler, { action: 'session', textOnly }, auth(token))).status, 400);
  assert.equal(f.calls.length, 0);
  const response = await invoke(f.handler, { action: 'session', textOnly: true }, auth(token));
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { signedUrl });
  assert.match(f.calls[0][0], /get-signed-url\?agent_id=agent_test_private&include_conversation_id=true$/);
  const evil = fixture(() => Response.json({ signed_url: 'wss://evil.test/v1/convai/conversation' }));
  assert.equal((await invoke(evil.handler, { action: 'session', textOnly: true }, auth(await unlock(evil)))).status, 502);
});

test('read-aloud uses only a server-fixed voice/model and returns audio bytes', async () => {
  const audio = Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]);
  const f = fixture(() => new Response(audio, { headers: { 'content-type': 'audio/mpeg' } }));
  const token = await unlock(f);
  const response = await invoke(f.handler, { action: 'tts', text: '  Understand clearance.  ' }, auth(token));
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'audio/mpeg');
  assert.deepEqual(response.bytes, audio);
  assert.equal(f.calls[0][0], `https://api.elevenlabs.io/v1/text-to-speech/${ENV.ELEVENLABS_VOICE_ID}/stream?output_format=mp3_44100_128`);
  assert.deepEqual(JSON.parse(f.calls[0][1].body), { text: 'Understand clearance.', model_id: 'eleven_flash_v2_5' });
  assert.equal((await invoke(f.handler, { action: 'tts', text: 'Hello', voice_id: 'other_voice' }, auth(token))).status, 400);
  for (const text of ['', '  ', 'a'.repeat(10001), 10]) assert.equal((await invoke(f.handler, { action: 'tts', text }, auth(token))).status, 400);
  assert.equal(f.calls.length, 1);
});

test('dictation mints only a realtime_scribe single-use token', async () => {
  const f = fixture(() => Response.json({ token: 'one-use-scribe-token', secret_details: 'not-forwarded' }));
  const response = await invoke(f.handler, { action: 'dictation-token' }, auth(await unlock(f)));
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { token: 'one-use-scribe-token' });
  assert.equal(f.calls[0][0], 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
  assert.equal(f.calls[0][1].method, 'POST');
});

test('provider errors, invalid data and failures never expose provider response details', async () => {
  const secret = 'private-provider-error-detail';
  for (const responder of [
    () => new Response(secret, { status: 401 }),
    () => { throw Error(secret); },
    () => new Response(secret),
    () => Response.json({ unexpected: secret }),
    () => new Response('{}', { headers: { 'content-length': '99999999' } })
  ]) {
    const f = fixture(responder);
    const response = await invoke(f.handler, { action: 'session' }, auth(await unlock(f)));
    assert.equal(response.status, 502);
    assert.ok(!response.bytes.includes(secret));
    assert.ok(!response.bytes.includes(ENV.ELEVENLABS_API_KEY));
  }
  const busy = fixture(() => new Response(secret, { status: 429 }));
  assert.equal((await invoke(busy.handler, { action: 'session' }, auth(await unlock(busy)))).status, 429);
  const badAudio = fixture(() => Response.json({ token: 'not-audio' }));
  assert.equal((await invoke(badAudio.handler, { action: 'tts', text: 'Read this.' }, auth(await unlock(badAudio)))).status, 502);
});

test('repeated conversation token creation is bounded per authenticated session', async () => {
  const f = fixture(); const token = await unlock(f);
  for (let i = 0; i < 6; i++) assert.equal((await invoke(f.handler, { action: 'session' }, auth(token))).status, 200);
  assert.equal((await invoke(f.handler, { action: 'session' }, auth(token))).status, 429);
  assert.equal(f.calls.length, 6);
});

test('quota failures are distinct from authentication and never retry billable audio', async () => {
  const privateDetail = `${ENV.ELEVENLABS_API_KEY} private account and balance details`;
  for (const [status, detail] of [
    [401, { status: 'quota_exceeded', message: privateDetail }],
    [402, { code: 'insufficient_credits', message: privateDetail }],
    [400, { code: 'quota_exceeded', message: privateDetail }],
    [402, { message: privateDetail }]
  ]) {
    const f = fixture(() => Response.json({ detail }, { status }));
    const response = await invoke(f.handler, { action: 'tts', text: 'Read this lesson.' }, auth(await unlock(f)));
    assert.equal(response.status, 402);
    assert.deepEqual(response.json(), {
      error: 'provider_quota_exceeded',
      message: 'There are not enough ElevenLabs credits for this request. You can keep listening with your device voice.'
    });
    assert.equal(f.calls.length, 1, 'A rejected TTS request must not trigger an automatic paid retry');
    assert.deepEqual(f.providerErrors, [['Voice provider request failed', { status, category: 'provider_quota_exceeded' }]]);
    assert.ok(!response.bytes.includes(privateDetail));
    assert.ok(!JSON.stringify(f.providerErrors).includes(ENV.ELEVENLABS_API_KEY));
  }
});

test('provider configuration failures do not masquerade as a bad learner access code or exhausted credits', async () => {
  for (const code of ['invalid_api_key', 'missing_api_key', 'voice_not_found', 'agent_not_found', 'model_access_denied', 'insufficient_permissions']) {
    const f = fixture(() => Response.json({ detail: { code, status: 'quota_exceeded', message: ENV.ELEVENLABS_API_KEY } }, { status: 401 }));
    const response = await invoke(f.handler, { action: 'session' }, auth(await unlock(f)));
    assert.equal(response.status, 503);
    assert.equal(response.json().error, 'provider_not_configured');
    assert.match(response.json().message, /academy owner/);
    assert.ok(!response.bytes.includes(ENV.ELEVENLABS_API_KEY));
    assert.equal(f.providerErrors[0][1].category, 'provider_not_configured', 'Modern code takes precedence over legacy status');
  }
  const f = fixture();
  const response = await invoke(f.handler, { action: 'login', code: 'incorrect-access-code' });
  assert.equal(response.status, 401);
  assert.equal(response.json().error, 'invalid_code');
  assert.equal(f.calls.length, 0, 'Learner authentication still happens before any provider request');
});

test('provider text length, busy and timeout failures return stable actionable codes', async () => {
  for (const code of ['max_character_limit_exceeded', 'text_too_long']) {
    const f = fixture(() => Response.json({ detail: { code, message: 'private input text' } }, { status: 400 }));
    const response = await invoke(f.handler, { action: 'tts', text: 'A valid local passage.' }, auth(await unlock(f)));
    assert.equal(response.status, 413);
    assert.equal(response.json().error, 'provider_text_too_long');
    assert.ok(!response.bytes.includes('private input text'));
  }
  for (const [status, expected] of [[429, 'provider_busy'], [504, 'provider_timeout']]) {
    const f = fixture(() => new Response('not-json-private-error', { status }));
    const response = await invoke(f.handler, { action: 'session' }, auth(await unlock(f)));
    assert.equal(response.status, status);
    assert.equal(response.json().error, expected);
    assert.ok(!response.bytes.includes('not-json-private-error'));
  }
});

test('unknown or oversized provider error details remain generic and cannot reach public responses or logs', async () => {
  const secret = 'unknown-provider-detail-that-must-stay-private';
  for (const responseFactory of [
    () => Response.json({ detail: { code: secret, status: 'quota_exceeded', message: ENV.ELEVENLABS_API_KEY } }, { status: 401 }),
    () => Response.json({ detail: { code: 'quota_exceeded', message: secret.repeat(400) } }, { status: 401 }),
    () => new Response(secret, { status: 401 }),
    () => Response.json({ detail: { code: { message: secret } } }, { status: 400 })
  ]) {
    const f = fixture(responseFactory);
    const response = await invoke(f.handler, { action: 'session' }, auth(await unlock(f)));
    assert.equal(response.status, 502);
    assert.equal(response.json().error, 'provider_unavailable');
    assert.ok(!response.bytes.includes(secret));
    const logs = JSON.stringify(f.providerErrors);
    assert.ok(!logs.includes(secret));
    assert.ok(!logs.includes(ENV.ELEVENLABS_API_KEY));
  }
});

test('oversized provider errors are cancelled before reading and HTTP 402 still signals credits', async () => {
  let cancelled = false;
  const f = fixture(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    status: 402, headers: { 'content-length': '9000' }
  }));
  const response = await invoke(f.handler, { action: 'dictation-token' }, auth(await unlock(f)));
  assert.equal(cancelled, true);
  assert.equal(response.status, 402);
  assert.equal(response.json().error, 'provider_quota_exceeded');
});
