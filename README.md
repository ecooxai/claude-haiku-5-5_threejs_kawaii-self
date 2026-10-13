# Kawaii Self — 3D anime character (Claude Haiku 5.5)

An anime girl built with three.js: toon shading, inverted-hull outlines, canvas-drawn eyes, and a body generated from signed distance fields (SDF). No external assets.

- `tools/character.mjs` builds the body parts (skin, hair, sleeves, dress, petticoat, stockings, boots) as surface-nets meshes into `assets/mesh/`.
- `app.js` loads those meshes and adds the face, ribbons, trims, star pin and sparkles.

## Run
    npm install
    python3 -m http.server 8080      # then open http://localhost:8080/
Views: Front / Back / Left / Right / 3/4 / Spin (drag to orbit when not spinning).

## Regenerate the body meshes
    node tools/character.mjs         # all parts (about 2 to 3 minutes)
    node tools/character.mjs hair    # one part
Raise the `cell` values in `tools/character.mjs` for a lighter mesh (phones).

## Capture renders (headless)
WebGL2 does not work in headless mode here, so capture under a virtual display:
    VIEWS=front,back,left,right,three xvfb-run -a -s "-screen 0 1280x1024x24" node scripts/shot.mjs 8080 renders
Software GL is occasionally flaky: if the PNGs come out blank, run the command again.

## Status
- Score: about 85/100 (self-assessed, see `renders/`).
- Known gaps: the hands are mitts with a thumb but no fingers, and the arms are stiff; the hair is one merged mass, so the fringe and tails have less definition than separate strands; the hair and the skirt have no outline (outline shells showed through the gaps between strands and the pleats), so they rely on baked sheen and toon shading.
