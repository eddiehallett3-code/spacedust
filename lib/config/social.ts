/**
 * The X account, in the two forms different callers need.
 *
 * Configured once in `NEXT_PUBLIC_TWITTER_URL`, because three places need to
 * point at the same account and none of them may disagree about which account
 * that is: the footer link, the anti-phishing line on the security page, and the
 * `twitter:site` attribution on the preview card. The handle is *derived* rather
 * than typed a second time, for the reason the page that shows it exists — a
 * security page naming the wrong account is worse than one naming none.
 *
 * Returns null rather than a guess when nothing usable is configured. A link to
 * a mistyped profile, or a card attributing an account that is not ours, is a
 * worse failure than an absent link, so every caller omits the link instead.
 */
export function getTwitterUrl(): string | null {
  return parse()?.url ?? null;
}

/** The account as `@handle`, for text that names it rather than links to it. */
export function getTwitterHandle(): string | null {
  const handle = parse()?.handle;
  return handle ? `@${handle}` : null;
}

/**
 * The public repository, when one is configured.
 *
 * Published as "Source" in the footer, which makes it the link somebody clicks
 * when they want to check that the app is what it claims to be — so it gets the
 * same treatment as the X account: only a `github.com` URL with an owner *and* a
 * repository is accepted, and anything else yields no link at all. A "Source"
 * link to a host we did not choose is worse than no link, because it borrows the
 * credibility of the label.
 */
export function getGitHubUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_GITHUB_URL?.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (!/(^|\.)github\.com$/.test(parsed.hostname)) return null;

    // `github.com` and `github.com/<owner>` are not source, they are a landing
    // page and a profile. Two segments is the shortest thing that is a repository.
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;

    return `${parsed.origin}/${segments.slice(0, 2).join("/")}`;
  } catch {
    return null;
  }
}

function parse(): { url: string; handle: string | null } | null {
  const raw = process.env.NEXT_PUBLIC_TWITTER_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    // Restricted to the two real hosts, and not merely because of typos: this
    // value is published as *our* account on every page, so anything else is
    // refused outright rather than linked to.
    if (!/(^|\.)(x|twitter)\.com$/.test(parsed.hostname)) return null;
    const handle = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    return { url: parsed.toString(), handle };
  } catch {
    return null;
  }
}
