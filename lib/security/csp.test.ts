import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCsp, cspHeaderName, logoOrigins } from "./csp";
import {
  LOGO_EXACT_HOSTS,
  LOGO_HOST_SUFFIXES,
} from "@/lib/utils/logo-hosts";

/**
 * The policy is the one thing in this repo whose failure mode is silent: a
 * directive that is too tight breaks signing without saying so, and one that is
 * too loose looks identical to a working site. These pin the parts that would
 * otherwise rot — the nonce, the deliberate looseness, and the derived origins.
 */

const NONCE = "dGVzdC1ub25jZS0xMjM0NTY3OA==";

const directives = (policy: string): Map<string, string[]> =>
  new Map(
    policy.split("; ").map((entry) => {
      const [name, ...values] = entry.split(" ");
      return [name as string, values];
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildCsp", () => {
  it("carries the nonce and lets the nonced bootstrap load its chunks", () => {
    const policy = buildCsp(NONCE);
    const script = directives(policy).get("script-src") ?? [];

    expect(script).toContain(`'nonce-${NONCE}'`);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
  });

  it("never allows eval in production", () => {
    // Tests run with NODE_ENV=test, which is treated as production: if this ever
    // starts containing 'unsafe-eval', the dev exemption has leaked.
    expect(buildCsp(NONCE)).not.toContain("unsafe-eval");
  });

  it("closes the routes an injected script would take", () => {
    const map = directives(buildCsp(NONCE));

    expect(map.get("object-src")).toEqual(["'none'"]);
    expect(map.get("base-uri")).toEqual(["'self'"]);
    expect(map.get("frame-ancestors")).toEqual(["'none'"]);
    expect(map.get("script-src-attr")).toEqual(["'none'"]);
    expect(map.get("default-src")).toEqual(["'self'"]);
  });

  it("allows the wallet relay and the wallet list, over both transports", () => {
    const connect = directives(buildCsp(NONCE)).get("connect-src") ?? [];

    expect(connect).toContain("'self'");
    expect(connect).toContain("wss://relay.walletconnect.org");
    expect(connect).toContain("https://api.web3modal.org");
  });

  it("does not open connect-src to the world", () => {
    // RPC and Jupiter are proxied through /api/*, so a bare `https:` here would be
    // a regression rather than a convenience.
    const connect = directives(buildCsp(NONCE)).get("connect-src") ?? [];

    expect(connect).not.toContain("https:");
    expect(connect).not.toContain("*");
  });

  it("lets the model loader read the blob URLs it creates, and nothing else", () => {
    // The saucer's textures live inside `ufo-v1.glb`, and GLTFLoader hands them
    // to ImageBitmapLoader through object URLs — `fetch` on `blob:` is
    // `connect-src`'s business. Without this entry the ship renders untextured on
    // every browser, silently: the loader logs to the console and the model still
    // draws. Pinned so it cannot be tidied away as an unnecessary widening.
    const connect = directives(buildCsp(NONCE)).get("connect-src") ?? [];

    expect(connect).toContain("blob:");
    expect(connect.filter((value) => value.includes("://"))).toEqual([
      "https://rpc.walletconnect.org",
      "https://api.web3modal.org",
      "https://verify.walletconnect.com",
      "https://verify.walletconnect.org",
      "https://echo.walletconnect.com",
      "https://pulse.walletconnect.org",
      "https://secure.walletconnect.org",
      "https://secure-mobile.walletconnect.org",
      "wss://relay.walletconnect.org",
    ]);
  });
});

describe("logoOrigins", () => {
  it("is derived from the image optimizer's own allow-list", () => {
    // One source of truth: a host added for `next/image` is allowed for `<img>` in
    // the policy, and a host removed there cannot linger here.
    const origins = logoOrigins();

    for (const host of LOGO_EXACT_HOSTS) {
      expect(origins).toContain(`https://${host}`);
    }
    for (const suffix of LOGO_HOST_SUFFIXES) {
      expect(origins).toContain(`https://*.${suffix}`);
    }
  });

  it("allows any https image, because NFT artwork cannot be enumerated", () => {
    // Token logos are restricted to vetted hosts in `sanitizeLogoUri` instead —
    // that check runs before a URL reaches the DOM, so the policy does not need to
    // carry the allow-list. Artwork is the case that forced `https:`: a
    // collection's image lives on whichever gateway its creator chose, and an
    // enumerated img-src blanked every one of them the moment the policy began
    // enforcing.
    const img = directives(buildCsp(NONCE)).get("img-src") ?? [];

    expect(img).toEqual(["'self'", "data:", "blob:", "https:"]);
    expect(img).not.toContain("*");
    expect(img).not.toContain("http:");
  });
});

describe("font-src", () => {
  it("allows the wallet modal's own typeface, and nothing else remote", () => {
    // AppKit fetches its UI font from this host. The modal works without it —
    // system fonts — so a missing entry shows up as a cosmetic change nobody
    // attributes to a policy, which is why it is pinned here.
    const font = directives(buildCsp(NONCE)).get("font-src") ?? [];

    expect(font).toEqual(["'self'", "data:", "https://fonts.reown.com"]);
  });
});

describe("cspHeaderName", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports rather than enforces outside production, where the console is the point", () => {
    vi.stubEnv("CSP_ENFORCE", "");
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
  });

  it("enforces by default in production, because a report-only policy protects nobody", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CSP_ENFORCE", "");
    expect(cspHeaderName()).toBe("Content-Security-Policy");
  });

  it("enforces only when asked", () => {
    vi.stubEnv("CSP_ENFORCE", "1");
    expect(cspHeaderName()).toBe("Content-Security-Policy");

    vi.stubEnv("CSP_ENFORCE", "true");
    expect(cspHeaderName()).toBe("Content-Security-Policy");

    // Anything else that is not an explicit opt-out keeps the default, so a typo
    // cannot silently loosen a production policy.
    vi.stubEnv("CSP_ENFORCE", "yes");
    expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
  });

  it("goes back to report-only when explicitly switched off", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const value of ["0", "false", "off", " OFF "]) {
      vi.stubEnv("CSP_ENFORCE", value);
      expect(cspHeaderName()).toBe("Content-Security-Policy-Report-Only");
    }
  });
});
