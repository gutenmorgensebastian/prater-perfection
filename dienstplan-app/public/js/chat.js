import { state, api, esc, linkify, $, setTitle, showError, toast, canWrite, isAdmin, fmtDateTime, fmtSize, loadPref, savePref } from './core.js';

let current = null; // { channelId, tab }
const unread = loadPref('unread', {});

export function updateBadges() {
  const total = Object.entries(unread).reduce((n, [id, c]) => n + (state.channels.some((ch) => String(ch.id) === id) ? c : 0), 0);
  const badge = $('#chat-badge');
  badge.hidden = !total;
  badge.textContent = total > 99 ? '99+' : total;
  if ('setAppBadge' in navigator) (total ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => {});
}

function markRead(channelId) {
  delete unread[channelId];
  savePref('unread', unread);
  updateBadges();
}

// Wird von app.js bei jeder neuen Nachricht (Live-Update) aufgerufen.
export function onMessage(msg) {
  if (current && current.channelId === msg.channel_id && current.tab === 'chat' && document.visibilityState === 'visible') {
    appendMessage(msg, true);
    return;
  }
  if (msg.person_id !== state.me.id) {
    unread[msg.channel_id] = (unread[msg.channel_id] || 0) + 1;
    savePref('unread', unread);
    updateBadges();
    renderChannelTabs();
  }
}
export function onMessageChanged() {
  if (current) loadCurrent();
}

function fileHtml(m) {
  if (!m.attachment_id) return '';
  const url = `/api/files/${m.attachment_id}`;
  if (/^image\//.test(m.file_mime)) return `<a class="file" href="${url}" target="_blank"><img src="${url}" alt="${esc(m.file_name)}" loading="lazy"></a>`;
  const icon = m.file_mime === 'application/pdf' ? '📄' : '📎';
  return `<a class="file" href="${url}" target="_blank" rel="noopener">${icon} <span>${esc(m.file_name)}</span> <span class="muted small">${fmtSize(m.file_size)}</span></a>`;
}

function messageHtml(m) {
  const own = m.person_id === state.me.id;
  const mayDelete = own || isAdmin();
  return `<div class="msg ${own ? 'own' : ''}" data-id="${m.id}">
    <div class="meta"><b style="--c:${m.person_color || 'inherit'}">${esc(m.person_name || 'Gelöscht')}</b><span>${fmtDateTime(m.created_at)}</span>
      ${m.pinned ? '<span class="pin" title="Angepinnt">📌</span>' : ''}
      <span class="actions">${canWrite() ? `<button data-act="pin" title="${m.pinned ? 'Lösen' : 'Anpinnen'}">📌</button>` : ''}${mayDelete ? '<button data-act="del" title="Löschen">🗑</button>' : ''}</span></div>
    ${m.body ? `<div class="body">${linkify(m.body)}</div>` : ''}
    ${fileHtml(m)}
  </div>`;
}

function appendMessage(m, scroll) {
  const list = $('#messages');
  if (!list || list.querySelector(`[data-id="${m.id}"]`)) return;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  $('#empty')?.remove();
  list.insertAdjacentHTML('beforeend', messageHtml(m));
  if (scroll && (nearBottom || m.person_id === state.me.id)) list.scrollTop = list.scrollHeight;
}

function renderChannelTabs() {
  const el = $('#channel-tabs');
  if (!el || !current) return;
  el.innerHTML = state.channels.map((ch) => `<a href="#/chat/${ch.id}" class="${ch.id === current.channelId ? 'active' : ''}">${esc(ch.name)}${unread[ch.id] ? `<span class="unread">${unread[ch.id]}</span>` : ''}</a>`).join('');
}

export function renderChat(view, channelId, tab = 'chat') {
  const channel = state.channels.find((c) => c.id === channelId) || state.channels[0];
  if (!channel) {
    view.innerHTML = '<p class="muted">Noch keine Gruppen vorhanden.</p>';
    return;
  }
  current = { channelId: channel.id, tab };
  savePref('last-channel', channel.id);
  setTitle(channel.name);
  view.innerHTML = `
    <div class="channel-tabs" id="channel-tabs"></div>
    <div class="subtabs">
      <a href="#/chat/${channel.id}" class="${tab === 'chat' ? 'active' : ''}">Chat</a>
      <a href="#/chat/${channel.id}/ablage" class="${tab === 'ablage' ? 'active' : ''}">Ablage · Dateien &amp; Links</a>
    </div>
    <div id="chat-body"></div>`;
  renderChannelTabs();
  loadCurrent();
  if (tab === 'chat') markRead(channel.id);
  return () => { current = null; };
}

async function loadCurrent() {
  const body = $('#chat-body');
  if (!body || !current) return;
  const { channelId, tab } = current;
  try {
    if (tab === 'ablage') {
      const lib = await api(`/channels/${channelId}/library`);
      const item = (m, inner) => `<li><div class="grow">${inner}<div class="muted small">${esc(m.person_name || '')} · ${fmtDateTime(m.created_at)}</div></div></li>`;
      body.innerHTML = `
        <div class="card"><h2>📌 Angepinnt</h2>${lib.pinned.length ? `<ul class="list">${lib.pinned.map((m) => item(m, `${m.body ? `<div class="body">${linkify(m.body)}</div>` : ''}${fileHtml(m)}`)).join('')}</ul>` : '<p class="muted small">Nichts angepinnt. Im Chat bei einer Nachricht auf 📌 tippen.</p>'}</div>
        <div class="card"><h2>📄 Dateien</h2>${lib.files.length ? `<ul class="list">${lib.files.map((m) => item(m, fileHtml(m))).join('')}</ul>` : '<p class="muted small">Noch keine Dateien.</p>'}</div>
        <div class="card"><h2>🔗 Links</h2>${lib.links.length ? `<ul class="list">${lib.links.map((l) => item(l.message, `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.url)}</a>`)).join('')}</ul>` : '<p class="muted small">Noch keine Links.</p>'}</div>`;
      return;
    }
    const msgs = await api(`/channels/${channelId}/messages`);
    markRead(channelId);
    body.innerHTML = `
      <div class="chat">
        <div class="messages" id="messages">
          ${msgs.length >= 60 ? '<button class="link" id="older">Ältere Nachrichten laden</button>' : ''}
          ${msgs.length ? msgs.map(messageHtml).join('') : '<p class="muted center small" id="empty">Noch keine Nachrichten. Schreib die erste!</p>'}
        </div>
        ${canWrite() ? `<form class="composer" id="composer">
          <label class="btn shrink" title="Datei anhängen (PDF, Bild …)" style="margin:0">📎<input type="file" name="file" hidden></label>
          <div style="flex:1"><textarea name="body" rows="1" placeholder="Nachricht oder Link …"></textarea><div class="attach-name" id="attach-name"></div></div>
          <button class="primary shrink" type="submit">Senden</button>
        </form>` : '<p class="muted small center">Du hast nur Lesezugriff.</p>'}
      </div>`;
    const list = $('#messages');
    list.scrollTop = list.scrollHeight;
    list.onclick = onMessageAction;
    $('#older')?.addEventListener('click', loadOlder);
    bindComposer();
  } catch (err) { showError(err); }
}

async function loadOlder() {
  const list = $('#messages');
  const first = list.querySelector('.msg')?.dataset.id;
  const older = await api(`/channels/${current.channelId}/messages?before=${first}`);
  const prevHeight = list.scrollHeight;
  $('#older').insertAdjacentHTML('afterend', older.map(messageHtml).join(''));
  if (older.length < 60) $('#older').remove();
  list.scrollTop = list.scrollHeight - prevHeight;
}

async function onMessageAction(ev) {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const el = btn.closest('.msg');
  const id = el.dataset.id;
  try {
    if (btn.dataset.act === 'del') {
      if (!confirm('Nachricht löschen?')) return;
      await api(`/messages/${id}`, { method: 'DELETE' });
      el.remove();
    } else {
      const pinned = !el.querySelector('.pin');
      const m = await api(`/messages/${id}`, { method: 'PATCH', body: { pinned } });
      el.outerHTML = messageHtml(m);
      toast(pinned ? 'Angepinnt – zu finden unter „Ablage“' : 'Gelöst');
    }
  } catch (err) { showError(err); }
}

function bindComposer() {
  const form = $('#composer');
  if (!form) return;
  const ta = form.body;
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; };
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.file.onchange = () => { $('#attach-name').textContent = form.file.files[0] ? `📎 ${form.file.files[0].name}` : ''; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!ta.value.trim() && !form.file.files[0]) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const m = await api(`/channels/${current.channelId}/messages`, { method: 'POST', form: new FormData(form) });
      form.reset();
      $('#attach-name').textContent = '';
      autosize();
      appendMessage(m, true);
    } catch (err) { showError(err); } finally { btn.disabled = false; }
  };
}
