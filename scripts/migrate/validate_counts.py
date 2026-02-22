#!/usr/bin/env python3
"""Validate migrated PostgreSQL row counts against SQLite snapshot."""

from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DEFAULT_SQLITE_PATH = "data/x_monitor.snapshot.db"


def require_psycopg():
    try:
        import psycopg  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "psycopg is required. Install with: python3 -m pip install 'psycopg[binary]'"
        ) from exc
    return psycopg


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate SQLite to PostgreSQL migration counts")
    parser.add_argument(
        "--sqlite-path",
        default=DEFAULT_SQLITE_PATH,
        help=f"Path to SQLite snapshot (default: {DEFAULT_SQLITE_PATH})",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="PostgreSQL connection URL. If omitted, PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD are used.",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=20,
        help="Number of random posts to spot-check (default: 20)",
    )
    return parser.parse_args()


def connect_postgres(database_url: str):
    psycopg = require_psycopg()
    if database_url:
        return psycopg.connect(database_url)

    required = ["PGHOST", "PGDATABASE", "PGUSER"]
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise SystemExit(f"Missing DB config. Set DATABASE_URL or {', '.join(missing)}")

    kwargs = {
        "host": os.environ["PGHOST"],
        "port": int(os.environ.get("PGPORT", "5432")),
        "dbname": os.environ["PGDATABASE"],
        "user": os.environ["PGUSER"],
        "password": os.environ.get("PGPASSWORD", ""),
    }
    sslmode = os.environ.get("PGSSLMODE")
    if sslmode:
        kwargs["sslmode"] = sslmode
    return psycopg.connect(**kwargs)


def count_sqlite(connection: sqlite3.Connection, table: str) -> int:
    return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def count_postgres(cur, table: str) -> int:
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    return int(cur.fetchone()[0])


def parse_ts(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def normalize_handle(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.lstrip("@").lower()


def pick_field(row: sqlite3.Row, *keys: str) -> Any:
    for key in keys:
        if key in row.keys():
            return row[key]
    return None


def compare_random_posts(sqlite_con: sqlite3.Connection, pg_cur, sample_size: int) -> Dict[str, Any]:
    sample_size = max(sample_size, 0)
    if sample_size == 0:
        return {"requested": 0, "checked": 0, "missing_in_pg": [], "mismatches": []}

    local_rows = sqlite_con.execute("SELECT status_id FROM tweets WHERE status_id IS NOT NULL").fetchall()
    ids = [str(row[0]) for row in local_rows]
    if not ids:
        return {"requested": sample_size, "checked": 0, "missing_in_pg": [], "mismatches": []}

    if sample_size < len(ids):
        ids = random.sample(ids, sample_size)

    missing: List[str] = []
    mismatches: List[Dict[str, Any]] = []

    sqlite_con.row_factory = sqlite3.Row

    for status_id in ids:
        local = sqlite_con.execute("SELECT * FROM tweets WHERE status_id = ?", (status_id,)).fetchone()
        pg_cur.execute(
            """
            SELECT status_id, url, author_handle, body_text, is_significant, discovered_at
            FROM posts
            WHERE status_id = %s
            """,
            (status_id,),
        )
        remote = pg_cur.fetchone()

        if not remote:
            missing.append(status_id)
            continue

        local_url = pick_field(local, "url", "status_url", "tweet_url")
        local_handle = normalize_handle(pick_field(local, "author_handle", "handle", "author", "username"))
        local_body = pick_field(local, "body_text", "text", "tweet_text", "content")
        local_sig = bool(pick_field(local, "is_significant", "significant") or False)
        local_discovered = parse_ts(pick_field(local, "discovered_at", "captured_at", "created_at"))

        remote_discovered = remote[5]
        if remote_discovered is not None:
            remote_discovered = remote_discovered.astimezone(timezone.utc).isoformat()

        candidate = {
            "status_id": status_id,
            "fields": [],
        }

        checks = [
            ("url", local_url, remote[1]),
            ("author_handle", local_handle, normalize_handle(remote[2])),
            ("body_text", local_body, remote[3]),
            ("is_significant", local_sig, bool(remote[4])),
            ("discovered_at", local_discovered, remote_discovered),
        ]

        for field, local_value, remote_value in checks:
            if local_value != remote_value:
                candidate["fields"].append(
                    {"field": field, "local": local_value, "postgres": remote_value}
                )

        if candidate["fields"]:
            mismatches.append(candidate)

    return {
        "requested": sample_size,
        "checked": len(ids),
        "missing_in_pg": missing,
        "mismatches": mismatches,
    }


def main() -> int:
    args = parse_args()

    if not os.path.exists(args.sqlite_path):
        print(f"error: SQLite snapshot not found: {args.sqlite_path}", file=sys.stderr)
        return 1

    sqlite_con = sqlite3.connect(args.sqlite_path)

    local_tables = {
        "tweets": "posts",
        "reports": "reports",
        "watch_accounts": "watch_accounts",
        "runs": "pipeline_runs",
        "tweet_embeddings": "embeddings",
    }

    report: Dict[str, Any] = {"counts": {}, "spot_check": {}}

    with connect_postgres(args.database_url) as pg_con:
        with pg_con.cursor() as cur:
            for local_table, remote_table in local_tables.items():
                local_count = count_sqlite(sqlite_con, local_table)
                remote_count = count_postgres(cur, remote_table)
                report["counts"][local_table] = {
                    "sqlite": local_count,
                    "postgres": remote_count,
                    "delta": remote_count - local_count,
                }

            report["counts"]["post_metrics_snapshots"] = {
                "sqlite": None,
                "postgres": count_postgres(cur, "post_metrics_snapshots"),
                "delta": None,
            }

            report["spot_check"] = compare_random_posts(sqlite_con, cur, args.sample_size)

    sqlite_con.close()

    print(json.dumps(report, indent=2, sort_keys=True))

    mismatches = report["spot_check"].get("mismatches", [])
    missing = report["spot_check"].get("missing_in_pg", [])
    if mismatches or missing:
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
