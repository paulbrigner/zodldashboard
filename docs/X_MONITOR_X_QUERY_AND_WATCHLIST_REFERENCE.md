# X Monitor — X Query + Watchlist Reference

_Last generated: 2026-02-22 20:43 EST_

This document describes the actual query logic currently used to pull data from X, and the active watchlist handles loaded in the local X monitor database.

## Source of truth
- Query logic: `~/.openclaw/workspace/scripts/x_monitor_kb.py`
- Watchlist state: `~/.openclaw/workspace/memory/x_monitor.db` (`watch_accounts` table)

---

## 1) Query logic currently used

## Base terms
```text
Zcash OR ZEC OR Zodl OR #ZODL OR Zashi
```

Defined in script constant:
```python
BASE_TERMS = "Zcash OR ZEC OR Zodl OR #ZODL OR Zashi"
```

## Priority mode query (watchlist-driven)
Priority mode builds one query with all watchlist handles:

```text
(from:<handle1> OR from:<handle2> OR ... OR from:<handleN>) (Zcash OR ZEC OR Zodl OR #ZODL)
```

Implementation snippet:
```python
handles_expr = " OR ".join(f"from:{h}" for h in handles)
q = f"({handles_expr}) ({BASE_TERMS})"
```

### Optional reply capture (feature-flagged)

Reply capture for watchlist handles is now configurable and disabled by default.

Flags:
- `XMON_WATCHLIST_REPLY_CAPTURE_ENABLED=0|1` (default `0`)
- `XMON_WATCHLIST_REPLY_MODE=term_constrained|selected_handles` (default `term_constrained`)
- `XMON_WATCHLIST_REPLY_TIERS=teammate,influencer,ecosystem` (tier filter)
- `XMON_WATCHLIST_REPLY_HANDLES=...` (only used in `selected_handles`)

When enabled:

1) `term_constrained` mode adds reply queries that still require base terms:
```text
(from:<handles...>) filter:replies (Zcash OR ZEC OR Zodl OR #ZODL OR Zashi)
```

2) `selected_handles` mode adds reply queries for explicitly listed watchlist handles:
```text
(from:<selected_handles...>) filter:replies
```

Stored provenance:
- `source_query=priority_reply_term`
- `source_query=priority_reply_selected`

## Discovery mode query
Discovery mode uses only the base terms:

```text
Zcash OR ZEC OR Zodl OR #ZODL
```

## X search URL pattern
For both modes, query text is URL-encoded and opened via:

```text
https://x.com/search?q=<encoded-query>&f=live
```

---

## 2) Refresh-24h behavior (not a search query)

Hourly discovery flow also runs engagement refresh by opening stored status URLs directly (same hour, ~24h later) and re-reading metrics.

That step does **not** use term/handle search; it uses existing saved `url` values per post.

---

## 3) Active watchlist used by priority query

Total watchlist handles: **42**

## Teammate (8)
- @bostonzcash
- @jwihart
- @nuttycom
- @paulbrigner
- @peacemongerz
- @tonymargarit
- @txds_
- @zodl_app

## Influencer (29)
- @_tomhoward
- @anonymist
- @aquietinvestor
- @arjunkhemani
- @balajis
- @bitlarrain
- @btcturtle
- @cypherpunk
- @dignitycipher
- @dismad8
- @ebfull
- @ivydngg
- @lucidzk
- @maxdesalle
- @mert
- @mindsfiction
- @minezcash
- @nate_zec
- @naval
- @neuralunlock
- @rargulati
- @roommatemusing
- @shieldedmoney
- @thecodebuffet
- @thortorrens
- @valkenburgh
- @zerodartz
- @zooko
- @zpartanll7

## Ecosystem (5)
- @genzcash
- @shieldedlabs
- @zcashcommgrants
- @zcashfoundation
- @zechub

---

## 4) Important operational note

The **priority query includes all watchlist tiers** (teammate + influencer + ecosystem). There is currently one combined priority query string.

If you later want tier-specific pull behavior, change `build_queries(...)` in `x_monitor_kb.py` to emit separate tier queries.

---

## 5) Regeneration commands

Recompute watchlist from DB:

```bash
python3 - <<'PY'
import sqlite3
con=sqlite3.connect('/Users/paulbrigner/.openclaw/workspace/memory/x_monitor.db')
con.row_factory=sqlite3.Row
for tier in ['teammate','influencer','ecosystem']:
    rows=[r['handle'] for r in con.execute('SELECT handle FROM watch_accounts WHERE tier=? ORDER BY lower(handle)',(tier,))]
    print('\n'+tier, len(rows))
    for h in rows: print('@'+h)
PY
```

Locate query construction in code:

```bash
grep -n "BASE_TERMS\|def build_queries\|from:" /Users/paulbrigner/.openclaw/workspace/scripts/x_monitor_kb.py
```
