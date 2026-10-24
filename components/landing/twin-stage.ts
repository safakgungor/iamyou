/**
 * The twin: one point cloud that morphs between forms as the page scrolls.
 * It opens as a stipple portrait of Maya at 18, scatters into fragments,
 * assembles into a sphere (the twin), pulses like a heartbeat (the health
 * baseline), and ends as Maya at 40 with particles rising out of her (the
 * vision). One draw call; every motion is in the vertex shader.
 *
 * Browser-only. The landing page imports this module dynamically.
 */

import * as THREE from 'three';

/** The animated form of the orb. Tweened by the landing page, read every frame. */
export type TwinForm = {
  scatter: number;
  /** Maya at 18 (hero). */
  figure: number;
  /** Maya at 40 (vision). */
  figure2: number;
  /** Share of particles rising out of the figure. */
  dissolve: number;
  pulse: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
};

const VERT = /* glsl */ `
uniform float uTime;
uniform float uScatter;
uniform float uFigure;
uniform float uFigure2;
uniform float uDissolve;
uniform float uPulse;
uniform float uSize;
uniform float uPixelRatio;
uniform float uVelocity;
uniform vec2 uMouse;
uniform float uMouseForce;
attribute vec3 aScatter;
attribute vec3 aFigure;
attribute vec3 aFigure2;
attribute vec4 aSeed;
varying float vAlpha;
varying float vDepth;

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

void main() {
  float t = uTime;
  mat3 spin = rotY(t * 0.07);

  vec3 sphere = position;
  float breath = sin(t * 0.8 + aSeed.w * 6.2831) * 0.012 + sin(t * 0.33) * 0.018;
  float wave = mod(t * 0.55, 1.0) * 2.8 - 1.4;
  float band = exp(-pow((sphere.y - wave) * 7.0, 2.0));
  float beat = pow(max(0.0, sin(t * 6.2831 * 1.1)), 14.0);
  sphere *= 1.0 + breath + uPulse * (band * 0.09 + beat * 0.06);
  sphere = spin * sphere;

  vec3 scatter = spin * aScatter;
  vec3 p = mix(sphere, scatter, uScatter);
  p = mix(p, aFigure, uFigure);
  p = mix(p, aFigure2, uFigure2);

  // A share of particles leave the figure and rise, looping: "outside her body".
  float leave = step(0.6, aSeed.x) * uDissolve;
  float rise = fract(t * 0.045 + aSeed.w);
  p += vec3((aSeed.w - 0.5) * 1.8 * rise, rise * 2.0, (aSeed.y - 1.0) * 0.7 * rise) * leave;

  float figureness = max(uFigure, uFigure2);
  float amp = 0.01 * (1.0 - figureness * 0.6) + uScatter * 0.08 + min(abs(uVelocity) * 0.0015, 0.06);
  p += vec3(
    sin(t * 0.6 + aSeed.x * 40.0),
    cos(t * 0.5 + aSeed.x * 31.0),
    sin(t * 0.4 + aSeed.x * 23.0)
  ) * amp;

  vec4 world = modelMatrix * vec4(p, 1.0);
  vec2 d = world.xy - uMouse;
  float f = smoothstep(0.7, 0.0, length(d)) * uMouseForce;
  world.xy += normalize(d + 1e-5) * f * 0.2;

  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  float size = uSize * aSeed.y * (1.0 + aSeed.z * 1.4 * (1.0 - figureness));
  gl_PointSize = size * mix(1.0, 0.9, figureness) * uPixelRatio / -mv.z;

  vDepth = clamp((p.z + 1.1) / 2.2, 0.0, 1.0);
  float rim = 1.0 - abs(normalize(sphere).z);
  float sphereness = (1.0 - uScatter) * (1.0 - figureness);
  vAlpha = mix(0.28, 0.95, vDepth) * (1.0 - uScatter * 0.3);
  vAlpha *= mix(1.0, mix(0.6, 1.35, rim * rim), sphereness);
  float fy = mix(aFigure.y, aFigure2.y, uFigure2);
  vAlpha *= mix(1.0, smoothstep(-1.1, -0.45, fy) * 1.3, figureness);
  vAlpha *= 1.0 - leave * smoothstep(0.2, 1.0, rise);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uLight;
uniform float uOpacity;
varying float vAlpha;
varying float vDepth;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vAlpha * uOpacity;
  if (a < 0.004) discard;
  vec3 col = mix(uLight, uDeep, vDepth);
  gl_FragColor = vec4(col * a, a);
}
`;

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float a = pow(smoothstep(0.5, 0.0, distance(vUv, vec2(0.5))), 2.4) * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/** sRGB hex to a vec3 in 0..1, written to the canvas as-is (ShaderMaterial skips colour conversion). */
function rgb(hex: number): THREE.Vector3 {
  return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/** Small deterministic PRNG so the cloud looks the same on every visit. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TwinStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  private group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private halo: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private pointer = { x: 0, y: 0, tx: 0, ty: 0, force: 0 };
  private velocity = 0;
  private frozen: boolean;

  constructor(
    private canvas: HTMLCanvasElement,
    portraits: { young: Int16Array; older: Int16Array },
    opts: { count: number; dpr: number; frozen: boolean; pointSize?: number },
  ) {
    this.frozen = opts.frozen;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(opts.dpr);
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, 0, 6);

    const n = opts.count;
    const rand = mulberry32(1807);
    const sphere = new Float32Array(n * 3);
    const scatter = new Float32Array(n * 3);
    const fig = new Float32Array(n * 3);
    const fig2 = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    const figCount = Math.min(portraits.young.length, portraits.older.length) / 3;
    const unit = 1 / 10000;
    const golden = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      const shell = 1 - Math.pow(rand(), 3) * 0.28;
      sphere.set([Math.cos(th) * r * shell, y * shell, Math.sin(th) * r * shell], i * 3);

      const g = () => rand() + rand() + rand() - 1.5;
      scatter.set([g() * 3.6, g() * 2.2, g() * 1.8 - 0.3], i * 3);

      // Both portraits share one framing, so point k of Maya at 18 morphs to point k at 40.
      const k = (i * 7919) % figCount;
      const j = () => (rand() - 0.5) * 0.008;
      fig.set([portraits.young[k * 3] * unit + j(), portraits.young[k * 3 + 1] * unit + j(), portraits.young[k * 3 + 2] * unit], i * 3);
      fig2.set([portraits.older[k * 3] * unit + j(), portraits.older[k * 3 + 1] * unit + j(), portraits.older[k * 3 + 2] * unit], i * 3);

      seed.set([rand(), 0.55 + rand() * 0.9, rand() < 0.04 ? 1 : 0, rand()], i * 4);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(sphere, 3));
    this.geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
    this.geometry.setAttribute('aFigure', new THREE.BufferAttribute(fig, 3));
    this.geometry.setAttribute('aFigure2', new THREE.BufferAttribute(fig2, 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      uniforms: {
        uTime: { value: 0 },
        uScatter: { value: 1 },
        uFigure: { value: 0 },
        uFigure2: { value: 0 },
        uDissolve: { value: 0 },
        uPulse: { value: 0 },
        uSize: { value: opts.pointSize ?? 15 },
        uPixelRatio: { value: opts.dpr },
        uVelocity: { value: 0 },
        uMouse: { value: new THREE.Vector2(99, 99) },
        uMouseForce: { value: 0 },
        uDeep: { value: rgb(0x0b86a8) },
        uLight: { value: rgb(0x8fe3f5) },
        uOpacity: { value: 1 },
      },
    });

    this.halo = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      uniforms: { uColor: { value: rgb(0x36d1f0) }, uOpacity: { value: 0 } },
    });

    const haloMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), this.halo);
    haloMesh.position.z = -1.2;
    this.group.add(haloMesh);
    this.group.add(new THREE.Points(this.geometry, this.material));
    this.scene.add(this.group);
    this.resize();
  }

  /** Sizes to the canvas's own box, so the stage works full-screen or in a card. */
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Pointer in normalised device coordinates (-1..1). */
  setPointer(nx: number, ny: number) {
    this.pointer.tx = nx;
    this.pointer.ty = ny;
    this.pointer.force = 1;
  }

  setVelocity(v: number) {
    this.velocity = v;
  }

  render(seconds: number, form: TwinForm) {
    const u = this.material.uniforms;
    const p = this.pointer;
    p.x += (p.tx - p.x) * 0.08;
    p.y += (p.ty - p.y) * 0.08;
    p.force *= 0.985;

    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    u.uMouse.value.set(p.x * halfH * this.camera.aspect, p.y * halfH);
    u.uMouseForce.value = this.frozen ? 0 : p.force;
    u.uTime.value = this.frozen ? 4 : seconds;
    u.uVelocity.value += (this.velocity - u.uVelocity.value) * 0.1;
    u.uScatter.value = form.scatter;
    u.uFigure.value = form.figure;
    u.uFigure2.value = form.figure2;
    u.uDissolve.value = form.dissolve;
    u.uPulse.value = form.pulse;
    u.uOpacity.value = form.opacity;
    this.halo.uniforms.uOpacity.value = 0.2 * form.opacity * (1 - form.scatter) * (1 - Math.max(form.figure, form.figure2) * 0.55);

    this.group.position.set(form.x, form.y, 0);
    this.group.scale.setScalar(form.scale);
    this.group.rotation.x = p.y * 0.12;
    this.group.rotation.y = p.x * 0.18;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.halo.dispose();
    this.renderer.dispose();
  }
}
