const params = new URLSearchParams(location.search);
const ME = params.get('as') || 'min';
const SHOW_POINTER = params.get('pointer') === '1';
let room = null;
let thinking = 0;
let team = params.get('ws') === 'team';
const typing = new Map();
const seenPlan = new Set();
const seenLessons = new Set();
const seenOnline = new Set();
let firstRender = true;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const member = (id) => room.members.find((m) => m.id === id);
const isOnline = (id) => room.online.includes(id);
const pct = (n) => `${Math.round(n * 100)}%`;
const av = (m, { clone = false, cls = '' } = {}) => `<span class="av ${cls} ${clone ? 'clone' : ''}" style="--c:${m.color}">${m.name[0]}</span>`;
const aiAv = (cls = '') => `<span class="av ai ${cls}">»</span>`;
const PROJECTS = [['💼', 'Business'], ['🔬', 'Research'], ['📦', 'Product'], ['📣', 'Marketing'], ['🛠', 'Engineering'], ['🎨', 'Design'], ['⚙️', 'Operations']];

function render() {
  const me = member(ME);
  $('app').classList.toggle('team', team);
  $('account').innerHTML = `${av(me, { cls: 'sm' })}${esc(me.name)} <span class="dim">· Clonist</span>`;
  $('author').textContent = `Clone ${me.name} ⌄`;
  $('chkPersonal').textContent = team ? '' : '✓';
  $('chkTeam').textContent = team ? '✓' : '';
  $('sbLabel').textContent = team ? 'Team · Clone' : 'Projects';
  $('sbList').innerHTML = team
    ? room.members
        .map((m) => {
          const on = isOnline(m.id);
          return `<div class="sb-item">${av(m, { clone: !on, cls: 'sm' })}<span>${on ? esc(m.name) : `Clone ${esc(m.name)}`}</span>${on ? '<span class="live"></span>' : '<span class="clone-tag">standing in</span>'}</div>`;
        })
        .join('')
    : PROJECTS.map(([i, n]) => `<div class="sb-item"><span>${i}</span><span>${n}</span></div>`).join('');
  $('goalChip').textContent = team ? room.name : 'New goal';

  $('presence').innerHTML = room.members
    .map((m) => {
      const on = isOnline(m.id);
      const fresh = on && !firstRender && !seenOnline.has(m.id);
      if (on) seenOnline.add(m.id);
      else seenOnline.delete(m.id);
      return av(m, { clone: !on, cls: fresh ? 'joined' : '' });
    })
    .join('');

  const feed = $('feed');
  const msgs = team ? room.messages.filter((m) => m.id !== 'm0') : [];
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
  feed.innerHTML = msgs.length ? msgs.map(renderMessage).join('') : `<div class="empty"><div><div class="mark">»</div><h1>What should we do?</h1></div></div>`;
  if (nearBottom || firstRender) feed.scrollTop = feed.scrollHeight;

  renderDoc();
  renderGhost();
  renderStatus();
  firstRender = false;
}

function renderDoc() {
  const owners = room.members.map((m) => av(m, { clone: !isOnline(m.id), cls: 'sm' })).join('');
  const plan = room.plan
    .map((p) => {
      const fresh = !firstRender && !seenPlan.has(p.id);
      seenPlan.add(p.id);
      const prop = room.proposals.find((x) => x.id === p.proposalId);
      return `<div class="todo done ${fresh ? 'fresh' : ''}"><span class="cb">✓</span><span>${esc(p.text)}${prop ? `<span class="by">${prop.auto ? 'Approved by Team Clone Mode' : 'Approved by the team'}</span>` : ''}</span></div>`;
    })
    .join('');
  const lessons = room.members.flatMap((m) => m.learned.map((l) => ({ m, l })));
  $('doc').innerHTML = `<div class="gid">G-118</div><h2>${esc(room.name)}</h2>
    <div class="prop"><span class="k">📦</span>Product</div>
    <div class="prop"><span class="k">▮</span>High</div>
    <div class="prop"><span class="owners">${owners}</span><span class="dim">Min, Jun, Sara</span></div>
    <div class="sepline"></div>
    <div class="statusrow"><span class="dot"></span>In progress</div>
    <div class="sepline"></div>
    <p>${esc(room.goal)}.</p>
    <h4>Team plan</h4>${plan}
    <h4>Clones learning</h4>${
      lessons.length
        ? lessons
            .map(({ m, l }) => {
              const k = m.id + l;
              const fresh = !firstRender && !seenLessons.has(k);
              seenLessons.add(k);
              return `<div class="lesson ${fresh ? 'fresh' : ''}">${av(m, { clone: true, cls: 'sm' })}<span><b>Clone ${esc(m.name)}</b> ${esc(l)}</span></div>`;
            })
            .join('')
        : `<div class="emptynote">When someone overrides their Clone, it learns here.</div>`
    }`;
}

function renderMessage(msg) {
  const text = esc(msg.text).replace(/@(\w+)/g, '<span class="mention">@$1</span>');
  const props = room.proposals.filter((p) => p.messageId === msg.id).map(renderProposal).join('');
  if (msg.kind === 'human' && msg.author === ME) return `<div class="msg mine"><div class="bubble">${text}</div></div>`;
  if (msg.kind === 'human') {
    const m = member(msg.author);
    return `<div class="msg other"><div class="who">${av(m, { cls: 'sm' })}${esc(m.name)}</div><div class="bubble">${text}</div></div>`;
  }
  if (msg.kind === 'clone') {
    const m = member(msg.author);
    return `<div class="msg clone"><div class="who">${av(m, { clone: true, cls: 'sm' })}Clone ${esc(m.name)}<span class="note">on behalf of ${esc(m.name)} · ${pct(msg.confidence)} sure</span></div><div class="body">${text}</div></div>`;
  }
  return `<div class="msg ai${msg.error ? ' error' : ''}"><div class="who">${aiAv('sm')}Team AI</div><div class="body">${text}</div>${props}</div>`;
}

function renderProposal(p) {
  const waitingOn = room.members.filter((m) => p.votes[m.id].accept < room.autoApprove && p.votes[m.id].source === 'clone');
  const status =
    p.status === 'approved'
      ? `<span class="st ok">${p.auto ? 'Auto-approved · Team Clone Mode' : 'Approved by the team'}</span>`
      : p.status === 'reverted'
        ? `<span class="st bad">Reverted by ${esc(member(p.revertedBy).name)}</span>`
        : p.status === 'rejected'
          ? `<span class="st bad">Rejected</span>`
          : `<span class="st wait">Needs ${waitingOn.map((m) => esc(m.name)).join(' & ') || 'the team'}</span>`;
  const rows = room.members
    .map((m) => {
      const v = p.votes[m.id];
      const clone = v.source === 'clone';
      const yes = v.accept >= room.autoApprove;
      return `<div class="vote ${yes ? 'yes' : 'no'} ${clone ? 'byclone' : 'byhuman'}">${av(m, { clone, cls: 'sm' })}<span>${clone ? `Clone ${esc(m.name)} predicts` : esc(m.name)}</span><span class="bar"><i style="width:${Math.round(v.accept * 100)}%"></i></span><span class="vv">${clone ? pct(v.accept) : v.accept ? 'Approved' : 'Rejected'}</span>${clone && v.reason ? `<span class="why">${esc(v.reason)}</span>` : ''}</div>`;
    })
    .join('');
  const mine = p.votes[ME];
  let actions = '';
  if (p.status === 'waiting' && mine.source === 'clone') actions = `<button type="button" class="btn" data-vote="1" data-p="${p.id}">Approve</button><button type="button" class="btn ghostbtn" data-vote="0" data-p="${p.id}">Reject</button>`;
  else if (p.status === 'approved') actions = `<button type="button" class="btn ghostbtn" data-vote="0" data-p="${p.id}">Revert</button>`;
  return `<div class="proposal ${p.status}"><div class="ph"><span class="pt">${esc(p.title)}</span>${status}</div>${rows}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

const suggestion = () => (team && room?.suggestions?.[ME]) || '';
function renderGhost() {
  const s = suggestion();
  const show = s && !$('input').value && thinking === 0;
  $('ghost').innerHTML = show ? `${esc(s)}<span class="tabhint">tab</span>` : '';
  $('composer').classList.toggle('hasghost', !!show);
}

function renderStatus() {
  const bits = [];
  for (const [id] of typing) if (id !== ME && member(id)) bits.push(`${esc(member(id).name)} is typing…`);
  if (thinking > 0) bits.push(`<span class="shimmer">Team AI is consulting ${room.members.length} Clones…</span>`);
  $('status').innerHTML = bits.join(' · ');
  $('composer').classList.toggle('mode', thinking > 0 && cloneMode);
  $('toggle').classList.toggle('on', cloneMode);
}

function toast(html) {
  const t = $('toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 4500);
}

const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: ME, ...body }) });

let cloneMode = false;
function send(viaClone = false) {
  const text = $('input').value.trim();
  if (!text || !team) return;
  cloneMode = viaClone;
  $('input').value = '';
  post('/api/message', { text });
  post('/api/typing', { typing: false });
  renderGhost();
}
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  send(false);
});
let typingTimer;
$('input').addEventListener('input', () => {
  renderGhost();
  post('/api/typing', { typing: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => post('/api/typing', { typing: false }), 1500);
});
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send(false);
  } else if (e.key === 'Tab') {
    const s = suggestion();
    if (!$('input').value && s) {
      e.preventDefault();
      $('input').value = s; // Tab: accept Clone's predicted prompt
      renderGhost();
    } else if ($('input').value && $('input').value === s) {
      e.preventDefault();
      send(true); // Tab Tab: send it in Clone Mode
    }
  }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vote]');
  if (b) return post('/api/vote', { proposalId: b.dataset.p, accept: b.dataset.vote === '1' });
  const ws = e.target.closest('button[data-ws]');
  if (ws) {
    team = ws.dataset.ws === 'team';
    $('wsMenu').hidden = true;
    render();
    return;
  }
  if (e.target.closest('#account')) $('wsMenu').hidden = !$('wsMenu').hidden;
  else $('wsMenu').hidden = true;
});

// live cursors
const cursorSvg = (c) => `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 2l15 9.5-6.6 1.4L16 20l-2.8 1.3-3.6-7.2L4 18.5z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
function cursorEl(id, color, label) {
  let el = document.getElementById(`cur-${id}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `cur-${id}`;
    el.className = 'rcursor';
    el.innerHTML = cursorSvg(color) + (label ? `<span class="tag" style="background:${color}">${esc(label)}</span>` : '');
    $('cursors').appendChild(el);
  }
  return el;
}
let lastCursor = 0;
document.addEventListener('mousemove', (e) => {
  if (SHOW_POINTER) {
    const el = cursorEl('self', '#1d8cf0', '');
    el.style.transition = 'none';
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY}px`;
  }
  const now = Date.now();
  if (now - lastCursor < 50 || !team) return;
  lastCursor = now;
  post('/api/cursor', { x: e.clientX / innerWidth, y: e.clientY / innerHeight });
});

const es = new EventSource(`/events?as=${encodeURIComponent(ME)}`);
es.addEventListener('room', (e) => {
  room = JSON.parse(e.data);
  render();
});
es.addEventListener('thinking', (e) => {
  thinking = JSON.parse(e.data).busy;
  if (thinking === 0) cloneMode = false;
  if (room) {
    renderStatus();
    renderGhost();
  }
});
es.addEventListener('typing', (e) => {
  const { as, typing: on } = JSON.parse(e.data);
  if (on) typing.set(as, true);
  else typing.delete(as);
  if (room) renderStatus();
});
es.addEventListener('cursor', (e) => {
  const c = JSON.parse(e.data);
  if (c.as === ME || !room || !team) return;
  const m = member(c.as);
  const el = cursorEl(c.as, m.color, m.name);
  el.style.opacity = c.hide ? 0 : 1;
  el.style.left = `${c.x * innerWidth}px`;
  el.style.top = `${c.y * innerHeight}px`;
});
es.addEventListener('learned', (e) => {
  const { memberId, lesson } = JSON.parse(e.data);
  const m = member(memberId);
  toast(`${av(m, { clone: true, cls: 'sm' })}<span><b>Clone ${esc(m.name)} learned</b> · ${esc(lesson)}</span>`);
});
