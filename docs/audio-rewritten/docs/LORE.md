# Delta-V Lore & Visual Direction

Visual identity guide for the Delta-V fleet. Not the gameplay source of truth.

For gameplay stats and legality, refer to the shared constants module where ship stats and ship classes are defined, the spec document covering rules and scenario behavior, and the architecture document covering system design.

---

## Design Philosophy: "Symmetrical NASA-Punk"

In vacuum, form follows delta-v and orbital mechanics. Ship designs should feel engineered, practical, and zero-g-native.

- **Zero-g symmetry first:** no aerodynamic fuselages, no implied "up/down", no airplane cockpits.
- **Visible propulsion:** large engine bells, obvious thrust vectors, believable maneuvering clusters.
- **Thermal realism:** integrated radiators and cooling features rather than decorative fins.
- **Functional materials:** bare trusses, tank geometry, thermal foil, exposed service panels.

---

## Technology Pillars

Each ship incorporates some or all of these visual elements. These are speculative sci-fi extrapolations for art direction, not engineering claims.

Turning to the individual pillars: Fusion drives are represented by massive engine bells or magnetic nozzle rings, blinding cyan or white exhaust, and confinement coil rings. Thermal management appears as flush-mounted hull panels glowing cherry-red under load, liquid droplet streams between catch-basins, and no protruding radiator fins. Directed-energy weapons take the form of long accelerator spines along the keel, superconducting magnet rings, and laser variants rendered as clustered emitter lenses behind armored shutters.

Ablative armor and Whipple shields show up as thick overlapping hexagonal outer plating, beam scoring and ablation marks, and modular replacement segments. Cryogenic fuel tanks appear as spherical tanks in clusters, wrapped in reflective multi-layer insulation and Kapton gold foil, supported by skeletal truss frameworks. Reaction control system thrusters are small quad-block nozzles at hull corners with scorch marks around the bells and short pale exhaust bursts.

Solar arrays are enormous dark-blue rectangular grids on unfolding booms — flat and fragile-looking, used on bases and auxiliary systems. Communications arrays are large parabolic dishes on articulating gimbals, clustered near the command deck. Light detection and ranging sensors appear as long booms protruding from the prow with geometric sensor heads, domed cameras, and phased-array panels. Point defense cannons are small multi-barreled rotary cannons in armored turrets on fast-turning gimbals giving three-hundred-and-sixty-degree coverage. Ordnance tubes are flush-mounted hexagonal launch tubes in the armor plating with amber or red pre-heat glow and heavy armored hatch covers.

---

## Fleet Visual Taxonomy

Reference boards for each vessel class are stored in the documentation assets folder.

### Warships

- **Corvette** — Compact interceptor. Proportionally large fusion bell. Gunmetal with warning amber accents. Point-defense blisters and forward particle-beam spine.
- **Corsair** — Improvised raider. Mismatched ablative armor over exposed truss core. Matte navy and grey with heavy scoring. Visible torpedo tubes.
- **Frigate** — Long-range gun platform. Linear hull with heavy forward armor. Symmetrical sensor booms. Recessed torpedo bays.
- **Dreadnaught** — Heavy capital ship. Brutalist hexagonal armor. Central spine housing heavy particle accelerators. Multiple ablative shield layers.
- **Torch** — Experimental high-energy craft. Colossal magnetic confinement drive occupying roughly seventy percent of the vessel length. Blinding cyan exhaust. Obsidian heat-resistant hull.

### Civilian and Utility Vessels

- **Transport** — Modular cargo hauler. Skeletal truss with detachable cargo pods. White tile and Kapton gold. Can carry and emplace orbital bases.
- **Tanker** — Fuel-centric design. Enormous cluster of spherical cryogenic tanks around a central thrust spine. Minimal crew section.
- **Liner** — Civilian long-haul. Stark white tiled hull with modular passenger habitats. Reflective observation blisters.
- **Packet** — Armed courier. Heavily armored front plate shielding cargo sections. Integrated defensive laser turrets. Metallic silver. Can emplace orbital bases.

### Fixed Strategic Structure

- **Orbital Base** — Immobile fortress. Central docking and refueling hub. Vast solar array grids. Thick armor over command sectors and fixed weapon batteries.

---

## Concept Art Assets

The documentation assets folder contains reference images for each technology pillar: fusion drive, thermal management, particle beam, ablative armor, cryogenic fuel, reaction control system thruster, solar arrays, communications dish, sensor spine, point defense cannon, and missile tubes.

---

## Color Direction

Warships use gunmetal, navy, and warning amber as their primary palette. Industrial and civilian vessels favor white tile, metallic silver, and Kapton gold. Experimental craft in the Torch family use high-energy cyan and obsidian black.

## Maintenance

Concept art assets are reference-only; gameplay code must not depend on them. This guide should be kept synchronized with the playable ship roster defined in the shared constants module. If a ship is added or removed in gameplay code, this file should be updated in the same pull request.
