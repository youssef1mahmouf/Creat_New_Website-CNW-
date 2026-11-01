/**
 * In-site Chat — WhatsApp-style messaging (Tohama reference look).
 * Users can chat with each other AND with admins/support. Messages poll
 * every 3 seconds; support accounts appear first with a green badge.
 *
 * Tohama-style composer: text + image / video / PDF / audio / document
 * attachments (≤2MB each) with inline previews, trash (delete), and a
 * built-in AI helper tab (asks the CNW user agent without leaving chat).
 */
import { api } from '../api/client.js';
import { getUser } from '../auth/store.js';
import { toast } from '../utils/toast.js';
import { go } from '../links.js';
import { registerCleanup } from '../lifecycle.js';

export async function render(page) {
  if (!getUser()) {
    toast('Please sign in to use chat', 'error');
    go('/login');
    return;
  }

  page.innerHTML = `
    <div class="wa-app">
      <aside class="wa-contacts">
        <div class="wa-contacts-head">
          <span class="wa-logo">CNW</span> Messages
        </div>
        <div class="wa-tabs">
          <button class="wa-tab active" id="tab-chats" type="button">💬 Chats</button>
          <button class="wa-tab" id="tab-ai" type="button">🤖 AI help</button>
        </div>
        <div class="wa-contact-list" id="wa-list"><p style="padding:14px;color:#5b6b7c">Loading contacts…</p></div>
        <div class="wa-ai-pane" id="wa-ai" hidden>
          <div class="wa-ai-log" id="wa-ai-log"></div>
          <form id="wa-ai-form" class="wa-ai-form">
            <input name="q" placeholder="Ask AI: search the site or any question…" maxlength="2000" autocomplete="off" />
            <button type="submit" aria-label="Ask AI">🤖</button>
          </form>
        </div>
      </aside>
      <section class="wa-thread-wrap">
        <div class="wa-thread-head" id="wa-head">
          <div class="wa-avatar">?</div>
          <div class="wa-info"><h2>Select a chat</h2><p class="wa-status">Choose a contact to start messaging</p></div>
        </div>
        <div class="wa-thread" id="wa-thread">
          <div class="wa-empty">💬 Select a contact from the list to start chatting.<br/>Admins & support are marked with a green badge.</div>
        </div>
        <div class="wa-preview" id="wa-preview" hidden></div>
        <form class="wa-input" id="wa-form" disabled>
          <input type="file" id="wa-file" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" />
          <button type="button" id="wa-attach" class="wa-attach" title="Send image / video / PDF / audio" aria-label="Attach file" disabled>📎</button>
          <input name="text" id="wa-text" placeholder="Type a message…" maxlength="2000" autocomplete="off" disabled />
          <button type="submit" aria-label="Send">➤</button>
        </form>
      </section>
    </div>`;

  let contacts = [];
  let activePeer = null;
  let pollTimer = null;

  const listEl = page.querySelector('#wa-list');
  const threadEl = page.querySelector('#wa-thread');
  const headEl = page.querySelector('#wa-head');
  const form = page.querySelector('#wa-form');
  const textInput = page.querySelector('#wa-text');
  const fileInput = page.querySelector('#wa-file');
  const attachBtn = page.querySelector('#wa-attach');
  const previewEl = page.querySelector('#wa-preview');
  let pendingAttachment = null; // { id, kind, name } — uploaded, not yet sent

  const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const escapeLess = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function renderContacts() {
    listEl.innerHTML = contacts.map((c) => `
      <button class="wa-contact ${activePeer === c.id ? 'active' : ''}" data-peer="${escapeLess(c.id)}">
        <span class="wa-avatar ${c.isSupport ? 'support' : ''}">${escapeLess(initials(c.name))}</span>
        <span class="wa-contact-info">
          <b>${escapeLess(c.name)}${c.isSupport ? ' <span class="wa-badge">SUPPORT</span>' : ''}</b>
          <small>${escapeLess(c.business || (c.isSupport ? 'CNW Team' : 'CNW member'))}</small>
        </span>
      </button>`).join('') || '<p style="padding:14px;color:#5b6b7c">No contacts yet.</p>';
    listEl.querySelectorAll('[data-peer]').forEach((btn) => btn.addEventListener('click', () => selectPeer(btn.dataset.peer)));
  }

  function attachmentHtml(m) {
    if (!m.attachmentId) return '';
    const url = `/api/chat/attachments/${m.attachmentId}`;
    const name = escapeLess(m.attachmentName || 'file');
    if (m.attachmentKind === 'image') {
      return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}" class="wa-media" loading="lazy" /></a>`;
    }
    if (m.attachmentKind === 'video') {
      return `<video src="${url}" controls preload="metadata" class="wa-media"></video>`;
    }
    if (m.attachmentKind === 'audio') {
      return `<audio src="${url}" controls preload="metadata" class="wa-audio"></audio>`;
    }
    const icon = m.attachmentKind === 'pdf' ? '📕' : '📄';
    return `<a class="wa-file" href="${url}" target="_blank" rel="noopener">${icon} ${name}</a>`;
  }

  function bubble(m) {
    const mine = m.from === getUser().id;
    const canDelete = mine || m.to === getUser().id;
    return `
      <div class="wa-bubble ${mine ? 'mine' : 'theirs'}">
        ${m.text ? escapeLess(m.text) : ''}${attachmentHtml(m)}
        <span class="wa-time">${new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${mine ? (m.read ? ' ✓✓' : ' ✓') : ''}
          ${canDelete ? `<button class="wa-del" data-del="${m.id}" title="Delete">🗑</button>` : ''}</span>
      </div>`;
  }

  async function loadThread() {
    if (!activePeer) return;
    try {
      const res = await api.get(`/chat/messages?peer=${encodeURIComponent(activePeer)}`);
      if (res.peer) {
        headEl.innerHTML = `
          <div class="wa-avatar ${res.peer.isSupport ? 'support' : ''}">${escapeLess(initials(res.peer.name))}</div>
          <div class="wa-info"><h2>${escapeLess(res.peer.name)}${res.peer.isSupport ? ' <span class="wa-badge">SUPPORT</span>' : ''}</h2>
          <p class="wa-status online">${escapeLess(res.peer.isSupport ? 'CNW Support' : (res.peer.business || 'CNW member'))} · ${escapeLess(res.peer.whatsapp || 'in-site chat')}</p></div>`;
      }
      threadEl.innerHTML = res.messages.map(bubble).join('') || '<div class="wa-empty">No messages yet — say hi! 👋</div>';
      threadEl.scrollTop = threadEl.scrollHeight;
      // Trash (Tohama trash-manager): delete moves the message out of the thread.
      threadEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Delete this message?')) return;
        try { await api.del(`/chat/messages/${b.dataset.del}`); await loadThread(); }
        catch (e) { toast(e.message, 'error'); }
      }));
      textInput.disabled = false;
      attachBtn.disabled = false;
      form.disabled = false;
    } catch (e) {
      threadEl.innerHTML = `<div class="wa-empty">⚠️ ${escapeLess(e.message)}</div>`;
    }
  }

  async function selectPeer(id) {
    activePeer = id;
    renderContacts();
    await loadThread();
  }

  // ---- Tohama-style attachment picker: image / video / PDF / audio / doc ----
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('File too large — max 2MB per attachment', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api.post('/chat/attachments', {
          name: file.name, mime: file.type || 'application/octet-stream',
          size: file.size, dataUrl: String(reader.result),
        });
        pendingAttachment = { id: res.attachment.id, kind: res.attachment.kind, name: res.attachment.name };
        previewEl.hidden = false;
        previewEl.innerHTML = `📎 ${escapeLess(pendingAttachment.name)}
          <button type="button" id="wa-preview-x" title="Remove">×</button>`;
        previewEl.querySelector('#wa-preview-x').addEventListener('click', () => {
          pendingAttachment = null;
          previewEl.hidden = true;
          previewEl.innerHTML = '';
        });
      } catch (e) { toast(e.message, 'error'); }
    };
    reader.readAsDataURL(file);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if ((!text && !pendingAttachment) || !activePeer) return;
    textInput.value = '';
    try {
      await api.post('/chat/messages', {
        peer: activePeer, text,
        ...(pendingAttachment ? { attachmentId: pendingAttachment.id } : {}),
      });
      pendingAttachment = null;
      previewEl.hidden = true;
      previewEl.innerHTML = '';
      await loadThread();
    } catch (err) {
      toast(err.message, 'error');
      textInput.value = text;
    }
  });

  // ---- AI helper tab: ask the CNW user agent without leaving chat ----
  const tabChats = page.querySelector('#tab-chats');
  const tabAi = page.querySelector('#tab-ai');
  const aiPane = page.querySelector('#wa-ai');
  const aiLog = page.querySelector('#wa-ai-log');
  tabChats.addEventListener('click', () => {
    tabChats.classList.add('active'); tabAi.classList.remove('active');
    aiPane.hidden = true; listEl.hidden = false;
  });
  tabAi.addEventListener('click', () => {
    tabAi.classList.add('active'); tabChats.classList.remove('active');
    listEl.hidden = true; aiPane.hidden = false;
  });
  const aiPush = (role, text) => {
    const div = document.createElement('div');
    div.className = `wa-ai-msg ${role}`;
    div.textContent = text;
    aiLog.appendChild(div);
    aiLog.scrollTop = aiLog.scrollHeight;
  };
  aiPush('bot', 'Hi! Ask me to search the site (designs, code store, pages) or any question.');
  page.querySelector('#wa-ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input[name=q]');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    aiPush('user', q);
    try {
      const res = await api.post('/ai/chat', { message: q });
      aiPush('bot', res.reply);
    } catch (err) { aiPush('bot', `⚠️ ${err.message}`); }
  });

  try {
    const res = await api.get('/chat/contacts');
    contacts = res.contacts || [];
  } catch { contacts = []; }
  renderContacts();

  // Poll for new messages + unread counts every 3s (WhatsApp-like live feel).
  const poll = async () => {
    if (activePeer) await loadThread();
    try {
      const { counts } = await api.get('/chat/unread');
      listEl.querySelectorAll('[data-peer]').forEach((btn) => {
        const n = counts[btn.dataset.peer] || 0;
        let badge = btn.querySelector('.wa-unread');
        if (n > 0) {
          if (!badge) { badge = document.createElement('span'); badge.className = 'wa-unread'; btn.querySelector('.wa-contact-info').after(badge); }
          badge.textContent = String(n);
        } else badge?.remove();
      });
    } catch { /* offline */ }
  };
  pollTimer = setInterval(poll, 3000);
  registerCleanup(() => clearInterval(pollTimer));
}