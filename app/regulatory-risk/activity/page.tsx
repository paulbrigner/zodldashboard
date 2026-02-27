import { getRegulatoryRiskData } from "@/lib/regulatory-risk/data";
import { buildCombinedActivity, formatIsoDate } from "@/lib/regulatory-risk/insights";
import { asString } from "@/lib/regulatory-risk/utils";
import type { SignalEvent, TaskStatus } from "@/lib/regulatory-risk/types";

type ActivityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const ROADMAP_COLUMNS: Array<{ status: TaskStatus; title: string }> = [
  { status: "planned", title: "Planned enhancements" },
  { status: "in_progress", title: "In progress" },
  { status: "done", title: "Done" },
];

function sanitizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildSignalSnippet(params: {
  date: string;
  type: string;
  jurisdictionId: string;
  summary: string;
  fromTier: string;
  toTier: string;
}): SignalEvent {
  const slug = sanitizeToken(params.jurisdictionId || params.type || "signal");
  const id = `sig_${params.date.replace(/-/g, "_")}_${slug}`;

  const details: Record<string, unknown> = {
    summary: params.summary || "Replace with policy decision + source detail.",
  };

  if (params.type === "jurisdiction_tier_change") {
    details.from_tier = params.fromTier || "AMBER";
    details.to_tier = params.toTier || "RED";
  }

  return {
    id,
    date: params.date,
    type: params.type,
    jurisdiction_id: params.jurisdictionId || undefined,
    details,
  };
}

export default async function ActivityPage({ searchParams }: ActivityPageProps) {
  const { bundle } = await getRegulatoryRiskData();
  const params = (await searchParams) || {};

  const signalTypes = [
    ...new Set(
      bundle.recommendation_rules
        .map((rule) => rule.when.signal_type)
        .filter((signalType): signalType is string => Boolean(signalType))
    ),
  ];

  const date = asString(params.date) || todayIsoDate();
  const type = asString(params.type) || signalTypes[0] || "jurisdiction_tier_change";
  const jurisdictionId = asString(params.jurisdiction_id) || "";
  const summary = asString(params.summary) || "";
  const fromTier = asString(params.from_tier) || "AMBER";
  const toTier = asString(params.to_tier) || "RED";

  const signalTemplate = buildSignalSnippet({
    date,
    type,
    jurisdictionId,
    summary,
    fromTier,
    toTier,
  });

  const activityItems = buildCombinedActivity(bundle);

  return (
    <section className="regulatory-section">
      <header className="regulatory-section-header">
        <h2>Activity and Roadmap</h2>
        <p className="subtle-text">Timeline view for change log + signals, with a helper to add new signals as JSON.</p>
      </header>

      <section className="regulatory-subsection">
        <h3>Roadmap status</h3>
        <div className="regulatory-kanban">
          {ROADMAP_COLUMNS.map((column) => {
            const items = bundle.task_backlog.filter((task) => task.status === column.status);
            return (
              <article className="regulatory-kanban-column" key={column.status}>
                <h4>{column.title}</h4>
                {items.length === 0 ? (
                  <p className="subtle-text">No items.</p>
                ) : (
                  <ul className="regulatory-list regulatory-list-tight">
                    {items.map((task) => (
                      <li id={task.id} key={task.id}>
                        {task.title} ({task.owner_role})
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="regulatory-subsection">
        <h3>Timeline</h3>
        {activityItems.length === 0 ? (
          <p className="subtle-text">No activity recorded yet.</p>
        ) : (
          <ul className="regulatory-activity-list">
            {activityItems.map((item) => (
              <li className="regulatory-activity-item" key={`${item.kind}-${item.date}-${item.summary}`}>
                <p className="regulatory-activity-meta">
                  <span className="pill">{item.kind === "signal" ? "Signal" : "Change"}</span>
                  <span>{formatIsoDate(item.date)}</span>
                </p>
                <p>{item.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="regulatory-subsection">
        <h3>Add a signal (helper)</h3>
        <form action="/regulatory-risk/activity" className="filter-grid regulatory-filters" method="get">
          <label>
            <span>Date</span>
            <input defaultValue={date} name="date" type="date" />
          </label>

          <label>
            <span>Signal type</span>
            <select defaultValue={type} name="type">
              {[...signalTypes, "jurisdiction_tier_change"].filter((value, index, arr) => arr.indexOf(value) === index).map((signalType) => (
                <option key={signalType} value={signalType}>
                  {signalType}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Jurisdiction</span>
            <select defaultValue={jurisdictionId} name="jurisdiction_id">
              <option value="">None</option>
              {bundle.jurisdictions.map((jurisdiction) => (
                <option key={jurisdiction.id} value={jurisdiction.id}>
                  {jurisdiction.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Summary</span>
            <input defaultValue={summary} name="summary" type="text" />
          </label>

          <label>
            <span>From tier</span>
            <select defaultValue={fromTier} name="from_tier">
              {Object.keys(bundle.tiers).map((tierCode) => (
                <option key={tierCode} value={tierCode}>
                  {tierCode}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>To tier</span>
            <select defaultValue={toTier} name="to_tier">
              {Object.keys(bundle.tiers).map((tierCode) => (
                <option key={tierCode} value={tierCode}>
                  {tierCode}
                </option>
              ))}
            </select>
          </label>

          <div className="filter-actions">
            <button className="button" type="submit">
              Generate snippet
            </button>
          </div>
        </form>

        <p className="subtle-text">Copy this JSON object into `data/regulatory-risk/signals.json` and `data_bundle_v1_1.json`.</p>
        <pre className="query-code">{JSON.stringify(signalTemplate, null, 2)}</pre>
      </section>
    </section>
  );
}
