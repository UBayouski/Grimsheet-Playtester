"""Nightly Launcher for the Grimsheet replay (cron script: scripts/replay_cron.py:run).

It reads the optional control file, starts `node scripts/replay.mjs`, waits for it, and writes
data/launcher/last-launch.json. Standard library only. The Node script does the real work; the
Launcher never parses its output. See .kiro/specs/replay-runner/design.md, "Python Launcher design".
"""

import datetime
import json
import os
import subprocess
import sys
import tempfile
import time

CRON_TIMEOUT = 900  # seconds; equals the cron "timeout" in app.json (packaging checks this)
KILL_AFTER = CRON_TIMEOUT - 5  # the Launcher stops waiting here
DEFAULT_REPO_URL = "https://github.com/UBayouski/Grimsheet"
DEFAULT_BRANCH = "main"
POLL_SECONDS = 0.5

# Paths come from this file's location, never from the working directory.
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_FOLDER = os.path.dirname(_SCRIPTS_DIR)
_REPLAY_SCRIPT = os.path.join(_SCRIPTS_DIR, "replay.mjs")


# Seams for the tests ---------------------------------------------------------------------------


def _data_dir():
    return os.path.join(_APP_FOLDER, "data")


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _sleep(seconds):
    time.sleep(seconds)


def _spawn(args, cwd, out):
    """Start the child: an argument list, no shell, no env, no pipes (`out` is a file or DEVNULL)."""
    kwargs = {"cwd": cwd, "stdout": out, "stderr": out}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    return subprocess.Popen(args, **kwargs)


def _kill_tree(proc):
    """Kill the child and its descendants: taskkill /T /F, falling back to proc.kill()."""
    try:
        result = subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode == 0:
            return
    except OSError:
        pass
    proc.kill()


# Helpers ---------------------------------------------------------------------------------------


def _iso(moment):
    return moment.astimezone(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _read_control(launcher_dir):
    """Returns (repo_url, branch, control_file, cause). The control file is only ever read."""
    repo_url, branch = DEFAULT_REPO_URL, DEFAULT_BRANCH
    path = os.path.join(launcher_dir, "control.json")
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return repo_url, branch, "missing", None
    except OSError:
        return repo_url, branch, "invalid", "could not be read"
    if raw.startswith(b"\xef\xbb\xbf"):
        return repo_url, branch, "invalid", "byte order mark"
    try:
        value = json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return repo_url, branch, "invalid", "not valid UTF-8"
    except ValueError:
        return repo_url, branch, "invalid", "not valid JSON"
    if not isinstance(value, dict):
        return repo_url, branch, "invalid", "not a JSON object"
    if isinstance(value.get("repoUrl"), str) and value["repoUrl"]:
        repo_url = value["repoUrl"]
    if isinstance(value.get("branch"), str) and value["branch"]:
        branch = value["branch"]
    return repo_url, branch, "ok", None


def _write_last_launch(launcher_dir, record):
    """Atomic write: a temporary file in the same folder, then os.replace. UTF-8, no BOM."""
    os.makedirs(launcher_dir, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".last-launch.", suffix=".tmp", dir=launcher_dir)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write((json.dumps(record, indent=2) + "\n").encode("utf-8"))
        os.replace(temp, os.path.join(launcher_dir, "last-launch.json"))
    except BaseException:
        try:
            os.remove(temp)
        except OSError:
            pass
        raise


# Entry point -----------------------------------------------------------------------------------


def run(ctx=None):
    """Run one launch. `ctx` is the gateway's ScriptContext; it is never used."""
    started = _now()
    launcher_dir = os.path.join(_data_dir(), "launcher")
    repo_url, branch, control_file, control_cause = _read_control(launcher_dir)
    args = ["node", _REPLAY_SCRIPT, "--repo-url", repo_url, "--branch", branch, "--cron-timeout", str(CRON_TIMEOUT)]

    log = None
    child_log = "unavailable"
    try:
        os.makedirs(launcher_dir, exist_ok=True)
        log = open(os.path.join(launcher_dir, "last-child.log"), "wb")
        child_log = "ok"
    except OSError:
        log = None

    outcome = "child-exited"
    exit_code = None
    spawn_error = None
    proc = None
    try:
        try:
            proc = _spawn(args, _APP_FOLDER, log if log is not None else subprocess.DEVNULL)
        except OSError as error:
            outcome = "spawn-failed"
            spawn_error = error
        if proc is not None:
            waited_from = _now()
            while True:
                code = proc.poll()
                if code is not None:
                    exit_code = code
                    break
                if (_now() - waited_from).total_seconds() >= KILL_AFTER:
                    _kill_tree(proc)
                    outcome = "killed-by-launcher"
                    break
                _sleep(POLL_SECONDS)
    finally:
        if log is not None:
            log.close()

    record = {
        "startedAt": _iso(started),
        "finishedAt": _iso(_now()),
        "exitCode": exit_code,
        "outcome": outcome,
        "controlFile": control_file,
        "controlFileCause": control_cause,
        "childLog": child_log,
        "repoUrl": repo_url,
        "branch": branch,
    }
    write_failure = None
    try:
        _write_last_launch(launcher_dir, record)
    except Exception as error:  # the original cause must not be lost, so it is added to the text below
        write_failure = error

    if outcome == "spawn-failed":
        message = "Could not start node: %s." % spawn_error
    elif outcome == "killed-by-launcher":
        message = "The replay did not finish in time and was stopped."
    elif exit_code == 0:
        return None
    elif exit_code == 3:
        message = "Another replay is already running; this launch did nothing."
    else:
        message = "The replay script exited with code %s." % exit_code
    if write_failure is not None:
        message += " (last-launch.json could not be written: %s)" % write_failure
    raise RuntimeError(message)


if __name__ == "__main__":
    run()
