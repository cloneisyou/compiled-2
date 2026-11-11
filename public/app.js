const params = new URLSearchParams(location.search);
const ME = params.get('as') || 'min';
const SHOW_POINTER = params.get('pointer') === '1';
let room = null;
let thinking = 0;
let thinkingKind = 'reply';
let team = params.get('ws') === 'team';
let cloneOf = ME; // whose Clone predicts the next prompt
let predictingClone = null;
let cloneMode = false;
const typing = new Map();
const seenPlan = new Set();
const seenOnline = new Set();
const seenMsgs = new Set();
let firstRender = true;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const member = (id) => room.members.find((m) => m.id === id);
const isOnline = (id) => room.online.includes(id);
const av = (m, { clone = false, cls = '' } = {}) => `<span class="av ${cls} ${clone ? 'clone' : ''}" style="--c:${m.color}">${m.name[0]}</span>`;
const aiAv = (cls = '') => `<span class="av ai ${cls}">»</span>`;
const PROJECTS = [['💼', 'Business'], ['🔬', 'Research'], ['📦', 'Product'], ['📣', 'Marketing'], ['🛠', 'Engineering'], ['🎨', 'Design'], ['⚙️', 'Operations']];

function render() {
  const me = member(ME);
  const driver = member(room.driver);
  $('app').classList.toggle('team', team);
  $('app').classList.toggle('noside', params.get('side') === '0');
  $('account').innerHTML = `${av(me, { cls: 'sm' })}${esc(me.name)} <span class="dim">· Clonist</span>`;
  $('author').textContent = `Clone ${member(cloneOf).name} ⌄`;
  $('cloneMenu').innerHTML =
    `<div class="menu-label">Predict the next prompt as</div>` +
    room.members.map((m) => `<button type="button" class="menu-item" data-clone="${m.id}">${av(m, { clone: true, cls: 'sm' })}Clone ${esc(m.name)}<span class="check">${m.id === cloneOf ? '✓' : ''}</span></button>`).join('');
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
  // Who is driving the shared session; anyone else can take it over.
  $('sessionbar').innerHTML = team
    ? `${av(driver, { cls: 'sm' })}<span><b>${driver.id === ME ? 'You' : esc(driver.name)}</b> ${driver.id === ME ? 'are' : 'is'} driving</span>${driver.id !== ME ? '<button type="button" class="btn small" id="takeover">Take over</button>' : ''}`
    : '';
  $('sessionbar').hidden = !team;

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
  const driver = member(room.driver);
  const plan = room.plan
    .map((p) => {
      const fresh = !firstRender && !seenPlan.has(p.id);
      seenPlan.add(p.id);
      const by = p.by && member(p.by);
      const via = p.via && member(p.via);
      const meta = by ? `<span class="by">Team AI · asked by ${esc(by.name)}${via ? ` · written by Clone ${esc(via.name)}` : ''}</span>` : '';
      return `<div class="todo ${by ? 'live' : 'done'} ${fresh ? 'fresh' : ''}"><span class="cb">${by ? '' : '✓'}</span><span>${esc(p.text)}${meta}</span></div>`;
    })
    .join('');
  $('doc').innerHTML = `<div class="gid">G-118</div><h2>${esc(room.name)}</h2>
    <div class="prop"><span class="k">📦</span>Product</div>
    <div class="prop"><span class="k">▮</span>High</div>
    <div class="prop"><span class="owners">${owners}</span><span class="dim">Min, Jun, Sara</span></div>
    <div class="prop">${av(driver, { cls: 'sm' })}<span><b>${esc(driver.name)}</b> is driving</span></div>
    <div class="sepline"></div>
    <div class="statusrow"><span class="dot"></span>In progress</div>
    <div class="sepline"></div>
    <p>${esc(room.goal)}.</p>
    <h4>Team plan</h4>${plan}`;
}

function renderMessage(msg) {
  const html = renderMessageInner(msg);
  const fresh = !firstRender && !seenMsgs.has(msg.id);
  seenMsgs.add(msg.id);
  return fresh ? html.replace('class="msg ', 'class="msg new ') : html; // only new messages animate in
}
function renderMessageInner(msg) {
  const text = esc(msg.text);
  if (msg.kind === 'event') return `<div class="msg event">${av(member(msg.author), { cls: 'sm' })}<span>${text}</span></div>`;
  const viaM = msg.viaClone && member(msg.viaClone);
  if (msg.kind === 'human' && msg.author === ME) {
    const via = viaM ? `<div class="via">${av(viaM, { clone: true, cls: 'sm' })}Written by Clone ${esc(viaM.name)}</div>` : '';
    return `<div class="msg mine"><div class="minecol">${via}<div class="bubble">${text}</div></div></div>`;
  }
  if (msg.kind === 'human') {
    const m = member(msg.author);
    return `<div class="msg other"><div class="who">${av(m, { cls: 'sm' })}${esc(m.name)}${viaM ? `<span class="note">· written by Clone ${esc(viaM.name)}</span>` : ''}</div><div class="bubble">${text}</div></div>`;
  }
  const hand = msg.handoff && member(msg.handoff);
  return `<div class="msg ai${msg.error ? ' error' : ''}${hand ? ' handoff' : ''}"><div class="who">${aiAv('sm')}Team AI${hand ? `<span class="note">· handoff for ${esc(hand.name)}</span>` : ''}</div><div class="body">${text}</div></div>`;
}

const suggestion = () => (team && room?.suggestions?.[cloneOf]) || '';
function renderGhost() {
  const s = suggestion();
  const show = s && !$('input').value && thinking === 0 && !predictingClone;
  $('ghost').innerHTML = show ? `${esc(s)}<span class="tabhint">tab</span>` : '';
  $('composer').classList.toggle('hasghost', !!show);
}

function renderStatus() {
  const bits = [];
  for (const [id] of typing) if (id !== ME && member(id)) bits.push(`${esc(member(id).name)} is typing…`);
  if (predictingClone && member(predictingClone)) bits.push(`<span class="writing">● Clone ${esc(member(predictingClone).name)} is writing a prompt…</span>`);
  if (thinking > 0) bits.push(`<span class="shimmer">${thinkingKind === 'handoff' ? 'Team AI is writing a handoff…' : 'Team AI is working…'}</span>`);
  $('status').innerHTML = bits.join(' · ');
  $('composer').classList.toggle('mode', (thinking > 0 && cloneMode) || !!predictingClone);
  $('toggle').classList.toggle('on', cloneMode);
}

const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: ME, ...body }) });

function send(viaClone = false) {
  const text = $('input').value.trim();
  if (!text || !team) return;
  cloneMode = viaClone;
  $('input').value = '';
  post('/api/message', viaClone ? { text, clone: cloneOf } : { text });
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
      $('input').value = s; // Tab: accept the prompt the chosen Clone wrote
      renderGhost();
    } else if ($('input').value && $('input').value === s) {
      e.preventDefault();
      send(true); // Tab Tab: send it
    }
  }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('#takeover')) return post('/api/takeover', {});
  const cl = e.target.closest('button[data-clone]');
  if (cl) {
    cloneOf = cl.dataset.clone;
    $('cloneMenu').hidden = true;
    render();
    if (!suggestion()) post('/api/predict', { clone: cloneOf });
    return;
  }
  if (e.target.closest('#author')) {
    $('cloneMenu').hidden = !$('cloneMenu').hidden;
    return;
  }
  $('cloneMenu').hidden = true;
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
  const d = JSON.parse(e.data);
  thinking = d.busy;
  thinkingKind = d.kind || 'reply';
  if (thinking === 0) cloneMode = false;
  if (room) {
    renderStatus();
    renderGhost();
  }
});
es.addEventListener('predicting', (e) => {
  predictingClone = JSON.parse(e.data).clone;
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
