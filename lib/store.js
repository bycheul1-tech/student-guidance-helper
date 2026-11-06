// 기록 저장. 앱 폴더 data\db.json 하나에 학생·상담 기록을 전부 둠.
// 쓸 때마다 임시 파일에 먼저 쓰고 바꿔 끼워서 중간에 꺼져도 파일이 안 깨짐. 직전 판은 db.bak.json.
const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.db = this.read();
  }
  read() {
    for (const f of [this.file, path.join(this.dir, 'db.bak.json')]) {
      try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return { students: [], consults: [], settings: {}, ...d }; } catch {}
    }
    return { students: [], consults: [], settings: {} };
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 1), 'utf8');
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, path.join(this.dir, 'db.bak.json'));
    fs.renameSync(tmp, this.file);
  }
  upsertStudent(st) {
    const now = new Date().toISOString();
    const i = this.db.students.findIndex(s => s.id === st.id);
    if (i < 0) this.db.students.push({ ...st, createdAt: now, updatedAt: now });
    else this.db.students[i] = { ...this.db.students[i], ...st, updatedAt: now };
    this.save();
    return this.db.students.find(s => s.id === st.id);
  }
  deleteStudent(id) {
    this.db.students = this.db.students.filter(s => s.id !== id);
    this.db.consults = this.db.consults.filter(c => c.studentId !== id);
    this.save();
  }
  student(id) { return this.db.students.find(s => s.id === id); }
  consultsOf(id) {
    return this.db.consults.filter(c => c.studentId === id).sort((a, b) => b.at.localeCompare(a.at));
  }
  consult(id) { return this.db.consults.find(c => c.id === id); }
  addConsult(c) { this.db.consults.push(c); this.save(); return c; }
  patchConsult(id, fn) {
    const c = this.consult(id);
    if (!c) return null;
    fn(c);
    this.save();
    return c;
  }
  deleteConsult(id) { this.db.consults = this.db.consults.filter(c => c.id !== id); this.save(); }
}

module.exports = Store;
