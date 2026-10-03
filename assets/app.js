(() => {
  'use strict';

  // Order verified from grayscale tracking images inside bgji_targets.mind v2.
  // Never infer compiler order from filenames, character IDs or the DOM order.
  const CHARACTERS_BY_TARGET_INDEX = Object.freeze({
    0: { id: 'BGJ_CHAR_006', name: '边一笑' },
    1: { id: 'BGJ_CHAR_008', name: '崔云龙' },
    2: { id: 'BGJ_CHAR_007', name: '张岫玉' }
  });
  const TARGET_SOURCE = 'assets/targets/bgji_targets.mind';
  const GATE_MESSAGES = Object.freeze({
    unknown_target: '卡片尚未配置', metadata_unavailable: '内容数据暂时不可用',
    missing_record: '缺少对应内容', identity_mismatch: '内容与卡片不匹配',
    invalid_content: '内容数据不完整', audited_not_true: '内容尚未审核',
    version_matched_not_true: '内容版本尚未确认匹配', resource_valid_not_true: '内容资源尚未确认有效'
  });
  const LIBRARIES = [
    { name: 'A-Frame 1.5.0', urls: [
      'https://cdn.jsdelivr.net/npm/aframe@1.5.0/dist/aframe-master.min.js',
      'https://unpkg.com/aframe@1.5.0/dist/aframe-master.min.js'
    ], ready: () => Boolean(window.AFRAME) },
    { name: 'MindAR 1.2.5', urls: [
      'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js',
      'https://unpkg.com/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js'
    ], ready: () => Boolean(window.AFRAME?.components['mindar-image-target']) }
  ];
  const status = document.getElementById('status');
  const help = document.getElementById('help');
  const content = document.getElementById('content');
  const startButton = document.getElementById('start');
  const debug = document.getElementById('debug-overlay');
  const debugToggle = document.getElementById('debug-toggle');
  const container = document.getElementById('ar-container');
  const infoPanel = document.getElementById('info');
  const reviewStatus = document.getElementById('review-status');
  const sourcesPanel = document.getElementById('sources');
  const scanProgress = document.getElementById('scan-progress');
  const guide = document.getElementById('guide');
  const interfaceVersion = 'hci-experience-v2-20261004';
  const interfaceVariant = new URLSearchParams(window.location.search).get('ui') === 'A' ? 'A' : 'B';
  const enhancedUI = interfaceVariant === 'B';
  const recognizedIndexes = new Set();
  // Explicit study entry only. Query parameters cannot enable this exception.
  const studyVersion = document.getElementById('study-notice')?.dataset?.studyVersion ?? '';
  const isStudyPreview = studyVersion === 'bgj-study-v2';
  const metadataSource = isStudyPreview ? './assets/data/study-scene.json' : './assets/data/scene.json';
  const logs = [];
  const disposedControllers = new WeakSet();
  const userID = 'anonymous_' + Math.random().toString(36).slice(2, 8);
  const sessionClockStart = performance.now();
  const sessionCode = document.getElementById('session-code');
  if (sessionCode) sessionCode.textContent = userID;
  let phase = 'loading';
  let scene;
  let arSystem;
  let targetURL;
  let startupTimer;
  let lastTargetIndex = null;
  let lastEvent = '等待识别';
  let failure = '';
  let sceneMetadata = null;
  let metadataError = '';
  let activeTargetIndex = null;
  let gateState = '等待识别';
  let gateReasons = [];

  function updateDebug() {
    const character = CHARACTERS_BY_TARGET_INDEX[lastTargetIndex];
    debug.textContent = `targetIndex: ${lastTargetIndex ?? '—'}\n` +
      `event: ${lastEvent}\n角色: ${character?.name ?? '—'} (${character?.id ?? '—'})\n` +
      `阶段: ${phase}\n目标文件: assets/targets/bgji_targets.mind\n` +
      '映射: 0=边一笑 | 1=崔云龙 | 2=张岫玉' +
      `\nSemantic Gate: ${gateState}` + (gateReasons.length ? ` (${gateReasons.join(';')})` : '') +
      (isStudyPreview ? `\n研究预览: ${studyVersion}，文化内容待专家审核` : '') +
      (metadataError ? `\n语义数据: ${metadataError}` : '') + (failure ? `\n错误: ${failure}` : '');
  }

  function logEvent(event, index = null, reason = '') {
    logs.push({ user_id: userID, target_id: CHARACTERS_BY_TARGET_INDEX[index]?.id ?? '',
      target_index: index ?? '', event, timestamp: new Date().toISOString(),
      elapsed_ms: Number((performance.now() - sessionClockStart).toFixed(1)), reason,
      study_mode: isStudyPreview ? 'research_preview' : 'production',
      content_version: isStudyPreview ? studyVersion : '',
      ui_variant: interfaceVariant, interface_version: interfaceVersion });
  }

  function setReviewStatus(message) {
    if (reviewStatus) {
      reviewStatus.textContent = message;
      // The persistent research notice already explains this state above the text.
      reviewStatus.hidden = isStudyPreview && message === '研究草稿可供体验 · 尚未完成专家审核';
    }
  }

  function clearSources() {
    sourcesPanel?.replaceChildren();
    if (sourcesPanel) sourcesPanel.hidden = true;
  }

  function resetPanelScroll() {
    if (infoPanel) infoPanel.scrollTop = 0;
  }

  function showSources(record, index) {
    clearSources();
    if (!sourcesPanel || !Array.isArray(record.sources)) return;
    // Labels and links come from the same displayed record. No HTML injection.
    const urls = record.sources.filter(url => typeof url === 'string' && /^https:\/\/[^\s,]+$/.test(url));
    if (!urls.length) return;
    const summary = document.createElement('summary');
    summary.textContent = '查看介绍的资料来源';
    sourcesPanel.appendChild(summary);
    for (const [position, url] of urls.entries()) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = url.includes('www.fujian.gov.cn/') ? '福建日报报道（福建省政府网转载）' :
        url.includes('www.chinawriter.com.cn/') ? '中国作家网《贬官记》剧评' : `资料来源 ${position + 1}`;
      link.addEventListener('click', () => logEvent('source_opened', index, `source_${position + 1}`));
      sourcesPanel.appendChild(link);
    }
    sourcesPanel.hidden = false;
  }

  function blockExplanation(result) {
    return result.reasons.map(reason => reason === 'audited_not_true' ?
      (result.record?.audited === false ? '人物介绍尚未完成专家审核，暂不展示。' : '无法确认人物介绍已完成审核，暂不展示。') :
      `${GATE_MESSAGES[reason] ?? '内容状态无法确认'}。`).join('\n');
  }

  function setContentVisibility(entity, visible) {
    entity.querySelector('[data-semantic-content]')?.setAttribute('visible', visible);
  }

  function hideAllContents() {
    scene?.querySelectorAll('[mindar-image-target]').forEach(entity => setContentVisibility(entity, false));
  }

  // These flags are metadata declarations, not an independent cultural audit.
  function semanticGateCheck(index) {
    const character = CHARACTERS_BY_TARGET_INDEX[index];
    if (!character) return { passed: false, reasons: ['unknown_target'] };
    if (!sceneMetadata) return { passed: false, reasons: ['metadata_unavailable'] };
    const record = Object.hasOwn(sceneMetadata, character.id) ? sceneMetadata[character.id] : null;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { passed: false, reasons: ['missing_record'] };
    }
    const reasons = [];
    if (record.id !== character.id || record.targetIndex !== index ||
        record.title !== character.name || record.target !== TARGET_SOURCE) reasons.push('identity_mismatch');
    if (typeof record.description !== 'string' || !record.description.trim()) reasons.push('invalid_content');
    for (const field of ['audited', 'version_matched', 'resource_valid']) {
      if (record[field] !== true) reasons.push(`${field}_not_true`);
    }
    return { passed: reasons.length === 0, reasons, record };
  }

  async function loadSceneMetadata() {
    try {
      const bytes = await fetchWithTimeout(new URL(metadataSource, document.baseURI), 15000, 'no-cache');
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 顶层必须是角色字典');
      sceneMetadata = data;
    } catch (error) {
      metadataError = error.message;
      logEvent('semantic_metadata_error', null, 'metadata_unavailable');
    }
  }

  function releaseCamera() {
    // MindAR.stop() assumes a controller exists, which is false on partial startup.
    const video = arSystem?.video;
    video?.srcObject?.getTracks().forEach(track => track.stop());
    video?.remove();
    const controller = arSystem?.controller;
    if (controller && !disposedControllers.has(controller)) {
      disposedControllers.add(controller);
      controller.stopProcessVideo();
      controller.dispose();
    }
  }

  function fail(message) {
    if (phase === 'failed') return;
    phase = 'failed';
    hideAllContents();
    activeTargetIndex = null;
    clearSources();
    setReviewStatus('当前未显示人物介绍');
    document.getElementById('info')?.removeAttribute('data-scanning');
    resetPanelScroll();
    gateState = '运行中断';
    failure = message;
    clearTimeout(startupTimer);
    status.textContent = '启动或运行失败';
    help.textContent = message;
    content.textContent = '调整网络或相机权限后点击重试。';
    startButton.disabled = false;
    startButton.textContent = '重新加载并重试';
    try { releaseCamera(); } catch (error) { console.warn('Camera cleanup:', error); }
    logEvent('ar_error');
    updateDebug();
  }

  async function fetchWithTimeout(url, timeoutMs, cache = 'default') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, cache });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (!data.byteLength) throw new Error('文件为空');
      return data;
    } finally { clearTimeout(timeout); }
  }

  async function loadLibrary(library) {
    for (const url of library.urls) {
      try {
        // Abort the download before fallback so a late script cannot execute twice.
        const bytes = await fetchWithTimeout(url, 15000);
        const scriptURL = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
        try {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptURL;
            script.onload = resolve;
            script.onerror = () => reject(new Error('脚本执行失败'));
            document.head.appendChild(script);
          });
        } finally { URL.revokeObjectURL(scriptURL); }
        if (!library.ready()) throw new Error('组件未注册');
        return;
      } catch (error) {
        console.warn(`${library.name}: ${url}`, error);
      }
    }
    throw new Error(`${library.name} 下载失败，请检查网络后重试。`);
  }

  async function prepare() {
    try {
      if (!window.isSecureContext) throw new Error('请通过 HTTPS 的 GitHub Pages 地址打开页面。');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('此浏览器无法使用相机。请用 Safari 或 Chrome 打开页面。');
      const targets = fetchWithTimeout(new URL('./assets/targets/bgji_targets.mind', document.baseURI), 45000)
        .catch(error => { throw new Error(`卡片数据下载失败（${error.message}），请检查网络后重试。`); });
      const libraries = (async () => {
        for (const library of LIBRARIES) await loadLibrary(library);
      })();
      const [bytes] = await Promise.all([targets, libraries, loadSceneMetadata()]);
      if (phase === 'failed') return;
      targetURL = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      phase = 'prepared';
      status.textContent = '资源已就绪';
      setReviewStatus('扫描卡片后显示内容状态');
      help.textContent = metadataError ? '内容数据暂时不可用；仍可启动相机，内容展示将暂停。' : '点击启动，并允许使用后置相机。';
      startButton.disabled = false;
      startButton.textContent = '启动相机';
      updateDebug();
    } catch (error) { fail(error.message); }
  }

  function onTargetEvent(event) {
    if (phase !== 'running') return;
    // MindAR 1.2.5 targetFound/targetLost have no index in event.detail.
    // Read the component that MindAR actually updated, never a callback offset.
    const index = event.currentTarget.components['mindar-image-target'].data.targetIndex;
    lastTargetIndex = index;
    lastEvent = event.type;
    const character = CHARACTERS_BY_TARGET_INDEX[index];
    if (event.type === 'targetFound') {
      hideAllContents();
      clearSources();
      activeTargetIndex = index;
      status.textContent = character ? (enhancedUI ? `已识别：${character.name}` : '识别成功') : '识别到未配置卡片';
      if (character) recognizedIndexes.add(index);
      if (scanProgress) scanProgress.textContent = `已识别 ${recognizedIndexes.size}/3 张人物卡（不代表已阅读）`;
      logEvent('target_found', index);
      const result = semanticGateCheck(index);
      gateReasons = result.reasons;
      gateState = result.passed ? '放行' : '拦截';
      if (result.passed) {
        setReviewStatus('人物介绍已开放（按当前发布状态）');
        content.textContent = `${result.record.title}\n${result.record.description}`;
        showSources(result.record, index);
        if (enhancedUI) help.textContent = '阅读介绍后，可继续扫描其他人物卡。';
        setContentVisibility(event.currentTarget, true);
        logEvent('semantic_gate_pass', index);
      } else {
        logEvent('semantic_gate_block', index, result.reasons.join(';'));
        // An explicitly labelled research preview is not an audited gate pass.
        // Keep identity, version, resource and metadata failures fail-closed.
        const record = result.record;
        const previewAllowed = isStudyPreview && result.reasons.length === 1 &&
          result.reasons[0] === 'audited_not_true' && record?.audited === false &&
          record.research_preview === true && record.content_version === studyVersion &&
          Array.isArray(record.sources) && record.sources.length > 0 &&
          record.sources.every(url => typeof url === 'string' && /^https:\/\/[^\s,]+$/.test(url));
        if (previewAllowed) {
          setReviewStatus('研究草稿可供体验 · 尚未完成专家审核');
          content.textContent = `${record.title}\n${record.description}\n研究预览 · 文化说明待专家审核`;
          showSources(record, index);
          if (enhancedUI) help.textContent = '可上下滑动阅读，再扫描其他卡片。';
          setContentVisibility(event.currentTarget, true);
          logEvent('research_preview_display', index, 'expert_review_pending');
        } else {
          setReviewStatus('人物介绍暂未开放');
          content.textContent = '内容暂未开放\n' + (enhancedUI ? blockExplanation(result) : result.reasons.map(reason => GATE_MESSAGES[reason]).join('；'));
          if (enhancedUI) help.textContent = isStudyPreview ? '请稍后重新打开页面；也可继续扫描其他人物卡。' :
            '可继续扫描其他人物卡；参加问卷体验请使用“人物介绍研究体验”入口。';
        }
      }
      resetPanelScroll();
    } else {
      setContentVisibility(event.currentTarget, false);
      logEvent('target_lost', index);
      // A late loss from the previous anchor must not erase a newly found card.
      if (activeTargetIndex === index) {
        activeTargetIndex = null;
        status.textContent = '卡片已离开画面';
        clearSources();
        setReviewStatus('当前未显示人物介绍');
        content.textContent = '请将角色卡放回画面。';
        if (enhancedUI) help.textContent = '将卡片完整放回镜头内，系统会重新识别；这是追踪状态。';
        gateState = '等待识别';
        gateReasons = [];
        resetPanelScroll();
      }
    }
    updateDebug();
  }

  function startAR() {
    if (phase === 'failed') { window.location.reload(); return; }
    if (phase !== 'prepared') return;
    phase = 'starting';
    logEvent('camera_start_requested');
    startButton.disabled = true;
    startButton.textContent = '正在启动…';
    status.textContent = '正在启动相机和识别引擎…';
    help.textContent = '请允许相机权限；首次初始化可能需要一些时间。';
    updateDebug();
    startupTimer = setTimeout(() => fail('相机或识别引擎启动超时。请确认相机权限，关闭占用相机的应用后重试。'), 60000);
    try {
      scene = document.getElementById('ar-template').content.firstElementChild.cloneNode(true);
      scene.setAttribute('mindar-image', `imageTargetSrc: ${targetURL}; autoStart: false; maxTrack: 1; uiLoading: no; uiScanning: no; uiError: no;`);
      scene.querySelectorAll('[mindar-image-target]').forEach(entity => {
        entity.addEventListener('targetFound', onTargetEvent);
        entity.addEventListener('targetLost', onTargetEvent);
      });
      scene.addEventListener('arReady', () => {
        if (phase !== 'starting') return;
        clearTimeout(startupTimer);
        phase = 'running';
        guide?.removeAttribute('open');
        document.getElementById('info')?.setAttribute('data-scanning', 'true');
        resetPanelScroll();
        startButton.textContent = '相机已启动';
        status.textContent = '相机已就绪';
        content.textContent = '等待识别人物卡';
        setReviewStatus('扫描卡片后显示内容状态');
        help.textContent = '对准角色卡，保持卡片完整、光线充足。';
        logEvent('ar_ready');
        updateDebug();
      });
      scene.addEventListener('arError', () => fail('无法打开相机。请允许本站的相机权限，关闭占用相机的应用，并用 Safari 或 Chrome 重试。'));
      scene.addEventListener('loaded', event => {
        if (event.target !== scene || phase !== 'starting' || arSystem) return;
        lastEvent = 'A-Frame loaded';
        updateDebug();
        arSystem = scene.systems['mindar-image-system'];
        // MindAR 1.2.5 does not await/catch its async initialization. Guard late
        // camera permission results and surface target import / WebGL failures.
        const initializeAR = arSystem._startAR.bind(arSystem);
        arSystem._startAR = async () => {
          if (phase !== 'starting') { releaseCamera(); return; }
          try {
            await initializeAR();
            if (phase === 'failed') releaseCamera();
          } catch (error) { fail(`识别引擎初始化失败：${error.message}`); }
        };
        scene.canvas.addEventListener('webglcontextlost', event => {
          event.preventDefault();
          fail('图形渲染已中断，请重新加载页面。');
        });
        try { arSystem.start(); } catch (error) { fail(`识别引擎启动失败：${error.message}`); }
      });
      container.appendChild(scene);
    } catch (error) { fail(`页面初始化失败：${error.message}`); }
  }

  startButton.addEventListener('click', startAR);
  document.getElementById('export').addEventListener('click', () => {
    logEvent('log_export_requested');
    const columns = ['user_id', 'target_id', 'target_index', 'event', 'timestamp', 'elapsed_ms', 'reason', 'study_mode', 'content_version', 'ui_variant', 'interface_version'];
    const rows = logs.map(log => columns.map(column => log[column]).join(','));
    const url = URL.createObjectURL(new Blob(['\uFEFF' + columns.join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `AR_${isStudyPreview ? studyVersion : 'production'}_${interfaceVariant}_${userID}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  debug.hidden = new URLSearchParams(window.location.search).get('debug') !== '1';
  function updateDebugButton() {
    debugToggle.textContent = debug.hidden ? '显示调试' : '隐藏调试';
    debugToggle.setAttribute('aria-pressed', String(!debug.hidden));
  }
  debugToggle.addEventListener('click', () => { debug.hidden = !debug.hidden; updateDebugButton(); });
  updateDebugButton();
  window.addEventListener('unhandledrejection', event => {
    if (phase === 'starting' || phase === 'running') {
      fail(`识别引擎发生错误：${event.reason?.message ?? String(event.reason)}`);
    }
  });
  window.addEventListener('error', event => {
    if (phase === 'starting' || phase === 'running') fail(`页面运行错误：${event.message}`);
  });
  document.addEventListener('visibilitychange', () => {
    if (phase !== 'running') return;
    if (document.hidden) arSystem.pause();
    else arSystem.unpause();
  });
  window.addEventListener('pagehide', () => {
    phase = 'closed';
    clearTimeout(startupTimer);
    try { releaseCamera(); } catch (error) { console.warn(error); }
    if (targetURL) URL.revokeObjectURL(targetURL);
  });
  // Camera streams disposed on pagehide cannot be reused from the back/forward cache.
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  updateDebug();
  logEvent('session_started');
  prepare();
})();
