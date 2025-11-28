const schoolSelect = document.getElementById('school');
const choosePdfBtn = document.getElementById('choosePdf');
const startBtn = document.getElementById('startBtn');
const dropzone = document.getElementById('dropzone');
const statusEl = document.getElementById('status');
const pill = document.getElementById('pdf-pill');
const logsEl = document.getElementById('logs');
const clearLogBtn = document.getElementById('clearLog');
const jobsBody = document.getElementById('jobsBody');
const logTitle = document.getElementById('logTitle');

let selectedPdfPath = '';
let unsubscribeLog = null;
let unsubscribeStatus = null;
const schools = new Map();
const jobs = new Map(); // jobId -> {schoolId,label,status,startedAt}
const jobLogs = new Map(); // jobId -> [lines]
let selectedJobId = '';

function genJobId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function appendLog(jobId, message) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${message}`;
  const current = jobLogs.get(jobId) || [];
  current.push(line);
  jobLogs.set(jobId, current);
  if (jobId === selectedJobId) renderLogs();
}

function renderLogs() {
  const lines = jobLogs.get(selectedJobId) || [];
  logsEl.textContent = lines.join('\n');
  logsEl.scrollTop = logsEl.scrollHeight;
  logTitle.textContent = selectedJobId ? `ログ（${selectedJobId}）` : 'ログ（ジョブ未選択）';
}

function renderJobs() {
  const rows = Array.from(jobs.values())
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((job) => {
      const statusClass = `pill-status ${job.status}`;
      const statusLabel = job.status === 'running' ? '実行中' :
        job.status === 'done' ? '完了' :
        job.status === 'error' ? 'エラー' :
        job.status === 'stopped' ? '停止' : '待機';
      return `
        <tr data-jobid="${job.id}" class="${job.id === selectedJobId ? 'active' : ''}">
          <td>${job.id.replace(/(.{8}).+/, '$1…')}</td>
          <td>${job.label || job.schoolId}</td>
          <td>${formatTime(job.startedAt)}</td>
          <td><span class="${statusClass}">${statusLabel}</span></td>
          <td class="jobs-actions">
            <button data-action="select" data-jobid="${job.id}">選択</button>
            <button data-action="stop" data-jobid="${job.id}">停止</button>
          </td>
        </tr>`;
    })
    .join('');
  jobsBody.innerHTML = rows;
}

async function loadSchools() {
  const options = await window.api.getSchools();
  options.forEach((opt) => {
    const optionEl = document.createElement('option');
    optionEl.value = opt.id;
    optionEl.textContent = opt.label;
    schoolSelect.appendChild(optionEl);
    schools.set(opt.id, opt.label);
  });
}

function setPdfPath(pdfPath) {
  selectedPdfPath = pdfPath;
  if (!pdfPath) {
    statusEl.textContent = 'PDF未選択';
    pill.style.display = 'none';
    return;
  }
  const filename = pdfPath.split(/[\\/]/).pop();
  statusEl.textContent = filename;
  pill.textContent = filename;
  pill.style.display = 'inline-flex';
}

function wireDragAndDrop() {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'));
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'));
  });

  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files?.[0];
    if (file && file.path?.toLowerCase().endsWith('.pdf')) {
      setPdfPath(file.path);
      appendLog(selectedJobId, `PDF選択: ${file.path}`);
    } else {
      appendLog(selectedJobId, 'PDFファイルをドロップしてください');
    }
  });
}

choosePdfBtn.addEventListener('click', async () => {
  const pdfPath = await window.api.selectPdf();
  if (pdfPath) {
    setPdfPath(pdfPath);
    if (selectedJobId) appendLog(selectedJobId, `PDF選択: ${pdfPath}`);
  }
});

startBtn.addEventListener('click', async () => {
  const schoolId = schoolSelect.value;
  if (!schoolId) {
    alert('学校を選択してください');
    return;
  }
  if (!selectedPdfPath) {
    alert('PDFを選択してください');
    return;
  }

  const jobId = genJobId();
  const label = schools.get(schoolId) || schoolId;
  const startedAt = Date.now();
  jobs.set(jobId, { id: jobId, schoolId, label, status: 'running', startedAt });
  jobLogs.set(jobId, []);
  selectedJobId = jobId;
  renderJobs();
  renderLogs();

  startBtn.disabled = true;
  try {
    const res = await window.api.startAutomation({ jobId, schoolId, pdfPath: selectedPdfPath });
    if (!res?.ok) throw new Error(res?.error || '開始に失敗しました');
  } catch (err) {
    appendLog(jobId, `エラー: ${err.message}`);
    const job = jobs.get(jobId);
    if (job) job.status = 'error';
    renderJobs();
  } finally {
    startBtn.disabled = false;
  }
});

clearLogBtn.addEventListener('click', () => {
  if (!selectedJobId) return;
  jobLogs.set(selectedJobId, []);
  renderLogs();
});

jobsBody.addEventListener('click', async (e) => {
  const action = e.target.getAttribute('data-action');
  const jobId = e.target.getAttribute('data-jobid');
  if (!action || !jobId) return;

  if (action === 'select') {
    selectedJobId = jobId;
    renderJobs();
    renderLogs();
  }

  if (action === 'stop') {
    await window.api.stopAutomation({ jobId });
  }
});

function init() {
  loadSchools();
  wireDragAndDrop();

  unsubscribeLog = window.api.onLog((data) => {
    if (!data) return;
    const { jobId, message } = data;
    if (jobId && !jobs.has(jobId)) {
      jobs.set(jobId, { id: jobId, schoolId: '-', label: '-', status: 'running', startedAt: Date.now() });
    }
    appendLog(jobId || selectedJobId, message);
    renderJobs();
  });

  unsubscribeStatus = window.api.onJobStatus((data) => {
    if (!data || !data.jobId) return;
    const job = jobs.get(data.jobId) || { id: data.jobId, schoolId: '-', label: '-', startedAt: Date.now() };
    job.status = data.status || job.status;
    job.error = data.error;
    if (data.schoolId) job.schoolId = data.schoolId;
    if (data.schoolId && schools.has(data.schoolId)) job.label = schools.get(data.schoolId);
    if (data.startedAt) job.startedAt = data.startedAt;
    jobs.set(data.jobId, job);
    renderJobs();
  });
}

window.addEventListener('beforeunload', () => {
  if (unsubscribeLog) unsubscribeLog();
  if (unsubscribeStatus) unsubscribeStatus();
});

init();
