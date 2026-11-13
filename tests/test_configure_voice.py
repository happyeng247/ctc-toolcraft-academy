import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("configure_voice", ROOT / "scripts" / "configure_voice.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.state = Path(self.temporary.name) / "state.json"
        self.config = setup.load_configuration(ROOT / "voice" / "agent-config.json", "voice_test_approved")

    def test_default_validation_does_not_call_provider_or_print_credentials(self):
        stdout = io.StringIO()
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": "private-test-key", "ELEVENLABS_VOICE_ID": "voice_test_approved"}), \
                patch.object(setup, "provision", side_effect=AssertionError("No remote calls in validation")), \
                contextlib.redirect_stdout(stdout):
            self.assertEqual(setup.main(["--state", str(self.state)]), 0)
        result = json.loads(stdout.getvalue())
        self.assertEqual(result["mode"], "local_validation_only")
        self.assertTrue(result["authentication_required"])
        self.assertTrue(result["text_only_override_enabled"])
        self.assertNotIn("private-test-key", stdout.getvalue())
        self.assertNotIn("voice_test_approved", stdout.getvalue())
        self.assertFalse(self.state.exists())

    def test_tools_are_created_before_agent_and_only_ids_persist(self):
        calls = []
        def provider(path, payload, key):
            calls.append((path, copy.deepcopy(payload), key))
            return {"id": "tool_" + payload["tool_config"]["name"]} if path.endswith("/tools") else {"agent_id": "agent_private_test"}
        result = setup.provision(self.config, "test-secret", self.state, requester=provider)
        self.assertEqual([call[0] for call in calls], ["/convai/tools", "/convai/tools", "/convai/agents/create"])
        agent = calls[-1][1]
        self.assertEqual(agent["conversation_config"]["agent"]["prompt"]["tool_ids"], ["tool_academy_context", "tool_academy_action"])
        self.assertEqual(agent["conversation_config"]["tts"]["voice_id"], "voice_test_approved")
        # The live provider requires a v2 flash/turbo model for an English agent.
        self.assertEqual(agent["conversation_config"]["tts"]["model_id"], "eleven_flash_v2")
        self.assertTrue(agent["platform_settings"]["auth"]["enable_auth"])
        self.assertEqual(agent["platform_settings"]["overrides"], {
            "conversation_config_override": {"conversation": {"text_only": True}}
        })
        self.assertIs(agent["conversation_config"]["conversation"].get("text_only", False), False)
        self.assertEqual(self.config["agent"]["conversation_config"]["agent"]["prompt"]["tool_ids"], [])
        self.assertEqual(result["agent_id"], "agent_private_test")
        saved = self.state.read_text()
        self.assertNotIn("test-secret", saved)
        self.assertNotIn("prompt", saved)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o600)
        # A completed rerun does not create or mutate provider resources.
        self.assertEqual(setup.provision(self.config, "test-secret", self.state, requester=lambda *args: self.fail("duplicate request")), result)

    def test_failed_provisioning_resumes_without_recreating_completed_tools(self):
        calls = []
        def interrupted(path, payload, key):
            calls.append(path)
            if len(calls) == 2:
                raise setup.SetupError("network unavailable")
            return {"id": "tool_context_saved"}
        with self.assertRaises(setup.SetupError):
            setup.provision(self.config, "test-key", self.state, requester=interrupted)
        self.assertEqual(json.loads(self.state.read_text())["tool_ids"], {"academy_context": "tool_context_saved"})
        resumed_calls = []
        def resume(path, payload, key):
            resumed_calls.append(path)
            return {"id": "tool_action_saved"} if path.endswith("/tools") else {"agent_id": "agent_resumed_test"}
        result = setup.provision(self.config, "test-key", self.state, requester=resume)
        self.assertEqual(resumed_calls, ["/convai/tools", "/convai/agents/create"])
        self.assertEqual(result["agent_id"], "agent_resumed_test")

    def test_existing_agent_and_changed_state_require_explicit_review(self):
        with self.assertRaises(setup.SetupError):
            setup.provision(self.config, "test-key", self.state, existing_agent_id="agent_already_exists", requester=lambda *args: self.fail("must not call"))
        self.state.write_text(json.dumps({"config_hash": "different", "tool_ids": {}}))
        with self.assertRaises(setup.SetupError):
            setup.provision(self.config, "test-key", self.state, requester=lambda *args: self.fail("must not call"))

    def test_configuration_rejects_public_auth_unbounded_limits_or_nonclient_tools(self):
        mutations = [
            lambda data: data["agent"]["platform_settings"]["auth"].update(enable_auth=False),
            lambda data: data["agent"]["platform_settings"]["call_limits"].update(daily_limit=-1),
            lambda data: data["agent"]["platform_settings"]["call_limits"].update(bursting_enabled=True),
            lambda data: data["tools"][0]["tool_config"].update(type="webhook"),
            lambda data: data["tools"][1]["tool_config"]["parameters"]["properties"]["action"]["enum"].append("execute_code")
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                data = copy.deepcopy(self.config)
                mutate(data)
                path = Path(self.temporary.name) / "config.json"
                path.write_text(json.dumps(data))
                with self.assertRaises(setup.SetupError):
                    setup.load_configuration(path, "voice_test_approved")

    def test_apply_without_environment_key_is_rejected_without_network(self):
        stderr = io.StringIO()
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": "", "ELEVENLABS_VOICE_ID": "voice_test_approved"}), \
                patch.object(setup, "provision", side_effect=AssertionError("No credentials")), \
                contextlib.redirect_stderr(stderr):
            self.assertEqual(setup.main(["--apply", "--state", str(self.state)]), 1)
        self.assertIn("Set ELEVENLABS_API_KEY", stderr.getvalue())
        self.assertFalse(self.state.exists())

    def test_text_only_permission_is_required_and_other_override_permissions_are_rejected(self):
        configurations = [
            None,
            {},
            {"conversation_config_override": {"conversation": {"text_only": False}}},
            {"conversation_config_override": {"conversation": {"text_only": "true"}}},
            {"conversation_config_override": {"conversation": {"text_only": 1}}},
            {"conversation_config_override": {"conversation": {"text_only": True, "max_duration_seconds": True}}},
            {"conversation_config_override": {"conversation": {"text_only": True}, "agent": {"prompt": {"prompt": True}}}},
            {"conversation_config_override": {"conversation": {"text_only": True}, "agent": {"prompt": {"llm": True}}}},
            {"conversation_config_override": {"conversation": {"text_only": True}, "agent": {"prompt": {"tool_ids": True}}}},
            {"conversation_config_override": {"conversation": {"text_only": True}}, "custom_llm_extra_body": True}
        ]
        for overrides in configurations:
            with self.subTest(overrides=overrides):
                data = copy.deepcopy(self.config)
                data["agent"]["platform_settings"]["overrides"] = overrides
                path = Path(self.temporary.name) / "config.json"
                path.write_text(json.dumps(data))
                with self.assertRaisesRegex(setup.SetupError, "Only the conversation.text_only"):
                    setup.load_configuration(path, "voice_test_approved")

    def test_saved_default_remains_voice_capable(self):
        data = copy.deepcopy(self.config)
        data["agent"]["conversation_config"]["conversation"]["text_only"] = True
        path = Path(self.temporary.name) / "config.json"
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(setup.SetupError, "Keep voice mode"):
            setup.load_configuration(path, "voice_test_approved")


if __name__ == "__main__":
    unittest.main()
