# Kawaii Self — 3D anime character (Claude Haiku 5.5)

A procedural anime girl built with three.js: toon shading, inverted-hull outlines, canvas-drawn eyes, and strand-based hair. No external assets.

## Run
    npm install
    python3 -m http.server 8080      # then open http://localhost:8080/
Views: Front / Back / Left / Right / 3/4 / Spin (drag to orbit when not spinning).

## Capture renders (headless)
WebGL2 does not work in headless mode here, so capture under a virtual display:
    xvfb-run -a -s "-screen 0 1280x1024x24" node scripts/shot.mjs 8080 renders
(`scripts/shot.mjs` expects the server on that port and Chromium at the path set inside it.)

## Status
- Score: ~72/100 (self-assessed, see renders/).
- Known gaps: hair is layered tubes with flat ends; face is simple (no nose/lip shading); clothes are flat-shaded; no hand detail; the dress has no real folds.
