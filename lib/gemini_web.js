// 제미나이는 CLI 로 개인 구독 로그인이 막혀서(2026-11), 앱 안의 숨은 브라우저로 gemini.google.com 에
// 질문을 넣고 답을 읽어 온다. 로그인은 설정의 '제미나이 로그인 창'에서 한 번 하면 계속 남음.
// 구글이 화면을 바꾸면 아래 SEL 만 고치면 됨.
const { BrowserWindow, session } = require('electron');

const PARTITION = 'persist:jido-gemini';
const URL = 'https://gemini.google.com/app';

const SEL = {
  input: ['rich-textarea div[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
  send: ['button.send-button', 'button[aria-label="메시지 보내기"]', 'button[aria-label="Send message"]', 'button[aria-label*="보내기"]'],
  stop: ['button[aria-label*="중지"]', 'button[aria-label*="Stop"]', 'button.send-button.stop'],
  answer: ['model-response message-content', 'message-content', '.model-response-text', 'model-response'],
  login: ['a[href*="accounts.google.com/ServiceLogin"]', 'a[href*="accounts.google.com"][aria-label*="로그인"]', 'a[href*="accounts.google.com"][aria-label*="Sign in"]'],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function ses() {
  const s = session.fromPartition(PARTITION);
  // 'Electron' 글자가 있으면 구글 로그인이 막혀서 보통 크롬처럼 보이게 함
  s.setUserAgent(s.getUserAgent().replace(/ (Electron|jido-helper)\/\S+/g, ''));
  return s;
}

const q = (sels, last) => `(${JSON.stringify(sels)}).map(s => { const a = [...document.querySelectorAll(s)]; return ${last ? 'a[a.length-1]' : 'a[0]'}; }).find(Boolean)`;

function openLoginWindow(parent) {
  const w = new BrowserWindow({ width: 1100, height: 850, parent, title: '제미나이 로그인 — 로그인 끝나면 이 창을 닫으십시오', webPreferences: { session: ses() } });
  w.setMenuBarVisibility(false);
  w.loadURL(URL);
  return w;
}

async function waitFor(wc, sels, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await wc.executeJavaScript(`!!${q(sels)}`).catch(() => false);
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

async function askGemini(prompt, { timeoutMs = 300000, show = false } = {}) {
  const win = new BrowserWindow({ width: 1200, height: 900, show, title: 'Gemini 작업', webPreferences: { session: ses(), backgroundThrottling: false } });
  try {
    await win.loadURL(URL);
    const wc = win.webContents;
    if (!(await waitFor(wc, SEL.input, 25000))) {
      const needLogin = await wc.executeJavaScript(`!!${q(SEL.login)} || location.host.includes('accounts.google.com')`).catch(() => false);
      throw new Error(needLogin ? '제미나이에 로그인돼 있지 않습니다. 설정 → 제미나이 로그인 창에서 로그인해 주십시오.'
        : '제미나이 입력창을 못 찾았습니다. 설정 → 제미나이 로그인 창을 열어 화면을 확인해 주십시오.');
    }
    const before = await wc.executeJavaScript(`document.querySelectorAll(${JSON.stringify(SEL.answer[1])}).length`).catch(() => 0);
    await wc.executeJavaScript(`(() => {
      const el = ${q(SEL.input)};
      el.focus();
      document.execCommand('insertText', false, ${JSON.stringify(prompt)});
    })()`);
    await sleep(800);
    const sent = await wc.executeJavaScript(`(() => {
      const b = ${JSON.stringify(SEL.send)}.map(s => document.querySelector(s)).find(x => x && !x.disabled);
      if (b) { b.click(); return true; } return false;
    })()`);
    if (!sent) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      wc.sendInputEvent({ type: 'char', keyCode: '\r' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }
    // 새 답이 생기고, 멈춤 단추가 사라지고, 글이 세 번 연속 그대로면 끝난 것으로 봄
    let last = '', same = 0;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await sleep(2000);
      const st = await wc.executeJavaScript(`(() => {
        const all = document.querySelectorAll(${JSON.stringify(SEL.answer[1])});
        const el = ${q(SEL.answer, true)};
        return { n: all.length, text: el ? el.innerText : '', busy: !!${q(SEL.stop)} };
      })()`).catch(() => ({ n: 0, text: '', busy: true }));
      if (st.n <= before || !st.text.trim()) { same = 0; continue; }
      if (!st.busy && st.text === last) { if (++same >= 2) return st.text; } else same = 0;
      last = st.text;
    }
    if (last.trim()) return last;
    throw new Error('제미나이에서 5분 안에 답이 안 나왔습니다.');
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { askGemini, openLoginWindow };
