# Dark Forest — Universe Viewer UI Specification (Phase 1)

## Project Overview

Dark Forest is a real-time strategy and survival game inspired by the "Dark Forest" hypothesis.

The player controls a civilization hidden somewhere in the galaxy. Every action has consequences. Sending probes, moving ships, investigating signals, or attacking another civilization may reveal information about your own civilization.

The gameplay is built around information rather than combat.

The player should constantly feel:

- I do not know everything.
- Every action creates evidence.
- Other civilizations may already be watching.
- Information is more valuable than weapons.

This document only describes **Phase 1**, whose purpose is to build the interactive galaxy viewer.

No gameplay logic is implemented yet.

---

# Phase 1 Goal

Build a real-time universe viewer.

The application should:

- Connect to Firebase Realtime Database.
- Load one hardcoded universe.
- Render every object.
- Render every orbit/curve.
- Automatically update whenever the universe changes.
- Support clicking objects for future interactions.

No editing is required.

No gameplay logic is required.

This is purely a visualization layer.

---

# Technology Stack

Frontend

- React
- TypeScript
- Redux Toolkit
- PixiJS
- Firebase Realtime Database

Backend

- Flask (future)
- Firebase Realtime Database

---

# Database Structure

Current structure:

```json
{
  "universes": {
    "univid1123": {
      "objects": {
        "objectid1234": {
          "curves": [
            {
              "eccentricity": 0,
              "focus1": "objectid1234",
              "major_axis": 20,
              "rotation": 0,
              "valid_till": -1
            }
          ],
          "sub_type": "some_sub_type",
          "type": "ARTIFICIAL"
        }
      },
      "time": 0
    }
  }
}
```

Assume:

- universe id is hardcoded.
- objects may appear/disappear.
- curves may appear/disappear.
- object positions will change frequently.

---

# Application Architecture

```
Firebase
      │
      ▼
Redux Store
      │
      ▼
GalaxyView (PixiJS)
```

Firebase is the source of truth.

Redux stores the current universe state.

PixiJS renders the current Redux state.

The renderer should never contain game logic.

---

# UI Layout

The application contains a single full-screen galaxy map.

```
+------------------------------------------------------------+
|                                                            |
|                                                            |
|                 Galaxy View                                |
|                                                            |
|                                                            |
|                                                            |
|                                                            |
+------------------------------------------------------------+
```

Ignore sidebars for now.

Ignore menus.

Ignore controls.

Only the map should exist.

---

# Visual Style

The UI should resemble a space mission control display.

Requirements:

- black background
- small white stars
- minimalistic
- clean
- technical
- no unnecessary decorations

Everything should feel like viewing a military radar or orbital control system.

---

# Rendering Layers

The renderer should internally separate objects into layers.

```
Stage

├── Background Layer
│      static stars
│
├── Curve Layer
│      all orbit curves
│
├── Object Layer
│      all objects
│
└── Selection Layer
       future use
```

Each layer should be its own Pixi Container.

---

# Objects

Every object must be rendered.

For now use simple placeholder graphics.

Example:

- white filled circle
- small rocket icon
- small square

Implementation does not matter.

Objects must be individually clickable.

Clicking an object should simply log its id.

---

# Curves

Each object may contain multiple curves.

Every curve must be rendered.

Ignore valid_till for now.

Assume every curve is active.

Current supported curve:

Ellipse.

Circle is simply:

eccentricity = 0

The renderer should compute the ellipse from:

- focus1
- major_axis
- eccentricity
- rotation

Future curve types are expected.

The renderer should therefore be modular.

---

# Update Behaviour

The frontend should subscribe to Firebase.

Whenever the universe changes:

- update Redux
- rerender the scene

Do not reload the page.

Do not recreate the Pixi Application.

Only update the affected graphics.

Typical updates:

- object position changed
- curve changed
- object added
- object removed

The update should feel real-time.

---

# Camera

Implement a movable camera.

Support:

- mouse drag to pan
- mouse wheel zoom

The camera should not modify world coordinates.

Only the viewport changes.

---

# Coordinate System

Assume:

```
(0,0)
```

is world origin.

Objects store world coordinates.

Camera converts world coordinates to screen coordinates.

Do not modify Firebase coordinates.

---

# Redux State

The Redux store should contain:

- current universe
- selected object id
- camera state

The renderer should consume Redux state.

Do not store Pixi objects inside Redux.

---

# Code Organization

Suggested structure:

```
src/

components/
    GalaxyView.tsx

pixi/
    GalaxyRenderer.ts
    CurveRenderer.ts
    ObjectRenderer.ts
    CameraController.ts

store/
    universeSlice.ts

firebase/
    listener.ts

types/
    Universe.ts
    Object.ts
    Curve.ts
```

---

# Current Scope

Required:

✓ Connect to Firebase

✓ Load hardcoded universe

✓ Render all objects

✓ Render all curves

✓ Update automatically

✓ Clickable objects

✓ Camera pan

✓ Camera zoom

Not required:

- gameplay
- combat
- ships
- radar
- signals
- sidebar
- menus
- animations
- object selection UI
- editing
- physics
- orbit transfers

The only goal is to build a robust real-time universe viewer that future gameplay systems can build upon.

---

# Running the Viewer

1. Copy `.env.example` to `.env.local` and add the Firebase web-app configuration, including the Realtime Database URL.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.

The viewer subscribes to `universes/univid1123` and updates the Pixi scene whenever Firebase sends a change. Object positions are read from `x` / `y`, `location.x` / `location.y`, or `position.x` / `position.y`. Objects without complete coordinates are not rendered.

Attached objects can be nested under an object’s `objects` field. A `RADAR` attachment with a numeric `radius` is rendered as a translucent range around its parent:

```json
"objects": {
  "radarid123": { "type": "RADAR", "radius": 250 }
}
```

## Icon attribution

The `cruise_level_1` subtype uses the [Scout ship](https://game-icons.net/1x1/delapouite/scout-ship.html) icon by Delapouite from Game-icons.net, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

## Music

The viewer includes an optional four-track ambient playlist streamed from Pixabay. Playback begins only after pressing the player’s play button. The track source pages are: [lo-fi space](https://pixabay.com/music/beats-lo-fi-space-chillout-lo-fi-187722/), [Neptune / Lofi](https://pixabay.com/music/beats-neptune-lofi-325862/), [Subspace Daydream](https://pixabay.com/music/lofi-subspace-daydream-491261/), and [Night Whispers / Lofi](https://pixabay.com/music/beats-night-whispers-lofi-314808/). Review the [Pixabay Content License](https://pixabay.com/service/license-summary/) before production use.

The object-selection sound is `public/audio/select_007.ogg` from Kenney’s Interface Sounds pack, which is licensed CC0.
