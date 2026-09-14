import { apiKeyClient } from "@better-auth/api-key/client";
import {
  adminClient,
  anonymousClient,
  deviceAuthorizationClient,
  emailOTPClient,
  genericOAuthClient,
  inferAdditionalFields,
  lastLoginMethodClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import type { AccessControl } from "better-auth/plugins/access";
import { createAuthClient } from "better-auth/react";
import { ac, admin, member, owner, viewer } from "./permissions";

// Builds the FULL browser-facing auth base URL, "/api/auth" included.
//
// better-auth's client (like its server) combines `baseURL` + `basePath`
// via a `withPath()` helper that only appends `basePath` when `baseURL`
// has no path of its own — if `baseURL` already has any path (e.g. our
// "/kaneo" subpath prefix), `basePath` is silently dropped entirely
// (packages/better-auth/src/utils/url.ts). So under a subpath deployment,
// passing `baseURL: ".../kaneo"` + `basePath: "/api/auth"` below would
// silently produce requests to ".../kaneo" with no "/api/auth" at all —
// this happened for real, see the "redirect loop" postmortem in commit
// history. Baking "/api/auth" in here ourselves sidesteps that: `basePath`
// is then a no-op regardless of which branch withPath() takes.
//
// (Contrast with apps/api/src/auth.ts's server-side baseURL, which must
// stay origin-only instead — the server matches this same computed value
// against the *incoming* request's pathname, which our reverse proxy
// setup strips "/kaneo" from before it ever reaches the API process.)
const getBaseURL = () => {
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:1337";
  try {
    const url = new URL(apiUrl);
    const path = url.pathname.replace(/\/api\/?$/, "");
    return `${url.protocol}//${url.host}${path}/api/auth`;
  } catch {
    return `${apiUrl.replace(/\/api\/?$/, "")}/api/auth`;
  }
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  basePath: "/api/auth",
  plugins: [
    anonymousClient(),
    lastLoginMethodClient(),
    magicLinkClient(),
    emailOTPClient(),
    organizationClient({
      // Same widening as the server plugin in `apps/api/src/auth.ts`: our
      // narrow `statement` shape makes `ac`'s inferred `newRole` generic
      // incompatible with better-auth's looser `AccessControl` type.
      ac: ac as AccessControl,
      roles: {
        viewer,
        member,
        admin,
        owner,
      },
      dynamicAccessControl: {
        enabled: true,
      },
    }),
    genericOAuthClient(),
    deviceAuthorizationClient(),
    apiKeyClient(),
    adminClient(),
    inferAdditionalFields({
      user: {
        locale: {
          type: "string",
          required: false,
          input: true,
        },
      },
    }),
  ],
});
