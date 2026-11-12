#!/usr/bin/env python3
"""Validate locally by default; --apply creates a private ElevenLabs agent.

The API key is read only from ELEVENLABS_API_KEY. No secret is accepted as an
argument, printed, or written to the provisioning state file.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
API_ROOT = "https://api.elevenlabs.io/v1"
ACTIONS = {"navigate", "next", "previous", "repeat", "quiz", "answer", "note", "complete", "set_parameter"}
ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{3,128}\Z")


class SetupError(Exception):
    pass


def valid_id(value):
    return isinstance(value, str) and ID_PATTERN.fullmatch(value) is not None


def load_configuration(path, voice_id):
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
        agent = config["agent"]
        tools = config["tools"]
        if len(tools) != 2:
            raise ValueError("Exactly two client tools are required.")
        by_name = {tool["tool_config"]["name"]: tool["tool_config"] for tool in tools}
        if set(by_name) != {"academy_context", "academy_action"}:
            raise ValueError("Unexpected client tool names.")
        for tool in by_name.values():
            if tool["type"] != "client" or tool.get("expects_response") is not True:
                raise ValueError("Only response-returning client tools are permitted.")
            if tool.get("execution_mode") != "immediate":
                raise ValueError("Client tools must execute sequentially and immediately.")
        if set(by_name["academy_action"]["parameters"]["properties"]["action"]["enum"]) != ACTIONS:
            raise ValueError("The academy action allowlist does not match the browser contract.")
        properties = by_name["academy_action"]["parameters"]["properties"]
        if properties["value"]["type"] != "string" or set(properties["scope"]["enum"]) != {"lab", "cut"}:
            raise ValueError("Action values and scopes do not match the browser contract.")
        if any(properties[name]["type"] != "string" for name in ("parameter", "field", "target", "text")):
            raise ValueError("Optional client-tool fields must be strings.")
        if by_name["academy_context"]["parameters"]["properties"]:
            raise ValueError("academy_context must take an empty object.")
        settings = agent["platform_settings"]
        if settings["auth"].get("enable_auth") is not True or settings["auth"].get("allowlist"):
            raise ValueError("The agent must require token authentication, without a public allowlist.")
        # The API defaults every omitted override permission to false. Permit only
        # text-only mode so the same private tutor can run without a microphone.
        overrides = settings.get("overrides")
        text_only_permission = {"conversation_config_override": {"conversation": {"text_only": True}}}
        if overrides != text_only_permission or overrides["conversation_config_override"]["conversation"]["text_only"] is not True:
            raise ValueError("Only the conversation.text_only runtime override may be enabled; prompt, tools, model, and other overrides must remain disabled.")
        if agent["conversation_config"]["conversation"].get("text_only", False) is not False:
            raise ValueError("Keep voice mode as the saved default; the client selects text-only mode per session.")
        limits = settings["call_limits"]
        if not (type(limits["daily_limit"]) is int and 1 <= limits["daily_limit"] <= 100 and
                type(limits["agent_concurrency_limit"]) is int and 1 <= limits["agent_concurrency_limit"] <= 5 and
                limits.get("bursting_enabled") is False):
            raise ValueError("Bounded daily/concurrency limits and disabled bursting are required.")
        duration = agent["conversation_config"]["conversation"]["max_duration_seconds"]
        if not (type(duration) is int and 60 <= duration <= 1800):
            raise ValueError("Conversation duration must be between 60 and 1800 seconds.")
        if settings.get("queueing_config", {}).get("enabled") is not False:
            raise ValueError("Queueing must be explicitly disabled.")
        prompt = agent["conversation_config"]["agent"]["prompt"]
        if prompt.get("tools") or prompt.get("tool_ids"):
            raise ValueError("Tool IDs are supplied by provisioning, not the template.")
        if prompt.get("enable_parallel_tool_calls") is not False:
            raise ValueError("Parallel state-changing tool calls must be disabled.")
        if not isinstance(prompt["prompt"], str) or not prompt["prompt"].strip():
            raise ValueError("A tutor prompt is required.")
        if "{{current_context}}" not in prompt["prompt"] or "current_context" not in agent["conversation_config"]["agent"]["dynamic_variables"]["dynamic_variable_placeholders"]:
            raise ValueError("The initial current_context variable and test placeholder are required.")
        if voice_id:
            if not valid_id(voice_id):
                raise ValueError("ELEVENLABS_VOICE_ID is not a valid identifier.")
            agent["conversation_config"]["tts"]["voice_id"] = voice_id
        return config
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise SetupError(f"Invalid agent configuration: {error}") from None


def request(path, payload, api_key):
    req = urllib.request.Request(API_ROOT + path, data=json.dumps(payload).encode("utf-8"),
                                 headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "application/json"},
                                 method="POST")
    # No arbitrary host option: the secret is sent only to the provider's official API.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise SetupError("The provider returned an oversized response.")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise SetupError("The provider returned an invalid response.")
            return result
    except urllib.error.HTTPError as error:
        # Provider bodies can contain request details. Never echo them or the key.
        raise SetupError(f"ElevenLabs request failed (HTTP {error.code}). Check account permissions and the configuration in the dashboard.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SetupError("Could not reach ElevenLabs. No deployment was completed; retain the state file before retrying.") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise SetupError("The provider returned an invalid JSON response.") from None


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=".voice-state-", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(state, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def provision(config, api_key, state_path, existing_agent_id="", requester=request):
    fingerprint = hashlib.sha256(json.dumps(config, sort_keys=True).encode("utf-8")).hexdigest()
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise SetupError("Cannot read the provisioning state. Inspect it before retrying to avoid duplicate resources.") from None
        if not isinstance(state, dict) or state.get("config_hash") != fingerprint or not isinstance(state.get("tool_ids"), dict):
            raise SetupError("The configuration differs from the saved provisioning state. Review the existing agent in ElevenLabs before creating another.")
    else:
        state = {"config_hash": fingerprint, "tool_ids": {}}
    if existing_agent_id and existing_agent_id != state.get("agent_id"):
        raise SetupError("ELEVENLABS_AGENT_ID already identifies an existing agent. This script creates new agents; review that agent in the dashboard or intentionally use a new environment and state file.")
    if state.get("agent_id"):
        if not valid_id(state["agent_id"]):
            raise SetupError("The saved agent identifier is invalid.")
        return state
    # Verify state can be persisted before making a billable/account-changing request.
    save_state(state_path, state)
    for tool in config["tools"]:
        name = tool["tool_config"]["name"]
        if name in state["tool_ids"]:
            if not valid_id(state["tool_ids"][name]):
                raise SetupError("A saved tool identifier is invalid.")
            continue
        result = requester("/convai/tools", tool, api_key)
        identifier = result.get("id")
        if not valid_id(identifier):
            raise SetupError("Tool creation returned no valid identifier. Inspect the ElevenLabs tools dashboard before retrying.")
        state["tool_ids"][name] = identifier
        save_state(state_path, state)
    payload = copy.deepcopy(config["agent"])
    payload["conversation_config"]["agent"]["prompt"]["tool_ids"] = [state["tool_ids"][tool["tool_config"]["name"]] for tool in config["tools"]]
    result = requester("/convai/agents/create", payload, api_key)
    if not valid_id(result.get("agent_id")):
        raise SetupError("Agent creation returned no valid identifier. Inspect the ElevenLabs agents dashboard before retrying.")
    state["agent_id"] = result["agent_id"]
    save_state(state_path, state)
    return state


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create resources in ElevenLabs. Omit to validate locally without network calls.")
    parser.add_argument("--config", type=Path, default=ROOT / "voice" / "agent-config.json")
    parser.add_argument("--state", type=Path, default=ROOT / ".voice-agent-state.json", help="Resumable local state with resource IDs only, never credentials.")
    args = parser.parse_args(argv)
    try:
        voice_id = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()
        api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
        config = load_configuration(args.config, voice_id)
        if not args.apply:
            settings = config["agent"]["platform_settings"]
            print(json.dumps({"mode": "local_validation_only", "valid": True,
                              "api_key_present": bool(api_key), "voice_id_present": bool(voice_id),
                              "authentication_required": True,
                              "text_only_override_enabled": True,
                              "client_tools": [tool["tool_config"]["name"] for tool in config["tools"]],
                              "limits": settings["call_limits"],
                              "max_duration_seconds": config["agent"]["conversation_config"]["conversation"]["max_duration_seconds"]}, indent=2))
            return 0
        if not api_key or "\n" in api_key or "\r" in api_key or not voice_id:
            raise SetupError("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in the environment before --apply. No secrets are accepted as command arguments.")
        state = provision(config, api_key, args.state, os.environ.get("ELEVENLABS_AGENT_ID", "").strip())
        print(json.dumps({"agent_id": state["agent_id"], "tool_ids": state["tool_ids"],
                          "next_step": "Set ELEVENLABS_AGENT_ID in the private gateway environment, then complete docs/VOICE-SETUP.md."}, indent=2))
        return 0
    except SetupError as error:
        print(f"Voice setup: {error}", file=sys.stderr)
        return 1
    except OSError:
        print("Voice setup: could not persist local provisioning state. Inspect the dashboard before retrying to avoid duplicate resources.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
