/* global FIELDS, api */
const F = FIELDS;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

const S = {
  students: [], cur: null, settings: {}, available: {},
  kind: 'solve', models: ['codex', 'gemini', 'claude'],
  openConsult: null, revealed: new Set(), saveTimer: null,
};

const blank = () => ({ id: uid(), name: '', alias: '', gender: '', grade: '', months: '', mbti: '', birth: '', birthTime: '',
  scales: {}, choices: {}, multi: {}, familyNote: '', studyNote: '', observation: '' });

/* ---------- 학생 목록 ---------- */
function renderList() {
  const q = $('#search').value.trim();
  const list = S.students.filter(s => !q || (s.name || '').includes(q) || (s.alias || '').includes(q))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('#studentList').innerHTML = list.map(s => `<li data-id="${s.id}" class="${S.cur && S.cur.id === s.id ? 'on' : ''}">
    <span>${esc(s.name || '(이름 없음)')}</span><span class="meta">${esc(s.grade || '')}</span></li>`).join('')
    || '<li class="meta" style="cursor:default">아직 학생이 없습니다</li>';
}
$('#studentList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (li) select(S.students.find(s => s.id === li.dataset.id));
});
$('#search').addEventListener('input', renderList);
$('#newStudent').addEventListener('click', async () => {
  const st = blank();
  st.name = '새 학생';
  const saved = await api.saveStudent(st);
  S.students.push(saved);
  select(saved);
  setTimeout(() => { const i = document.querySelector('[data-f="name"]'); i.focus(); i.select(); }, 30);
});

/* ---------- 학생 정보 칸 ---------- */
function buildStatic() {
  $('#gradeSel').innerHTML = '<option value="">모름</option>' + F.GRADES.map(g => `<option>${g}</option>`).join('');
  $('#scales').innerHTML = F.SCALES.map(s => `<div class="scale" data-scale="${s.key}">
    <div class="nm">${esc(s.label)}</div>
    <div class="dots"><span class="end">${esc(s.lo)}</span>
      ${[1, 2, 3, 4, 5].map(n => `<button class="dot" data-v="${n}">${n}</button>`).join('')}
      <span class="end r">${esc(s.hi)}</span></div></div>`).join('');
  $('#choices').innerHTML = F.CHOICES.map(c => `<div class="grp">${esc(c.label)}</div>
    <div class="chips" data-choice="${c.key}">${c.options.map(o => `<span class="chip" data-v="${esc(o)}">${esc(o)}</span>`).join('')}</div>`).join('');
  $('#multis').innerHTML = F.MULTI.map(m => `<div class="grp">${esc(m.label)} <small>여러 개 가능</small></div>
    <div class="chips" data-multi="${m.key}">${m.options.map(o => `<span class="chip" data-v="${esc(o)}">${esc(o)}</span>`).join('')}</div>`).join('');
  $('#kinds').innerHTML = F.KINDS.map(k => `<span class="chip" data-kind="${k.key}">${esc(k.label)}</span>`).join('');
  $('#modelPick').innerHTML = F.MODELS.map(m => `<label><input type="checkbox" data-model="${m.key}" checked> ${m.label}</label>`).join('');
}

function fillForm() {
  const st = S.cur;
  document.querySelectorAll('[data-f]').forEach(el => { el.value = st[el.dataset.f] == null ? '' : st[el.dataset.f]; });
  document.querySelectorAll('[data-scale]').forEach(row => paintScale(row, (st.scales || {})[row.dataset.scale]));
  document.querySelectorAll('[data-choice]').forEach(box => {
    const v = (st.choices || {})[box.dataset.choice];
    box.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.v === v));
  });
  document.querySelectorAll('[data-multi]').forEach(box => {
    const v = (st.multi || {})[box.dataset.multi] || [];
    box.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', v.includes(c.dataset.v)));
  });
  $('#stTitle').textContent = st.name || '학생 정보';
  ageHint();
  fillInfo();
}
function paintScale(row, v) {
  row.querySelectorAll('.dot').forEach(d => {
    const n = +d.dataset.v;
    d.classList.toggle('on', n === v);
    d.classList.toggle('fill', v && n < v);
  });
}
function ageHint() {
  const a = F.age(S.cur.birth);
  $('#ageHint').textContent = a != null ? `만 ${a}세` : '';
}
function fillInfo() {
  const st = S.cur;
  const n = Object.values(st.scales || {}).filter(Boolean).length + Object.values(st.choices || {}).filter(Boolean).length
    + Object.values(st.multi || {}).filter(v => v && v.length).length;
  const obs = (st.observation || '').trim().length;
  $('#fillInfo').textContent = `척도·선택 ${n}개 채움 · 관찰 메모 ${obs}자 — 다 안 채워도 추천은 나옵니다.`;
}

function touch() {
  $('#savedMark').textContent = '저장 중…';
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(async () => {
    const saved = await api.saveStudent(S.cur);
    const i = S.students.findIndex(s => s.id === saved.id);
    if (i >= 0) S.students[i] = saved; else S.students.push(saved);
    S.cur = saved;
    $('#savedMark').textContent = '저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    renderList();
  }, 400);
}

document.addEventListener('input', e => {
  const f = e.target.dataset && e.target.dataset.f;
  if (!f || !S.cur) return;
  S.cur[f] = e.target.value;
  if (f === 'name') $('#stTitle').textContent = e.target.value || '학생 정보';
  if (f === 'birth') ageHint();
  fillInfo();
  touch();
});
document.addEventListener('change', e => {
  const f = e.target.dataset && e.target.dataset.f;
  if (f && S.cur && e.target.tagName === 'SELECT') { S.cur[f] = e.target.value; touch(); }
});

$('#scales').addEventListener('click', e => {
  const d = e.target.closest('.dot'); if (!d) return;
  const row = d.closest('[data-scale]'); const k = row.dataset.scale;
  S.cur.scales = S.cur.scales || {};
  const v = +d.dataset.v;
  S.cur.scales[k] = S.cur.scales[k] === v ? 0 : v;
  if (!S.cur.scales[k]) delete S.cur.scales[k];
  paintScale(row, S.cur.scales[k]); fillInfo(); touch();
});
$('#choices').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  const k = c.parentElement.dataset.choice;
  S.cur.choices = S.cur.choices || {};
  S.cur.choices[k] = S.cur.choices[k] === c.dataset.v ? '' : c.dataset.v;
  c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.dataset.v === S.cur.choices[k]));
  fillInfo(); touch();
});
$('#multis').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  const k = c.parentElement.dataset.multi;
  S.cur.multi = S.cur.multi || {};
  const arr = new Set(S.cur.multi[k] || []);
  arr.has(c.dataset.v) ? arr.delete(c.dataset.v) : arr.add(c.dataset.v);
  S.cur.multi[k] = [...arr];
  c.classList.toggle('on', arr.has(c.dataset.v));
  fillInfo(); touch();
});

$('#delStudent').addEventListener('click', async () => {
  if (!S.cur) return;
  const ok = await confirmBox(`'${S.cur.name}' 학생과 상담 기록을 모두 지울까요?`);
  if (!ok) return;
  await api.deleteStudent(S.cur.id);
  S.students = S.students.filter(s => s.id !== S.cur.id);
  S.cur = null;
  $('#workView').classList.add('hidden'); $('#emptyView').classList.remove('hidden');
  renderList();
});

async function select(st) {
  if (!st) return;
  S.cur = JSON.parse(JSON.stringify(st));
  $('#emptyView').classList.add('hidden'); $('#workView').classList.remove('hidden');
  $('#savedMark').textContent = '';
  fillForm(); renderList(); renderHistory();
  $('#situation').value = ''; $('#options').value = '';
}

/* ---------- 요청 ---------- */
function paintKinds() {
  document.querySelectorAll('[data-kind]').forEach(c => c.classList.toggle('on', c.dataset.kind === S.kind));
  $('#kindHint').textContent = (F.KINDS.find(k => k.key === S.kind) || {}).hint || '';
}
$('#kinds').addEventListener('click', e => {
  const c = e.target.closest('[data-kind]'); if (!c) return;
  S.kind = c.dataset.kind; paintKinds();
});
$('#modelPick').addEventListener('change', () => {
  S.models = [...document.querySelectorAll('[data-model]:checked')].map(x => x.dataset.model);
});
const request = () => ({ kind: S.kind, situation: $('#situation').value, options: $('#options').value });

$('#previewBtn').addEventListener('click', async () => {
  if (!S.cur) return;
  await api.saveStudent(S.cur);
  const txt = await api.previewPrompt(S.cur.id, request());
  showText('AI 에 보낼 글', `<pre>${esc(txt)}</pre>`);
});

$('#runBtn').addEventListener('click', async () => {
  if (!S.cur) return;
  if (!S.models.length) return showText('알림', '<p>AI 를 하나 이상 고르십시오.</p>');
  $('#runBtn').disabled = true;
  try {
    clearTimeout(S.saveTimer);
    S.cur = await api.saveStudent(S.cur);
    const c = await api.run(S.cur.id, request(), S.models);
    openResult(c);
    renderHistory();
  } catch (e) {
    showText('오류', `<p class="err">${esc(e.message)}</p>`);
  } finally { $('#runBtn').disabled = false; }
});

/* ---------- 기록 ---------- */
async function renderHistory() {
  if (!S.cur) return;
  const list = await api.listConsults(S.cur.id);
  $('#historyList').innerHTML = list.map(c => {
    const k = (F.KINDS.find(x => x.key === c.request.kind) || {}).label || '';
    const d = new Date(c.at);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
    const res = [F.RESULTS[c.outcomeResult], c.outcome].filter(Boolean).join(' — ');
    return `<li data-cid="${c.id}"><div class="top"><span class="tag">${esc(k)}</span><span class="stt">${esc(followLabel(c))}</span><span>${when}</span></div>
      <div class="sit">${esc(c.request.situation || '(상황 없이 요청)')}</div>
      ${res ? `<div class="oc">결과: ${esc(res)}</div>` : ''}</li>`;
  }).join('') || '<li style="cursor:default;color:var(--sub)">아직 기록이 없습니다</li>';
}
$('#historyList').addEventListener('click', async e => {
  const li = e.target.closest('[data-cid]'); if (!li) return;
  openResult(await api.getConsult(li.dataset.cid));
});

/* ---------- 결과 모달 ---------- */
function openResult(c) {
  S.openConsult = c;
  const st = c.snapshot || {};
  const k = (F.KINDS.find(x => x.key === c.request.kind) || {}).label || '';
  $('#mTitle').textContent = `${st.name || ''} · ${k}`;
  $('#mSub').textContent = `${new Date(c.at).toLocaleString('ko-KR')} · ${(c.request.situation || '').slice(0, 120)}`;
  $('#outcomeText').value = c.outcome || '';
  $('#outcomeResult').value = c.outcomeResult || '';
  paintFollow();
  renderCards();
  $('#resultModal').classList.remove('hidden');
}

function list(arr, fn) {
  return arr && arr.length ? `<ul>${arr.map(x => `<li>${fn ? fn(x) : esc(x)}</li>`).join('')}</ul>` : '';
}

function bodyOf(key, r) {
  if (!r || r.status === 'skipped') return '<p style="color:var(--sub)">이번엔 고르지 않았습니다.</p>';
  if (r.status === 'running') return '<div class="loading"><span class="spin"></span>생각하는 중… (보통 30초~2분)</div>';
  if (r.status === 'error') return `<p class="err">${esc(r.error)}</p>${hintFor(key, r.error)}<button class="btn small" data-retry="${key}">다시 받기</button>`;
  const d = r.data;
  if (!d) return `<p class="err">모양이 맞지 않는 답이 와서 그대로 보여 드립니다.</p><div class="raw">${esc(r.raw)}</div><button class="btn small" data-retry="${key}">다시 받기</button>`;
  let h = '';
  if (d.safety) h += `<div class="safety">⚠ ${esc(d.safety)}</div>`;
  if (d.summary) h += `<h4>판단</h4><p>${esc(d.summary)}</p>`;
  if (d.approach && d.approach.length) h += `<h4>이렇게 해 보십시오</h4>` + list(d.approach, a => `<b>${esc(a.how)}</b><br>${esc(a.when)}${a.why ? `<br><small>${esc(a.why)}</small>` : ''}`);
  if (d.ments && d.ments.length) h += `<h4>멘트</h4>` + d.ments.map(m => `<div class="ment"><button class="cp" data-copy="${esc(m.text)}">복사</button>
      <div class="say">${esc(m.text)}</div><div class="meta">${esc(m.channel || '')}${m.when ? ' · ' + esc(m.when) : ''}</div></div>`).join('');
  if (d.study && d.study.length) h += `<h4>학업 지도</h4>` + list(d.study);
  if (d.options && d.options.length) h += `<h4>생각 중인 방법 평가</h4>` + d.options.map(o => `<div class="opt">
      <span class="verdict v-${esc((o.verdict || '').trim())}">${esc(o.verdict)}</span><b>${esc(o.option)}</b>
      <div>${esc(o.why)}</div>${o.how ? `<div><small>${esc(o.how)}</small></div>` : ''}</div>`).join('');
  if (d.avoid && d.avoid.length) h += `<h4>피할 것</h4>` + list(d.avoid);
  if (d.watch && d.watch.length) h += `<h4>지켜볼 점</h4>` + list(d.watch);
  if (d.notes && d.notes.length) h += `<div class="notes"><b>참고 메모</b>${list(d.notes)}</div>`;
  return h;
}

function hintFor(key, msg) {
  if (key === 'gemini' && /로그인|입력창|auth|login/i.test(msg))
    return '<p><small>왼쪽 아래 설정 → 제미나이 로그인 창 열기에서 구독 계정으로 로그인한 뒤 다시 받기를 누르십시오.</small></p>';
  if (key === 'codex' && /login|auth/i.test(msg)) return '<p><small>Codex 앱에 로그인돼 있는지 확인하십시오.</small></p>';
  return '';
}

function commonBody(c) {
  const done = F.MODELS.filter(m => c.results[m.key] && c.results[m.key].status === 'done').length;
  const running = F.MODELS.some(m => c.results[m.key] && c.results[m.key].status === 'running');
  const cm = c.common;
  if (!S.revealed.has(c.id)) {
    const ready = cm && cm.status === 'done';
    const sub = ready ? '눌러서 세 답의 공통 추천 보기'
      : running ? `세 답을 기다리는 중 (${done}/${S.models.length || 3})`
      : cm && cm.status === 'running' ? '공통 추천 정리 중…'
      : cm && cm.status === 'error' ? '정리 실패 — 눌러서 보기' : '준비 중';
    return `<button class="qbtn" data-reveal ${ready || (cm && cm.status === 'error') ? '' : 'disabled'}><span class="q">?</span><span class="qs">${sub}</span></button>`;
  }
  if (!cm || cm.status === 'running') return '<div class="loading"><span class="spin"></span>정리 중…</div>';
  if (cm.status === 'error') return `<p class="err">${esc(cm.error)}</p><button class="btn small" data-common>다시 정리</button>`;
  let h = '';
  if (cm.first_step) h += `<h4>오늘 바로 할 한 가지</h4><div class="first">${esc(cm.first_step)}</div>`;
  if (cm.ment) h += `<h4>골라 둔 멘트</h4><div class="ment"><button class="cp" data-copy="${esc(cm.ment)}">복사</button><div class="say">${esc(cm.ment)}</div></div>`;
  if (cm.same && cm.same.length) h += `<h4>공통으로 나온 추천</h4>` + list(cm.same, s => `${esc(s.point)} <span class="who">${esc((s.who || []).join('·'))}</span>`);
  if (cm.differ && cm.differ.length) h += `<h4>서로 다른 의견</h4>` + list(cm.differ, s => `<b>${esc(s.point)}</b><br><small>${esc(s.views)}</small>`);
  return h;
}

function renderCards() {
  const c = S.openConsult; if (!c) return;
  const cards = F.MODELS.map(m => {
    const r = c.results[m.key] || {};
    const t = r.ms ? `${Math.round(r.ms / 1000)}초` : '';
    return `<div class="rc ${m.key}"><div class="rh"><b>${m.label}</b><span>${t}</span></div><div class="rb">${bodyOf(m.key, r)}</div></div>`;
  });
  cards.push(`<div class="rc common"><div class="rh"><b>공통 추천</b><span></span></div><div class="rb" style="display:flex;flex-direction:column">${commonBody(c)}</div></div>`);
  // 스크롤 위치 지키기
  const tops = [...document.querySelectorAll('#cards4 .rb')].map(x => x.scrollTop);
  $('#cards4').innerHTML = cards.join('');
  document.querySelectorAll('#cards4 .rb').forEach((x, i) => { x.scrollTop = tops[i] || 0; });
}

$('#cards4').addEventListener('click', async e => {
  const cp = e.target.closest('[data-copy]');
  if (cp) { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = '복사됨'; setTimeout(() => { cp.textContent = '복사'; }, 1200); return; }
  if (e.target.closest('[data-reveal]')) { S.revealed.add(S.openConsult.id); return renderCards(); }
  const rt = e.target.closest('[data-retry]');
  if (rt) { S.openConsult = await api.retry(S.openConsult.id, rt.dataset.retry); return renderCards(); }
  if (e.target.closest('[data-common]')) { await api.rerunCommon(S.openConsult.id); }
});

api.onUpdate(c => {
  if (S.openConsult && S.openConsult.id === c.id) {
    const ocChanged = c.outcome !== S.openConsult.outcome || c.outcomeResult !== S.openConsult.outcomeResult;
    S.openConsult = c; renderCards(); paintFollow();
    if (ocChanged) { $('#outcomeText').value = c.outcome || ''; $('#outcomeResult').value = c.outcomeResult || ''; }
  }
});
api.onHistory(() => renderHistory());

function followLabel(c) {
  const f = c.followUp || {};
  const md = d => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '';
  if (c.outcomeResult) return '기록됨';
  return { waiting: `${md(f.due)}에 물어봄`, asked: '물어봄 · 답 기다림', noanswer: '두 번 물었는데 답 없음', none: '안 물어봄', done: '기록됨' }[f.state] || '';
}
function paintFollow() {
  const c = S.openConsult; if (!c) return;
  const f = c.followUp || {};
  $('#fuState').textContent = followLabel(c);
  $('#fuDate').value = f.state === 'waiting' ? f.due || '' : '';
  document.querySelectorAll('[data-days]').forEach(x => {
    const d = +x.dataset.days;
    x.classList.toggle('on', d === 0 ? f.state === 'none' : f.state === 'waiting' && f.due === F.addDays(d, c.at));
  });
}
async function setFollow(due) {
  S.openConsult = await api.setFollowUp(S.openConsult.id, due);
  paintFollow(); renderHistory();
}
document.querySelector('.fu').addEventListener('click', e => {
  const x = e.target.closest('[data-days]'); if (!x || !S.openConsult) return;
  const d = +x.dataset.days;
  setFollow(d ? F.addDays(d, S.openConsult.at) : null);
});
$('#fuDate').addEventListener('change', e => { if (e.target.value) setFollow(e.target.value); });

$('#outcomeSave').addEventListener('click', async () => {
  if (!S.openConsult) return;
  S.openConsult = await api.saveOutcome(S.openConsult.id, $('#outcomeText').value, $('#outcomeResult').value);
  paintFollow();
  $('#outcomeSave').textContent = '저장됨';
  setTimeout(() => { $('#outcomeSave').textContent = '결과 저장'; }, 1200);
  renderHistory();
});

/* ---------- 공통 모달 ---------- */
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('modal')) {
    e.target.closest('.modal').classList.add('hidden');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
});
function showText(title, html) {
  $('#tTitle').textContent = title;
  $('#tBody').innerHTML = html;
  $('#textModal').classList.remove('hidden');
}
function confirmBox(msg) {
  return new Promise(res => {
    showText('확인', `<p>${esc(msg)}</p><div class="row"><button class="btn danger" id="cfYes">지우기</button><button class="btn" id="cfNo">취소</button></div>`);
    $('#cfYes').onclick = () => { $('#textModal').classList.add('hidden'); res(true); };
    $('#cfNo').onclick = () => { $('#textModal').classList.add('hidden'); res(false); };
  });
}

/* ---------- 설정 ---------- */
$('#openSettings').addEventListener('click', () => {
  const s = S.settings, a = S.available;
  const ok = k => a[k] ? '<span class="okx ok">찾음</span>' : '<span class="okx no">못 찾음</span>';
  showText('설정', `
    <div class="setrow"><span class="lbl">Codex ${ok('codex')}</span><input id="setCodex" placeholder="모델 (비우면 기본)" value="${esc(s.codexModel)}"></div>
    <div class="setrow"><span class="lbl">Gemini 방식</span><select id="setGAuth">
      <option value="login" ${s.geminiAuth !== 'apikey' ? 'selected' : ''}>제미나이 웹 (구독 계정)</option>
      <option value="apikey" ${s.geminiAuth === 'apikey' ? 'selected' : ''}>CLI + GEMINI_API_KEY</option></select></div>
    <div class="setrow"><span class="lbl">제미나이 로그인</span><div class="row"><button class="btn small" id="gLogin">로그인 창 열기</button>
      <label style="flex-direction:row;align-items:center;gap:5px"><input type="checkbox" id="setGShow" ${s.geminiShow ? 'checked' : ''}> 작업 창 보이기</label></div></div>
    <div class="setrow"><span class="lbl">Gemini 모델 <small>API 키 방식만</small></span><input id="setGemini" placeholder="비우면 기본" value="${esc(s.geminiModel)}"></div>
    <div class="setrow"><span class="lbl">Claude ${ok('claude')}</span><input id="setClaude" placeholder="모델 (비우면 기본, 예: opus)" value="${esc(s.claudeModel)}"></div>
    <p><small>기록 저장 위치: ${esc(S.dataDir)}</small></p>
    <button class="btn primary" id="setSave">저장</button>`);
  $('#gLogin').onclick = () => api.geminiLogin();
  $('#setSave').onclick = async () => {
    S.settings = await api.saveSettings({
      geminiShow: $('#setGShow').checked,
      codexModel: $('#setCodex').value.trim(), geminiModel: $('#setGemini').value.trim(),
      claudeModel: $('#setClaude').value.trim(), geminiAuth: $('#setGAuth').value,
    });
    $('#textModal').classList.add('hidden');
  };
});

/* ---------- 시작 ---------- */
(async () => {
  buildStatic(); paintKinds();
  const d = await api.load();
  S.students = d.students; S.settings = d.settings; S.available = d.available; S.dataDir = d.dataDir;
  renderList();
})();
