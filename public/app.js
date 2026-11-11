const params = new URLSearchParams(location.search);
const ME = params.get('as') || 'min';
let room = null;
let thinking = 0;
const typing = new Map();
const seenPlan = new Set();
let firstRender = true;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const member = (id) => room.members.find((m) => m.id === id);
const isOnline = (id) => room.online.includes(id);
const pct = (n) => `${Math.round(n * 100)}%`;

function avatar(m, { clone = false, size = 32 } = {}) {
  return `<span class="av ${clone ? 'clone' : ''}" style="--c:${m.color};width:${size}px;height:${size}px">${m.name[0]}</span>`;
}
function aiAvatar(size = 32) {
  return `<span class="av ai" style="width:${size}px;height:${size}px"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2l1.8 5.4L19 9.2l-5.2 1.8L12 16l-1.8-5L5 9.2l5.2-1.8zM18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/></svg></span>`;
}

function render() {
  const me = member(ME);
  $('roomName').textContent = room.name;
  $('goal').innerHTML = `<span class="label">Goal</span>${esc(room.goal)}`;
  $('me').innerHTML = `${avatar(me, { size: 26 })}<span>You are <b>${esc(me.name)}</b></span>`;

  $('members').innerHTML = room.members
    .map((m) => {
      const on = isOnline(m.id);
      return `<div class="member ${on ? 'on' : 'away'}">
        <div class="row">${avatar(m, { clone: !on })}<div class="who"><div class="name">${esc(m.name)}${m.id === ME ? ' <span class="you">you</span>' : ''}</div>
        <div class="sub">${on ? `${esc(m.role)} · here now` : `Away · <b>Clone ${esc(m.name)}</b> stands in`}</div></div>
        <span class="dot ${on ? 'on' : 'clone'}"></span></div>
        <details><summary>How Clone ${esc(m.name)} thinks${m.learned.length ? ` · <b>${m.learned.length} learned</b>` : ''}</summary>
        <ul>${m.memory.map((x) => `<li>${esc(x)}</li>`).join('')}${m.learned.map((x) => `<li class="learned">${esc(x)}</li>`).join('')}</ul></details>
      </div>`;
    })
    .join('');

  const feed = $('feed');
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
  feed.innerHTML = room.messages.map(renderMessage).join('');
  if (nearBottom || firstRender) feed.scrollTop = feed.scrollHeight;

  $('plan').innerHTML = room.plan
    .map((p) => {
      const fresh = !firstRender && !seenPlan.has(p.id);
      seenPlan.add(p.id);
      const prop = room.proposals.find((x) => x.id === p.proposalId);
      const meta = prop ? `<div class="meta">${prop.auto ? 'Approved by Team Clone Mode' : 'Approved by the team'}</div>` : '';
      return `<li class="${fresh ? 'fresh' : ''}">${esc(p.text)}${meta}</li>`;
    })
    .join('');

  const lessons = room.members.flatMap((m) => m.learned.map((l) => ({ m, l })));
  $('learning').innerHTML = lessons.length
    ? lessons.map(({ m, l }) => `<div class="lesson">${avatar(m, { clone: true, size: 22 })}<span><b>Clone ${esc(m.name)}</b> ${esc(l)}</span></div>`).join('')
    : `<div class="empty">When someone overrides their Clone, it learns here.</div>`;

  renderStatus();
  firstRender = false;
}

function renderMessage(msg) {
  let head;
  let cls = msg.kind;
  if (msg.kind === 'ai') {
    head = `${aiAvatar()}<span class="name">Team AI</span>`;
  } else {
    const m = member(msg.author);
    const clone = msg.kind === 'clone';
    head = `${avatar(m, { clone })}<span class="name">${clone ? `Clone ${esc(m.name)}` : esc(m.name)}</span>${
      clone ? `<span class="pill clone">on behalf of ${esc(m.name)} · ${pct(msg.confidence)} sure</span>` : ''
    }`;
  }
  const text = esc(msg.text).replace(/@(\w+)/g, '<span class="mention">@$1</span>');
  const props = room.proposals.filter((p) => p.messageId === msg.id).map(renderProposal).join('');
  return `<div class="msg ${cls}${msg.error ? ' error' : ''}"><div class="head">${head}<span class="time">${new Date(msg.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div><div class="text">${text}</div>${props}</div>`;
}

function renderProposal(p) {
  const waitingOn = room.members.filter((m) => p.votes[m.id].accept < room.autoApprove && p.votes[m.id].source === 'clone');
  const status =
    p.status === 'approved'
      ? p.auto
        ? `<span class="st ok">Auto-approved · Team Clone Mode</span>`
        : `<span class="st ok">Approved by the team</span>`
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
      const label = clone ? `Clone ${esc(m.name)} predicts` : `${esc(m.name)}`;
      const val = clone ? pct(v.accept) : v.accept ? 'Approved' : 'Rejected';
      return `<div class="vote ${yes ? 'yes' : 'no'} ${clone ? 'byclone' : 'byhuman'}">
        ${avatar(m, { clone, size: 22 })}<span class="vl">${label}</span>
        <span class="bar"><i style="width:${Math.round(v.accept * 100)}%"></i></span><span class="vv">${val}</span>
        <span class="why">${esc(v.reason || '')}</span></div>`;
    })
    .join('');
  const mine = p.votes[ME];
  let actions = '';
  if (p.status === 'waiting' && mine.source === 'clone') {
    actions = `<button data-vote="1" data-p="${p.id}">Approve</button><button class="ghost" data-vote="0" data-p="${p.id}">Reject</button>`;
  } else if (p.status === 'approved') {
    actions = `<button class="ghost" data-vote="0" data-p="${p.id}">Revert</button>`;
  }
  return `<div class="proposal ${p.status}"><div class="ph"><span class="pt">${esc(p.title)}</span>${status}</div>${rows}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function renderStatus() {
  const bits = [];
  for (const [id] of typing) if (id !== ME && member(id)) bits.push(`${esc(member(id).name)} is typing…`);
  if (thinking > 0) {
    const away = room.members.filter((m) => !isOnline(m.id));
    bits.push(
      `<span class="shimmer">${aiAvatar(18)} Team AI is consulting ${room.members.length} Clones${
        away.length ? ` (standing in for ${away.map((m) => esc(m.name)).join(', ')})` : ''
      }…</span>`,
    );
  }
  $('status').innerHTML = bits.join(' · ');
}

function toast(html) {
  const t = $('toast');
  t.innerHTML = html;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 4200);
}

const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: ME, ...body }) });

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('input').value.trim();
  if (!text) return;
  $('input').value = '';
  post('/api/message', { text });
  post('/api/typing', { typing: false });
});
let typingTimer;
$('input').addEventListener('input', () => {
  post('/api/typing', { typing: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => post('/api/typing', { typing: false }), 1500);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vote]');
  if (b) post('/api/vote', { proposalId: b.dataset.p, accept: b.dataset.vote === '1' });
});

const es = new EventSource(`/events?as=${encodeURIComponent(ME)}`);
es.addEventListener('room', (e) => {
  room = JSON.parse(e.data);
  render();
});
es.addEventListener('thinking', (e) => {
  thinking = JSON.parse(e.data).busy;
  if (room) renderStatus();
});
es.addEventListener('typing', (e) => {
  const { as, typing: on } = JSON.parse(e.data);
  if (on) typing.set(as, true);
  else typing.delete(as);
  if (room) renderStatus();
});
es.addEventListener('learned', (e) => {
  const { memberId, lesson } = JSON.parse(e.data);
  const m = member(memberId);
  toast(`${avatar(m, { clone: true, size: 22 })}<span><b>Clone ${esc(m.name)} learned</b> · ${esc(lesson)}</span>`);
});
