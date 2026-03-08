#!/usr/bin/env python3
"""Import XMonitor JSONL exports into PostgreSQL with idempotent upserts."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, Optional, Tuple


DEFAULT_INPUT_DIR = "data/export"
DEFAULT_REJECT_LOG = "data/import_rejects.ndjson"

VALID_TIERS = {"teammate", "influencer", "ecosystem"}
VALID_RUN_MODES = {"priority", "discovery", "both", "manual"}


@dataclass
class Counters:
    received: int = 0
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0


def require_psycopg():
    try:
        import psycopg  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "psycopg is required. Install with: python3 -m pip install 'psycopg[binary]'"
        ) from exc
    return psycopg


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import SQLite JSONL exports into PostgreSQL")
    parser.add_argument("--input-dir", default=DEFAULT_INPUT_DIR, help=f"Input directory (default: {DEFAULT_INPUT_DIR})")
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="PostgreSQL connection URL. If omitted, PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD are used.",
    )
    parser.add_argument(
        "--reject-log",
        default=DEFAULT_REJECT_LOG,
        help=f"Path for rejected row logs (default: {DEFAULT_REJECT_LOG})",
    )
    return parser.parse_args()


def get_first(row: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row:
            return row[key]
    return None


def parse_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "t", "yes", "y"}:
            return True
        if lowered in {"0", "false", "f", "no", "n"}:
            return False
    return default


def normalize_handle(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.lstrip("@").lower()


def normalize_tier(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().lower()
    return text if text in VALID_TIERS else None


def normalize_run_mode(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().lower()
    return text if text in VALID_RUN_MODES else None


def parse_timestamp(value: Any, required: bool = False) -> Optional[datetime]:
    if value is None or value == "":
        if required:
            raise ValueError("missing required timestamp")
        return None

    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        dt = datetime.fromisoformat(text)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def open_reject_log(path: pathlib.Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    return path.open("w", encoding="utf-8")


def log_reject(handle, table: str, index: int, reason: str, row: Dict[str, Any], counters: Counters) -> None:
    payload = {
        "table": table,
        "index": index,
        "reason": reason,
        "row": row,
    }
    handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    counters.errors += 1


def iter_jsonl(path: pathlib.Path) -> Iterator[Tuple[int, Dict[str, Any]]]:
    with path.open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            yield index, json.loads(text)


def connect_postgres(database_url: str):
    psycopg = require_psycopg()
    if database_url:
        conn = psycopg.connect(database_url)
        conn.autocommit = True
        return conn

    required = ["PGHOST", "PGDATABASE", "PGUSER"]
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        missing_list = ", ".join(missing)
        raise SystemExit(f"Missing DB config. Set DATABASE_URL or {missing_list}.")

    kwargs: Dict[str, Any] = {
        "host": os.environ["PGHOST"],
        "port": int(os.environ.get("PGPORT", "5432")),
        "dbname": os.environ["PGDATABASE"],
        "user": os.environ["PGUSER"],
        "password": os.environ.get("PGPASSWORD", ""),
    }
    sslmode = os.environ.get("PGSSLMODE")
    if sslmode:
        kwargs["sslmode"] = sslmode

    conn = psycopg.connect(**kwargs)
    conn.autocommit = True
    return conn


def run_upsert(cur, sql: str, values: Tuple[Any, ...]) -> bool:
    cur.execute(sql, values)
    row = cur.fetchone()
    if row is None:
        return False
    return bool(row[0])


def import_watch_accounts(cur, path: pathlib.Path, reject_handle) -> Counters:
    counters = Counters()
    sql = """
        INSERT INTO watch_accounts(handle, tier, note, added_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (handle) DO UPDATE SET
          tier = EXCLUDED.tier,
          note = EXCLUDED.note,
          added_at = EXCLUDED.added_at,
          updated_at = now()
        RETURNING (xmax = 0) AS inserted
    """

    for index, row in iter_jsonl(path):
        counters.received += 1
        try:
            handle = normalize_handle(get_first(row, "handle", "author_handle"))
            tier = normalize_tier(get_first(row, "tier", "watch_tier"))
            added_at = parse_timestamp(get_first(row, "added_at", "created_at", "updated_at"), required=True)
            note = get_first(row, "note")

            if not handle or not tier:
                counters.skipped += 1
                log_reject(reject_handle, "watch_accounts", index, "missing handle or tier", row, counters)
                continue

            inserted = run_upsert(cur, sql, (handle, tier, note, added_at))
            if inserted:
                counters.inserted += 1
            else:
                counters.updated += 1
        except Exception as exc:  # noqa: BLE001
            log_reject(reject_handle, "watch_accounts", index, str(exc), row, counters)

    return counters


def import_posts(cur, path: pathlib.Path, reject_handle) -> Counters:
    counters = Counters()
    sql = """
        INSERT INTO posts(
          status_id,
          url,
          author_handle,
          author_display,
          body_text,
          posted_relative,
          source_query,
          watch_tier,
          is_significant,
          significance_reason,
          significance_version,
          likes,
          reposts,
          replies,
          views,
          discovered_at,
          last_seen_at
        )
        VALUES (
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s,
          %s, %s
        )
        ON CONFLICT (status_id) DO UPDATE SET
          url = EXCLUDED.url,
          author_handle = EXCLUDED.author_handle,
          author_display = EXCLUDED.author_display,
          body_text = EXCLUDED.body_text,
          posted_relative = EXCLUDED.posted_relative,
          source_query = EXCLUDED.source_query,
          watch_tier = EXCLUDED.watch_tier,
          is_significant = EXCLUDED.is_significant,
          significance_reason = EXCLUDED.significance_reason,
          significance_version = EXCLUDED.significance_version,
          likes = EXCLUDED.likes,
          reposts = EXCLUDED.reposts,
          replies = EXCLUDED.replies,
          views = EXCLUDED.views,
          discovered_at = EXCLUDED.discovered_at,
          last_seen_at = EXCLUDED.last_seen_at,
          updated_at = now()
        RETURNING (xmax = 0) AS inserted
    """

    for index, row in iter_jsonl(path):
        counters.received += 1
        try:
            status_id = str(get_first(row, "status_id", "id") or "").strip()
            url = str(get_first(row, "url", "status_url", "tweet_url") or "").strip()
            author_handle = normalize_handle(get_first(row, "author_handle", "handle", "author", "username"))
            if not status_id or not url or not author_handle:
                counters.skipped += 1
                log_reject(reject_handle, "posts", index, "missing status_id/url/author_handle", row, counters)
                continue

            tier = normalize_tier(get_first(row, "watch_tier", "tier"))

            values = (
                status_id,
                url,
                author_handle,
                get_first(row, "author_display", "display_name", "author_name"),
                get_first(row, "body_text", "text", "tweet_text", "content"),
                get_first(row, "posted_relative"),
                get_first(row, "source_query", "query_type", "source"),
                tier,
                parse_bool(get_first(row, "is_significant", "significant"), default=False),
                get_first(row, "significance_reason", "reason"),
                get_first(row, "significance_version") or "v1",
                parse_int(get_first(row, "likes"), 0),
                parse_int(get_first(row, "reposts", "retweets"), 0),
                parse_int(get_first(row, "replies"), 0),
                parse_int(get_first(row, "views"), 0),
                parse_timestamp(get_first(row, "discovered_at", "captured_at", "created_at"), required=True),
                parse_timestamp(get_first(row, "last_seen_at", "updated_at", "seen_at"), required=True),
            )

            inserted = run_upsert(cur, sql, values)
            if inserted:
                counters.inserted += 1
            else:
                counters.updated += 1
        except Exception as exc:  # noqa: BLE001
            log_reject(reject_handle, "posts", index, str(exc), row, counters)

    return counters
def import_pipeline_runs(cur, path: pathlib.Path, reject_handle) -> Counters:
    counters = Counters()
    sql = """
        INSERT INTO pipeline_runs(run_at, mode, fetched_count, significant_count, note, source)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (run_at, mode, source) DO UPDATE SET
          fetched_count = EXCLUDED.fetched_count,
          significant_count = EXCLUDED.significant_count,
          note = EXCLUDED.note
        RETURNING (xmax = 0) AS inserted
    """

    for index, row in iter_jsonl(path):
        counters.received += 1
        try:
            run_at = parse_timestamp(get_first(row, "run_at", "created_at", "timestamp"), required=True)
            mode = normalize_run_mode(get_first(row, "mode"))
            source = str(get_first(row, "source") or "local-dispatcher").strip() or "local-dispatcher"

            if not mode:
                counters.skipped += 1
                log_reject(reject_handle, "pipeline_runs", index, "invalid mode", row, counters)
                continue

            inserted = run_upsert(
                cur,
                sql,
                (
                    run_at,
                    mode,
                    parse_int(get_first(row, "fetched_count"), 0),
                    parse_int(get_first(row, "significant_count"), 0),
                    get_first(row, "note"),
                    source,
                ),
            )
            if inserted:
                counters.inserted += 1
            else:
                counters.updated += 1
        except Exception as exc:  # noqa: BLE001
            log_reject(reject_handle, "pipeline_runs", index, str(exc), row, counters)

    return counters


def normalize_vector_json(value: Any) -> Any:
    if value is None:
        return []
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        return json.loads(text)
    return value


def import_embeddings(cur, path: pathlib.Path, reject_handle) -> Counters:
    counters = Counters()
    sql = """
        INSERT INTO embeddings(status_id, backend, model, dims, vector_json, text_hash, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)
        ON CONFLICT (status_id) DO UPDATE SET
          backend = EXCLUDED.backend,
          model = EXCLUDED.model,
          dims = EXCLUDED.dims,
          vector_json = EXCLUDED.vector_json,
          text_hash = EXCLUDED.text_hash,
          updated_at = EXCLUDED.updated_at
        RETURNING (xmax = 0) AS inserted
    """

    for index, row in iter_jsonl(path):
        counters.received += 1
        try:
            status_id = str(get_first(row, "status_id") or "").strip()
            backend = str(get_first(row, "backend") or "").strip()
            model = str(get_first(row, "model") or "").strip()
            text_hash = str(get_first(row, "text_hash") or "").strip()

            if not status_id or not backend or not model or not text_hash:
                counters.skipped += 1
                log_reject(reject_handle, "embeddings", index, "missing required embedding fields", row, counters)
                continue

            created_at = parse_timestamp(get_first(row, "created_at"), required=True)
            updated_at = parse_timestamp(get_first(row, "updated_at", "created_at"), required=True)
            vector_json = json.dumps(normalize_vector_json(get_first(row, "vector_json")))
            dims = parse_int(get_first(row, "dims"), 0)

            if dims <= 0:
                maybe_vector = json.loads(vector_json)
                if isinstance(maybe_vector, list):
                    dims = len(maybe_vector)

            inserted = run_upsert(
                cur,
                sql,
                (
                    status_id,
                    backend,
                    model,
                    dims,
                    vector_json,
                    text_hash,
                    created_at,
                    updated_at,
                ),
            )
            if inserted:
                counters.inserted += 1
            else:
                counters.updated += 1
        except Exception as exc:  # noqa: BLE001
            log_reject(reject_handle, "embeddings", index, str(exc), row, counters)

    return counters
def main() -> int:
    args = parse_args()

    input_dir = pathlib.Path(args.input_dir)
    if not input_dir.exists():
        print(f"error: input directory not found: {input_dir}", file=sys.stderr)
        return 1

    reject_log_path = pathlib.Path(args.reject_log)

    files = {
        "watch_accounts": input_dir / "watch_accounts.jsonl",
        "posts": input_dir / "tweets.jsonl",
        "pipeline_runs": input_dir / "runs.jsonl",
        "embeddings": input_dir / "tweet_embeddings.jsonl",
    }

    summary: Dict[str, Dict[str, int]] = {}

    with connect_postgres(args.database_url) as conn:
        with conn.cursor() as cur, open_reject_log(reject_log_path) as reject_handle:
            if files["watch_accounts"].exists():
                summary["watch_accounts"] = asdict(import_watch_accounts(cur, files["watch_accounts"], reject_handle))
            else:
                summary["watch_accounts"] = asdict(Counters())

            if files["posts"].exists():
                summary["posts"] = asdict(import_posts(cur, files["posts"], reject_handle))
            else:
                summary["posts"] = asdict(Counters())

            if files["pipeline_runs"].exists():
                summary["pipeline_runs"] = asdict(import_pipeline_runs(cur, files["pipeline_runs"], reject_handle))
            else:
                summary["pipeline_runs"] = asdict(Counters())

            if files["embeddings"].exists():
                summary["embeddings"] = asdict(import_embeddings(cur, files["embeddings"], reject_handle))
            else:
                summary["embeddings"] = asdict(Counters())

    print(json.dumps(summary, indent=2, sort_keys=True))
    print(f"reject log: {reject_log_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
