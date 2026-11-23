import { voices, playRole, stopRole } from './audio.js';

const one = (id) => document.getElementById(id);
const scan = one('scan');
const camera = one('start-scan');
const status = one('scan-state');
const scanHelp = one('scan-help');
const scanCast = one('scan-cast');
const recovery = one('scan-recovery');
const toGallery = one('use-gallery');
const galleryCaption = one('role-subtitle');
const scanCaption = one('scan-subtitle');
const listen = one('listen');
let role = 'bian';
let controller = null;
let session = null;
let playing = false;

function setRole(id) {
  if (!Object.hasOwn(voices, id)) return;
  role = id;
  one('role-name').textContent = voices[id].name;
  one('role-note').textContent = voices[id].note;
  for (const button of document.querySelectorAll('[data-role]')) {
    const chosen = button.dataset.role === id;
    button.classList.toggle('active', chosen);
    button.setAttribute('aria-pressed', String(chosen));
  }
  galleryCaption.textContent = '';
}

function listening(value) {
  playing = value;
  listen.textContent = value ? '停止导赏' : '听普通话导赏';
  listen.setAttribute('aria-pressed', String(value));
}

function readRole(id, caption) {
  caption.textContent = voices[id].line;
  listening(true);
  void playRole(id, {
    onCue(text) { caption.textContent = text; },
    onEnd() { listening(false); },
    onError() { caption.textContent = voices[id].note; listening(false); }
  });
}

function setScanState(next) {
  scan.dataset.status = next;
  status.textContent = {
    starting: '准备识别 · 请允许使用相机',
    searching: '请将冰箱贴正面完整放入取景框',
    tracking: '识别成功 · 戏中人已登台',
    lost: '把冰箱贴移回取景框，戏台会再次出现',
    error: '相机暂时无法开启'
  }[next] || '';
  scanCast.hidden = next !== 'tracking';
  scanHelp.hidden = next !== 'searching' && next !== 'error';
  if (next === 'searching') scanHelp.textContent = '镜头保持稳定，稍微转动冰箱贴避开反光。';
}

function closeScan() {
  controller?.abort();
  controller = null;
  session?.stop();
  session = null;
  stopRole();
  listening(false);
  if (scan.open) scan.close();
}

function scanError(error) {
  if (!scan.open || controller?.signal.aborted || error?.name === 'AbortError') return;
  controller?.abort();
  session?.stop();
  session = null;
  setScanState('error');
  status.textContent = {
    NotAllowedError: '手机未授权相机。你可以在浏览器允许后重试。',
    NotFoundError: '没有找到可用的相机。',
    NotReadableError: '相机可能被其他应用占用。'
  }[error?.name] || (window.isSecureContext ? '相机或图像识别加载失败。' : '手机相机需要通过 HTTPS 入口开启。');
  scanHelp.textContent = /MicroMessenger/i.test(navigator.userAgent)
    ? '可以点微信右上角「···」，选择用浏览器打开后再试。'
    : '请检查浏览器的相机权限，再试一次。';
  recovery.hidden = false;
}

async function startScan() {
  if (!scan.open) scan.showModal();
  stopRole();
  listening(false);
  scanCaption.textContent = '';
  for (const choice of scanCast.querySelectorAll('button')) choice.setAttribute('aria-pressed', String(choice.dataset.index === ''));
  recovery.hidden = true;
  setScanState('starting');
  const request = new AbortController();
  controller = request;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    scanError(new Error('Camera unavailable'));
    return;
  }
  try {
    const { startAR } = await import('./ar.js');
    if (request.signal.aborted) return;
    const next = await startAR({
      container: one('ar-camera'),
      onState: (stage) => { if (!request.signal.aborted) setScanState(stage); },
      onError: scanError, signal: request.signal
    });
    if (request.signal.aborted) next.stop();
    else session = next;
  } catch (error) { if (!request.signal.aborted) scanError(error); }
}
camera.addEventListener('click', startScan);
one('retry-scan').addEventListener('click', startScan);
one('leave').addEventListener('click', closeScan);
scan.addEventListener('cancel', (event) => { event.preventDefault(); closeScan(); });
toGallery.addEventListener('click', () => { closeScan(); one('cast').scrollIntoView(); });
window.addEventListener('pagehide', closeScan);

scanCast.addEventListener('click', (event) => {
  const button = event.target.closest('[data-index]');
  if (!button) return;
  for (const choice of scanCast.querySelectorAll('button')) choice.setAttribute('aria-pressed', String(choice === button));
  session?.select(button.dataset.index === '' ? null : Number(button.dataset.index));
  if (button.dataset.speaker) readRole(button.dataset.speaker, scanCaption);
  else { stopRole(); listening(false); scanCaption.textContent = ''; }
});
for (const button of document.querySelectorAll('[data-role]')) {
  button.addEventListener('click', () => {
    stopRole(); listening(false); setRole(button.dataset.role);
  });
}
listen.addEventListener('click', () => {
  if (playing) { stopRole(); listening(false); }
  else readRole(role, galleryCaption);
});
one('camera-hint').textContent = window.isSecureContext ?
  '识别成功后，三位角色会出现在冰箱贴上。' : '这台设备需要通过 HTTPS 网页打开相机。';
setRole(role);

