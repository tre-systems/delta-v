# Delta-V Lore & Visual Direction

Visual identity guide for the Delta-V fleet. Not the gameplay source of truth.

For gameplay stats and legality, use:

- `src/shared/constants.ts` (`SHIP_STATS`, ship classes, capabilities)
- [SPEC.md](./SPEC.md) (rules and scenario behavior)
- [ARCHITECTURE.md](./ARCHITECTURE.md) (system design)

---

## Design Philosophy: "Symmetrical NASA-Punk"

In vacuum, form follows delta-v and orbital mechanics. Ship designs should feel engineered, practical, and zero-g-native.

- **Zero-g symmetry first:** no aerodynamic fuselages, no implied "up/down", no airplane cockpits.
- **Visible propulsion:** large engine bells, obvious thrust vectors, believable maneuvering clusters.
- **Thermal realism:** integrated radiators / cooling features rather than decorative fins.
- **Functional materials:** bare trusses, tank geometry, thermal foil, exposed service panels.

---

## Technology Pillars

Each ship incorporates some or all of these visual elements. These are speculative sci-fi extrapolations for art direction, not engineering claims.

| Pillar | Visual Cues |
|--------|-------------|
| **Fusion drives** | Massive engine bells or magnetic nozzle rings. Blinding cyan/white exhaust. Confinement coil rings. |
| **Thermal management** | Flush-mounted hull panels glowing cherry-red under load. Liquid droplet streams between catch-basins. No protruding radiator fins. |
| **Directed-energy weapons** | Long accelerator spines along the keel. Superconducting magnet rings. Laser variants as clustered emitter lenses behind armored shutters. |
| **Ablative armor & Whipple shields** | Thick overlapping hexagonal outer plating. Beam scoring and ablation marks. Modular replacement segments. |
| **Cryogenic fuel tanks** | Spherical tanks in clusters. Reflective MLI / Kapton gold foil wrapping. Skeletal truss frameworks. |
| **RCS thrusters** | Small quad-block nozzles at hull corners. Scorch marks around bells. Short pale exhaust bursts. |
| **Solar arrays** | Enormous dark-blue rectangular grids on unfolding booms. Flat, fragile appearance. Used on bases and auxiliary systems. |
| **Comms arrays** | Large parabolic dishes on articulating gimbals. Clustered near command deck. |
| **Sensors (LiDAR)** | Long booms protruding from prow. Geometric sensor heads, domed cameras, phased-array panels. |
| **Point defense cannons** | Small multi-barreled rotary cannons in armored turrets. Fast-turning gimbals for 360-degree coverage. |
| **Ordnance tubes** | Flush-mounted hexagonal launch tubes in armor plating. Amber/red pre-heat glow. Heavy armored hatch covers. |

---

## Fleet Visual Taxonomy

Raster reference boards are **not** checked into this repository (to keep the tree small). Names below are the intended filenames if you add PNGs under `docs/assets/` for local previews.

### Warships

- **Corvette:** compact interceptor. Proportionally large fusion bell. Gunmetal with warning amber accents. Point-defense blisters and forward particle-beam spine. — `docs/assets/corvette_1775109517323.png`
- **Corsair:** improvised raider. Mismatched ablative armor over exposed truss core. Matte navy/grey with heavy scoring. Visible torpedo tubes. — `docs/assets/corsair_1775109530526.png`
- **Frigate:** long-range gun platform. Linear hull with heavy forward armor. Symmetrical sensor booms. Recessed torpedo bays. Navy/gunmetal. — `docs/assets/frigate_1775109542568.png`
- **Dreadnaught:** heavy capital ship. Brutalist hexagonal armor. Central spine housing heavy particle accelerators. Multiple ablative shield layers. — `docs/assets/dreadnaught_1775109560834.png`
- **Torch:** experimental high-energy craft. Colossal magnetic confinement drive (70% of vessel length). Blinding cyan exhaust. Obsidian heat-resistant hull. — `docs/assets/torch_ship_1775109573823.png`

### Civilian and Utility Vessels

- **Transport:** modular cargo hauler. Skeletal truss with detachable cargo pods. White tile and Kapton gold. Can carry and emplace Orbital Bases. — `docs/assets/transport_1775109587277.png`
- **Tanker:** fuel-centric design. Enormous cluster of spherical cryogenic tanks around a central thrust spine. Minimal crew section. — `docs/assets/tanker_1775109621556.png`
- **Liner:** civilian long-haul. Stark white tiled hull with modular passenger habitats. Reflective observation blisters. — `docs/assets/liner_1775109635450.png`
- **Packet:** armed courier. Heavily armored front plate shielding cargo sections. Integrated defensive laser turrets. Metallic silver. Can emplace orbital bases. — `docs/assets/packet_1775109649725.png`

### Fixed Strategic Structure

- **Orbital Base:** immobile fortress. Central docking/refueling hub. Vast solar array grids. Thick armor over command sectors and fixed weapon batteries. — `docs/assets/orbital_base_1775109663366.png`

---

## Concept Art Assets

Intended reference filenames under `docs/assets/` (add PNGs locally if you want bitmap previews):

| Pillar | Reference file |
|--------|----------------|
| Fusion drive | `docs/assets/torch_drive_1775109703105.png` |
| Thermal management | `docs/assets/thermal_management_1775109717547.png` |
| Particle beam | `docs/assets/particle_beam_1775109732737.png` |
| Ablative armor | `docs/assets/ablative_armor_1775109747165.png` |
| Cryogenic fuel | `docs/assets/cryogenic_fuel_1775109764057.png` |
| RCS thruster | `docs/assets/rcs_thruster_1775109778774.png` |
| Solar arrays | `docs/assets/solar_arrays_1775109830929.png` |
| Comms array | `docs/assets/comms_dish_1775209977168.png` |
| Sensor boom | `docs/assets/sensor_spine_1775209990650.png` |
| PDC | `docs/assets/rotary_cannon_1775210007530.png` |
| Ordnance tubes | `docs/assets/missile_tubes_1775210023785.png` |

---

## Color Direction

- **Warships:** Gunmetal `#2a2d34`, Navy `#1a2c42`, Warning Amber `#ffc56a`.
- **Industrial/civilian:** White tile `#eef4ff`, Metallic Silver `#90a0ba`, Kapton Gold `#d4af37`.
- **Experimental (Torch family):** High-energy Cyan `#7ad7ff`, Obsidian `#040b16`.

## Maintenance

- Concept art assets are optional files under `docs/assets/`; gameplay code must not depend on them.
- Keep this guide synchronized with the playable ship roster in `SHIP_STATS`.
- If a ship is added or removed in gameplay code, update this file in the same PR.
