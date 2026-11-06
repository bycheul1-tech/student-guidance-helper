// 세 AI 를 구독 CLI 로 부름 (API 키 안 씀).
//  - Codex  : codex exec  (Codex 앱 로그인)
//  - Gemini : gemini -p   (Google 계정 로그인)
//  - Claude : claude -p   (Claude 구독)
// 프롬프트는 전부 stdin 으로 넘김. 작업 폴더는 임시 폴더라 남의 프로젝트 파일을 안 읽음.
const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const PATHS = (process.env.PATH || '').split(path.delimiter).filter(Boolean);

function firstExisting(list) {
  for (const f of list) if (f && fs.existsSync(f)) return f;
  return null;
}

function findCodex() {
  if (process.platform !== 'win32') return { cmd: 'codex', pre: [] };
  const exe = firstExisting([
    path.join(HOME, '.codex', 'plugins', '.plugin-appserver', 'codex.exe'),
    ...PATHS.map(d => path.join(d, 'codex.exe')),
    path.join(APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.exe'),
  ]);
  if (exe) return { cmd: exe, pre: [] };
  const js = firstExisting([path.join(APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')]);
  return js ? { cmd: 'node', pre: [js] } : null;
}

function findGemini() {
  if (process.platform !== 'win32') return { cmd: 'gemini', pre: [] };
  const js = firstExisting([
    path.join(APPDATA, 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js'),
    path.join(APPDATA, 'npm', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js'),
  ]);
  return js ? { cmd: 'node', pre: [js] } : null;
}

function findClaude() {
  if (process.platform !== 'win32') return { cmd: 'claude', pre: [] };
  const dirs = [...PATHS, path.join(HOME, '.local', 'bin'), path.join(APPDATA, 'npm')];
  const exe = firstExisting(dirs.map(d => path.join(d, 'claude.exe')));
  if (exe) return { cmd: exe, pre: [] };
  const pkg = path.join(APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code');
  const e2 = firstExisting([path.join(pkg, 'bin', 'claude.exe')]);
  if (e2) return { cmd: e2, pre: [] };
  const js = firstExisting([path.join(pkg, 'cli.js')]);
  return js ? { cmd: 'node', pre: [js] } : null;
}

function run(c, args, input, { env, timeoutMs = 360000, label }) {
  return new Promise((resolve, reject) => {
    if (!c) return reject(new Error(`${label} 명령줄 프로그램을 찾지 못했습니다.`));
    const p = spawn(c.cmd, [...c.pre, ...args], { windowsHide: true, cwd: os.tmpdir(), env: env || process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch {} reject(new Error(`${label} 응답 시간 초과`)); }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); reject(new Error(`${label} 실행 실패: ${e.message}`)); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${label} 종료 코드 ${code}: ${cleanErr(err || out)}`));
    });
    p.stdin.end(input, 'utf8');
  });
}

function cleanErr(s) {
  const lines = String(s).split(/\r?\n/).filter(l => l.trim() && !/^\s+at /.test(l) && !/Skill conflict|true color|Ripgrep/i.test(l));
  return lines.slice(-6).join(' / ').slice(0, 500);
}

async function runCodex(prompt, settings) {
  const outFile = path.join(os.tmpdir(), `jido_codex_${process.pid}_${Date.now()}.txt`);
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--output-last-message', outFile];
  if (settings.codexModel) args.push('-m', settings.codexModel);
  args.push('-');
  await run(findCodex(), args, prompt, { label: 'Codex' });
  try { return fs.readFileSync(outFile, 'utf8'); } finally { try { fs.unlinkSync(outFile); } catch {} }
}

async function runGemini(prompt, settings) {
  // 기본: 앱 안 브라우저로 제미나이 웹(구독). 'apikey' 일 때만 CLI + GEMINI_API_KEY.
  if (settings.geminiAuth !== 'apikey') {
    const { askGemini } = require('./gemini_web');
    return askGemini(prompt, { show: !!settings.geminiShow });
  }
  const env = { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: 'true', NO_COLOR: '1' };
  if (settings.geminiAuth !== 'apikey') { delete env.GEMINI_API_KEY; delete env.GOOGLE_API_KEY; }
  const args = ['-p', '아래 입력의 지시를 그대로 따라 JSON 하나만 출력한다.'];
  if (settings.geminiModel) args.push('-m', settings.geminiModel);
  const { out } = await run(findGemini(), args, prompt, { env, label: 'Gemini' });
  return out;
}

const CLAUDE_SYSTEM = '너는 학원 선생님을 돕는 학생 지도 상담가다. 입력의 규칙을 따르고, 요청한 JSON 하나만 출력한다.';

async function runClaude(prompt, settings) {
  const args = ['-p', '--output-format', 'text', '--system-prompt', CLAUDE_SYSTEM,
    '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'];
  if (settings.claudeModel) args.push('--model', settings.claudeModel);
  const { out } = await run(findClaude(), args, prompt, { label: 'Claude' });
  return out;
}

const RUNNERS = { codex: runCodex, gemini: runGemini, claude: runClaude };

function extractJson(text) {
  const t = String(text).replace(/```(?:json)?/g, '');
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('답에서 JSON 을 못 찾음');
  return JSON.parse(t.slice(s, e + 1));
}

function available() {
  return { codex: !!findCodex(), gemini: !!findGemini(), claude: !!findClaude() };
}

module.exports = { RUNNERS, runClaude, extractJson, available };
