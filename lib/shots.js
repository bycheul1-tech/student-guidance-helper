// 소개용 화면 사진 찍기 (JSDO_SHOT=<저장 폴더>, JSDO_DATA=<시험용 기록 폴더> 로 켰을 때만).
// 가짜 학생 한 명으로 실제 추천을 받아 화면을 찍는다. 실제 기록은 건드리지 않음.
const fs = require('node:fs');
const path = require('node:path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEMO = {
  id: 'demo-1', name: '김지우', alias: '지우', gender: '남', grade: '중2', months: '14', mbti: 'ISFP', birth: '2012-05-03', birthTime: '',
  scales: { closeness: 4, homework: 2, friends: 4, insider: 3, shy: 4, talk: 2, confidence: 2, focus: 3, scold: 2, praise: 1, humor: 4 },
  choices: { level: '중위권', trend: '떨어지는 중', late: '거의 없음' },
  multi: { motive: ['인정·칭찬', '선생님·친구 관계'], family: ['형제와 비교당함'] },
  familyNote: '', studyNote: '단어 시험은 80점대인데 문법 서술형에서 막힘. 긴 문장 해석을 어려워함.',
  observation: '쉬는 시간엔 친구들이랑 잘 떠드는데 수업 중에 지목하면 얼굴이 빨개짐. 숙제는 3주째 반만 해 옴. 칭찬하면 표정이 확 밝아짐.',
};
const REQ = {
  situation: '숙제를 3주째 반만 해 와서 습관을 잡아 주고 싶음. 혼내면 위축될 것 같아서 고민.',
  options: '숙제를 절반으로 줄여 주고 대신 다 해 오게 하기\n수업 끝나고 따로 불러서 얘기하기\n간식 하나 주면서 넌지시 말하기',
};

async function shoot(win, dir, name) {
  await sleep(600);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(dir, name), img.toPNG());
}

module.exports = async function runShots({ win, store, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const js = code => win.webContents.executeJavaScript(code, true);
  if (!store.student(DEMO.id)) store.upsertStudent(DEMO);
  win.setSize(1500, 960);
  await win.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await sleep(1200);
  await js(`document.querySelector('li[data-id="demo-1"]').click()`);
  await sleep(500);
  await js(`(() => {
    document.querySelector('[data-kind="solve"]').click();
    document.querySelector('#situation').value = ${JSON.stringify(REQ.situation)};
    document.querySelector('#options').value = ${JSON.stringify(REQ.options)};
  })()`);
  await shoot(win, dir, '01_학생정보_입력.png');
  await js(`document.querySelector('#formCol').scrollTop = 470`);
  await shoot(win, dir, '02_척도_선택항목.png');
  await js(`document.querySelector('#formCol').scrollTop = 0`);

  // 기록이 이미 있으면 그걸 쓰고, 없으면 실제로 추천을 받음
  let c = store.consultsOf(DEMO.id)[0];
  if (!c || !c.common || c.common.status !== 'done') {
    await js(`document.querySelector('#runBtn').click()`);
    await sleep(4000);
    await shoot(win, dir, '03_추천_받는_중.png');
    const end = Date.now() + 8 * 60000;
    while (Date.now() < end) {
      await sleep(3000);
      c = store.consultsOf(DEMO.id)[0];
      if (c && c.common && (c.common.status === 'done' || c.common.status === 'error')) break;
    }
    await sleep(1500);
  } else {
    await js(`document.querySelector('#historyList li[data-cid]').click()`);
    await sleep(800);
  }
  await shoot(win, dir, '04_세_AI_추천.png');
  await js(`document.querySelectorAll('#cards4 .rb').forEach(x => { x.scrollTop = x.scrollHeight * 0.45; })`);
  await shoot(win, dir, '05_추천_아래쪽.png');
  await js(`document.querySelectorAll('#cards4 .rb').forEach(x => { x.scrollTop = 0; }); const q = document.querySelector('[data-reveal]'); if (q) q.click();`);
  await shoot(win, dir, '06_공통추천_물음표_열기.png');
  await js(`document.querySelector('#resultModal').classList.add('hidden'); document.querySelector('#openSettings').click();`);
  await shoot(win, dir, '07_설정.png');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(store.consultsOf(DEMO.id)[0], null, 1), 'utf8');
};
