"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DateRangeFields } from "./date-range-fields";

type SearchMode = "keyword" | "semantic";

type FilterPanelProps = {
  initialSearchMode: SearchMode;
  initialTier?: string;
  initialHandle?: string;
  initialSignificant?: boolean;
  initialSince?: string;
  initialUntil?: string;
  initialQuery?: string;
  initialLimit?: number;
  initialHasActiveFilters: boolean;
};

const SEMANTIC_EXAMPLE_QUERY =
  "Posts arguing that ZSAs or token-style features may distract from Zcash's digital cash mission, add protocol complexity, or increase governance risk.";

export function FilterPanel({
  initialSearchMode,
  initialTier,
  initialHandle,
  initialSignificant,
  initialSince,
  initialUntil,
  initialQuery,
  initialLimit,
  initialHasActiveFilters,
}: FilterPanelProps) {
  const [searchMode, setSearchMode] = useState<SearchMode>(initialSearchMode);
  const [queryText, setQueryText] = useState<string>(() => {
    const initial = initialQuery || "";
    if (initialSearchMode === "semantic" && initial.trim() === SEMANTIC_EXAMPLE_QUERY) {
      return "";
    }
    return initial;
  });

  const semanticActive = useMemo(() => queryText.trim().length > 0, [queryText]);
  const hasActiveFilters = searchMode === "semantic" ? semanticActive : initialHasActiveFilters;

  return (
    <details className="filter-panel">
      <summary className="filter-summary">
        <span className="filter-summary-title-wrap">
          <span className="filter-summary-title">Filters</span>
          <span aria-hidden className="disclosure-caret">
            ▾
          </span>
        </span>
        {hasActiveFilters ? (
          <div className="filter-summary-controls">
            <span className="filter-summary-state">Active</span>
          </div>
        ) : null}
      </summary>

      <form className={`filter-grid${searchMode === "semantic" ? " filter-grid-semantic" : ""}`} method="GET">
        <label>
          <span>Search mode</span>
          <select
            name="search_mode"
            onChange={(event) => {
              const nextMode = event.target.value === "semantic" ? "semantic" : "keyword";
              setSearchMode(nextMode);
              if (nextMode === "semantic") {
                setQueryText("");
              }
            }}
            value={searchMode}
          >
            <option value="keyword">Keyword</option>
            <option value="semantic">Semantic</option>
          </select>
        </label>

        {searchMode === "semantic" ? (
          <>
            <label className="semantic-query-field">
              <span>Semantic prompt</span>
              <textarea
                name="q"
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="Describe what you want to find in natural language."
                rows={6}
                value={queryText}
              />
            </label>

            <div className="semantic-example-block">
              <p className="subtle-text semantic-example-label">Example semantic search:</p>
              <p className="semantic-example-text">{SEMANTIC_EXAMPLE_QUERY}</p>
              <button
                className="button button-secondary button-small"
                onClick={() => setQueryText(SEMANTIC_EXAMPLE_QUERY)}
                type="button"
              >
                Use example
              </button>
            </div>
          </>
        ) : (
          <>
            <label>
              <span>Tier</span>
              <select name="tier" defaultValue={initialTier || ""}>
                <option value="">All tiers</option>
                <option value="teammate">Teammate</option>
                <option value="influencer">Influencer</option>
                <option value="ecosystem">Ecosystem</option>
              </select>
            </label>

            <label>
              <span>HANDLE(S)</span>
              <input name="handle" defaultValue={initialHandle || ""} placeholder="zodl in4crypto @mert" type="text" />
            </label>

            <label>
              <span>Significant</span>
              <select name="significant" defaultValue={initialSignificant === undefined ? "" : String(initialSignificant)}>
                <option value="">Either</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>

            <DateRangeFields initialSince={initialSince} initialUntil={initialUntil} />

            <label>
              <span>Text search</span>
              <input
                name="q"
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="keyword"
                type="text"
                value={queryText}
              />
            </label>

            <label>
              <span>Limit</span>
              <input name="limit" defaultValue={String(initialLimit || 50)} max={200} min={1} step={1} type="number" />
            </label>
          </>
        )}

        <div className="filter-actions">
          <button className="button" type="submit">
            Apply filters
          </button>
          <Link className="button button-secondary" href="/x-monitor">
            Reset
          </Link>
        </div>
      </form>
    </details>
  );
}
