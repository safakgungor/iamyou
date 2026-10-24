/**
 * The twin orb: one point cloud that morphs between four forms as the page
 * scrolls. Scattered fragments assemble into a sphere (the twin), the sphere
 * pulses like a heartbeat (the health baseline), and finally re-forms as Maya's
 * silhouette (the vision). One draw call; every motion is in the vertex shader.
 *
 * Browser-only. The landing page imports this module dynamically.
 */

import * as THREE from 'three';

/** The animated form of the orb. Tweened by the landing page, read every frame. */
export type TwinForm = {
  scatter: number;
  figure: number;
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
uniform float uPulse;
uniform float uSize;
uniform float uPixelRatio;
uniform float uVelocity;
uniform vec2 uMouse;
uniform float uMouseForce;
attribute vec3 aScatter;
attribute vec3 aFigure;
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

  float amp = 0.01 + uScatter * 0.08 + min(abs(uVelocity) * 0.0015, 0.06);
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
  gl_PointSize = uSize * aSeed.y * (1.0 + aSeed.z * 1.4) * uPixelRatio / -mv.z;

  vDepth = clamp((p.z + 1.1) / 2.2, 0.0, 1.0);
  float rim = 1.0 - abs(normalize(sphere).z);
  float sphereness = (1.0 - uScatter) * (1.0 - uFigure);
  vAlpha = mix(0.28, 0.95, vDepth) * (1.0 - uScatter * 0.3);
  vAlpha *= mix(1.0, mix(0.6, 1.35, rim * rim), sphereness);
  vAlpha *= mix(1.0, smoothstep(-1.2, -0.6, aFigure.y), uFigure);
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
    figure: Float32Array,
    opts: { count: number; dpr: number; frozen: boolean },
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
    const seed = new Float32Array(n * 4);
    const figCount = figure.length / 2;
    const golden = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      const shell = 1 - Math.pow(rand(), 3) * 0.28;
      sphere.set([Math.cos(th) * r * shell, y * shell, Math.sin(th) * r * shell], i * 3);

      const g = () => rand() + rand() + rand() - 1.5;
      scatter.set([g() * 3.6, g() * 2.2, g() * 1.8 - 0.3], i * 3);

      const k = (i * 7919) % figCount;
      fig.set(
        [figure[k * 2] * 1.15 + (rand() - 0.5) * 0.012, figure[k * 2 + 1] * 1.15 + (rand() - 0.5) * 0.012, (rand() - 0.5) * 0.12],
        i * 3,
      );

      seed.set([rand(), 0.55 + rand() * 0.9, rand() < 0.04 ? 1 : 0, rand()], i * 4);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(sphere, 3));
    this.geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
    this.geometry.setAttribute('aFigure', new THREE.BufferAttribute(fig, 3));
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
        uPulse: { value: 0 },
        uSize: { value: 15 },
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

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
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
    u.uPulse.value = form.pulse;
    u.uOpacity.value = form.opacity;
    this.halo.uniforms.uOpacity.value = 0.2 * form.opacity * (1 - form.scatter) * (1 - form.figure * 0.55);

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
