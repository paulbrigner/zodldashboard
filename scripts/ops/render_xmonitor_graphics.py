#!/usr/bin/env python3
"""Render reusable X Monitor executive graphics.

The script produces:
  1. A 7-day ZODL team X traction graphic with refreshed X public metrics.
  2. A 90-day X Monitor activity trend graphic with a ZEC-USD price overlay.

It intentionally depends only on Pillow plus the Python standard library so it
can run from this repo without a browser or a local app server.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover - environment guard.
    raise SystemExit("Pillow is required. Install it with: python3 -m pip install pillow") from exc


DEFAULT_API_BASE = "https://www.zodldashboard.com/api/v1"
DEFAULT_X_API_BASE = "https://api.x.com/2"
DEFAULT_SECRET_ID = "xmonitor/rds/app"
DEFAULT_AWS_PROFILE = "zodldashboard"
DEFAULT_AWS_REGION = "us-east-1"
DEFAULT_TREND_RANGE = "90d"
DEFAULT_TEAM_DAYS = 7
DEFAULT_TEAM_HANDLES = [
    "bostonzcash",
    "dwillems42",
    "feministplt",
    "jswihart",
    "lukaskorba",
    "nullc0py",
    "nuttycom",
    "paulbrigner",
    "peacemongerz",
    "str4d",
    "thecodebuffet",
    "tonymargarit",
    "txds_",
    "zodl_co",
    "zodl_app",
    "zodl_support",
    "zcash_harry",
]

ET = ZoneInfo("America/New_York")
UTC = dt.timezone.utc

COLORS = {
    "navy": "#101827",
    "ink": "#111827",
    "muted": "#64748B",
    "muted2": "#475569",
    "line": "#CBD7F7",
    "soft_line": "#E2E8F0",
    "bg": "#F4F7FB",
    "card": "#FFFFFF",
    "teal": "#159E93",
    "teal_dark": "#0F766E",
    "blue": "#3B82F6",
    "blue_dark": "#3157B8",
    "orange": "#F59E0B",
    "red": "#EF476F",
    "purple": "#6F77D8",
    "bar_bg": "#E8EEF5",
}

FONT_REGULAR_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]
FONT_BOLD_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]
FONT_BLACK_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def first_existing(paths: list[str]) -> str | None:
    for path in paths:
        if Path(path).exists():
            return path
    return None


FONT_REG = first_existing(FONT_REGULAR_CANDIDATES)
FONT_BOLD = first_existing(FONT_BOLD_CANDIDATES)
FONT_BLACK = first_existing(FONT_BLACK_CANDIDATES)


def load_font(size: int, bold: bool = False, black: bool = False) -> ImageFont.ImageFont:
    path = FONT_BLACK if black else FONT_BOLD if bold else FONT_REG
    if path:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


FONTS = {
    "tiny": load_font(16),
    "small": load_font(18),
    "small_b": load_font(18, bold=True),
    "label": load_font(20, bold=True),
    "body": load_font(21),
    "body_b": load_font(21, bold=True),
    "mid": load_font(25),
    "mid_b": load_font(25, bold=True),
    "h3": load_font(31, bold=True),
    "h2": load_font(38, bold=True),
    "big": load_font(50, bold=True, black=True),
    "title": load_font(58, bold=True, black=True),
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render current X Monitor team traction and 90-day trend graphics.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--out-dir", default=str(Path.home() / "Downloads"), help="Directory for generated PNGs.")
    parser.add_argument("--team-output", help="Explicit output path for the team traction PNG.")
    parser.add_argument("--trend-output", help="Explicit output path for the 90-day trend PNG.")
    parser.add_argument("--team-days", type=float, default=DEFAULT_TEAM_DAYS, help="Rolling team activity window.")
    parser.add_argument("--trend-range", default=DEFAULT_TREND_RANGE, help="X Monitor trend range key.")
    parser.add_argument("--team-handles", default=",".join(DEFAULT_TEAM_HANDLES), help="Comma or space separated team handles.")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="X Monitor API base URL.")
    parser.add_argument("--x-api-base", default=DEFAULT_X_API_BASE, help="X API v2 base URL.")
    parser.add_argument("--aws-profile", default=os.environ.get("AWS_PROFILE", DEFAULT_AWS_PROFILE), help="AWS profile for Secrets Manager fallback.")
    parser.add_argument("--aws-region", default=os.environ.get("AWS_REGION", DEFAULT_AWS_REGION), help="AWS region for Secrets Manager fallback.")
    parser.add_argument("--secret-id", default=os.environ.get("XMONITOR_SECRET_ID", DEFAULT_SECRET_ID), help="Secrets Manager secret containing x_api_bearer_token.")
    parser.add_argument("--now", help="Anchor time as ISO timestamp. Defaults to current time.")
    parser.add_argument("--since", help="Shared report window start as ISO timestamp or YYYY-MM-DD.")
    parser.add_argument("--until", help="Shared report window end as ISO timestamp or YYYY-MM-DD.")
    parser.add_argument("--team-since", help="Team traction window start. Overrides --since for the team graphic.")
    parser.add_argument("--team-until", help="Team traction window end. Overrides --until for the team graphic.")
    parser.add_argument("--trend-since", help="Trend window start. Overrides --since for the 90-day trend graphic.")
    parser.add_argument("--trend-until", help="Trend window end. Overrides --until for the 90-day trend graphic.")
    parser.add_argument("--skip-live-metrics", action="store_true", help="Use X Monitor metrics only; do not call X API.")
    parser.add_argument("--strict-live-metrics", action="store_true", help="Fail if X API metrics cannot be refreshed.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--team-only", action="store_true", help="Generate only the team traction graphic.")
    mode.add_argument("--trend-only", action="store_true", help="Generate only the trend graphic.")
    return parser.parse_args(argv)


def normalize_handle(value: str) -> str:
    return str(value or "").strip().replace("@", "").lower()


def parse_handles(value: str) -> list[str]:
    return [h for h in (normalize_handle(item) for item in re.split(r"[,\s]+", value or "")) if h]


def parse_datetime(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.now(UTC)
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ET)
    return parsed.astimezone(UTC)


def parse_range_datetime(value: str | None, *, end_of_day: bool = False) -> dt.datetime | None:
    if not value:
        return None
    text = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        date = dt.date.fromisoformat(text)
        time = dt.time(23, 59, 59, 999999) if end_of_day else dt.time.min
        return dt.datetime.combine(date, time, tzinfo=ET).astimezone(UTC)
    return parse_datetime(text)


def ensure_valid_window(since: dt.datetime | None, until: dt.datetime | None, label: str) -> None:
    if since and until and since > until:
        raise ValueError(f"{label} window start must be before window end")


def parse_iso(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso_z(value: dt.datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def fetch_json(url: str, headers: dict[str, str] | None = None, timeout: int = 40) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "zodl-xmonitor-visual/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def read_secret_json(args: argparse.Namespace) -> dict[str, Any]:
    output = subprocess.check_output(
        [
            "aws",
            "--profile",
            args.aws_profile,
            "--region",
            args.aws_region,
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            args.secret_id,
            "--query",
            "SecretString",
            "--output",
            "text",
        ],
        text=True,
        stderr=subprocess.STDOUT,
    ).strip()
    return json.loads(output) if output else {}


def load_x_token(args: argparse.Namespace) -> str | None:
    token = os.environ.get("XMON_X_API_BEARER_TOKEN") or os.environ.get("X_API_BEARER_TOKEN")
    if token:
        return token
    try:
        secret = read_secret_json(args)
    except (subprocess.CalledProcessError, OSError, json.JSONDecodeError) as exc:
        if args.strict_live_metrics:
            raise RuntimeError(f"could not read X API token from {args.secret_id}: {exc}") from exc
        print(f"warning: could not read X API token from {args.secret_id}; using X Monitor metrics only", file=sys.stderr)
        return None
    return secret.get("x_api_bearer_token") or secret.get("x_bearer_token")


def format_date_et(value: dt.datetime, with_time: bool = True) -> str:
    local = value.astimezone(ET)
    if with_time:
        return local.strftime("%b %-d, %Y, %-I:%M %p ET")
    return local.strftime("%b %-d, %Y")


def format_window_et(since: dt.datetime, until: dt.datetime) -> str:
    since_local = since.astimezone(ET)
    until_local = until.astimezone(ET)
    if since_local.date() == until_local.date():
        return since_local.strftime("%b %-d, %Y")
    if since_local.year == until_local.year:
        return f"{since_local.strftime('%b %-d')} - {until_local.strftime('%b %-d, %Y')}"
    return f"{format_date_et(since, False)} - {format_date_et(until, False)}"


def fmt_int(value: int | float | None) -> str:
    return f"{int(value or 0):,}"


def fmt_compact(value: int | float | None, decimals: int = 1) -> str:
    try:
        num = float(value or 0)
    except (TypeError, ValueError):
        num = 0
    sign = "-" if num < 0 else ""
    num = abs(num)
    if num >= 1_000_000:
        return f"{sign}{num / 1_000_000:.{decimals}f}M"
    if num >= 100_000:
        return f"{sign}{num / 1_000:.0f}K"
    if num >= 10_000:
        return f"{sign}{num / 1_000:.1f}K"
    if num >= 1_000:
        return f"{sign}{num / 1_000:.1f}K"
    return f"{sign}{int(round(num)):,}"


def fmt_usd(value: float | None) -> str:
    if value is None:
        return "$--"
    return f"${float(value):,.2f}"


def clean_ascii(value: Any) -> str:
    text = html.unescape(str(value or ""))
    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2026": "...",
        "\xa0": " ",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = re.sub(r"https?://\S+", "", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", text).strip()


def display_title(post: dict[str, Any]) -> str:
    text = clean_ascii(post.get("article_title") or post.get("body_text") or "")
    if text.startswith("X Article:"):
        text = text[len("X Article:") :].strip()
        text = re.sub(r"https?://\S+", "", text).strip()
        text = "Article: " + text
    return text or "Untitled post"


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), str(text), font=fnt)
    return box[2] - box[0], box[3] - box[1]


def fit_text(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont, max_width: int) -> str:
    text = str(text or "")
    if text_size(draw, text, fnt)[0] <= max_width:
        return text
    ellipsis = "..."
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi) // 2
        candidate = text[:mid].rstrip() + ellipsis
        if text_size(draw, candidate, fnt)[0] <= max_width:
            lo = mid + 1
        else:
            hi = mid
    return text[: max(0, lo - 1)].rstrip() + ellipsis


def rounded(draw: ImageDraw.ImageDraw, xy: tuple[float, float, float, float], radius: int, fill: str, outline: str | None = None, width: int = 1) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_card(draw: ImageDraw.ImageDraw, xy: tuple[float, float, float, float], radius: int = 8, fill: str = "#FFFFFF", outline: str = "#DCE6F4", width: int = 1) -> None:
    rounded(draw, xy, radius, fill, outline, width)


def draw_badge(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    text: str,
    fill: str,
    text_fill: str = "#FFFFFF",
    pad_x: int = 15,
    height: int = 31,
) -> int:
    fnt = FONTS["small_b"]
    tw, th = text_size(draw, text, fnt)
    rounded(draw, (x, y, x + tw + pad_x * 2, y + height), 8, fill)
    draw.text((x + pad_x, y + (height - th) / 2 - 1), text, fill=text_fill, font=fnt)
    return x + tw + pad_x * 2 + 10


def default_output_path(out_dir: Path, label: str, now: dt.datetime) -> Path:
    stamp = now.astimezone(ET).strftime("%Y-%m-%d %H%M ET")
    return out_dir / f"{label} - {stamp}.png"


def resolve_team_window(args: argparse.Namespace, now: dt.datetime) -> tuple[dt.datetime, dt.datetime, bool]:
    since_arg = args.team_since or args.since
    until_arg = args.team_until or args.until
    until = parse_range_datetime(until_arg, end_of_day=True) or now
    since = parse_range_datetime(since_arg) or (until - dt.timedelta(days=args.team_days))
    ensure_valid_window(since, until, "team")
    return since, until, bool(since_arg or until_arg)


def resolve_trend_window(args: argparse.Namespace) -> tuple[dt.datetime | None, dt.datetime | None, bool]:
    since_arg = args.trend_since or args.since
    until_arg = args.trend_until or args.until
    since = parse_range_datetime(since_arg)
    until = parse_range_datetime(until_arg, end_of_day=True)
    ensure_valid_window(since, until, "trend")
    return since, until, bool(since_arg or until_arg)


def fetch_team_feed(
    args: argparse.Namespace,
    handles: list[str],
    since: dt.datetime,
    until: dt.datetime,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor = ""
    while True:
        params = {
            "since": iso_z(since),
            "until": iso_z(until),
            "handle": ",".join(handles),
            "limit": "200",
        }
        if cursor:
            params["cursor"] = cursor
        url = f"{args.api_base.rstrip('/')}/feed?" + urllib.parse.urlencode(params)
        payload = fetch_json(url)
        items.extend(payload.get("items") or [])
        cursor = payload.get("next_cursor") or payload.get("nextCursor") or ""
        if not cursor:
            break

    by_id = {str(item.get("status_id")): item for item in items if item.get("status_id")}
    return list(by_id.values())


def lookup_live_metrics(args: argparse.Namespace, posts: list[dict[str, Any]], token: str) -> list[dict[str, Any]]:
    ids = [str(post.get("status_id")) for post in posts if post.get("status_id")]
    headers = {"Authorization": f"Bearer {token}", "User-Agent": "zodl-xmonitor-visual/1.0"}
    fields = "article,author_id,created_at,entities,lang,public_metrics,referenced_tweets"
    live: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, Any]] = []
    for idx in range(0, len(ids), 100):
        batch = ids[idx : idx + 100]
        url = f"{args.x_api_base.rstrip('/')}/tweets?" + urllib.parse.urlencode(
            {"ids": ",".join(batch), "tweet.fields": fields}
        )
        try:
            payload = fetch_json(url, headers=headers, timeout=50)
        except Exception as exc:  # noqa: BLE001 - this is an ops script; fall back cleanly.
            if args.strict_live_metrics:
                raise
            errors.append({"message": str(exc), "ids": batch[:3]})
            continue
        for tweet in payload.get("data") or []:
            live[str(tweet.get("id"))] = tweet
        if payload.get("errors"):
            errors.extend(payload["errors"])
        time.sleep(0.2)

    for post in posts:
        tweet = live.get(str(post.get("status_id")))
        if not tweet:
            post["bookmark_count"] = int(post.get("bookmarks") or 0)
            post["quote_count"] = int(post.get("quote_count") or 0)
            continue
        metrics = tweet.get("public_metrics") or {}
        post["likes"] = int(metrics.get("like_count") or post.get("likes") or 0)
        post["reposts"] = int(metrics.get("retweet_count") or post.get("reposts") or 0)
        post["replies"] = int(metrics.get("reply_count") or post.get("replies") or 0)
        post["views"] = int(metrics.get("impression_count") or post.get("views") or 0)
        post["bookmark_count"] = int(metrics.get("bookmark_count") or post.get("bookmarks") or 0)
        post["quote_count"] = int(metrics.get("quote_count") or 0)
        article = tweet.get("article") or {}
        if article.get("title"):
            post["article_title"] = clean_ascii(article["title"])
        if tweet.get("created_at"):
            post["x_created_at"] = tweet["created_at"]
    return errors


def enrich_posts(posts: list[dict[str, Any]]) -> None:
    for post in posts:
        body = str(post.get("body_text") or "")
        post["is_article"] = body.startswith("X Article:") or post.get("significance_reason") == "x_article" or bool(post.get("article_title"))
        post["views"] = int(post.get("views") or 0)
        post["likes"] = int(post.get("likes") or 0)
        post["reposts"] = int(post.get("reposts") or 0)
        post["replies"] = int(post.get("replies") or 0)
        post["bookmark_count"] = int(post.get("bookmark_count") or post.get("bookmarks") or 0)
        post["engagements"] = post["likes"] + post["reposts"] + post["replies"] + post["bookmark_count"]
        post["handle"] = clean_ascii(post.get("author_handle") or "").lower()
        created = post.get("x_created_at") or post.get("discovered_at")
        try:
            post["dt"] = parse_iso(created)
        except Exception:
            post["dt"] = dt.datetime.now(UTC)


def aggregate_team(posts: list[dict[str, Any]], handles: list[str]) -> tuple[dict[str, int], list[dict[str, Any]], list[dict[str, Any]]]:
    totals = {
        "posts": len(posts),
        "views": sum(post["views"] for post in posts),
        "likes": sum(post["likes"] for post in posts),
        "reposts": sum(post["reposts"] for post in posts),
        "replies": sum(post["replies"] for post in posts),
        "bookmarks": sum(post["bookmark_count"] for post in posts),
        "high_signal": sum(1 for post in posts if post.get("is_significant")),
        "articles": sum(1 for post in posts if post.get("is_article")),
        "article_views": sum(post["views"] for post in posts if post.get("is_article")),
    }
    totals["engagements"] = totals["likes"] + totals["reposts"] + totals["replies"] + totals["bookmarks"]

    by_handle: dict[str, dict[str, Any]] = {
        handle: {"handle": handle, "posts": 0, "sig": 0, "views": 0, "eng": 0, "articles": 0}
        for handle in handles
    }
    for post in posts:
        handle = post["handle"]
        by_handle.setdefault(handle, {"handle": handle, "posts": 0, "sig": 0, "views": 0, "eng": 0, "articles": 0})
        by_handle[handle]["posts"] += 1
        by_handle[handle]["sig"] += 1 if post.get("is_significant") else 0
        by_handle[handle]["views"] += post["views"]
        by_handle[handle]["eng"] += post["engagements"]
        by_handle[handle]["articles"] += 1 if post.get("is_article") else 0
    leaderboard = sorted([row for row in by_handle.values() if row["posts"] > 0], key=lambda row: row["views"], reverse=True)

    daily: dict[dt.date, dict[str, int]] = defaultdict(lambda: {"views": 0, "posts": 0})
    for post in posts:
        key = post["dt"].astimezone(ET).date()
        daily[key]["views"] += post["views"]
        daily[key]["posts"] += 1
    daily_rows = [{"date": key, **daily[key]} for key in sorted(daily)]
    return totals, leaderboard, daily_rows


def render_team_graphic(
    posts: list[dict[str, Any]],
    totals: dict[str, int],
    leaderboard: list[dict[str, Any]],
    daily_rows: list[dict[str, Any]],
    now: dt.datetime,
    window_since: dt.datetime,
    window_until: dt.datetime,
    custom_window: bool,
    live_metrics_refreshed: bool,
    output_path: Path,
) -> None:
    width, height = 2400, 2030
    image = Image.new("RGB", (width, height), COLORS["bg"])
    draw = ImageDraw.Draw(image)

    draw.rectangle((0, 0, width, 140), fill=COLORS["navy"])
    draw.text((70, 40), "ZODL Team X Traction", fill="#FFFFFF", font=FONTS["title"])
    window_label = f"Window {format_window_et(window_since, window_until)}" if custom_window else f"Week ending {format_date_et(window_until, False)}"
    metric_label = (
        f"live X metrics refreshed {now.astimezone(ET).strftime('%b %-d, %-I:%M %p ET')}"
        if live_metrics_refreshed
        else f"X Monitor metrics rendered {now.astimezone(ET).strftime('%b %-d, %-I:%M %p ET')}"
    )
    subtitle = (
        f"{window_label} | {totals['posts']} X Monitor posts | "
        f"{metric_label}"
    )
    draw.text((72, 103), subtitle, fill="#DDE6F7", font=FONTS["mid"])
    source = "Source: X Monitor + live X public metrics" if live_metrics_refreshed else "Source: X Monitor stored metrics"
    source_w, _ = text_size(draw, source, FONTS["label"])
    rounded(draw, (width - 70 - source_w - 48, 42, width - 70, 92), 8, "#263548", outline="#3D4A5D")
    draw.text((width - 70 - source_w - 24, 57), source, fill="#E5ECF8", font=FONTS["label"])

    kpis = [
        ("POSTS", totals["posts"], COLORS["muted2"]),
        ("VIEWS", fmt_compact(totals["views"]), COLORS["teal"]),
        ("ENGAGEMENTS", fmt_int(totals["engagements"]), COLORS["navy"]),
        ("LIKES", fmt_int(totals["likes"]), COLORS["red"]),
        ("REPOSTS", fmt_int(totals["reposts"]), COLORS["blue"]),
        ("REPLIES", fmt_int(totals["replies"]), COLORS["orange"]),
        ("BOOKMARKS", fmt_int(totals["bookmarks"]), COLORS["purple"]),
    ]
    x0, y0, gap = 70, 172, 18
    card_width = (width - 140 - gap * 6) / 7
    for index, (label, value, accent) in enumerate(kpis):
        x = int(x0 + index * (card_width + gap))
        draw_card(draw, (x, y0, int(x + card_width), y0 + 142), radius=7)
        draw.rectangle((x, y0, x + 8, y0 + 142), fill=accent)
        draw.text((x + 26, y0 + 28), label, fill=COLORS["muted2"], font=FONTS["label"])
        draw.text((x + 26, y0 + 78), str(value), fill=COLORS["ink"], font=FONTS["big"])

    band_y = 344
    draw_card(draw, (70, band_y, width - 70, band_y + 92), radius=7, fill="#EAF1F9", outline="#D4E0F0")
    badge_x = 105
    badge_x = draw_badge(draw, badge_x, band_y + 30, f"{totals['posts']} team posts analyzed", COLORS["teal"])
    badge_x = draw_badge(draw, badge_x, band_y + 30, f"{totals['high_signal']} high-signal posts", "#EBAA00")
    badge_x = draw_badge(draw, badge_x, band_y + 30, f"{len(leaderboard)} active captured handles", COLORS["blue"])
    if totals["articles"]:
        badge_x = draw_badge(draw, badge_x, band_y + 30, f"{totals['articles']} X Articles included", "#7C3AED")
        draw_badge(draw, badge_x, band_y + 30, f"{fmt_compact(totals['article_views'])} article views", COLORS["teal_dark"])

    left = (70, 475, 1488, 1748)
    right = (1530, 475, width - 70, 1925)
    draw_card(draw, left, radius=8)
    draw_card(draw, right, radius=8)

    render_top_posts_table(draw, left, posts, totals)
    render_handle_panel(draw, right, leaderboard, totals, daily_rows)

    draw.line((70, height - 65, width - 70, height - 65), fill="#D6DEE9", width=2)
    footer = "Notes: source posts continue changing; totals reflect latest available public X engagement counts for captured ZODL team activity."
    draw.text((70, height - 42), footer, fill=COLORS["muted"], font=FONTS["small"])
    image.save(output_path, quality=95)


def render_top_posts_table(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], posts: list[dict[str, Any]], totals: dict[str, int]) -> None:
    left, top, right, bottom = box
    draw.text((left + 30, top + 32), "Top Live Posts Across ZODL Team", fill=COLORS["ink"], font=FONTS["h3"])
    draw.text(
        (left + 30, top + 72),
        f"Top 30 by views shown; all {totals['posts']} captured posts are included in totals, handle/daily charts, and source data.",
        fill=COLORS["muted"],
        font=FONTS["body"],
    )
    header_y = top + 115
    col = {
        "rank": left + 30,
        "handle": left + 86,
        "theme": left + 238,
        "bar": left + 760,
        "views": left + 1085,
        "l": left + 1190,
        "rp": left + 1260,
        "re": left + 1325,
        "bk": left + 1388,
    }
    for key, label in [
        ("rank", "#"),
        ("handle", "HANDLE"),
        ("theme", "POST / THEME"),
        ("views", "VIEWS"),
        ("l", "L"),
        ("rp", "RP"),
        ("re", "RE"),
        ("bk", "BK"),
    ]:
        draw.text((col[key], header_y), label, fill=COLORS["muted"], font=FONTS["small_b"])

    top_posts = sorted(posts, key=lambda post: post["views"], reverse=True)[:30]
    max_views = max([post["views"] for post in top_posts] + [1])
    row_y, row_height = header_y + 34, 36
    for index, post in enumerate(top_posts, 1):
        y = row_y + (index - 1) * row_height
        if index % 2 == 0:
            draw.rectangle((left + 18, y - 5, right - 18, y + row_height - 7), fill="#F8FAFD")
        draw.line((left + 26, y + row_height - 8, right - 26, y + row_height - 8), fill="#EDF2F8", width=1)
        rank_color = COLORS["teal"] if index <= 8 else COLORS["muted2"]
        draw.text((col["rank"], y), f"{index:02d}", fill=rank_color, font=FONTS["small_b"])
        draw.text((col["handle"], y), "@" + fit_text(draw, post["handle"], FONTS["small"], 122), fill=COLORS["muted2"], font=FONTS["small"])
        draw.text((col["theme"], y - 1), fit_text(draw, display_title(post), FONTS["body_b"], 500), fill=COLORS["ink"], font=FONTS["body_b"])
        bar_width = 285
        rounded(draw, (col["bar"], y + 4, col["bar"] + bar_width, y + 21), 8, COLORS["bar_bg"])
        rounded(draw, (col["bar"], y + 4, col["bar"] + max(4, int(bar_width * (post["views"] / max_views))), y + 21), 8, COLORS["teal"])
        draw.text((col["views"], y - 1), fmt_compact(post["views"]), fill=COLORS["ink"], font=FONTS["body_b"])
        draw.text((col["l"], y - 1), fmt_int(post["likes"]), fill=COLORS["red"], font=FONTS["small"])
        draw.text((col["rp"], y - 1), fmt_int(post["reposts"]), fill=COLORS["blue"], font=FONTS["small"])
        draw.text((col["re"], y - 1), fmt_int(post["replies"]), fill=COLORS["orange"], font=FONTS["small"])
        draw.text((col["bk"], y - 1), fmt_int(post["bookmark_count"]), fill=COLORS["purple"], font=FONTS["small"])

    foot = "L = likes, RP = reposts, RE = replies, BK = bookmarks. Engagement counts reflect latest available public X metrics at refresh time."
    draw.text((left + 30, bottom - 42), foot, fill=COLORS["muted"], font=FONTS["small"])


def render_handle_panel(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    leaderboard: list[dict[str, Any]],
    totals: dict[str, int],
    daily_rows: list[dict[str, Any]],
) -> None:
    left, top, right, _bottom = box
    draw.text((left + 30, top + 32), "Handle Leaderboard", fill=COLORS["ink"], font=FONTS["h3"])
    draw.text((left + 30, top + 72), "Ranked by total views.", fill=COLORS["muted"], font=FONTS["body"])
    max_views = max([row["views"] for row in leaderboard] + [1])
    y = top + 114
    for index, row in enumerate(leaderboard[:12], 1):
        draw_card(draw, (left + 30, y, right - 30, y + 47), radius=7, fill="#F8FAFC", outline="#E1E7EF")
        draw.text((left + 50, y + 14), f"{index:02d}", fill=COLORS["muted"], font=FONTS["small"])
        draw.text((left + 92, y + 9), "@" + row["handle"], fill=COLORS["ink"], font=FONTS["body_b"])
        sub = f"{row['posts']} posts | {row['sig']} sig" + (f" | {row['articles']} art" if row["articles"] else "")
        draw.text((left + 92, y + 30), sub, fill=COLORS["muted"], font=FONTS["tiny"])
        bar_x, bar_width = left + 370, 240
        rounded(draw, (bar_x, y + 18, bar_x + bar_width, y + 32), 7, COLORS["bar_bg"])
        rounded(draw, (bar_x, y + 18, bar_x + max(3, int(bar_width * row["views"] / max_views)), y + 32), 7, COLORS["teal"])
        draw.text((right - 112, y + 8), fmt_compact(row["views"]), fill=COLORS["ink"], font=FONTS["body_b"])
        draw.text((right - 112, y + 29), f"{fmt_compact(row['eng'])} eng", fill=COLORS["muted"], font=FONTS["tiny"])
        y += 53

    sep_y = y + 10
    draw.line((left + 30, sep_y, right - 30, sep_y), fill="#D8E1ED", width=2)
    mix_y = sep_y + 28
    draw.text((left + 30, mix_y), "Engagement Mix", fill=COLORS["ink"], font=FONTS["h3"])
    mix = [
        ("Likes", totals["likes"], COLORS["red"]),
        ("Reposts", totals["reposts"], COLORS["blue"]),
        ("Replies", totals["replies"], COLORS["orange"]),
        ("Bookmarks", totals["bookmarks"], COLORS["purple"]),
    ]
    max_mix = max([item[1] for item in mix] + [1])
    my = mix_y + 58
    for label, value, color in mix:
        draw.text((left + 42, my + 2), label, fill=COLORS["ink"], font=FONTS["small"])
        bar_x, bar_width = left + 195, 470
        rounded(draw, (bar_x, my + 4, bar_x + bar_width, my + 21), 8, COLORS["bar_bg"])
        rounded(draw, (bar_x, my + 4, bar_x + max(4, int(bar_width * value / max_mix)), my + 21), 8, color)
        draw.text((right - 110, my - 1), fmt_int(value), fill=COLORS["ink"], font=FONTS["body_b"])
        my += 47

    draw.line((left + 30, my + 18, right - 30, my + 18), fill="#D8E1ED", width=2)
    dm_y = my + 48
    draw.text((left + 30, dm_y), "Daily View Momentum", fill=COLORS["ink"], font=FONTS["h3"])
    chart_x, chart_y = left + 55, dm_y + 70
    chart_width, chart_height = right - left - 110, 245
    max_day = max([row["views"] for row in daily_rows] + [1])
    gap = 13
    bar_width = max(18, int((chart_width - gap * (len(daily_rows) - 1)) / max(len(daily_rows), 1)))
    for index, row in enumerate(daily_rows):
        x = chart_x + index * (bar_width + gap)
        height = int(chart_height * row["views"] / max_day)
        color = COLORS["teal"] if row["views"] == max_day else COLORS["blue"]
        draw.rectangle((x, chart_y + chart_height - height, x + bar_width, chart_y + chart_height), fill=color)
        if row["views"] >= max_day * 0.34 or index == len(daily_rows) - 1:
            label = fmt_compact(row["views"])
            tw, th = text_size(draw, label, FONTS["small"])
            draw.text((x + bar_width / 2 - tw / 2, chart_y + chart_height - height - th - 7), label, fill=COLORS["ink"], font=FONTS["small"])
        date_label = f"{row['date'].month}/{row['date'].day}"
        tw, _ = text_size(draw, date_label, FONTS["small"])
        draw.text((x + bar_width / 2 - tw / 2, chart_y + chart_height + 10), date_label, fill=COLORS["muted"], font=FONTS["small"])
    draw.line((chart_x, chart_y + chart_height, chart_x + chart_width, chart_y + chart_height), fill="#D6DEE9", width=2)


def fetch_trends(args: argparse.Namespace, since: dt.datetime | None = None, until: dt.datetime | None = None) -> dict[str, Any]:
    params = {"trend_range": args.trend_range}
    if since:
        params["since"] = iso_z(since)
    if until:
        params["until"] = iso_z(until)
    url = f"{args.api_base.rstrip('/')}/trends?" + urllib.parse.urlencode(params)
    return fetch_json(url)


def fetch_zec_prices(start: dt.datetime, end: dt.datetime) -> list[dict[str, Any]]:
    period1 = int(start.timestamp())
    period2 = int((end + dt.timedelta(days=1)).timestamp())
    url = "https://query1.finance.yahoo.com/v8/finance/chart/ZEC-USD?" + urllib.parse.urlencode(
        {"period1": period1, "period2": period2, "interval": "1d"}
    )
    payload = fetch_json(url, headers={"User-Agent": "Mozilla/5.0"})
    result = (payload.get("chart", {}).get("result") or [{}])[0]
    timestamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    rows = []
    for timestamp, close in zip(timestamps, closes):
        if close is None:
            continue
        rows.append({"dt": dt.datetime.fromtimestamp(timestamp, UTC), "close": float(close)})
    return rows


def nice_max(value: float) -> float:
    if value <= 0:
        return 1
    exponent = math.floor(math.log10(value))
    base = 10**exponent
    for multiplier in [1, 2, 2.5, 5, 10]:
        if value <= multiplier * base:
            return multiplier * base
    return 10 * base


def interp_price_at(prices: list[dict[str, Any]], target: dt.datetime) -> float | None:
    if not prices:
        return None
    rows = sorted(prices, key=lambda row: row["dt"])
    if target <= rows[0]["dt"]:
        return rows[0]["close"]
    if target >= rows[-1]["dt"]:
        return rows[-1]["close"]
    for current, nxt in zip(rows, rows[1:]):
        if current["dt"] <= target <= nxt["dt"]:
            span = (nxt["dt"] - current["dt"]).total_seconds()
            part = (target - current["dt"]).total_seconds() / span if span else 0
            return current["close"] + part * (nxt["close"] - current["close"])
    return rows[-1]["close"]


def render_trend_graphic(trends: dict[str, Any], prices: list[dict[str, Any]], output_path: Path) -> None:
    width, height = 2400, 1120
    image = Image.new("RGB", (width, height), COLORS["bg"])
    draw = ImageDraw.Draw(image)

    draw_card(draw, (18, 18, width - 18, height - 18), radius=24, fill=COLORS["bg"], outline="#BFD0F7", width=2)
    draw.line((18, 145, width - 18, 145), fill="#BFD0F7", width=2)
    draw.text((55, 66), "TRENDS", fill="#3157B8", font=FONTS["h2"])
    draw.polygon([(232, 73), (232, 101), (247, 87)], fill="#3157B8")

    totals = trends["activity"]["totals"]
    pill = f"{fmt_int(totals['post_count']).replace(',', '')} posts"
    tw, _ = text_size(draw, pill, FONTS["mid"])
    rounded(draw, (width - 56 - tw - 48, 54, width - 56, 103), 24, "#FFFFFF", outline="#BFD0F7", width=2)
    draw.text((width - 56 - tw - 24, 66), pill, fill="#274A96", font=FONTS["mid"])

    scope = trends["scope"]
    draw.text((55, 211), "Range", fill="#3D4F7D", font=FONTS["h3"])
    active_range = str(scope.get("range_key") or "90d").upper()
    chips = ["24H", "7D", "30D", "90D"]
    if active_range == "CUSTOM":
        chips.append("CUSTOM")
    chip_gap = 20
    chip_widths = [150 if chip == "CUSTOM" else 120 if chip == active_range else 112 for chip in chips]
    chip_x = width - 56 - sum(chip_widths) - chip_gap * (len(chips) - 1)
    for chip, chip_width in zip(chips, chip_widths):
        active = chip == active_range
        rounded(draw, (chip_x, 196, chip_x + chip_width, 266), 34, "#3157B8" if active else "#FFFFFF", outline="#BFD0F7", width=2)
        label_w, _ = text_size(draw, chip, FONTS["mid_b"])
        draw.text((chip_x + chip_width / 2 - label_w / 2, 216), chip, fill="#FFFFFF" if active else "#274A96", font=FONTS["mid_b"])
        chip_x += chip_width + chip_gap

    since = parse_iso(scope["since"])
    until = parse_iso(scope["until"])
    scope_line = (
        f"Scope {since.astimezone(ET).strftime('%-m/%-d/%Y, %-I:%M:%S %p')} - "
        f"{until.astimezone(ET).strftime('%-m/%-d/%Y, %-I:%M:%S %p')} | "
        f"bucket {scope['bucket_hours']}h | {fmt_int(totals['post_count'])} posts"
    )
    draw.text((55, 322), scope_line, fill="#3D4F7D", font=FONTS["h3"])
    draw.text((55, 410), "Activity trend + ZEC price", fill=COLORS["ink"], font=FONTS["h2"])

    draw_card(draw, (55, 485, width - 55, 970), radius=24, fill="#FFFFFF", outline="#BFD0F7", width=2)
    chart_left, chart_top, chart_right, chart_bottom = 150, 555, width - 185, 895
    chart_width, chart_height = chart_right - chart_left, chart_bottom - chart_top
    buckets = trends["activity"]["buckets"]
    counts = [int(bucket.get("post_count") or 0) for bucket in buckets]
    max_count = max(counts + [1])
    y_max = nice_max(max_count)

    price_values: list[float | None] = []
    for bucket in buckets:
        start = parse_iso(bucket["bucket_start"])
        end = parse_iso(bucket["bucket_end"])
        mid = start + (end - start) / 2
        price_values.append(interp_price_at(prices, mid))
    valid_prices = [price for price in price_values if price is not None]
    if valid_prices:
        price_min = min(valid_prices)
        price_max = max(valid_prices)
        price_pad = max(1.0, (price_max - price_min) * 0.12)
        price_axis_min = max(0, price_min - price_pad)
        price_axis_max = price_max + price_pad
    else:
        price_min = price_max = None
        price_axis_min, price_axis_max = 0, 1

    for index in range(6):
        value = y_max * index / 5
        y = chart_bottom - chart_height * (value / y_max)
        draw.line((chart_left, y, chart_right, y), fill="#E6EDF7", width=1)
        label = fmt_compact(value, decimals=0)
        label_w, label_h = text_size(draw, label, FONTS["small"])
        draw.text((chart_left - label_w - 18, y - label_h / 2), label, fill=COLORS["muted"], font=FONTS["small"])
    draw.text((chart_left - 100, chart_top - 34), f"Posts / {scope['bucket_hours']}h", fill=COLORS["muted2"], font=FONTS["small_b"])

    for index in range(6):
        value = price_axis_min + (price_axis_max - price_axis_min) * index / 5
        y = chart_bottom - chart_height * ((value - price_axis_min) / (price_axis_max - price_axis_min))
        draw.text((chart_right + 18, y - 9), fmt_usd(value), fill="#B45309", font=FONTS["small"])
    draw.text((chart_right + 18, chart_top - 34), "ZEC USD", fill="#B45309", font=FONTS["small_b"])

    draw.line((chart_left, chart_top, chart_left, chart_bottom), fill="#CAD5E6", width=2)
    draw.line((chart_left, chart_bottom, chart_right, chart_bottom), fill="#CAD5E6", width=2)
    draw.line((chart_right, chart_top, chart_right, chart_bottom), fill="#F4C271", width=2)

    count = len(buckets)
    gap = 7
    bar_width = max(10, (chart_width - gap * (count - 1)) / count)
    bar_points = []
    for index, (bucket, value) in enumerate(zip(buckets, counts)):
        x = chart_left + index * (bar_width + gap)
        bar_height = chart_height * (value / y_max)
        rounded(draw, (x, chart_bottom - bar_height, x + bar_width, chart_bottom), 8, "#4A70C7")
        bar_points.append((x + bar_width / 2, chart_bottom - bar_height, bucket, value))

    price_points = []
    for index, price in enumerate(price_values):
        if price is None:
            continue
        x = chart_left + index * (bar_width + gap) + bar_width / 2
        y = chart_bottom - chart_height * ((price - price_axis_min) / (price_axis_max - price_axis_min))
        price_points.append((x, y, price))
    if len(price_points) >= 2:
        draw.line([(x, y) for x, y, _price in price_points], fill=COLORS["orange"], width=5, joint="curve")
        for index, (x, y, _price) in enumerate(price_points):
            if index % 6 == 0 or index == len(price_points) - 1:
                draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill="#FFFFFF", outline=COLORS["orange"], width=3)

    for index in sorted(set([0, 9, 18, 27, 36, count - 1])):
        if 0 <= index < count:
            label = parse_iso(buckets[index]["bucket_start"]).astimezone(ET).strftime("%m/%d")
            x = chart_left + index * (bar_width + gap) + bar_width / 2
            label_w, _ = text_size(draw, label, FONTS["mid"])
            draw.text((x - label_w / 2, chart_bottom + 18), label, fill="#536791", font=FONTS["mid"])

    peak_index = counts.index(max_count)
    peak_x, peak_y, _bucket, peak_count = bar_points[peak_index]
    callout = f"Peak {fmt_int(peak_count)} posts"
    callout_w, _ = text_size(draw, callout, FONTS["small_b"])
    callout_x = min(max(chart_left, peak_x - callout_w / 2 - 18), chart_right - callout_w - 46)
    callout_y = max(chart_top + 8, peak_y - 48)
    rounded(draw, (callout_x, callout_y, callout_x + callout_w + 36, callout_y + 34), 8, "#FFFFFF", outline="#CBD5E1")
    draw.text((callout_x + 18, callout_y + 8), callout, fill=COLORS["ink"], font=FONTS["small_b"])

    if price_points:
        end_x, end_y, end_price = price_points[-1]
        callout = f"ZEC close {fmt_usd(end_price)}"
        callout_w, _ = text_size(draw, callout, FONTS["small_b"])
        callout_x = min(end_x - callout_w - 34, chart_right - callout_w - 44)
        callout_y = min(max(chart_top + 16, end_y - 48), chart_bottom - 45)
        rounded(draw, (callout_x, callout_y, callout_x + callout_w + 30, callout_y + 36), 8, "#FFF7ED", outline="#FDBA74")
        draw.text((callout_x + 15, callout_y + 9), callout, fill="#9A3412", font=FONTS["small_b"])
        draw.line((callout_x + callout_w + 30, callout_y + 18, end_x, end_y), fill="#FDBA74", width=2)

    legend_y = 515
    draw.rectangle((chart_left, legend_y, chart_left + 22, legend_y + 16), fill="#4A70C7")
    draw.text((chart_left + 32, legend_y - 3), f"X Monitor posts per {scope['bucket_hours']}h", fill=COLORS["muted2"], font=FONTS["small_b"])
    draw.line((chart_left + 320, legend_y + 8, chart_left + 365, legend_y + 8), fill=COLORS["orange"], width=5)
    draw.text((chart_left + 378, legend_y - 3), "ZEC-USD daily close", fill="#B45309", font=FONTS["small_b"])

    summary_y = 995
    zec_range = f"{fmt_usd(price_min)}-{fmt_usd(price_max)}" if valid_prices else "$--"
    strip_items = [
        ("Posts", fmt_int(totals["post_count"])),
        ("Significant", fmt_int(totals["significant_count"])),
        ("Watchlist", fmt_int(totals["watchlist_count"])),
        ("Discovery", fmt_int(totals["discovery_count"])),
        ("Unique handles", fmt_int(totals["unique_handle_count"])),
        ("ZEC range", zec_range),
    ]
    x = 55
    for label, value in strip_items:
        card_width = 430 if label == "ZEC range" else 330
        draw_card(draw, (x, summary_y, x + card_width, summary_y + 80), radius=12, fill="#FFFFFF", outline="#D5E1F2")
        draw.text((x + 22, summary_y + 16), label.upper(), fill=COLORS["muted"], font=FONTS["small_b"])
        draw.text((x + 22, summary_y + 42), value, fill=COLORS["ink"], font=FONTS["mid_b"])
        x += card_width + 18

    image.save(output_path, quality=95)


def run(args: argparse.Namespace) -> dict[str, Any]:
    now = parse_datetime(args.now)
    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    team_output = Path(args.team_output).expanduser() if args.team_output else default_output_path(out_dir, "ZODL Team X Traction", now)
    trend_output = Path(args.trend_output).expanduser() if args.trend_output else default_output_path(out_dir, "X Monitor 90D Activity Trend with ZEC Price", now)
    handles = parse_handles(args.team_handles)

    summary: dict[str, Any] = {}
    if not args.trend_only:
        team_since, team_until, custom_team_window = resolve_team_window(args, now)
        posts = fetch_team_feed(args, handles, team_since, team_until)
        metric_errors: list[dict[str, Any]] = []
        live_metrics_refreshed = False
        if not args.skip_live_metrics:
            token = load_x_token(args)
            if token:
                metric_errors = lookup_live_metrics(args, posts, token)
                live_metrics_refreshed = True
            elif args.strict_live_metrics:
                raise RuntimeError("missing X API token")
        enrich_posts(posts)
        totals, leaderboard, daily_rows = aggregate_team(posts, handles)
        render_team_graphic(
            posts,
            totals,
            leaderboard,
            daily_rows,
            now,
            team_since,
            team_until,
            custom_team_window,
            live_metrics_refreshed,
            team_output,
        )
        summary["team"] = {
            "output": str(team_output),
            "since": iso_z(team_since),
            "until": iso_z(team_until),
            "posts": totals["posts"],
            "views": totals["views"],
            "engagements": totals["engagements"],
            "articles": totals["articles"],
            "article_views": totals["article_views"],
            "live_metrics_refreshed": live_metrics_refreshed,
            "live_metric_errors": len(metric_errors),
        }

    if not args.team_only:
        trend_since, trend_until, _custom_trend_window = resolve_trend_window(args)
        trends = fetch_trends(args, trend_since, trend_until)
        start = parse_iso(trends["scope"]["since"])
        end = parse_iso(trends["scope"]["until"])
        prices = fetch_zec_prices(start, end)
        render_trend_graphic(trends, prices, trend_output)
        summary["trend"] = {
            "output": str(trend_output),
            "since": trends["scope"]["since"],
            "until": trends["scope"]["until"],
            "posts": trends["activity"]["totals"]["post_count"],
            "price_points": len(prices),
            "zec_latest": prices[-1]["close"] if prices else None,
        }
    return summary


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    summary = run(args)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
