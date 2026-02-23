import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

type DashboardCard = {
  id: string;
  name: string;
  description: string;
  href?: string;
};

const dashboards: DashboardCard[] = [
  {
    id: "x-monitor",
    name: "X Monitor",
    description: "Relevance-filtered X posts with significance signals and analysis details.",
    href: "/x-monitor",
  },
  {
    id: "placeholder-1",
    name: "Dashboard Placeholder 1",
    description: "Reserved for a future dashboard.",
  },
  {
    id: "placeholder-2",
    name: "Dashboard Placeholder 2",
    description: "Reserved for a future dashboard.",
  },
  {
    id: "placeholder-3",
    name: "Dashboard Placeholder 3",
    description: "Reserved for a future dashboard.",
  },
];

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect("/signin");
  }

  return (
    <main className="page dashboard-page">
      <section className="card dashboard-card-shell">
        <header className="feed-header">
          <div>
            <p className="eyebrow">ZODL Team Dashboards</p>
            <h1>Dashboards</h1>
            <p className="subtle-text">Signed in as {session.user.email}</p>
          </div>
          <div className="button-row">
            <SignOutButton />
          </div>
        </header>

        <section className="dashboard-grid" aria-label="Dashboard list">
          {dashboards.map((dashboard) => (
            <article className="dashboard-tile" key={dashboard.id}>
              <h2>{dashboard.name}</h2>
              <p className="subtle-text">{dashboard.description}</p>
              {dashboard.href ? (
                <Link className="button" href={dashboard.href}>
                  Open dashboard
                </Link>
              ) : (
                <span className="button button-disabled" aria-disabled="true">
                  Coming soon
                </span>
              )}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
