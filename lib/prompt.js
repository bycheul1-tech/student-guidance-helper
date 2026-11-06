// AI 에 보낼 글 만들기. 채운 칸만 보내고, 빈 칸은 '모름'으로 둠.
const F = require('./fields');

function scaleText(s, v) {
  return `${s.label}: ${v}/5 (1=${s.lo}, 5=${s.hi})`;
}

function profileText(st) {
  const L = [];
  const who = (st.alias && st.alias.trim()) || '학생';
  L.push(`호칭: ${who}`);
  if (st.gender) L.push(`성별: ${st.gender}`);
  if (st.grade) L.push(`학년: ${st.grade}`);
  const age = F.age(st.birth);
  if (age != null) L.push(`나이: 만 ${age}세`);
  if (st.months) L.push(`재원 기간: ${st.months}개월`);

  const scales = F.SCALES.filter(s => st.scales && st.scales[s.key]).map(s => '- ' + scaleText(s, st.scales[s.key]));
  if (scales.length) L.push('', '[척도]', ...scales);

  const ch = F.CHOICES.filter(c => st.choices && st.choices[c.key]).map(c => `- ${c.label}: ${st.choices[c.key]}`);
  const mu = F.MULTI.filter(m => st.multi && st.multi[m.key] && st.multi[m.key].length)
    .map(m => `- ${m.label}: ${st.multi[m.key].join(', ')}`);
  if (ch.length || mu.length) L.push('', '[선택 항목]', ...ch, ...mu);
  if (st.familyNote && st.familyNote.trim()) L.push(`- 가정 상황 메모: ${st.familyNote.trim()}`);

  if (st.studyNote && st.studyNote.trim()) L.push('', '[학업 상태 메모]', st.studyNote.trim());
  if (st.observation && st.observation.trim()) L.push('', '[선생님 관찰 메모]', st.observation.trim());

  const ref = [];
  if (st.mbti) ref.push(`MBTI: ${st.mbti.toUpperCase()}`);
  if (st.birth) ref.push(`생년월일: ${st.birth}${st.birthTime ? ' ' + st.birthTime : ''} (사주 참고용)`);
  if (ref.length) L.push('', '[참고만 할 것]', ...ref.map(x => '- ' + x));

  const filled = scales.length + ch.length + mu.length;
  if (filled < 3 && !(st.observation || '').trim()) L.push('', '(정보가 적게 들어왔음. 있는 정보만으로 답하고, 더 알면 좋을 것은 watch 에 적을 것)');
  return L.join('\n');
}

function historyText(history) {
  if (!history || !history.length) return '';
  const L = ['', '[지난 상담 기록 — 최근 것부터]'];
  for (const h of history.slice(0, 3)) {
    const kind = (F.KINDS.find(k => k.key === h.request.kind) || {}).label || '';
    let line = `- ${h.at.slice(0, 10)} ${kind}: ${(h.request.situation || '').slice(0, 150)}`;
    const pick = h.common && h.common.first_step;
    if (pick) line += ` / 그때 추천: ${pick}`;
    const res = h.outcomeResult && F.RESULTS[h.outcomeResult];
    if (res || (h.outcome && h.outcome.trim())) line += ` / 해 본 결과: ${[res, (h.outcome || '').trim()].filter(Boolean).join(' — ')}`;
    L.push(line);
  }
  return L.join('\n');
}

const RULES = `너는 학원 선생님을 돕는 학생 지도 상담가다. 선생님이 적은 학생 정보와 이번 요청을 보고, 선생님이 실제로 해 볼 수 있는 방법과 말을 추천한다.

판단 규칙
1. 근거는 선생님 관찰 메모, 척도, 선택 항목, 지난 상담 기록이다. 비어 있는 항목은 모르는 것으로 두고 추측으로 채우지 않는다. 정보가 적어도 있는 정보로 끝까지 답을 낸다.
2. MBTI와 생년월일(사주)은 참고만 한다. 말투나 표현을 고를 때만 살짝 쓰고, 추천 방향을 정하는 근거로 쓰지 않는다. 사주 풀이를 따로 길게 쓰지 않는다.
3. 관찰과 MBTI·사주가 서로 안 맞거나, 관찰끼리 앞뒤가 안 맞으면 notes 에 적는다. 관찰을 바꾸지 말고 '한번 확인해 보시면 좋겠습니다' 정도의 조언으로만 쓰고, 그 메모 끝에 '위 추천은 선생님 관찰 기준으로 썼습니다'를 붙인다. 안 맞는 게 없으면 notes 는 빈 배열로 둔다.
4. 친한 정도, 재원 기간, 성별, 학년, 나이, 가정 상황, 성격에 따라 방식과 멘트를 바꾼다. 예를 들어 친하고 오래 다닌 학생이면 장난 섞어 직설로 말해도 되고, 들어온 지 얼마 안 됐거나 어색하면 짧고 정중하게 말한다. 혼나면 위축되는 학생은 따로 조용히, 공개 칭찬을 싫어하면 개인 메시지로 한다. 부모님 기대 압박이 크면 성적 얘기를 줄이고, 형제와 비교당하면 비교하는 말을 빼고, 집이 편하지 않으면 집 얘기를 꺼내지 않는다.
5. 방법은 이 학생에게 맞는 것을 골라 구체적으로 쓴다. 고를 수 있는 것: 수업 끝나고 따로 짧게 얘기, 작은 선물(간식·스티커 등)과 함께 넌지시, 숙제 추가, 숙제를 줄여 주고 조금만 확실히 하게 하기, 카톡 개인 메시지, 쪽지, 수업 중 한마디, 역할 맡기기, 학부모 연락 등. 각 방법에 언제, 어디서, 얼마나를 적는다.
6. 학업 지도 조언은 무엇을 어떤 순서로 할지, 숙제 양과 종류, 수업 중에 시킬 것, 점검 방법과 주기를 구체적으로 쓴다.
7. 선생님이 '생각 중인 방법'을 적었으면 하나씩 평가한다: 추천 / 조건부 / 비추천 중 하나, 이유, 한다면 어떻게 할지. 없으면 options 는 빈 배열.
8. 학생에게 하는 멘트(ments 의 text)는 선생님이 그 학생에게 실제로 말하듯 쓴다. 나머지 선생님에게 하는 설명은 문장 끝을 '-니다' 또는 짧은 메모면 '-임·-함'으로 쓰고 '-요'로 끝내지 않는다. 쉬운 낱말로 말하듯 쓰고, '핵심은 ~이다' 같은 선언, 비유, 'A가 아니라 B' 대구, 구호 같은 말은 쓰지 않는다. 낫표는 쓰지 않고 작은따옴표를 쓴다.
9. 학대, 자해, 심한 우울이 의심되는 내용이 있으면 safety 에 적고 학부모·전문 기관 연락을 권한다. 없으면 빈 문자열.

출력: 아래 모양의 JSON 하나만 출력한다. 설명, 코드 울타리, 다른 글은 붙이지 않는다.
{
  "summary": "이 학생과 이번 상황에 대한 판단 두세 문장",
  "approach": [ { "how": "방법 이름", "when": "언제·어디서·얼마나", "why": "이 학생에게 맞는 이유" } ],
  "ments": [ { "text": "학생에게 할 말 그대로", "when": "언제 쓰는지", "channel": "직접 | 카톡 | 쪽지 | 선물과 함께" } ],
  "study": [ "학업 지도 조언 한 항목씩" ],
  "options": [ { "option": "선생님이 적은 방법", "verdict": "추천 | 조건부 | 비추천", "why": "이유", "how": "한다면 어떻게" } ],
  "avoid": [ "하지 말아야 할 말이나 행동" ],
  "watch": [ "1~2주 동안 지켜볼 점, 더 알면 좋을 정보" ],
  "notes": [ "참고 메모" ],
  "safety": ""
}`;

const EMPHASIS = {
  solve: 'approach 를 2~4개로 자세히 쓰고, ments 는 2~3개.',
  motivate: 'ments 를 4~6개로 쓰고, 각각 언제·어떤 경로로 쓰는지 붙인다. approach 는 1~2개.',
  study: 'study 를 5~8개로 자세히 쓴다(순서, 숙제 양·종류, 수업 중 할 것, 점검). approach·ments 는 짧게.',
  praise: 'ments 를 3~5개, 칭찬할 때 무엇을 콕 집어 말할지 approach 에 쓴다.',
  scold: 'ments 를 3~4개, 선을 긋되 관계가 상하지 않게 하는 순서를 approach 에 쓴다. avoid 를 꼭 채운다.',
  free: '요청에 맞게 칸을 골라 채운다.',
};

function buildPrompt(student, request, history) {
  const kind = F.KINDS.find(k => k.key === request.kind) || F.KINDS[0];
  const opts = (request.options || '').split('\n').map(s => s.trim()).filter(Boolean);
  const L = [RULES, '', '=== 학생 정보 ===', profileText(student), historyText(history), '',
    '=== 이번 요청 ===', `종류: ${kind.label}`, `이번 요청에서 무게를 둘 것: ${EMPHASIS[kind.key]}`];
  if (request.situation && request.situation.trim()) L.push('', '[지금 상황·하고 싶은 것]', request.situation.trim());
  if (opts.length) L.push('', '[선생님이 생각 중인 방법]', ...opts.map((o, i) => `${i + 1}. ${o}`));
  L.push('', '위 규칙대로 JSON 하나만 출력할 것.');
  return L.join('\n');
}

const COMMON_RULES = `학생 지도 추천 세 개(Codex, Gemini, Claude)를 비교해서 정리한다.
- same: 두 곳 이상에서 같이 나온 추천. 각 항목에 누가 말했는지 적는다.
- differ: 서로 다르게 말한 부분과 각자의 의견.
- first_step: 선생님이 오늘이나 다음 수업에 바로 할 한 가지. 세 답에서 겹치는 것 중에 고른다.
- ment: 세 답에서 가장 쓸 만한 학생용 멘트 하나(그대로 옮기거나 다듬기).
선생님에게 하는 설명은 문장 끝을 '-니다' 또는 '-임·-함'으로 쓰고 '-요'로 끝내지 않는다. 낫표는 쓰지 않는다.
출력은 아래 JSON 하나만:
{ "same": [ { "point": "", "who": ["Codex","Gemini","Claude"] } ], "differ": [ { "point": "", "views": "" } ], "first_step": "", "ment": "" }`;

function buildCommonPrompt(results) {
  const parts = [COMMON_RULES, ''];
  for (const m of F.MODELS) {
    const r = results[m.key];
    if (r && r.status === 'done') parts.push(`=== ${m.label} ===`, JSON.stringify(r.data || r.raw).slice(0, 8000), '');
  }
  return parts.join('\n');
}

module.exports = { buildPrompt, buildCommonPrompt, profileText };
