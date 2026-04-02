# Delta-V Technology & Component Guide

The Delta-V universe is built on a "NASA-Punk" hard sci-fi foundation. The game is inspired by orbital mechanics and Newtonian reasoning, while still using deliberate gameplay abstractions for clarity and pacing. This document defines the technological inspirations behind the visual language.

This is a visual/lore guide, not the gameplay source of truth.

For implemented mechanics and legal actions, use:

- [SPEC.md](./SPEC.md)
- `src/shared/constants.ts` (`SHIP_STATS`, ordnance definitions)
- [ARCHITECTURE.md](./ARCHITECTURE.md)

These are not claims about present-day deployed fusion torchships. They are speculative extrapolations anchored to real aerospace constraints such as specific impulse, thermal management, shielding, solar power, deep-space communications, and sensing.

---

## 1. High-ISP Fusion Propulsion ("Torch Drives")

**How It Works:** 
Current chemical rockets have high thrust but terrible fuel efficiency (Specific Impulse / ISP), while ion drives have incredible ISP but microscopic thrust. Delta-V ships rely on sustained **Magnetic Confinement Fusion Drives**. Using Deuterium/Helium-3 reactions, these engines direct exhausted plasma out the back via a magnetic nozzle, providing both brutal thrust and incredible fuel efficiency, allowing for continuous rapid brachistochrone trajectories across the solar system.

**Visual description:**
- Massive, realistically scaled engine bells or exposed magnetic nozzle rings.
- Emits a blinding, high-energy cyan or pure white exhaust plume.
- Usually surrounded by heavy, cylindrical magnetic confinement coil rings.
- *Image details:* For concepts, prioritize lighting where the sheer radiant intensity of the exhaust casts harsh, hard-edged shadows forward across the ship's own radiator structures.

![Torch Drive](./assets/torch_drive_1775109703105.png)

---

## 2. Advanced Thermal Management

**How It Works:** 
In the vacuum of space, dissipating the extreme waste heat from fusion drives and beam weapons is a monumental challenge. Older ship designs use bulky, fragile radiator fins. The modern Delta-V fleet uses **Liquid Droplet Radiators** (spraying a stream of hot molten coolant directly into the vacuum and catching it meters away to radiate heat) and **Micro-Channel Cooling Arrays** (pumping coolant through hair-thin channels etched directly into the hull plating).

**Visual description:**
- Sleek, flush-mounted hull panels that glow faintly cherry-red or amber under load.
- Exposed mechanical arrays where a precise, glowing stream of liquid stretches momentarily through the vacuum between two catch-basins. 
- *Absence* of protruding, vulnerable traditional fins.
- *Image details:* Highlight the ambient glow of the liquid droplet streams or micro-channel radiators. The heat emission should look intense but precisely engineered, not chaotic like an uncontrolled fire.

![Thermal Management](./assets/thermal_management_1775109717547.png)

---

## 3. Directed-Energy Weaponry (Particle Beams & Laser Arrays)

**How It Works:**
Combat in Delta-V happens at ranges of thousands of kilometers — far too great for kinetic projectiles to be practical. At these distances, only lightspeed weapons can reliably hit a target within a single engagement window. Ship weaponry uses high-energy **Neutral Particle Beam** accelerators and **Free-Electron Laser** arrays, powered by massive capacitor banks charged from the ship's fusion reactor. A particle beam strips electrons from hydrogen or deuterium atoms, accelerates the ions to near-lightspeed through a linear accelerator, then re-neutralizes them before emission — producing a focused beam of relativistic particles that delivers devastating thermal and radiation damage on impact. Laser arrays use banks of coherent emitters phase-locked together to produce a single high-energy beam at extreme range. Both weapon types strike at lightspeed, making evasion after firing effectively impossible — consistent with the instantaneous combat resolution observed at interplanetary scale.

**Visual description:**
- Long, heavy accelerator spines mounted along the ship's keel or in turreted housings.
- Visible linear accelerator segments with thick superconducting magnet rings along the barrel length.
- Flanked by massive power conduits, capacitor banks, and cooling infrastructure.
- Laser variants appear as clusters of smaller emitter lenses behind armored shutters.
- Intense electromagnetic shielding and hazard markings around the firing axis.

![Particle Beam](./assets/particle_beam_1775109732737.png)

---

## 4. Multi-Layer Defenses (Ablative Armor & Whipple Shields)

**How It Works:**
Deep space warships face two distinct threat profiles: directed-energy beams and kinetic debris from ordnance detonations. Against beam weapons, ships use thick **Ablative Armor** — layered composite plating designed to vaporize and slough off under sustained thermal assault, carrying away energy before it reaches the hull. Against kinetic threats (torpedo fragments, mine shrapnel, micrometeorites), the outermost layer is a **Whipple Shield** — a thin, sacrificial bumper that vaporizes incoming debris on contact, spreading the impact energy over a wider area before it reaches the ablative layer beneath.

**Visual description:**
- Thick, dense, overlapping hexagonal outer plating.
- Highly utilitarian aesthetic, commonly painted in gunmetal or navy tones.
- Frequently marred with beam scoring, ablation patterns, and replaced modular segments.
- *Image details:* Armor should appear deeply gouged and melted in spots rather than just clean and factory-new, showcasing the violent reality of particle beam ablative defense.

![Ablative Armor](./assets/ablative_armor_1775109747165.png)

---

## 5. Modular Cryogenic Fuel & Cargo

**How It Works:** 
Deep space logistics requires standardized mass optimization. Fuel (liquid hydrogen and oxygen) is stored in perfect spheres—the most efficient shape for maintaining pressure with minimal material weight. To prevent the cryogenic fuel from boiling off due to solar radiation, the tanks are wrapped in highly reflective Multi-Layer Insulation (MLI).

**Visual description:**
- Clusters of perfectly spherical tanks exposed to space.
- Wrapped heavily in crinkled, highly reflective metallic silver or Kapton gold foil.
- Supported firmly by a skeletal framework of exposed, bare-metal modular trusses.

![Cryogenic Fuel](./assets/cryogenic_fuel_1775109764057.png)

---

## 6. Reaction Control Systems (RCS)

**How It Works:** 
While massive fusion drives handle main acceleration, ships still need to pitch, yaw, roll, and perform delicate docking maneuvers over short distances in zero-g. They rely on networked clusters of small, hypergolic chemical thrusters or cold-gas jets to provide this precise rotational thrust on all axes.

**Visual description:**
- Small "quad-block" thruster nozzles protruding from the corners and extremities of the hull.
- Often feature scorch marks radiating out from the tiny bells against the plating.
- Visually emits short, sharp, pale bursts of exhaust.

![RCS Thruster](./assets/rcs_thruster_1775109778774.png)

---

## 7. Photovoltaic Solar Arrays

**How It Works:** 
For vessels that don't need continuous massive fusion power (like Orbital Bases) or as auxiliary power backups, enormous deployed solar panels are used to convert sunlight directly into electricity. Because sunlight significantly weakens in deep space, these arrays must be incredibly large to generate sufficient voltage for the station's needs.

**Visual description:**
- Enormous, flat, dark-blue or black rectangular grid arrays extending far from the main hull.
- Supported by delicate-looking unfolding rigid booms and trusses.
- Highly reflective, flat, and fragile appearance compared to the armored main hull.

![Solar Arrays](./assets/solar_arrays_1775109830929.png)

---

## 8. High-Gain Communication Arrays

**How It Works:** 
In the vast, silent void of the solar system, communicating telemetry and targeting data requires highly focused, narrow-beam frequency transmissions. Large parabolic dish antennas are designed to pierce through background radiation to maintain contact with planetary bases or other ships at extreme ranges.

**Visual description:**
- Large parabolic dishes mounted on articulating mechanical gimbals.
- Extensive wiring and complex central receiver feeds bridging the center of the dish.
- Often clustered near the command deck or sensor booms to minimize signal delay.

![Comms Dish](./assets/comms_dish_1774105476101.png)

---

## 9. LiDAR and Sensor Booms

**How It Works:** 
Visual confirmation is useless at engagement ranges of thousands of kilometers. Ships rely on sophisticated active and passive sensor suites, including LiDAR (Light Detection and Ranging) arrays and thermal imaging, to detect enemies, debris, and navigation hazards. These are mounted on extendable booms to get them away from the electronic "noise" and radiation of their own primary fusion drives.

**Visual description:**
- Long, fragile-looking structural spines protruding from the prow or sides of the ship.
- Tipped with irregular, geometric sensor heads, domed cameras, and flat phased-array radar panels.
- Highly detailed, asymmetrical, and purely utilitarian visual clutter.

![Sensor Boom](./assets/sensor_spine_1774105490297.png)

---

## 10. Point Defense Cannons (PDCs)

**How It Works:** 
Directly extrapolated from modern naval Close-In Weapon Systems (CIWS) like the Phalanx, PDCs are fast-tracking rotary cannons designed as a ship's last line of defense. They fire curtains of solid tungsten slugs or proximity-fused flak intended to physically shred large, slower-moving ordnance before they hit the hull. Note: In gameplay mechanics, standard ship guns doubling as PDCs are exclusively capable of intercepting and destroying incoming Nuclear warheads; standard torpedoes and kinetic mines are generally unaffected by PDC defensive fire.

**Visual description:**
- Small, aggressively spiked multi-barreled rotary cannons housed in armored turrets.
- Mounted on extremely fast-turning spherical or pivoting gimbals scattered across the hull to provide 360-degree overlapping fields of fire.
- Thick, heavy ammunition feed tracks leading down into the ship's magazines.
- *Image details:* Visually emphasize the frenetic mechanical activity of a PDC tracking a target, with brief but intense swarms of tracer fire creating a localized defensive screen.

![Point Defense Cannon](./assets/rotary_cannon_1774105506192.png)

---

## 11. Ordnance: Mines, Torpedoes, and Nukes

**How It Works:** 
Because stealth is limited in hot-drive space combat, engagements emphasize kinematics, timing, and interception windows. In gameplay terms, Delta-V uses three ordnance classes (`mine`, `torpedo`, `nuke`) with distinct mass, launch constraints, and resolution behavior.

**Visual description:**
- Deeply recessed, flush-mounted clusters of hexagonal or cylindrical launch tubes built directly into the armor plating.
- Often glowing amber or red from internal pre-heating before a launch sequence.
- Clean, heavy-duty armored hatch covers meant to protect unfired ordnance from glancing blows.
- *Image details (Mines):* Simple, stealthy geometric packages (often radar-absorbent faceted shapes) that detach and remain completely inert until proximity triggers them.
- *Image details (Torpedoes):* Slender, hyper-accelerating kinetic darts with bright initial chemical-booster plumes designed to boost 1-2 hexes off the launch rail before transitioning to primary drive.
- *Image details (Nukes):* Heavy, bloated warheads with thick armored casings, deployed defensively or as devastating area-denial weapons capable of cratering moons and vaporizing asteroid fields.

![Ordnance](./assets/missile_tubes_1774105521423.png)

---

## Reality Anchors & Further Reading

These references are not one-to-one blueprints for Delta-V ships, but they are the real-world technical anchors behind the visual language and fiction:

- [NASA Glenn: Specific Impulse](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/) for the propulsion tradeoff Delta-V extrapolates into torch-drive fiction
- [NASA JSC Hypervelocity Impact Technology](https://hvit.jsc.nasa.gov/shield-development/) for the real shielding and impact environment behind Whipple-shield-inspired defenses
- [NASA: Europa Clipper gets super-size solar arrays](https://www.nasa.gov/missions/europa-clipper/nasas-europa-clipper-gets-set-of-super-size-solar-arrays/) for the scale logic behind large deep-space photovoltaic surfaces
- [NASA Deep Space Network](https://www.nasa.gov/directorates/heo/scan/services/networks/deep_space_network) for the communications model behind large high-gain arrays
- [NASA Airborne Science: LiDAR](https://airbornescience.nasa.gov/category/type/Lidar) for the sensing concepts behind active ranging and long sensor booms

---

## Maintenance note

Concept art assets have been embedded above representing a cohesive, symmetrical NASA-punk visual direction. Keep these synchronized with any gameplay revisions.
