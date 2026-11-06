// 학생 정보 칸 정의. 화면(renderer)과 프롬프트(main) 둘 다 이 파일 하나를 씀.
(function (root) {
  const F = {};

  // 1~5 척도. 비워 두면 '모름'으로 보고 AI 에 보내지 않음.
  F.SCALES = [
    { key: 'closeness', label: '선생님과 친한 정도', lo: '어색함', hi: '아주 친함' },
    { key: 'homework', label: '숙제 성실도', lo: '거의 안 함', hi: '늘 해 옴' },
    { key: 'friends', label: '친구 많은 정도', lo: '거의 없음', hi: '아주 많음' },
    { key: 'insider', label: '인싸 정도', lo: '조용한 편', hi: '분위기 주도' },
    { key: 'shy', label: '쑥스러움', lo: '거의 없음', hi: '아주 많음' },
    { key: 'talk', label: '말 많은 정도', lo: '말 거의 안 함', hi: '아주 많음' },
    { key: 'confidence', label: '자존감·자신감', lo: '낮음', hi: '높음' },
    { key: 'focus', label: '수업 중 집중도', lo: '자주 딴짓', hi: '끝까지 집중' },
    { key: 'question', label: '질문 빈도', lo: '안 물어봄', hi: '자주 물어봄' },
    { key: 'mood', label: '감정 기복', lo: '늘 비슷함', hi: '기복 큼' },
    { key: 'compete', label: '경쟁심', lo: '신경 안 씀', hi: '아주 강함' },
    { key: 'busy', label: '학원 밖 일정 부담', lo: '여유 있음', hi: '아주 바쁨' },
    { key: 'parent', label: '학부모 관여도', lo: '거의 없음', hi: '아주 많음' },
    { key: 'scold', label: '혼날 때 반응', lo: '위축됨', hi: '반발함' },
    { key: 'praise', label: '칭찬 받을 때 선호', lo: '따로 조용히', hi: '다 같이 있을 때' },
    { key: 'humor', label: '농담 반응', lo: '진지하게 받음', hi: '농담 잘 받음' },
  ];

  // 하나 고르기
  F.CHOICES = [
    { key: 'level', label: '지금 성적', options: ['상위권', '중위권', '하위권'] },
    { key: 'trend', label: '성적 추이', options: ['오르는 중', '제자리', '떨어지는 중'] },
    { key: 'late', label: '지각·결석', options: ['거의 없음', '가끔', '잦음'] },
  ];

  // 여러 개 고르기
  F.MULTI = [
    { key: 'motive', label: '동기 유형', options: ['성적·점수', '인정·칭찬', '선생님·친구 관계', '재미', '진학 목표'] },
    { key: 'family', label: '가정 상황', options: ['부모님 기대 압박 큼', '맞벌이', '형제와 비교당함', '집이 편하지 않은 상황', '학부모 연락 잘 됨', '학부모 연락 어려움'] },
  ];

  F.GRADES = ['초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3', 'N수'];

  F.KINDS = [
    { key: 'solve', label: '해결책', hint: '숙제 안 함, 지각, 수업 태도 같은 문제를 어떻게 풀지' },
    { key: 'motivate', label: '동기부여 멘트', hint: '시험 전, 성적이 떨어졌을 때, 슬럼프 올 때' },
    { key: 'study', label: '학업 지도', hint: '무엇을 어떤 순서로, 숙제 양·종류, 점검 방법' },
    { key: 'praise', label: '칭찬', hint: '잘한 걸 어떻게 짚어 줄지' },
    { key: 'scold', label: '꾸중·선 긋기', hint: '기분 상하지 않게 선을 긋는 말' },
    { key: 'free', label: '자유', hint: '아무거나 적기' },
  ];

  F.MODELS = [
    { key: 'codex', label: 'Codex' },
    { key: 'gemini', label: 'Gemini' },
    { key: 'claude', label: 'Claude' },
  ];

  // 요청 종류별로 며칠 뒤에 '해 보셨습니까?' 물어볼지 기본값
  F.FOLLOW_DAYS = { motivate: 3, praise: 3, solve: 7, scold: 7, study: 14, free: 7 };
  F.RESULTS = { good: '효과 있음', some: '조금 있음', none: '효과 없음' };
  F.addDays = function (n, from) {
    const d = from ? new Date(from) : new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // 만 나이
  F.age = function (birth, now) {
    if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
    now = now || new Date();
    const [y, m, d] = birth.split('-').map(Number);
    let a = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
    return a >= 0 && a < 100 ? a : null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = F;
  else root.FIELDS = F;
})(this);
