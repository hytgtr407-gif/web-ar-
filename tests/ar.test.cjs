const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const productionMetadata = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/scene.json'), 'utf8'));
const studyMetadata = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/study-scene.json'), 'utf8'));
function allowedFixture() {
  const data = structuredClone(productionMetadata);
  for (const record of Object.values(data)) record.audited = true;
  return data;
}

class Element {
  constructor() { this.listeners = {}; this.attributes = {}; this.textContent = ''; this.disabled = false; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  emit(type, fields = {}) { for (const callback of this.listeners[type] ?? []) callback({ type, target: this, currentTarget: this, ...fields }); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  replaceChildren() { this.children = []; this.child = undefined; }
  appendChild(child) { this.child = child; (this.children ??= []).push(child); }
  remove() { this.removed = true; }
  click() { this.emit('click'); }
}

async function app(options = {}) {
  const ids = Object.fromEntries(['status', 'help', 'content', 'start', 'debug-overlay', 'debug-toggle', 'ar-container', 'export', 'ar-template', 'review-status', 'sources', 'guide', 'info', 'session-code', 'observer-panel', 'observer-status', 'observer-task', 'observer-start', 'observer-end', 'observer-help', 'version-code', 'study-label', 'entry-link'].map(id => [id, new Element()]));
  ids.guide.setAttribute('open', '');
  if (options.studyPreview) {
    ids['study-notice'] = new Element();
    ids['study-notice'].dataset = { studyVersion: options.studyVersion ?? 'bgj-study-v2' };
  }
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
  // Retain the original release-regression expectations under the explicit A condition.
  window.location = { search: options.search ?? '?ui=A', reload: () => reloads++ };
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
      entity.semanticContent = new Element();
      entity.semanticContent.setAttribute('visible', false);
      entity.querySelector = () => entity.semanticContent;
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
    URL: TestURL, URLSearchParams, Blob, AbortController, TextDecoder, performance, console: { warn() {} },
    setTimeout: (callback, ms) => { const id = timers.size + 1; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, init) => {
      url = String(url); requests.push(url);
      if (url.endsWith('/assets/data/scene.json') || url.endsWith('/assets/data/study-scene.json')) {
        if (options.metadataTimeout) return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Timeout')), { once: true }));
        return { ok: !options.metadataFail, status: options.metadataFail ? 404 : 200,
          arrayBuffer: async () => Buffer.from(options.metadataText ?? JSON.stringify(options.metadata ?? (options.studyPreview ? studyMetadata : productionMetadata))) };
      }
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
  const a = await app({ metadata: allowedFixture() }); a.ready();
  const expected = [['边一笑', 'BGJ_CHAR_006'], ['崔云龙', 'BGJ_CHAR_008'], ['张岫玉', 'BGJ_CHAR_007']];
  assert.equal(a.scene.entities.length, 3);
  for (const [index, entity] of a.scene.entities.entries()) {
    entity.emit('targetFound');
    assert.ok(a.ids.content.textContent.startsWith(expected[index][0]));
    assert.equal(entity.semanticContent.attributes.visible, true);
    assert.ok(a.ids['debug-overlay'].textContent.includes(`targetIndex: ${index}`));
    entity.emit('targetLost');
    assert.equal(a.ids.status.textContent, '卡片已离开画面');
    assert.equal(entity.semanticContent.attributes.visible, false);
  }
  const csv = await a.csv();
  for (const [index, [, id]] of expected.entries()) {
    assert.ok(csv.includes(`,${id},${index},target_found,`));
    assert.ok(csv.includes(`,${id},${index},target_lost,`));
    assert.ok(csv.includes(`,${id},${index},semantic_gate_pass,`));
  }
});

test('read the actual MindAR component index, even when DOM IDs/order disagree', async () => {
  const a = await app({ metadata: allowedFixture() }); a.ready();
  a.scene.entities[0].components['mindar-image-target'].data.targetIndex = 2;
  a.scene.entities[0].emit('targetFound');
  assert.ok(a.ids.content.textContent.startsWith('张岫玉'));
  assert.ok(a.ids['debug-overlay'].textContent.includes('targetIndex: 2'));
  a.scene.entities[0].components['mindar-image-target'].data.targetIndex = 9;
  a.scene.entities[0].emit('targetFound');
  assert.equal(a.ids.status.textContent, '识别到未配置卡片');
  assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
  assert.ok((await a.csv()).includes(',unknown_target'));
});

test('production records remain unaudited and block text and AR layers for all three cards', async () => {
  const a = await app(); a.ready();
  assert.deepEqual(a.requests.filter(url => url.endsWith('scene.json')), ['https://example.github.io/web-ar-/assets/data/scene.json']);
  for (const entity of a.scene.entities) {
    const index = entity.components['mindar-image-target'].data.targetIndex;
    const id = ['BGJ_CHAR_006', 'BGJ_CHAR_008', 'BGJ_CHAR_007'][index];
    assert.equal(productionMetadata[id].audited, false);
    entity.emit('targetFound');
    assert.ok(a.ids.status.textContent.startsWith('已识别：'));
    assert.equal(a.ids.content.textContent, '内容暂未开放\n人物介绍尚未完成专家审核，暂不展示。');
    assert.equal(entity.semanticContent.attributes.visible, false);
    entity.emit('targetLost');
    assert.equal(a.ids.content.textContent, '请将角色卡放回画面。');
  }
  const csv = await a.csv();
  assert.equal(csv.split('\n').filter(row => row.includes(',semantic_gate_block,')).length, 3);
  assert.ok(!csv.includes(',semantic_gate_pass,'));
  assert.ok(csv.includes(',audited_not_true'));
});

test('each gate flag rejects false, missing, null, strings and numeric truthy values', async () => {
  for (const field of ['audited', 'version_matched', 'resource_valid']) {
    for (const value of [false, undefined, null, 'true', 'false', 1]) {
      const metadata = allowedFixture();
      if (value === undefined) delete metadata.BGJ_CHAR_006[field];
      else metadata.BGJ_CHAR_006[field] = value;
      const a = await app({ metadata }); a.ready(); a.scene.entities[0].emit('targetFound');
      assert.ok(a.ids.content.textContent.startsWith('内容暂未开放'), `${field}=${value}`);
      assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
      assert.ok((await a.csv()).includes(`${field}_not_true`));
    }
  }
});

test('a missing role, mismatched identity or invalid content fails closed despite all flags true', async () => {
  for (const mutate of [
    data => delete data.BGJ_CHAR_006,
    data => data.BGJ_CHAR_006 = [],
    data => data.BGJ_CHAR_006.id = 'BGJ_CHAR_008',
    data => data.BGJ_CHAR_006.targetIndex = 1,
    data => data.BGJ_CHAR_006.title = '崔云龙',
    data => data.BGJ_CHAR_006.target = 'old.mind',
    data => data.BGJ_CHAR_006.description = '',
    data => data.BGJ_CHAR_006.description = 42
  ]) {
    const metadata = allowedFixture(); mutate(metadata);
    const a = await app({ metadata }); a.ready(); a.scene.entities[0].emit('targetFound');
    assert.ok(a.ids.content.textContent.startsWith('内容暂未开放'));
    assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
    assert.ok(!(await a.csv()).includes(',semantic_gate_pass,'));
  }
});

test('unavailable or malformed metadata preserves recognition and blocks delivery', async () => {
  for (const options of [{ metadataFail: true }, { metadataText: '{bad' }, { metadataText: '[]' }, { metadataText: 'null' }]) {
    const a = await app(options);
    assert.equal(a.ids.status.textContent, '资源已就绪');
    a.ready(); a.scene.entities[0].emit('targetFound');
    assert.ok(a.ids.status.textContent.startsWith('已识别：'));
    assert.equal(a.ids.content.textContent, '内容暂未开放\n内容数据暂时不可用。');
    const csv = await a.csv();
    assert.ok(csv.includes(',target_found,'));
    assert.ok(csv.includes(',semantic_metadata_error,'));
    assert.ok(csv.includes(',semantic_gate_block,'));
  }
});

test('metadata download timeout still allows camera startup with delivery blocked', async () => {
  const a = await app({ metadataTimeout: true });
  [...a.timers.values()].find(timer => timer.ms === 15000).callback();
  await new Promise(setImmediate);
  assert.equal(a.ids.status.textContent, '资源已就绪');
  a.ready(); a.scene.entities[0].emit('targetFound');
  assert.equal(a.ids.content.textContent, '内容暂未开放\n内容数据暂时不可用。');
});

test('switching from allowed to blocked content hides old layers and tolerates a late loss', async () => {
  const metadata = allowedFixture(); metadata.BGJ_CHAR_008.audited = false;
  const a = await app({ metadata }); a.ready();
  a.scene.entities[0].emit('targetFound');
  assert.equal(a.scene.entities[0].semanticContent.attributes.visible, true);
  a.scene.entities[1].emit('targetFound');
  assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
  assert.equal(a.scene.entities[1].semanticContent.attributes.visible, false);
  a.scene.entities[0].emit('targetLost');
  assert.equal(a.ids.content.textContent, '内容暂未开放\n人物介绍尚未完成专家审核，暂不展示。');
  a.scene.entities[1].emit('targetLost');
  assert.equal(a.ids.content.textContent, '请将角色卡放回画面。');
});

test('HTML starts every cultural AR layer hidden before any target event', () => {
  assert.equal([...html.matchAll(/data-semantic-content visible="false"/g)].length, 3);
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

test('debug defaults to hidden, can be opened explicitly and toggled', async () => {
  const a = await app({ search: '' });
  assert.equal(a.ids['debug-overlay'].hidden, true);
  a.ids['debug-toggle'].click();
  assert.equal(a.ids['debug-overlay'].hidden, false);
  const b = await app({ search: '?debug=1' });
  assert.equal(b.ids['debug-overlay'].hidden, false);
});

test('research preview shows three unaudited drafts without logging audited gate passes and clears on loss', async () => {
  const a = await app({ studyPreview: true }); a.ready();
  assert.ok(a.requests.includes('https://example.github.io/web-ar-/assets/data/study-scene.json'));
  for (const entity of a.scene.entities) {
    a.ids.info.scrollTop = 100;
    entity.emit('targetFound');
    assert.equal(entity.semanticContent.attributes.visible, true);
    assert.ok(a.ids.content.textContent.includes('人物介绍待闽剧专家审核与校订'));
    assert.ok(a.ids['debug-overlay'].textContent.includes('Semantic Gate: 拦截'));
    entity.emit('targetLost');
    assert.equal(entity.semanticContent.attributes.visible, false);
    assert.equal(a.ids.content.textContent, '请将角色卡放回画面。');
  }
  const csv = await a.csv();
  assert.equal(csv.split('\n').filter(row => row.includes(',research_preview_display,')).length, 3);
  assert.equal(csv.split('\n').filter(row => row.includes(',semantic_gate_block,')).length, 3);
  assert.ok(!csv.includes(',semantic_gate_pass,'));
  assert.ok(csv.includes(',research_preview,bgj-study-v2'));
  assert.ok(csv.includes('study_mode,content_version'));
});

test('query parameters and study data cannot open preview content in the production entry', async () => {
  const a = await app({ metadata: studyMetadata, search: '?study=1&preview=true' }); a.ready();
  for (const entity of a.scene.entities) {
    entity.emit('targetFound');
    assert.equal(entity.semanticContent.attributes.visible, false);
  }
  assert.ok(!(await a.csv()).includes(',research_preview_display,'));
});

test('research preview still blocks invalid identity, resources, versions, missing sources and malformed audit flags', async () => {
  for (const mutate of [
    r => r.id = 'BGJ_CHAR_008', r => r.targetIndex = 2,
    r => r.version_matched = false, r => r.resource_valid = false,
    r => r.audited = 'false', r => delete r.audited,
    r => r.description = '', r => r.sources = [],
    r => r.sources = ['https://bad.example/a,inject'],
    r => r.content_version = 'old', r => r.research_preview = false
  ]) {
    const metadata = structuredClone(studyMetadata); mutate(metadata.BGJ_CHAR_006);
    const a = await app({ studyPreview: true, metadata }); a.ready();
    a.scene.entities[0].emit('targetFound');
    assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
    assert.ok(!(await a.csv()).includes(',research_preview_display,'));
  }
});

test('a late loss does not erase a newly displayed research draft', async () => {
  const a = await app({ studyPreview: true }); a.ready();
  a.scene.entities[0].emit('targetFound');
  a.scene.entities[1].emit('targetFound');
  a.scene.entities[0].emit('targetLost');
  assert.ok(a.ids.content.textContent.startsWith('崔云龙'));
  assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
  assert.equal(a.scene.entities[1].semanticContent.attributes.visible, true);
});

test('B identifies each card while preserving formal blocking, then clears on loss', async () => {
  const a = await app({ search: '' }); a.ready();
  for (const [index, name] of ['边一笑', '崔云龙', '张岫玉'].entries()) {
    const entity = a.scene.entities[index];
    entity.emit('targetFound');
    assert.equal(a.ids.status.textContent, `已识别：${name}`);
    assert.ok(a.ids.content.textContent.includes('尚未完成专家审核，暂不展示'));
    assert.equal(entity.semanticContent.attributes.visible, false);
    assert.equal(a.ids.sources.hidden, true);
    entity.emit('targetLost');
    assert.equal(a.ids['review-status'].textContent, '当前未显示人物介绍');
    assert.ok(a.ids.help.textContent.includes('放回镜头'));
  }
  assert.ok(!(await a.csv()).includes(',semantic_gate_pass,'));
});

test('B shows labelled research drafts and sources, clears both, and reacquires without false gate passes', async () => {
  const a = await app({ studyPreview: true, search: '' }); a.ready();
  for (const entity of a.scene.entities) {
    entity.emit('targetFound');
    assert.ok(a.ids['review-status'].textContent.includes('尚未完成专家审核'));
    assert.ok(a.ids.content.textContent.includes('人物关系：'));
    assert.equal(entity.semanticContent.attributes.visible, true);
    assert.equal(a.ids.sources.hidden, false);
    const sourceLink = a.ids.sources.children[1];
    assert.ok(sourceLink.href.startsWith('https://'));
    sourceLink.click();
    entity.emit('targetLost');
    assert.equal(a.ids.sources.hidden, true);
    assert.equal(a.ids.sources.children.length, 0);
    assert.equal(entity.semanticContent.attributes.visible, false);
    entity.emit('targetFound');
    assert.equal(entity.semanticContent.attributes.visible, true);
  }
  assert.equal(a.ids.guide.attributes.open, undefined);
  assert.equal(a.ids.info.attributes['data-scanning'], 'true');
  const csv = await a.csv();
  assert.ok(csv.includes(',research_preview_display,'));
  assert.ok(csv.includes(',source_opened,'));
  assert.ok(!csv.includes(',semantic_gate_pass,'));
});

test('B explains missing audit state without asserting that an audit is merely pending', async () => {
  const metadata = allowedFixture(); delete metadata.BGJ_CHAR_006.audited;
  const a = await app({ metadata, search: '' }); a.ready(); a.scene.entities[0].emit('targetFound');
  assert.ok(a.ids.content.textContent.includes('无法确认人物介绍已完成审核'));
  assert.ok(!a.ids.content.textContent.includes('尚未完成专家审核'));
  assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
});

test('B preserves the current draft and its sources after a late loss from another card', async () => {
  const a = await app({ studyPreview: true, search: '' }); a.ready();
  a.scene.entities[0].emit('targetFound');
  a.scene.entities[1].emit('targetFound');
  const text = a.ids.content.textContent;
  a.ids.info.scrollTop = 100;
  a.scene.entities[0].emit('targetLost');
  assert.equal(a.ids.content.textContent, text);
  assert.equal(a.ids.sources.hidden, false);
  assert.equal(a.ids.status.textContent, '已识别：崔云龙');
  assert.equal(a.ids.info.scrollTop, 100);
  a.scene.entities[1].emit('targetLost');
  assert.equal(a.ids.info.scrollTop, 0);
});

test('all conditions export session, interface and content versions without assuming task completion', async () => {
  for (const search of ['', '?ui=A', '?ui=B', '?ui=invalid&preview=true']) {
    const a = await app({ studyPreview: true, search }); a.ready();
    a.scene.entities[0].emit('targetFound');
    const csv = await a.csv();
    const rows = csv.trim().replace(/^\uFEFF/, '').split('\n').map(row => row.split(','));
    assert.ok(rows[0].includes('ui_variant'));
    assert.ok(rows[0].includes('interface_version'));
    const variant = search === '?ui=A' ? 'A' : 'B';
    for (const row of rows.slice(1)) {
      assert.equal(row[9], variant);
      assert.equal(row[10], 'state-presentation-v4-20261011');
      assert.ok(Number(row[5]) >= 0);
      assert.equal(row[0], a.ids['session-code'].textContent);
    }
    assert.ok(csv.includes(',camera_start_requested,'));
    assert.ok(!csv.includes('task_completed'));
  }
});

test('stale preview version cannot display newly versioned draft content', async () => {
  const a = await app({ studyPreview: true, studyVersion: 'bgj-study-v1', search: '' }); a.ready();
  a.scene.entities[0].emit('targetFound');
  assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
  assert.ok(!(await a.csv()).includes(',research_preview_display,'));
});

test('camera failure hides research content, sources and presentation state', async () => {
  const a = await app({ studyPreview: true, search: '' }); a.ready();
  a.scene.entities[0].emit('targetFound');
  a.scene.emit('arError');
  assert.equal(a.ids.sources.hidden, true);
  assert.equal(a.ids['review-status'].textContent, '当前未显示人物介绍');
  assert.equal(a.scene.entities[0].semanticContent.attributes.visible, false);
  assert.equal(a.stops, 1);
});

function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.replace(/^\uFEFF/, '').length; i++) {
    const input = text.replace(/^\uFEFF/, '');
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const columns = rows.shift();
  return rows.map(values => Object.fromEntries(columns.map((column, i) => [column, values[i]])));
}

test('A/B have identical visible event text, gate outcomes, sources and recovery within each entry', async () => {
  for (const studyPreview of [false, true]) {
    const a = await app({ studyPreview, search: '?ui=A' }); a.ready();
    const b = await app({ studyPreview, search: '?ui=B' }); b.ready();
    assert.equal(a.document.body.attributes['data-ui'], 'A');
    assert.equal(b.document.body.attributes['data-ui'], 'B');
    for (let index = 0; index < 3; index++) {
      for (const event of ['targetFound', 'targetLost', 'targetFound']) {
        a.scene.entities[index].emit(event); b.scene.entities[index].emit(event);
        for (const id of ['status', 'help', 'review-status', 'content']) {
          assert.equal(a.ids[id].textContent, b.ids[id].textContent, `${studyPreview}/${event}/${id}`);
        }
        assert.equal(a.scene.entities[index].semanticContent.attributes.visible, b.scene.entities[index].semanticContent.attributes.visible);
        assert.equal(a.ids.sources.hidden, b.ids.sources.hidden);
      }
    }
    const gateEvents = rows => rows.filter(r => /^(semantic_gate_|research_preview_display)/.test(r.event)).map(r => [r.event, r.target_id, r.reason]);
    assert.deepEqual(gateEvents(parseCSV(await a.csv())), gateEvents(parseCSV(await b.csv())));
  }
});

test('anonymous study labels join distinct page sessions without acting as preview permission', async () => {
  const shared = 'study_id=P01&study_run=RUN_20261011';
  const a = await app({ search: `?ui=A&${shared}` }); a.ready(); a.scene.entities[0].emit('targetFound');
  const b = await app({ search: `?ui=B&${shared}`, studyPreview: true }); b.ready(); b.scene.entities[0].emit('targetFound');
  const rowsA = parseCSV(await a.csv()); const rowsB = parseCSV(await b.csv());
  assert.notEqual(rowsA[0].session_id, rowsB[0].session_id);
  for (const row of [...rowsA, ...rowsB]) {
    assert.equal(row.study_id, 'P01'); assert.equal(row.study_run, 'RUN_20261011');
    assert.equal(row.user_id, row.session_id, 'legacy user_id is a session alias, not a persistent participant ID');
    assert.equal(row.schema_version, 'webar-observation-1');
  }
  assert.ok(!rowsA.some(r => r.event === 'research_preview_display'));
  assert.ok(rowsA.some(r => r.event === 'semantic_gate_block'));
  const displayed = rowsB.find(r => r.event === 'research_preview_display');
  assert.equal(displayed.metadata_version, 'bgj-study-v2');
  assert.equal(displayed.entry, 'study.html');
  assert.equal(displayed.metadata_source, './assets/data/study-scene.json');
  const pilot = await app({ search: '?study_id=PILOT01&study_run=PILOT_20261011' });
  assert.ok(parseCSV(await pilot.csv()).every(r => r.study_id === 'PILOT01'));
  assert.ok(pilot.ids['version-code'].textContent.includes('state-presentation-v4-20261011'));
  assert.equal(pilot.ids['study-label'].textContent, 'PILOT01 / PILOT_20261011');
});

test('invalid study labels and UI values are discarded without retaining raw query data', async () => {
  const a = await app({ search: '?ui=unexpected&study_id=Alice%40example.com&study_run=%3D1%2B1&observer=true' });
  const csv = await a.csv(); const rows = parseCSV(csv);
  for (const row of rows) { assert.equal(row.study_id, ''); assert.equal(row.study_run, ''); assert.equal(row.ui_variant, 'B'); }
  for (const reason of ['ui', 'study_id', 'study_run', 'observer']) assert.ok(rows.some(r => r.event === 'parameter_ignored' && r.reason === reason));
  assert.ok(!csv.includes('Alice')); assert.ok(!csv.includes('example.com')); assert.ok(!csv.includes('=1+1'));
  assert.equal(a.ids['observer-panel'].hidden, true);
});

test('observer markers are opt-in, bounded manual times and never success assertions', async () => {
  const regular = await app();
  regular.ids['observer-task'].value = 'T01'; regular.ids['observer-start'].click();
  assert.ok(!parseCSV(await regular.csv()).some(r => r.event.startsWith('observer_')));
  const a = await app({ studyPreview: true, search: '?observer=1&ui=A' }); a.ready();
  assert.equal(a.ids['observer-panel'].hidden, false);
  assert.equal(a.ids['debug-overlay'].hidden, true);
  a.ids['observer-task'].value = 'T99'; a.ids['observer-start'].click();
  a.ids['observer-task'].value = 'T01'; a.ids['observer-start'].click(); a.ids['observer-start'].click();
  a.scene.entities[0].emit('targetFound'); a.ids['observer-help'].click(); a.ids['observer-end'].click();
  const rows = parseCSV(await a.csv());
  const manual = rows.filter(r => r.event.startsWith('observer_'));
  assert.deepEqual(manual.map(r => r.event), ['observer_task_start', 'observer_help_given', 'observer_task_end']);
  for (const row of manual) { assert.equal(row.manual_marker, 'true'); assert.equal(row.observer_task, 'T01'); }
  const found = rows.find(r => r.event === 'target_found');
  assert.equal(found.observer_task, 'T01'); assert.equal(found.manual_marker, 'false');
  assert.ok(!rows.some(r => /completed|correct|understood|success/.test(r.event)));
});

test('visibility and startup errors export actual local events with escaped diagnostic text', async () => {
  const a = await app(); a.ready();
  a.document.hidden = true; a.document.emit('visibilitychange');
  a.document.hidden = false; a.document.emit('visibilitychange');
  const rows = parseCSV(await a.csv()).filter(r => r.event === 'page_visibility_changed');
  assert.deepEqual(rows.map(r => r.visibility), ['hidden', 'visible']);
  const b = await app({ initError: 'test,"engine"\nerror' }); b.start();
  await b.scene.systems['mindar-image-system']._startAR();
  const error = parseCSV(await b.csv()).find(r => r.event === 'ar_error');
  assert.ok(error.detail.includes('test,"engine"\nerror'));
  assert.equal(error.phase, 'failed');
});

test('shared study notice and task guide remain present and neither HTML contains recognition progress', () => {
  const studyHTML = fs.readFileSync(path.join(root, 'study.html'), 'utf8');
  for (const text of [html, studyHTML]) {
    assert.ok(text.includes('id="state-panel"'));
    assert.ok(text.includes('id="observer-panel" hidden'));
    assert.ok(!text.includes('id="scan-progress"'));
    assert.ok(text.includes('不同页面分别保存'));
  }
  assert.ok(studyHTML.includes('当前人物介绍是开发组草稿，待闽剧专家审核与校订'));
});


test('entry switch links preserve validated assignment labels and observer mode in both directions', async () => {
  for (const studyPreview of [false, true]) {
    const a = await app({ studyPreview, search: '?ui=A&study_id=PILOT01&study_run=PILOT_20261011&observer=1' });
    const destination = new URL(a.ids['entry-link'].href);
    assert.equal(destination.pathname, studyPreview ? '/web-ar-/index.html' : '/web-ar-/study.html');
    assert.equal(destination.searchParams.get('ui'), 'A');
    assert.equal(destination.searchParams.get('study_id'), 'PILOT01');
    assert.equal(destination.searchParams.get('study_run'), 'PILOT_20261011');
    assert.equal(destination.searchParams.get('observer'), '1');
    a.ids['entry-link'].click();
    const switchEvent = parseCSV(await a.csv()).find(r => r.event === 'entry_switch_requested');
    assert.equal(switchEvent.reason, 'export_each_page_before_navigation');
  }
  const invalid = await app({ search: '?ui=bad&study_id=Alice&study_run=raw_private&observer=0' });
  const destination = new URL(invalid.ids['entry-link'].href);
  assert.equal(destination.search, '?ui=B');
});
