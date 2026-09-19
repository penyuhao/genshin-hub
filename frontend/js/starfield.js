// js/starfield.js — L1 背景层：Shader 星空（逐点独立闪烁）+ 星环系统
// 性能约定：手机粒子减半、页面隐藏暂停、像素比上限 2、depthWrite: false 防透明叠加闪烁
import * as THREE from './vendor/three.module.js';

const STAR_VERTEX = `
  attribute float size;
  attribute float phase;
  uniform float uPixelRatio;
  varying float vPhase;
  void main() {
    vPhase = phase;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uPixelRatio * (260.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_FRAGMENT = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform float uOpacity;
  varying float vPhase;
  void main() {
    float twinkle = sin(uTime * 1.7 + vPhase) * 0.5 + 0.5;
    float alpha = (0.22 + twinkle * 0.78) * uOpacity;
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float glow = 1.0 - dist * 2.0;
    vec3 color = mix(uColor, uColor2, twinkle * 0.85);
    gl_FragColor = vec4(color, alpha * glow * glow);
  }
`;

const RING_VERTEX = `
  attribute float ringIndex;
  attribute float angle;
  attribute float radius;
  attribute float size;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vRing;
  varying float vTwinkle;

  float speedOf(float ring) {
    if (ring < 0.5) return 0.075;   // 内环：顺时针
    if (ring < 1.5) return -0.048;  // 中环：逆时针
    return 0.026;                   // 外环：缓慢顺时针
  }

  void main() {
    vRing = ringIndex;
    float a = angle + uTime * speedOf(ringIndex);
    vec3 pos = vec3(cos(a) * radius, sin(a) * radius * 0.36, sin(a) * radius * 0.16 - 14.0);
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    vTwinkle = sin(uTime * 2.2 + angle * 4.0 + ringIndex) * 0.5 + 0.5;
    gl_PointSize = size * uPixelRatio * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const RING_FRAGMENT = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying float vRing;
  varying float vTwinkle;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float glow = 1.0 - dist * 2.0;
    vec3 color = mix(uColorA, uColorB, step(0.5, vRing));
    gl_FragColor = vec4(color, (0.28 + vTwinkle * 0.5) * glow * uOpacity);
  }
`;

function buildStarGeometry(count) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 62;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 38;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 28 - 6;
    sizes[i] = Math.random() * 2 + 0.6;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  return geometry;
}

function buildRingGeometry(ringCount = 3, perRing = 460) {
  const total = ringCount * perRing;
  const positions = new Float32Array(total * 3); // 占位（实际位置在顶点着色器计算）
  const ringIndex = new Float32Array(total);
  const angles = new Float32Array(total);
  const radii = new Float32Array(total);
  const sizes = new Float32Array(total);
  const baseRadii = [9.5, 14.0, 20.5];

  let cursor = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let i = 0; i < perRing; i += 1) {
      ringIndex[cursor] = ring;
      angles[cursor] = (i / perRing) * Math.PI * 2;
      // 轻微抖动让环带更有颗粒感
      radii[cursor] = baseRadii[ring] + (Math.random() - 0.5) * 0.42;
      sizes[cursor] = Math.random() * 1.5 + 0.7;
      cursor += 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('ringIndex', new THREE.BufferAttribute(ringIndex, 1));
  geometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('radius', new THREE.BufferAttribute(radii, 1));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  return geometry;
}

/**
 * 创建星空背景
 * @param {HTMLCanvasElement} canvas
 * @param {{ reducedMotion?: boolean, mobile?: boolean }} options
 */
export function createStarfield(canvas, { reducedMotion = false, mobile = false } = {}) {
  const api = {
    ok: false,
    start() {},
    stop() {},
    dispose() {},
    setPalette() {},
    setEnabled() {},
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    console.warn('[starfield] WebGL 不可用，降级为静态星点：', err?.message || err);
    return createFallbackStarfield(canvas, { mobile });
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 400);
  camera.position.z = 6;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const starCount = mobile ? 4000 : 10000;
  const starGeometry = buildStarGeometry(starCount);
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#e8c877') },
      uColor2: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: mobile ? 0.75 : 0.9 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);

  const ringGeometry = buildRingGeometry();
  const ringMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color('#e8c877') },
      uColorB: { value: new THREE.Color('#7fd8d8') },
      uOpacity: { value: 0.85 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const rings = new THREE.Points(ringGeometry, ringMaterial);
  rings.frustumCulled = false;
  rings.visible = !mobile;
  scene.add(rings);

  let rafId = null;
  let running = false;
  let enabled = true;
  let elapsed = 0;

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function renderFrame(now) {
    elapsed = now * 0.001;
    starMaterial.uniforms.uTime.value = elapsed;
    ringMaterial.uniforms.uTime.value = elapsed;
    stars.rotation.y = elapsed * 0.012;
    stars.rotation.x = Math.sin(elapsed * 0.05) * 0.04;
    renderer.render(scene, camera);
  }

  function loop(now) {
    if (!running) return;
    renderFrame(now);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running || !enabled) return;
    running = true;
    if (reducedMotion) {
      renderFrame(performance.now());
      running = false;
      return;
    }
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function handleResize() {
    resize();
    if (reducedMotion) renderFrame(performance.now());
  }

  function handleVisibility() {
    if (document.hidden) stop();
    else start();
  }

  resize();
  window.addEventListener('resize', handleResize);
  document.addEventListener('visibilitychange', handleVisibility);

  api.ok = true;
  api.start = start;
  api.stop = stop;
  api.setPalette = ({ gold, cyan } = {}) => {
    if (gold) {
      starMaterial.uniforms.uColor.value.set(gold);
      ringMaterial.uniforms.uColorA.value.set(gold);
    }
    if (cyan) ringMaterial.uniforms.uColorB.value.set(cyan);
  };
  api.setEnabled = (value) => {
    enabled = Boolean(value);
    canvas.style.display = enabled ? '' : 'none';
    if (!enabled) stop();
    else start();
  };
  api.dispose = () => {
    stop();
    window.removeEventListener('resize', handleResize);
    document.removeEventListener('visibilitychange', handleVisibility);
    starGeometry.dispose();
    ringGeometry.dispose();
    starMaterial.dispose();
    ringMaterial.dispose();
    renderer.dispose();
  };

  return api;
}

/** WebGL 不可用时的 Canvas2D 降级星空 */
function createFallbackStarfield(canvas, { mobile = false } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { ok: false, start() {}, stop() {}, dispose() {}, setPalette() {}, setEnabled() {} };
  }

  const count = mobile ? 160 : 320;
  const stars = Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.5 + 0.4,
    phase: Math.random() * Math.PI * 2,
  }));

  let rafId = null;
  let running = false;
  let color = '#e8c877';

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = (canvas.clientWidth || window.innerWidth) * ratio;
    canvas.height = (canvas.clientHeight || window.innerHeight) * ratio;
  }

  function draw(now) {
    const t = now * 0.001;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (const star of stars) {
      const alpha = (Math.sin(t * 1.7 + star.phase) * 0.5 + 0.5) * 0.8 + 0.15;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r * (w / 1200), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    draw(now);
    rafId = requestAnimationFrame(loop);
  }

  const handleResize = () => {
    resize();
    draw(performance.now());
  };
  const handleVisibility = () => {
    if (document.hidden) {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    } else if (!running) {
      running = true;
      rafId = requestAnimationFrame(loop);
    }
  };

  resize();
  window.addEventListener('resize', handleResize);
  document.addEventListener('visibilitychange', handleVisibility);

  return {
    ok: true,
    start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    },
    setPalette({ gold } = {}) {
      if (gold) color = gold;
    },
    setEnabled(value) {
      canvas.style.display = value ? '' : 'none';
    },
    dispose() {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
    },
  };
}