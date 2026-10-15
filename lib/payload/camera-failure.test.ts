import { describe, expect, it } from "vitest";
import {
  describeCameraDiagnostic,
  describeCameraFailure,
  type CameraFailureInput,
} from "@/lib/payload/camera-failure";

/**
 * Camera failure copy.
 *
 * The bug these exist for: `getUserMedia` reports "this site is blocked" and
 * "the operating system is blocking your browser" as the same error, and the copy
 * only described the first. A macOS user whose browser was allowed and whose
 * system setting was not was told to change a setting that was already correct —
 * so the one thing these tests must prove is that the two are told apart, and
 * that neither case gives advice that cannot help it.
 */

/** Everything as it looks on a working page, so each test changes only its cause. */
function failure(overrides: Partial<CameraFailureInput>): CameraFailureInput {
  return {
    name: "NotAllowedError",
    permission: "granted",
    secureContext: true,
    hasCameraApi: true,
    platform: "MacIntel",
    ...overrides,
  };
}

describe("describeCameraFailure", () => {
  describe("when access was refused, and who refused it", () => {
    it("blames the system when the browser still reports the camera as granted", () => {
      const copy = describeCameraFailure(failure({ permission: "granted" }));

      expect(copy.code).toBe("refused-by-system");
      expect(copy.title).toContain("macOS");
      expect(copy.detail).toContain(
        "System Settings → Privacy & Security → Camera",
      );
      // The part that makes it a fix rather than advice: the permission only
      // reaches a browser that starts after it was granted.
      expect(copy.detail).toContain("quit the browser completely and reopen it");
    });

    it("says the same thing on Windows, naming Windows's settings", () => {
      const copy = describeCameraFailure(
        failure({ permission: "granted", platform: "Win32" }),
      );

      expect(copy.title).toContain("Windows");
      expect(copy.detail).toContain("Settings → Privacy & security → Camera");
      expect(copy.detail).not.toContain("System Settings");
    });

    it("falls back to a generic system when the platform is unknown", () => {
      const copy = describeCameraFailure(
        failure({ permission: "granted", platform: "" }),
      );

      expect(copy.title).toContain("your system");
      expect(copy.detail).toContain("privacy settings for the browser");
    });

    /**
     * A granted site that can see no cameras at all is the signature of the
     * system hiding the hardware — macOS does that to an application it has not
     * been given the camera — and it points at a different setting from every
     * other refusal, so it must not share their message.
     */
    it("says the system is hiding the camera when none is visible", () => {
      const hidden = describeCameraFailure(
        failure({ permission: "granted", cameraCount: 0 }),
      );
      const refused = describeCameraFailure(
        failure({ permission: "granted", cameraCount: 1 }),
      );

      expect(hidden.code).toBe("no-camera-visible");
      expect(hidden.title).toContain("macOS");
      expect(hidden.title).toContain("a single camera");
      // The distinction that makes it useful: this is the system's setting, not
      // the site's.
      expect(hidden.detail).toContain(
        "the system's privacy setting rather than this site's",
      );
      expect(hidden.title).not.toBe(refused.title);
      expect(refused.code).toBe("refused-by-system");
    });

    it("says the same thing when the browser will not answer about cameras", () => {
      const silent = describeCameraFailure(
        failure({ permission: "granted", cameraCount: null }),
      );

      expect(silent.code).toBe("refused-by-system");
    });

    it("blames the site when the browser reports the camera as denied", () => {
      const copy = describeCameraFailure(failure({ permission: "denied" }));

      expect(copy.code).toBe("refused-by-site");
      expect(copy.title).toBe(
        "This site is blocked from the camera in this browser.",
      );
      // Chrome stores the camera grant per exact origin, so the advice has to say
      // that a near-miss address is a different site.
      expect(copy.detail).toContain("127.0.0.1 instead of localhost");
    });

    /**
     * Denied, and no camera in sight either. A browser blocking one site can still
     * list cameras it will not hand over — seeing none means the system has not
     * given the hardware to the browser at all, so "allow this site" alone would
     * leave the user in front of a camera that still cannot start.
     */
    it("names both settings when the site is blocked and no camera is visible", () => {
      const copy = describeCameraFailure(
        failure({ permission: "denied", cameraCount: 0 }),
      );

      expect(copy.code).toBe("denied-and-no-camera");
      expect(copy.detail).toContain("padlock");
      expect(copy.detail).toContain(
        "System Settings → Privacy & Security → Camera",
      );
      expect(copy.detail).toContain("quit the browser completely");
      expect(copy.title).not.toBe(
        describeCameraFailure(failure({ permission: "denied" })).title,
      );
    });

    it("does not blame the system when the camera count went unanswered", () => {
      // Null means the browser would not say. An unanswered question is not
      // evidence, so the copy stays with the setting it does know about.
      expect(
        describeCameraFailure(
          failure({ permission: "denied", cameraCount: null }),
        ).code,
      ).toBe("refused-by-site");
    });

    /**
     * The case that looks like a lie: an embedded page is given no camera unless
     * the page around it asked for one, and it reports the same refusal as a
     * blocked site. Every setting the user can find says "allow" — the site's, the
     * browser's, the system's — because permission was never this page's to give.
     */
    it("blames the page around it when a policy denies the camera", () => {
      const copy = describeCameraFailure(
        failure({
          permission: "denied",
          embedded: true,
          policyAllowsCamera: false,
          url: "http://localhost:3000/payload",
        }),
      );

      expect(copy.code).toBe("refused-by-frame-policy");
      expect(copy.title).toContain("inside another page");
      expect(copy.detail).toContain("normal browser tab");
      // The address to open, because a framed page cannot get the camera however
      // the settings are set — the way out is another tab, and this is which one.
      expect(copy.detail).toContain("http://localhost:3000/payload");
      // It must not send anyone to a site or system setting: none of them can
      // change a policy that belongs to the outer page.
      expect(copy.detail).not.toContain("padlock");
      expect(copy.detail).not.toContain("System Settings");
    });

    it("hedges when it is framed but the policy will not answer", () => {
      const copy = describeCameraFailure(
        failure({ permission: "denied", embedded: true, policyAllowsCamera: null }),
      );

      // Framed, but not proven to be the policy's doing: say so as a possibility
      // rather than as the cause.
      expect(copy.code).toBe("refused-in-frame");
      expect(copy.title).toContain("may be why");
    });

    it("does not blame the frame when the policy allows the camera", () => {
      // Embedded, but the outer page did ask for the camera — so the frame is not
      // the answer, and the ordinary refusal message applies.
      expect(
        describeCameraFailure(
          failure({
            permission: "denied",
            embedded: true,
            policyAllowsCamera: true,
          }),
        ).code,
      ).toBe("refused-by-site");
    });

    it("keeps the frame out of it when the page is not embedded", () => {
      expect(
        describeCameraFailure(
          failure({ permission: "denied", embedded: false }),
        ).code,
      ).toBe("refused-by-site");
    });

    /**
     * The shape this actually arrived in: a page that is not framed, whose own
     * response headers deny it the camera. The browser reports it as `denied` and
     * `NotAllowedError`, so it reads as "this site is blocked" — and the site's
     * setting, the browser's camera preview and the system setting all say the
     * opposite, because the policy is one layer above every permission.
     */
    it("names the page's own policy when the headers deny the camera", () => {
      const copy = describeCameraFailure(
        failure({
          permission: "denied",
          embedded: false,
          policyAllowsCamera: false,
          cameraCount: 1,
        }),
      );

      expect(copy.code).toBe("refused-by-policy");
      expect(copy.title).toContain("refuse it the camera");
      expect(copy.detail).toContain("overrules every permission");
      // Where to fix it, since no browser setting can.
      expect(copy.detail).toContain("Permissions-Policy");
      expect(copy.detail).toContain("camera=(self)");
      // And it must not send anyone to a setting that cannot help.
      expect(copy.detail).not.toContain("padlock");
      expect(copy.detail).not.toContain("System Settings");
    });

    it("still blames the frame when the page is both framed and denied by policy", () => {
      // Two causes are true at once; the outer page is the one to act on, because
      // opening a normal tab also escapes whatever policy the frame carries.
      expect(
        describeCameraFailure(
          failure({
            permission: "denied",
            embedded: true,
            policyAllowsCamera: false,
          }),
        ).code,
      ).toBe("refused-by-frame-policy");
    });

    it("does not pretend to know when the browser will not say", () => {
      const prompted = describeCameraFailure(failure({ permission: "prompt" }));
      const unknown = describeCameraFailure(failure({ permission: "unknown" }));

      expect(prompted.code).toBe("refused-without-prompt");
      expect(unknown.code).toBe("refused-unknown");
      // Both still name both possibilities, because either could be the cause.
      expect(prompted.detail).toContain("padlock");
      // The platform is known here, so the system path is named exactly rather
      // than gestured at.
      expect(unknown.detail).toContain(
        "System Settings → Privacy & Security → Camera",
      );
    });

    it("treats a SecurityError as the same refusal", () => {
      expect(describeCameraFailure(failure({ name: "SecurityError" })).code).toBe(
        "refused-by-system",
      );
    });

    /**
     * The regression that prompted all of this: the old copy was one sentence
     * about browser settings, and was shown even to someone whose browser setting
     * was already correct.
     */
    it("never sends someone to a setting that is already correct", () => {
      const copy = describeCameraFailure(failure({ permission: "granted" }));

      expect(copy.detail).not.toContain("padlock");
      expect(copy.detail).not.toContain("address bar");
      expect(copy.title).not.toContain("allow the camera for this site");
    });
  });

  describe("when the camera itself is the problem", () => {
    it("separates 'no camera here' from 'no camera of that kind'", () => {
      const missing = describeCameraFailure(failure({ name: "NotFoundError" }));
      const constrained = describeCameraFailure(
        failure({ name: "OverconstrainedError" }),
      );

      expect(missing.code).toBe("no-camera");
      expect(constrained.code).toBe("no-such-camera");
      // A laptop has one camera and it is not the one the scanner prefers, so
      // these must not be the same message.
      expect(missing.title).not.toBe(constrained.title);
    });

    it("says another app has it, for the error that means exactly that", () => {
      const copy = describeCameraFailure(failure({ name: "NotReadableError" }));

      expect(copy.code).toBe("camera-busy");
      expect(copy.detail).toContain("Try again");
    });

    it("asks for a second attempt when the camera aborted", () => {
      expect(describeCameraFailure(failure({ name: "AbortError" })).code).toBe(
        "aborted",
      );
    });

    it("keeps the browser's own words when the failure is unrecognised", () => {
      // An unfamiliar name is the interesting one: it has to survive into the
      // message, or a failure report cannot say what happened.
      const copy = describeCameraFailure(
        failure({ name: "SomeFutureError", permission: "unknown" }),
      );

      expect(copy.code).toBe("SomeFutureError");
      expect(copy.title).toBe("The camera could not be started.");
    });
  });

  describe("when the page or the browser cannot do it at all", () => {
    it("distinguishes a browser with no camera API from a refusal", () => {
      const copy = describeCameraFailure(failure({ hasCameraApi: false }));

      expect(copy.code).toBe("no-camera-api");
      expect(copy.title).toContain("will not hand a web page the camera");
    });

    it("names the secure-page requirement before anything else", () => {
      const copy = describeCameraFailure(
        failure({ secureContext: false, name: "" }),
      );

      expect(copy.code).toBe("insecure-origin");
      expect(copy.detail).toContain("https");
    });

    it("reports a stream that arrived but would not play as its own case", () => {
      const copy = describeCameraFailure(failure({ playback: true }));

      expect(copy.code).toBe("playback-failed");
      // Access was fine, so this must not read as a permission problem.
      expect(copy.title).not.toContain("refused");
    });
  });

  describe("describeCameraDiagnostic", () => {
    /**
     * The bug this guards: the line was an object literal, and it printed as `{}`
     * in the console it exists for — every field present, none of them readable,
     * in the one situation where somebody is trying to read them.
     */
    it("produces a string, so it cannot print as an empty object", () => {
      const line = describeCameraDiagnostic({
        ...failure({ permission: "denied", cameraCount: 0 }),
        origin: "http://localhost:3000",
        stage: "request",
        code: "denied-and-no-camera",
      });

      expect(typeof line).toBe("string");
      expect(line).toContain("[payload/scanner]");
    });

    it("names which site the browser is judging", () => {
      // "This site is blocked" is useless without this: an allow that is correct
      // for a different port or host looks exactly the same from inside the page.
      const line = describeCameraDiagnostic({
        ...failure({ permission: "denied" }),
        origin: "http://127.0.0.1:3000",
        stage: "request",
        code: "refused-by-site",
      });

      expect(line).toContain("origin=http://127.0.0.1:3000");
      expect(line).toContain("permission=denied");
      expect(line).toContain("name=NotAllowedError");
      expect(line).toContain("code=refused-by-site");
    });

    it("says what it does not know rather than guessing", () => {
      const line = describeCameraDiagnostic({
        ...failure({ name: "", cameraCount: null }),
        origin: "http://localhost:3000",
        stage: "play",
        code: "playback-failed",
      });

      expect(line).toContain("cameras=unknown");
      expect(line).toContain("name=none");
      expect(line).toContain("stage=play");
      expect(line).not.toContain("undefined");
    });

    it("reports a camera count of zero as a fact, not as unknown", () => {
      const line = describeCameraDiagnostic({
        ...failure({ cameraCount: 0 }),
        origin: "http://localhost:3000",
        stage: "request",
        code: "no-camera-visible",
      });

      expect(line).toContain("cameras=0");
    });

    it("says whether the page is framed, and what the policy says", () => {
      // The pair that answers "all my settings are right, so why is it refusing?"
      const framed = describeCameraDiagnostic({
        ...failure({ embedded: true, policyAllowsCamera: false }),
        origin: "http://localhost:3000",
        stage: "request",
        code: "refused-by-frame-policy",
      });
      const plain = describeCameraDiagnostic({
        ...failure({ embedded: false, policyAllowsCamera: true }),
        origin: "http://localhost:3000",
        stage: "request",
        code: "refused-by-site",
      });

      expect(framed).toContain("frame=true");
      expect(framed).toContain("policy=false");
      expect(plain).toContain("frame=false");
      expect(plain).toContain("policy=true");
    });
  });

  it("always leaves something to try next", () => {
    const inputs: CameraFailureInput[] = [
      failure({}),
      failure({ permission: "denied" }),
      failure({ permission: "prompt" }),
      failure({ permission: "unknown" }),
      failure({ name: "NotFoundError" }),
      failure({ name: "OverconstrainedError" }),
      failure({ name: "NotReadableError" }),
      failure({ name: "AbortError" }),
      failure({ hasCameraApi: false }),
      failure({ secureContext: false }),
      failure({ playback: true }),
      failure({ name: "SomethingElse" }),
    ];

    for (const input of inputs) {
      const copy = describeCameraFailure(input);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
      expect(copy.code.length).toBeGreaterThan(0);
    }
  });
});
