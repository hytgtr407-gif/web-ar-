import * as THREE from './vendor/three.module.js';
import { MindARThree } from './vendor/mindar-image-three.prod.js';

const directory = new URL('./assets/', import.meta.url);
const portraits = [
  { file: 'bian-full.webp', x: 0, height: 0.87, depth: 0.102, color: '#e76d50' },
  { file: 'cui-full.webp', x: -0.36, height: 0.76, depth: 0.07, color: '#e5be77' },
  { file: 'zhang-full.webp', x: 0.36, height: 0.76, depth: 0.07, color: '#96c3de' }
];

function place(child, parent, x = 0, y = 0, z = 0) {
  child.position.set(x, y, z);
  parent.add(child);
  return child;
}

function stageTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(256, 260, 20, 256, 260, 250);
  glow.addColorStop(0, 'rgba(36,11,15,0.96)');
  glow.addColorStop(0.70, 'rgba(60,17,22,0.95)');
  glow.addColorStop(0.91, 'rgba(113,40,47,0.72)');
  glow.addColorStop(1, 'rgba(37,13,18,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 512);

  ctx.lineWidth = 1;
  for (const [radius, opacity] of [[199, 0.23], [183, 0.13], [164, 0.13]]) {
    ctx.strokeStyle = 'rgba(250,203,136,' + opacity + ')';
    ctx.beginPath();
    ctx.arc(256, 260, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.encoding = THREE.sRGBEncoding;
  return map;
}

function particleMap() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(24, 24, 0, 24, 24, 24);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.25, '#fff8b9');
  gradient.addColorStop(0.6, 'rgba(233,147,79,0.45)');
  gradient.addColorStop(1, 'rgba(220,88,41,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 48, 48);
  const map = new THREE.CanvasTexture(canvas);
  map.encoding = THREE.sRGBEncoding;
  return map;
}

function createStage(anchor, textures, quiet) {
  const stage = place(new THREE.Group(), anchor.group);
  const ringGroup = place(new THREE.Group(), stage);
  const decor = place(new THREE.Group(), stage);
  const cast = place(new THREE.Group(), stage, 0, 0.025);
  function material(options) {
    return new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, ...options });
  }
  function flat(materialOptions, width, height) {
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material(materialOptions));
  }
  function ring(inner, outer, color, opacity, start = 0, length = Math.PI * 2) {
    return new THREE.Mesh(new THREE.RingGeometry(inner, outer, 72, 1, start, length), material({ color, opacity }));
  }

  const backdrop = place(flat({ map: stageTexture() }, 1.31, 1.31), stage, 0, 0, 0.018);
  backdrop.renderOrder = 1;
  place(ring(0.504, 0.508, '#e4b782', 0.75), stage, 0, 0, 0.025).renderOrder = 2;
  place(ring(0.557, 0.570, '#f5c57f', 0.92), stage, 0, 0, 0.026).renderOrder = 2;
  place(ring(0.590, 0.593, '#ffcc8f', 0.40), stage, 0, 0, 0.027).renderOrder = 2;
  for (let segment = 0; segment < 4; segment++) {
    place(ring(0.615, 0.620, '#ffdfa6', 0.85, segment * Math.PI * 0.5, Math.PI * 0.24), ringGroup, 0, 0, 0.030).renderOrder = 3;
  }
  for (let i = 0; i < 12; i++) {
    let a = Math.PI * 2 * i / 12;
    let marker = place(flat({ color: '#ffdfa6', opacity: i % 3 === 0 ? 0.92 : 0.46 }, i % 3 === 0 ? 0.022 : 0.014, i % 3 === 0 ? 0.022 : 0.014), decor, Math.cos(a) * 0.553, Math.sin(a) * 0.553, 0.03);
    marker.rotation.z = a + Math.PI * 0.25;
    marker.renderOrder = 3;
  }

  const light = place(flat({ map: particleMap(), color: '#ffcf8f', opacity: 0.95, blending: THREE.AdditiveBlending }, 0.25, 0.25), stage, 0.38, 0.32, 0.06);
  light.renderOrder = 4;
  const figurePlane = new THREE.PlaneGeometry(1, 1);
  const figureRatios = textures.map(({ image }) => image.width / image.height);
  const floor = -0.45;
  const figures = portraits.map((p, index) => {
    const render = new THREE.Mesh(figurePlane, material({
      map: textures[index],
      opacity: index === 0 ? 1 : 0.83,
      alphaTest: 0.025
    }));
    render.scale.set(p.height * figureRatios[index], p.height, 1);
    render.renderOrder = index === 0 ? 11 : 10;
    place(render, cast, p.x, floor + p.height * 0.5, p.depth);
    return render;
  });
  const orbit = Array.from({ length: 12 }, (_, i) => {
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: light.material.map,
      color: '#ffd399',
      opacity: 0.82,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    const size = i % 4 === 0 ? 0.087 : 0.050;
    dot.scale.set(size, size, 1);
    dot.renderOrder = 12;
    return place(dot, stage);
  });

  let selected = null;
  let entered = performance.now();
  return {
    pick(index) {
      if (index === null || (Number.isInteger(index) && portraits[index])) {
        selected = index;
        light.material.color.set(index === null ? '#ffcf8f' : portraits[index].color);
      }
    },
    reveal() { entered = performance.now(); },
    animate(now) {
      const time = now * 0.001;
      const reveal = quiet ? 1 : THREE.MathUtils.smoothstep(now - entered, 0, 560);
      stage.scale.setScalar(0.84 + 0.16 * reveal);
      stage.position.z = -0.025 + 0.025 * reveal;
      ringGroup.rotation.z = quiet ? 0 : time * 0.20;
      light.position.x = Math.cos(time * 0.73) * 0.51;
      light.position.y = Math.sin(time * 0.73) * 0.51;
      light.visible = !quiet;
      figures.forEach((plane, i) => {
        const p = portraits[i];
        const focus = selected === i;
        const side = selected !== null && !focus;
        const height = focus ? 0.95 : side ? 0.63 : p.height;
        const x = focus ? 0 : side ? [-0.40, 0.40][i < selected ? i : i - 1] : p.x;
        const y = floor + height * 0.5 +
          (quiet ? 0 : Math.sin(time * 1.57 + i * 1.8) * 0.008);
        const targetOpacity = side ? 0.34 : focus || i === 0 ? 1 : 0.83;
        const speed = quiet ? 1 : 0.13;
        const mix = THREE.MathUtils.lerp;
        plane.position.x = mix(plane.position.x, x, speed);
        plane.position.y = mix(plane.position.y, y, speed);
        plane.position.z = mix(plane.position.z, focus ? 0.126 : side ? 0.060 : p.depth, speed);
        plane.scale.x = mix(plane.scale.x, height * figureRatios[i], speed);
        plane.scale.y = mix(plane.scale.y, height, speed);
        plane.material.opacity = mix(plane.material.opacity, targetOpacity * (0.3 + 0.7 * reveal), speed);
        plane.renderOrder = focus || (selected === null && i === 0) ? 11 : 10;
      });
      orbit.forEach((dot, i) => {
        const a = i * Math.PI * 2 / orbit.length + (quiet ? 0 : time * 0.32);
        const radius = 0.56 + 0.09 * Math.sin(i * 4.3);
        dot.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0.09);
        dot.material.opacity = quiet ? 0.35 : (0.44 + 0.38 * Math.sin(time * 1.9 + i)) * reveal;
      });
    }
  };
}

function tracksOff(stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function makeVideo(mount, stream, signal) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', '');
    Object.assign(video.style, { position: 'absolute', inset: '0', zIndex: '0', pointerEvents: 'none' });
    mount.prepend(video);
    const remove = () => {
      video.removeEventListener('loadedmetadata', ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancelled);
    };
    const ready = () => { remove(); resolve(video); };
    const failed = () => { remove(); reject(new Error('无法读取摄像头画面。')); };
    const cancelled = () => { remove(); reject(signal.reason); };
    video.addEventListener('loadedmetadata', ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', cancelled, { once: true });
    video.srcObject = stream;
    void video.play().catch(() => {});
  });
}

export async function startAR({container, onState, onError, signal} = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('未找到 AR 容器。');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('请在 HTTPS 手机浏览器中打开冰箱贴 AR。');
  }
  if (signal?.aborted) throw signal.reason;
  const session = new AbortController();
  const mount = document.createElement('div');
  Object.assign(mount.style, { position:'absolute', inset:'0', isolation:'isolate', overflow:'hidden', background:'#170c0d' });
  container.append(mount);
  const disposables = new Set();
  const controllers = new WeakSet();
  let mind = null;
  let stream = null;
  let stopped = false;
  let observer = null;
  function disposeController() {
    const controller = mind?.controller;
    if (controller && !controllers.has(controller)) {
      controllers.add(controller);
      controller.dispose?.();
      controller.worker?.terminate();
    }
  }
  const abort = () => stop();
  function stop() {
    if (stopped) return;
    stopped = true;
    session.abort(new DOMException('AR 已关闭。', 'AbortError'));
    signal?.removeEventListener('abort', abort);
    observer?.disconnect();
    if (mind) {
      mind.renderer.setAnimationLoop(null);
      window.removeEventListener('resize', mind.resizeListener);
      disposeController();
      mind.renderer.dispose();
      mind.renderer.forceContextLoss();
    }
    tracksOff(stream);
    for (const resource of disposables) resource.dispose();
    mount.remove();
  }
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => session.abort(new Error('启动超时。请检查摄像头授权，再试一次。')), 25000);
  const cancelled = new Promise((_, reject) => {
    session.signal.addEventListener('abort', () => reject(session.signal.reason), { once:true });
  });
  const wait = (task) => Promise.race([task, cancelled]);

  try {
    // Request only the rear video camera. If permission finishes after closing AR, release it immediately.
    const acquire = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode:{ideal:'environment'}, width:{ideal:960}, height:{ideal:720} }
    });
    stream = await wait(acquire.then(value => {
      if (session.signal.aborted) {
        tracksOff(value);
        throw session.signal.reason;
      }
      return value;
    }));
    const video = await wait(makeVideo(mount, stream, session.signal));
    mind = new MindARThree({
      container: mount,
      imageTargetSrc: new URL('magnet.mind', directory).href,
      maxTrack: 1,
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
      warmupTolerance: 3,
      missTolerance: 5
    });
    mind.video = video;
    mind.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    Object.assign(mind.renderer.domElement.style, { zIndex:'1', pointerEvents:'none' });
    mind.cssRenderer.domElement.style.display = 'none';
    mind.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      if (!stopped) {
        stop();
        onError?.(new Error('AR 画面暂时中断，请重新开启。'));
      }
    });
    const loader = new THREE.TextureLoader();
    const textures = await wait(Promise.all(portraits.map(async p => {
      const texture = await loader.loadAsync(new URL(p.file, directory).href);
      if (stopped) texture.dispose();
      else disposables.add(texture);
      texture.encoding = THREE.sRGBEncoding;
      texture.anisotropy = 2;
      return texture;
    })));
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const anchor = mind.addAnchor(0);
    const stage = createStage(anchor, textures, quiet);
    anchor.group.traverse(node => {
      if (node.geometry) disposables.add(node.geometry);
      if (node.material) {
        disposables.add(node.material);
        if (node.material.map) disposables.add(node.material.map);
      }
    });
    let tracking = false;
    anchor.onTargetFound = () => {
      if (stopped) return;
      tracking = true;
      stage.reveal();
      onState?.('tracking');
    };
    anchor.onTargetLost = () => {
      if (stopped) return;
      tracking = false;
      onState?.('lost');
    };

    const initialize = mind._startAR().finally(() => { if (stopped) disposeController(); });
    await wait(initialize);
    if (!tracking) onState?.('searching');
    observer = new ResizeObserver(() => {
      if (!stopped && mind.controller && mount.clientWidth && mount.clientHeight) mind.resize();
    });
    observer.observe(mount);
    mind.renderer.setAnimationLoop(now => {
      if (tracking) stage.animate(now);
      mind.renderer.render(mind.scene, mind.camera);
    });
    return { stop, select: index => stage.pick(index) };
  } catch (error) {
    stop();
    throw error ?? new Error('无法开启 AR。');
  } finally {
    clearTimeout(timeout);
  }
}
