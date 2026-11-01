/** Tohama-parity admin sections for the CNW dashboard.
 * Every section mirrors one Tohama admin page and uses the REAL CNW API:
 *  - messages : contact inbox + chat directory (Tohama chat.html)
 *  - coupons  : discount codes (Tohama coupons.html)
 *  - reports  : Excel/CSV/PDF hub (Tohama export pages)
 */
import { api } from '../api/client.js';
import { toast, escapeHtml } from '../utils/toast.js';
import { table } from './dashboard-ui.js';
import { el } from './dashboard-sections.js';

export const adminSections = {};

/** ✉️ Messages — contact inbox + in-site chat directory (Tohama chat.html). */
adminSections.messages = async function messages(content) {
  const [{ docs: inbox }, { contacts = [] }] = await Promise.all([
    api.get('/contact?limit=100').catch(() => ({ docs: [] })),
    api.get('/chat/contacts').catch(() => ({ contacts: [] })),
  ]);
  const fresh = inbox.filter((m) => m.status === 'new').length;
  el(content, `
    <h2 class="section-title">Messages ${fresh ? `<span class="tag warn">${fresh} new</span>` : ''}</h2>
    <div class="grid grid-2">
      <div class="card"><h3>📥 Contact inbox</h3>
        ${table(['From', 'Type', 'Status', 'Date', ''],
          inbox.slice(0, 30).map((m) => `<tr>
            <td><b>${escapeHtml(m.name)}</b><br/><small>${escapeHtml(m.email)}</small></td>
            <td>${escapeHtml(m.type)}</td>
            <td><span class="tag ${m.status === 'new' ? 'warn' : 'ok'}">${m.status}</span></td>
            <td>${(m.createdAt || '').slice(0, 10)}</td>
            <td><button class="btn btn-sm" data-read="${m.id}">Mark read</button></td>
          </tr>`))}
      </div>
      <div class="card"><h3>💬 In-site chat directory</h3>
        ${table(['Contact', 'Role', ''],
          contacts.slice(0, 30).map((c) => `<tr>
            <td>${escapeHtml(c.name)}${c.isSupport ? ' <span class="tag ok">SUPPORT</span>' : ''}</td>
            <td>${escapeHtml(c.role)}</td>
            <td><a class="btn btn-sm btn-primary" href="/user/chat.html">Open chat →</a></td>
          </tr>`))}
      </div>
    </div>`);
  content.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.put(`/contact/${b.dataset.read}`, { status: 'read' }); toast('Marked read'); b.closest('tr').remove(); }
    catch (e) { toast(e.message, 'error'); }
  }));
};

/** Coupons — discount codes (Tohama coupons.html). Stored server-side. */
adminSections.coupons = async function coupons(content) {
  let coupons = [];
  try { ({ docs: coupons } = await api.get('/coupons')); } catch { coupons = []; }
  el(content, `
    <h2 class="section-title">Coupons</h2>
    <form class="card" id="new-coupon" style="margin-bottom:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;max-width:none">
      <input name="code" placeholder="CODE (e.g. SAVE10)" required maxlength="24" style="text-transform:uppercase" />
      <input name="percent" type="number" min="1" max="90" placeholder="% off" required />
      <input name="maxUses" type="number" min="1" max="100000" placeholder="Max uses" />
      <button class="btn btn-primary">Create coupon</button>
    </form>
    ${table(['Code', '% off', 'Used', 'Max', 'Status', ''],
      coupons.map((c) => `<tr><td><b>${escapeHtml(c.code)}</b></td><td>${c.percent}%</td>
        <td>${c.usedCount || 0}</td><td>${c.maxUses || '∞'}</td>
        <td><span class="tag ${c.status === 'active' ? 'ok' : 'off'}">${c.status}</span></td>
        <td><button class="btn btn-sm btn-danger" data-del-coupon="${c.id}">Delete</button></td></tr>`))}`);
  content.querySelector('#new-coupon').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post('/coupons', {
        code: String(fd.get('code')).toUpperCase(),
        percent: Number(fd.get('percent')),
        maxUses: Number(fd.get('maxUses')) || null,
      });
      toast('Coupon created');
      adminSections.coupons(content);
    } catch (err) { toast(err.message, 'error'); }
  });
  content.querySelectorAll('[data-del-coupon]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this coupon?')) return;
    try { await api.del(`/coupons/${b.dataset.delCoupon}`); toast('Deleted'); b.closest('tr').remove(); }
    catch (e) { toast(e.message, 'error'); }
  }));
};

/** Reports hub — Excel/CSV/PDF downloads (Tohama export pages). */
adminSections.reports = async function reports(content) {
  const sets = ['users', 'orders', 'payments', 'contact-messages', 'subscriptions', 'errors'];
  el(content, `
    <h2 class="section-title">Reports</h2>
    <p style="color:var(--muted);margin-bottom:16px">One-click Excel / CSV / PDF downloads of every dataset.</p>
    <div class="grid grid-3">
      ${sets.map((d) => `<div class="card"><h3 style="text-transform:capitalize">${d.replace('-', ' ')}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <a class="btn btn-sm btn-primary" href="/api/admin/reports/${d}?format=xls">Excel</a>
          <a class="btn btn-sm" href="/api/admin/reports/${d}?format=csv">CSV</a>
          <a class="btn btn-sm" href="/api/admin/reports/${d}?format=pdf">PDF</a>
        </div></div>`).join('')}
    </div>`);
};

