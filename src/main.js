const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dns = require('dns').promises;
const { spawn } = require('child_process');

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'YT Downloader UI');
const YOUTUBE_PARTITION = 'persist:youtube';
const COMMAND_FALLBACKS = {
  ytdlp: ['yt-dlp'],
  ffmpeg: ['ffmpeg'],
};

let mainWindow;
const activeDownloads = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    title: 'YT Downloader UI',
    backgroundColor: '#101113',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const source = params.src || '';
    if (!isAllowedWebviewUrl(source) || params.partition !== YOUTUBE_PARTITION) {
      event.preventDefault();
      return;
    }

    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.allowRunningInsecureContent = false;
    params.allowpopups = false;
  });

  mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('will-navigate', (event, url) => {
      if (!isAllowedWebviewUrl(url)) event.preventDefault();
    });
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  fs.mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function bundledBinDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'resources', 'bin');
}

function binaryCandidates(binaryName) {
  const bundledRoot = bundledBinDir();
  const bundledArch = path.join(bundledRoot, `${process.platform}-${process.arch}`, binaryName);
  const bundled = path.join(bundledRoot, binaryName);
  const homebrew = process.arch === 'arm64' ? `/opt/homebrew/bin/${binaryName}` : `/usr/local/bin/${binaryName}`;
  return [bundledArch, bundled, homebrew, `/usr/local/bin/${binaryName}`];
}

function isRunnablePath(candidate) {
  if (!candidate || candidate.includes(path.sep) === false) return false;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isAllowedWebviewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
      'google.com',
      'accounts.google.com',
    ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function resolveBinary(customPath, binaryName, fallbackCommands) {
  const candidates = [customPath, ...binaryCandidates(binaryName)].filter(Boolean);
  const runnable = candidates.find(isRunnablePath);
  return runnable || fallbackCommands[0];
}

function allBinaryCandidates(customPath, binaryName, fallbackCommands) {
  const bundledRoot = bundledBinDir();
  const alternateArch = process.arch === 'arm64' ? 'x64' : 'arm64';
  const candidates = [
    customPath,
    path.join(bundledRoot, `${process.platform}-${process.arch}`, binaryName),
    path.join(bundledRoot, `${process.platform}-${alternateArch}`, binaryName),
    path.join(bundledRoot, binaryName),
    process.arch === 'arm64' ? `/opt/homebrew/bin/${binaryName}` : `/usr/local/bin/${binaryName}`,
    `/opt/homebrew/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
    ...fallbackCommands,
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function ffmpegLocationArgs(ffmpegPath) {
  return ffmpegPath && ffmpegPath.includes(path.sep) ? ['--ffmpeg-location', path.dirname(ffmpegPath)] : [];
}

function electronNodePath() {
  if (app.isPackaged) return app.getPath('exe');
  return process.execPath;
}

function youtubeSolverArgs() {
  return ['--js-runtimes', `node:${electronNodePath()}`, '--remote-components', 'ejs:github'];
}

function runCommand(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd || DEFAULT_DOWNLOAD_DIR,
      env: {
        ...process.env,
        PATH: [
          path.join(bundledBinDir(), `${process.platform}-${process.arch}`),
          bundledBinDir(),
          process.env.PATH || '',
        ].join(path.delimiter),
        PYTHONUNBUFFERED: '1',
        ELECTRON_RUN_AS_NODE: options.enableElectronNodeRuntime ? '1' : process.env.ELECTRON_RUN_AS_NODE,
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on('error', (error) => reject(new Error(`Could not start "${binary}": ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `"${binary}" exited with code ${code}`));
    });

    options.onChild?.(child);
  });
}

function runYtDlp(args, options = {}) {
  const binary = resolveBinary(options.ytDlpPath, 'yt-dlp', COMMAND_FALLBACKS.ytdlp);
  return runCommand(binary, ['--ignore-config', '--no-color', ...args], {
    ...options,
    enableElectronNodeRuntime: true,
  });
}

function tempCookiePath(id) {
  return path.join(app.getPath('temp'), `yt-downloader-ui-${id || Date.now()}-cookies.txt`);
}

function netscapeCookieLine(cookie) {
  const rawDomain = cookie.domain || '';
  const includeSubdomains = rawDomain.startsWith('.') ? 'TRUE' : 'FALSE';
  const domain = cookie.httpOnly && !rawDomain.startsWith('#HttpOnly_') ? `#HttpOnly_${rawDomain}` : rawDomain;
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expires = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
  return [domain, includeSubdomains, cookie.path || '/', secure, expires, cookie.name, cookie.value].join('\t');
}

function isYouTubeAuthCookie(cookie) {
  const domain = String(cookie.domain || '').replace(/^#HttpOnly_/, '').toLowerCase();
  return [
    'youtube.com',
    'google.com',
    'accounts.google.com',
    'youtu.be',
  ].some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

async function exportAppSessionCookies(id) {
  const youtubeSession = session.fromPartition(YOUTUBE_PARTITION);
  const cookies = await youtubeSession.cookies.get({});
  const relevant = cookies.filter(isYouTubeAuthCookie);
  if (!relevant.length) {
    throw new Error('No YouTube login cookies were found in this app. Open YouTube in the browser, sign in, then try again.');
  }

  const filePath = tempCookiePath(id);
  const header = [
    '# Netscape HTTP Cookie File',
    '# Generated temporarily by YT Downloader UI for yt-dlp.',
  ];
  fs.writeFileSync(filePath, `${header.concat(relevant.map(netscapeCookieLine)).join('\n')}\n`, { mode: 0o600 });
  return filePath;
}

async function authArgs(settings = {}) {
  if (settings.authMode === 'app') {
    const cookiesFile = await exportAppSessionCookies(settings.id);
    return { args: ['--cookies', cookiesFile], tempFile: cookiesFile };
  }

  if (settings.authMode === 'browser' && settings.cookiesBrowser) {
    return { args: ['--cookies-from-browser', settings.cookiesBrowser], tempFile: '' };
  }

  if (settings.authMode === 'file' && settings.cookiesFile) {
    return { args: ['--cookies', settings.cookiesFile], tempFile: '' };
  }

  return { args: [], tempFile: '' };
}

function removeTempFile(filePath) {
  if (!filePath) return;
  fs.rm(filePath, { force: true }, () => {});
}

function parseJsonLines(output) {
  const entries = [];
  for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      if (line.startsWith('{') || line.startsWith('[')) {
        throw new Error('yt-dlp returned metadata that could not be parsed.');
      }
    }
  }
  return entries;
}

function normalizeEntry(entry) {
  return {
    id: entry.id,
    title: entry.title || 'Untitled',
    url: entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : ''),
    channel: entry.channel || entry.uploader || '',
    duration: entry.duration || null,
    viewCount: entry.view_count || null,
    uploadDate: entry.upload_date || '',
    thumbnail: entry.thumbnail || entry.thumbnails?.at?.(-1)?.url || '',
  };
}

function qualityArgs(settings, ffmpegOk) {
  if (settings.kind === 'audio') {
    if (settings.audioFormat === 'native') return ['-f', 'ba'];
    if (!ffmpegOk) {
      throw new Error('MP3 and M4A conversion need ffmpeg. This app normally bundles ffmpeg, but it could not be started on this Mac.');
    }
    const codec = settings.audioFormat === 'm4a' ? 'm4a' : 'mp3';
    const args = ['-x', '--audio-format', codec];
    if (settings.audioQuality && settings.audioQuality !== 'best') {
      args.push('--audio-quality', settings.audioQuality);
    }
    return args;
  }

  const height = settings.quality === 'best' ? null : Number.parseInt(settings.quality, 10);
  if (!ffmpegOk && !height) return ['-f', 'b[ext=mp4]/best[ext=mp4]/best'];
  if (!ffmpegOk) return ['-f', `b[height<=${height}][ext=mp4]/best[height<=${height}][ext=mp4]/best[height<=${height}]`];
  if (!height) return ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best', '--merge-output-format', 'mp4'];
  return [
    '-f',
    `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]/b[height<=${height}][ext=mp4]/best[height<=${height}]`,
    '--merge-output-format',
    'mp4',
  ];
}

function parseProgress(line) {
  const progress = line.match(/\[download\]\s+([\d.]+)%/);
  const speed = line.match(/at\s+([^\s]+\/s)/);
  const eta = line.match(/ETA\s+([^\s]+)/);
  const destination = line.match(/\[download\]\s+Destination:\s+(.+)/);
  const merged = line.match(/\[Merger\]\s+Merging formats into "(.+)"/);
  return {
    percent: progress ? Number(progress[1]) : null,
    speed: speed?.[1] || '',
    eta: eta?.[1] || '',
    destination: destination?.[1] || merged?.[1] || '',
  };
}

function statusLabelForLine(line) {
  if (line.includes('[ExtractAudio]')) return 'Converting audio...';
  if (line.includes('[Merger]')) return 'Merging MP4...';
  if (line.includes('[EmbedThumbnail]') || line.includes('[Metadata]')) return 'Writing metadata...';
  if (line.includes('[download] Destination:')) return 'Downloading file...';
  if (line.includes('[download]') && line.includes('%')) return 'Downloading file...';
  if (line.includes('[youtube]') || line.includes('[info]')) return 'Checking video...';
  return '';
}

async function binaryStatus(binary, args = ['--version']) {
  try {
    const result = await runCommand(binary, args);
    return { ok: true, version: (result.stdout || result.stderr).trim() };
  } catch (error) {
    return { ok: false, version: error.message };
  }
}

function preferredBundledBinary(binaryName) {
  const candidate = path.join(bundledBinDir(), `${process.platform}-${process.arch}`, binaryName);
  return isRunnablePath(candidate) ? candidate : '';
}

async function resolveWorkingBinary(customPath, binaryName, fallbackCommands, args = ['--version']) {
  let lastStatus = { ok: false, version: 'No candidate checked.' };
  for (const candidate of allBinaryCandidates(customPath, binaryName, fallbackCommands)) {
    if (candidate.includes(path.sep) && !isRunnablePath(candidate)) continue;
    const status = await binaryStatus(candidate, args);
    if (status.ok) return { path: candidate, ...status };
    lastStatus = status;
  }
  return {
    path: resolveBinary(customPath, binaryName, fallbackCommands),
    ok: false,
    version: lastStatus.version,
  };
}

ipcMain.handle('app:status', async (_event, settings = {}) => {
  const ytDlp = await resolveWorkingBinary(settings.ytDlpPath, 'yt-dlp', COMMAND_FALLBACKS.ytdlp);
  const ffmpeg = await resolveWorkingBinary(settings.ffmpegPath, 'ffmpeg', COMMAND_FALLBACKS.ffmpeg, ['-h']);
  const bundledFfmpeg = preferredBundledBinary('ffmpeg');
  const ffmpegOk = ffmpeg.ok || Boolean(bundledFfmpeg);

  let online = false;
  try {
    await dns.lookup('youtube.com');
    online = true;
  } catch {
    online = false;
  }

  return {
    ytDlpPath: ytDlp.path,
    ytDlpVersion: ytDlp.version,
    ytDlpOk: ytDlp.ok,
    ffmpegPath: ffmpeg.ok ? ffmpeg.path : bundledFfmpeg || ffmpeg.path,
    ffmpegVersion: ffmpeg.ok ? ffmpeg.version : (bundledFfmpeg ? 'Bundled ffmpeg available' : ffmpeg.version),
    ffmpegOk,
    online,
    defaultDownloadDir: DEFAULT_DOWNLOAD_DIR,
  };
});

ipcMain.handle('app:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose download folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('app:pick-cookies-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose cookies.txt',
    properties: ['openFile'],
    filters: [{ name: 'Cookies text file', extensions: ['txt'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('app:search', async (_event, payload) => {
  const query = String(payload.query || '').trim();
  if (!query) return [];
  const isUrl = /^https?:\/\//i.test(query);
  const target = isUrl ? query : `ytsearch${payload.limit || 12}:${query}`;
  const auth = await authArgs(payload);
  const args = [
    '--dump-json',
    '--skip-download',
    '--no-warnings',
    ...youtubeSolverArgs(),
    '--socket-timeout',
    '15',
    '--retries',
    '2',
    ...auth.args,
  ];
  if (isUrl) args.push('--no-playlist');
  else args.push('--flat-playlist');
  args.push(target);
  try {
    const result = await runYtDlp(args, {
      ytDlpPath: payload.ytDlpPath,
    });
    return parseJsonLines(result.stdout).map(normalizeEntry).filter((item) => item.url);
  } finally {
    removeTempFile(auth.tempFile);
  }
});

ipcMain.handle('app:formats', async (_event, payload) => {
  const auth = await authArgs(payload);
  try {
    const result = await runYtDlp(['--list-formats', '--no-playlist', ...youtubeSolverArgs(), ...auth.args, payload.url], {
      ytDlpPath: payload.ytDlpPath,
    });
    return result.stdout;
  } finally {
    removeTempFile(auth.tempFile);
  }
});

ipcMain.handle('app:download', async (_event, payload) => {
  const id = payload.id || `${Date.now()}`;
  const destination = payload.destination || DEFAULT_DOWNLOAD_DIR;
  fs.mkdirSync(destination, { recursive: true });

  const ffmpeg = await resolveWorkingBinary(payload.ffmpegPath, 'ffmpeg', COMMAND_FALLBACKS.ffmpeg, ['-h']);
  const outputTemplate = path.join(destination, '%(title).180B [%(id)s].%(ext)s');
  let args;
  let auth = { args: [], tempFile: '' };
  try {
    mainWindow?.webContents.send('download:progress', { id, statusLabel: 'Checking YouTube access...', percent: 0 });
    auth = await authArgs({ ...payload, id });
    args = [
      '--newline',
      '--progress',
      '--socket-timeout',
      '15',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      '--retry-sleep',
      'linear=1::2',
      '--no-playlist',
      ...youtubeSolverArgs(),
      '-o',
      outputTemplate,
      ...(ffmpeg.ok ? ffmpegLocationArgs(ffmpeg.path) : []),
      ...auth.args,
      ...qualityArgs(payload.settings || {}, ffmpeg.ok),
    ];
  } catch (error) {
    removeTempFile(auth.tempFile);
    mainWindow?.webContents.send('download:error', { id, message: error.message });
    return { id, started: false, ffmpegOk: ffmpeg.ok, error: error.message };
  }

  if (payload.settings?.embedMetadata && ffmpeg.ok) {
    args.push('--embed-metadata', '--embed-thumbnail');
  }

  args.push(payload.url);

  runYtDlp(args, {
    ytDlpPath: payload.ytDlpPath,
    cwd: destination,
    onChild: (child) => {
      activeDownloads.set(id, child);
      mainWindow?.webContents.send('download:progress', { id, statusLabel: 'Starting download...', percent: 0 });
    },
    onStdout: (text) => {
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        mainWindow?.webContents.send('download:progress', { id, line, ...parseProgress(line), statusLabel: statusLabelForLine(line) });
      }
    },
    onStderr: (text) => {
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        mainWindow?.webContents.send('download:log', { id, line });
      }
    },
  })
    .then(() => {
      activeDownloads.delete(id);
      removeTempFile(auth.tempFile);
      mainWindow?.webContents.send('download:complete', { id });
    })
    .catch((error) => {
      activeDownloads.delete(id);
      removeTempFile(auth.tempFile);
      mainWindow?.webContents.send('download:error', { id, message: error.message });
    });

  return { id, started: true, ffmpegOk: ffmpeg.ok };
});

ipcMain.handle('app:cancel-download', async (_event, id) => {
  const child = activeDownloads.get(id);
  if (!child) return false;
  child.kill('SIGTERM');
  activeDownloads.delete(id);
  return true;
});

ipcMain.handle('app:reveal', async (_event, targetPath) => {
  if (targetPath && fs.existsSync(targetPath)) {
    shell.showItemInFolder(targetPath);
    return true;
  }
  await shell.openPath(DEFAULT_DOWNLOAD_DIR);
  return false;
});
