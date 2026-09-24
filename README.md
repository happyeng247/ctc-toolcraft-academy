# CTC Toolcraft Academy

An interactive educational prototype for learning cutting-tool design, from cutting mechanics and tool geometry to manufacturing, inspection, trials and an AI design roadmap.

**[Open the live academy](https://happyeng247.github.io/ctc-toolcraft-academy/)**

## Explore

- Rotatable 3D end mill, PCB microdrill and PCD tipped tool models.
- Adjustable flute geometry, cross-sections, rake and clearance.
- 17 beginner lessons with exercises and knowledge checks.
- Milling calculations and an overhang demonstration with explicit assumptions.
- Rollomatic and Tool Sketcher workflow lessons.
- Seven failure investigations and a six-week shop-floor learning plan.
- A customer brief builder, AI development roadmap, 49 glossary terms and 53 primary references.

Start with the **Geometry lab**, then the first three lessons in **Learning path**. See the [quick-start guide](docs/Start-here.md).

## Run locally

Open `docs/index.html` in a modern browser. It contains the runtime, content and styling, so it also works offline. External reference links need an internet connection.

For a local web preview:

```sh
python3 -m http.server 8000 --directory docs
```

Then open `http://localhost:8000`.

## Edit and publish

The editable content and application files live in `src/`. Rebuild the self-contained website after changing them:

```sh
python3 scripts/build.py
```

Commit the source changes and the regenerated `docs/` files, then push to `main`. GitHub Pages publishes the `docs/` directory from that branch.

No package installation or build service is required. Python 3 uses only its standard library; the Three.js browser runtime is vendored in the repository.

## Learning data and scope

The academy uses public technical references and generic teaching examples. No customer drawings, proprietary production records or personal learning notes are included in this repository.

Progress, lesson notes and brief entries stay in the visitor's browser. Export controls create local JSON files; there is no account system, application backend or analytics integration. Browser storage is specific to the browser and site origin, so progress from a local copy does not automatically transfer to this website.

The models are schematic and the calculations use stated idealizations. This is a learning environment, not a source of production CAD/CAM files, qualified machine settings or released tool designs. References were checked on 23 September 2026; installed machine models, software versions and options must be verified separately.

## Third-party software

Three.js r128 is included under the [MIT License](src/vendor/THREE-LICENSE.txt). Its license is retained in the generated page and in `docs/THREE-LICENSE.txt`. Linked reference material remains with its respective publishers.
