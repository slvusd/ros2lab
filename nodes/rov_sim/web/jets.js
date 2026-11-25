// =============================================================================
// jets.js — OPTIONAL add-on: draws the two water outlets in the side wall and the water streaming out of them.
// To remove: delete this file and ../rov_current.py (and sim/current.js). app.js loads it with a dynamic import() that quietly does nothing
// if the file is missing; it only looks at the state.props entry whose type is "jets", so nothing else in the page knows about the current.
// The stream is a cloud of small bubbles. Each one moves with the SAME water speed the physics uses (axial speed from u0 / k, a Gaussian across
// the jet, spreading as r0 + spread * distance: the numbers come in the state), so what you see is the current the ROV feels.
// =============================================================================
const PER_JET = 260;

export class Jets {
  /** `opts.ripple(x, z, radius, strength)`, if given, is called now and then to disturb the water surface where the stream wells up (the page owns the wave simulation). */
  constructor(scene, THREE, opts = {}) {
    this.scene = scene;
    this.T = THREE;
    this.sys = null;
    this.ripple = opts.ripple || null;
    this.rippleT = 0;
  }

  gauss() { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return (u - 2) * 1.7320508; }      // ~ a normal random number (sum of 4 uniforms)

  /** A soft round dot, so a bubble that is close to the camera looks like a bubble and not a hard square. */
  bubbleTexture() {
    if (this._tex) return this._tex;
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d"), grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
    grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.55, "rgba(255,255,255,0.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    return (this._tex = new this.T.CanvasTexture(c));
  }

  respawn(j, i, s = 0.18) {                // (0.18 m: just beyond the nozzle)
    j.s[i] = s; j.lx[i] = this.gauss(); j.ly[i] = this.gauss();
  }

  build(p) {
    const T = this.T, group = new T.Group();
    const pipe = new T.MeshStandardMaterial({ color: 0x6d7a84, roughness: 0.55 }), rim = new T.MeshStandardMaterial({ color: 0xe0e6ea, roughness: 0.35, metalness: 0.3 });
    const hole = new T.MeshBasicMaterial({ color: 0x0a2030 });
    const sys = [];
    for (const o of p.outlets) {
      const dir = new T.Vector3(o.dx, 0, -o.dy).normalize();                // sim (x, y) is three (x, -z)
      const side = new T.Vector3(-dir.z, 0, dir.x);                         // across the pool, level
      const origin = new T.Vector3(o.x, -o.depth, -o.y);
      const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
      const stub = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.16, 24), pipe);      // a pipe stub out of the wall ...
      stub.position.copy(origin).addScaledVector(dir, 0.08); stub.quaternion.copy(q);
      const ring = new T.Mesh(new T.CylinderGeometry(0.095, 0.095, 0.03, 24), rim);       // ... with a collar at its end
      ring.position.copy(origin).addScaledVector(dir, 0.15); ring.quaternion.copy(q);
      const mouth = new T.Mesh(new T.CircleGeometry(0.055, 24), hole);                      // and the dark opening
      mouth.position.copy(origin).addScaledVector(dir, 0.166); mouth.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
      group.add(stub, ring, mouth);

      const geo = new T.BufferGeometry(), pos = new Float32Array(PER_JET * 3);
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ color: 0xdcf2ff, size: 0.04, map: this.bubbleTexture(), transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true }));
      pts.frustumCulled = false;                                            // the points move around: never cull on the empty first bounding box
      group.add(pts);
      const j = { dir, side, origin, pos, geo, s: new Float32Array(PER_JET), lx: new Float32Array(PER_JET), ly: new Float32Array(PER_JET) };
      for (let i = 0; i < PER_JET; i++) this.respawn(j, i, 0.18 + Math.random() * p.length * 0.6);
      sys.push(j);
    }
    this.scene.add(group);
    this.group = group;
    this.sys = sys;
  }

  update(list, dt) {                       // list = state.props from the sim
    const p = (list || []).find((q) => q.type === "jets");
    if (!p) { if (this.group) this.group.visible = false; return; }
    if (!this.sys) this.build(p);
    this.group.visible = true;
    dt = Math.min(dt, 0.05);
    if (this.ripple) {                                                     // the stream wells up and ruffles the surface above it, mostly over the upper jet, further out
      this.rippleT += dt;
      while (this.rippleT > 0.12) {
        this.rippleT -= 0.12;
        for (const j of this.sys) {
          const s = 0.5 + Math.random() * (p.length * 0.8 - 0.5), b = p.r0 + p.spread * s, depth = -j.origin.y;
          if (Math.random() > Math.exp(-(depth * depth) / (b * b))) continue;       // the deeper the jet and the narrower the stream, the less it reaches the surface
          const lat = this.gauss() * b * Math.SQRT1_2;
          this.ripple(j.origin.x + j.dir.x * s + j.side.x * lat, j.origin.z + j.dir.z * s + j.side.z * lat, 0.05, 0.12);
        }
      }
    }
    for (const j of this.sys) {
      for (let i = 0; i < PER_JET; i++) {
        let s = j.s[i];
        const b = p.r0 + p.spread * Math.max(s, 0), bx = j.lx[i] * b * Math.SQRT1_2, by = j.ly[i] * b * Math.SQRT1_2;
        const u = (s * p.u0 <= p.k ? p.u0 : p.k / s) * Math.exp(-(bx * bx + by * by) / (b * b));      // the same formula as rov_current.py
        s += u * dt;
        if (s > p.length) { this.respawn(j, i); s = 0.18; }
        j.s[i] = s;
        const b2 = p.r0 + p.spread * s;
        const ox = j.lx[i] * b2 * Math.SQRT1_2, oy = j.ly[i] * b2 * Math.SQRT1_2;
        j.pos[i * 3] = j.origin.x + j.dir.x * s + j.side.x * ox;
        j.pos[i * 3 + 1] = Math.min(-0.04, Math.max(-(p.floor - 0.05), j.origin.y + oy));       // a wide jet must not spill above the surface or below the floor
        j.pos[i * 3 + 2] = j.origin.z + j.dir.z * s + j.side.z * ox;
      }
      j.geo.attributes.position.needsUpdate = true;
    }
  }
}
