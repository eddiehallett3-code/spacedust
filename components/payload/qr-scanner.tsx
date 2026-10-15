"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  describeCameraDiagnostic,
  describeCameraFailure,
  type CameraFailureCopy,
  type CameraPermission,
} from "@/lib/payload/camera-failure";
import { parseScannedDestination } from "@/lib/payload/destination";

/**
 * Scanning a recipient address with the phone's camera.
 *
 * WHY THIS EXISTS: typing a base58 address on a phone keyboard is the worst part
 * of sending anything, and addresses are exactly what wallets and explorers
 * already show as QR codes. Copying and pasting between two apps on a phone is
 * several taps and an app switch; pointing the camera at the code is one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: prove anything. A code is as easy to print as
 * a paste is to intercept, so a scanned address goes through the same checks a
 * typed one does — the grouping a person reads, and the test transfer if it is
 * switched on. Scanning fills the field; it does not skip a step.
 *
 * The camera is used locally and only while this dialog is open: frames go to a
 * canvas and a decoder, never to the network, and every track is stopped when the
 * dialog closes — which is what turns the camera light off. A camera left running
 * behind a closed dialog is indistinguishable from spyware.
 */

/** One decode attempt per 100ms. Every frame warms a phone for no gain. */
const DECODE_INTERVAL_MS = 100;

/** Frames are scaled to this width first: fewer pixels, same answer. */
const FRAME_WIDTH = 480;

/**
 * The `DOMException` name, or `""` when there was no error to read.
 *
 * A bare name is all the copy needs, and it survives being written to the console
 * in a bug report.
 */
function errorName(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name: unknown }).name);
  }
  return "";
}

/**
 * Ask the browser what it thinks of the camera.
 *
 * The one impure thing in the error path, and the one that makes the difference:
 * `getUserMedia` reports "this site is blocked" and "the operating system is
 * blocking the browser" with the same name and no field to tell them apart, so
 * only this question separates them. Without it the scanner can only offer advice
 * that is, half the time, about a setting that is already correct.
 *
 * Safari and Firefox reject an unknown permission name rather than answering, so
 * "unknown" is a normal answer here, not a failure.
 */
async function readCameraPermission(): Promise<CameraPermission> {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "camera" });
    return status.state;
  } catch {
    return "unknown";
  }
}

/**
 * True when this page is inside another page.
 *
 * A frame is given no camera unless the page around it asked for one, and it says
 * so with the same error a blocked site gives — while every setting the user can
 * find looks correct, because permission was never this page's to give.
 */
function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Reading `window.top` can itself throw across origins, which is a reliable
    // sign of being framed.
    return true;
  }
}

/** The bit of the policy API this needs, which the DOM typings do not carry. */
interface CameraPolicy {
  allowsFeature(feature: string): boolean;
}

/**
 * Whether this page is allowed to ask for the camera at all.
 *
 * `false` is decisive: a policy around this page denies the camera, so no site
 * setting can help. `null` means the browser did not answer, which is not
 * evidence either way.
 */
function policyAllowsCamera(): boolean | null {
  try {
    const document_ = document as Document & {
      permissionsPolicy?: CameraPolicy;
      featurePolicy?: CameraPolicy;
    };
    const policy = document_.permissionsPolicy ?? document_.featurePolicy;
    if (!policy?.allowsFeature) return null;
    return policy.allowsFeature("camera");
  } catch {
    return null;
  }
}

/** Only used to name the right settings window in the copy. */
function readPlatform(): string {
  return typeof navigator.platform === "string" ? navigator.platform : "";
}

/**
 * How many cameras the browser can see, or `null` if it will not say.
 *
 * Worth asking because "allow this site" and "allow your browser" are different
 * settings in different places, and the camera list separates them: an operating
 * system that has not granted the browser the camera shows it no cameras at all.
 */
async function countCameras(): Promise<number | null> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return null;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "videoinput").length;
  } catch {
    return null;
  }
}

/**
 * What the dialog says when the caller has not said otherwise.
 *
 * This is the Payload flow's wording, and it stays the default so that flow is
 * untouched. The read-only scan passes its own: it has no test transfer, and
 * "the test transfer still applies" would simply be untrue on that page.
 */
const DEFAULT_DESCRIPTION =
  "Point the camera at a wallet's receive code, a Solana Pay request, or an explorer link. Scanning fills the field — the address is still read back to you in groups, and the test transfer still applies if you have it switched on.";

export function QrScanner({
  open,
  onOpenChange,
  onScan,
  description = DEFAULT_DESCRIPTION,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Called with a validated address, once the code has been understood. */
  onScan: (address: string) => void;
  /** Override the dialog copy when the calling page has different rules. */
  description?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastTryRef = useRef(0);
  /**
   * The callback is held in a ref rather than being an effect dependency: the
   * caller passes an inline arrow, so depending on it would tear the camera down
   * and start it again on every render.
   */
  const scanRef = useRef(onScan);
  scanRef.current = onScan;

  const [status, setStatus] = useState<"starting" | "scanning" | "problem">(
    "starting",
  );
  const [problem, setProblem] = useState<CameraFailureCopy | null>(null);
  /** A code was read, but it was not an address. Scanning continues. */
  const [rejected, setRejected] = useState<string | null>(null);
  /**
   * Bumped by Try again. A camera that failed because a video call was open does
   * not need the dialog closed and reopened — it needs one more request.
   */
  const [attempt, setAttempt] = useState(0);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }

    let cancelled = false;
    setStatus("starting");
    setProblem(null);
    setRejected(null);

    // Fail with a sentence rather than a black rectangle. Both of these are
    // checked *before* asking for the camera, so nobody gets a permission prompt
    // that was never going to work.
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("problem");
      setProblem(
        describeCameraFailure({
          name: "",
          permission: "unknown",
          secureContext: window.isSecureContext,
          hasCameraApi: false,
        }),
      );
      return;
    }
    if (!window.isSecureContext) {
      setStatus("problem");
      setProblem(
        describeCameraFailure({
          name: "",
          permission: "unknown",
          secureContext: false,
          hasCameraApi: true,
        }),
      );
      return;
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    // Which half of the start-up failed. `getUserMedia` refusing and the preview
    // refusing to play are different problems with different fixes, and the error
    // alone cannot say which happened.
    let stage: "request" | "play" = "request";

    void (async () => {
      try {
        // The camera is asked for first, before anything else can sit in the path:
        // a permission prompt belongs as close to the click that opened this dialog
        // as it can be, and compiling the decoder takes a moment in development.
        const stream = await navigator.mediaDevices.getUserMedia({
          // The back camera: pointing the phone at someone's screen is the whole
          // use case, and the front one would be the wrong way round.
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        // Loaded on demand, by the same rule the Metaplex burn builders follow: a
        // user who never opens the scanner should never download a decoder. It is
        // about 130KB, which is not a cost to pay by default for a feature most
        // visits will not use.
        const { default: jsQR } = await import("jsqr");

        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        stage = "play";
        await video.play();
        setStatus("scanning");

        const tick = (now: number) => {
          if (cancelled) return;
          frameRef.current = requestAnimationFrame(tick);
          if (now - lastTryRef.current < DECODE_INTERVAL_MS) return;
          lastTryRef.current = now;

          const source = videoRef.current;
          if (!context || !source || source.videoWidth === 0) return;

          const scale = Math.min(1, FRAME_WIDTH / source.videoWidth);
          const width = Math.round(source.videoWidth * scale);
          const height = Math.round(source.videoHeight * scale);
          canvas.width = width;
          canvas.height = height;
          context.drawImage(source, 0, 0, width, height);

          const frame = context.getImageData(0, 0, width, height);
          const code = jsQR(frame.data, width, height, {
            inversionAttempts: "attemptBoth",
          });
          if (!code) return;

          const result = parseScannedDestination(code.data);
          if (!result.ok) {
            // Keep looking: the next code may be the right one, and stopping on
            // the first unreadable thing would make a wrong code feel fatal.
            setRejected(result.problem);
            return;
          }
          setRejected(null);
          scanRef.current(result.address);
        };

        frameRef.current = requestAnimationFrame(tick);
      } catch (error) {
        // Ask who refused before writing the message: "this site is blocked" and
        // "the system is blocking the browser" arrive as the same error, and the
        // browser's own answer is the only thing that separates them.
        // Both probes at once: neither depends on the other, and this runs in the
        // path where somebody is already waiting for an answer.
        const [permission, cameraCount] = await Promise.all([
          readCameraPermission(),
          countCameras(),
        ]);
        const input = {
          name: errorName(error),
          permission,
          secureContext: window.isSecureContext,
          hasCameraApi: true,
          cameraCount,
          embedded: isEmbedded(),
          policyAllowsCamera: policyAllowsCamera(),
          url: window.location.href,
          playback: stage === "play",
          platform: readPlatform(),
        };
        const copy = describeCameraFailure(input);

        // One string, not an object: an object argument can render as `{}` in a
        // console, and the one time somebody reads this line is the one time the
        // fields matter.
        console.error(
          describeCameraDiagnostic({
            ...input,
            origin: window.location.origin,
            stage,
            code: copy.code,
          }),
        );
        // The raw failure on its own line, where a console can show a DOMException
        // properly rather than as an empty object.
        console.error("[payload/scanner] raw failure:", error);
        if (cancelled) return;
        setStatus("problem");
        setProblem(copy);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, attempt, stop]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="size-4 text-violet-glow" aria-hidden />
            Scan a wallet address
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-4 aspect-square overflow-hidden rounded-2xl border border-border bg-black/60">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="size-full object-cover"
          />

          {status === "scanning" ? (
            // A guide, not a constraint: the decoder reads the whole frame, and a
            // frame that has to be aimed exactly is worse than no guide at all.
            <div
              aria-hidden
              className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/25"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto p-6 text-center">
              {problem ? (
                <>
                  <p className="text-xs leading-relaxed text-foreground">
                    {problem.title}
                  </p>
                  {/* The branch taken, in tiny type. A message that does not add
                      up is the one worth reporting, and "it didn't work" cannot
                      be acted on. */}
                  <p className="font-mono text-[10px] break-all text-subtle">
                    {problem.code}
                  </p>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-muted">
                  Starting the camera…
                </p>
              )}
            </div>
          )}
        </div>

        {problem ? (
          // Below the box rather than inside it: this is the part to act on, and
          // it is too long to sit in a square overlay without being clipped.
          <p className="mt-3 text-xs leading-relaxed text-warning">
            {problem.detail}
          </p>
        ) : null}

        {rejected ? (
          <p className="mt-3 text-xs leading-relaxed text-warning">{rejected}</p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-subtle">
            The camera is used on this device only, and stops when this closes.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {problem ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAttempt((count) => count + 1)}
              >
                <RotateCw className="size-4" aria-hidden />
                Try again
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
