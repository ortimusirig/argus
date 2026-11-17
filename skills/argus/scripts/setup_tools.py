#!/usr/bin/env python3
"""Finds and installs what argus needs on this computer. Python 3.10+, standard library only.

  python -B setup_tools.py            report what is present and what is missing
  python -B setup_tools.py --install  also install what argus can install itself

Installs by itself (with --install):
  graphify   into its own Python environment at ~/.argus/venv, so nothing else on the computer changes
  CodeTour   the VS Code extension vsls-contrib.codetour (only when VS Code is installed)
Cannot install by itself (a system installer is needed): Python, git, VS Code. For those it prints the command.

Remembers where graphify is in ~/.argus/config.json; the last line of the report gives the path to use.
Exit code 0: everything argus requires is present (Python, graphify). 1: something required is missing.
git is optional: with it argus reads the history of the code; without it the notes carry hashes of the source only.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path(os.environ.get("ARGUS_HOME") or Path.home() / ".argus")
CONFIG = HOME / "config.json"
VENV = HOME / "venv"
PACKAGE = "graphifyy"            # the package is spelled with two y; the command is graphify
EXTENSION = "vsls-contrib.codetour"
MIN_AGE_DAYS = 7                 # install a release at least this old: a release made hours ago is not trusted yet
HINTS = {
    "python": {"win32": "winget install Python.Python.3.13", "darwin": "brew install python", "linux": "sudo apt install python3 python3-venv"},
    "git": {"win32": "winget install Git.Git", "darwin": "brew install git", "linux": "sudo apt install git"},
    "vscode": {"win32": "winget install Microsoft.VisualStudioCode", "darwin": "brew install --cask visual-studio-code", "linux": "see https://code.visualstudio.com/download"},
}


def run(cmd, timeout=600):
    try:
        out = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=timeout)
        return out.returncode, (out.stdout + out.stderr).strip()
    except (OSError, subprocess.SubprocessError) as error:
        return 1, str(error)


def hint(tool):
    key = "win32" if sys.platform == "win32" else "darwin" if sys.platform == "darwin" else "linux"
    return HINTS[tool][key]


def load_config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(config):
    HOME.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def venv_program(name):
    folder = VENV / ("Scripts" if sys.platform == "win32" else "bin")
    return folder / (name + (".exe" if sys.platform == "win32" else ""))


def find_graphify(given=None):
    """(path, version) of a graphify that runs, or (None, None). Order: the given path, the remembered one, the
    one on PATH, the one in argus's own environment."""
    for candidate in (given, load_config().get("graphify"), shutil.which("graphify"), venv_program("graphify")):
        if candidate and Path(candidate).is_file():
            code, text = run([candidate, "--version"], timeout=60)
            if code == 0 and text:
                return str(candidate), text.split()[-1]
    return None, None


def pick_release():
    """The newest release of the package that is at least MIN_AGE_DAYS old and not withdrawn, or None."""
    try:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{PACKAGE}/json", timeout=30) as response:
            data = json.load(response)
    except (OSError, ValueError):
        return None
    limit = datetime.now(timezone.utc) - timedelta(days=MIN_AGE_DAYS)
    good = []
    for version, files in data.get("releases", {}).items():
        if not files or any(f.get("yanked") for f in files):
            continue
        when = datetime.fromisoformat(files[0]["upload_time_iso_8601"].replace("Z", "+00:00"))
        if when <= limit:
            good.append((when, version))
    return max(good)[1] if good else None


def install_graphify():
    """Creates argus's own environment and installs graphify into it. Returns (ok, what happened)."""
    if not venv_program("python").is_file():
        code, text = run([sys.executable, "-m", "venv", VENV])
        if code != 0:
            return False, f"could not create {VENV}: {text[-300:]}"
    version = pick_release()
    wanted = f"{PACKAGE}=={version}" if version else PACKAGE
    code, text = run([venv_program("python"), "-m", "pip", "install", "--disable-pip-version-check", "-q", wanted], timeout=1800)
    if code != 0:
        return False, f"pip install {wanted} failed: {text[-300:]}"
    return True, f"installed {wanted} into {VENV}"


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--install", action="store_true", help="install graphify and CodeTour when they are missing")
    ap.add_argument("--graphify", help="path of a graphify that is already installed; it is remembered")
    ap.add_argument("--no-codetour", action="store_true", help="do not install the CodeTour extension")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    args = ap.parse_args()
    report, actions = {}, []

    ok = sys.version_info >= (3, 10)
    report["python"] = {"required": True, "ok": ok, "found": sys.version.split()[0], "path": sys.executable,
                        "fix": None if ok else hint("python")}

    git = shutil.which("git")
    report["git"] = {"required": False, "ok": bool(git), "found": run([git, "--version"], 30)[1] if git else None,
                     "path": git, "fix": None if git else hint("git")}

    path, version = find_graphify(args.graphify)
    if not path and args.install:
        done, what = install_graphify()
        actions.append(what)
        if done:
            path, version = find_graphify(venv_program("graphify"))
    if path:
        config = load_config()
        if config.get("graphify") != path:
            config["graphify"] = path
            save_config(config)
    report["graphify"] = {"required": True, "ok": bool(path), "found": version, "path": path,
                          "fix": None if path else f"python -B {Path(__file__).name} --install"}

    code_cmd = shutil.which("code")
    report["vscode"] = {"required": False, "ok": bool(code_cmd), "found": None, "path": code_cmd,
                        "fix": None if code_cmd else hint("vscode")}
    if code_cmd:
        report["vscode"]["found"] = (run([code_cmd, "--version"], 60)[1].splitlines() or [""])[0]
        listed = run([code_cmd, "--list-extensions", "--show-versions"], 120)[1].lower()
        have = next((line for line in listed.splitlines() if line.startswith(EXTENSION)), None)
        if not have and args.install and not args.no_codetour:
            code, text = run([code_cmd, "--install-extension", EXTENSION], 600)
            actions.append(f"installed the VS Code extension {EXTENSION}" if code == 0 else
                           f"could not install {EXTENSION}: {text[-200:]}")
            listed = run([code_cmd, "--list-extensions", "--show-versions"], 120)[1].lower()
            have = next((line for line in listed.splitlines() if line.startswith(EXTENSION)), None)
        report["codetour"] = {"required": False, "ok": bool(have), "found": have, "path": None,
                              "fix": None if have else f"code --install-extension {EXTENSION}"}
    else:
        report["codetour"] = {"required": False, "ok": False, "found": None, "path": None,
                              "fix": "install VS Code first; needed only for the guided walk"}

    ready = all(item["ok"] for item in report.values() if item["required"])
    if args.json:
        json.dump({"ready": ready, "tools": report, "actions": actions, "graphify": path}, sys.stdout, indent=2)
        sys.exit(0 if ready else 1)
    for action in actions:
        print(f"DONE {action}")
    for name, item in report.items():
        state = "ok     " if item["ok"] else ("MISSING" if item["required"] else "absent ")
        need = "required" if item["required"] else "optional"
        print(f"{state} {name:9} {need:9} {item['found'] or ''}" + ("" if item["ok"] else f"   -> {item['fix']}"))
    print(f"RESULT {'ready' if ready else 'not ready'}" + (f"; graphify: {path}" if path else ""))
    sys.exit(0 if ready else 1)


if __name__ == "__main__":
    main()
