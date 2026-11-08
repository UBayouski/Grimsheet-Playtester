"""Tests for scripts/replay_cron.py (the nightly Launcher).

Run from the repo root:  python -m unittest tests.test_replay_cron
No network, no real node: every seam of the Launcher (_spawn, _kill_tree, _now, _sleep, _data_dir)
is replaced, and `data/` is a temporary folder that tearDown removes.
"""

import datetime
import importlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from scripts import replay_cron

APP_FOLDER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_PATH = os.path.join(APP_FOLDER, "scripts", "replay.mjs")
URL = "https://github.com/UBayouski/Grimsheet"
UTC = datetime.timezone.utc


def load_private_copy(name):
    """A fresh copy of the Launcher module, so a test can reach the real functions that setUp patched."""
    spec = importlib.util.spec_from_file_location(name, os.path.join(APP_FOLDER, "scripts", "replay_cron.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeClock:
    """A clock that only moves when the Launcher sleeps."""

    def __init__(self):
        self.now = datetime.datetime(2026, 12, 1, 3, 0, 0, tzinfo=UTC)
        self.sleeps = []

    def _now(self):
        return self.now

    def _sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += datetime.timedelta(seconds=seconds)


class FakeChild:
    """A child with pid, poll() and kill(). It exits `exit_code` after `exit_after` fake seconds."""

    def __init__(self, clock, exit_after=1.0, exit_code=0):
        self.pid = 4321
        self.clock = clock
        self.born = clock.now
        self.exit_after = exit_after
        self.exit_code = exit_code
        self.killed = False

    def poll(self):
        if self.killed:
            return 1
        if self.exit_after is None:
            return None
        if (self.clock.now - self.born).total_seconds() >= self.exit_after:
            return self.exit_code
        return None

    def kill(self):
        self.killed = True


class RaisesOnAnyAttribute:
    def __getattribute__(self, name):
        raise AssertionError("the Launcher touched ctx." + name)


class LauncherTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="replay-cron-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.data = os.path.join(self.tmp, "data")
        self.launcher = os.path.join(self.data, "launcher")
        self.clock = FakeClock()
        self.spawn_calls = []
        self.child_kwargs = {"exit_after": 1.0, "exit_code": 0}
        self.on_spawn = None
        self.spawn_error = None
        self.children = []
        self.kill_calls = []

        def fake_spawn(args, cwd, out):
            self.spawn_calls.append({"args": list(args), "cwd": cwd, "out": out, "out_open": getattr(out, "closed", None) is False})
            if self.on_spawn:
                self.on_spawn(out)
            if self.spawn_error:
                raise self.spawn_error
            child = FakeChild(self.clock, **self.child_kwargs)
            self.children.append(child)
            return child

        patches = [
            mock.patch.object(replay_cron, "_spawn", side_effect=fake_spawn),
            mock.patch.object(replay_cron, "_kill_tree", side_effect=lambda proc: self.kill_calls.append(proc)),
            mock.patch.object(replay_cron, "_now", side_effect=self.clock._now),
            mock.patch.object(replay_cron, "_sleep", side_effect=self.clock._sleep),
            mock.patch.object(replay_cron, "_data_dir", side_effect=lambda: self.data),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    # helpers
    def write_control(self, content):
        os.makedirs(self.launcher, exist_ok=True)
        path = os.path.join(self.launcher, "control.json")
        with open(path, "wb") as f:
            f.write(content if isinstance(content, bytes) else content.encode("utf-8"))
        return path

    def read_launch(self):
        with open(os.path.join(self.launcher, "last-launch.json"), "rb") as f:
            raw = f.read()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), "last-launch.json must have no BOM")
        return json.loads(raw.decode("utf-8"))

    def child_args(self):
        return self.spawn_calls[-1]["args"]


class TestChildArguments(LauncherTestCase):
    def test_arguments_are_exact_and_the_working_folder_is_the_app_folder(self):
        replay_cron.run()
        self.assertEqual(len(self.spawn_calls), 1)
        call = self.spawn_calls[0]
        self.assertEqual(call["args"], ["node", SCRIPT_PATH, "--repo-url", URL, "--branch", "main", "--cron-timeout", "900"])
        self.assertEqual(call["cwd"], APP_FOLDER)

    def test_output_is_one_file_object_for_both_streams(self):
        replay_cron.run()
        out = self.spawn_calls[0]["out"]
        self.assertTrue(hasattr(out, "write"))
        self.assertNotEqual(out, subprocess.PIPE)

    def test_the_real_spawn_uses_no_shell_no_env_and_no_pipes(self):
        private = load_private_copy("replay_cron_private_spawn")
        sentinel = object()
        out = object()
        with mock.patch.object(subprocess, "Popen", return_value=sentinel) as popen:
            result = private._spawn(["node", "x"], "C:\\work", out)
        self.assertIs(result, sentinel)
        args, kwargs = popen.call_args
        self.assertEqual(args[0], ["node", "x"])
        self.assertEqual(kwargs["cwd"], "C:\\work")
        self.assertIs(kwargs["stdout"], out)
        self.assertIs(kwargs["stderr"], out)
        self.assertFalse(kwargs.get("shell", False))
        self.assertNotIn("env", kwargs)
        for key in ("stdout", "stderr", "stdin"):
            self.assertIsNot(kwargs.get(key), subprocess.PIPE)

class TestContext(LauncherTestCase):
    def test_run_accepts_no_argument_and_a_dummy_and_behaves_the_same(self):
        replay_cron.run()
        first = self.child_args()
        replay_cron.run(object())
        self.assertEqual(self.child_args(), first)
        self.assertEqual(len(self.spawn_calls), 2)

    def test_ctx_is_never_touched(self):
        replay_cron.run(RaisesOnAnyAttribute())
        self.assertEqual(len(self.spawn_calls), 1)

    def test_exceptions_are_plain_runtime_errors_with_a_dummy_too(self):
        self.child_kwargs["exit_code"] = 1
        with self.assertRaises(RuntimeError) as cm:
            replay_cron.run(RaisesOnAnyAttribute())
        self.assertIs(type(cm.exception), RuntimeError)


class TestChildLog(LauncherTestCase):
    def log_path(self):
        return os.path.join(self.launcher, "last-child.log")

    def test_the_log_is_open_when_spawn_is_called_and_closed_after(self):
        seen = {}

        def on_spawn(out):
            seen["name"] = out.name
            seen["closed"] = out.closed
            out.write(b"child output")

        self.on_spawn = on_spawn
        replay_cron.run()
        self.assertEqual(os.path.normcase(seen["name"]), os.path.normcase(self.log_path()))
        self.assertFalse(seen["closed"])
        self.assertTrue(self.spawn_calls[0]["out"].closed)
        with open(self.log_path(), "rb") as f:
            self.assertEqual(f.read(), b"child output")

    def test_a_second_launch_overwrites_the_first(self):
        self.on_spawn = lambda out: out.write(b"first launch with a long text")
        replay_cron.run()
        self.on_spawn = lambda out: out.write(b"second")
        replay_cron.run()
        with open(self.log_path(), "rb") as f:
            self.assertEqual(f.read(), b"second")

    def test_the_log_is_not_parsed(self):
        os.makedirs(self.launcher)
        with open(self.log_path(), "wb") as f:
            f.write(b"\xff\xfe not json at all {{{")
        replay_cron.run()  # must not raise because of the old content
        self.assertEqual(self.read_launch()["outcome"], "child-exited")

    def test_child_log_ok_is_recorded(self):
        replay_cron.run()
        self.assertEqual(self.read_launch()["childLog"], "ok")

    def test_a_log_that_cannot_be_opened_starts_the_child_with_devnull(self):
        os.makedirs(self.log_path())  # a folder where the file should be: open() raises OSError
        replay_cron.run()
        self.assertEqual(len(self.spawn_calls), 1)
        self.assertEqual(self.spawn_calls[0]["out"], subprocess.DEVNULL)
        self.assertEqual(self.read_launch()["childLog"], "unavailable")
        self.assertEqual(self.read_launch()["outcome"], "child-exited")

    def test_the_result_is_the_same_with_and_without_a_log(self):
        os.makedirs(self.log_path())
        self.assertIsNone(replay_cron.run())


class TestPaths(LauncherTestCase):
    def test_the_working_directory_does_not_matter(self):
        elsewhere = tempfile.mkdtemp(prefix="replay-cron-cwd-")
        self.addCleanup(shutil.rmtree, elsewhere, True)
        old = os.getcwd()
        os.chdir(elsewhere)
        try:
            replay_cron.run()
        finally:
            os.chdir(old)
        self.assertEqual(self.spawn_calls[0]["cwd"], APP_FOLDER)
        self.assertEqual(self.child_args()[1], SCRIPT_PATH)

    def test_the_real_data_dir_is_derived_from_file(self):
        private = load_private_copy("replay_cron_private_paths")
        elsewhere = tempfile.mkdtemp(prefix="replay-cron-cwd-")
        self.addCleanup(shutil.rmtree, elsewhere, True)
        old = os.getcwd()
        os.chdir(elsewhere)
        try:
            self.assertEqual(private._data_dir(), os.path.join(APP_FOLDER, "data"))
        finally:
            os.chdir(old)


class TestControlFile(LauncherTestCase):
    def assert_defaults(self, control_file, cause=None):
        self.assertEqual(self.child_args()[3], URL)
        self.assertEqual(self.child_args()[5], "main")
        launch = self.read_launch()
        self.assertEqual(launch["controlFile"], control_file)
        if cause is not None:
            self.assertEqual(launch["controlFileCause"], cause)
        else:
            self.assertIsNone(launch["controlFileCause"])

    def test_missing_uses_the_defaults(self):
        replay_cron.run()
        self.assert_defaults("missing")
        self.assertFalse(os.path.exists(os.path.join(self.launcher, "control.json")))

    def test_valid_file_is_used(self):
        self.write_control(json.dumps({"repoUrl": "https://example.com/a/b", "branch": "dev"}))
        replay_cron.run()
        self.assertEqual(self.child_args()[3], "https://example.com/a/b")
        self.assertEqual(self.child_args()[5], "dev")
        launch = self.read_launch()
        self.assertEqual(launch["controlFile"], "ok")
        self.assertEqual((launch["repoUrl"], launch["branch"]), ("https://example.com/a/b", "dev"))

    def test_invalid_json(self):
        self.write_control("{ not json")
        replay_cron.run()
        self.assert_defaults("invalid", "not valid JSON")

    def test_bom_prefixed(self):
        self.write_control(b"\xef\xbb\xbf" + json.dumps({"repoUrl": "x", "branch": "y"}).encode())
        replay_cron.run()
        self.assert_defaults("invalid", "byte order mark")

    def test_not_utf8(self):
        self.write_control(b"\xff\xfe\x00{")
        replay_cron.run()
        self.assert_defaults("invalid", "not valid UTF-8")

    def test_a_json_array(self):
        self.write_control("[1, 2]")
        replay_cron.run()
        self.assert_defaults("invalid", "not a JSON object")

    def test_a_field_of_the_wrong_type_falls_back_per_field(self):
        self.write_control(json.dumps({"repoUrl": 5, "branch": "dev"}))
        replay_cron.run()
        self.assertEqual(self.child_args()[3], URL)
        self.assertEqual(self.child_args()[5], "dev")
        self.assertEqual(self.read_launch()["controlFile"], "ok")
        self.write_control(json.dumps({"repoUrl": "https://example.com/z", "branch": ""}))
        replay_cron.run()
        self.assertEqual(self.child_args()[3], "https://example.com/z")
        self.assertEqual(self.child_args()[5], "main")

    def test_the_file_is_never_changed(self):
        for content in (b"{ not json", b'{"repoUrl": "https://example.com/a", "branch": "dev"}', b"\xef\xbb\xbf{}"):
            path = self.write_control(content)
            replay_cron.run()
            with open(path, "rb") as f:
                self.assertEqual(f.read(), content)


class TestLastLaunch(LauncherTestCase):
    def test_fields_for_a_normal_exit(self):
        self.child_kwargs.update(exit_after=2.0, exit_code=0)
        replay_cron.run()
        launch = self.read_launch()
        self.assertEqual(
            sorted(launch),
            ["branch", "childLog", "controlFile", "controlFileCause", "exitCode", "finishedAt", "outcome", "repoUrl", "startedAt"],
        )
        self.assertEqual(launch["startedAt"], "2026-12-01T03:00:00.000Z")
        self.assertEqual(launch["finishedAt"], "2026-12-01T03:00:02.000Z")
        self.assertEqual(launch["exitCode"], 0)
        self.assertEqual(launch["outcome"], "child-exited")
        self.assertEqual((launch["repoUrl"], launch["branch"]), (URL, "main"))

    def test_no_temp_file_is_left_behind(self):
        replay_cron.run()
        names = sorted(os.listdir(self.launcher))
        self.assertEqual(names, ["last-child.log", "last-launch.json"])

    def test_it_is_written_before_the_exception_is_raised(self):
        self.child_kwargs["exit_code"] = 1
        with self.assertRaises(RuntimeError):
            replay_cron.run()
        self.assertEqual(self.read_launch()["exitCode"], 1)

    def test_it_is_written_through_a_temp_file_and_os_replace(self):
        with mock.patch.object(os, "replace", wraps=os.replace) as rep:
            replay_cron.run()
        targets = [call.args[1] for call in rep.call_args_list]
        self.assertIn(os.path.join(self.launcher, "last-launch.json"), targets)
        for call in rep.call_args_list:
            self.assertEqual(os.path.dirname(call.args[0]), self.launcher)


class TestExitMapping(LauncherTestCase):
    def test_exit_0_returns_none(self):
        self.assertIsNone(replay_cron.run())

    def test_exit_3_raises_already_running_and_records_the_code(self):
        self.child_kwargs["exit_code"] = 3
        with self.assertRaises(RuntimeError) as cm:
            replay_cron.run()
        self.assertIs(type(cm.exception), RuntimeError)
        self.assertIn("already running", str(cm.exception))
        self.assertEqual(self.read_launch()["exitCode"], 3)

    def test_exit_1_raises(self):
        self.child_kwargs["exit_code"] = 1
        with self.assertRaises(RuntimeError) as cm:
            replay_cron.run()
        self.assertEqual(str(cm.exception), "The replay script exited with code 1.")
        self.assertIs(type(cm.exception), RuntimeError)

    def test_exit_4_raises_with_its_code(self):
        self.child_kwargs["exit_code"] = 4
        with self.assertRaises(RuntimeError) as cm:
            replay_cron.run()
        self.assertIn("code 4", str(cm.exception))

    def test_spawn_failure_raises_and_is_recorded(self):
        self.spawn_error = FileNotFoundError("node not found")
        with self.assertRaises(RuntimeError) as cm:
            replay_cron.run()
        self.assertIs(type(cm.exception), RuntimeError)
        self.assertIn("Could not start node", str(cm.exception))
        launch = self.read_launch()
        self.assertEqual(launch["outcome"], "spawn-failed")
        self.assertIsNone(launch["exitCode"])

    def test_a_child_that_never_exits_is_killed_after_kill_after_seconds(self):
        self.child_kwargs["exit_after"] = None
        with self.assertRaises(RuntimeError) as cm:
            replay_cron.run()
        self.assertIs(type(cm.exception), RuntimeError)
        self.assertEqual(str(cm.exception), "The replay did not finish in time and was stopped.")
        self.assertEqual(self.kill_calls, [self.children[0]])
        launch = self.read_launch()
        self.assertEqual(launch["outcome"], "killed-by-launcher")
        self.assertIsNone(launch["exitCode"])
        waited = (self.clock.now - datetime.datetime(2026, 12, 1, 3, 0, 0, tzinfo=UTC)).total_seconds()
        self.assertGreaterEqual(waited, replay_cron.KILL_AFTER)
        self.assertLess(waited, replay_cron.KILL_AFTER + 1)

    def test_the_wait_polls_with_half_second_sleeps(self):
        self.child_kwargs["exit_after"] = 3.0
        replay_cron.run()
        self.assertTrue(self.clock.sleeps)
        self.assertTrue(all(s == 0.5 for s in self.clock.sleeps))

    def test_a_failure_to_write_last_launch_is_added_to_the_exception_text(self):
        os.makedirs(os.path.join(self.launcher, "last-launch.json"))  # a folder: the replace fails
        self.child_kwargs["exit_code"] = 1
        with self.assertRaises(RuntimeError) as cm:
            replay_cron.run()
        text = str(cm.exception)
        self.assertIn("The replay script exited with code 1.", text)
        self.assertIn("last-launch.json", text)

    def test_a_failure_to_write_last_launch_after_a_good_exit_does_not_raise(self):
        os.makedirs(os.path.join(self.launcher, "last-launch.json"))
        self.assertIsNone(replay_cron.run())


class TestKillTree(unittest.TestCase):
    def test_taskkill_is_started_with_an_argument_list(self):
        proc = mock.Mock(pid=77)
        with mock.patch.object(subprocess, "run", return_value=mock.Mock(returncode=0)) as run:
            replay_cron._kill_tree(proc)
        args, kwargs = run.call_args
        self.assertEqual(args[0], ["taskkill", "/PID", "77", "/T", "/F"])
        self.assertFalse(kwargs.get("shell", False))
        proc.kill.assert_not_called()

    def test_falls_back_to_kill_when_taskkill_fails(self):
        proc = mock.Mock(pid=77)
        with mock.patch.object(subprocess, "run", return_value=mock.Mock(returncode=128)):
            replay_cron._kill_tree(proc)
        proc.kill.assert_called_once()

    def test_falls_back_to_kill_when_taskkill_cannot_start(self):
        proc = mock.Mock(pid=77)
        with mock.patch.object(subprocess, "run", side_effect=OSError("no taskkill")):
            replay_cron._kill_tree(proc)
        proc.kill.assert_called_once()


class TestConstants(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(replay_cron.CRON_TIMEOUT, 900)
        self.assertEqual(replay_cron.KILL_AFTER, 895)
        self.assertEqual(replay_cron.DEFAULT_REPO_URL, URL)
        self.assertEqual(replay_cron.DEFAULT_BRANCH, "main")


class TestImport(unittest.TestCase):
    def test_importing_the_module_does_not_start_a_run(self):
        saved = sys.modules.pop("scripts.replay_cron", None)
        try:
            with mock.patch.object(subprocess, "Popen") as popen, mock.patch.object(subprocess, "run") as run_:
                fresh = importlib.import_module("scripts.replay_cron")
            popen.assert_not_called()
            run_.assert_not_called()
            self.assertTrue(callable(fresh.run))
        finally:
            sys.modules.pop("scripts.replay_cron", None)
            if saved is not None:
                sys.modules["scripts.replay_cron"] = saved


class TestNodeEntryFlags(unittest.TestCase):
    def test_replay_mjs_mentions_the_three_flags_the_launcher_passes(self):
        with open(SCRIPT_PATH, "r", encoding="utf-8") as f:
            text = f.read()
        for flag in ("--repo-url", "--branch", "--cron-timeout"):
            self.assertIn(flag, text)

    def test_the_timeouts_match_the_design(self):
        self.assertEqual(replay_cron.CRON_TIMEOUT, 900)
        self.assertEqual(replay_cron.KILL_AFTER, 895)
