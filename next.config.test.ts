import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

/**
 * The response headers, and the one of them that silently disabled a feature.
 *
 * `Permissions-Policy: camera=()` shipped in this config and made the QR scanner
 * impossible. A policy-denied feature does not present as a policy problem — it
 * presents as a permission problem: `permissions.query` answers `denied`,
 * `getUserMedia` throws `NotAllowedError`, and the site's own camera permission
 * stays granted, so the browser's site settings and its camera preview both look
 * perfectly correct. Every setting a user could check said "allow", and none of
 * them could have fixed it.
 *
 * This file exists because nothing else in the toolchain reads the header: `tsc`
 * accepts `camera=()` and `next build` ships it happily. A green build and a
 * scanner that can never open the camera is exactly the kind of bug these tests
 * are for.
 */

async function responseHeaders(): Promise<Record<string, string>> {
  const groups = (await nextConfig.headers?.()) ?? [];
  const headers: Record<string, string> = {};
  for (const group of groups) {
    for (const header of group.headers) headers[header.key] = header.value;
  }
  return headers;
}

describe("the Permissions-Policy header", () => {
  it("allows this origin the camera", async () => {
    const value = (await responseHeaders())["Permissions-Policy"] ?? "";

    expect(value).toContain("camera=(self)");
  });

  it("never denies the camera to every origin, including this one", async () => {
    // The exact string that broke it. `camera=()` means no origin may use the
    // camera, so the app itself cannot ask — and no user setting can change that,
    // which is what made it so hard to diagnose from the outside.
    const value = (await responseHeaders())["Permissions-Policy"] ?? "";

    expect(value).not.toContain("camera=()");
  });

  it("keeps the microphone and the location closed", async () => {
    // Nothing here asks for either, so denying them costs nothing and takes away
    // something an injected script could reach for.
    const value = (await responseHeaders())["Permissions-Policy"] ?? "";

    expect(value).toContain("microphone=()");
    expect(value).toContain("geolocation=()");
  });
});

describe("the rest of the response headers", () => {
  it("refuses to be framed", async () => {
    // Also load-bearing: a framed page is given no camera unless the page around
    // it asks for one, so framing this app would break the scanner in a way that
    // looks like a browser permission problem.
    expect((await responseHeaders())["X-Frame-Options"]).toBe("DENY");
  });

  it("does not advertise the framework, and does not sniff types", async () => {
    const headers = await responseHeaders();

    expect(nextConfig.poweredByHeader).toBe(false);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
  });
});
