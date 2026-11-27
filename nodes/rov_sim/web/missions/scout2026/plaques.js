// plaques.js — the little signs on the pool floor beside each prop (key P / the Labels button): the task number, what the prop is, and the real-world thing it stands for.
// Wall-relative spots like layout.js (u out from the wall, v to the left). Edit the words here. No DOM, no three.js (the view draws them).
export const PLAQUES = [
  { id: "p11a", task: "1.1", title: "Basket star", text: "Collect it and bring it to the deck.", real: "Real world: basket stars live in cold-water coral gardens on the seabed (the Seabed 2030 mapping project).", spot: [1.35, 1.4] },
  { id: "p11b", task: "1.1", title: "Basket star", text: "Collect it and bring it to the deck.", real: "Real world: scientists sample animals like this to learn what lives on the ocean floor.", spot: [2.65, -1.5] },
  { id: "p11c", task: "1.1", title: "Coral", text: "Lift it by its branches to the deck.", real: "Real world: cold-water corals build gardens that shelter fish and other animals.", spot: [2.1, 1.35] },
  { id: "p11d", task: "1.1", title: "Coral", text: "Lift it by its branches to the deck.", real: "Real world: ROVs can take small samples without damaging the reef.", spot: [3.6, -1.1] },
  { id: "p12", task: "1.2", title: "Transect", text: "Fly the 3.1 m pipe end to end, staying over it.", real: "Real world: researchers fly a straight line over the seabed and count what they see.", spot: [0.6, 0.55] },
  { id: "p21a", task: "2.1", title: "Green crab", text: "Remove it: bring it to the deck.", real: "Real world: the European green crab is an invasive species that harms eelgrass and shellfish.", spot: [0.95, -1.45] },
  { id: "p21b", task: "2.1", title: "Green crab", text: "Remove it: bring it to the deck.", real: "Real world: ROV teams help map and remove invasive crabs.", spot: [3.7, 1.45] },
  { id: "p22", task: "2.2", title: "Iceberg", text: "Press a marker onto each leg's Velcro.", real: "Real world: SmartAtlantic buoys and ROVs track icebergs that could threaten an oil platform.", spot: [0.8, -2.7] },
  { id: "p23", task: "2.3", title: "Lobster pot", text: "Push the red handle round: the buoy floats up.", real: "Real world: a sonar-release pot has no rope hanging in the water for whales to tangle in.", spot: [4.7, -2.2] },
  { id: "p24a", task: "2.4", title: "eDNA sensors", text: "Old one to the deck; new one upright in the yellow square.", real: "Real world: eDNA sensors detect DNA that animals leave in the water, to count which species are there.", spot: [1.3, -2.2] },
  { id: "p24b", task: "2.4", title: "Observatory", text: "Plug the connector into the black port.", real: "Real world: the Holyrood subsea observatory takes power and data from sensors on the seabed.", spot: [3.0, -2.2] },
  { id: "p31a", task: "3.1", title: "Power connector", text: "Lift it off the stand (the wire is 4 m long).", real: "Real world: a wind farm sends its electricity to an offshore platform through a subsea cable.", spot: [1.4, 2.2] },
  { id: "p31b", task: "3.1", title: "Waypoint", text: "Run the wire between the four posts.", real: "Real world: cables are laid along a planned route, not just anywhere.", spot: [3.0, 2.2] },
  { id: "p31c", task: "3.1", title: "Oil platform port", text: "Push the Velcro tip into the port.", real: "Real world: the connection that powers an offshore oil platform from wind turbines.", spot: [4.7, 2.2] },
];
