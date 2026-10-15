/**
 * What to say when the camera will not start.
 *
 * WHY THIS IS NOT ONE SENTENCE. `getUserMedia` reports two very different
 * failures with the same name, `NotAllowedError`, and gives no field that tells
 * them apart: *this site is blocked by the browser* and *the operating system is
 * blocking the browser itself*. Both are "Permission denied".
 *
 * The old copy named only the first — "allow the camera for this site in the
 * browser's settings" — so a user whose browser *was* allowed and whose macOS was
 * not was sent to a setting that was already correct, with nothing left to try.
 * That is worse than no message, because it looks like an answer.
 *
 * The two cases can be told apart after the fact. If the browser reports the
 * camera as `granted` and `getUserMedia` still refuses, then the refusal came
 * from outside the browser, and the fix is in the system's privacy settings —
 * which on macOS also requires *reopening* the browser, because the permission is
 * only handed over to a browser that starts after it is granted.
 *
 * The copy lives here rather than in the component for the same reason the burn
 * result copy lives in `lib/sweep`: it is a function of what happened, not of
 * where it is rendered, and it can be tested without a camera.
 */

/** What the browser says about the camera, when it will say anything at all. */
export type CameraPermission = "granted" | "denied" | "prompt" | "unknown";

export interface CameraFailureInput {
  /** The `DOMException` name, or `""` when there was no error to read. */
  name: string;
  /** The browser's own answer from the Permissions API. */
  permission: CameraPermission;
  /** False on a page where the camera API cannot exist — plain http, etc. */
  secureContext: boolean;
  /** False when the browser has no `getUserMedia` to call at all. */
  hasCameraApi: boolean;
  /**
   * How many cameras the browser can see, or `null` if it will not say.
   *
   * A granted site that can see *none* is the signature of the system hiding the
   * hardware from the browser — which is what macOS does to an application it has
   * not been granted the camera — and it is the difference between "allow this
   * site" and "allow your browser", two settings in two different places.
   */
  cameraCount?: number | null;
  /**
   * True when this page is inside another page.
   *
   * A frame gets no camera unless the page around it asked for one, and it says so
   * with the same `NotAllowedError` as a blocked site — while the site's own
   * settings, and the browser's camera preview, both look completely correct.
   * Nothing the user can change in a site-settings pane affects it.
   */
  embedded?: boolean;
  /**
   * Whether the page is permitted to ask for the camera at all (`true`), denied
   * by a policy around it (`false`), or not answerable (`null`).
   */
  policyAllowsCamera?: boolean | null;
  /**
   * This page's own address, for the case where the way out is to open it
   * somewhere else. A framed page still knows where it is.
   */
  url?: string;
  /** True when the stream started but the preview would not play. */
  playback?: boolean;
  /** `navigator.platform`-ish, only to name the right settings window. */
  platform?: string;
}

export interface CameraFailureCopy {
  /** What happened. */
  title: string;
  /** What to do about it. */
  detail: string;
  /**
   * A short tag for the exact branch taken, shown in tiny type.
   *
   * A failure that does not make sense is the interesting one, and "it didn't
   * work" cannot be acted on from a screenshot. This is what makes a report
   * specific enough to reproduce.
   */
  code: string;
}

/** Where the camera failure will be reported, for the line that goes to a console. */
export interface CameraDiagnosticInput extends CameraFailureInput {
  /** `window.location.origin` — which site the browser thinks this is. */
  origin: string;
  /** Which half of start-up failed: asking, or playing. */
  stage: string;
  /** The branch the copy took, so the two lines agree. */
  code: string;
}

/**
 * The single line written to the console when the camera will not start.
 *
 * A string, deliberately. This was an object literal, and it rendered as `{}` in
 * the very console it exists for: every field present, none of them visible, in
 * the one situation where somebody is trying to read them. A string cannot do
 * that.
 *
 * The origin is in it because "this site is blocked" says nothing until you know
 * which site the browser is judging — the difference between a permission that is
 * wrong and a permission that is right for a *different* address.
 */
export function describeCameraDiagnostic(input: CameraDiagnosticInput): string {
  return [
    "[payload/scanner] the camera would not start —",
    `name=${input.name || "none"}`,
    `permission=${input.permission}`,
    `cameras=${input.cameraCount ?? "unknown"}`,
    `secure=${input.secureContext}`,
    `frame=${input.embedded ?? false}`,
    `policy=${input.policyAllowsCamera ?? "unknown"}`,
    `stage=${input.stage}`,
    `origin=${input.origin}`,
    `code=${input.code}`,
  ].join(" ");
}

/** The name of the place the system privacy settings live, per platform. */
function systemSettingsName(platform: string): string {
  const value = platform.toLowerCase();
  if (value.includes("mac")) return "macOS";
  if (value.includes("win")) return "Windows";
  if (value.includes("linux") || value.includes("x11")) return "your system";
  return "your system";
}

/** Where the camera switch is, per platform. Named exactly, not gestured at. */
function systemSettingsPath(platform: string): string {
  const value = platform.toLowerCase();
  if (value.includes("mac")) {
    return "System Settings → Privacy & Security → Camera";
  }
  if (value.includes("win")) {
    return "Settings → Privacy & security → Camera";
  }
  return "your system's privacy settings for the browser";
}


/**
 * Turn a camera failure into a sentence someone can act on.
 *
 * Ordered from the outside in: whether the camera can exist here at all, then
 * what the browser refused, then — where the refusal is ambiguous — what the
 * browser's own permission state says about who refused.
 */
export function describeCameraFailure(
  input: CameraFailureInput,
): CameraFailureCopy {
  if (!input.hasCameraApi) {
    return {
      title: "This browser will not hand a web page the camera.",
      code: "no-camera-api",
      detail:
        "Pasting the address instead works everywhere, and needs nothing from the browser.",
    };
  }

  if (!input.secureContext) {
    return {
      title: "A camera is only available on a secure page.",
      code: "insecure-origin",
      detail:
        "Open this page over https — or on localhost, which browsers accept while developing — and the scanner will ask for the camera.",
    };
  }

  // The stream arrived but the picture did not: separate from access, because the
  // fix is different and the old copy blamed a permission that was fine.
  if (input.playback) {
    return {
      title: "The camera started, but its picture would not play here.",
      code: "playback-failed",
      detail:
        "Closing and reopening this dialog usually clears it; if it does not, this browser is refusing to play the camera's video, and pasting the address works everywhere.",
    };
  }

  switch (input.name) {
    case "NotAllowedError":
    case "SecurityError": {
      const platform = input.platform ?? "";
      const system = systemSettingsName(platform);
      const path = systemSettingsPath(platform);

      // A page inside another page is given no camera unless the page around it
      // asked for one. This is the case that most looks like a lie: the site's own
      // settings can read "Allow", the browser's camera preview can work, and the
      // request is still refused — because permission was never this page's to
      // give, so every setting the user checks will say the right thing.
      // A policy can deny this page the camera without the page being embedded:
      // the page's own response headers can do it. Checked first because a policy
      // overrules every permission, so any message about a site or system setting
      // would be advice that cannot work — which is exactly how a
      // `Permissions-Policy: camera=()` header reads as "this site is blocked"
      // while the site's own setting, and the browser's camera preview, both say
      // otherwise.
      if (input.policyAllowsCamera === false) {
        if (input.embedded) {
          return {
            title:
              "This page is inside another page, and the page around it has not allowed the camera.",
            code: "refused-by-frame-policy",
            detail: `An embedded view — a preview pane inside an editor, or a page showing this app in a frame — is given no camera unless the page around it asks for one, and this one does not. Open ${input.url ?? "the same address"} in a normal browser tab, and it will ask properly.`,
          };
        }

        return {
          title: "This page tells the browser to refuse it the camera.",
          code: "refused-by-policy",
          detail:
            "A policy like that overrules every permission, which is why this site's own setting, and the browser's camera preview, can both look correct while the request fails. It is set where the page is served rather than in a browser setting — on this app it is the `Permissions-Policy` response header, which has to allow `camera=(self)`.",
        };
      }

      if (input.embedded && input.policyAllowsCamera !== true) {
        return {
          title: "This page is inside another page, which may be why the camera is refused.",
          code: "refused-in-frame",
          detail: `An embedded view is only given a camera if the page around it asks for one. Open ${input.url ?? "the same address"} in a normal browser tab, where the camera can be asked for directly.`,
        };
      }

      // The case the old single sentence could not express: the browser says the
      // site is allowed, so the hand that refused is the system's, not the
      // browser's.
      if (input.permission === "granted") {
        const reopen =
          "The camera is only handed over to a browser that starts after it is allowed, so reopening is part of the fix, not a suggestion.";

        if (input.cameraCount === 0) {
          return {
            title: `${system} is not showing the browser a single camera.`,
            code: "no-camera-visible",
            detail: `That is the system's privacy setting rather than this site's: open ${path} and switch on your browser, then quit the browser completely and reopen it. ${reopen}`,
          };
        }

        return {
          title: `The browser has this site allowed, so the refusal came from ${system}.`,
          code: "refused-by-system",
          detail: `Open ${path} and switch on your browser — then quit the browser completely and reopen it. ${reopen}`,
        };
      }

      if (input.permission === "denied") {
        // Denied *and* unable to see a single camera: the site permission is not
        // the whole story, because a browser that is merely blocking one site can
        // still list the cameras it is not allowed to use (that is how a page
        // offers a camera chooser before it has permission). Seeing none means the
        // system has not handed the hardware over either, so the message has to
        // name both settings — "allow this site" alone would leave the second one
        // wrong and the camera still dark.
        if (input.cameraCount === 0) {
          return {
            title: `This site is blocked from the camera, and the browser can see no camera at all.`,
            code: "denied-and-no-camera",
            detail: `Two settings have to agree, and one of them is not this site's: allow the camera here (the padlock icon in the address bar → Camera → Allow), and allow your browser the camera in ${path} — then quit the browser completely and reopen it, because the camera is only handed over to a browser that starts after it is allowed.`,
          };
        }

        return {
          title: "This site is blocked from the camera in this browser.",
          code: "refused-by-site",
          detail: `Open the padlock (or camera) icon in the address bar and allow it there — on ${system} this is a separate setting from the system one, and a site that was blocked stays blocked until it is changed. The permission is remembered per exact address, so a different port — or 127.0.0.1 instead of localhost — counts as a different site and asks again.`,
        };
      }

      // `prompt` or `unknown`: the refusal may come from a browser policy, an
      // enterprise setting, or an engine that will not answer the question.
      return {
        title: "The camera was refused without a prompt.",
        code:
          input.permission === "prompt"
            ? "refused-without-prompt"
            : "refused-unknown",
        detail: `Check the padlock menu for this site, and that the browser itself is allowed the camera in ${systemSettingsPath(platform)}. Pasting the address works everywhere.`,
      };
    }

    case "NotReadableError":
    case "TrackStartError":
      return {
        title: "The camera is there, but something else is using it.",
        code: "camera-busy",
        detail:
          "Close whatever has it open — a video call, or another tab of this page — and press Try again.",
      };

    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        title: "No camera was found on this device.",
        code: "no-camera",
        detail: "Pasting the address instead works everywhere.",
      };

    case "OverconstrainedError":
      return {
        title: "This device has no camera of the kind that was asked for.",
        code: "no-such-camera",
        detail:
          "The scanner prefers a rear-facing camera, which a laptop does not have. Pasting the address works everywhere.",
      };

    case "AbortError":
      return {
        title: "The camera stopped before it started.",
        code: "aborted",
        detail: "Press Try again — a second attempt usually works.",
      };

    default:
      return {
        title: "The camera could not be started.",
        code: input.name || "unknown",
        detail: "Pasting the address instead works everywhere.",
      };
  }
}
