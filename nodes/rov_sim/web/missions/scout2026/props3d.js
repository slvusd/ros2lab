// props3d.js — draws the 2026 SCOUT props from their state (the page loads it only for ?mission=scout2026; delete web/missions/ to remove). three.js axes: x ahead, y up, z = -sim y.
// Items are built once (a group whose origin is the middle of the prop's BASE) and moved with the state. Sizes follow the prop building instructions.
import { PVC_R, pipe, standard } from "../common/view3d.js";

export class MissionView {
  constructor(scene, THREE) {
    this.scene = scene; this.T = THREE; this.items = new Map(); this.transect = null; this.iceberg = null; this.deck = null;
    this.white = standard(THREE, 0xf2f2ec); this.glow = new THREE.MeshStandardMaterial({ color: 0x31d46b, emissive: 0x0a4a22, roughness: 0.5 });
  }

  // ---- the carryable props
  basketStar() {
    const T = this.T, g = new T.Group(), w = this.white;
    const bar = pipe(T, [-0.05, 0.011, 0], [0.05, 0.011, 0], PVC_R, w); g.add(bar);                                       // the H: a 10 cm crossbar ...
    for (const sx of [-0.05, 0.05]) g.add(pipe(T, [sx, 0.011, -0.05], [sx, 0.011, 0.05], PVC_R, w));                      // ... between two tees with 5 cm stubs each way
    const lattice = new T.Mesh(new T.IcosahedronGeometry(0.05, 1), new T.MeshStandardMaterial({ color: 0xff7a1a, wireframe: true }));
    lattice.position.y = 0.08; g.add(lattice);                                                                            // the O-ball (a plastic lattice ball)
    const shell = new T.Mesh(new T.SphereGeometry(0.047, 14, 10), new T.MeshStandardMaterial({ color: 0xffb36b, transparent: true, opacity: 0.25 }));
    shell.position.y = 0.08; g.add(shell);
    return g;
  }
  coral(seed) {
    const T = this.T, g = new T.Group(), tee = standard(T, 0x2fa84f);
    g.add(pipe(T, [0, 0.0, 0], [0, 0.045, 0], PVC_R, tee)); g.add(pipe(T, [-0.03, 0.03, 0], [0.03, 0.03, 0], PVC_R * 0.9, tee));          // the green tee
    const cols = [0xff4fa0, 0xffd23f, 0xff7a3d, 0xc65bff];
    let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };
    for (let i = 0; i < 8; i++) {                                                                                         // pipe cleaners: a 30 cm trunk and 15 cm branches
      const a = rnd() * Math.PI * 2, tilt = i === 0 ? 0.0 : 0.35 + rnd() * 0.6, len = i === 0 ? 0.27 : 0.12 + rnd() * 0.08, base = i === 0 ? 0.04 : 0.09 + rnd() * 0.1;
      const p0 = [Math.sin(a) * 0.01, base, Math.cos(a) * 0.01];
      const p1 = [p0[0] + Math.sin(a) * Math.sin(tilt) * len, base + Math.cos(tilt) * len, p0[2] + Math.cos(a) * Math.sin(tilt) * len];
      g.add(pipe(T, p0, p1, 0.0035, standard(T, cols[i % cols.length], 0.8), 6));
    }
    return g;
  }
  crab() {
    const T = this.T, g = new T.Group(), cap = standard(T, 0x3f8f3a, 0.6), legs = standard(T, 0x161616, 0.8);
    const body = new T.Mesh(new T.CylinderGeometry(0.024, 0.024, 0.04, 16), cap); body.position.y = 0.02; g.add(body);        // the 1 1/2" end cap, open side down
    for (let i = 0; i < 8; i++) {                                                                                            // eight legs (four pipe cleaners bent in two)
      const side = i < 4 ? 1 : -1, k = i % 4, a = (k - 1.5) * 0.45;
      const p0 = [Math.cos(a) * 0.02, 0.025, side * Math.sin(Math.abs(a) + 1.2) * 0.02];
      g.add(pipe(T, p0, [p0[0] + Math.cos(a) * 0.06, 0.07, p0[2] + side * 0.11], 0.0028, legs, 6));
      g.add(pipe(T, [p0[0] + Math.cos(a) * 0.06, 0.07, p0[2] + side * 0.11], [p0[0] + Math.cos(a) * 0.08, 0.005, p0[2] + side * 0.17], 0.0028, legs, 6));
    }
    for (const side of [-1, 1]) {                                                                                           // two claws, twisted and bent
      g.add(pipe(T, [0.02, 0.03, side * 0.02], [0.09, 0.055, side * 0.05], 0.0045, legs, 6));
      const pincer = new T.Mesh(new T.SphereGeometry(0.014, 8, 6), cap); pincer.position.set(0.1, 0.058, side * 0.055); g.add(pincer);
    }
    for (const side of [-1, 1]) { const eye = new T.Mesh(new T.SphereGeometry(0.005, 6, 5), legs); eye.position.set(0.022, 0.045, side * 0.012); g.add(eye); }
    return g;
  }
  marker() {
    const T = this.T, g = new T.Group(), w = this.white;
    const disc = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.01, 20), standard(T, 0x6d6d6d)); disc.position.y = 0.005; g.add(disc);        // the 3" knockout cap
    const patch = new T.Mesh(new T.BoxGeometry(0.025, 0.004, 0.025), standard(T, 0x111111)); patch.position.y = 0.012; g.add(patch);               // Velcro loops
    g.add(pipe(T, [0, 0.01, 0], [0, 0.11, 0], PVC_R, w));                                                                                           // the 10 cm pipe
    const rope = new T.Mesh(new T.TorusGeometry(0.05, 0.003, 6, 20), standard(T, 0x2f6fe0, 0.9)); rope.position.y = 0.16; g.add(rope);              // the rope loop
    return g;
  }
  buildIceberg(p) {
    const T = this.T, g = new T.Group(), w = this.white, h = p.side / 2;
    const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; g.add(pipe(T, [a[0], -0.01, a[1]], [b[0], -0.01, b[1]], PVC_R, w)); }       // the square frame
    const wrap = new T.Mesh(new T.BoxGeometry(p.side, 0.004, p.side), new T.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.45, roughness: 0.2 }));
    wrap.position.y = -0.005; g.add(wrap);                                                                                                         // bubble wrap on top
    for (const [lx, lz] of [[h, -h], [-h, h]]) {                                                                                                   // two 25 cm legs; Velcro hooks on their lower ends
      g.add(pipe(T, [lx, -0.01, lz], [lx, -p.leg, lz], PVC_R, w));
      g.add(pipe(T, [lx, -p.leg + 0.05, lz], [lx, -p.leg, lz], PVC_R * 1.5, standard(T, 0x222222, 0.9)));
    }
    g.add(pipe(T, [-h, -0.01, -h], [-h, -0.01, -h - 1.2], PVC_R, w));                                                                              // the pole from the wall (it ends at the corner)
    this.scene.add(g);
    return g;
  }
  build(p) {
    const g = p.kind === "basket_star" ? this.basketStar() : p.kind === "coral" ? this.coral(p.id) : p.kind === "crab" ? this.crab() : p.kind === "marker" ? this.marker()
      : new this.T.Mesh(new this.T.BoxGeometry(0.1, 0.1, 0.1), standard(this.T, 0xcccccc));                                // (unknown kind: a plain box)
    this.scene.add(g);
    return g;
  }

  // ---- the transect: a 3.1 m "I" on the floor
  buildTransect(p, floor) {
    const T = this.T, g = new T.Group(), w = this.white;
    const [a, b] = [[p.a[0], -p.a[1]], [p.b[0], -p.b[1]]];
    g.add(pipe(T, [a[0], 0.012, a[1]], [b[0], 0.012, b[1]], PVC_R, w));
    for (const e of [a, b]) g.add(pipe(T, [e[0], 0.012, e[1] - 0.15], [e[0], 0.012, e[1] + 0.15], PVC_R, w));                 // a 30 cm crossbar at each end
    this.scene.add(g);
    return g;
  }

  // ---- the crew's table on the deck, where handed-over things sit
  buildDeck(m) {
    const T = this.T, d = m.deck, g = new T.Mesh(new T.BoxGeometry(d[1] - d[0], 0.05, d[3] - d[2]), standard(T, 0xb8c2c8, 0.8));
    g.position.set((d[0] + d[1]) / 2, 0.035, -(d[2] + d[3]) / 2);
    this.scene.add(g);
    return g;
  }

  update(list, dt, t, floorAt = () => 3) {
    const m = (list || []).find((p) => p.type === "mission");
    if (m && m.deck && !this.deck) this.deck = this.buildDeck(m);
    for (const p of list || []) {
      if (p.type === "m_item") {
        let g = this.items.get(p.id);
        if (!g) { g = this.build(p); this.items.set(p.id, g); }
        const y = p.mode === "deck" ? 0.06 : -p.depth;
        g.position.set(p.x, y, -p.y);
        g.rotation.y = p.yaw;
      } else if (p.type === "m_iceberg") {
        if (!this.iceberg) this.iceberg = this.buildIceberg(p);
        this.iceberg.position.set(p.x, 0, -p.y);
      } else if (p.type === "m_transect") {
        if (!this.transect) { this.transect = this.buildTransect(p, floorAt(p.a[0], -p.a[1])); this.transectFloor = null; }
        this.transect.position.y = -(floorAt(p.a[0], -p.a[1]));
        this.transect.children.forEach((c) => { c.material = p.done ? this.glow : p.armed ? this.glow : this.white; });
      }
    }
  }
}
