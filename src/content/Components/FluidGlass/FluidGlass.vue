<template>
  <div ref="containerRef" class="fluid-glass">
    <div ref="stageRef" class="fluid-glass-stage"></div>
    <div class="fluid-glass-scroll" aria-hidden="true"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

import cs1 from '@/assets/demo/cs1.webp';
import cs2 from '@/assets/demo/cs2.webp';
import cs3 from '@/assets/demo/cs3.webp';

type Mode = 'lens' | 'bar' | 'cube';

interface NavItem {
  label: string;
  link: string;
}

interface ModeProps {
  scale?: number;
  ior?: number;
  thickness?: number;
  anisotropy?: number;
  chromaticAberration?: number;
  transmission?: number;
  roughness?: number;
  color?: string;
  attenuationColor?: string;
  attenuationDistance?: number;
  navItems?: NavItem[];
}

interface FluidGlassProps {
  mode?: Mode;
  lensProps?: ModeProps;
  barProps?: ModeProps;
  cubeProps?: ModeProps;
}

const props = withDefaults(defineProps<FluidGlassProps>(), {
  mode: 'lens',
  lensProps: () => ({}),
  barProps: () => ({}),
  cubeProps: () => ({})
});

const DEFAULT_NAV: NavItem[] = [
  { label: 'Home', link: '' },
  { label: 'About', link: '' },
  { label: 'Contact', link: '' }
];

const BAR_DEFAULTS: ModeProps = {
  transmission: 1,
  roughness: 0,
  thickness: 10,
  ior: 1.15,
  color: '#ffffff',
  attenuationColor: '#ffffff',
  attenuationDistance: 0.25
};

const MODE_CONFIG: Record<Mode, { url: string; geometryKey: string; followPointer: boolean; lockToBottom: boolean }> = {
  lens: { url: '/assets/3d/lens.glb', geometryKey: 'Cylinder', followPointer: true, lockToBottom: false },
  cube: { url: '/assets/3d/cube.glb', geometryKey: 'Cube', followPointer: true, lockToBottom: false },
  bar: { url: '/assets/3d/bar.glb', geometryKey: 'Cube', followPointer: false, lockToBottom: true }
};

const SHARED_IMAGES = [cs1, cs2, cs3, cs1, cs2];
const PAGES = 3;

// ============================================================================
// GlassMaterial — a ShaderMaterial that samples an FBO texture to produce
// a refraction + chromatic-aberration glass effect without relying on
// Three.js's internal transmission machinery (which differs across versions).
// ============================================================================

interface GlassMaterialParams {
  buffer: THREE.Texture;
  ior?: number;
  thickness?: number;
  transmission?: number;
  roughness?: number;
  color?: string;
  attenuationColor?: string;
  attenuationDistance?: number;
  chromaticAberration?: number;
  anisotropy?: number;
}

function makeGlassMaterial(params: GlassMaterialParams): THREE.ShaderMaterial {
  const ior = params.ior ?? 1.15;
  const thickness = params.thickness ?? 5;
  const ca = params.chromaticAberration ?? 0.1;
  const tint = new THREE.Color(params.color ?? '#ffffff');
  const attenuationColor = new THREE.Color(params.attenuationColor ?? '#ffffff');
  const attenuationDistance = params.attenuationDistance ?? Infinity;

  return new THREE.ShaderMaterial({
    uniforms: {
      fboBuffer: { value: params.buffer },
      ior: { value: ior },
      thickness: { value: thickness },
      chromaticAberration: { value: ca },
      tint: { value: tint },
      attenuationColor: { value: attenuationColor },
      attenuationDistance: { value: attenuationDistance },
      uProjectionMatrix: { value: new THREE.Matrix4() }
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vModelScale;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vModelScale = length(modelMatrix[0].xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D fboBuffer;
      uniform float ior;
      uniform float thickness;
      uniform float chromaticAberration;
      uniform vec3 tint;
      uniform vec3 attenuationColor;
      uniform float attenuationDistance;
      uniform mat4 uProjectionMatrix;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vModelScale;

      vec2 refractionUV(vec3 n, float iorVal, float dist) {
        vec3 v = normalize(cameraPosition - vWorldPos);
        vec3 refr = refract(-v, n, 1.0 / iorVal);
        vec4 refractedClip = uProjectionMatrix * viewMatrix * vec4(vWorldPos + refr * dist, 1.0);
        vec2 refractedUV = (refractedClip.xy / refractedClip.w) * 0.5 + 0.5;
        return clamp(refractedUV, 0.0, 1.0);
      }

      void main() {
        vec3 n = normalize(vNormal);
        // match drei: refraction ray length = thickness * model scale
        float dist = thickness * vModelScale;

        // chromatic aberration: 3 IOR-shifted samples
        float iorR = ior;
        float iorG = ior * (1.0 + chromaticAberration * 0.5);
        float iorB = ior * (1.0 + chromaticAberration * 1.0);

        vec2 uvR = refractionUV(n, iorR, dist);
        vec2 uvG = refractionUV(n, iorG, dist);
        vec2 uvB = refractionUV(n, iorB, dist);

        float r = texture2D(fboBuffer, uvR).r;
        float g = texture2D(fboBuffer, uvG).g;
        float b = texture2D(fboBuffer, uvB).b;

        vec3 refracted = vec3(r, g, b);

        // volume attenuation
        if (attenuationDistance < 1e9) {
          vec3 coeff = -log(max(attenuationColor, vec3(0.001))) / attenuationDistance;
          refracted *= exp(-coeff * dist);
        }

        // subtle Fresnel rim for glassy look
        vec3 v = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 color = mix(refracted * tint, vec3(1.0), fresnel * 0.15);

        gl_FragColor = vec4(color, 0.92);
      }
    `,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false
  });
}

// ============================================================================
// ImageMaterial — replicates @react-three/drei <Image> cover + zoom behavior
// ============================================================================

class ImageMaterial extends THREE.ShaderMaterial {
  constructor(texture: THREE.Texture, imageAspect: number) {
    super({
      uniforms: {
        map: { value: texture },
        zoom: { value: 1 },
        scale: { value: new THREE.Vector2(1, 1) },
        imageAspect: { value: imageAspect },
        opacity: { value: 1 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float zoom;
        uniform vec2 scale;
        uniform float imageAspect;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec2 s = scale;
          float rs = s.x / s.y;
          float ri = imageAspect;
          vec2 newSize = rs < ri ? vec2(s.y * ri, s.y) : vec2(s.x, s.x / ri);
          vec2 offset = (rs < ri
            ? vec2((newSize.x - s.x) / 2.0, 0.0)
            : vec2(0.0, (newSize.y - s.y) / 2.0)) / newSize;
          vec2 uv = vUv * s / newSize + offset;
          vec2 zUv = (uv - vec2(0.5)) / zoom + vec2(0.5);
          gl_FragColor = vec4(texture2D(map, zUv).rgb, opacity);
        }
      `,
      transparent: true
    });
  }
}

// ============================================================================
// Component state
// ============================================================================

const containerRef = useTemplateRef<HTMLDivElement>('containerRef');
const stageRef = useTemplateRef<HTMLDivElement>('stageRef');

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let innerScene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let fbo: THREE.WebGLRenderTarget | null = null;
let backgroundPlane: THREE.Mesh | null = null;
let glassMesh: THREE.Mesh | null = null;
let scrollGroup: THREE.Group | null = null;
let navGroup: THREE.Group | null = null;
let typographyMesh: THREE.Mesh | null = null;
let typographyTexture: THREE.CanvasTexture | null = null;
let imageEntries: Array<{ mesh: THREE.Mesh; material: ImageMaterial }> = [];
let navTextures: THREE.CanvasTexture[] = [];

let animFrameId = 0;
let resizeObserver: ResizeObserver | null = null;
const pointer = { x: 0, y: 0 };
const glassPos = { x: 0, y: 0 };
let scrollTarget = 0;
let scrollCurrent = 0;
let lastTime = 0;
let glassMeshLoadToken = 0;

const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
gltfLoader.setDRACOLoader(dracoLoader);
const textureLoader = new THREE.TextureLoader();

// ============================================================================
// Helpers
// ============================================================================

const getViewportAtZ = (z: number) => {
  if (!camera) return { width: 1, height: 1 };
  const distance = Math.abs(camera.position.z - z);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const height = 2 * Math.tan(vFov / 2) * distance;
  return { width: height * camera.aspect, height };
};

const getDevice = () => {
  const w = containerRef.value?.clientWidth ?? window.innerWidth;
  if (w <= 639) return 'mobile';
  if (w <= 1023) return 'tablet';
  return 'desktop';
};

const resolveModeProps = (): ModeProps => {
  if (props.mode === 'bar') return { ...BAR_DEFAULTS, ...props.barProps };
  if (props.mode === 'cube') return { ...props.cubeProps };
  return { ...props.lensProps };
};

const createTextTexture = (text: string, fontSizePx = 260, weight = 700) => {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { texture: new THREE.CanvasTexture(canvas), aspect: 1 };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${weight} ${fontSizePx}px Inter, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = fontSizePx * 0.35;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const metrics = ctx.measureText(text);
  const textWidthPx = metrics.width + fontSizePx * 0.5;
  const aspect = textWidthPx / fontSizePx;
  return { texture: tex, aspect };
};

const loadImagePlane = (url: string) =>
  new Promise<{ mesh: THREE.Mesh; material: ImageMaterial }>((resolve, reject) => {
    textureLoader.load(
      url,
      tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        const aspect = tex.image.width / tex.image.height;
        const material = new ImageMaterial(tex, aspect);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        resolve({ mesh, material });
      },
      undefined,
      reject
    );
  });

// ============================================================================
// Builders
// ============================================================================

const buildTypography = () => {
  if (!innerScene || !scrollGroup) return;
  if (typographyMesh) {
    scrollGroup.remove(typographyMesh);
    typographyMesh.geometry.dispose();
    (typographyMesh.material as THREE.MeshBasicMaterial).dispose();
    typographyMesh = null;
  }
  if (typographyTexture) {
    typographyTexture.dispose();
    typographyTexture = null;
  }

  const device = getDevice();
  const fontSize = device === 'mobile' ? 0.2 : device === 'tablet' ? 0.4 : 0.6;
  const { texture, aspect } = createTextTexture('Vue Bits');
  typographyTexture = texture;

  const planeH = fontSize * 1.4;
  const planeW = planeH * aspect;
  typographyMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(planeW, planeH),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  typographyMesh.position.set(0, 0, 12);
  scrollGroup.add(typographyMesh);
};

const buildImages = async () => {
  if (!innerScene || !scrollGroup) return;
  imageEntries.forEach(e => {
    scrollGroup?.remove(e.mesh);
    e.mesh.geometry.dispose();
    (e.material.uniforms.map.value as THREE.Texture)?.dispose();
    e.material.dispose();
  });
  imageEntries = [];

  const height = getViewportAtZ(0).height;
  const layout: Array<{ url: string; pos: [number, number, number]; scale: [number, number] }> = [
    { url: SHARED_IMAGES[0], pos: [-2, 0, 0], scale: [3, height / 1.1] },
    { url: SHARED_IMAGES[1], pos: [2, 0, 3], scale: [3, 3] },
    { url: SHARED_IMAGES[2], pos: [-2.05, -height, 6], scale: [1, 3] },
    { url: SHARED_IMAGES[3], pos: [-0.6, -height, 9], scale: [1, 2] },
    { url: SHARED_IMAGES[4], pos: [0.75, -height, 10.5], scale: [1.5, 1.5] }
  ];

  for (const item of layout) {
    try {
      const { mesh, material } = await loadImagePlane(item.url);
      mesh.position.set(item.pos[0], item.pos[1], item.pos[2]);
      mesh.scale.set(item.scale[0], item.scale[1], 1);
      (material.uniforms.scale.value as THREE.Vector2).set(item.scale[0], item.scale[1]);
      scrollGroup.add(mesh);
      imageEntries.push({ mesh, material });
    } catch (err) {
      console.warn('[FluidGlass] failed to load image', item.url, err);
    }
  }
};

const buildNavItems = () => {
  if (!scene) return;
  if (navGroup) {
    scene.remove(navGroup);
    navGroup.children.forEach(c => {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    navGroup = null;
  }
  navTextures.forEach(t => t.dispose());
  navTextures = [];

  if (props.mode !== 'bar') return;

  const items = (props.barProps?.navItems as NavItem[] | undefined) ?? DEFAULT_NAV;
  const device = getDevice();
  const config = {
    mobile: { spacing: 0.2, fontSize: 0.035 },
    tablet: { spacing: 0.24, fontSize: 0.045 },
    desktop: { spacing: 0.3, fontSize: 0.045 }
  }[device];

  navGroup = new THREE.Group();
  navGroup.renderOrder = 10;

  items.forEach((item, i) => {
    const { texture, aspect } = createTextTexture(item.label, 140);
    navTextures.push(texture);
    const planeH = config.fontSize * 1.8;
    const planeW = planeH * aspect;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false
      })
    );
    mesh.renderOrder = 10;
    mesh.position.x = (i - (items.length - 1) / 2) * config.spacing;
    mesh.userData.link = item.link;
    navGroup!.add(mesh);
  });

  scene.add(navGroup);
};

const extractGeometry = (root: THREE.Object3D, geometryKey: string): THREE.BufferGeometry | null => {
  const named = root.getObjectByName(geometryKey) as THREE.Mesh | undefined;
  if (named && (named as THREE.Mesh).isMesh && named.geometry) {
    return named.geometry;
  }
  let geo: THREE.BufferGeometry | null = null;
  root.traverse(obj => {
    if (!geo && (obj as THREE.Mesh).isMesh) {
      geo = (obj as THREE.Mesh).geometry;
    }
  });
  return geo;
};

const applyMaterialProps = () => {
  if (!glassMesh || !fbo) return;
  const isBar = props.mode === 'bar';
  const modeProps = resolveModeProps();
  const mat = glassMesh.material as THREE.ShaderMaterial;

  mat.uniforms.ior.value = modeProps.ior ?? 1.15;
  mat.uniforms.thickness.value = modeProps.thickness ?? 5;
  mat.uniforms.chromaticAberration.value = modeProps.chromaticAberration ?? 0.1;
  (mat.uniforms.tint.value as THREE.Color).set(modeProps.color ?? '#ffffff');
  (mat.uniforms.attenuationColor.value as THREE.Color).set(modeProps.attenuationColor ?? '#ffffff');
  mat.uniforms.attenuationDistance.value = modeProps.attenuationDistance ?? (isBar ? 0.25 : Infinity);

  if (modeProps.scale != null) {
    glassMesh.scale.setScalar(modeProps.scale);
  }
};

const buildGlassMesh = async () => {
  if (!scene || !fbo) return;
  const token = ++glassMeshLoadToken;

  if (glassMesh) {
    scene.remove(glassMesh);
    glassMesh.geometry.dispose();
    (glassMesh.material as THREE.Material).dispose();
    glassMesh = null;
  }

  const config = MODE_CONFIG[props.mode];
  const isBar = props.mode === 'bar';
  const modeProps = resolveModeProps();

  let geometry: THREE.BufferGeometry | null = null;
  try {
    const gltf = await gltfLoader.loadAsync(config.url);
    geometry = extractGeometry(gltf.scene, config.geometryKey);
  } catch (err) {
    console.warn('[FluidGlass] failed to load model', config.url, err);
  }
  if (token !== glassMeshLoadToken || !scene) return;
  if (!geometry) return;

  geometry.computeBoundingBox();

  const material = makeGlassMaterial({
    buffer: fbo.texture,
    ior: modeProps.ior ?? 1.15,
    thickness: modeProps.thickness ?? 5,
    color: modeProps.color ?? '#ffffff',
    attenuationColor: modeProps.attenuationColor ?? '#ffffff',
    attenuationDistance: modeProps.attenuationDistance ?? (isBar ? 0.25 : Infinity),
    chromaticAberration: modeProps.chromaticAberration ?? 0.1
  });
  if (camera) {
    material.uniforms.uProjectionMatrix.value = camera.projectionMatrix;
  }

  glassMesh = new THREE.Mesh(geometry, material);
  glassMesh.rotation.x = Math.PI / 2;
  glassMesh.position.set(0, 0, 15);
  glassMesh.scale.setScalar(modeProps.scale ?? 0.15);
  scene.add(glassMesh);
};

// ============================================================================
// Lifecycle
// ============================================================================

const resize = () => {
  if (!renderer || !camera || !containerRef.value || !fbo) return;
  const w = containerRef.value.clientWidth;
  const h = containerRef.value.clientHeight;
  if (!w || !h) return;

  const pr = Math.min(window.devicePixelRatio, 2);
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(pr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fbo.setSize(Math.floor(w * pr), Math.floor(h * pr));

  if (backgroundPlane) {
    const vp = getViewportAtZ(0);
    backgroundPlane.scale.set(vp.width, vp.height, 1);
  }

  buildTypography();
  buildImages();
  buildNavItems();
};

const onPointerMove = (e: PointerEvent) => {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
};

const onPointerLeave = () => {
  pointer.x = 0;
  pointer.y = 0;
};

const onScroll = () => {
  if (!containerRef.value) return;
  const max = containerRef.value.scrollHeight - containerRef.value.clientHeight;
  scrollTarget = max > 0 ? containerRef.value.scrollTop / max : 0;
};

const onClick = (e: MouseEvent) => {
  if (props.mode !== 'bar' || !navGroup || !camera || !containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -(((e.clientY - rect.top) / rect.height) * 2 - 1)
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(navGroup.children, false);
  if (hits.length === 0) return;
  const link = hits[0].object.userData.link as string;
  if (!link) return;
  if (link.startsWith('#')) window.location.hash = link;
  else window.location.href = link;
};

const animate = () => {
  animFrameId = requestAnimationFrame(animate);
  if (!renderer || !scene || !innerScene || !camera || !fbo) return;

  const now = performance.now();
  const dt = lastTime === 0 ? 0.016 : Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const scrollDamp = 1 - Math.exp(-dt / 0.2);
  scrollCurrent += (scrollTarget - scrollCurrent) * scrollDamp;

  if (scrollGroup) {
    const vp0 = getViewportAtZ(0);
    scrollGroup.position.y = scrollCurrent * (PAGES - 1) * vp0.height;
  }

  if (imageEntries.length >= 5) {
    const r1 = THREE.MathUtils.clamp(scrollCurrent / (1 / 3), 0, 1);
    const r2 = THREE.MathUtils.clamp((scrollCurrent - 1.15 / 3) / (1 / 3), 0, 1);
    (imageEntries[0].material.uniforms.zoom.value as number) = 1 + r1 / 3;
    (imageEntries[1].material.uniforms.zoom.value as number) = 1 + r1 / 3;
    (imageEntries[2].material.uniforms.zoom.value as number) = 1 + r2 / 2;
    (imageEntries[3].material.uniforms.zoom.value as number) = 1 + r2 / 2;
    (imageEntries[4].material.uniforms.zoom.value as number) = 1 + r2 / 2;
  }

  if (glassMesh) {
    const config = MODE_CONFIG[props.mode];
    const vp15 = getViewportAtZ(15);
    const destX = config.followPointer ? (pointer.x * vp15.width) / 2 : 0;
    const destY = config.lockToBottom
      ? -vp15.height / 2 + 0.2
      : config.followPointer
        ? (pointer.y * vp15.height) / 2
        : 0;
    const posDamp = 1 - Math.exp(-dt / 0.15);
    glassPos.x += (destX - glassPos.x) * posDamp;
    glassPos.y += (destY - glassPos.y) * posDamp;
    glassMesh.position.set(glassPos.x, glassPos.y, 15);

    const modeProps = resolveModeProps();
    if (modeProps.scale == null && glassMesh.geometry.boundingBox) {
      const bbox = glassMesh.geometry.boundingBox;
      const geoWidth = bbox.max.x - bbox.min.x || 1;
      const maxWorld = vp15.width * 0.9;
      const desired = maxWorld / geoWidth;
      glassMesh.scale.setScalar(Math.min(0.15, desired));
    }

  }

  if (navGroup) {
    const vp15 = getViewportAtZ(15);
    navGroup.position.set(0, -vp15.height / 2 + 0.2, 15.1);
  }

  // 1. Render inner scene to FBO — this becomes the fboBuffer sampled by glass material
  renderer.setRenderTarget(fbo);
  renderer.setClearColor(0x5227ff, 1);
  renderer.clear();
  renderer.render(innerScene, camera);

  // 2. Render main scene (background plane + glass mesh) to screen
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x5227ff, 1);
  renderer.clear();
  renderer.render(scene, camera);
};

const init = async () => {
  if (!stageRef.value || !containerRef.value) return;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  stageRef.value.appendChild(renderer.domElement);

  const w = containerRef.value.clientWidth;
  const h = containerRef.value.clientHeight;
  const pr = Math.min(window.devicePixelRatio, 2);
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(pr);

  camera = new THREE.PerspectiveCamera(15, w / Math.max(1, h), 0.1, 100);
  camera.position.set(0, 0, 20);

  scene = new THREE.Scene();
  innerScene = new THREE.Scene();

  fbo = new THREE.WebGLRenderTarget(Math.floor(w * pr), Math.floor(h * pr), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace
  });

  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(2, 3, 8);
  scene.add(key);

  const vp0 = getViewportAtZ(0);
  backgroundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: fbo.texture, toneMapped: false })
  );
  backgroundPlane.scale.set(vp0.width, vp0.height, 1);
  backgroundPlane.position.set(0, 0, 0);
  scene.add(backgroundPlane);

  scrollGroup = new THREE.Group();
  innerScene.add(scrollGroup);

  buildTypography();
  await buildImages();
  await buildGlassMesh();
  buildNavItems();

  containerRef.value.addEventListener('pointermove', onPointerMove);
  containerRef.value.addEventListener('pointerleave', onPointerLeave);
  containerRef.value.addEventListener('click', onClick);
  containerRef.value.addEventListener('scroll', onScroll, { passive: true });
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(containerRef.value);

  lastTime = 0;
  animate();
};

const destroy = () => {
  cancelAnimationFrame(animFrameId);
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (containerRef.value) {
    containerRef.value.removeEventListener('pointermove', onPointerMove);
    containerRef.value.removeEventListener('pointerleave', onPointerLeave);
    containerRef.value.removeEventListener('click', onClick);
    containerRef.value.removeEventListener('scroll', onScroll);
  }

  imageEntries.forEach(e => {
    e.mesh.geometry.dispose();
    (e.material.uniforms.map.value as THREE.Texture)?.dispose();
    e.material.dispose();
  });
  imageEntries = [];

  if (typographyMesh) {
    typographyMesh.geometry.dispose();
    (typographyMesh.material as THREE.MeshBasicMaterial).dispose();
    typographyMesh = null;
  }
  typographyTexture?.dispose();
  typographyTexture = null;

  if (navGroup) {
    navGroup.children.forEach(c => {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    navGroup = null;
  }
  navTextures.forEach(t => t.dispose());
  navTextures = [];

  if (glassMesh) {
    glassMesh.geometry.dispose();
    (glassMesh.material as THREE.Material).dispose();
    glassMesh = null;
  }

  if (backgroundPlane) {
    backgroundPlane.geometry.dispose();
    (backgroundPlane.material as THREE.Material).dispose();
    backgroundPlane = null;
  }

  fbo?.dispose();
  fbo = null;

  dracoLoader.dispose();

  renderer?.dispose();
  if (renderer?.domElement.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  renderer = null;
  scene = null;
  innerScene = null;
  camera = null;
  scrollGroup = null;
};

onMounted(() => {
  init();
});

onBeforeUnmount(() => {
  destroy();
});

watch(
  () => props.mode,
  () => {
    buildGlassMesh();
    buildNavItems();
  }
);

watch(
  () => [props.lensProps, props.barProps, props.cubeProps],
  () => {
    applyMaterialProps();
    if (props.mode === 'bar') buildNavItems();
  },
  { deep: true }
);
</script>

<style scoped>
.fluid-glass {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 24px;
  scrollbar-width: none;
  background: #5227ff;
}

.fluid-glass::-webkit-scrollbar {
  display: none;
}

.fluid-glass-stage {
  position: sticky;
  top: 0;
  width: 100%;
  height: 100%;
}

.fluid-glass-stage :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.fluid-glass-scroll {
  height: 200%;
  pointer-events: none;
}
</style>
