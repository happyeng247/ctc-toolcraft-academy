# Private voice service setup

The academy stays a public static site. Its voice gateway runs as a Vercel Node function at `/api/voice`. The browser knows only that endpoint, a learner's expiring session token, and short-lived ElevenLabs conversation or dictation credentials. The provider API key stays in the server environment. GitHub Pages cannot execute this function; it can call the separately deployed Vercel endpoint.

These files have been validated locally with mocked provider responses. Agent creation, deployment, and a live microphone/audio check still require network access and an ElevenLabs account. The checked-in configuration does not activate a paid service.

## 1. Prepare the server environment

Use Node 20 or newer with native `fetch` and Python 3.9 or newer. In the Vercel project's **Environment Variables**, set the six variables shown in `.env.example`:

| Variable | Purpose |
| --- | --- |
| `ELEVENLABS_API_KEY` | Server-only provider credential; restrict it to the operations this service needs. |
| `ELEVENLABS_AGENT_ID` | Private agent identifier produced by provisioning. |
| `ELEVENLABS_VOICE_ID` | A voice available to your account. Both the tutor and read-aloud use this selected voice. |
| `VOICE_ACCESS_CODE` | Random private learner access code, 12–256 characters. |
| `VOICE_SESSION_SECRET` | Separate random signing secret, at least 32 characters. |
| `VOICE_ALLOWED_ORIGINS` | Comma-separated exact website origins, without paths or wildcards. |

For example, an origin list can contain `https://your-account.github.io,https://your-project.vercel.app`. For a local browser, add its exact loopback origin such as `http://localhost:4173`. Each preview hostname needs its own explicit entry. Non-loopback HTTP origins are rejected. A GitHub Pages origin applies to every repository site on that hostname; private access is enforced by the access code and signed session, not by CORS alone.

Generate secrets with your password manager. Do not put the provider key, access code, or signing secret in `src/voice-config.json`, browser settings, source code, a commit, or a command-line argument. `.env` files are ignored; the server does not automatically load an `.env` file outside a host that supports it.

## 2. Provision the private tutor

First validate the template without any network call:

```sh
python3 scripts/configure_voice.py
```

Set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in the provisioning process environment using your secret manager. Then, when ready to create account resources:

```sh
python3 scripts/configure_voice.py --apply
```

The script creates two client tools through the [Tools API](https://elevenlabs.io/docs/api-reference/tools/create), then passes their IDs to the [Create Agent API](https://elevenlabs.io/docs/api-reference/agents/create). It prints the new agent ID for the server environment. It never prints or saves the key. A local `.voice-agent-state.json` stores resource IDs so interrupted runs reuse already-created tools; keep that file until provisioning is complete. A completed rerun makes no remote changes. If configuration differs or `ELEVENLABS_AGENT_ID` already points to another agent, the script stops for dashboard review instead of silently replacing it. A network failure after a provider creates a resource but before its response arrives may require checking the dashboard before retrying.

`voice/agent-config.json` sets authenticated access, a 900-second maximum conversation, 20 conversations per day, concurrency 2, disabled bursting and queueing. **The daily limit counts conversations, not minutes or total spend.** These are shared agent limits, not per learner. They do not limit the separate read-aloud and Scribe services. Voice recording is disabled and retention is requested at seven days; inspect the resulting privacy settings in the provider dashboard before inviting learners.

Keep `platform_settings.auth.enable_auth` enabled. Do not add a provider hostname allowlist to this private agent: provider allowlist authentication and signed authentication are alternative modes. The gateway enforces its own origin list. [ElevenLabs authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication)

The template enables exactly one runtime override permission:

```json
{"platform_settings":{"overrides":{"conversation_config_override":{"conversation":{"text_only":true}}}}}
```

This allows the same agent to accept the client's text-only session request while retaining voice as its saved default. Every other override permission is omitted and defaults to disabled, including system prompt, tools, LLM, voice, and maximum duration. Provisioning rejects a missing text-only permission or any additional override permission. If configuring an existing agent manually, enable only **Text-only mode** under Security → Overrides; a signed URL alone cannot enable it. [Chat mode](https://elevenlabs.io/docs/eleven-agents/guides/chat-mode), [override permissions](https://elevenlabs.io/docs/api-reference/agents/create)

## 3. Deploy and connect

Import this repository into Vercel with the repository root as the project root. `vercel.json` runs `python3 scripts/build.py`, serves the `docs` output, and includes `api/voice.js`. Use a current Node runtime with native `fetch`; the function requests a 60-second maximum duration. Set the server environment values before enabling the frontend connection. This also supports keeping the original academy on GitHub Pages while deploying the gateway to Vercel.

Set only the public endpoint URL in `src/voice-config.json`, or use the academy's voice settings to enter it:

```json
{"endpoint":"https://YOUR-DEPLOYMENT.vercel.app/api/voice"}
```

If changing the checked-in frontend configuration, run `python3 scripts/build.py` and publish the rebuilt `docs` directory through the normal site release process. Use HTTPS for both the academy and gateway. A direct `GET` to the endpoint returns readiness booleans without credentials or identifiers.

Check a real session from the deployed academy: unlock voice, start the tutor, interrupt it, navigate a lesson by voice, submit one quiz answer, explicitly ask to save a note, test text-only tutoring without microphone permission, and stop the session. Check read-aloud and dictation separately. Confirm that a missing access code or an unapproved origin cannot mint credentials. Review actual account usage after this small live check.

## Browser/API contract

Every POST requires `Content-Type: application/json` and an exact allowed `Origin`. The browser sets `Origin`; application code must not attempt to set it. All actions except login require `Authorization: Bearer SESSION_TOKEN`.

| JSON request | Successful response |
| --- | --- |
| `{"action":"login","code":"PRIVATE_CODE"}` | `{"sessionToken":"…","expiresAt":"ISO_TIMESTAMP"}` |
| `{"action":"session"}` or `{"action":"session","textOnly":false}` | `{"conversationToken":"…"}` for WebRTC |
| `{"action":"session","textOnly":true}` | `{"signedUrl":"wss://…"}` for a text-only WebSocket session |
| `{"action":"tts","text":"Lesson text"}` | `audio/mpeg` bytes |
| `{"action":"dictation-token"}` | `{"token":"…"}` for realtime Scribe |

The learner session expires after four hours. `textOnly` must be a boolean when present. Unknown actions and fields are rejected. Requests are limited to 24 KiB, and read-aloud accepts up to 10,000 characters. Read-aloud voice and model are fixed on the server (`ELEVENLABS_VOICE_ID`, `eleven_flash_v2_5`); clients cannot select a voice, model, agent, or external URL.

The voice credential comes from the [WebRTC token endpoint](https://elevenlabs.io/docs/api-reference/conversations/get-webrtc-token). Text-only tutoring uses the [signed URL endpoint](https://elevenlabs.io/docs/api-reference/conversations/get-signed-url) with a single-use conversation signature. The frontend must also set `textOnly: true` when starting that SDK session; getting a signed URL alone does not select text mode. [JavaScript client SDK](https://elevenlabs.io/docs/eleven-agents/libraries/java-script)

Dictation uses a [single-use realtime Scribe token](https://elevenlabs.io/docs/api-reference/tokens/create), consumed by a Scribe connection. It is separate from the tutor conversation and its agent limits. Read-aloud calls the [streaming TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) and returns the completed MP3 to the browser. The gateway bounds provider response sizes and timeouts.

Errors have the shape `{"error":"stable_code","message":"safe explanation"}`. Typical statuses are 400 for invalid input, 401 for a wrong code or expired session, 403 for origin rejection, 413 for size, 415 for content type, 429 for limits, 502/504 for provider failures, and 503 when private voice is not configured. Provider error bodies and keys are not forwarded. Responses are never cached.

## Tutor controls and learning boundaries

The browser registers exactly two [client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools):

- `academy_context({})` returns the current learning context and valid controls.
- `academy_action({action,target,value,text,parameter,scope,field})` performs a permitted action. `action` is one of `navigate`, `next`, `previous`, `repeat`, `quiz`, `answer`, `note`, `complete`, or `set_parameter`. All optional fields are strings. Quiz answers are **1-based**, passed as a string such as `"2"` in `value`. For `set_parameter`, use `parameter` and `scope` (`lab` or `cut`), with a numeric or choice string in `value`. For a requested brief note, `field` is its exact field name or `brief-0` style identifier from context.

The browser validates targets, ranges, quiz answers, and the completion gate. Tool failures must remain failures in the tutor's response. The agent prompt permits saving notes only after an explicit learner request. No server tool executes arbitrary commands. The frontend supplies the initial `current_context` dynamic variable as a JSON string; the configuration includes a test placeholder. `academy_context` remains authoritative when state changes, and the frontend can refresh context with `sendContextualUpdate` as the learner navigates. The tutor must not read hidden quiz answers. [Dynamic variables](https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables)

Learning context, tutor conversation, and cloud dictation are sent to ElevenLabs when those features are used. Browser speech recognition is a separate fallback; it is not a connection to the AI tutor. On a phone, use the site in the foreground. Browsers can suspend microphone/audio sessions when backgrounded or locked; a screen wake lock does not guarantee background operation. [Screen Wake Lock specification](https://www.w3.org/TR/screen-wake-lock/)

## Local validation and operations

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/configure_voice.py
```

These tests use mocked browser/media and provider responses and perform no network requests. Browser rendering, microphone permission behavior, and real device audio still require deployment and physical-device checks. They cover authentication, expiry/tampering, CORS, malformed/oversized input, fixed provider destinations, safe failures, and resumable provisioning.

Login and action rate limits in this small gateway are **per warm function instance**, not a distributed quota. For a broader rollout, add durable login/request limits at a shared store or gateway and set account spending controls; agent conversation limits alone do not cap TTS or Scribe cost. The access code is intended for a small private learning group, not per-person identity or revocation. Rotate `VOICE_SESSION_SECRET` to invalidate existing learner sessions; rotating only the access code prevents new logins but leaves existing signed sessions valid until expiry. Changing the key or credentials requires the host's normal redeployment/restart process.
