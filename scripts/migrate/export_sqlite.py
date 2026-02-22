#!/usr/bin/env python3
"""Export XMonitor SQLite tables to JSONL files."""

from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys
from typing import Dict

TABLES = ["tweets", "reports", "watch_accounts", "runs", "tweet_embeddings"]
DEFAULT_SQLITE_PATH = "/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db"
DEFAULT_OUT_DIR = "data/export"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export SQLite tables to JSONL")
    parser.add_argument(
        "--sqlite-path",
        default=DEFAULT_SQLITE_PATH,
        help=f"Path to x_monitor SQLite database (default: {DEFAULT_SQLITE_PATH})",
    )
    parser.add_argument(
        "--out-dir",
        default=DEFAULT_OUT_DIR,
        help=f"Output directory for JSONL files (default: {DEFAULT_OUT_DIR})",
    )
    return parser.parse_args()


def export_table(connection: sqlite3.Connection, table: str, out_file: pathlib.Path) -> int:
    count = 0
    with out_file.open("w", encoding="utf-8") as handle:
        for row in connection.execute(f"SELECT * FROM {table}"):
            handle.write(json.dumps(dict(row), ensure_ascii=False) + "\n")
            count += 1
    return count


def main() -> int:
    args = parse_args()

    sqlite_path = pathlib.Path(args.sqlite_path)
    if not sqlite_path.exists():
        print(f"error: SQLite source does not exist: {sqlite_path}", file=sys.stderr)
        return 1

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(str(sqlite_path))
    connection.row_factory = sqlite3.Row

    results: Dict[str, int] = {}

    try:
        for table in TABLES:
            out_file = out_dir / f"{table}.jsonl"
            results[table] = export_table(connection, table, out_file)
            print(f"exported {results[table]:>6} rows -> {out_file}")
    finally:
        connection.close()

    print("\nexport summary:")
    print(json.dumps(results, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
