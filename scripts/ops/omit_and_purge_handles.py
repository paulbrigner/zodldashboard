#!/usr/bin/env python3
"""
Add one or more handles to omit lists and purge matching rows locally/remotely.

This script updates:
- Local OpenClaw collector omit defaults
- Server lambda omit defaults (repo files)
- README omit default example

And can purge:
- Local SQLite rows for matching author handles
- Remote Postgres rows via /v1/ops/purge-handle
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable, List


LAUNCHD_JOBS = [
    (
        "com.openclaw.xmonitor.priority",
        Path("/Users/paulbrigner/Library/LaunchAgents/com.openclaw.xmonitor.priority.plist"),
    ),
    (
        "com.openclaw.xmonitor.discovery",
        Path("/Users/paulbrigner/Library/LaunchAgents/com.openclaw.xmonitor.discovery.plist"),
    ),
]


def normalize_handle(value: str) -> str:
    return value.strip().lstrip("@").lower()


def parse_handles(values: Iterable[str]) -> List[str]:
    ordered: List[str] = []
    seen = set()
    for raw in values:
        for token in re.split(r"[,\s]+", raw.strip()):
            handle = normalize_handle(token)
            if not handle or handle in seen:
                continue
            seen.add(handle)
            ordered.append(handle)
    return ordered


def parse_csv_handles(text: str) -> List[str]:
    return parse_handles([text])


def merged_handles(existing: List[str], additions: List[str]) -> List[str]:
    merged = list(existing)
    existing_set = set(existing)
    for handle in additions:
        if handle not in existing_set:
            merged.append(handle)
            existing_set.add(handle)
    return merged


def update_local_omit_python(path: Path, additions: List[str]) -> dict:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'(DEFAULT_INGEST_OMIT_HANDLES_RAW\s*=\s*os\.getenv\(\s*"XMONITOR_INGEST_OMIT_HANDLES"\s*,\s*")([^"]*)("\s*,?\s*\))',
        re.S,
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"could not find omit default in {path}")

    existing = parse_csv_handles(match.group(2))
    merged = merged_handles(existing, additions)
    updated = pattern.sub(rf'\1{",".join(merged)}\3', text, count=1)

    changed = updated != text
    if changed:
        path.write_text(updated, encoding="utf-8")

    return {"file": str(path), "changed": changed, "handles": merged}


def update_server_omit_array(path: Path, additions: List[str]) -> dict:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r"const DEFAULT_INGEST_OMIT_HANDLES\s*=\s*\[(.*?)\];", re.S)
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"could not find DEFAULT_INGEST_OMIT_HANDLES in {path}")

    existing = re.findall(r'"([^"]+)"', match.group(1))
    merged = merged_handles(existing, additions)
    block = "const DEFAULT_INGEST_OMIT_HANDLES = [\n"
    block += "".join(f'  "{handle}",\n' for handle in merged)
    block += "];"

    updated = pattern.sub(block, text, count=1)
    changed = updated != text
    if changed:
        path.write_text(updated, encoding="utf-8")

    return {"file": str(path), "changed": changed, "handles": merged}


def update_provision_default(path: Path, additions: List[str]) -> dict:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r'(INGEST_OMIT_HANDLES="\$\{INGEST_OMIT_HANDLES:-)([^}]*)(\}")')
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"could not find INGEST_OMIT_HANDLES default in {path}")

    existing = parse_csv_handles(match.group(2))
    merged = merged_handles(existing, additions)
    updated = pattern.sub(rf'\1{",".join(merged)}\3', text, count=1)

    changed = updated != text
    if changed:
        path.write_text(updated, encoding="utf-8")

    return {"file": str(path), "changed": changed, "handles": merged}


def update_readme_default(path: Path, additions: List[str]) -> dict:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"(\| `XMONITOR_INGEST_OMIT_HANDLES` .*defaults include `)([^`]+)(`\)\. \|)",
        re.M,
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"could not find README omit default row in {path}")

    existing = parse_handles([match.group(2)])
    merged = merged_handles(existing, additions)
    updated = pattern.sub(rf'\1{", ".join(merged)}\3', text, count=1)

    changed = updated != text
    if changed:
        path.write_text(updated, encoding="utf-8")

    return {"file": str(path), "changed": changed, "handles": merged}


def shell(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True)


def pause_jobs() -> None:
    for label, _ in LAUNCHD_JOBS:
        shell(["launchctl", "disable", f"gui/501/{label}"])
        shell(["launchctl", "bootout", f"gui/501/{label}"])


def resume_jobs() -> None:
    for label, plist in LAUNCHD_JOBS:
        shell(["launchctl", "bootstrap", "gui/501", str(plist)])
        shell(["launchctl", "enable", f"gui/501/{label}"])
        shell(["launchctl", "kickstart", "-k", f"gui/501/{label}"])


def build_in_clause(handles: List[str]) -> str:
    return ",".join("?" for _ in handles)


def purge_local_sqlite(db_path: Path, handles: List[str]) -> dict:
    handles = [h.lower() for h in handles]
    in_clause = build_in_clause(handles)
    params = tuple(handles)

    conn = sqlite3.connect(str(db_path), timeout=20)
    conn.execute("PRAGMA busy_timeout = 20000")
    conn.row_factory = sqlite3.Row
    try:
        before_rows = conn.execute(
            f"SELECT lower(author_handle) AS handle, COUNT(*) AS n FROM tweets WHERE lower(author_handle) IN ({in_clause}) GROUP BY lower(author_handle)",
            params,
        ).fetchall()
        before_by_handle = {row["handle"]: int(row["n"]) for row in before_rows}

        before = {
            "tweets": int(
                conn.execute(f"SELECT COUNT(*) FROM tweets WHERE lower(author_handle) IN ({in_clause})", params).fetchone()[0]
            ),
            "reports": int(
                conn.execute(
                    f"SELECT COUNT(*) FROM reports WHERE status_id IN (SELECT status_id FROM tweets WHERE lower(author_handle) IN ({in_clause}))",
                    params,
                ).fetchone()[0]
            ),
            "tweet_embeddings": int(
                conn.execute(
                    f"SELECT COUNT(*) FROM tweet_embeddings WHERE status_id IN (SELECT status_id FROM tweets WHERE lower(author_handle) IN ({in_clause}))",
                    params,
                ).fetchone()[0]
            ),
            "tweets_fts": int(
                conn.execute(
                    f"SELECT COUNT(*) FROM tweets_fts WHERE lower(author_handle) IN ({in_clause})",
                    params,
                ).fetchone()[0]
            ),
            "watch_accounts": int(
                conn.execute(f"SELECT COUNT(*) FROM watch_accounts WHERE lower(handle) IN ({in_clause})", params).fetchone()[0]
            ),
        }

        conn.execute("BEGIN IMMEDIATE")
        conn.execute(f"CREATE TEMP TABLE _purge_ids AS SELECT status_id FROM tweets WHERE lower(author_handle) IN ({in_clause})", params)
        conn.execute("DELETE FROM reports WHERE status_id IN (SELECT status_id FROM _purge_ids)")
        conn.execute("DELETE FROM tweet_embeddings WHERE status_id IN (SELECT status_id FROM _purge_ids)")
        conn.execute(f"DELETE FROM tweets_fts WHERE status_id IN (SELECT status_id FROM _purge_ids) OR lower(author_handle) IN ({in_clause})", params)
        conn.execute("DELETE FROM tweets WHERE status_id IN (SELECT status_id FROM _purge_ids)")
        conn.execute(f"DELETE FROM watch_accounts WHERE lower(handle) IN ({in_clause})", params)
        conn.execute("DROP TABLE _purge_ids")
        conn.commit()

        after = {
            "tweets": int(
                conn.execute(f"SELECT COUNT(*) FROM tweets WHERE lower(author_handle) IN ({in_clause})", params).fetchone()[0]
            ),
            "reports": int(
                conn.execute(
                    f"SELECT COUNT(*) FROM reports WHERE status_id IN (SELECT status_id FROM tweets WHERE lower(author_handle) IN ({in_clause}))",
                    params,
                ).fetchone()[0]
            ),
            "tweet_embeddings": int(
                conn.execute(
                    f"SELECT COUNT(*) FROM tweet_embeddings WHERE status_id IN (SELECT status_id FROM tweets WHERE lower(author_handle) IN ({in_clause}))",
                    params,
                ).fetchone()[0]
            ),
            "tweets_fts": int(
                conn.execute(f"SELECT COUNT(*) FROM tweets_fts WHERE lower(author_handle) IN ({in_clause})", params).fetchone()[0]
            ),
            "watch_accounts": int(
                conn.execute(f"SELECT COUNT(*) FROM watch_accounts WHERE lower(handle) IN ({in_clause})", params).fetchone()[0]
            ),
        }

        return {
            "db_path": str(db_path),
            "by_handle_before_tweets": before_by_handle,
            "before": before,
            "after": after,
        }
    finally:
        conn.close()


def read_launchctl_env(key: str) -> str:
    proc = shell(["launchctl", "getenv", key])
    if proc.returncode == 0:
        return proc.stdout.strip()
    return ""


def purge_remote(api_base_url: str, api_key: str, handles: List[str], timeout: int = 30) -> list[dict]:
    results: list[dict] = []
    for handle in handles:
        payload = json.dumps({"author_handle": handle}).encode("utf-8")
        req = urllib.request.Request(
            f"{api_base_url.rstrip('/')}/ops/purge-handle",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json", "x-api-key": api_key},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(body) if body.strip() else {}
            results.append(
                {
                    "author_handle": handle,
                    "deleted": int(parsed.get("deleted", 0)) if isinstance(parsed, dict) else 0,
                    "ok": True,
                }
            )
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            results.append({"author_handle": handle, "ok": False, "status": exc.code, "error": body})
        except Exception as exc:  # noqa: BLE001
            results.append({"author_handle": handle, "ok": False, "error": str(exc)})
    return results


def update_lambda_omit_handles(
    *,
    handles: List[str],
    function_name: str,
    aws_profile: str,
    aws_region: str,
) -> dict:
    cmd_base = ["aws"]
    if aws_profile:
        cmd_base.extend(["--profile", aws_profile])
    if aws_region:
        cmd_base.extend(["--region", aws_region])

    get_cmd = cmd_base + [
        "lambda",
        "get-function-configuration",
        "--function-name",
        function_name,
        "--query",
        "Environment.Variables",
        "--output",
        "json",
    ]
    get_proc = subprocess.run(get_cmd, capture_output=True, text=True)
    if get_proc.returncode != 0:
        raise RuntimeError(
            f"aws get-function-configuration failed ({function_name}): "
            f"{(get_proc.stderr or get_proc.stdout).strip()}"
        )

    variables = json.loads(get_proc.stdout or "{}")
    if not isinstance(variables, dict):
        variables = {}

    existing = parse_csv_handles(str(variables.get("XMONITOR_INGEST_OMIT_HANDLES", "")))
    merged = merged_handles(existing, handles)
    changed = merged != existing
    variables["XMONITOR_INGEST_OMIT_HANDLES"] = ",".join(merged)

    if changed:
        update_cmd = cmd_base + [
            "lambda",
            "update-function-configuration",
            "--function-name",
            function_name,
            "--environment",
            json.dumps({"Variables": variables}, separators=(",", ":")),
        ]
        update_proc = subprocess.run(update_cmd, capture_output=True, text=True)
        if update_proc.returncode != 0:
            raise RuntimeError(
                f"aws update-function-configuration failed ({function_name}): "
                f"{(update_proc.stderr or update_proc.stdout).strip()}"
            )

        wait_cmd = cmd_base + ["lambda", "wait", "function-updated", "--function-name", function_name]
        wait_proc = subprocess.run(wait_cmd, capture_output=True, text=True)
        if wait_proc.returncode != 0:
            raise RuntimeError(
                f"aws lambda wait failed ({function_name}): "
                f"{(wait_proc.stderr or wait_proc.stdout).strip()}"
            )

    return {
        "function_name": function_name,
        "aws_profile": aws_profile,
        "aws_region": aws_region,
        "changed": changed,
        "handles": merged,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Add omit handles + purge local/remote records")
    parser.add_argument("handles", nargs="+", help="One or more handles, with or without @, comma-separated also supported")
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[2]),
        help="Path to zodldashboard repo root",
    )
    parser.add_argument(
        "--openclaw-root",
        default=str(Path.home() / ".openclaw" / "workspace"),
        help="Path to OpenClaw workspace root",
    )
    parser.add_argument(
        "--local-db",
        default=str(Path.home() / ".openclaw" / "workspace" / "memory" / "x_monitor.db"),
        help="Path to local SQLite db",
    )
    parser.add_argument("--api-base-url", default="https://www.zodldashboard.com/api/v1")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--update-lambda-env", action="store_true")
    parser.add_argument("--lambda-function-name", default="xmonitor-vpc-api")
    parser.add_argument("--aws-profile", default="")
    parser.add_argument("--aws-region", default="us-east-1")
    parser.add_argument("--skip-file-updates", action="store_true")
    parser.add_argument("--skip-local-purge", action="store_true")
    parser.add_argument("--skip-remote-purge", action="store_true")
    parser.add_argument("--no-pause-jobs", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    handles = parse_handles(args.handles)
    if not handles:
        parser.error("no valid handles provided")

    repo_root = Path(args.repo_root).resolve()
    openclaw_root = Path(args.openclaw_root).resolve()
    local_db = Path(args.local_db).resolve()

    summary: dict = {"handles": handles, "files": [], "local_purge": None, "remote_purge": None, "lambda_env_update": None}
    paused = False

    try:
        if not args.no_pause_jobs:
            pause_jobs()
            paused = True

        if not args.skip_file_updates:
            summary["files"].append(update_local_omit_python(openclaw_root / "scripts" / "x_monitor_kb.py", handles))
            summary["files"].append(update_local_omit_python(openclaw_root / "scripts" / "x_monitor_ingest_api.py", handles))
            summary["files"].append(update_server_omit_array(repo_root / "services" / "vpc-api-lambda" / "index.mjs", handles))
            summary["files"].append(update_provision_default(repo_root / "scripts" / "aws" / "provision_vpc_api_lambda.sh", handles))
            summary["files"].append(update_readme_default(repo_root / "README.md", handles))

        if not args.skip_local_purge:
            summary["local_purge"] = purge_local_sqlite(local_db, handles)

        if not args.skip_remote_purge:
            api_key = args.api_key.strip() or os.getenv("XMONITOR_API_KEY", "").strip() or read_launchctl_env("XMONITOR_API_KEY")
            if not api_key:
                raise RuntimeError("missing API key: pass --api-key or set XMONITOR_API_KEY")
            summary["remote_purge"] = purge_remote(args.api_base_url, api_key, handles)

        if args.update_lambda_env:
            summary["lambda_env_update"] = update_lambda_omit_handles(
                handles=handles,
                function_name=args.lambda_function_name,
                aws_profile=args.aws_profile.strip(),
                aws_region=args.aws_region.strip(),
            )

    finally:
        if paused:
            resume_jobs()

    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
