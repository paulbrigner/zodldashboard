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
    "lukaskorba",
    "nuttycom",
    "paulbrigner",
    "peacemongerz",
    "tonymargarit",
    "txds_",
    "zodl_co",
    "zodl_app",
  ],
  investor: [
    "a16zcrypto",
    "balajis",
    "cbventures",
    "chapterone",
    "cypherpunk",
    "friedberg",
    "hosseeb",
    "maelstromfund",
    "paradigm",
    "winklevosscap",
  ],
  influencer: [
    "_tomhoward",
    "agzt_111",
    "anonymist",
    "aquietinvestor",
    "arjunkhemani",
    "banthys",
    "bitlarrain",
    "btcturtle",
    "cipherscan_app",
    "colludingnode",
    "cq_elzz",
    "dignitycipher",
    "dismad8",
    "ebfull",
    "hedging_reality",
    "inthepixels",
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
    "sacha",
    "seams5s",
    "shieldedmoney",
    "thecodebuffet",
    "thortorrens",
    "tipz_cash",
    "valkenburgh",
    "will_mcevoy",
    "zcashme",
    "zerodartz",
    "zooko",
    "zpartanll7",
  ],
  ecosystem: ["genzcash", "shieldedlabs", "zcash", "zcashcommgrants", "zcashfoundation", "zechub"],
} as const;

const WATCHLIST_TIER_LABELS: Record<keyof typeof WATCHLIST_BY_TIER, string> = {
  teammate: "Teammate",
  investor: "Investors",
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
          <p className="subtle-text">Plain-language reference for the current deployed AWS collector plan.</p>
        </header>

        <div className="query-modal-body">
          <section>
            <h3>Current capture plan</h3>
            <p>
              X Monitor runs a priority collector every 15 minutes, a discovery collector every 30 minutes, and an async
              significance classifier every 5 minutes.
            </p>
          </section>

          <section>
            <h3>Base terms searched</h3>
            <p>Priority capture uses the configured base terms:</p>
            <pre className="query-code">{PRIORITY_BASE_TERMS}</pre>
            <p>Discovery derives a narrower keyword set from those terms to reduce noise:</p>
            <pre className="query-code">{DISCOVERY_BASE_TERMS}</pre>
            <p className="subtle-text">The current discovery lane drops standalone <code>ZEC</code> to reduce noise.</p>
          </section>

          <section>
            <h3>Priority capture lanes</h3>
            <p>Priority mode is watchlist-driven and uses up to three query families.</p>
            <p>
              <strong>Direct watchlist lane</strong>
            </p>
            <pre className="query-code">(from:teammate1 OR from:investor1 OR from:ecosystem1 OR ...) -is:retweet</pre>
            <p className="subtle-text">
              Teammate, investor, and ecosystem handles are captured directly. This lane includes replies and does not
              require base terms.
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
              Reply capture is currently <code>term_constrained</code>. Influencer replies are split into a dedicated
              lane to reduce duplicate reads against the top-level influencer query.
            </p>
            <p className="subtle-text">
              Current watchlist size: {totalWatchlistHandles} handles (
              {WATCHLIST_BY_TIER.teammate.length} teammate, {WATCHLIST_BY_TIER.investor.length} investors,{" "}
              {WATCHLIST_BY_TIER.influencer.length} influencer, {WATCHLIST_BY_TIER.ecosystem.length} ecosystem).
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
              <li>English language allowlist.</li>
              <li>Canonical omit-handle list for keyword/discovery-origin posts.</li>
              <li>Base-term relevance gate for discovery posts and term-constrained priority families.</li>
              <li>Empty or stub-text hard reject for URL-only/media-only/empty posts.</li>
            </ul>
          </section>

          <section>
            <h3>Significance flow</h3>
            <p>
              Accepted posts are ingested with <code>classification_status=pending</code>.
            </p>
            <p>
              A separate async classifier then assigns <code>is_significant</code>, <code>significance_reason</code>,
              model, and confidence. Dashboard filters refine stored results; they do not change the upstream X query.
            </p>
          </section>

          <section>
            <h3>Active watchlist handles by category</h3>
            <p>These are the currently deployed handles included in the priority capture plan.</p>
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
