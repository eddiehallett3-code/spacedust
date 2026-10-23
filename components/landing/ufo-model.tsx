"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The Spacedust saucer as a real model.
 *
 * The GLB cannot be server-rendered and is several megabytes, so the canvas is
 * mounted empty: the hero's glow and orbit rings hold the composition until the
 * model has loaded, then it fades in. There is deliberately no 2.5D stand-in —
 * showing one for the first second made the hero change its artwork mid-flight.
 *
 * If WebGL is unavailable, the download fails, or the visitor has asked to save
 * data, the stage stays quiet. Nothing here is required for the page to work,
 * so every failure path is visual only.
 *
 * Three.js is imported *inside* the effect, not at the top of the file. That
 * keeps it out of the landing page's initial JavaScript and off the server
 * entirely: the chunk is fetched after hydration, and only for the copy of the
 * saucer that is actually on screen. `ResizeObserver` decides that: a copy
 * hidden by `display: none` (the mobile copy on desktop, the desktop copy on a
 * phone) reports 0 × 0 and never creates a WebGL context.
 */
export function UfoModel({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let started = false;
    let teardown: (() => void) | undefined;
    const size = { width: 0, height: 0 };
    let applySize: ((width: number, height: number) => void) | undefined;

    /**
     * Build the scene. Deliberately one camera, one light rig and no external
     * environment map: `RoomEnvironment` is generated in memory, so the CSP's
     * `connect-src 'self'` is enough and there is no second download beyond the
     * model itself.
     */
    const start = async (): Promise<void> => {
      const [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
      ]);
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
      } catch {
        // No WebGL: leave the glow and orbit rings as the stage. There is no
        // 2.5D stand-in any more, by design.
        return;
      }

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        34,
        Math.max(size.width, 1) / Math.max(size.height, 1),
        0.1,
        100,
      );
      camera.position.set(0, 1.7, 6.8);
      camera.lookAt(0, 0.02, 0);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(size.width, size.height, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      host.appendChild(renderer.domElement);

      // A neutral studio environment gives the metal something to reflect
      // without shipping an HDR file. The violet and cyan rims then pull the
      // reflections toward the site's palette.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const environmentScene = new RoomEnvironment();
      const environmentTarget = pmrem.fromScene(environmentScene, 0.04);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.85;
      environmentScene.dispose();
      pmrem.dispose();

      scene.add(new THREE.AmbientLight(0xffffff, 0.35));

      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(4.5, 6, 4);
      scene.add(key);

      const violetRim = new THREE.DirectionalLight(0x8b5cf6, 2.4);
      violetRim.position.set(-5, 2.5, -3);
      scene.add(violetRim);

      const cyanFill = new THREE.PointLight(0x22d3ee, 28, 16, 2);
      cyanFill.position.set(3.5, -1.5, 4);
      scene.add(cyanFill);

      const group = new THREE.Group();
      group.rotation.set(0.02, 0, 0);
      scene.add(group);

      /**
       * The canvas is 4:3 and the saucer is a wide, flat disc, so a centred
       * model leaves a lot of empty canvas above the visible craft. On phones
       * that empty band is the difference between "right under the safety
       * list" and "somewhere below it", so lift the disc inside the frame. The
       * desktop canvas has room to stay centred.
       */
      const lift = size.width < 400 ? 0.45 : 0;
      group.position.y = lift;

      // Two groups on purpose: `group` owns the flight path and the bank that
      // reveals the underside, while `spin` owns the endless yaw. Rotating one
      // Euler triple would make the tilt axis turn with the yaw, turning the
      // fly-away into a tumble. Separating them keeps the underside facing the
      // camera for the whole pass.
      const spin = new THREE.Group();
      spin.rotation.y = -0.5;
      group.add(spin);

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const startedAt = performance.now();
      let frame = 0;
      let lastFrame = 0;
      let renderEnabled = true;
      let hasSize = true;
      let inView = true;
      let lights: import("three").Group | undefined;

      const syncRenderEnabled = (): void => {
        renderEnabled = hasSize && inView;
      };

      const renderFrame = (elapsed: number): void => {
        if (!reducedMotion) {
          // Endless yaw, one revolution about every 12.5 seconds.
          spin.rotation.y = elapsed * 0.5 - 0.5;

          // A continuous weave: approach on the left, recede on the right,
          // then back again. The depth drives the pitch, so the saucer dips its
          // nose away exactly as it gets smaller and farther — that is the half
          // of the cycle where the underside and its lights face the camera.
          const phase = elapsed * 0.5;
          const weave = Math.sin(phase);
          const depth = Math.cos(phase);

          group.position.x = weave * 0.4;
          group.position.y = Math.sin(elapsed * 0.9) * 0.07 + lift;
          group.position.z = depth * 0.5 - 0.15;
          group.rotation.x = -0.2 + depth * 0.28;
          group.rotation.z = weave * 0.2;

          if (lights) {
            lights.children.forEach((light, index) => {
              const pulse = 0.85 + Math.sin(elapsed * 2.2 + index * 0.9) * 0.25;
              light.scale.setScalar(pulse);
            });
          }
        }
        renderer.render(scene, camera);
      };

      /**
       * 30 fps is plenty for a slowly banking saucer, and halves the GPU work
       * of a hero that may sit on screen for a while. A hidden tab also skips
       * the draw; the browser already stops scheduling the callbacks.
       */
      const tick = (now: number): void => {
        frame = window.requestAnimationFrame(tick);
        if (!renderEnabled || document.hidden) return;
        if (now - lastFrame < 1000 / 30) return;
        lastFrame = now;
        renderFrame((now - startedAt) / 1000);
      };

      applySize = (width, height) => {
        if (width < 1 || height < 1) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };

      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        // A breakpoint can hide this copy after it started (desktop → mobile,
        // for instance). Stop drawing it while it has no box, so the hidden
        // canvas cannot keep the GPU awake behind a `display: none`.
        hasSize =
          entry.contentRect.width >= 1 && entry.contentRect.height >= 1;
        syncRenderEnabled();
        applySize?.(entry.contentRect.width, entry.contentRect.height);
      });
      resizeObserver.observe(host);

      // The saucer belongs to the hero, so scrolling past it leaves a canvas
      // that is still 520 × 390 in layout terms. Stop drawing once it leaves
      // the viewport; coming back resumes from wherever the flight had got to.
      const visibilityObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          inView = entry.isIntersecting;
          syncRenderEnabled();
        },
        { rootMargin: "120px" },
      );
      visibilityObserver.observe(host);

      let model: import("three").Object3D | undefined;
      const loader = new GLTFLoader();

      loader.load(
        "/3d/ufo-v1.glb",
        (gltf) => {
          if (disposed) {
            disposeObject(THREE, gltf.scene);
            return;
          }

          model = gltf.scene;
          model.updateMatrixWorld(true);

          // Normalise the model: centre it and scale its largest dimension to
          // 4 world units, so the camera framing does not depend on the
          // exporter's units or the model's origin. At the camera distance
          // below that fills roughly four-fifths of the 4:3 stage, close to the
          // footprint the old SVG had.
          const box = new THREE.Box3().setFromObject(model);
          const span = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          const scale = 4 / Math.max(span.x, span.y, span.z, 0.001);
          group.scale.setScalar(scale);
          spin.add(model);

          /**
           * The source model has no emissive underside, so the running lights
           * from the brand mark are added here: a ring of cyan/violet dots just
           * below the rim, on the same spinning group as the hull.
           *
           * Positions and the dot radius are divided by the group scale because
           * these live inside the scaled hierarchy. In world units the dots sit
           * at radius 1.62 and 0.2 below the centre — on the underside just
           * inside the rim, so they read as inset lights and the rim hides them
           * from above.
           */
          lights = new THREE.Group();
          const dotGeometry = new THREE.SphereGeometry(0.04 / scale, 8, 8);
          const dotMaterials = [
            new THREE.MeshBasicMaterial({ color: 0x67e8f9, toneMapped: false }),
            new THREE.MeshBasicMaterial({ color: 0x8b5cf6, toneMapped: false }),
          ];
          for (let index = 0; index < 8; index += 1) {
            const angle = (index / 8) * Math.PI * 2;
            const dot = new THREE.Mesh(dotGeometry, dotMaterials[index % 2]);
            dot.position.set(
              (Math.cos(angle) * 1.62) / scale,
              -0.2 / scale,
              (Math.sin(angle) * 1.62) / scale,
            );
            lights.add(dot);
          }
          spin.add(lights);

          // A small cyan lamp under the hull so the underside is readable when
          // the flight turns it toward the camera.
          const underGlow = new THREE.PointLight(0x67e8f9, 8, 5, 2);
          underGlow.position.set(0, -1.1 / scale, 0);
          group.add(underGlow);

          model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            for (const material of materials) {
              if ("envMapIntensity" in material) {
                material.envMapIntensity = 1.2;
              }
              // The model's canopy is a warm amber. The site's running lights
              // are cyan, so the one emissive part is pulled onto the palette;
              // the metal itself stays neutral so the scene's violet and cyan
              // rims still read as reflections.
              if (
                material instanceof THREE.MeshStandardMaterial &&
                material.name === "Ventanilla"
              ) {
                material.emissive.set("#67e8f9");
                material.emissiveIntensity = 1.5;
              }
              material.needsUpdate = true;
            }
          });

          // Let the SVG fade out only once there is something to see. Under
          // reduced motion there is no animation loop, so this load is also the
          // moment to draw the single static frame — otherwise the fallback
          // would fade out to an empty canvas.
          if (reducedMotion) renderFrame(0);
          if (!disposed) setReady(true);
        },
        undefined,
        () => {
          // Download or parse failure: keep the SVG. Stop the empty loop so a
          // decorative asset that never arrived cannot keep using the GPU.
          window.cancelAnimationFrame(frame);
        },
      );

      if (reducedMotion) {
        // One static frame is the whole animation for reduced motion.
        renderFrame(0);
      } else {
        frame = window.requestAnimationFrame(tick);
      }

      teardown = () => {
        window.cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
        if (model) {
          spin.remove(model);
          disposeObject(THREE, model);
        }
        if (lights) {
          spin.remove(lights);
          disposeObject(THREE, lights);
        }
        scene.environment = null;
        environmentTarget.dispose();
        scene.clear();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      size.width = entry.contentRect.width;
      size.height = entry.contentRect.height;
      if (size.width < 1 || size.height < 1) return;

      if (!started) {
        started = true;
        // The model is ~1.8 MB over the wire even compressed. A visitor who has
        // asked their browser to save data gets the SVG, which tells the same
        // story without the download.
        const connection = (
          navigator as Navigator & { connection?: { saveData?: boolean } }
        ).connection;
        if (connection?.saveData === true) return;
        void start();
      } else {
        applySize?.(size.width, size.height);
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      teardown?.();
    };
  }, []);

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none relative aspect-[4/3] w-full min-w-0 max-w-full select-none",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-[10%] -z-10 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.28),rgba(34,211,238,0.08)_48%,transparent_70%)] blur-2xl" />

      <div
        ref={hostRef}
        className={cn(
          "absolute inset-0 transition-opacity duration-700",
          ready ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/**
 * Release the geometry, materials and textures a loaded glTF owns.
 *
 * `GLTFLoader` creates these per model, and a landing page can mount the saucer
 * more than once during its lifetime (a resize between mobile and desktop, or
 * Strict Mode's double effect in development). Disposing only the geometry
 * would leak the normal and base-colour textures on every remount.
 */
function disposeObject(
  THREE: typeof import("three"),
  object: import("three").Object3D,
): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && (value as import("three").Texture).isTexture) {
          (value as import("three").Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}
