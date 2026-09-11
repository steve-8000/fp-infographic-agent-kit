#!/usr/bin/env python3
"""Install the kit as an agent skill and register its MCP server.

Copies the skill into the host's skills directory and prints the exact MCP command to
register. It never edits a host config file it does not own.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKILL_FILES = ["SKILL.md", "README.md", "themes", "schemas", "templates", "examples", "docs", "adapters", "agents"]
HOSTS = {
    "omp": Path.home() / ".omp" / "agent" / "skills",
    "claude": Path.home() / ".claude" / "skills",
    "codex": Path.home() / ".codex" / "skills",
    "opencode": Path.home() / ".config" / "opencode" / "skills",
}


def build() -> None:
    if (ROOT / "dist" / "src" / "server.js").exists():
        return
    print("building…")
    subprocess.run(["npm", "install"], cwd=ROOT, check=True)
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)


def install(host: str, name: str) -> Path:
    target = HOSTS[host] / name
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for item in SKILL_FILES:
        source = ROOT / item
        if not source.exists():
            continue
        if source.is_dir():
            shutil.copytree(source, target / item)
        else:
            shutil.copy2(source, target / item)
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", choices=sorted(HOSTS), default="omp")
    parser.add_argument("--name", default="fp-infographic")
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()

    if not args.skip_build:
        build()
    target = install(args.host, args.name)

    print(f"skill installed: {target}")
    print("register the MCP server with this command:")
    print(json.dumps({"command": "node", "args": [str(ROOT / "dist" / "src" / "server.js")]}, indent=2))
    print("\nverify:  node", ROOT / "dist" / "src" / "cli.js", "doctor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
