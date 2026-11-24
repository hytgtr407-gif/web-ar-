const VISION_VERSION = "0.10.21";
const NPM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + VISION_VERSION;
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const MODEL_MIRROR = "https://cdn.jsdelivr.net/gh/nhaidaar/palmprint-skripsi@master/app/static/vendor/mediapipe/hand_landmarker.task";
const MODEL_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
const LOCAL = new URL("./vendor/", import.meta.url);
const MAX_LOAD_MS = 8000;
const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

function abortError() {
  return new DOMException("手势识别已关闭", "AbortError");
}

function waitFor(work, { signal, ms = MAX_LOAD_MS, dispose } = {}) {
  return new Promise((resolve, reject) => {
    let waiting = true;
    const settle = (callback, value) => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => settle(reject, abortError());
    const timer = setTimeout(() => settle(reject, new Error("手势模型加载超时")), ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    Promise.resolve(work).then(
      (value) => {
        if (waiting) settle(resolve, value);
        else dispose?.(value);
      },
      (error) => settle(reject, error)
    );
  });
}

async function loadDetector(signal) {
  const localModel = new URL("hand_landmarker.task", LOCAL).href;
  const localPackage = await fetch(localModel, { method: "HEAD", signal }).then(
    (response) => {
      const size = Number(response.headers.get("content-length"));
      return response.ok && size > 1_000_000 && !response.headers.get("content-type")?.includes("text/html");
    },
    () => false
  );
  const bundle = localPackage ? new URL("vision_bundle.mjs", LOCAL).href : NPM_CDN + "/vision_bundle.mjs";
  const wasm = localPackage ? new URL("wasm", LOCAL).href : NPM_CDN + "/wasm";
  const { FilesetResolver, HandLandmarker } = await import(bundle);
  if (signal?.aborted) throw abortError();
  const download = (url, requestSignal) => fetch(url, {
    signal: requestSignal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }).then(async (response) => {
    if (!response.ok) throw new Error("无法下载手势模型");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== 7_819_105) throw new Error("手势模型大小不完整");
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== MODEL_SHA256) throw new Error("手势模型校验失败");
    return new Uint8Array(buffer);
  });
  const request = new AbortController();
  const abortRequest = () => request.abort();
  signal?.addEventListener("abort", abortRequest, { once: true });
  if (signal?.aborted) abortRequest();
  let assets;
  try {
    const modelPromise = localPackage
      ? download(localModel, request.signal)
      : waitFor(download(MODEL, request.signal), { signal, ms: 3800 })
        .catch((error) => {
          if (signal?.aborted) throw error;
          return download(MODEL_MIRROR, request.signal);
        });
    assets = await Promise.all([FilesetResolver.forVisionTasks(wasm), modelPromise]);
  } finally {
    abortRequest();
    signal?.removeEventListener("abort", abortRequest);
  }
  if (signal?.aborted) throw abortError();
  const [files, modelAssetBuffer] = assets;
  return HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetBuffer, delegate: "CPU" },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.53,
    minTrackingConfidence: 0.52,
  });
}

function distance(a, b, aspect = 1) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

function extractHand(result, aspect) {
  const hand = result.landmarks[0];
  if (!hand || hand.length !== 21) return null;
  const wrist = hand[0];
  const palm = hand[9];
  const size = distance(wrist, palm, aspect);
  if (size < 0.032) return null;
  const extended = FINGERS.filter(([mcp, pip, dip, tip]) => {
    const span = distance(hand[mcp], hand[tip], aspect);
    const arc = distance(hand[mcp], hand[pip], aspect) +
      distance(hand[pip], hand[dip], aspect) +
      distance(hand[dip], hand[tip], aspect);
    return span > arc * 0.84 && distance(wrist, hand[tip], aspect) > distance(wrist, hand[pip], aspect) + size * 0.24;
  }).length;
  const unpinched = distance(hand[4], hand[8], aspect) > size * 0.22;
  return {
    x: 1 - (wrist.x + hand[5].x + palm.x + hand[17].x) / 4,
    y: (wrist.y + hand[5].y + palm.y + hand[17].y) / 4,
    open: extended >= 3 && unpinched,
    size,
  };
}

function makeMotionSensor() {
  const width = 96;
  const height = 64;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const previous = new Uint8Array(width * height);
  let sampled = false;
  return (video) => {
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const columns = new Float32Array(width);
    const rows = new Float32Array(height);
    let changed = 0;
    for (let index = 0; index < previous.length; index++) {
      const offset = index * 4;
      const value = (rgba[offset] * 3 + rgba[offset + 1] * 5 + rgba[offset + 2] * 2) / 10;
      const delta = Math.abs(value - previous[index]);
      previous[index] = value;
      if (!sampled || delta < 24) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < 4 || x >= width - 4 || y < 3 || y > height * 0.82) continue;
      changed++;
      columns[x] += delta;
      rows[y] += delta;
    }
    sampled = true;
    // Reject room-wide movement, such as exposure changes or the laptop being moved.
    if (changed < 30 || changed > width * height * 0.29) return null;
    let peakX = 0;
    let peakScore = 0;
    for (let x = 8; x < width - 8; x++) {
      let score = 0;
      for (let k = x - 7; k <= x + 7; k++) score += columns[k];
      if (score > peakScore) {
        peakScore = score;
        peakX = x;
      }
    }
    const energy = columns.reduce((sum, value) => sum + value, 0);
    if (peakScore < energy * 0.32) return null;
    const rowEnergy = rows.reduce((sum, value) => sum + value, 0);
    const centerY = rows.reduce((sum, value, y) => sum + value * y, 0) / rowEnergy;
    return { x: 1 - peakX / (width - 1), y: centerY / (height - 1), open: false, size: 0.12 };
  };
}

function makeInterpreter({ onGesture, onStatus, onPosition }) {
  let samples = [];
  let palmSince = 0;
  let palmSent = false;
  let releaseSince = 0;
  let lastSwipe = -Infinity;
  let lastSeen = -Infinity;
  let lastMotionStart = -Infinity;
  let visible = false;
  let filtered = null;
  let heldDirection = 0;

  return (position, now, motionMode) => {
    if (!position) {
      if (now - lastSeen < 175) return;
      if (visible) {
        visible = false;
        if (!motionMode) onStatus?.("hand-lost");
        onPosition?.(null);
      }
      samples = [];
      filtered = null;
      palmSince = 0;
      palmSent = false;
      releaseSince = 0;
      heldDirection = 0;
      return;
    }
    // A hand returning after an occlusion must establish a new trajectory.
    if (now - lastSeen > 155) {
      samples = [];
      filtered = null;
      palmSince = 0;
    }
    lastSeen = now;
    if (!visible) {
      visible = true;
      if (!motionMode) onStatus?.("hand-found");
    }
    const blend = motionMode ? 0.65 : 0.83;
    filtered = filtered ? {
      ...position,
      x: filtered.x + (position.x - filtered.x) * blend,
      y: filtered.y + (position.y - filtered.y) * blend,
    } : position;
    onPosition?.(filtered);
    samples.push({ ...filtered, time: now });
    const windowMs = motionMode ? 620 : 465;
    while (now - samples[0].time > windowMs) samples.shift();
    const earliest = samples[0];
    const dx = filtered.x - earliest.x;
    const dy = filtered.y - earliest.y;
    const elapsed = now - earliest.time;

    if (motionMode && elapsed >= 125 && Math.abs(dx) >= 0.105 &&
        Math.abs(dx) > Math.abs(dy) * 1.25 && now - lastMotionStart > 1000) {
      lastMotionStart = now;
      onGesture?.({ type: "motion-start" });
    }

    if (!motionMode && position.open) {
      releaseSince = 0;
      if (!palmSince) palmSince = now;
      // Holding, rather than crossing the frame, opens the first curtain.
      if (!palmSent && now - palmSince >= 300 && Math.abs(dx) < 0.105 && Math.abs(dy) < 0.15) {
        palmSent = true;
        onGesture?.({ type: "palm" });
      }
    } else if (!motionMode) {
      if (!releaseSince) releaseSince = now;
      if (now - releaseSince > 140) {
        palmSince = 0;
        palmSent = false;
      }
    }

    const rest = samples.filter(sample => now - sample.time <= 170);
    if (rest.length >= 3 && now - rest[0].time >= 105) {
      const recentX = rest.map(sample => sample.x);
      if (Math.max(...recentX) - Math.min(...recentX) < .023) heldDirection = 0;
    }
    if (now - lastSwipe < (motionMode ? 340 : 245)) return;

    const limit = motionMode ? .15 : Math.min(.13, Math.max(.078, filtered.size * .47));
    let travelled = 0;
    for (let i = samples.length - 2; i >= 0; i--) {
      const anchor = samples[i];
      travelled += Math.abs(samples[i + 1].x - anchor.x);
      const horizontal = filtered.x - anchor.x;
      const distance = Math.abs(horizontal);
      const age = now - anchor.time;
      const sign = Math.sign(horizontal);
      if (i === samples.length - 2 && distance < limit * 1.4) continue;
      if (age < (motionMode ? 95 : 48) || distance < limit || sign === heldDirection ||
          distance < age * (motionMode ? .00022 : .00025) || distance < travelled * .72 ||
          distance < Math.abs(filtered.y - anchor.y) * 1.26) continue;
      lastSwipe = now;
      heldDirection = sign;
      samples = [{ ...filtered, time: now }];
      onGesture?.({ type: "swipe", direction: sign > 0 ? "right" : "left" });
      break;
    }
  };
}

/**
 * Starts a camera session. Positions and directions follow a mirrored preview.
 * Video frames are read locally and never uploaded. Returns an idempotent stop function.
 */
export async function startHands(video, options = {}) {
  const { signal, onStatus, onError } = options;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前页面无法打开摄像头，请在 Edge 或 Chrome 中通过本机展台入口打开。");
  }
  if (signal?.aborted) throw abortError();
  let stream;
  let detector;
  let stopped = false;
  let frame;
  const init = new AbortController();
  function stop() {
    if (stopped) return;
    stopped = true;
    init.abort();
    signal?.removeEventListener("abort", stop);
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
    detector?.close();
  }
  signal?.addEventListener("abort", stop, { once: true });
  const motion = makeMotionSensor();
  try {
    onStatus?.("requesting-camera");
    stream = await waitFor(navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    }), {
      signal: init.signal,
      ms: 25000,
      dispose: (lateStream) => lateStream.getTracks().forEach((track) => track.stop()),
    });
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await waitFor(video.play(), { signal: init.signal, ms: 8000 });
    onStatus?.("loading-model");
    try {
      detector = await waitFor(loadDetector(init.signal), {
        signal: init.signal,
        dispose: (lateDetector) => lateDetector.close(),
      });
    } catch (error) {
      if (init.signal.aborted) throw error;
    }
    if (stopped) throw abortError();
    onStatus?.(detector ? "ready" : "motion-fallback");
  } catch (error) {
    stop();
    throw error;
  }
  let lastTime = -1;
  let lastFrameAt = -Infinity;
  let interpret = makeInterpreter(options);
  const cleanupIfCameraEnded = () => {
    stop();
    onError?.(new Error("摄像头已断开，请重新开启感应。"));
  };
  stream.getVideoTracks().forEach((track) => track.addEventListener("ended", cleanupIfCameraEnded, { once: true }));

  function tick(now) {
    if (stopped) return;
    frame = requestAnimationFrame(tick);
    if (video.readyState < 2 || video.currentTime === lastTime || now - lastFrameAt < (detector ? 29 : 46)) return;
    lastTime = video.currentTime;
    lastFrameAt = now;
    let position;
    try {
      position = detector
        ? extractHand(detector.detectForVideo(video, now), video.videoWidth / video.videoHeight)
        : motion(video);
    } catch (error) {
      if (!detector) {
        stop();
        onError?.(error);
        return;
      }
      detector.close();
      detector = null;
      options.onPosition?.(null);
      interpret = makeInterpreter(options);
      onStatus?.("motion-fallback");
      return;
    }
    interpret(position, now, !detector);
  }
  frame = requestAnimationFrame(tick);
  return stop;
}
