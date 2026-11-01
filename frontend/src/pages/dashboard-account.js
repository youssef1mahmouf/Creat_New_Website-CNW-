/** Dashboard sections: AI assistant / security & audit / account settings. */
import { getUser, changePassword, mySessions, revokeSession } from '../auth/store.js';
import { api } from '../api/client.js';
import { toast, escapeHtml, formatDate } from '../utils/toast.js';
import { table } from './dashboard-ui.js';
import { el } from './dashboard-sections.js';

export const accountSections = {};

accountSections.ai = async function ai(content, user) {
  const isAdminUser = ['admin', 'super_admin'].includes(user.role);
  el(content, `
    <h2 class="section-title">AI Assistant</h2>
    <p style="color:var(--muted);margin-bottom:16px">${isAdminUser
      ? '<b>Admin agent</b> — ask anything about the website: payments, orders, users, subscriptions… it answers from live data and can generate downloadable reports.'
      : '<b>User agent</b> — search the site (designs, code store, pages) or ask any question. Try: “find 3D designs”, “my orders”, “how does payment work?”'}</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px" id="ai-chips">
      ${isAdminUser
        ? ['How many orders?', 'Payment info', 'Users info', 'Subscriptions info', 'New messages']
            .map((q) => `<button class="btn btn-sm" data-q="${q}">${q}</button>`).join('')
        : ['Search: 3D designs', 'Search: glow card', 'My orders', 'My subscriptions', 'Pricing help']
            .map((q) => `<button class="btn btn-sm" data-q="${q}">${q}</button>`).join('')}
    </div>

    <div class="chat-box card" id="chat-log" style="max-width:none;min-height:200px;padding:20px"></div>
    <form id="chat-form" class="form" style="max-width:none;margin-top:14px;display:flex;gap:10px">
      <input name="message" placeholder="${isAdminUser ? 'Ask about orders, payments, users — or request a report…' : 'Search the site or ask me anything…'}" required maxlength="4000" style="flex:1" />
      <button class="btn btn-primary">Send</button>
    </form>
    ${isAdminUser ? '<div class="card" style="margin-top:24px;padding:20px"><h3>📊 Instant reports — Excel / CSV / PDF</h3><p style="color:var(--muted);font-size:0.9rem">Download any dataset. XLS opens directly in Excel; PDF is print-ready.</p><div id="reports-grid" style="display:grid;gap:10px;margin-top:12px"></div></div>' : ''}`);

  const log = content.querySelector('#chat-log');
  const push = (role, text) => {
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };
  push('bot', isAdminUser
    ? 'Hello! I am the CNW Admin AI. Ask me about orders, payments, users or subscriptions — or say "make a report of users in excel".'
    : 'Hi! I am the CNW assistant. I can search the whole site for you — designs, code store items, pages — or answer any question.');

  const ask = async (message) => {
    push('user', message);
    try {
      const res = await api.post(isAdminUser ? '/ai/admin' : '/ai/chat', { message });
      push('bot', res.reply);
    } catch (err) { push('bot', `⚠️ ${err.message}`); }
  };

  content.querySelector('#ai-chips').querySelectorAll('[data-q]').forEach((btn) => {
    btn.addEventListener('click', () => ask(btn.dataset.q.replace('Search: ', 'find ')));
  });

  content.querySelector('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input[name=message]');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    await ask(message);
  });

  // ---- Admin: one-click Excel/CSV/PDF downloads for every dataset ----
  if (isAdminUser) {
    const grid = content.querySelector('#reports-grid');
    const datasets = [
      ['users', '👥 Users info'], ['orders', '🧾 Orders'], ['payments', '💳 Payments'],
      ['contact-messages', '📩 Messages'], ['subscriptions', '🔄 Subscriptions'], ['errors', '🐞 Errors'],
    ];
    grid.innerHTML = datasets.map(([d, label]) => `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;border:1px solid var(--border);border-radius:10px;padding:10px 14px">
        <b style="font-size:0.95rem">${label}</b>
        <span style="display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" data-dl="${d}" data-fmt="xls">Excel</button>
          <button class="btn btn-sm" data-dl="${d}" data-fmt="csv">CSV</button>
          <button class="btn btn-sm" data-dl="${d}" data-fmt="pdf">PDF</button>
        </span>
      </div>`).join('');

    grid.querySelectorAll('[data-dl]').forEach((btn) => btn.addEventListener('click', async () => {
      const { getAccessToken } = await import('../api/client.js');
      btn.disabled = true;
      try {
        const res = await fetch(`/api/admin/reports/${btn.dataset.dl}?format=${btn.dataset.fmt}`, {
          headers: { Authorization: `Bearer ${getAccessToken()}` },
        });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `cnw-${btn.dataset.dl}-${new Date().toISOString().slice(0, 10)}.${btn.dataset.fmt}`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Report downloaded!');
      } catch (e) { toast(e.message, 'error'); }
      btn.disabled = false;
    }));
  }
};

/** Admin: Code Store manager — publish CSS/HTML/JS products with live previews. */
accountSections.store = async function store(content) {
  let docs = [];
  try { docs = (await api.get('/code-products')).docs || []; } catch { /* offline */ }
  el(content, `
    <h2 class="section-title">Code Store Manager</h2>
    <p style="color:var(--muted);margin-bottom:16px">Publish code components (CSS / HTML / JS). Buyers see the code AND a live preview of the result.</p>
    <form class="card form" id="new-code" style="max-width:none;margin-bottom:24px">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px">
        <label>Title <input name="title" required minlength="2" maxlength="120" /></label>
        <label>Language
          <select name="language"><option>css</option><option>html</option><option>js</option><option>full</option></select>
        </label>
        <label>Price (USD) <input name="price" type="number" min="0" value="15" /></label>
      </div>
      <label>Description <input name="description" maxlength="2000" /></label>
      <label>Code <textarea name="code" rows="6" required placeholder=".my-class { color: teal; }"></textarea></label>
      <label>Live preview HTML (optional — full page rendered next to the code)
        <textarea name="previewHtml" rows="4" placeholder="&lt;!DOCTYPE html&gt;…"></textarea>
      </label>
      <button class="btn btn-primary">Publish to store</button>
    </form>
    ${table(['Title', 'Language', 'Price', 'Status', ''], docs.map((c) => `
      <tr><td>${escapeHtml(c.title)}</td><td>${c.language}</td><td>$${Number(c.price).toFixed(2)}</td>
      <td><span class="tag ${c.status === 'published' ? 'ok' : ''}">${c.status}</span></td>
      <td><button class="btn btn-sm btn-danger" data-del-code="${c.id}">Delete</button></td></tr>`))}`);

  content.querySelector('#new-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await api.post('/code-products', { ...data, price: Number(data.price) });
      toast('Published to the Code Store!');
      accountSections.store(content);
    } catch (err) { toast(err.message, 'error'); }
  });
  content.querySelectorAll('[data-del-code]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this code product?')) return;
    try { await api.del(`/code-products/${btn.dataset.delCode}`); toast('Deleted'); accountSections.store(content); }
    catch (e) { toast(e.message, 'error'); }
  }));
};

accountSections.security = async function security(content) {
  const { docs } = await api.get('/admin/audit-logs?limit=30');
  el(content, `
    <h2 class="section-title">Security & Audit</h2>
    <p style="color:var(--muted);margin-bottom:16px">Security events. Passwords, hashes, tokens and keys are never logged.</p>
    ${table(['Time', 'Action', 'Category', 'Actor', 'IP'],
      docs.map((l) => `<tr><td>${new Date(l.createdAt).toLocaleString()}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.category)}</td>
        <td>${escapeHtml(l.actorEmail || '—')}</td><td>${escapeHtml(l.ip || '—')}</td></tr>`))}
    <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
      <button class="btn btn-primary" id="btn-backup">Create encrypted backup</button>
      <button class="btn" id="btn-list-backups">List backups</button>
      <div id="backup-result" style="width:100%"></div>
    </div>`);
  content.querySelector('#btn-backup').addEventListener('click', async () => {
    try {
      const res = await api.post('/admin/backups');
      content.querySelector('#backup-result').innerHTML =
        `<p style="color:var(--ok);margin-top:12px">Backup created: ${res.backup.name} (${(res.backup.size / 1024).toFixed(1)} KB, ${res.backup.tables} tables, AES-256-GCM)</p>`;
    } catch (e) { toast(e.message, 'error'); }
  });
  content.querySelector('#btn-list-backups').addEventListener('click', async () => {
    try {
      const res = await api.get('/admin/backups');
      content.querySelector('#backup-result').innerHTML =
        `<ul class="features" style="margin-top:12px">${res.backups.map((b) => `<li>${b.name} — ${(b.size / 1024).toFixed(1)} KB</li>`).join('') || '<li>No backups yet</li>'}</ul>`;
    } catch (e) { toast(e.message, 'error'); }
  });
};

accountSections.settings = async function settings(content, user) {
  let sessions = [];
  try { sessions = await mySessions(); } catch { /* ignore */ }
  el(content, `
    <h2 class="section-title">Settings</h2>
    <div class="grid grid-2">
      <div class="card">
        <h3>Profile</h3>
        <p style="margin:10px 0">${escapeHtml(user.name)} · ${escapeHtml(user.email)}</p>
        <span class="tag ok">${user.role}</span>
        <form class="form" id="pw-change" style="margin-top:16px;max-width:none">
          <h4 style="color:var(--text)">Change password</h4>
          <label>Current password <input name="current" type="password" required autocomplete="current-password" /></label>
          <label>New password <input name="next" type="password" required minlength="10" autocomplete="new-password" /></label>
          <button class="btn btn-primary btn-sm">Update password</button>
          <p class="error-text" id="pw-error"></p>
        </form>
      </div>
      <div class="card">
        <h3>Active sessions</h3>
        ${table(['Device', 'IP', 'Signed in', ''], sessions.map((s) => `
          <tr><td>${escapeHtml((s.userAgent || 'Unknown').slice(0, 40))}</td><td>${escapeHtml(s.ip || '—')}</td>
          <td>${formatDate(s.createdAt)}</td>
          <td><button class="btn btn-sm btn-danger" data-revoke="${s.id}">Revoke</button></td></tr>`))}
      </div>
    </div>`);
  content.querySelector('#pw-change').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await changePassword(fd.get('current'), fd.get('next'));
      toast('Password updated');
      e.target.reset();
    } catch (err) {
      content.querySelector('#pw-error').textContent = err.message;
    }
  });
  content.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    try { await revokeSession(b.dataset.revoke); toast('Session revoked'); accountSections.settings(content, getUser()); }
    catch (e) { toast(e.message, 'error'); }
  }));
};
