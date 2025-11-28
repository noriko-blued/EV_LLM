const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { chromium } = require('playwright-core');
const pdfParse = require('pdf-parse');
const { randomUUID } = require('crypto');
require('dotenv').config();

const automations = {
  schoolA: require('./automations/EV'),
  // Other schools will be added later
  // schoolB: require('./automations/Lexis'),
  // schoolC: require('./automations/CIA'),
  // schoolD: require('./automations/IBREEZE'),
  // schoolE: require('./automations/Philinter'),
  // schoolF: require('./automations/Impact'),
  // schoolG: require('./automations/CEL')
};

const SCHOOL_OPTIONS = [
  { id: 'schoolA', label: 'EV校' }
  // Other schools will be added later
  // { id: 'schoolB', label: 'Lexis校' },
  // { id: 'schoolC', label: 'CIA校' },
  // { id: 'schoolD', label: 'I.BREEZE校' },
  // { id: 'schoolE', label: 'Philinter校' },
  // { id: 'schoolF', label: 'Impact校' },
  // { id: 'schoolG', label: 'CEL校' }
];

let mainWindow;
let sharedBrowser = null; // 複数ジョブで共有
const jobs = new Map(); // jobId -> { context, page, schoolId, status, startedAt }

function sendLog(jobId, message, target) {
  const contents = target || (mainWindow && mainWindow.webContents);
  if (contents) {
    contents.send('log', { jobId, message });
  }
  const prefix = jobId ? `[${jobId}]` : '';
  console.log(prefix, message);
}

function sendJobStatus(jobId, payload, target) {
  const contents = target || (mainWindow && mainWindow.webContents);
  if (contents) {
    contents.send('job-status', { jobId, ...payload });
  }
}

function getChromePath() {
  const envPath = process.env.CHROME_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else if (process.platform === 'win32') {
    candidates.push('C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe');
    candidates.push('C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe');
  } else {
    candidates.push('/usr/bin/google-chrome-stable');
    candidates.push('/usr/bin/google-chrome');
  }

  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function createSharedBrowser() {
  if (sharedBrowser) return sharedBrowser;
  const executablePath = getChromePath();
  if (!executablePath) {
    throw new Error('Chromeのパスが見つかりません。環境変数 CHROME_PATH を設定してください。');
  }
  sharedBrowser = await chromium.launch({ headless: false, executablePath });
  return sharedBrowser;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

ipcMain.handle('get-schools', async () => {
  return SCHOOL_OPTIONS;
});

ipcMain.handle('select-pdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('start-automation', async (event, payload) => {
  const { schoolId, pdfPath, jobId: providedJobId } = payload || {};
  const jobId = providedJobId || randomUUID();

  if (!schoolId) {
    throw new Error('学校を選択してください');
  }
  if (!pdfPath) {
    throw new Error('PDFファイルを指定してください');
  }

  const automation = automations[schoolId];
  if (!automation) {
    throw new Error(`学校 ${schoolId} のシナリオが見つかりません`);
  }

  const pdfBuffer = await fs.promises.readFile(pdfPath);
  const pdfData = await pdfParse(pdfBuffer);
  const pdfText = pdfData.text;

  const browser = await createSharedBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  const jobMeta = { context, page, schoolId, status: 'running', startedAt: Date.now() };
  jobs.set(jobId, jobMeta);

  const log = (msg) => sendLog(jobId, msg, event.sender);
  sendLog(jobId, `PDFを読み込みました: ${path.basename(pdfPath)}`, event.sender);
  sendJobStatus(jobId, { status: 'running', schoolId, startedAt: jobMeta.startedAt }, event.sender);

  (async () => {
    try {
      await automation.run({ page, pdfText, pdfPath, log, env: process.env });
      sendJobStatus(jobId, { status: 'done' }, event.sender);
      sendLog(jobId, '自動入力が完了しました', event.sender);
    } catch (err) {
      sendLog(jobId, `エラー: ${err.message}`, event.sender);
      sendJobStatus(jobId, { status: 'error', error: err.message }, event.sender);
    } finally {
      // コンテキストを閉じずに、ユーザーが確認できるようにする
      // await context.close().catch(() => { });
      jobs.delete(jobId);
    }
  })();

  return { ok: true, jobId };
});

ipcMain.handle('stop-automation', async (event, { jobId } = {}) => {
  const job = jobs.get(jobId);
  if (!job) {
    return { ok: false, error: '対象のジョブがありません' };
  }
  try {
    await job.context?.close().catch(() => { });
    await job.page?.close().catch(() => { });
    jobs.delete(jobId);
    sendJobStatus(jobId, { status: 'stopped' }, event.sender);
    sendLog(jobId, 'ジョブを停止しました', event.sender);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => { });
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
