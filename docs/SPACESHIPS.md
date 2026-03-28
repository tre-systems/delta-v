# Ship Aesthetics & Visual Direction

This document defines the visual identity of the Delta-V fleet.
It is a style guide, not the gameplay source of truth.

For gameplay stats and legality, use:

- `src/shared/constants.ts` (`SHIP_STATS`, ship classes, capabilities)
- [SPEC.md](./SPEC.md) (rules and scenario behavior)
- [ARCHITECTURE.md](./ARCHITECTURE.md) (system design)

## Design Philosophy: "Symmetrical NASA-Punk"

In vacuum, form follows delta-v and orbital mechanics. Ship designs should feel engineered, practical, and zero-g-native.

- **Zero-g symmetry first:** no aerodynamic fuselages, no implied "up/down", no airplane cockpits.
- **Visible propulsion:** large engine bells, obvious thrust vectors, believable maneuvering clusters.
- **Thermal realism:** integrated radiators / cooling features rather than decorative fins.
- **Functional materials:** bare trusses, tank geometry, thermal foil, exposed service panels.

## Fleet Visual Taxonomy (Current Roster)

The current playable roster includes:
`transport`, `packet`, `tanker`, `liner`, `corvette`, `corsair`, `frigate`, `dreadnaught`, `torch`, and `orbitalBase`.

### Warships

- **Corvette:** compact interceptor silhouette, aggressive thrust-to-mass look.
- **Corsair:** improvised raider profile, asymmetry and retrofit cues.
- **Frigate:** long-range missile/gun platform with mission-flexible geometry.
- **Dreadnaught:** heavy armored massing, broadside and spinal weapon emphasis.
- **Torch:** high-energy experimental craft dominated by propulsion architecture.

### Civilian and Utility Vessels

- **Transport:** modular cargo/passenger hauler; practical logistics frame.
- **Tanker:** fuel-centric mass distribution (tank volume reads clearly).
- **Liner:** civilian long-haul comfort vessel, still fully zero-g functional.
- **Packet:** fast courier form factor; lean hull and high-acceleration identity.

### Fixed Strategic Structure

- **Orbital Base:** industrial-defense installation; immobile fortress silhouette with heavy weapon/readiness cues.

## Implementation Notes

- This repo currently tracks textual visual direction; concept bitmap assets are optional and may live outside source control.
- Keep this guide synchronized with the playable ship roster in `SHIP_STATS`.
- If a ship is added/removed in gameplay code, update this file in the same PR.

### Color Direction

- **Warships:** Gunmetal `#2a2d34`, Navy `#1a2c42`, Warning Amber `#ffc56a`.
- **Industrial/civilian:** White tile `#eef4ff`, Metallic Silver `#90a0ba`, Kapton Gold `#d4af37`.
- **Experimental (Torch family):** High-energy Cyan `#7ad7ff`, Obsidian `#040b16`.
