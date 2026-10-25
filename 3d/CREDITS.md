# UFO model — source and licence

The landing-page saucer is:

- **Title:** UFO Flying Saucer Spaceship OVNI
- **Author:** BlackHawk0512 — https://sketchfab.com/BlackHawk0512
- **Source:** https://sketchfab.com/3d-models/ufo-flying-saucer-spaceship-ovni-094ce2baf6ee40aa8f083b7d0fcf0a9f
- **Licence:** Sketchfab Standard — https://sketchfab.com/licenses

The unmodified download is kept in this folder. The file served by the site is
`public/3d/ufo-v1.glb`, produced from the GLB with:

```sh
npx @gltf-transform/cli optimize \
  '3d/ufo_flying_saucer_spaceship_ovni (1).glb' \
  public/3d/ufo-v1.glb \
  --compress quantize \
  --simplify true \
  --simplify-ratio 0.15 \
  --simplify-error 0.002 \
  --texture-compress webp \
  --texture-size 1024 \
  --join true \
  --palette false
```

That takes the asset from 20.5 MB / 344k triangles to 3.2 MB / 69k triangles.
The GLB's `asset.extras` still carries the author, source and licence, so the
provenance travels with the file itself.
