/**
 * Landing page 3D warehouse (Three.js). An isometric floor with racks full
 * of cartons, a dock, a delivery truck, a forklift and a packing table.
 * The scroll story scrubs it through four steps (the scene follows the scroll
 * position both ways, so it never runs ahead of or behind the reader):
 *   1 Receive  - the truck backs up to the dock and a pallet is unloaded
 *   2 Store    - the forklift carries the pallet to the racks, shelves fill up
 *   3 Pick     - a carton is scanned (pulse), lifted to the packing table
 *   4 Ship     - the packed carton goes into the truck and the truck leaves
 * Colours come from the page's design tokens and follow the theme.
 */
import * as THREE from '/vendor/three/three.module.js';

const container = document.getElementById('stage3d');
const gsap = window.gsap;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

if (container && webglAvailable()) main();

function main() {
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || '#888888';
  const palette = () => ({
    floor: token('sunken'),
    wall: token('surface'),
    ink: token('ink'),
    line: token('line-2'),
    accent: token('accent'),
    muted: token('muted'),
    ok: token('ok'),
  });

  /* ---------------------------- renderer ---------------------------- */

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  container.classList.add('is-ready');

  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);

  const VIEW = 24; // world units visible vertically
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const CAM_OFFSET = new THREE.Vector3(30, 26, 30);
  const camTarget = new THREE.Vector3(0, 0, 0);
  const cam = { s: 0 }; // camera position along the story: 0 = hero ... 4 = ship

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.left = (-VIEW * aspect) / 2;
    camera.right = (VIEW * aspect) / 2;
    camera.top = VIEW / 2;
    camera.bottom = -VIEW / 2;
    camera.updateProjectionMatrix();
    frames = null; // re-fit the camera for the new size
    requestRender();
  }

  /* ----------------------------- lights ----------------------------- */

  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b6250, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-14, 28, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.bias = -0.0008;
  sun.shadow.radius = 3;
  scene.add(sun);

  /* ---------------------------- materials --------------------------- */

  const mat = {
    floor: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    drive: new THREE.MeshStandardMaterial({ roughness: 1 }),
    wall: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    ink: new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }),
    accent: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 }),
    lane: new THREE.MeshBasicMaterial(),
    carton: new THREE.MeshStandardMaterial({ color: 0xd8a863, roughness: 0.85 }),
    tape: new THREE.MeshStandardMaterial({ color: 0xf3d9a4, roughness: 0.7 }),
    truckBody: new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2b3a4a, roughness: 0.2, metalness: 0.6 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xa47a48, roughness: 0.9 }),
    pulse: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide }),
  };

  function applyTheme() {
    const p = palette();
    mat.floor.color.set(p.floor);
    mat.drive.color.set(p.line);
    mat.wall.color.set(p.wall);
    mat.ink.color.set(p.ink);
    mat.accent.color.set(p.accent);
    mat.lane.color.set(p.accent);
    mat.pulse.color.set(p.accent);
    const dark = document.documentElement.dataset.theme === 'dark';
    hemi.intensity = dark ? 1.1 : 1.6;
    sun.intensity = dark ? 1.7 : 2.2;
    requestRender();
  }

  const box = (w, h, d, material, cast = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  };

  /* ------------------------------ floor ----------------------------- */

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 24), mat.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-2, 0, 0);
  floor.receiveShadow = true;
  world.add(floor);

  const drive = new THREE.Mesh(new THREE.PlaneGeometry(22, 8), mat.drive);
  drive.rotation.x = -Math.PI / 2;
  drive.position.set(22, -0.01, 5);
  drive.receiveShadow = true;
  world.add(drive);

  // Safety lanes painted on the floor
  [[-2, -3.9, 20, 0.14], [-2, 3.3, 20, 0.14], [9.8, 5, 0.18, 7]].forEach(([x, z, w, d]) => {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat.lane);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(x, 0.01, z);
    world.add(lane);
  });

  // Back walls (low, so we can see inside)
  const wallBack = box(26, 3.2, 0.3, mat.wall);
  wallBack.position.set(-2, 1.6, -12);
  world.add(wallBack);
  const wallLeft = box(0.3, 3.2, 24, mat.wall);
  wallLeft.position.set(-15, 1.6, 0);
  world.add(wallLeft);

  // Dock edge with hazard stripes (canvas texture)
  const hz = document.createElement('canvas');
  hz.width = 64;
  hz.height = 16;
  const g = hz.getContext('2d');
  for (let i = -2; i < 10; i++) {
    g.fillStyle = i % 2 ? '#15171b' : '#ffb020';
    g.beginPath();
    g.moveTo(i * 8, 16);
    g.lineTo(i * 8 + 8, 0);
    g.lineTo(i * 8 + 16, 0);
    g.lineTo(i * 8 + 8, 16);
    g.fill();
  }
  const hzTex = new THREE.CanvasTexture(hz);
  hzTex.wrapS = THREE.RepeatWrapping;
  hzTex.repeat.set(4, 1);
  hzTex.colorSpace = THREE.SRGBColorSpace;
  const dockEdge = box(0.35, 0.35, 8, new THREE.MeshStandardMaterial({ map: hzTex, roughness: 0.8 }), false);
  dockEdge.position.set(10.6, 0.17, 5);
  world.add(dockEdge);

  /* ------------------------------ racks ----------------------------- */

  const RACK_ROWS = [-7.5, -0.5]; // z of each rack row
  const BAYS = 3;
  const LEVELS = 3;
  const PER = 3; // cartons per bay per level
  const RACK_X0 = -11;
  const BAY_W = 4;
  const slots = [];
  RACK_ROWS.forEach((z) => {
    for (let b = 0; b <= BAYS; b++) {
      [z - 0.9, z + 0.9].forEach((pz) => {
        const post = box(0.16, 5.4, 0.16, mat.accent);
        post.position.set(RACK_X0 + b * BAY_W, 2.7, pz);
        world.add(post);
      });
    }
    for (let l = 0; l < LEVELS; l++) {
      const shelf = box(BAYS * BAY_W + 0.2, 0.1, 1.9, mat.ink);
      shelf.position.set(RACK_X0 + (BAYS * BAY_W) / 2, 0.35 + l * 1.75, z);
      world.add(shelf);
      for (let b = 0; b < BAYS; b++) {
        for (let k = 0; k < PER; k++) {
          slots.push(new THREE.Vector3(RACK_X0 + b * BAY_W + 0.75 + k * 1.25, 0.35 + l * 1.75 + 0.55, z));
        }
      }
    }
  });

  // Cartons on the racks (one instanced mesh)
  const cartonGeo = new THREE.BoxGeometry(1.05, 1, 1.35);
  const cartons = new THREE.InstancedMesh(cartonGeo, mat.carton, slots.length);
  cartons.castShadow = true;
  cartons.receiveShadow = true;
  world.add(cartons);
  const rng = (i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1; // stable pseudo-random
  const filled = slots.map((_, i) => rng(i) < 0.58); // initial stock
  const later = slots.map((_, i) => !filled[i] && rng(i + 99) < 0.75); // arrive in step 2
  const scaleOf = slots.map((_, i) => (filled[i] ? 1 : 0));
  const tmp = new THREE.Object3D();
  const tint = new THREE.Color();
  function writeCartons() {
    slots.forEach((p, i) => {
      const s = scaleOf[i];
      tmp.position.copy(p);
      tmp.position.y = p.y - 0.5 + 0.5 * Math.max(s, 0.001);
      tmp.rotation.y = (rng(i + 7) - 0.5) * 0.12;
      tmp.scale.set(1, Math.max(s, 0.001), 1).multiplyScalar(0.9 + rng(i + 3) * 0.12);
      tmp.updateMatrix();
      cartons.setMatrixAt(i, tmp.matrix);
    });
    cartons.instanceMatrix.needsUpdate = true;
  }
  slots.forEach((_, i) => cartons.setColorAt(i, tint.setHSL(0.09 + rng(i + 11) * 0.02, 0.5, 0.58 + rng(i + 5) * 0.08)));
  writeCartons();

  // The carton that gets picked in step 3 (a separate mesh so it can fly)
  const pickSlot = slots.findIndex((_, i) => filled[i] && slots[i].z === RACK_ROWS[1] && slots[i].y < 1.5);
  const picked = box(1.05, 1, 1.35, mat.carton);
  picked.position.copy(slots[pickSlot]);
  picked.visible = false;
  world.add(picked);
  const pickedTape = box(1.07, 0.06, 0.3, mat.tape, false);
  pickedTape.position.y = 0.52;
  pickedTape.visible = false;
  picked.add(pickedTape);

  // Scan pulse ring
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), mat.pulse);
  pulse.rotation.x = -Math.PI / 2;
  world.add(pulse);

  /* --------------------------- packing table ------------------------ */

  const table = new THREE.Group();
  const top = box(3, 0.15, 1.8, mat.wall);
  top.position.y = 1.1;
  table.add(top);
  [[-1.35, -0.75], [1.35, -0.75], [-1.35, 0.75], [1.35, 0.75]].forEach(([x, z]) => {
    const leg = box(0.12, 1.1, 0.12, mat.ink);
    leg.position.set(x, 0.55, z);
    table.add(leg);
  });
  const tapeRoll = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.1, 10, 20), mat.accent);
  tapeRoll.position.set(1, 1.35, 0.4);
  tapeRoll.castShadow = true;
  table.add(tapeRoll);
  table.position.set(1.5, 0, 7.8);
  world.add(table);

  /* ------------------------------ pallet ---------------------------- */

  const pallet = new THREE.Group();
  const deck = box(2.2, 0.25, 1.8, mat.wood);
  deck.position.y = 0.13;
  pallet.add(deck);
  const palletCartons = [];
  [[-0.52, 0.8, -0.42], [0.52, 0.8, -0.42], [-0.52, 0.8, 0.42], [0.52, 0.8, 0.42], [0, 1.75, 0]].forEach(([x, y, z]) => {
    const c = box(1, 0.95, 0.8, mat.carton);
    c.position.set(x, y - 0.1, z);
    pallet.add(c);
    palletCartons.push(c);
  });
  pallet.position.set(8.3, 0, 5);
  pallet.scale.setScalar(0.001);
  world.add(pallet);

  /* ------------------------------ truck ----------------------------- */

  const truck = new THREE.Group();
  const cargo = box(6.2, 3.2, 2.7, mat.truckBody);
  cargo.position.set(3.1, 2.1, 0);
  truck.add(cargo);
  const stripe = box(6.22, 0.4, 2.72, mat.accent, false);
  stripe.position.set(3.1, 1.2, 0);
  truck.add(stripe);
  const cab = box(2.2, 2.5, 2.7, mat.accent);
  cab.position.set(7.4, 1.75, 0);
  truck.add(cab);
  const windshield = box(0.1, 1, 2.3, mat.glass, false);
  windshield.position.set(8.52, 2.3, 0);
  truck.add(windshield);
  const chassis = box(9, 0.3, 2.3, mat.ink);
  chassis.position.set(4.3, 0.6, 0);
  truck.add(chassis);
  const wheels = [];
  [[1.2, 1.25], [1.2, -1.25], [2.6, 1.25], [2.6, -1.25], [7.4, 1.25], [7.4, -1.25]].forEach(([x, z]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 18), mat.tyre);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.55, z);
    w.castShadow = true;
    truck.add(w);
    wheels.push(w);
  });
  const TRUCK_PARKED = 11.2;
  const TRUCK_AWAY = 42;
  truck.position.set(TRUCK_AWAY, 0, 5);
  world.add(truck);

  /* ----------------------------- forklift --------------------------- */

  const lift = new THREE.Group();
  const body = box(1.9, 1.1, 1.4, mat.accent);
  body.position.set(0, 0.85, 0);
  lift.add(body);
  const counterweight = box(0.5, 1, 1.4, mat.ink);
  counterweight.position.set(-1, 0.85, 0);
  lift.add(counterweight);
  const cagePosts = [[-0.7, 0.55], [-0.7, -0.55], [0.6, 0.55], [0.6, -0.55]];
  cagePosts.forEach(([x, z]) => {
    const p = box(0.08, 1.5, 0.08, mat.ink);
    p.position.set(x, 2.1, z);
    lift.add(p);
  });
  const roof = box(1.5, 0.08, 1.3, mat.ink);
  roof.position.set(-0.05, 2.85, 0);
  lift.add(roof);
  const mast = box(0.18, 3.2, 1.1, mat.ink);
  mast.position.set(1.05, 1.6, 0);
  lift.add(mast);
  const forks = new THREE.Group();
  [[0.45], [-0.45]].forEach(([z]) => {
    const f = box(1.5, 0.08, 0.2, mat.ink);
    f.position.set(1.85, 0.1, z);
    forks.add(f);
  });
  lift.add(forks);
  [[-0.6, 0.72], [-0.6, -0.72], [0.6, 0.72], [0.6, -0.72]].forEach(([x, z]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14), mat.tyre);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.34, z);
    w.castShadow = true;
    lift.add(w);
  });
  const LIFT_HOME = new THREE.Vector3(4, 0, 1.6);
  lift.position.copy(LIFT_HOME);
  lift.rotation.y = Math.PI; // facing the racks (-x)
  world.add(lift);

  /* ---------------------------- rendering --------------------------- */

  let needsRender = true;
  let frames = null; // fitted camera per step (depends on the canvas size)
  let visible = true;
  let faded = false; // canvas faded out below the story
  let pointerX = 0;
  let pointerY = 0;
  const clock = new THREE.Clock();
  function requestRender() {
    needsRender = true;
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!visible || faded) return;
    const t = clock.getElapsedTime();
    // Subtle parallax with the pointer, plus a slow idle sway
    const targetRy = pointerX * 0.06 + (reduced ? 0 : Math.sin(t * 0.25) * 0.025);
    const targetRx = pointerY * 0.02;
    world.rotation.y += (targetRy - world.rotation.y) * 0.06;
    world.rotation.x += (targetRx - world.rotation.x) * 0.06;
    if (Math.abs(targetRy - world.rotation.y) > 0.0005 || Math.abs(targetRx - world.rotation.x) > 0.0005) needsRender = true;
    if (!reduced) needsRender = true; // idle sway keeps the scene alive
    if (!needsRender) return;
    needsRender = false;

    // Camera: blend between the fitted framings of the two nearest steps
    if (!frames) frames = FOCUS.map(fit);
    const i = Math.min(Math.floor(cam.s), frames.length - 2);
    const k = Math.min(1, cam.s - i);
    const a = frames[i];
    const b = frames[i + 1];
    camTarget.lerpVectors(a.target, b.target, k);
    camera.position.copy(camTarget).add(CAM_OFFSET);
    camera.lookAt(camTarget);
    camera.zoom = a.zoom + (b.zoom - a.zoom) * k;
    camera.updateProjectionMatrix();
    // Truck wheels roll with the truck
    wheels.forEach((w) => (w.rotation.y = (truck.position.x - TRUCK_PARKED) / 0.55));
    renderer.render(scene, camera);
  }

  window.addEventListener('pointermove', (e) => {
    pointerX = e.clientX / window.innerWidth - 0.5;
    pointerY = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });
  new ResizeObserver(resize).observe(container);
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting && getComputedStyle(container).opacity !== '0';
  }).observe(container);
  document.addEventListener('stocksense:theme', applyTheme);

  applyTheme();
  resize();
  requestAnimationFrame(frame);

  /* --------------------------- camera framing ------------------------ */

  // What each step must keep on screen. The camera is fitted to these points
  // for the current canvas size, so nothing is cut off on any screen.
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const truckAt = (x) => [V(x - 0.2, 0, 3.6), V(x + 9.4, 0, 6.4), V(x - 0.2, 3.8, 3.6), V(x + 9.4, 3.8, 6.4)];
  const RACKS = [V(-11.2, 0, -8.6), V(1.2, 0, -8.6), V(-11.2, 0, 0.5), V(1.2, 0, 0.5), V(-11.2, 5.6, -8.6), V(1.2, 5.6, 0.5)];
  const FOCUS = [
    [V(-15, 0, -12), V(10.8, 0, -12), V(-15, 0, 12), V(10.8, 0, 12), V(-15, 3.2, -12), ...RACKS], // hero: the whole building
    [V(3, 0, 1.5), V(9.5, 0, 8.5), V(7, 2.2, 5), ...truckAt(TRUCK_PARKED)], // receive: dock + truck
    [...RACKS, V(9.5, 0, 6.5), V(4, 0, 1)], // store: dock to racks
    [V(-11.2, 0, -1.6), V(1.2, 0, -1.6), V(-11.2, 4, 0.5), V(0, 0, 9), V(3.2, 1.6, 9), V(-4, 0, 3)], // pick: rack to table
    [V(0, 0, 6.5), V(3.5, 1.6, 9), ...truckAt(TRUCK_PARKED), V(24, 0, 3), V(24, 0, 7)], // ship: table, dock, road
  ];
  const probe = new THREE.OrthographicCamera();
  function fit(points) {
    const center = new THREE.Vector3();
    points.forEach((p) => center.add(p));
    center.divideScalar(points.length);
    probe.copy(camera);
    probe.zoom = 1;
    const measure = (target) => {
      probe.position.copy(target).add(CAM_OFFSET);
      probe.lookAt(target);
      probe.updateProjectionMatrix();
      probe.updateMatrixWorld();
      const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      points.forEach((p) => {
        const v = p.clone().project(probe);
        box.x0 = Math.min(box.x0, v.x);
        box.x1 = Math.max(box.x1, v.x);
        box.y0 = Math.min(box.y0, v.y);
        box.y1 = Math.max(box.y1, v.y);
      });
      return box;
    };
    // Centre the points on screen, then zoom so they fill ~84% of the frame
    let box = measure(center);
    const right = V(1, 0, 0).applyQuaternion(probe.quaternion);
    const up = V(0, 1, 0).applyQuaternion(probe.quaternion);
    const target = center
      .clone()
      .addScaledVector(right, ((box.x0 + box.x1) / 2) * ((probe.right - probe.left) / 2))
      .addScaledVector(up, ((box.y0 + box.y1) / 2) * ((probe.top - probe.bottom) / 2));
    box = measure(target);
    const half = Math.max((box.x1 - box.x0) / 2, (box.y1 - box.y0) / 2);
    return { target, zoom: Math.min(1.6, 0.84 / half) };
  }

  /* ----------------------------- the story --------------------------- */

  // Starting state (hero)
  const from = slots[pickSlot];
  const arrivals = slots.map((_, i) => i).filter((i) => later[i]);
  const grow = { v: 0 };
  const pickProxy = { v: 0 };
  truck.position.x = TRUCK_AWAY;
  pallet.scale.setScalar(0.001);
  pallet.position.set(10.5, 0, 5);
  picked.visible = true;
  picked.scale.setScalar(0.001);
  picked.position.copy(from);
  pickedTape.visible = true;
  pickedTape.scale.setScalar(0.001);
  pulse.position.set(from.x, 0.03, from.z + 1.3);
  const refill = () => {
    arrivals.forEach((i, k) => {
      scaleOf[i] = Math.max(0, Math.min(1, grow.v - k));
    });
    scaleOf[pickSlot] = 1 - pickProxy.v;
    picked.scale.setScalar(Math.max(0.001, pickProxy.v));
    writeCartons();
  };
  refill();

  // One timeline, one unit per step: the action takes the first ~3/4 of a
  // step, then the result holds while its text is read
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' }, onUpdate: requestRender });
  // 1 Receive: the truck backs up to the dock, a pallet comes off
  tl.to(cam, { s: 1, duration: 0.45 }, 0)
    .to(truck.position, { x: TRUCK_PARKED, duration: 0.5, ease: 'power3.out' }, 0.05)
    .to(pallet.scale, { x: 1, y: 1, z: 1, duration: 0.15, ease: 'back.out(1.8)' }, 0.55)
    .to(pallet.position, { x: 8.3, duration: 0.15, ease: 'power2.out' }, 0.55);
  // 2 Store: the forklift turns, lifts the pallet and drives it to the racks; shelves fill
  tl.to(cam, { s: 2, duration: 0.45 }, 1)
    .to(lift.position, { x: 6.2, z: 5, duration: 0.2 }, 1.05)
    .to(lift.rotation, { y: 0, duration: 0.2 }, 1.05)
    .to(forks.position, { y: 0.6, duration: 0.06 }, 1.26)
    .to(pallet.position, { y: 0.6, duration: 0.06 }, 1.26)
    .to(lift.position, { x: -2, z: 2.2, duration: 0.3 }, 1.33)
    .to(pallet.position, { x: 0.1, z: 2.2, duration: 0.3 }, 1.33)
    .to(grow, { v: arrivals.length, duration: 0.25, ease: 'power1.out', onUpdate: refill }, 1.55)
    .to(pallet.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.07, ease: 'power2.in' }, 1.63)
    .to(forks.position, { y: 0, duration: 0.06 }, 1.7)
    .to(lift.position, { x: LIFT_HOME.x, z: LIFT_HOME.z, duration: 0.2 }, 1.72)
    .to(lift.rotation, { y: Math.PI, duration: 0.2 }, 1.72);
  // 3 Pick & pack: scan pulse, the carton lifts out and lands on the table, taped
  tl.to(cam, { s: 3, duration: 0.45 }, 2)
    .to(mat.pulse, { keyframes: [{ opacity: 0.9, duration: 0.04 }, { opacity: 0, duration: 0.16 }] }, 2.05)
    .fromTo(pulse.scale, { x: 0.4, y: 0.4, z: 0.4 }, { x: 1.8, y: 1.8, z: 1.8, duration: 0.2, immediateRender: false }, 2.05)
    .to(pickProxy, { v: 1, duration: 0.03, onUpdate: refill }, 2.24)
    .to(picked.position, { y: from.y + 1.2, duration: 0.1, ease: 'power2.out' }, 2.27)
    .to(picked.position, { x: table.position.x, z: table.position.z, duration: 0.3 }, 2.37)
    .to(picked.position, { y: 1.7, duration: 0.08, ease: 'bounce.out' }, 2.67)
    .to(pickedTape.scale, { x: 1, y: 1, z: 1, duration: 0.05 }, 2.75);
  // 4 Ship: the parcel goes into the truck and the truck drives away
  tl.to(cam, { s: 4, duration: 0.45 }, 3)
    .to(picked.position, { x: TRUCK_PARKED - 0.5, y: 2.4, z: 5, duration: 0.25 }, 3.05)
    .to(picked.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.05 }, 3.3)
    .to(truck.position, { x: TRUCK_AWAY, duration: 0.45, ease: 'power2.in' }, 3.4)
    .to({}, { duration: 0.15 }, 3.85); // hold at the end

  const ST = window.ScrollTrigger;
  if (gsap && ST) {
    gsap.registerPlugin(ST);
    if (reduced) {
      // No motion: jump to each step's finished state as its text arrives
      const show = (step) => {
        tl.progress(step / 4);
        requestRender();
      };
      document.querySelectorAll('.story-step').forEach((el) => {
        const n = Number(el.dataset.step);
        ST.create({ trigger: el, start: 'top 60%', end: 'bottom 40%', onEnter: () => show(n), onEnterBack: () => show(n) });
      });
      ST.create({ trigger: '#story', start: 'top 60%', onLeaveBack: () => show(0) });
    } else {
      ST.create({ trigger: '#story', start: 'top 75%', end: 'bottom 80%', scrub: 0.8, animation: tl });
    }
    // Fade the fixed canvas away once the features begin
    ST.create({
      trigger: '#features',
      start: 'top 55%', // after the truck has left
      onEnter: () => gsap.to(container, { opacity: 0, duration: 0.4, onComplete: () => (faded = true) }),
      onLeaveBack: () => {
        faded = false;
        gsap.to(container, { opacity: 1, duration: 0.4 });
      },
    });
  }

  window.StockSense3D = { progress: (p) => tl.progress(p), timeline: tl };
}
