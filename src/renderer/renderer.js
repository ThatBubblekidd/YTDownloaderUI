const YOUTUBE_HOME = 'https://www.youtube.com';

const state = {
  online: navigator.onLine,
  ytDlpOk: false,
  ffmpegOk: false,
  currentUrl: '',
  currentTitle: '',
  queue: new Map(),
};

const els = {
  statusPill: document.querySelector('#statusPill'),
  browserForm: document.querySelector('#browserForm'),
  browserInput: document.querySelector('#browserInput'),
  goButton: document.querySelector('#goButton'),
  backButton: document.querySelector('#backButton'),
  forwardButton: document.querySelector('#forwardButton'),
  reloadButton: document.querySelector('#reloadButton'),
  youtubeView: document.querySelector('#youtubeView'),
  browserStatus: document.querySelector('#browserStatus'),
  browserLoading: document.querySelector('#browserLoading'),
  browserOffline: document.querySelector('#browserOffline'),
  offlineBanner: document.querySelector('#offlineBanner'),
  errorBanner: document.querySelector('#errorBanner'),
  ffmpegNotice: document.querySelector('#ffmpegNotice'),
  toastStack: document.querySelector('#toastStack'),
  queueCount: document.querySelector('#queueCount'),
  queueList: document.querySelector('#queueList'),
  downloadDir: document.querySelector('#downloadDir'),
  pickFolderButton: document.querySelector('#pickFolderButton'),
  ytDlpPath: document.querySelector('#ytDlpPath'),
  authMode: document.querySelector('#authMode'),
  cookiesBrowserLabel: document.querySelector('#cookiesBrowserLabel'),
  cookiesBrowser: document.querySelector('#cookiesBrowser'),
  cookiesFileLabel: document.querySelector('#cookiesFileLabel'),
  cookiesFile: document.querySelector('#cookiesFile'),
  pickCookiesButton: document.querySelector('#pickCookiesButton'),
  downloadKind: document.querySelector('#downloadKind'),
  videoQualityLabel: document.querySelector('#videoQualityLabel'),
  videoQuality: document.querySelector('#videoQuality'),
  audioFormatLabel: document.querySelector('#audioFormatLabel'),
  audioFormat: document.querySelector('#audioFormat'),
  audioQualityLabel: document.querySelector('#audioQualityLabel'),
  audioQuality: document.querySelector('#audioQuality'),
  embedMetadata: document.querySelector('#embedMetadata'),
  currentVideoTitle: document.querySelector('#currentVideoTitle'),
  currentVideoUrl: document.querySelector('#currentVideoUrl'),
  downloadCurrentButton: document.querySelector('#downloadCurrentButton'),
};

function loadSettings() {
  const saved = JSON.parse(localStorage.getItem('settings') || '{}');
  if (saved.downloadDir) els.downloadDir.value = saved.downloadDir;
  if (saved.ytDlpPath) els.ytDlpPath.value = saved.ytDlpPath;
  if (saved.authMode) els.authMode.value = saved.authMode;
  else els.authMode.value = 'app';
  if (saved.cookiesBrowser) els.cookiesBrowser.value = saved.cookiesBrowser;
  if (saved.cookiesFile) els.cookiesFile.value = saved.cookiesFile;
  updateAuthFields();
  updateKindFields();
}

function saveSettings() {
  localStorage.setItem(
    'settings',
    JSON.stringify({
      downloadDir: els.downloadDir.value,
      ytDlpPath: els.ytDlpPath.value,
      authMode: els.authMode.value,
      cookiesBrowser: els.cookiesBrowser.value,
      cookiesFile: els.cookiesFile.value,
    }),
  );
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}

function settingsPayload() {
  return {
    ytDlpPath: els.ytDlpPath.value.trim(),
    destination: els.downloadDir.value,
    authMode: els.authMode.value,
    cookiesBrowser: els.cookiesBrowser.value,
    cookiesFile: els.cookiesFile.value,
  };
}

function showError(message) {
  els.errorBanner.textContent = message;
  els.errorBanner.classList.remove('hidden');
}

function clearError() {
  els.errorBanner.textContent = '';
  els.errorBanner.classList.add('hidden');
}

function showToast(title, message = '', type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    ${message ? `<span>${escapeHtml(message)}</span>` : ''}
  `;
  els.toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add('leaving');
    window.setTimeout(() => toast.remove(), 250);
  }, 3600);
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function queueMeta(item) {
  const details = [];
  if (Number.isFinite(item.percent) && item.percent > 0 && item.percent < 100) details.push(`${Math.round(item.percent)}%`);
  if (item.error) details.push(item.error);
  return details.join(' · ');
}

function isFinishedStatus(status) {
  return ['Complete', 'Failed', 'Cancelled'].includes(status);
}

function updateAuthFields() {
  const mode = els.authMode.value;
  els.cookiesBrowserLabel.classList.toggle('hidden', mode !== 'browser');
  els.cookiesFileLabel.classList.toggle('hidden', mode !== 'file');
}

function updateKindFields() {
  const audio = els.downloadKind.value === 'audio';
  els.videoQualityLabel.classList.toggle('hidden', audio);
  els.audioFormatLabel.classList.toggle('hidden', !audio);
  els.audioQualityLabel.classList.toggle('hidden', !audio);
}

function isYouTubeVideoUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return url.pathname.length > 1;
    if (host !== 'youtube.com' && host !== 'm.youtube.com') return false;
    return (url.pathname === '/watch' && url.searchParams.has('v')) || url.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

function cleanVideoUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return `https://youtu.be${url.pathname}`;
    if (url.pathname.startsWith('/shorts/')) return `${YOUTUBE_HOME}${url.pathname}`;
    if (url.pathname === '/watch' && url.searchParams.has('v')) {
      return `${YOUTUBE_HOME}/watch?v=${encodeURIComponent(url.searchParams.get('v'))}`;
    }
  } catch {
    return value;
  }
  return value;
}

function navigationTarget(rawValue) {
  const value = rawValue.trim();
  if (!value) return YOUTUBE_HOME;
  if (/^https?:\/\//i.test(value)) return value;
  return `${YOUTUBE_HOME}/results?search_query=${encodeURIComponent(value)}`;
}

function setBrowserLoading(loading, label = '') {
  els.browserLoading.textContent = label || 'Loading YouTube...';
  els.browserLoading.classList.toggle('hidden', !loading);
  if (loading) {
    els.browserStatus.textContent = label || 'Loading...';
    return;
  }
  els.browserStatus.textContent = isYouTubeVideoUrl(state.currentUrl)
    ? 'Video ready'
    : 'Browsing';
}

function updateOfflineUi() {
  const offline = !state.online;
  els.offlineBanner.classList.toggle('hidden', !offline);
  els.browserOffline.classList.toggle('hidden', !offline);
  els.goButton.disabled = offline;
  els.reloadButton.disabled = offline;
  updateCurrentVideoUi();
}

function updateCurrentVideoUi() {
  const canDownload = state.online && state.ytDlpOk && isYouTubeVideoUrl(state.currentUrl);
  els.downloadCurrentButton.disabled = !canDownload;
  if (isYouTubeVideoUrl(state.currentUrl)) {
    els.currentVideoTitle.textContent = state.currentTitle || 'YouTube video';
    els.currentVideoUrl.textContent = cleanVideoUrl(state.currentUrl);
  } else {
    els.currentVideoTitle.textContent = 'No video selected';
    els.currentVideoUrl.textContent = state.online
      ? 'Open a YouTube video or Short in the browser.'
      : 'Connect to the internet, then open a YouTube video.';
  }
}

function updateNavButtons() {
  try {
    els.backButton.disabled = !els.youtubeView.canGoBack();
    els.forwardButton.disabled = !els.youtubeView.canGoForward();
  } catch {
    els.backButton.disabled = true;
    els.forwardButton.disabled = true;
  }
}

async function refreshStatus() {
  let status;
  try {
    status = await window.ytApp.getStatus(settingsPayload());
  } catch (error) {
    showError(`Status check failed: ${error.message}`);
    return;
  }

  state.online = Boolean(status.online && navigator.onLine);
  state.ytDlpOk = status.ytDlpOk;
  state.ffmpegOk = status.ffmpegOk;

  if (!els.downloadDir.value) els.downloadDir.value = status.defaultDownloadDir;
  if (!els.ytDlpPath.value && status.ytDlpOk) els.ytDlpPath.value = status.ytDlpPath;

  els.ffmpegNotice.textContent = state.ffmpegOk
    ? 'ffmpeg detected. MP3, thumbnail embedding, and MP4 merging are enabled.'
    : 'ffmpeg is not available yet. MP3/M4A conversion is disabled; native audio can still download.';

  if (!state.ytDlpOk) {
    els.statusPill.textContent = 'yt-dlp missing';
    els.statusPill.className = 'status-pill danger';
  } else if (!state.online) {
    els.statusPill.textContent = `Offline - yt-dlp ${status.ytDlpVersion}`;
    els.statusPill.className = 'status-pill warning';
  } else {
    els.statusPill.textContent = `Online - yt-dlp ${status.ytDlpVersion}`;
    els.statusPill.className = 'status-pill ok';
  }

  updateOfflineUi();
}

function renderQueue() {
  els.queueList.innerHTML = '';
  const entries = [...state.queue.values()];
  els.queueCount.textContent = `${entries.filter((item) => !['Complete', 'Failed', 'Cancelled'].includes(item.status)).length} active`;

  if (!entries.length) {
    els.queueList.innerHTML = '<div class="empty-queue">Downloads you start will appear here.</div>';
    return;
  }

  for (const item of entries) {
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.dataset.queueId = item.id;
    const meta = queueMeta(item);
    const finished = isFinishedStatus(item.status);
    row.innerHTML = `
      <div class="queue-title">${escapeHtml(item.title)}</div>
      <div class="queue-status">${escapeHtml(item.status)}</div>
      ${meta ? `<div class="queue-meta">${escapeHtml(meta)}</div>` : ''}
      <div class="progress-track"><div style="width:${item.percent || 0}%"></div></div>
      <div class="queue-actions">
        ${finished ? '' : `<button data-cancel="${escapeHtml(item.id)}" ${item.status === 'Cancelling...' ? 'disabled' : ''}>Cancel</button>`}
        <button data-reveal="${escapeHtml(item.destination || '')}">Reveal</button>
        ${finished ? `<button data-clear="${escapeHtml(item.id)}">Clear</button>` : ''}
      </div>
    `;
    els.queueList.appendChild(row);
  }
}

async function startDownloadFromCurrentVideo() {
  clearError();
  const previousButtonText = els.downloadCurrentButton.textContent;
  els.downloadCurrentButton.disabled = true;
  els.downloadCurrentButton.textContent = 'Adding...';
  await refreshStatus();
  if (!state.online) {
    showError('Please connect to the internet before starting a download.');
    els.downloadCurrentButton.textContent = previousButtonText;
    updateCurrentVideoUi();
    return;
  }
  if (!state.ytDlpOk) {
    showError('yt-dlp could not be started. Check the bundled app files or choose a yt-dlp path.');
    els.downloadCurrentButton.textContent = previousButtonText;
    updateCurrentVideoUi();
    return;
  }
  if (!isYouTubeVideoUrl(state.currentUrl)) {
    els.downloadCurrentButton.textContent = previousButtonText;
    updateCurrentVideoUi();
    return;
  }

  const cleanUrl = cleanVideoUrl(state.currentUrl);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const settings = {
    kind: els.downloadKind.value,
    quality: els.videoQuality.value,
    audioFormat: els.audioFormat.value,
    audioQuality: els.audioQuality.value,
    embedMetadata: els.embedMetadata.checked,
  };

  state.queue.set(id, {
    id,
    title: state.currentTitle || 'YouTube video',
    url: cleanUrl,
    status: 'Preparing download...',
    percent: 0,
    destination: els.downloadDir.value,
  });
  renderQueue();
  showToast('Download added', 'Preparing the file now.');
  window.requestAnimationFrame(() => {
    document.querySelector(`[data-queue-id="${cssEscape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  try {
    const response = await window.ytApp.download({ ...settingsPayload(), id, url: cleanUrl, settings });
    if (!response.started && !response.cancelled) throw new Error(response.error || 'Download could not start.');
  } catch (error) {
    const queued = state.queue.get(id);
    if (queued) {
      queued.status = 'Failed';
      queued.error = error.message || 'Download could not start.';
    }
    showError(error.message || 'Download could not start.');
    renderQueue();
  } finally {
    els.downloadCurrentButton.textContent = previousButtonText;
    updateCurrentVideoUi();
  }
}

function bindBrowserEvents() {
  els.youtubeView.addEventListener('dom-ready', () => {
    updateNavButtons();
    setBrowserLoading(false);
  });

  els.youtubeView.addEventListener('did-start-loading', () => {
    setBrowserLoading(true, 'Loading YouTube...');
  });

  els.youtubeView.addEventListener('did-stop-loading', () => {
    setBrowserLoading(false);
    updateNavButtons();
  });

  els.youtubeView.addEventListener('did-navigate', (event) => updateCurrentPage(event.url));
  els.youtubeView.addEventListener('did-navigate-in-page', (event) => updateCurrentPage(event.url));

  els.youtubeView.addEventListener('page-title-updated', (event) => {
    state.currentTitle = event.title.replace(/ - YouTube$/, '');
    updateCurrentVideoUi();
  });

  els.youtubeView.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3 || event.isMainFrame === false) return;
    setBrowserLoading(false);
    els.browserStatus.textContent = 'Could not load';
    showError('YouTube could not load. Check the internet connection and try reload.');
  });
}

function updateCurrentPage(url) {
  state.currentUrl = url || '';
  els.browserInput.value = url || '';
  els.browserStatus.textContent = isYouTubeVideoUrl(url) ? 'Video ready' : 'Browsing';
  updateCurrentVideoUi();
  updateNavButtons();
}

els.browserForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearError();
  if (!state.online) {
    showError('Please connect to the internet to browse YouTube.');
    return;
  }
  els.youtubeView.loadURL(navigationTarget(els.browserInput.value));
});

els.backButton.addEventListener('click', () => {
  if (els.youtubeView.canGoBack()) els.youtubeView.goBack();
});
els.forwardButton.addEventListener('click', () => {
  if (els.youtubeView.canGoForward()) els.youtubeView.goForward();
});
els.reloadButton.addEventListener('click', () => {
  if (state.online) els.youtubeView.reload();
});
els.downloadCurrentButton.addEventListener('click', startDownloadFromCurrentVideo);
els.pickFolderButton.addEventListener('click', async () => {
  const folder = await window.ytApp.pickFolder();
  if (folder) {
    els.downloadDir.value = folder;
    saveSettings();
  }
});
els.ytDlpPath.addEventListener('change', () => {
  saveSettings();
  refreshStatus();
});
els.authMode.addEventListener('change', () => {
  updateAuthFields();
  saveSettings();
});
els.cookiesBrowser.addEventListener('change', saveSettings);
els.pickCookiesButton.addEventListener('click', async () => {
  const file = await window.ytApp.pickCookiesFile();
  if (file) {
    els.cookiesFile.value = file;
    saveSettings();
  }
});
els.downloadKind.addEventListener('change', updateKindFields);

els.queueList.addEventListener('click', async (event) => {
  const cancelButton = event.target.closest('[data-cancel]');
  if (cancelButton) {
    const item = state.queue.get(cancelButton.dataset.cancel);
    if (item) item.status = 'Cancelling...';
    renderQueue();
    const cancelled = await window.ytApp.cancelDownload(cancelButton.dataset.cancel);
    if (!cancelled) {
      if (item) item.status = 'Complete';
      showToast('Could not cancel', 'The download may have already finished.', 'warning');
      renderQueue();
    }
  }

  const revealButton = event.target.closest('[data-reveal]');
  if (revealButton) await window.ytApp.reveal(revealButton.dataset.reveal);

  const clearButton = event.target.closest('[data-clear]');
  if (clearButton) {
    state.queue.delete(clearButton.dataset.clear);
    renderQueue();
  }
});

window.addEventListener('online', () => {
  state.online = true;
  clearError();
  refreshStatus();
});
window.addEventListener('offline', () => {
  state.online = false;
  updateOfflineUi();
});

window.ytApp.onProgress((payload) => {
  const item = state.queue.get(payload.id);
  if (!item) return;
  if (payload.statusLabel) item.status = payload.statusLabel;
  else if (payload.percent === 100) item.status = 'Finishing...';
  else item.status = 'Downloading file...';
  if (payload.percent !== null && payload.percent !== undefined) item.percent = payload.percent;
  if (payload.destination) item.destination = payload.destination;
  if (payload.speed) item.speed = payload.speed;
  if (payload.eta) item.eta = payload.eta;
  if (payload.totalSize) item.totalSize = payload.totalSize;
  renderQueue();
});

window.ytApp.onComplete(({ id }) => {
  const item = state.queue.get(id);
  if (!item) return;
  item.status = 'Complete';
  item.percent = 100;
  item.error = '';
  item.speed = '';
  item.eta = '';
  showToast('Download complete', item.title);
  renderQueue();
});

window.ytApp.onError(({ id, message }) => {
  const item = state.queue.get(id);
  if (!item) return;
  item.status = 'Failed';
  item.error = message;
  showError(message);
  showToast('Download failed', message, 'error');
  renderQueue();
});
window.ytApp.onCancelled(({ id }) => {
  const item = state.queue.get(id);
  if (!item) return;
  item.status = 'Cancelled';
  item.speed = '';
  item.eta = '';
  item.error = '';
  showToast('Download cancelled', item.title);
  renderQueue();
});

loadSettings();
bindBrowserEvents();
refreshStatus();
renderQueue();
setInterval(refreshStatus, 30000);
