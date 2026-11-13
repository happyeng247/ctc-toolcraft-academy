# CTC Toolcraft Academy

An interactive educational prototype for learning cutting-tool design, from cutting mechanics and tool geometry to manufacturing, inspection, trials and an AI design roadmap.

**[Open the live academy with voice](https://ctc-toolcraft-academy.vercel.app/)** · [GitHub Pages mirror](https://happyeng247.github.io/ctc-toolcraft-academy/)

## Explore

- Rotatable 3D end mill, PCB microdrill and PCD tipped tool models.
- Adjustable flute geometry, cross-sections, rake and clearance.
- 17 beginner lessons with exercises and knowledge checks.
- A persistent voice panel: section narration, reviewed dictation, and an optional private ElevenLabs tutor with natural-language navigation and quiz interaction.
- Page audio preparation and MP3 download for longer mobile listening when the private service is connected.
- Milling calculations and an overhang demonstration with explicit assumptions.
- Rollomatic and Tool Sketcher workflow lessons.
- Seven failure investigations and a six-week shop-floor learning plan.
- A customer brief builder, AI development roadmap, 49 glossary terms and 53 primary references.

Start with the **Geometry lab**, then the first three lessons in **Learning path**. See the [quick-start guide](docs/Start-here.md).

## Run locally

Open `docs/index.html` in a modern browser. It contains the 3D runtime, lessons and styling, so the core academy works offline. Device narration needs browser speech support and an installed voice. Cloud voice features and external reference links need an internet connection.

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

## Voice learning

Open **Voice → Listen** to read the current lesson with play/pause, speed, section selection, and optional progression to the next lesson. **Dictate notes** lets you review words before appending them to a lesson, page notebook, customer brief, or tutor question. You can use the phone keyboard microphone whenever browser dictation is unavailable.

**Talk to tutor** supports spoken questions, interruptible replies, text chat, navigation, permitted 3D/calculator changes, and quiz answers through the academy's existing completion rules. This requires the private ElevenLabs service in [Voice setup](docs/VOICE-SETUP.md). The repository includes the gateway and agent provisioning template. The current frontend points to the deployed private voice service; a learner access code is supplied separately. GitHub Pages cannot host that gateway. No provider credential is embedded in the website.

Keep the page in the foreground for live conversation. Mobile browsers may suspend the microphone or narration when locked or backgrounded. Once connected, **Longer listening → Prepare page audio** creates a downloadable track for a separate audio player. The hosted service has been checked against ElevenLabs, including live text tutoring and WebRTC with a simulated microphone. Browser layouts are tested at phone widths; physical iOS/Android behavior may still vary.

## Learning data and scope

The academy uses public technical references and generic teaching examples. No customer drawings, proprietary production records or personal learning notes are included in this repository.

Progress, lesson notes and brief entries are stored in the visitor's browser. Export controls create local JSON files. Cloud voice uses an optional private gateway: live tutoring sends microphone audio and course context to ElevenLabs; Scribe sends dictation audio; read-aloud sends the requested course text. Saved notes and brief values are not automatically included in tutor context. Browser dictation may use the browser vendor's speech service. There is no analytics integration. Browser storage is specific to the browser and site origin, so progress from a local copy does not automatically transfer to this website.

The models are schematic and the calculations use stated idealizations. This is a learning environment, not a source of production CAD/CAM files, qualified machine settings or released tool designs. References were checked on 23 September 2026; installed machine models, software versions and options must be verified separately.

## Third-party software

Three.js r128 is included under the [MIT License](src/vendor/THREE-LICENSE.txt). Its license is retained in the generated page and in `docs/THREE-LICENSE.txt`. The optional voice client loads the pinned official `@elevenlabs/client` 1.36.0 browser bundle from jsDelivr only when cloud voice is used. Linked reference material remains with its respective publishers.
