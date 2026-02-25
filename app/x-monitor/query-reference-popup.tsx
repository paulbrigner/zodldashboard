"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const BASE_TERMS = "Zcash OR ZEC OR Zodl OR #ZODL";
const WATCHLIST_BY_TIER = {
  teammate: [
    "bostonzcash",
    "jswihart",
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
    "in4crypto",
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
  ecosystem: ["genzcash", "shieldedlabs", "tachyonzcash", "zcashcommgrants", "zcashfoundation", "zechub"],
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
          <p className="subtle-text">Plain-language reference from current query/watchlist config.</p>
        </header>

        <div className="query-modal-body">
          <section>
            <h3>Base terms searched</h3>
            <p>
              X Monitor always starts from this keyword set:
            </p>
            <pre className="query-code">{BASE_TERMS}</pre>
          </section>

          <section>
            <h3>Priority mode (watchlist-driven)</h3>
            <p>
              Priority mode searches posts from all watchlist handles, combined with the base terms:
            </p>
            <pre className="query-code">(from:handle1 OR from:handle2 OR ...) ({BASE_TERMS})</pre>
            <p className="subtle-text">
              Current watchlist size: {totalWatchlistHandles} handles (
              {WATCHLIST_BY_TIER.teammate.length} teammate, {WATCHLIST_BY_TIER.influencer.length} influencer,{" "}
              {WATCHLIST_BY_TIER.ecosystem.length} ecosystem).
            </p>
          </section>

          <section>
            <h3>Discovery mode (keyword-driven)</h3>
            <p>Discovery mode does not use handles. It runs only the base terms query.</p>
          </section>

          <section>
            <h3>Active watchlist handles by category</h3>
            <p>These handles are currently included in the priority mode query.</p>
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
            <h3>Refresh-24h behavior</h3>
            <p>
              The 24-hour refresh does not run a new keyword query. It revisits already-saved post URLs and updates engagement metrics.
            </p>
          </section>

          <section>
            <h3>How this relates to this page&apos;s filters</h3>
            <p>
              Filters on this page refine stored feed results in the dashboard. They do not change how the live X query is constructed upstream.
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
