import { describe, expect, it } from "vitest";
import { wwwRedirectUrl } from "./www-redirect";

describe("wwwRedirectUrl", () => {
  it("moves www to the apex and keeps the path and query", () => {
    // The deep-link case: a directory that normalised a link to `www` must land
    // on the same page, not the front door.
    expect(
      wwwRedirectUrl({
        host: "www.spacedust.cc",
        pathname: "/compare",
        search: "?ref=phantom",
      }),
    ).toBe("https://spacedust.cc/compare?ref=phantom");
  });

  it("leaves the apex alone", () => {
    expect(
      wwwRedirectUrl({ host: "spacedust.cc", pathname: "/", search: "" }),
    ).toBeNull();
  });

  it("leaves a host that merely contains www alone", () => {
    // Only a `www.` *prefix* is an alias. `awww.` is a different name.
    expect(
      wwwRedirectUrl({ host: "awww.spacedust.cc", pathname: "/", search: "" }),
    ).toBeNull();
  });

  it("does not redirect a bare www label", () => {
    expect(wwwRedirectUrl({ host: "www.", pathname: "/", search: "" })).toBeNull();
  });

  it("reads the host case-insensitively and tolerates a trailing dot", () => {
    // Both are the same host to DNS and to a browser, so both must redirect.
    expect(
      wwwRedirectUrl({ host: "WWW.Spacedust.CC.", pathname: "/scan", search: "" }),
    ).toBe("https://spacedust.cc/scan");
  });

  it("drops an incoming port rather than publishing it", () => {
    // A local or tunnelled request can carry one; the apex is reached on 443.
    expect(
      wwwRedirectUrl({ host: "www.spacedust.cc:3000", pathname: "/", search: "" }),
    ).toBe("https://spacedust.cc/");
  });
});
