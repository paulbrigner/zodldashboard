import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessArktouros,
  canAccessPgpzRoadmap,
  canAccessRoadmap,
  guestAccessLevelForEmail,
  guestEmailAllowed,
} from "../lib/viewer-access.ts";

function withGuestEnv(values, fn) {
  const previous = {
    ALLOWED_GUEST_GOOGLE_EMAILS: process.env.ALLOWED_GUEST_GOOGLE_EMAILS,
    ALLOWED_ROADMAP_GUEST_EMAILS: process.env.ALLOWED_ROADMAP_GUEST_EMAILS,
    ALLOWED_ARKTOUROS_GUEST_EMAILS: process.env.ALLOWED_ARKTOUROS_GUEST_EMAILS,
  };

  process.env.ALLOWED_GUEST_GOOGLE_EMAILS = values.ALLOWED_GUEST_GOOGLE_EMAILS || "";
  process.env.ALLOWED_ROADMAP_GUEST_EMAILS = values.ALLOWED_ROADMAP_GUEST_EMAILS || "";
  process.env.ALLOWED_ARKTOUROS_GUEST_EMAILS = values.ALLOWED_ARKTOUROS_GUEST_EMAILS || "";

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("Arktouros guests can access currently available private dashboards", () => {
  withGuestEnv(
    {
      ALLOWED_GUEST_GOOGLE_EMAILS: "xmonitor@example.com",
      ALLOWED_ROADMAP_GUEST_EMAILS: "roadmap@example.com",
      ALLOWED_ARKTOUROS_GUEST_EMAILS: "ark@example.com",
    },
    () => {
      const accessLevel = guestAccessLevelForEmail("ARK@example.com");

      assert.equal(guestEmailAllowed("ark@example.com"), true);
      assert.equal(accessLevel, "roadmap-guest");
      assert.equal(canAccessRoadmap(accessLevel), true);
      assert.equal(canAccessPgpzRoadmap(accessLevel), true);
      assert.equal(canAccessArktouros(accessLevel, "ark@example.com"), true);
    }
  );
});

test("plain guests remain X Monitor-only", () => {
  withGuestEnv(
    {
      ALLOWED_GUEST_GOOGLE_EMAILS: "xmonitor@example.com",
      ALLOWED_ROADMAP_GUEST_EMAILS: "roadmap@example.com",
      ALLOWED_ARKTOUROS_GUEST_EMAILS: "ark@example.com",
    },
    () => {
      const accessLevel = guestAccessLevelForEmail("xmonitor@example.com");

      assert.equal(guestEmailAllowed("xmonitor@example.com"), true);
      assert.equal(accessLevel, "guest");
      assert.equal(canAccessRoadmap(accessLevel), false);
      assert.equal(canAccessPgpzRoadmap(accessLevel), false);
      assert.equal(canAccessArktouros(accessLevel, "xmonitor@example.com"), false);
    }
  );
});
