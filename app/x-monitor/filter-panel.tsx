"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DateRangeFields } from "./date-range-fields";

type SearchMode = "keyword" | "semantic";

type FilterPanelProps = {
  initialSearchMode: SearchMode;
  initialTiers?: string[];
  initialHandle?: string;
  initialSignificant?: boolean;
  initialSince?: string;
  initialUntil?: string;
  initialQuery?: string;
  initialLimit?: number;
  initialHasActiveFilters: boolean;
};

export function FilterPanel({
  initialSearchMode,
  initialTiers,
  initialHandle,
  initialSignificant,
  initialSince,
  initialUntil,
  initialQuery,
  initialLimit,
  initialHasActiveFilters,
}: FilterPanelProps) {
  const router = useRouter();
  const [searchMode, setSearchMode] = useState<SearchMode>(initialSearchMode);
  const [queryText, setQueryText] = useState<string>(initialQuery || "");

  const semanticActive = useMemo(() => queryText.trim().length > 0, [queryText]);
  const hasActiveFilters = searchMode === "semantic" ? semanticActive : initialHasActiveFilters;

  const resetFilters = () => {
    setSearchMode("semantic");
    setQueryText("");
    router.push("/x-monitor?search_mode=semantic");
  };

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
        <input name="search_mode" type="hidden" value={searchMode} />
        <label>
          <span>Search mode</span>
          <div aria-label="Search mode" className="mode-toggle" role="group">
            {(["keyword", "semantic"] as const).map((mode) => (
              <button
                aria-pressed={searchMode === mode}
                className={`mode-toggle-button${searchMode === mode ? " mode-toggle-button-active" : ""}`}
                key={mode}
                onClick={() => {
                  setSearchMode(mode);
                  if (mode === "semantic") {
                    setQueryText("");
                  }
                }}
                type="button"
              >
                {mode === "keyword" ? "Keyword" : "Semantic"}
              </button>
            ))}
          </div>
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
          </>
        ) : (
          <>
            <label>
              <span>Tiers</span>
              <select multiple name="tier" defaultValue={initialTiers || []} size={4}>
                <option value="teammate">Teammate</option>
                <option value="investor">Investors</option>
                <option value="influencer">Influencer</option>
                <option value="ecosystem">Ecosystem</option>
              </select>
            </label>

            <label>
              <span>HANDLE(S)</span>
              <input name="handle" defaultValue={initialHandle || ""} placeholder="zodl in4crypto @mert" type="text" />
            </label>

            <label>
              <div className="filter-label-row">
                <span>Significant</span>
                <details className="field-help">
                  <summary aria-label="Significant help" className="field-help-trigger" title="Significant help">
                    i
                  </summary>
                  <div className="field-help-popover">
                    <p>
                      Significant posts are classified asynchronously by AI after capture. Pending posts are excluded
                      from both the true and false filters until classification completes.
                    </p>
                  </div>
                </details>
              </div>
              <select name="significant" defaultValue={initialSignificant === undefined ? "" : String(initialSignificant)}>
                <option value="">Either</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>

            <DateRangeFields initialSince={initialSince} initialUntil={initialUntil} />

            <label>
              <div className="filter-label-row">
                <span>Text search</span>
                <details className="field-help">
                  <summary aria-label="Text search help" className="field-help-trigger" title="Text search help">
                    i
                  </summary>
                  <div className="field-help-popover">
                    <p>
                      Text search is a case-insensitive phrase match across post body text and author handle. Multiple
                      words are treated as one phrase, not automatic AND/OR logic.
                    </p>
                  </div>
                </details>
              </div>
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
          <button
            className="button button-secondary"
            onClick={resetFilters}
            type="button"
          >
            Reset
          </button>
        </div>
      </form>
    </details>
  );
}
