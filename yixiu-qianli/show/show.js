import { playRole, stopRole } from '../audio.js';

const select = (id) => document.getElementById(id);
const stage = select('stage');
const headline = select('headline');
const eyebrow = select('eyebrow');
const tagline = select('tagline');
const instruction = select('instruction');
const next = select('next');
const camera = select('camera');
const reset = select('reset');
const mode = select('mode');
const sound = select('sound');
const fullscreen = select('fullscreen');
const status = select('status');
const cameraBox = select('camera-box');
const cameraLabel = select('camera-label');
const visitor = select('visitor');
const save = select('save');
const panel = select('challenge');
const feedback = select('feedback');
const retry = select('retry');
const choices = select('choices');
const left = select('choose-left');
const right = select('choose-right');
const result = select('result');
const chapters = [...document.querySelectorAll('.chapter')];

const scenes = [
  {
    title: '破浪', suffix: '渡江', role: 'bian', name: '边一笑', look: 'river',
    line: '听拍渡过急流',
    prompt: '看准水袖进入亮区再击拍，连续通过三个渡口。',
    color: '243,122,95',
  },
  {
    title: '翻越', suffix: '雪山', role: 'cui', name: '崔云龙', look: 'snow',
    line: '记住雪山锣谱',
    prompt: '先看一遍左右锣谱，待提示后，原样复奏。',
    color: '158,221,249',
  },
  {
    title: '同行', suffix: '草地', role: 'zhang', name: '张岫玉', look: 'grass',
    line: '陪同伴走过草地',
    prompt: '留意路标和队伍的状况，每段选择一条更稳妥的路。',
    color: '248,204,99',
  },
];

const motionReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchFirst = matchMedia('(pointer: coarse), (max-width: 600px)');
const field = select('ribbon');
const pen = field.getContext('2d');
let drawingWidth = 0;
let drawingHeight = 0;
let trail = [];
let sparks = [];
let beat = null;
let frameToken = 0;
let cue = '246,123,99';

let page = -1;
let input = 'idle';
let cameraStop = null;
let cameraStart = null;
let gestureFeedbackTimer = 0;
let cameraHint = '';
let restartTimer = null;
let transitionLock = 0;
let soundOn = true;
let lastHand = 0;
let motionMode = false;
let tuned = false;
let audioContext = null;
let music = null;
const scoreBuffers = new Map();
let roleDucking = false;
let rolePlaybackId = 0;
let challenge = null;
let challengeTimer = 0;
let riverFrame = 0;
let scores = [0, 0, 0];
let finalScore = null;
let bestScore = 0;
try { bestScore = Number(localStorage.getItem('yi-xiu-route-best-v2')) || 0; } catch {}

function title(lead, detail) {
  headline.replaceChildren(document.createTextNode(lead));
  const span = document.createElement('span');
  span.textContent = detail;
  headline.append(span);
}

function stageStatus(message = '') {
  if (status.textContent !== message) status.textContent = message;
}

function paintPage() {
  const chapter = scenes[page];
  reset.hidden = page === -1 && input === 'idle';
  stage.dataset.phase = page === -1 ? 'intro' : chapter ? 'play' : 'outro';
  stage.dataset.look = page === -1 ? 'red' : chapter ? chapter.look : 'gold';
  if (chapter) stage.dataset.role = chapter.role;
  else delete stage.dataset.role;
  cue = chapter ? chapter.color : '245,155,101';

  for (const [index, marker] of chapters.entries()) {
    marker.classList.toggle('is-current', index === page);
    marker.classList.toggle('is-lit', index < page);
    if (index === page) marker.setAttribute('aria-current', 'step');
    else marker.removeAttribute('aria-current');
  }

  save.hidden = page < scenes.length;
  result.hidden = page !== scenes.length;
  panel.hidden = !chapter;
  retry.hidden = !chapter;
  camera.hidden = page !== -1 || input === 'keyboard';
  camera.disabled = input === 'loading' || input === 'camera';
  if (page === -1) {
    eyebrow.textContent = '《贬官记》人物互动展';
    title('一袖', '千里');
    tagline.replaceChildren('手一抬，戏开场。', document.createElement('br'), '挥一袖，走一程。');
    instruction.textContent = input === 'camera'
      ? motionMode ? '在镜头里向左或向右挥一下，掀开戏幕。' : '举掌停一下，或左右挥一下，掀开戏幕。'
      : '击拍渡江、记谱翻雪山、读线索走草地。三幕都可重练。';
    camera.textContent = input === 'loading' ? '正在开启' : input === 'camera' ? '手势已开启' : '开启手势';
    next.textContent = touchFirst.matches ? '点击开场' : '键鼠体验';
  } else if (chapter) {
    eyebrow.textContent = '《贬官记》 · ' + chapter.name;
    title(chapter.title, chapter.suffix);
    tagline.textContent = chapter.line;
    instruction.textContent = chapter.prompt;
  } else {
    eyebrow.textContent = '三幕已点亮';
    title('路已', '点亮');
    tagline.textContent = '三幕已合，且留一票。';
    instruction.textContent = '把成绩和长征戏台收进你的纪念戏票。';
    next.textContent = '再走一程';
  }
  mode.textContent = input === 'camera'
    ? motionMode ? '移动感应' : '手势模式'
    : input === 'loading' ? '正在连接摄像头' : input === 'keyboard'
      ? touchFirst.matches ? '触屏模式' : '键鼠模式' : '等待开场';
  if (input === 'camera' && cameraBox.classList.contains('is-ready')) {
    setCameraHint(page === -1 && !motionMode ? '举掌或挥手' : '左右挥手');
  }
  if (chapter) renderChallenge();
}

const riverGates = [
  { center: .29, radius: .15, period: 2600 },
  { center: .62, radius: .14, period: 2300 },
  { center: .49, radius: .13, period: 2100 },
];
const directions = { left: '左', right: '右' };
const grassLegs = [
  { clue: '坡脚湿滑积水，右边土脊上还能看见同行者留下的脚印。', choices: ['穿过积水', '沿有脚印的土脊'], answer: 1,
    pass: '沿土脊循迹，队伍没有走散。', miss: '涉水打湿了包裹，消耗一份补给。' },
  { clue: '前方起雾，一位同伴脚步慢了下来，左侧有处背风的高地。', choices: ['到高地等齐队伍', '各自穿雾赶路'], answer: 0,
    pass: '背风处等齐人，再一起出发。', miss: '分开赶路让队伍折返，消耗一份补给。' },
  { clue: '风雨将近，左边近路没有路标，右边远些，但能沿旧路标到集合点。', choices: ['抄近路', '依路标绕行'], answer: 1,
    pass: '按路标抵达集合点，队伍平安走出了草地。', miss: '近路找不到方向，绕回原地时消耗一份补给。' },
];

function shuffleGrassChoices() {
  return grassLegs.map(leg => Math.random() < .5 ? leg : {
    ...leg,
    clue: leg.clue.replace(/[左右]/g, word => word === '左' ? '右' : '左'),
    choices: [leg.choices[1], leg.choices[0]],
    answer: 1 - leg.answer,
  });
}

function stopChallengeMotion() {
  clearTimeout(challengeTimer);
  cancelAnimationFrame(riverFrame);
}

function later(run, ms) {
  const current = challenge;
  challengeTimer = setTimeout(() => {
    if (challenge === current) run();
  }, ms);
}

function gameFeedback(message, tone = '') {
  if (!challenge) return;
  challenge.message = message;
  challenge.tone = tone;
  feedback.textContent = message;
  feedback.dataset.tone = tone;
}

function totalScore() {
  return scores.reduce((total, n) => total + n, 0);
}

function aimBounds() {
  const gate = riverGates[challenge.round];
  const extra = Math.min(challenge.attempt * .035, .07);
  return [gate.center - gate.radius - extra, gate.center + gate.radius + extra];
}

function riverPosition(now) {
  const phase = ((now - challenge.started) % riverGates[challenge.round].period) / riverGates[challenge.round].period;
  return 1 - Math.abs(2 * phase - 1);
}

function showRiver(now) {
  if (challenge?.state !== 'river') return;
  const position = riverPosition(now);
  const [min, max] = aimBounds();
  const cueNode = select('river-cue');
  const inWindow = position >= min && position <= max;
  select('river-cursor').style.left = position * 100 + '%';
  if (cueNode.dataset.hot !== String(inWindow)) {
    cueNode.dataset.hot = String(inWindow);
    cueNode.textContent = inWindow ? '现在击拍' : '等候亮区';
  }
  riverFrame = requestAnimationFrame(showRiver);
}

function startRiverRound() {
  challenge.state = 'river';
  challenge.started = performance.now();
  renderChallenge();
  riverFrame = requestAnimationFrame(showRiver);
}

function makePatterns() {
  return [3, 4, 5].map(length => {
    const first = Math.random() < .5 ? 'left' : 'right';
    const notes = [first, first === 'left' ? 'right' : 'left'];
    while (notes.length < length) {
      notes.push(Math.random() < .5 ? 'left' : 'right');
    }
    return notes;
  });
}

function showSnowPattern() {
  challenge.state = 'demo';
  challenge.heard = 0;
  challenge.flash = -1;
  const sequence = challenge.patterns[challenge.round];
  const display = index => {
    if (index >= sequence.length) {
      challenge.state = 'answer';
      challenge.flash = -1;
      gameFeedback('轮到你了。', 'gold');
      renderChallenge();
      return;
    }
    challenge.flash = index;
    renderChallenge();
    gong(sequence[index] === 'left' ? .68 : 1.28);
    later(() => {
      challenge.flash = -1;
      renderChallenge();
      later(() => display(index + 1), 155);
    }, 465);
  };
  gameFeedback('看清方向，等锣谱播完。');
  renderChallenge();
  later(() => display(0), 330);
}

function beginChallenge() {
  stopChallengeMotion();
  scores[page] = 0;
  challenge = {
    scene: page, state: 'start', round: 0, attempt: 0, patterns: page === 1 ? makePatterns() : [],
    heard: 0, flash: -1, stock: 3, selection: null, message: '', tone: '',
    legs: page === 2 ? shuffleGrassChoices() : [],
  };
  if (page === 0) startRiverRound();
  else if (page === 1) {
    gameFeedback('先听一遍，再复奏。', 'gold');
    renderChallenge();
  } else {
    challenge.state = 'route';
    gameFeedback('可点按路标、挥手选路，或用方向键加空格。');
    renderChallenge();
  }
}

function renderChallenge() {
  if (challenge?.scene !== page) return;
  syncMusic();
  const {scene, state, round, selection, stock} = challenge;
  const completed = state === 'complete';
  const progress = completed ? 3 : Math.min(round + 1, 3);
  select('challenge-name').textContent = ['守住渡江节拍', '记忆与复奏', '读线索选路'][scene];
  select('challenge-count').textContent = completed ? '本幕通过' : '第 ' + progress + ' / 3 段';
  select('challenge-score').textContent = totalScore() + ' 分';
  select('river-board').hidden = scene !== 0 || completed;
  select('snow-board').hidden = scene !== 1 || completed;
  select('grass-board').hidden = scene !== 2 || completed;
  choices.hidden = completed || (scene !== 2 && (scene !== 1 || state === 'start'));
  feedback.textContent = challenge.message;
  feedback.dataset.tone = challenge.tone;
  left.disabled = right.disabled = state !== 'answer' && state !== 'route';
  left.classList.toggle('is-selected', scene === 2 && selection === 0);
  right.classList.toggle('is-selected', scene === 2 && selection === 1);
  left.setAttribute('aria-pressed', String(scene === 2 && selection === 0));
  right.setAttribute('aria-pressed', String(scene === 2 && selection === 1));
  next.hidden = false;
  next.disabled = false;
  if (completed) {
    next.textContent = page === 2 ? '查看成就' : '进入下一幕';
    return;
  }
  if (scene === 0) {
    if (state === 'river') {
      const [min, max] = aimBounds();
      select('river-window').style.left = 100 * min + '%';
      select('river-window').style.width = 100 * (max - min) + '%';
    }
    next.disabled = state !== 'river';
    next.textContent = '击拍';
  } else if (scene === 1) {
    const notes = challenge.patterns[round];
    const display = select('drum-beats');
    const boxes = notes.map((note, i) => {
      const box = document.createElement('span');
      if ((state === 'demo' && challenge.flash === i) || (state !== 'demo' && challenge.heard > i)) {
        box.className = challenge.heard > i && state !== 'demo' ? 'is-played' : 'is-flash';
        box.textContent = note === 'left' ? '←' : '→';
      } else box.textContent = '·';
      return box;
    });
    display.replaceChildren(...boxes);
    select('drum-caption').textContent = state === 'start' ? notes.length + ' 个方向'
      : state === 'demo' ? '先观察方向' : '复奏进度 ' + challenge.heard + ' / ' + notes.length;
    left.textContent = '左锣 ←';
    right.textContent = '右锣 →';
    next.textContent = state === 'start' ? '播放锣谱' : '再听一遍';
    next.disabled = state === 'demo' || state === 'pause';
  } else {
    const leg = challenge.legs[round];
    select('grass-clue').textContent = leg.clue;
    select('grass-stock').textContent = '补给 ' + '◆'.repeat(stock) + '◇'.repeat(3 - stock);
    left.textContent = '← ' + leg.choices[0];
    right.textContent = leg.choices[1] + ' →';
    next.textContent = '确认路线';
    next.disabled = state !== 'route' || selection === null;
  }
}

function checkRound(message, points, direction = 'right', tone = 'gold') {
  stopChallengeMotion();
  scores[page] += points;
  const last = challenge.round === 2;
  gameFeedback(message + ' +' + points + ' 分', tone);
  burst(direction);
  if (tone === 'gold') gong(1.22);
  if (last) {
    challenge.state = 'complete';
    renderChallenge();
    return;
  }
  challenge.state = 'pause';
  renderChallenge();
  later(() => {
    challenge.round += 1;
    challenge.attempt = 0;
    challenge.selection = null;
    challenge.heard = 0;
    if (page === 0) startRiverRound();
    else if (page === 1) {
      challenge.state = 'start';
      renderChallenge();
    } else {
      challenge.state = 'route';
      renderChallenge();
    }
  }, 720);
}

function makeAction(action, source, direction = '') {
  if (challenge?.scene !== page || performance.now() < transitionLock) return;
  if (action === 'left' || action === 'right') direction = action;
  const {state, round} = challenge;
  if (state === 'complete') {
    advance(source, direction);
    return;
  }
  if (state === 'river') {
    const position = riverPosition(performance.now());
    const [min, max] = aimBounds();
    if (position >= min && position <= max) {
      const points = Math.max(50, 100 - challenge.attempt * 15);
      checkRound('渡口已点亮。', points, direction);
    } else {
      challenge.attempt += 1;
      gameFeedback('水袖还没落在亮区，再试一次。', 'miss');
      renderChallenge();
    }
  } else if (page === 1) {
    if (state === 'start' || (state === 'answer' && action === 'confirm' && source !== 'gesture')) {
      if (state === 'answer') challenge.attempt += 1;
      showSnowPattern();
    } else if (state === 'answer' && direction in directions) {
      const sequence = challenge.patterns[round];
      if (direction !== sequence[challenge.heard]) {
        challenge.attempt += 1;
        challenge.state = 'pause';
        gameFeedback('这一拍方向反了。再看一遍。', 'miss');
        renderChallenge();
        later(showSnowPattern, 720);
      } else {
        challenge.heard += 1;
        if (challenge.heard >= sequence.length) {
          checkRound('锣谱完整，雪线向前。', Math.max(50, 100 - challenge.attempt * 15), direction);
        } else {
          gameFeedback('这一拍对了，接下一拍。', 'gold');
          gong(direction === 'left' ? .7 : 1.22);
          renderChallenge();
        }
      }
    }
  } else if (state === 'route') {
    if (direction) challenge.selection = direction === 'left' ? 0 : 1;
    if (action !== 'confirm' && source === 'key') {
      renderChallenge();
      return;
    }
    if (challenge.selection === null) return;
    const leg = challenge.legs[round];
    if (challenge.selection === leg.answer) {
      checkRound(leg.pass, challenge.stock === 0 ? 60 : 100, direction);
    } else {
      challenge.stock = Math.max(0, challenge.stock - 1);
      if (challenge.stock === 0) {
        gameFeedback('补给已经用完，队伍折返本段起点。重新观察路标。', 'miss');
        challenge.selection = null;
        renderChallenge();
      } else {
        checkRound(leg.miss, 35, direction, 'miss');
      }
    }
  }
}

function showResult() {
  const score = totalScore();
  const title = score >= 830 ? '三星 · 水袖领路' : score >= 690 ? '二星 · 同行探路' : '一星 · 初登戏台';
  bestScore = Math.max(bestScore, score);
  try { localStorage.setItem('yi-xiu-route-best-v2', String(bestScore)); } catch {}
  finalScore = { score, title };
  select('result-rank').textContent = title;
  select('result-score').textContent = score + ' / 900 分';
  select('result-best').textContent = '本机最高 ' + bestScore + ' 分';
  select('result-breakdown').textContent = scores.map((value, i) => ['急流', '雪山', '草地'][i] + ' ' + value).join('　');
}

function unlockSound() {
  if (!audioContext) {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (Context) {
      try { audioContext = new Context(); } catch { return; }
    }
  }
  if (audioContext?.state === 'running') syncMusic();
  else audioContext?.resume().then(syncMusic).catch(() => {});
}

const stageScores = [
  { bpm: 96, root: 50, notes: [0, 7, 9, 7, 3, 5, 3, 0], drum: .83 },
  { bpm: 92, root: 45, notes: [0, 3, 5, 7, 5, 3, 7, 10], drum: 1 },
  { bpm: 76, root: 50, notes: [7, 12, 15, 14, 12, 7, 5, 3], drum: .48 },
  { bpm: 88, root: 48, notes: [0, 4, 7, 9, 7, 4, 2, 7], drum: .69 },
  { bpm: 82, root: 48, notes: [0, 4, 7, 12, 9, 7, 4, 0], drum: .53 },
];

function makeScoreBuffer({ bpm, root, notes, drum }) {
  const rate = 22050;
  const beat = 60 / bpm;
  const buffer = audioContext.createBuffer(1, Math.round(rate * beat * 16), rate);
  const track = buffer.getChannelData(0);
  const tau = 2 * Math.PI;
  const hz = note => 440 * 2 ** ((note - 69) / 12);

  function add(at, duration, envelope, voice) {
    const start = Math.round(at * beat * rate);
    for (let i = 0; i < Math.round(duration * rate); i++) {
      const t = i / rate;
      track[(start + i) % track.length] += envelope(t) * voice(t);
    }
  }

  for (let i = 0; i < 16; i++) {
    const drumLevel = i % 4 === 0 ? .34 : i % 2 === 0 ? .2 : .09;
    add(i, .26, t => drum * drumLevel * Math.exp(-t * 24) * Math.min(t / .004, 1),
      t => Math.sin(tau * (94 * t + 1.45 * (1 - Math.exp(-t * 29)))) + .24 * Math.sin(tau * 212 * t));
    if (i % 4 !== 2) {
      add(i + .55, .07, t => .095 * drum * Math.exp(-t * 85) * Math.min(t / .002, 1),
        t => Math.sin(tau * 694 * t) + .4 * Math.sin(tau * 1323 * t));
    }
    if (i % 2 === 0) {
      const frequency = hz(root + 12 + notes[i / 2]);
      add(i + .18, 1.1, t => .28 * Math.exp(-t * 5.1) * Math.min(t / .009, 1),
        t => Math.sin(tau * frequency * t) + .32 * Math.sin(tau * frequency * 2.003 * t) * Math.exp(-t * 8));
    }
    if (i % 4 === 0) {
      const frequency = hz(root + (i === 8 ? 7 : 0));
      const length = beat * 3.7;
      add(i, length, t => .155 * Math.sin(Math.PI * t / length) ** 2,
        t => Math.sin(tau * frequency * t) + .27 * Math.sin(tau * frequency * 2.005 * t));
    }
  }
  return buffer;
}

function syncMusic() {
  if (audioContext?.state !== 'running') return;
  const now = audioContext.currentTime;
  const active = soundOn && !document.hidden;
  if (!active) {
    music?.gain.gain.setTargetAtTime(0, now, .04);
    return;
  }
  const index = page + 1;
  if (music?.index !== index) {
    if (music) {
      music.gain.gain.setTargetAtTime(0, now, .16);
      music.source.stop(now + .85);
    }
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    if (!scoreBuffers.has(index)) scoreBuffers.set(index, makeScoreBuffer(stageScores[index]));
    source.buffer = scoreBuffers.get(index);
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain).connect(audioContext.destination);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    source.start(now);
    music = { index, source, gain };
  }
  const listening = challenge?.scene === 1 && challenge.state === 'demo';
  music.gain.gain.setTargetAtTime(listening ? .028 : roleDucking ? .12 : .40, now, .12);
}

function gong(pitch = 1) {
  if (!soundOn || !audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  [113, 187.5, 284, 409.7, 527].forEach((frequency, index) => {
    const osc = audioContext.createOscillator();
    const amp = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency * pitch, now);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime((index === 0 ? .16 : .055) / (index + 1), now + .014);
    amp.gain.exponentialRampToValueAtTime(.0001, now + .55 + index * .09);
    osc.connect(amp).connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + 1.08);
  });
}

function stopStageVoice() {
  rolePlaybackId += 1;
  roleDucking = false;
  stopRole();
}

function playCurrentRole() {
  if (!soundOn || !scenes[page]) return;
  const id = ++rolePlaybackId;
  const restore = () => {
    if (id !== rolePlaybackId) return;
    roleDucking = false;
    syncMusic();
  };
  roleDucking = true;
  syncMusic();
  playRole(scenes[page].role, { onEnd: restore, onError: restore }).then(played => {
    if (!played) restore();
  }, restore);
}

function setCameraHint(message) {
  cameraHint = message;
  if (!gestureFeedbackTimer) cameraLabel.textContent = message;
}

function flashGesture(direction) {
  clearTimeout(gestureFeedbackTimer);
  cameraBox.dataset.swipe = direction;
  cameraLabel.textContent = direction === 'left' ? '← 左挥已识别' : '右挥已识别 →';
  burst(direction);
  gestureFeedbackTimer = setTimeout(() => {
    gestureFeedbackTimer = 0;
    delete cameraBox.dataset.swipe;
    cameraLabel.textContent = cameraHint;
  }, 620);
}

function clearCamera() {
  cameraStart?.abort();
  cameraStart = null;
  cameraStop?.();
  cameraStop = null;
  cameraBox.hidden = true;
  cameraBox.classList.remove('is-ready');
  clearTimeout(gestureFeedbackTimer);
  gestureFeedbackTimer = 0;
  delete cameraBox.dataset.swipe;
  motionMode = false;
}

function startOver() {
  clearTimeout(restartTimer);
  restartTimer = null;
  stopChallengeMotion();
  challenge = null;
  next.disabled = false;
  scores = [0, 0, 0];
  finalScore = null;
  stopStageVoice();
  clearCamera();
  input = 'idle';
  page = -1;
  trail = [];
  sparks = [];
  beat = null;
  transitionLock = 0;
  stageStatus();
  paintPage();
  syncMusic();
  requestDrawing();
}

function advance(from, direction = 'right') {
  if (performance.now() < transitionLock) return;
  if (page === scenes.length) {
    if (from !== 'gesture') startOver();
    return;
  }
  if (from === 'key' && input !== 'keyboard') {
    if (input === 'loading') clearCamera();
    if (input !== 'camera') input = 'keyboard';
  }
  transitionLock = performance.now() + 300;
  stageStatus();
  stopStageVoice();
  const opening = page < 0;
  page += 1;
  if (!opening) stopChallengeMotion();
  if (page < scenes.length) beginChallenge();
  if (opening && !motionReduced) {
    stage.classList.remove('is-opening');
    void stage.offsetWidth;
    stage.classList.add('is-opening');
    setTimeout(() => stage.classList.remove('is-opening'), 900);
  }
  paintPage();
  syncMusic();
  burst(direction);
  gong(opening ? .87 : page === scenes.length ? 1.4 : 1 + page * .08);
  if (page === scenes.length) {
    clearCamera();
    showResult();
    mode.textContent = '全程点亮';
    restartTimer = setTimeout(startOver, 80000);
  } else {
    playCurrentRole();
  }
}

const cameraMessages = {
  'loading-model': '正在载入手势识别。',
  'requesting-camera': '请允许浏览器使用摄像头。',
  'ready': '一臂远，让手入镜。向左或向右短挥即可。',
  'motion-fallback': '已切换移动感应。手留在镜头内，向一侧挥动。',
};

async function beginCamera() {
  if (input === 'loading' || input === 'camera') return;
  if (soundOn) unlockSound();
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    stageStatus('当前链接无法开启摄像头。可用键鼠体验，开启手势请从电脑本机或 HTTPS 链接打开。');
    return;
  }
  input = 'loading';
  cameraBox.hidden = false;
  motionMode = false;
  const session = new AbortController();
  cameraStart = session;
  stageStatus(cameraMessages['requesting-camera']);
  paintPage();
  try {
    const { startHands } = await import('./hands.js?v=3');
    if (session.signal.aborted) return;
    const stop = await startHands(visitor, {
      signal: session.signal,
      onGesture(event) {
        if (cameraStart !== session || input !== 'camera') return;
        if (event.type === 'swipe' && event.direction) flashGesture(event.direction);
        if (page === -1 && ['palm', 'motion-start', 'swipe'].includes(event.type)) {
          advance('gesture', event.direction);
        } else if (page >= 0 && event.type === 'swipe' && event.direction) {
          makeAction(event.direction, 'gesture');
        }
      },
      onStatus(state) {
        if (cameraStart !== session) return;
        if (state === 'ready' || state === 'motion-fallback') {
          input = 'camera';
          if (state === 'motion-fallback') motionMode = true;
          cameraBox.classList.add('is-ready');
          paintPage();
        }
        if (state === 'hand-found') setCameraHint(page === -1 && !motionMode ? '手掌已入镜' : '可左右挥动');
        if (state === 'hand-lost') setCameraHint('让手完整入镜');
        if (cameraMessages[state]) stageStatus(cameraMessages[state]);
      },
      onPosition(position) {
        if (cameraStart !== session || !position || motionReduced) return;
        if (performance.now() - lastHand < 25) return;
        lastHand = performance.now();
        addTrail(position.x * drawingWidth, position.y * drawingHeight);
      },
      onError() {
        if (cameraStart !== session) return;
        clearCamera();
        input = page < 0 ? 'idle' : 'keyboard';
        paintPage();
        stageStatus('摄像头连接中断，可以继续用键鼠体验。');
      },
    });
    if (cameraStart !== session) stop();
    else {
      cameraStop = stop;
      if (input === 'loading') {
        input = 'camera';
        paintPage();
      }
    }
  } catch (error) {
    if (cameraStart !== session) return;
    clearCamera();
    input = 'idle';
    paintPage();
    const denied = error?.name === 'NotAllowedError';
    stageStatus(denied ? '未获摄像头权限。可在浏览器里允许摄像头，也可用键鼠体验。' : '未能打开摄像头，可用键鼠体验。');
  }
}

let previousPointerAt = 0;
stage.addEventListener('pointermove', (event) => {
  if (input !== 'camera' && !motionReduced && performance.now() - previousPointerAt >= 30) {
    previousPointerAt = performance.now();
    const bounds = field.getBoundingClientRect();
    addTrail(event.clientX - bounds.left, event.clientY - bounds.top);
  }
});

function requestDrawing() {
  if (pen && !frameToken) frameToken = requestAnimationFrame(draw);
}

function sizeDrawing() {
  if (!pen) return;
  drawingWidth = field.clientWidth;
  drawingHeight = field.clientHeight;
  const ratio = Math.min(devicePixelRatio || 1, 1.8);
  field.width = Math.round(drawingWidth * ratio);
  field.height = Math.round(drawingHeight * ratio);
  pen.setTransform(ratio, 0, 0, ratio, 0, 0);
  requestDrawing();
}

function addTrail(x, y) {
  const last = trail.at(-1);
  if (last && Math.hypot(x - last.x, y - last.y) > Math.max(220, drawingWidth / 4)) trail = [];
  trail.push({ x, y, time: performance.now() });
  if (trail.length > 26) trail.shift();
  requestDrawing();
}

function burst(direction) {
  if (!pen || motionReduced) return;
  const side = direction === 'left' ? -1 : 1;
  beat = { start: performance.now(), side, hue: cue };
  sparks = Array.from({ length: 58 }, () => ({
    x: drawingWidth * (.48 + Math.random() * .44),
    y: drawingHeight * (.26 + Math.random() * .42),
    vx: (Math.random() - .45) * 1.7 * side,
    vy: (Math.random() - .65) * 1.02,
    r: 1 + Math.random() * 2.1,
    fade: .28 + Math.random() * .5,
  }));
  requestDrawing();
}

function draw(now) {
  frameToken = 0;
  pen.clearRect(0, 0, drawingWidth, drawingHeight);
  trail = trail.filter(({ time }) => now - time < 540);
  pen.lineCap = 'round';
  for (let index = 1; index < trail.length; index += 1) {
    const previous = trail[index - 1];
    const point = trail[index];
    const alpha = Math.max(0, 1 - (now - point.time) / 540) * .52;
    const width = 4 + 21 * alpha;
    for (const [weight, opacity, color] of [[2.4,.26,cue], [1,.92,cue], [.19,.99,'255,230,170']]) {
      pen.beginPath();
      pen.moveTo(previous.x, previous.y);
      pen.lineTo(point.x, point.y);
      pen.lineWidth = width * weight;
      pen.strokeStyle = 'rgba(' + color + ',' + (alpha * opacity) + ')';
      pen.stroke();
    }
  }

  if (beat) {
    const progress = (now - beat.start) / 790;
    if (progress >= 1) {
      beat = null;
      sparks = [];
    } else {
      const fade = Math.sin(progress * Math.PI);
      const front = beat.side > 0 ? progress : 1 - progress;
      const width = drawingWidth;
      const height = drawingHeight;
      const x = width * front;
      const y = height * (.57 - .18 * Math.sin(front * Math.PI));
      pen.beginPath();
      pen.moveTo(x - beat.side * width * .6, y + height * .20);
      pen.bezierCurveTo(x - beat.side * width * .38, y - height * .19, x - beat.side * width * .12, y + height * .26, x, y);
      pen.strokeStyle = 'rgba(' + beat.hue + ',' + (fade * .24) + ')';
      pen.lineWidth = 30 + fade * 20;
      pen.stroke();
      pen.strokeStyle = 'rgba(255,224,162,' + (fade * .96) + ')';
      pen.lineWidth = 2.1;
      pen.stroke();

      for (const spark of sparks) {
        const alpha = spark.fade * Math.max(0, 1 - progress);
        pen.beginPath();
        pen.arc(spark.x + spark.vx * progress * 95, spark.y + spark.vy * progress * 95, spark.r, 0, Math.PI * 2);
        pen.fillStyle = 'rgba(255,218,145,' + alpha + ')';
        pen.fill();
      }
    }
  }
  if (trail.length || beat) requestDrawing();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else stageStatus('当前浏览器不支持网页全屏，可用浏览器的全屏功能。');
  } catch {
    stageStatus('网页全屏未开启，可使用浏览器自身的全屏功能。');
  }
}

function ticketCanvas() {
  const card = document.createElement('canvas');
  card.width = 1200;
  card.height = 650;
  const ctx = card.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, card.width, card.height);
  gradient.addColorStop(0, '#120b17');
  gradient.addColorStop(1, '#672a2d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, card.width, card.height);
  ctx.strokeStyle = '#e3ac7b';
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, 1136, 586);
  ctx.strokeRect(44, 44, 1112, 562);
  ctx.beginPath();
  ctx.setLineDash([6, 7]);
  ctx.moveTo(840, 45);
  ctx.lineTo(840, 605);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#e3ac7b';
  ctx.font = '28px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText('闽剧 × 长征  /  纪念戏票', 92, 137);
  ctx.font = 'bold 146px ShowTitle, "Songti SC", "SimSun", serif';
  ctx.fillStyle = '#fff0ca';
  ctx.fillText('一袖千里', 82, 332);
  ctx.font = '38px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText('急流 · 雪山 · 草地', 93, 446);
  ctx.font = '24px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(finalScore ? finalScore.title + '　' + finalScore.score + ' / 900 分' : '你已点亮长路三幕', 94, 520);
  ctx.font = '23px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(scores.map((value, index) => ['急流', '雪山', '草地'][index] + ' ' + value).join('　'), 94, 566);
  ctx.fillStyle = '#eccb9a';
  ctx.font = 'bold 45px ShowTitle, "Songti SC", "SimSun", serif';
  ctx.fillText('《贬官记》', 874, 149);
  const roles = [select('figure-cui'), select('figure-bian'), select('figure-zhang')];
  roles.forEach((image, i) => {
    if (!image.naturalWidth) return;
    const slot = 115;
    const height = slot * image.naturalHeight / image.naturalWidth;
    ctx.drawImage(image, 865 + 75 * i, 540 - Math.min(height, 290), slot, Math.min(height, 290));
  });
  return card;
}

function saveTicket() {
  try {
    const card = ticketCanvas();
    card.toBlob((blob) => {
      if (!blob) {
        stageStatus('暂时无法生成戏票，请重试。');
        return;
      }
      const download = document.createElement('a');
      const url = URL.createObjectURL(blob);
      download.href = url;
      download.download = '一袖千里_纪念戏票.png';
      download.hidden = true;
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      stageStatus('纪念戏票已生成。');
    });
  } catch {
    stageStatus('暂时无法生成戏票，请重试。');
  }
}

select('brand').addEventListener('click', startOver);
camera.addEventListener('click', beginCamera);
next.addEventListener('click', () => {
  if (soundOn) unlockSound();
  if (page < 0 || page === scenes.length) advance('key');
  else makeAction('confirm', 'button');
});
left.addEventListener('click', () => makeAction('left', 'button'));
right.addEventListener('click', () => makeAction('right', 'button'));
retry.addEventListener('click', () => {
  if (!scenes[page]) return;
  beginChallenge();
  gameFeedback('已重新开始本幕。', 'gold');
});
reset.addEventListener('click', startOver);
save.addEventListener('click', saveTicket);
fullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  fullscreen.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
});
sound.addEventListener('click', () => {
  soundOn = !soundOn;
  sound.setAttribute('aria-pressed', String(soundOn));
  sound.textContent = soundOn ? '关闭声音' : '开启声音';
  if (soundOn) {
    unlockSound();
    gong();
    playCurrentRole();
  } else stopStageVoice();
  syncMusic();
});

document.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 'f') {
    event.preventDefault();
    void toggleFullscreen();
  } else if (key === 'r') {
    event.preventDefault();
    startOver();
  } else if ([' ', 'arrowright', 'arrowleft'].includes(key) && !(key === ' ' && event.target.closest('button,a'))) {
    event.preventDefault();
    if (soundOn) unlockSound();
    const action = key === 'arrowleft' ? 'left' : key === 'arrowright' ? 'right' : 'confirm';
    if (page < 0 || page === scenes.length) advance('key', action === 'left' ? 'left' : 'right');
    else makeAction(action, 'key');
  }
});
window.addEventListener('pagehide', () => {
  clearCamera();
  stopStageVoice();
  stopChallengeMotion();
  music?.source.stop();
  music = null;
});
document.addEventListener('visibilitychange', syncMusic);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) startOver();
});

if ('ResizeObserver' in window) new ResizeObserver(sizeDrawing).observe(stage);
else window.addEventListener('resize', sizeDrawing);
sizeDrawing();
paintPage();

