const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const Store = require('./lib/store');
const { RUNNERS, runClaude, extractJson, available } = require('./lib/ai');
const { buildPrompt, buildCommonPrompt } = require('./lib/prompt');
const F = require('./lib/fields');

// 기록은 앱 폴더 data\ 에 둠 (JSDO_DATA 로 바꿀 수 있음 — 시험할 때 실제 기록을 안 건드리려고)
const DATA_DIR = process.env.JSDO_DATA || path.join(__dirname, 'data');
let store, win;

const DEFAULT_SETTINGS = { geminiAuth: 'login', codexModel: '', geminiModel: '', claudeModel: '' };
const settings = () => ({ ...DEFAULT_SETTINGS, ...(store.db.settings || {}) });

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 640,
    title: '학생지도도우미',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

async function runOne(consultId, key, prompt) {
  const t0 = Date.now();
  try {
    const raw = await RUNNERS[key](prompt, settings());
    let data = null, parseError = null;
    try { data = extractJson(raw); } catch (e) { parseError = e.message; }
    store.patchConsult(consultId, c => { c.results[key] = { status: 'done', data, raw: data ? undefined : raw, parseError, ms: Date.now() - t0 }; });
  } catch (e) {
    store.patchConsult(consultId, c => { c.results[key] = { status: 'error', error: e.message, ms: Date.now() - t0 }; });
  }
  send('consult:update', store.consult(consultId));
}

async function runCommon(consultId) {
  const c = store.consult(consultId);
  const ok = F.MODELS.filter(m => c.results[m.key] && c.results[m.key].status === 'done' && c.results[m.key].data);
  if (ok.length < 2) {
    store.patchConsult(consultId, x => { x.common = { status: 'error', error: '답이 두 개 이상 와야 공통 추천을 뽑을 수 있습니다.' }; });
    return send('consult:update', store.consult(consultId));
  }
  store.patchConsult(consultId, x => { x.common = { status: 'running' }; });
  send('consult:update', store.consult(consultId));
  try {
    const raw = await runClaude(buildCommonPrompt(c.results), settings());
    const data = extractJson(raw);
    store.patchConsult(consultId, x => { x.common = { status: 'done', ...data }; });
  } catch (e) {
    store.patchConsult(consultId, x => { x.common = { status: 'error', error: e.message }; });
  }
  send('consult:update', store.consult(consultId));
}

// 텔레그램 봇(followup_bot.py)이 받은 답은 data\inbox.jsonl 에 한 줄씩 쌓임.
// 앱은 같은 파일을 고치지 않고 읽기만 하고, 반영한 줄 id 를 db 에 적어 두 번 반영하지 않음.
function applyInboxEntry(c, e) {
  c.followUp = c.followUp || {};
  if (e.type === 'asked') { c.followUp.state = 'asked'; (c.followUp.askedAt = c.followUp.askedAt || []).push(e.at); }
  else if (e.type === 'result') { c.outcomeResult = e.result; c.followUp.state = 'done'; c.outcomeAt = e.at; }
  else if (e.type === 'text') { c.outcome = e.text; c.outcomeAt = e.at; }
  else if (e.type === 'later') { c.followUp = { due: e.due, state: 'waiting' }; }
  else if (e.type === 'stop') { c.followUp.state = 'none'; }
  else if (e.type === 'noanswer') { c.followUp.state = 'noanswer'; }
}
function mergeInbox() {
  const fs = require('node:fs');
  const f = path.join(DATA_DIR, 'inbox.jsonl');
  if (!fs.existsSync(f)) return;
  const applied = new Set(store.db.appliedInbox || []);
  const changed = new Set();
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (!e.id || applied.has(e.id)) continue;
    const c = store.consult(e.consultId);
    if (c) { applyInboxEntry(c, e); changed.add(c.id); }
    applied.add(e.id);
  }
  if (applied.size === (store.db.appliedInbox || []).length) return;
  store.db.appliedInbox = [...applied];
  store.save();
  for (const id of changed) send('consult:update', store.consult(id));
  if (changed.size) send('history:refresh');
}

app.whenReady().then(async () => {
  // 자체 시험: JSDO_SELFTEST=gemini 면 예시 학생으로 제미나이 웹 한 번 돌리고 결과를 파일로 남긴 뒤 끝냄
  if (process.env.JSDO_SELFTEST) {
    const fs = require('node:fs');
    const out = process.env.JSDO_SELFTEST_OUT || path.join(require('node:os').tmpdir(), 'jido_selftest.txt');
    const st = { alias: '민수', gender: '남', grade: '중2', months: '14', scales: { closeness: 4, homework: 2, shy: 4 },
      observation: '수업 중 지목하면 얼굴 빨개짐. 숙제는 3주째 반만 해 옴.' };
    const t0 = Date.now();
    try {
      const raw = await RUNNERS[process.env.JSDO_SELFTEST](buildPrompt(st, { kind: 'motivate', situation: '시험 2주 전 동기부여', options: '' }, []), { geminiShow: !!process.env.JSDO_SHOW });
      let parsed = 'PARSE FAIL';
      try { const d = extractJson(raw); parsed = 'JSON OK ' + Object.keys(d).join(','); } catch (e) { parsed += ' ' + e.message; }
      fs.writeFileSync(out, `${Math.round((Date.now() - t0) / 1000)}s ${parsed}\n${raw}`, 'utf8');
    } catch (e) { fs.writeFileSync(out, 'ERROR ' + e.message, 'utf8'); }
    return app.quit();
  }
  store = new Store(DATA_DIR);

  ipcMain.handle('db:load', () => ({ students: store.db.students, settings: settings(), available: available(), dataDir: DATA_DIR }));
  ipcMain.handle('student:save', (_e, st) => store.upsertStudent(st));
  ipcMain.handle('student:delete', (_e, id) => { store.deleteStudent(id); return true; });
  ipcMain.handle('consult:list', (_e, sid) => store.consultsOf(sid));
  ipcMain.handle('consult:get', (_e, id) => store.consult(id));
  ipcMain.handle('consult:delete', (_e, id) => { store.deleteConsult(id); return true; });
  ipcMain.handle('consult:outcome', (_e, { id, outcome, result }) => store.patchConsult(id, c => {
    c.outcome = outcome; c.outcomeResult = result || ''; c.outcomeAt = new Date().toISOString();
    if (result) c.followUp = { ...(c.followUp || {}), state: 'done' };
  }));
  ipcMain.handle('settings:save', (_e, s) => { store.db.settings = { ...settings(), ...s }; store.save(); return settings(); });
  ipcMain.handle('consult:followup', (_e, { id, due }) => store.patchConsult(id, c => {
    c.followUp = due ? { due, state: 'waiting' } : { ...(c.followUp || {}), state: 'none' };
  }));
  mergeInbox();
  setInterval(mergeInbox, 60000);
  ipcMain.handle('gemini:login', () => { require('./lib/gemini_web').openLoginWindow(win); return true; });
  ipcMain.handle('prompt:preview', (_e, { studentId, request }) => buildPrompt(store.student(studentId), request, store.consultsOf(studentId)));

  // 추천 받기: 세 AI 를 한꺼번에 돌리고, 하나 끝날 때마다 화면에 알림. 다 끝나면 공통 추천을 뽑음.
  ipcMain.handle('consult:run', async (_e, { studentId, request, models }) => {
    const st = store.student(studentId);
    if (!st) throw new Error('학생을 먼저 저장해 주십시오.');
    const history = store.consultsOf(studentId);
    const prompt = buildPrompt(st, request, history);
    const use = (models && models.length ? models : F.MODELS.map(m => m.key));
    const c = {
      id: crypto.randomUUID(), studentId, at: new Date().toISOString(),
      request, snapshot: JSON.parse(JSON.stringify(st)),
      results: Object.fromEntries(F.MODELS.map(m => [m.key, use.includes(m.key) ? { status: 'running' } : { status: 'skipped' }])),
      common: null, outcome: '',
      followUp: { due: F.addDays(F.FOLLOW_DAYS[request.kind] || 7), state: 'waiting' },
    };
    store.addConsult(c);
    Promise.allSettled(use.map(k => runOne(c.id, k, prompt))).then(() => runCommon(c.id));
    return c;
  });

  // 한 AI 만 다시 돌리기
  ipcMain.handle('consult:retry', async (_e, { id, key }) => {
    const c = store.consult(id);
    if (!c) return null;
    const prompt = buildPrompt(c.snapshot, c.request, store.consultsOf(c.studentId).filter(x => x.at < c.at));
    store.patchConsult(id, x => { x.results[key] = { status: 'running' }; x.common = null; });
    runOne(id, key, prompt).then(() => {
      const cur = store.consult(id);
      if (!F.MODELS.some(m => cur.results[m.key].status === 'running')) runCommon(id);
    });
    return store.consult(id);
  });
  ipcMain.handle('consult:common', (_e, id) => { runCommon(id); return true; });

  createWindow();
  if (process.env.JSDO_SHOT) {
    require('./lib/shots')({ win, store, dir: process.env.JSDO_SHOT })
      .catch(e => require('node:fs').writeFileSync(path.join(process.env.JSDO_SHOT, 'error.txt'), String(e.stack || e)))
      .finally(() => app.quit());
  }
});

app.on('window-all-closed', () => app.quit());
