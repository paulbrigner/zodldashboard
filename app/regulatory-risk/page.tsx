import Link from "next/link";
import { getRegulatoryRiskData } from "@/lib/regulatory-risk/data";
import {
  buildCombinedActivity,
  computeTaskCounts,
  computeTierCounts,
  computeVerificationStats,
  daysUntilIsoDate,
  formatIsoDate,
  getJurisdictionsMissingPrimarySources,
} from "@/lib/regulatory-risk/insights";
import { computeRecommendations, getPriorityLabel } from "@/lib/regulatory-risk/recommendations";
import type { TaskStatus } from "@/lib/regulatory-risk/types";

const ROADMAP_STATUS_ORDER: TaskStatus[] = ["planned", "in_progress", "done"];

function formatCountdown(days: number | null): string {
  if (days === null) {
    return "Unknown";
  }

  if (days > 1) {
    return `${days} days remaining`;
  }

  if (days === 1) {
    return "1 day remaining";
  }

  if (days === 0) {
    return "Due today";
  }

  if (days === -1) {
    return "Overdue by 1 day";
  }

  return `Overdue by ${Math.abs(days)} days`;
}

function labelStatus(status: string): string {
  if (status === "planned") {
    return "Planned";
  }

  if (status === "in_progress") {
    return "In progress";
  }

  if (status === "done") {
    return "Done";
  }

  return status;
}

export default async function RegulatoryRiskHomePage() {
  const { bundle } = await getRegulatoryRiskData();

  const tierCounts = computeTierCounts(bundle);
  const recommendations = computeRecommendations(bundle);
  const topRecommendations = recommendations.slice(0, 5);

  const reviewDateText = formatIsoDate(bundle.review_schedule.next_review_on);
  const reviewCountdown = formatCountdown(daysUntilIsoDate(bundle.review_schedule.next_review_on));

  const recentActivity = buildCombinedActivity(bundle, { signalLimit: 5 }).slice(0, 6);
  const taskCounts = computeTaskCounts(bundle.task_backlog);
  const missingPrimarySources = getJurisdictionsMissingPrimarySources(bundle.jurisdictions);
  const verificationStats = computeVerificationStats(bundle.jurisdictions);

  return (
    <div className="regulatory-page-body">
      <section className="regulatory-section">
        <header className="regulatory-section-header">
          <h2>Leadership Snapshot</h2>
          <p className="subtle-text">{bundle.meta.title}</p>
        </header>

        <div className="regulatory-tier-grid">
          {Object.entries(bundle.tiers).map(([tierCode, tierDefinition]) => (
            <article className="regulatory-tier-card" key={tierCode}>
              <p className="eyebrow">{tierCode}</p>
              <h3>{tierDefinition.label}</h3>
              <p className="regulatory-tier-count">{tierCounts[tierCode] || 0} jurisdictions</p>
              <p className="subtle-text">{tierDefinition.definition}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="regulatory-section">
        <div className="regulatory-card-grid">
          <article className="regulatory-card">
            <h3>Next Review</h3>
            <p className="regulatory-highlight">{reviewDateText}</p>
            <p className="subtle-text">{reviewCountdown}</p>
            <p className="subtle-text">Owner: {bundle.review_schedule.owner_role}</p>
          </article>

          <article className="regulatory-card">
            <h3>Data Completeness</h3>
            <ul className="regulatory-list">
              <li>{missingPrimarySources.length} jurisdictions missing primary sources</li>
              <li>
                {verificationStats.latestVerifiedCount} items last verified on{" "}
                {verificationStats.latestVerifiedDate ? formatIsoDate(verificationStats.latestVerifiedDate) : "unknown"}
              </li>
              <li>
                Next verification due{" "}
                {verificationStats.nextVerificationDueDate
                  ? formatIsoDate(verificationStats.nextVerificationDueDate)
                  : "unknown"}
              </li>
            </ul>
          </article>

          <article className="regulatory-card">
            <h3>Roadmap Progress</h3>
            <div className="regulatory-pill-row">
              {ROADMAP_STATUS_ORDER.map((status) => (
                <span className="pill" key={status}>
                  {labelStatus(status)}: {taskCounts[status] || 0}
                </span>
              ))}
            </div>
            <Link className="button button-secondary button-small" href="/regulatory-risk/activity">
              View roadmap details
            </Link>
          </article>
        </div>
      </section>

      <section className="regulatory-section">
        <header className="regulatory-section-header">
          <h2>Next Recommended Work</h2>
          <p className="subtle-text">Rule-based actions from current tiers, features, and signals.</p>
        </header>

        {topRecommendations.length === 0 ? (
          <p className="subtle-text">No recommendations are currently triggered by the ruleset.</p>
        ) : (
          <ul className="regulatory-recommendation-list">
            {topRecommendations.map((recommendation) => (
              <li className="regulatory-recommendation-item" key={recommendation.id}>
                <div className="regulatory-recommendation-header">
                  <h3>{recommendation.title}</h3>
                  <span className="pill">{getPriorityLabel(recommendation.priority)} priority</span>
                </div>
                <p>{recommendation.rationale}</p>
                {recommendation.suggestedTasks.length > 0 ? (
                  <ul className="regulatory-list regulatory-list-tight">
                    {recommendation.suggestedTasks.map((task) => (
                      <li key={`${recommendation.id}-${task.id}`}>
                        {task.title} ({task.owner_role})
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="regulatory-section">
        <header className="regulatory-section-header">
          <h2>Recent Activity</h2>
          <p className="subtle-text">Change log + latest signals.</p>
        </header>

        {recentActivity.length === 0 ? (
          <p className="subtle-text">No activity yet.</p>
        ) : (
          <ul className="regulatory-activity-list">
            {recentActivity.map((item) => (
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
    </div>
  );
}
