// "roadmap-guest" is the legacy access-level value for guests who can access
// the private dashboards currently available in the app.
export type GuestAccessLevel = "guest" | "roadmap-guest";
export type AuthLoginAccessLevel = "workspace" | GuestAccessLevel;
export type ViewerAccessLevel = AuthLoginAccessLevel | "local-bypass";

const BUILT_IN_ROADMAP_GUEST_EMAILS = "div@accrediv.com";

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function parseEmailAllowlist(value: string): Set<string> {
  return new Set(
    value
      .split(/[,\s]+/)
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean)
  );
}

function mergeEmailSets(...sets: Set<string>[]): Set<string> {
  const merged = new Set<string>();
  for (const set of sets) {
    for (const email of set) {
      merged.add(email);
    }
  }
  return merged;
}

export function allowedXMonitorGuestEmails(): Set<string> {
  return parseEmailAllowlist(process.env.ALLOWED_GUEST_GOOGLE_EMAILS || "");
}

export function allowedRoadmapGuestEmails(): Set<string> {
  return mergeEmailSets(
    parseEmailAllowlist(BUILT_IN_ROADMAP_GUEST_EMAILS),
    parseEmailAllowlist(process.env.ALLOWED_ROADMAP_GUEST_EMAILS || "")
  );
}

export function allowedArktourosGuestEmails(): Set<string> {
  return parseEmailAllowlist(process.env.ALLOWED_ARKTOUROS_GUEST_EMAILS || "");
}

export function allowedCurrentPrivateDashboardGuestEmails(): Set<string> {
  return mergeEmailSets(allowedRoadmapGuestEmails(), allowedArktourosGuestEmails());
}

export function allowedGuestEmails(): Set<string> {
  return mergeEmailSets(allowedXMonitorGuestEmails(), allowedCurrentPrivateDashboardGuestEmails());
}

export function guestEmailAllowed(email: string): boolean {
  return allowedGuestEmails().has(normalizeEmail(email));
}

export function guestAccessLevelForEmail(email: string): GuestAccessLevel {
  return allowedCurrentPrivateDashboardGuestEmails().has(normalizeEmail(email)) ? "roadmap-guest" : "guest";
}

export function isGuestAccessLevel(accessLevel: ViewerAccessLevel): accessLevel is GuestAccessLevel {
  return accessLevel === "guest" || accessLevel === "roadmap-guest";
}

export function canAccessRoadmap(accessLevel: ViewerAccessLevel): boolean {
  return accessLevel === "workspace" || accessLevel === "roadmap-guest" || accessLevel === "local-bypass";
}

export function canAccessPgpzRoadmap(accessLevel: ViewerAccessLevel): boolean {
  return canAccessRoadmap(accessLevel);
}

export function canAccessArktouros(accessLevel: ViewerAccessLevel, email: string): boolean {
  return canAccessRoadmap(accessLevel) || allowedArktourosGuestEmails().has(normalizeEmail(email));
}
