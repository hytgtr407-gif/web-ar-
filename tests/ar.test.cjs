const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

class Element {
  constructor() { this.listeners = {}; this.attributes = {}; this.textContent = ''; this.disabled = false; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  emit(type, fields = {}) { for (const callback of this.listeners[type] ?? []) callback({ type, target: this, currentTarget: this, ...fields }); }
  setAttribute(key, value) { this.attributes[key] = value; }
  appendChild(child) { this.child = child; }
  remove() { this.removed = true; }
  click() { this.emit('click'); }
}

async function app(options = {}) {
  const ids = Object.fromEntries(['status', 'help', 'content', 'start', 'debug-overlay', 'debug-toggle', 'ar-container', 'export', 'ar-template'].map(id => [id, new Element()]));
  const requests = [];
  const timers = new Map();
  const blobs = new Map();
  let blobID = 0;
  let starts = 0;
  let stops = 0;
  let initializes = 0;
  let reloads = 0;
  let scene;
  const window = new Element();
  window.isSecureContext = options.secure ?? true;
  window.location = { search: options.search ?? '', reload: () => reloads++ };
  const document = new Element();
  document.baseURI = 'https://example.github.io/web-ar-/';
  document.getElementById = id => ids[id];
  document.createElement = () => new Element();
  document.body = new Element();
  document.head = new Element();
  document.head.appendChild = async script => {
    const url = await blobs.get(script.src).text();
    if (url.includes('aframe@')) window.AFRAME = { components: {} };
    else window.AFRAME.components['mindar-image-target'] = {};
    script.onload();
  };
  ids['ar-template'].content = { firstElementChild: { cloneNode: () => {
    scene = new Element();
    scene.canvas = new Element();
    scene.entities = [...html.matchAll(/id="target(\d+)" mindar-image-target="targetIndex: (\d+)"/g)].map(match => {
      const entity = new Element();
      entity.id = 'target' + match[1];
      entity.components = { 'mindar-image-target': { data: { targetIndex: Number(match[2]) } } };
      return entity;
    });
    scene.querySelectorAll = () => scene.entities;
    scene.systems = { 'mindar-image-system': {
      start: () => starts++,
      _startAR: async () => { initializes++; if (options.initError) throw new Error(options.initError); },
      video: { srcObject: { getTracks: () => [{ stop: () => stops++ }] }, remove() {} },
      pause() {}, unpause() {}
    } };
    return scene;
  } } };
  class TestURL extends URL {
    static createObjectURL(blob) { const url = 'blob:test-' + ++blobID; blobs.set(url, blob); return url; }
    static revokeObjectURL() {}
  }
  vm.runInNewContext(source, {
    window, document, navigator: { mediaDevices: options.noCamera ? {} : { getUserMedia() {} } },
    URL: TestURL, URLSearchParams, Blob, AbortController, console: { warn() {} },
    setTimeout: (callback, ms) => { const id = timers.size + 1; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async url => {
      url = String(url); requests.push(url);
      if (options.primaryFail && url.includes('cdn.jsdelivr.net')) throw new Error('CDN unreachable');
      const bad = options.targetFail && url.endsWith('.mind');
      return { ok: !bad, status: bad ? 404 : 200, arrayBuffer: async () => Buffer.from(url) };
    }
  });
  await new Promise(setImmediate);
  return { ids, window, document, requests, blobs, timers,
    get scene() { return scene; }, get starts() { return starts; },
    get stops() { return stops; }, get initializes() { return initializes; }, get reloads() { return reloads; },
    start() { ids.start.click(); scene.emit('loaded'); },
    ready() { this.start(); scene.emit('arReady'); },
    async csv() { ids.export.click(); return blobs.get(document.body.child.href).text(); }
  };
}

test('the verified compiled target file has not changed silently', () => {
  const bytes = fs.readFileSync(path.join(root, 'assets/targets/bgji_targets.mind'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'fc97a340f65c580cd3b8b7d9bec7676018b2a3538102e8203cb1c5443959fe50');
});

test('prepare without camera access and resolve the Pages project-relative target only once', async () => {
  const a = await app();
  assert.equal(a.ids.status.textContent, '资源已就绪');
  assert.equal(a.starts, 0);
  assert.deepEqual(a.requests.filter(url => url.endsWith('.mind')), ['https://example.github.io/web-ar-/assets/targets/bgji_targets.mind']);
  a.start(); a.ids.start.click();
  assert.equal(a.starts, 1, 'repeated taps must not start multiple camera streams');
});

test('child loaded events do not start MindAR before the whole scene loads', async () => {
  const a = await app();
  a.ids.start.click();
  a.scene.emit('loaded', { target: a.scene.entities[0] });
  assert.equal(a.starts, 0);
  a.scene.emit('loaded'); a.scene.emit('loaded');
  assert.equal(a.starts, 1);
});

test('all three cards display the binary-verified role and export matching found/lost IDs and indices', async () => {
  const a = await app(); a.ready();
  const expected = [['边一笑', 'BGJ_CHAR_006'], ['崔云龙', 'BGJ_CHAR_008'], ['张岫玉', 'BGJ_CHAR_007']];
  assert.equal(a.scene.entities.length, 3);
  for (const [index, entity] of a.scene.entities.entries()) {
    entity.emit('targetFound');
    assert.ok(a.ids.content.textContent.startsWith(expected[index][0]));
    assert.ok(a.ids['debug-overlay'].textContent.includes(`targetIndex: ${index}`));
    entity.emit('targetLost');
    assert.equal(a.ids.status.textContent, '卡片已离开画面');
  }
  const csv = await a.csv();
  for (const [index, [, id]] of expected.entries()) {
    assert.ok(csv.includes(`,${id},${index},target_found,`));
    assert.ok(csv.includes(`,${id},${index},target_lost,`));
  }
});

test('read the actual MindAR component index, even when DOM IDs/order disagree', async () => {
  const a = await app(); a.ready();
  a.scene.entities[0].components['mindar-image-target'].data.targetIndex = 2;
  a.scene.entities[0].emit('targetFound');
  assert.ok(a.ids.content.textContent.startsWith('张岫玉'));
  assert.ok(a.ids['debug-overlay'].textContent.includes('targetIndex: 2'));
  a.scene.entities[0].components['mindar-image-target'].data.targetIndex = 9;
  a.scene.entities[0].emit('targetFound');
  assert.equal(a.ids.content.textContent, '未知 targetIndex: 9');
});

test('a failed primary CDN falls back for both libraries', async () => {
  const a = await app({ primaryFail: true });
  assert.equal(a.ids.status.textContent, '资源已就绪');
  assert.equal(a.requests.filter(url => url.includes('unpkg.com')).length, 2);
});

test('a target 404 shows a retry action without opening the camera', async () => {
  const a = await app({ targetFail: true });
  assert.ok(a.ids.help.textContent.includes('HTTP 404'));
  assert.equal(a.ids.start.disabled, false);
  assert.equal(a.starts, 0);
  a.ids.start.click(); assert.equal(a.reloads, 1);
});

test('camera failure and async target import failure produce visible errors and stop tracks', async () => {
  const a = await app(); a.start(); a.scene.emit('arError');
  assert.ok(a.ids.help.textContent.includes('相机权限'));
  assert.equal(a.stops, 1);
  const b = await app({ initError: 'Invalid MessagePack' }); b.start();
  await b.scene.systems['mindar-image-system']._startAR();
  assert.ok(b.ids.help.textContent.includes('Invalid MessagePack'));
  assert.equal(b.stops, 1);
});

test('startup timeout prevents a late camera permission result from initializing AR', async () => {
  const a = await app(); a.start();
  [...a.timers.values()].find(timer => timer.ms === 60000).callback();
  await a.scene.systems['mindar-image-system']._startAR();
  assert.equal(a.initializes, 0);
  assert.ok(a.ids.help.textContent.includes('启动超时'));
  assert.ok(a.stops >= 1);
});

test('unsupported contexts and cameras fail clearly before downloading libraries', async () => {
  for (const options of [{ secure: false }, { noCamera: true }]) {
    const a = await app(options);
    assert.equal(a.ids.status.textContent, '启动或运行失败');
    assert.equal(a.requests.length, 0);
  }
});

test('debug defaults to visible, can be hidden by query and toggled back on', async () => {
  const a = await app({ search: '?debug=0' });
  assert.equal(a.ids['debug-overlay'].hidden, true);
  a.ids['debug-toggle'].click();
  assert.equal(a.ids['debug-overlay'].hidden, false);
});
