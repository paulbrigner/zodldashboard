"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const PRIORITY_BASE_TERMS = "Zcash OR ZEC OR Zodl OR Zashi";

function discoveryBaseTerms(baseTerms: string): string {
  const terms = String(baseTerms || "")
    .split(/\s+OR\s+/i)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return String(baseTerms || "");
  }

  const filtered = terms.filter((term) => {
    const normalized = term.replace(/^\(+|\)+$/g, "").trim().toLowerCase();
    return normalized !== "zec" && normalized !== "#zodl";
  });

  return filtered.length > 0 ? filtered.join(" OR ") : String(baseTerms || "");
}

const DISCOVERY_BASE_TERMS = discoveryBaseTerms(PRIORITY_BASE_TERMS);
const WATCHLIST_BY_TIER = {
  teammate: [
    "bostonzcash",
    "jwihart",
    "nuttycom",
    "paulbrigner",
    "peacemongerz",
    "tonymargarit",
    "txds_",
    "zodl_app",
  ],
  influencer: [
    "_tomhoward",
    "anonymist",
    "aquietinvestor",
    "arjunkhemani",
    "balajis",
    "bitlarrain",
    "btcturtle",
    "cypherpunk",
    "dignitycipher",
    "dismad8",
    "ebfull",
    "ivydngg",
    "lucidzk",
    "maxdesalle",
    "mert",
    "mindsfiction",
    "minezcash",
    "nate_zec",
    "naval",
    "neuralunlock",
    "rargulati",
    "roommatemusing",
    "shieldedmoney",
    "thecodebuffet",
    "thortorrens",
    "valkenburgh",
    "zerodartz",
    "zooko",
    "zpartanll7",
  ],
  ecosystem: ["genzcash", "shieldedlabs", "zcashcommgrants", "zcashfoundation", "zechub"],
} as const;

const WATCHLIST_TIER_LABELS: Record<keyof typeof WATCHLIST_BY_TIER, string> = {
  teammate: "Teammate",
  influencer: "Influencer",
  ecosystem: "Ecosystem",
};

export function QueryReferencePopup() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const totalWatchlistHandles = Object.values(WATCHLIST_BY_TIER).reduce((sum, handles) => sum + handles.length, 0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const modal = open ? (
    <div
      aria-modal="true"
      className="query-modal-backdrop"
      onClick={() => setOpen(false)}
      role="dialog"
    >
      <section className="query-modal" onClick={(event) => event.stopPropagation()}>
        <header className="query-modal-header">
          <h2>How X Monitor Queries X</h2>
          <p className="subtle-text">Plain-language reference for the repo-default AWS collector plan.</p>
        </header>

        <div className="query-modal-body">
          <section>
            <h3>What this popup reflects</h3>
            <p>
              This reference shows the default query families, watchlist tiers, and gates defined in the repo. Live AWS
              Lambda env can still override base terms, watchlist includes, and reply-capture mode.
            </p>
          </section>

          <section>
            <h3>Collector cadence</h3>
            <p>
              Priority capture runs every 15 minutes. Discovery capture runs every 30 minutes. Async significance
              classification runs every 5 minutes on newly ingested pending posts.
            </p>
          </section>

          <section>
            <h3>Base terms searched</h3>
            <p>Priority capture uses the configured base terms:</p>
            <pre className="query-code">{PRIORITY_BASE_TERMS}</pre>
            <p>Discovery derives a narrower keyword set from those terms to reduce noise:</p>
            <pre className="query-code">{DISCOVERY_BASE_TERMS}</pre>
            <p className="subtle-text">By default that drops standalone `ZEC` from the discovery lane.</p>
          </section>

          <section>
            <h3>Priority capture lanes</h3>
            <p>Priority mode is watchlist-driven and uses up to three query families.</p>
            <p>
              <strong>Direct watchlist lane</strong>
            </p>
            <pre className="query-code">(from:teammate1 OR from:ecosystem1 OR ...) -is:retweet</pre>
            <p className="subtle-text">
              Teammate and ecosystem handles are captured directly. This lane includes replies and does not require base
              terms.
            </p>
            <p>
              <strong>Influencer top-level lane</strong>
            </p>
            <pre className="query-code">(from:influencer1 OR from:influencer2 OR ...) ({PRIORITY_BASE_TERMS}) -is:reply -is:retweet</pre>
            <p className="subtle-text">Influencer top-level posts remain term-constrained by the configured base terms.</p>
            <p>
              <strong>Influencer reply lane</strong>
            </p>
            <pre className="query-code">(from:influencer1 OR from:influencer2 OR ...) is:reply ({PRIORITY_BASE_TERMS}) -is:retweet</pre>
            <p className="subtle-text">
              Default reply mode is <code>term_constrained</code>. Influencer replies are split into a dedicated lane to
              reduce duplicate reads against the top-level influencer query.
            </p>
            <pre className="query-code">(from:selected_handle1 OR from:selected_handle2 OR ...) is:reply -is:retweet</pre>
            <p className="subtle-text">
              If reply mode is switched to <code>selected_handles</code>, the reply lane becomes handle-only as shown
              above.
            </p>
            <p className="subtle-text">
              Repo-default watchlist size: {totalWatchlistHandles} handles (
              {WATCHLIST_BY_TIER.teammate.length} teammate, {WATCHLIST_BY_TIER.influencer.length} influencer,{" "}
              {WATCHLIST_BY_TIER.ecosystem.length} ecosystem).
            </p>
          </section>

          <section>
            <h3>Discovery capture lane</h3>
            <p>Discovery mode is keyword-driven. It does not use watchlist handles.</p>
            <pre className="query-code">({DISCOVERY_BASE_TERMS}) -is:retweet</pre>
            <p className="subtle-text">
              Discovery is the broader lane and is where omit-list filtering matters most for API-cost control.
            </p>
          </section>

          <section>
            <h3>Incremental polling</h3>
            <p>
              Each query family uses its own <code>since_id</code> checkpoint. Under normal operation, runs fetch only
              newer matching posts for that specific query key.
            </p>
          </section>

          <section>
            <h3>Gates before ingest</h3>
            <p>Matching posts still go through collector-side gates before they are written to storage.</p>
            <ul>
              <li>Language allowlist gate when enabled.</li>
              <li>Canonical omit-handle list for keyword/discovery-origin posts.</li>
              <li>Base-term relevance gate for discovery posts and term-constrained priority families.</li>
              <li>Empty or stub-text hard reject for URL-only/media-only/empty posts.</li>
            </ul>
          </section>

          <section>
            <h3>Significance flow</h3>
            <p>
              The collector does not score significance inline anymore. Accepted posts are ingested with{" "}
              <code>classification_status=pending</code>.
            </p>
            <p>
              A separate async classifier then assigns <code>is_significant</code>, <code>significance_reason</code>,
              model, and confidence. Dashboard filters refine stored results; they do not change the upstream X query.
            </p>
          </section>

          <section>
            <h3>Live override hooks</h3>
            <p>The main env hooks that can make production differ from this popup are:</p>
            <ul>
              <li><code>XMON_X_API_BASE_TERMS</code></li>
              <li><code>XMON_X_API_WATCHLIST_TIERS_JSON</code></li>
              <li><code>XMON_X_API_WATCHLIST_INCLUDE_HANDLES</code></li>
              <li><code>XMON_X_API_REPLY_MODE</code></li>
              <li><code>XMON_X_API_REPLY_TIERS</code></li>
              <li><code>XMON_X_API_REPLY_SELECTED_HANDLES</code></li>
            </ul>
          </section>

          <section>
            <h3>Active watchlist handles by category</h3>
            <p>These are the repo-default handles included in the priority capture plan.</p>
            <div className="watchlist-groups">
              {(Object.keys(WATCHLIST_BY_TIER) as Array<keyof typeof WATCHLIST_BY_TIER>).map((tier) => (
                <details className="watchlist-group" key={tier}>
                  <summary>
                    <span>{WATCHLIST_TIER_LABELS[tier]}</span>
                    <span className="watchlist-count">{WATCHLIST_BY_TIER[tier].length}</span>
                  </summary>
                  <ul className="watchlist-handles">
                    {WATCHLIST_BY_TIER[tier].map((handle) => (
                      <li key={handle}>@{handle}</li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>

          <section>
            <h3>How this relates to this page&apos;s filters</h3>
            <p>
              Filters on this page refine stored feed results in the dashboard. They do not change how the live X query
              is constructed upstream.
            </p>
          </section>
        </div>

        <div className="query-modal-actions">
          <button className="button" onClick={() => setOpen(false)} type="button">
            Close
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button className="button button-secondary button-small" onClick={() => setOpen(true)} type="button">
        Query Reference
      </button>
      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
