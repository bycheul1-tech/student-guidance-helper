# -*- coding: utf-8 -*-
"""학생지도도우미 후속 확인 봇.

상담 기록(data/db.json)에서 '다시 물어볼 날'이 된 것을 골라 텔레그램으로
'해 보셨습니까?'를 묻고, 답을 data/inbox.jsonl 에 한 줄씩 남긴다. 앱이 켜지면 그 줄을 합친다.
db.json 은 읽기만 한다(앱과 동시에 고치지 않으려고).

- 첫 질문: 물어볼 날 밤 10시(ASK_FIRST). 답이 없으면 다음 날 오후 2시(ASK_SECOND)에 한 번 더.
  두 번 다 답이 없으면 '답 없음'으로 기록하고 그만 묻는다.
- 여러 명이면 한 명씩: 답하면 다음 학생 질문이 온다.
- PC 가 그 시각에 꺼져 있었으면 켜진 뒤 3시간 안에는 늦게라도 묻는다.

실행: pythonw followup_bot.py            (계속 켜 두는 판, 시작프로그램에 등록)
      python  followup_bot.py --once-now (지금 물어볼 것 바로 묻고 30초 받기 — 시험용)
설정: 같은 폴더 .env 에 TELEGRAM_TOKEN=, OWNER_ID=, ASK_FIRST=22:00, ASK_SECOND=14:00
"""
import json
import os
import sys
import time
import uuid
import traceback
from datetime import datetime, timedelta, date
from pathlib import Path

import requests

BASE = Path(__file__).resolve().parent
DATA = Path(os.environ.get('JSDO_DATA') or (BASE / 'data'))
DB = DATA / 'db.json'
INBOX = DATA / 'inbox.jsonl'
STATE = DATA / 'bot_state.json'
LOG = DATA / 'bot.log'

KINDS = {'solve': '해결책', 'motivate': '동기부여 멘트', 'study': '학업 지도', 'praise': '칭찬', 'scold': '꾸중·선 긋기', 'free': '자유'}
RESULTS = {'good': '✅ 효과 있음', 'some': '🔸 조금 있음', 'none': '❌ 효과 없음'}
CATCHUP_HOURS = 3


def load_env():
    env = {}
    f = BASE / '.env'
    if f.exists():
        for line in f.read_text(encoding='utf-8').splitlines():
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env


ENV = load_env()
TOKEN = ENV.get('TELEGRAM_TOKEN', '')
OWNER = str(ENV.get('OWNER_ID', ''))
ASK_FIRST = ENV.get('ASK_FIRST', '22:00')
ASK_SECOND = ENV.get('ASK_SECOND', '14:00')
API = f'https://api.telegram.org/bot{TOKEN}/'


def log(*a):
    DATA.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(datetime.now().strftime('%m-%d %H:%M:%S ') + ' '.join(str(x) for x in a) + '\n')


def tg(method, **params):
    r = requests.post(API + method, json=params, timeout=40)
    j = r.json()
    if not j.get('ok'):
        raise RuntimeError(f'{method} 실패: {j.get("description")}')
    return j['result']


# ---------------- 기록 읽기 ----------------
def read_json(p, default):
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return default


def inbox_entries():
    out = []
    if INBOX.exists():
        for line in INBOX.read_text(encoding='utf-8').splitlines():
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def write_inbox(consult_id, type_, **kw):
    DATA.mkdir(parents=True, exist_ok=True)
    e = {'id': str(uuid.uuid4()), 'consultId': consult_id, 'at': datetime.now().isoformat(timespec='seconds'), 'type': type_, **kw}
    with open(INBOX, 'a', encoding='utf-8') as f:
        f.write(json.dumps(e, ensure_ascii=False) + '\n')


def apply(c, e):
    """main.js applyInboxEntry 와 같은 규칙."""
    fu = c.setdefault('followUp', {})
    t = e['type']
    if t == 'asked':
        fu['state'] = 'asked'
        fu.setdefault('askedAt', []).append(e['at'])
    elif t == 'result':
        c['outcomeResult'] = e['result']
        fu['state'] = 'done'
    elif t == 'text':
        c['outcome'] = e['text']
    elif t == 'later':
        c['followUp'] = {'due': e['due'], 'state': 'waiting'}
    elif t == 'stop':
        fu['state'] = 'none'
    elif t == 'noanswer':
        fu['state'] = 'noanswer'


def current():
    """db.json 에 아직 앱이 안 합친 inbox 줄을 얹은 지금 상태."""
    db = read_json(DB, {'students': [], 'consults': []})
    applied = set(db.get('appliedInbox') or [])
    by_id = {c['id']: c for c in db.get('consults', [])}
    for e in inbox_entries():
        if e.get('id') in applied:
            continue
        c = by_id.get(e.get('consultId'))
        if c:
            apply(c, e)
    students = {s['id']: s for s in db.get('students', [])}
    return by_id, students


def describe(c, students, nth=1):
    st = students.get(c['studentId']) or c.get('snapshot') or {}
    d = datetime.fromisoformat(c['at'].replace('Z', '+00:00')).astimezone()
    kind = KINDS.get(c['request'].get('kind'), '')
    pick = ''
    cm = c.get('common') or {}
    if cm.get('first_step'):
        pick = cm['first_step']
    else:
        for k in ('claude', 'codex', 'gemini'):
            r = (c.get('results') or {}).get(k) or {}
            ap = ((r.get('data') or {}).get('approach') or [])
            if ap:
                pick = f"{ap[0].get('how', '')} — {ap[0].get('when', '')}"
                break
    sit = (c['request'].get('situation') or '').strip()
    L = [f"📋 {st.get('name') or '학생'}{' (' + st['grade'] + ')' if st.get('grade') else ''} — {d.month}/{d.day} {kind}"
         + ('  [다시 묻는 것]' if nth > 1 else '')]
    if sit:
        L.append(f"상황: {sit[:120]}")
    if pick:
        L.append(f"그때 추천: {pick[:200]}")
    L.append('해 보셨습니까?')
    return '\n'.join(L)


def buttons(cid):
    return {'inline_keyboard': [
        [{'text': RESULTS['good'], 'callback_data': f'r|good|{cid}'},
         {'text': RESULTS['some'], 'callback_data': f'r|some|{cid}'},
         {'text': RESULTS['none'], 'callback_data': f'r|none|{cid}'}],
        [{'text': '⏳ 아직 안 해 봄 (3일 뒤)', 'callback_data': f'l|3|{cid}'},
         {'text': '🚫 그만 묻기', 'callback_data': f's|0|{cid}'}],
    ]}


# ---------------- 봇 상태 ----------------
def load_state():
    s = read_json(STATE, {})
    s.setdefault('offset', 0)
    s.setdefault('queue', [])
    s.setdefault('current', None)
    s.setdefault('awaitText', None)
    s.setdefault('slots', {})
    return s


def save_state(s):
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(STATE)


def targets(slot):
    """slot: 'first' 또는 'second' 또는 'now'. 이번에 물어볼 상담 id 목록."""
    by_id, _ = current()
    today = date.today().isoformat()
    first, second, give_up = [], [], []
    for c in by_id.values():
        fu = c.get('followUp') or {}
        stt = fu.get('state')
        if c.get('outcomeResult') or stt in ('done', 'none', 'noanswer', None):
            continue
        asked = fu.get('askedAt') or []
        last = asked[-1][:10] if asked else ''
        if stt == 'waiting' and fu.get('due', '9999') <= today:
            first.append(c)
        elif stt == 'asked' and last < today:
            (second if len(asked) == 1 else give_up).append(c)
    first.sort(key=lambda c: c['at'])
    second.sort(key=lambda c: c['at'])
    for c in give_up:
        write_inbox(c['id'], 'noanswer')
    if slot == 'first':
        # 밤 10시: 새로 물을 것 + 오후 2시를 놓친 두 번째
        return [c['id'] for c in first + second]
    if slot == 'second':
        return [c['id'] for c in second]
    return [c['id'] for c in second + first]


def send_next(s):
    s['current'] = None
    s['awaitText'] = None
    by_id, students = current()
    while s['queue']:
        cid = s['queue'].pop(0)
        c = by_id.get(cid)
        if not c or c.get('outcomeResult'):
            continue
        fu = c.get('followUp') or {}
        if fu.get('state') not in ('waiting', 'asked'):
            continue
        nth = len(fu.get('askedAt') or []) + 1
        left = len(s['queue'])
        text = describe(c, students, nth) + (f'\n\n(이 다음 {left}명 더)' if left else '')
        try:
            tg('sendMessage', chat_id=OWNER, text=text, reply_markup=buttons(cid))
        except Exception as e:
            s['queue'].insert(0, cid)  # 못 보냈으면 줄에 그대로 두고 다음 시각에 다시
            save_state(s)
            log('보내기 실패', repr(e))
            raise
        write_inbox(cid, 'asked')
        s['current'] = cid
        log('asked', cid, nth)
        break
    save_state(s)


def start_round(s, slot):
    ids = targets(slot)
    s['queue'] = [i for i in ids if i != s.get('current')]
    s['current'] = None  # 지난 질문에 답이 없으면 넘어감(다음 시각에 다시 물음)
    if not s['queue']:
        save_state(s)
        return 0
    n = len(s['queue'])
    send_next(s)
    return n


# ---------------- 답 받기 ----------------
def on_callback(s, q):
    data = q.get('data', '')
    msg = q.get('message') or {}
    try:
        kind, val, cid = data.split('|', 2)
    except ValueError:
        return
    if kind == 'r':
        write_inbox(cid, 'result', result=val)
        note = RESULTS[val]
        s['awaitText'] = cid
        tg('editMessageText', chat_id=msg['chat']['id'], message_id=msg['message_id'],
           text=msg.get('text', '') + f'\n\n→ {note}')
        tg('sendMessage', chat_id=OWNER, text='어땠는지 한 줄로 적어 주십시오. (안 적으려면 넘김)',
           reply_markup={'inline_keyboard': [[{'text': '넘김', 'callback_data': f'k|0|{cid}'}]]})
        save_state(s)
    elif kind == 'l':
        due = (date.today() + timedelta(days=int(val))).isoformat()
        write_inbox(cid, 'later', due=due)
        tg('editMessageText', chat_id=msg['chat']['id'], message_id=msg['message_id'],
           text=msg.get('text', '') + f'\n\n→ ⏳ {due[5:7].lstrip("0")}/{due[8:].lstrip("0")}에 다시 묻겠습니다')
        if s.get('current') == cid:
            send_next(s)
    elif kind == 's':
        write_inbox(cid, 'stop')
        tg('editMessageText', chat_id=msg['chat']['id'], message_id=msg['message_id'],
           text=msg.get('text', '') + '\n\n→ 🚫 더 안 묻습니다')
        if s.get('current') == cid:
            send_next(s)
    elif kind == 'k':
        tg('editMessageText', chat_id=msg['chat']['id'], message_id=msg['message_id'], text='넘김 — 결과만 기록했습니다.')
        if s.get('awaitText') == cid:
            s['awaitText'] = None
        send_next(s) if s.get('current') == cid or not s.get('current') else save_state(s)
    try:
        tg('answerCallbackQuery', callback_query_id=q['id'])
    except Exception:
        pass


def waiting_list():
    by_id, students = current()
    rows = []
    for c in by_id.values():
        fu = c.get('followUp') or {}
        if c.get('outcomeResult') or fu.get('state') not in ('waiting', 'asked'):
            continue
        st = students.get(c['studentId']) or {}
        due = fu.get('due', '')
        rows.append((due, f"{due[5:7].lstrip('0')}/{due[8:].lstrip('0')} {st.get('name', '학생')} — {KINDS.get(c['request'].get('kind'), '')}"
                     + (' (물어봄)' if fu.get('state') == 'asked' else '')))
    rows.sort()
    return '\n'.join(r for _, r in rows) or '기다리는 것이 없습니다.'


HELP = ('학생지도도우미 후속 확인 봇입니다.\n'
        f'물어볼 날 {ASK_FIRST}에 묻고, 답이 없으면 다음 날 {ASK_SECOND}에 한 번 더 묻습니다.\n\n'
        '/wait  기다리는 목록 (대기)\n/now  지금 물어볼 것 바로 묻기 (지금)\n/help  이 안내')


def on_message(s, m):
    text = (m.get('text') or '').strip()
    if not text:
        return
    cmd = text.split()[0].split('@')[0]
    if cmd in ('/wait', '/대기', '대기'):
        tg('sendMessage', chat_id=OWNER, text=waiting_list())
    elif cmd in ('/now', '/지금', '지금'):
        n = start_round(s, 'now')
        if not n:
            tg('sendMessage', chat_id=OWNER, text='지금 물어볼 것이 없습니다.')
    elif cmd in ('/help', '/start', '/도움', '도움'):
        tg('sendMessage', chat_id=OWNER, text=HELP)
    elif s.get('awaitText'):
        cid = s['awaitText']
        if text != '넘김':
            write_inbox(cid, 'text', text=text)
            tg('sendMessage', chat_id=OWNER, text='기록했습니다. 다음 추천 때 같이 넘어갑니다.')
        s['awaitText'] = None
        if s.get('current') in (cid, None):
            send_next(s)
        else:
            save_state(s)
    else:
        tg('sendMessage', chat_id=OWNER, text='지금은 기다리는 질문이 없습니다. /wait 으로 목록을 볼 수 있습니다.')


def poll(s, timeout):
    ups = tg('getUpdates', offset=s['offset'], timeout=timeout, allowed_updates=['message', 'callback_query'])
    for u in ups:
        s['offset'] = u['update_id'] + 1
        save_state(s)
        try:
            if 'callback_query' in u:
                q = u['callback_query']
                if str(q['from']['id']) == OWNER:
                    on_callback(s, q)
            elif 'message' in u:
                m = u['message']
                if str(m['from']['id']) == OWNER:
                    on_message(s, m)
        except Exception as e:
            log('처리 오류', repr(e), traceback.format_exc()[-600:])


# ---------------- 시각 맞추기 ----------------
def due_slots(s):
    now = datetime.now()
    out = []
    for name, hm in (('first', ASK_FIRST), ('second', ASK_SECOND)):
        h, mi = map(int, hm.split(':'))
        t = now.replace(hour=h, minute=mi, second=0, microsecond=0)
        key = f'{t:%Y-%m-%d} {name}'
        if t <= now < t + timedelta(hours=CATCHUP_HOURS) and not s['slots'].get(key):
            out.append((name, key))
    return out


def main():
    if not TOKEN:
        print('.env 에 TELEGRAM_TOKEN 이 없습니다.')
        sys.exit(1)
    s = load_state()
    if '--once-now' in sys.argv:
        n = start_round(s, 'now')
        print('물어본 수', n)
        end = time.time() + 30
        while time.time() < end:
            poll(s, 10)
        return
    # 두 개 켜지면 텔레그램이 서로 메시지를 뺏으니, 이미 켜져 있으면 바로 끝냄
    import socket
    global _LOCK
    _LOCK = socket.socket()
    try:
        _LOCK.bind(('127.0.0.1', 47831))
    except OSError:
        print('이미 켜져 있습니다.')
        return
    try:
        tg('setMyCommands', commands=[{'command': 'wait', 'description': '기다리는 목록'},
                                      {'command': 'now', 'description': '지금 물어볼 것 바로 묻기'},
                                      {'command': 'help', 'description': '안내'}])
    except Exception as e:
        log('setMyCommands', e)
    log('시작')
    while True:
        try:
            for name, key in due_slots(s):
                s['slots'][key] = True
                # 오래된 기록은 정리
                s['slots'] = {k: v for k, v in s['slots'].items() if k >= f'{date.today() - timedelta(days=7)}'}
                n = start_round(s, name)
                log('slot', key, n)
            poll(s, 25)
        except requests.RequestException as e:
            log('네트워크', repr(e))
            time.sleep(30)
        except Exception as e:
            log('오류', repr(e), traceback.format_exc()[-800:])
            time.sleep(30)


if __name__ == '__main__':
    main()
