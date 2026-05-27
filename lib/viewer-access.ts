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

export function allowedGuestEmails(): Set<string> {
  return mergeEmailSets(allowedXMonitorGuestEmails(), allowedRoadmapGuestEmails());
}

export function guestEmailAllowed(email: string): boolean {
  return allowedGuestEmails().has(normalizeEmail(email));
}

export function guestAccessLevelForEmail(email: string): GuestAccessLevel {
  return allowedRoadmapGuestEmails().has(normalizeEmail(email)) ? "roadmap-guest" : "guest";
}

export function isGuestAccessLevel(accessLevel: ViewerAccessLevel): accessLevel is GuestAccessLevel {
  return accessLevel === "guest" || accessLevel === "roadmap-guest";
}

export function canAccessRoadmap(accessLevel: ViewerAccessLevel): boolean {
  return accessLevel === "workspace" || accessLevel === "roadmap-guest" || accessLevel === "local-bypass";
}
