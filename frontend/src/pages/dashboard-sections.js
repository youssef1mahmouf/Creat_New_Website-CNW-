/** Dashboard sections: dispatcher + overview + users. */
import { getUser } from '../auth/store.js';
import { api } from '../api/client.js';
import { toast, escapeHtml, formatPrice, formatDate } from '../utils/toast.js';
import { table } from './dashboard-ui.js';
import { shopSections } from './dashboard-shop.js';
import { contentSections, adminSections } from './dashboard-sections2.js';

export const el = (content, html) => { content.innerHTML = html; return content; };

export async function renderSection(content, section, user) {
  if (shopSections[section]) return shopSections[section](content, user);
  if (contentSections[section]) return contentSections[section](content, user);
  if (adminSections[section]) return adminSections[section](content, user);
  switch (section) {
    case 'overview': return overview(content);
    case 'users': return users(content);
    default: return overview(content);
  }
}

export function bindCreate(content, formId, endpoint, message, section) {
  content.querySelector(`#${formId}`)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try { await api.post(endpoint, data); toast(message); renderSection(content, section, getUser()); }
    catch (err) { toast(err.message, 'error'); }
  });
}

export function bindDelete(content, endpoint) {
  content.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await api.del(`${endpoint}/${btn.dataset.del}`); toast('Deleted'); btn.closest('tr')?.remove(); btn.closest('.card')?.remove(); }
    catch (e) { toast(e.message, 'error'); }
  }));
}

async function overview(content) {
  const { stats = {}, ordersByStatus = {}, paymentsByStatus = {}, paymentsByProvider = {},
    currencyTotals = {}, dbType, recentOrders = [] } = await api.get('/admin/overview');
  const { statCard } = await import('../components/stat-card.js');
  const { lineChart, barChart, donutChart } = await import('../components/charts.js');

  // ---- Professional graphics from real data ----
  // 1) Revenue per day (last 14 days) from recent orders → area chart.
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (13 - i));
    return d;
  });
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const totals = days.map((d) => recentOrders
    .filter((o) => String(o.createdAt || '').slice(0, 10) === dayKey(d))
    .reduce((s, o) => s + (Number(o.total) || 0), 0));
  const labels = days.map((d) => `${d.getDate()}/${d.getMonth() + 1}`);

  // 2) Orders per day (last 14 days) → bar chart.
  const counts = days.map((d) => recentOrders
    .filter((o) => String(o.createdAt || '').slice(0, 10) === dayKey(d)).length);

  // 3) Status breakdown → donut chart (prefer the full server-side breakdown,
  // which covers ALL orders — not just the 5 recent ones).
  const STATUS_COLORS = { paid: '#00b894', pending: '#fdcb6e', failed: '#e17055', refunded: '#6c5ce7' };
  const statusCounts = Object.keys(ordersByStatus).length ? ordersByStatus : recentOrders.reduce((m, o) => {
    const k = o.status || 'unknown';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const segments = Object.entries(statusCounts).map(([label, value], i) => ({
    label, value, color: STATUS_COLORS[label] || ['#00cec9', '#fd79a8', '#8b7cf7', '#e17055'][i % 4],
  }));

  el(content, `
    <h2 class="section-title">Overview</h2>
    <p style="color:var(--muted);margin-bottom:16px">Tohama-style live figures — users, admins signed in, orders and total payments.</p>
    <div class="stat-grid">
      ${statCard('Users', stats.users ?? 0, 'users')}
      ${statCard('Admins', stats.admins ?? 0, 'shield-check')}
      ${statCard('Active users', stats.activeUsers ?? stats.users ?? 0, 'user-check')}
      ${statCard('Users signed in', stats.signedInUsers ?? 0, 'activity')}
      ${statCard('Admins signed in', stats.signedInAdmins ?? 0, 'eye')}
      ${statCard('Orders', stats.orders ?? 0, 'shopping-bag')}
      ${statCard('Paid orders', stats.paidOrders ?? 0, 'check-circle')}
      ${statCard('Pending orders', stats.pendingOrders ?? 0, 'clock')}
      ${statCard('Total payments', formatPrice(stats.totalPayments ?? 0), 'credit-card')}
    </div>
    <p><span class="tag ok">database: ${dbType}</span>
      ${Object.entries(currencyTotals).map(([c, v]) => `<span class="tag">${c}: ${formatPrice(v, c)}</span>`).join('')}</p>

    <div class="charts-grid">
      <div class="card chart-card">
        <h3>📈 Revenue — last 14 days</h3>
        ${lineChart(totals, labels)}
      </div>
      <div class="card chart-card">
        <h3>🍩 Orders by status</h3>
        ${donutChart(segments)}
      </div>
      <div class="card chart-card" style="grid-column:1 / -1">
        <h3>📊 Orders per day — last 14 days</h3>
        ${barChart(counts, labels)}
      </div>
      <div class="card chart-card">
        <h3>💳 Payments by status</h3>
        ${table(['Status', 'Count', 'Total'],
          Object.entries(paymentsByStatus).map(([s, v]) =>
            `<tr><td>${escapeHtml(s)}</td><td>${v.count}</td><td>${formatPrice(v.total)}</td></tr>`))}
      </div>
      <div class="card chart-card">
        <h3>🏦 Payments by provider</h3>
        ${table(['Provider', 'Count', 'Total'],
          Object.entries(paymentsByProvider).map(([p, v]) =>
            `<tr><td>${escapeHtml(p)}</td><td>${v.count}</td><td>${formatPrice(v.total)}</td></tr>`))}
      </div>
    </div>

    <h3 style="margin:24px 0 12px">Recent orders</h3>
    ${table(['Order', 'Total', 'Status', 'Date'],
      recentOrders.map((o) => `<tr><td>${escapeHtml(o.id.slice(0, 8))}…</td><td>${formatPrice(o.total)}</td><td>${escapeHtml(o.status)}</td><td>${formatDate(o.createdAt)}</td></tr>`))}`);
}

async function users(content) {
  const { docs } = await api.get('/admin/users');
  const me = getUser();
  el(content, `
    <h2 class="section-title">Users</h2>
    ${table(['Name', 'Email', 'Role', 'Status', 'Actions'],
      docs.map((u) => `
        <tr>
          <td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td>
          <td><select data-role="${u.id}" ${me.role !== 'super_admin' || u.id === me.id ? 'disabled' : ''}>
            ${['user', 'admin', 'super_admin'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select></td>
          <td><span class="tag ${u.status === 'active' ? 'ok' : 'off'}">${u.status}</span></td>
          <td>
            <button class="btn btn-sm" data-toggle-status="${u.id}" data-cur="${u.status}">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
            ${me.role === 'super_admin' && u.id !== me.id ? `<button class="btn btn-sm btn-danger" data-del-user="${u.id}">Delete</button>` : ''}
          </td>
        </tr>`))}`);
  content.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
    try { await api.put(`/admin/users/${sel.dataset.role}`, { role: sel.value }); toast('Role updated'); }
    catch (e) { toast(e.message, 'error'); }
  }));
  content.querySelectorAll('[data-toggle-status]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await api.put(`/admin/users/${btn.dataset.toggleStatus}`, { status: btn.dataset.cur === 'active' ? 'suspended' : 'active' });
      toast('Status updated');
    } catch (e) { toast(e.message, 'error'); }
  }));
  content.querySelectorAll('[data-del-user]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Delete this user?')) return;
    try { await api.del(`/admin/users/${btn.dataset.delUser}`); toast('User deleted'); btn.closest('tr').remove(); }
    catch (e) { toast(e.message, 'error'); }
  }));
}
