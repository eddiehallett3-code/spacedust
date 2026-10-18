import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGitHubUrl, getTwitterHandle, getTwitterUrl } from "@/lib/config/social";

/**
 * The account we tell people is ours.
 *
 * Three places publish this — the footer link, the security page's anti-phishing
 * line, and the `twitter:site` attribution — and every one of them is read by
 * someone working out whether a message is really from us. So these tests are
 * mostly about the refusals: a value that is not an X profile has to yield
 * nothing at all, because a link to a mistyped or hostile profile, presented as
 * our own account on our own security page, is worse than having no link.
 *
 * The module reads the environment per call rather than at import, which is what
 * makes this testable at all — the repo's other env readers (`lib/config/site.ts`,
 * `public-env.ts`) are deliberately the same shape.
 */

const KEY = "NEXT_PUBLIC_TWITTER_URL";
const saved = process.env[KEY];
beforeEach(() => {
  delete process.env[KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe("getTwitterUrl / getTwitterHandle", () => {
  it("names and links the account from the configured profile", () => {
    process.env[KEY] = "https://x.com/spacedustpro";

    expect(getTwitterUrl()).toBe("https://x.com/spacedustpro");
    expect(getTwitterHandle()).toBe("@spacedustpro");
  });

  it("reads the first path segment only, so a status link still names the account", () => {
    // Someone pasting a link to a post is the likeliest way this value gets set
    // wrong, and the handle is still the handle.
    process.env[KEY] = "https://x.com/spacedustpro/status/1234567890";

    expect(getTwitterHandle()).toBe("@spacedustpro");
  });

  it("accepts the old host", () => {
    process.env[KEY] = "https://twitter.com/spacedustpro";

    expect(getTwitterHandle()).toBe("@spacedustpro");
  });

  it("refuses a host that is not X, however plausible it looks", () => {
    // A lookalike domain, and the real one embedded in a longer host: the regex
    // has to anchor at the end, or the second of these would pass.
    for (const url of [
      "https://example.com/spacedustpro",
      "https://x.com.evil.example/spacedustpro",
    ]) {
      process.env[KEY] = url;

      expect(getTwitterUrl()).toBeNull();
      expect(getTwitterHandle()).toBeNull();
    }
  });

  it("returns nothing when unset, blank or unparseable", () => {
    expect(getTwitterUrl()).toBeNull();
    expect(getTwitterHandle()).toBeNull();

    for (const value of ["", "   ", "not a url"]) {
      process.env[KEY] = value;

      expect(getTwitterUrl()).toBeNull();
      expect(getTwitterHandle()).toBeNull();
    }
  });

  it("still links the profile when there is no handle to read", () => {
    // A bare domain is a valid profile URL and not a valid handle. The URL is
    // still worth having; the sentence that names the account is not, so the
    // caller gets null and omits it rather than printing "@null".
    process.env[KEY] = "https://x.com";

    expect(getTwitterUrl()).toBe("https://x.com/");
    expect(getTwitterHandle()).toBeNull();
  });

/**
 * "Source" is a claim, not a decoration.
 *
 * The footer labels this link Source, so it is read as: this is the code that
 * built the page. A URL that is not a repository — a profile, a typo, a host that
 * merely ends in `github.com` — has to yield nothing rather than a label pointing
 * somewhere we did not choose.
 */
describe("getGitHubUrl", () => {
  const GITHUB = "NEXT_PUBLIC_GITHUB_URL";
  const previous = process.env[GITHUB];

  beforeEach(() => {
    delete process.env[GITHUB];
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[GITHUB];
    else process.env[GITHUB] = previous;
  });

  it("links the repository", () => {
    process.env[GITHUB] = "https://github.com/eddiehallett3-code/spacedust";

    expect(getGitHubUrl()).toBe(
      "https://github.com/eddiehallett3-code/spacedust",
    );
  });

  it("drops a trailing slash, a branch path and a query", () => {
    process.env[GITHUB] =
      "https://github.com/owner/repo/tree/main/src?tab=readme#top";

    expect(getGitHubUrl()).toBe("https://github.com/owner/repo");
  });

  it("refuses a host that is not github.com", () => {
    for (const value of [
      "https://gitlab.com/owner/repo",
      "https://github.com.evil.test/owner/repo",
      "https://notgithub.com/owner/repo",
      "https://github.com@evil.test/owner/repo",
    ]) {
      process.env[GITHUB] = value;
      expect(getGitHubUrl(), value).toBeNull();
    }
  });

  it("refuses a URL that is not a repository", () => {
    for (const value of [
      "https://github.com",
      "https://github.com/owner",
      "https://github.com/",
    ]) {
      process.env[GITHUB] = value;
      expect(getGitHubUrl(), value).toBeNull();
    }
  });

  it("is null when unset or blank", () => {
    expect(getGitHubUrl()).toBeNull();

    process.env[GITHUB] = "   ";
    expect(getGitHubUrl()).toBeNull();
  });
});

});
