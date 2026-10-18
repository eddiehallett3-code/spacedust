"use client";

/**
 * The four interface sounds, and the rules they play by.
 *
 * Deliberately a module, not a React context: the events that matter here happen
 * inside hooks and dialogs that already sit under every provider in the app, and
 * a context would only add a way for a subtree to end up outside it. The players
 * are created lazily and cached, so a sound that never fires costs nothing.
 *
 * Three rules, each of them a consequence of how browsers and people behave:
 *
 *  - **Nothing plays before a gesture, and a gesture is not enough forever.**
 *    Autoplay policy blocks playback until the page has been activated, and a
 *    transaction confirmation often lands after the wallet app took the user
 *    away from the tab. The first pointer/key gesture therefore *unlocks* each
 *    element with a muted play, and a refused sound is retried when the tab
 *    becomes visible again — not only on the next click.
 *  - **Muting is remembered.** `localStorage`, because a preference that resets
 *    on navigation is not a preference. Storage can throw (private mode, blocked
 *    cookies), and the fallback is sound on rather than off: failing to read a
 *    preference must not look like the user chose silence.
 *  - **A flow with problems warns, it does not celebrate.** Seven sends out of
 *    eight is neither success nor failure, and the tone says so before the copy
 *    does.
 */
export type SoundName = "success" | "error" | "warning" | "popup";

/**
 * Where each sound lives.
 *
 * `public/`, because that is the only directory Next serves at the site root. A
 * `sounds/` folder at the project root is compiled into nothing and 404s at
 * runtime — silently, since a missing `<audio>` source is not an error anyone
 * sees. `lib/ui/sound.test.ts` checks that every file named here exists.
 */
export const SOUND_FILES: Record<SoundName, string> = {
  success: "/sounds/success.mp3",
  error: "/sounds/error.mp3",
  warning: "/sounds/warning.mp3",
  popup: "/sounds/pop-up.mp3",
};

/**
 * Each at its own level, because the files are not recorded at the same one.
 *
 * Measured peaks: success 0.84, warning 0.97, error 0.17, popup 0.17 — the last
 * two are roughly 14 dB quieter than the first two straight out of the encoder.
 * Matching the multipliers would have kept that gap, so `error` and `popup` are
 * pushed up to close it. `popup` still ends up the quietest on purpose: it fires
 * far more often than a transaction lands, and a pop on every menu is the first
 * thing anyone turns off.
 */
const SOUND_VOLUMES: Record<SoundName, number> = {
  success: 0.55,
  error: 0.9,
  warning: 0.45,
  popup: 0.6,
};

const MUTE_KEY = "spacedust:sound-muted";

/** Null until read, so the common path touches storage once per page. */
let muted: boolean | null = null;
let players: Map<SoundName, HTMLAudioElement> | null = null;

export function soundUrl(name: SoundName): string {
  return SOUND_FILES[name];
}

export function isSoundMuted(): boolean {
  if (muted !== null) return muted;
  muted = readMuted();
  return muted;
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Applies for this page; it just will not survive a reload.
  }
}

function audio(name: SoundName): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof window.Audio !== "function") {
    return null;
  }
  players ??= new Map();
  const existing = players.get(name);
  if (existing) return existing;
  try {
    const player = new window.Audio(SOUND_FILES[name]);
    player.preload = "auto";
    player.volume = SOUND_VOLUMES[name];
    players.set(name, player);
    return player;
  } catch {
    return null;
  }
}

/** Sounds refused by the browser, with when they were refused. */
const blocked = new Map<SoundName, number>();

/** Players whose muted unlock play has not finished yet. */
const priming = new Set<SoundName>();

/** Players whose source has already been asked to load. */
const preloaded = new Set<SoundName>();

/**
 * How long a refused sound stays worth retrying.
 *
 * Long enough to cover a wallet-app switch: confirmations often land while the
 * tab is hidden, and the user can take more than twenty seconds to come back.
 * A minute still feels tied to the action; anything longer is noise.
 */
const RETRY_WINDOW_MS = 60_000;

let retryBound = false;

function retryBlocked(force = false): void {
  const now = Date.now();
  for (const [name, refusedAt] of blocked) {
    blocked.delete(name);
    if (now - refusedAt > RETRY_WINDOW_MS) continue;
    if (force) playNow(name);
    else playSound(name);
  }
}

/**
 * Play the refused sounds on the next interaction.
 *
 * A browser refuses audio in a hidden tab or without a gesture, and the refusal
 * is a rejected promise — so a confirmation that lands while the user is in the
 * wallet app would otherwise be lost with no trace. The next click used to be
 * the only retry; returning to the tab is the moment that actually matters,
 * because the click on "Done" may never come.
 */
function bindRetry(): void {
  if (retryBound || typeof window === "undefined") return;
  retryBound = true;
  const gestureRetry = () => retryBlocked(true);
  window.addEventListener("pointerdown", gestureRetry, { passive: true });
  window.addEventListener("keydown", gestureRetry);
  window.addEventListener("focus", () => retryBlocked(false));
  window.addEventListener("pageshow", () => retryBlocked(false));
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) retryBlocked(false);
    });
  }
}

/**
 * Play one sound, restarting it if it is already going.
 *
 * Restarting rather than layering: a second success a moment after the first is
 * a second event, and two overlapping copies of the same mp3 sound like a
 * stutter.
 */
export function playSound(name: SoundName): void {
  if (typeof window === "undefined" || isSoundMuted()) return;

  // A hidden tab may let `play()` resolve and then swallow the audio before the
  // user returns. Queue it instead; `visibilitychange` is the moment the user
  // can actually hear it. A gesture bypasses this through `playNow`.
  if (typeof document !== "undefined" && document.hidden) {
    blocked.set(name, Date.now());
    bindRetry();
    return;
  }

  playNow(name);
}

/**
 * Play immediately, even if `document.hidden` is stale.
 *
 * A gesture is authoritative: the button was pressed on a visible page, even
 * if the WebView has not flipped `hidden` yet. Without this, the Void's "Done"
 * click re-queued the cue and only the next visibility event played it, seconds
 * after the click.
 */
function playNow(name: SoundName): void {
  if (typeof window === "undefined" || isSoundMuted()) return;
  const player = audio(name);
  if (!player) return;

  // A real cue arriving while the muted unlock is still pending takes over.
  // Cancel the unlock first, or its `pause()` would stop this play and its
  // `muted = false` would land after the cue had already started silently.
  if (priming.delete(name)) {
    try {
      player.pause();
    } catch {
      // Nothing to pause yet.
    }
    player.muted = false;
  }

  try {
    // Rewind only what has metadata. Assigning `currentTime` before the first
    // `loadedmetadata` throws `InvalidStateError` in some browsers — and because
    // the assignment came first, the throw skipped `play()` entirely and the
    // sound was lost with no error anywhere.
    if (player.readyState > 0) player.currentTime = 0;

    const started = player.play();
    if (started && typeof started.catch === "function") {
      started.catch(() => {
        blocked.set(name, Date.now());
        bindRetry();
        console.debug(
          `[spacedust] ${name} sound was blocked; it will play on the next input`,
        );
      });
    }
  } catch (error) {
    // Some embedded browsers throw synchronously instead of rejecting.
    blocked.set(name, Date.now());
    bindRetry();
    console.debug("[spacedust] sound failed:", error);
  }
}

/** Whether a first gesture has already unlocked the players. */
let unlocked = false;

/**
 * Fetch and decode the files before they are needed.
 *
 * Called on mount for the success cue and on the first gesture for the rest, so
 * a transaction that lands a second after the click is not waiting on a
 * download. This only fetches; it never plays.
 */
export function preloadSounds(
  names: SoundName[] = Object.keys(SOUND_FILES) as SoundName[],
): void {
  if (typeof window === "undefined") return;
  for (const name of names) {
    if (preloaded.has(name)) continue;
    const player = audio(name);
    if (!player) continue;
    preloaded.add(name);
    try {
      player.load();
    } catch {
      // The first play will try again.
      preloaded.delete(name);
    }
  }
}

/**
 * Unlock every player inside the first user gesture.
 *
 * Loading is not permission. Safari — and the webview in some wallet apps —
 * grants playback per element, and only while the page is handling a gesture.
 * A muted `play()` is the smallest thing that qualifies; pausing it immediately
 * leaves the element allowed, with no sound. If a real cue starts while the
 * muted play is still pending, `playSound` cancels the unlock first, so the cue
 * is not swallowed by the element still being muted.
 */
function unlockPlayers(): void {
  if (unlocked) return;
  unlocked = true;

  for (const name of Object.keys(SOUND_FILES) as SoundName[]) {
    const player = audio(name);
    if (!player) continue;

    const release = () => {
      // A real cue took over and already cancelled the unlock.
      if (!priming.has(name)) return;
      priming.delete(name);
      try {
        player.pause();
        player.currentTime = 0;
      } catch {
        // A player that never reached metadata has nothing to rewind.
      }
      player.muted = false;
    };

    try {
      player.muted = true;
      priming.add(name);
      const started = player.play();
      if (started && typeof started.then === "function") {
        started.then(release, () => {
          if (!priming.delete(name)) return;
          player.muted = false;
        });
      } else {
        release();
      }
    } catch {
      priming.delete(name);
      player.muted = false;
    }
  }
}

/**
 * Warm and unlock all four sounds on the first gesture.
 *
 * Kept as the single entry point `app/providers.tsx` calls: preload is cheap
 * once a visitor has shown intent, and the muted play is what makes the later
 * success cue work in Safari and embedded wallet browsers.
 */
export function primeSounds(): void {
  if (typeof window === "undefined" || unlocked) return;
  preloadSounds();
  unlockPlayers();
}

/**
 * Play the sound a flow has earned, at the moment it has earned it.
 *
 * Called from the hook that owns the flow, immediately before the state that
 * ends it, not from an effect watching for that state. The difference is not
 * style: an effect can be skipped when the final render is coalesced with a
 * reset, or when the component that owns it unmounts on the same tick — and the
 * one moment the user has been waiting for is the one that goes silent. The
 * patch is the event; the sound belongs beside it.
 *
 * `problems` is the number of items that did not come through. Seven sends out
 * of eight gets the warning tone, which is the same distinction the result
 * screens draw in words.
 */
export function playFlowSound(phase: "success" | "error", problems = 0): void {
  if (phase === "error") {
    playSound("error");
    return;
  }
  playSound(problems > 0 ? "warning" : "success");
}
