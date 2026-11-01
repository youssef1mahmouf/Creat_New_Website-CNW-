/** Dashboard sections: products / orders / payments (shop operations). */
import { getUser } from '../auth/store.js';
import { api } from '../api/client.js';
import { toast, escapeHtml, formatPrice, formatDate } from '../utils/toast.js';
import { table } from './dashboard-ui.js';
import { el, bindCreate, bindDelete } from './dashboard-sections.js';

export const shopSections = {
  async products(content) {
    const { docs } = await api.get('/products?limit=100');
    el(content, `
      <h2 class="section-title">Products & Pricing</h2>
      <form class="card" id="new-product" style="margin-bottom:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;max-width:none">
        <input name="name" placeholder="Name" required />
        <input name="price" type="number" min="0" step="0.01" placeholder="Price" required />
        <select name="designType"><option>formal</option><option>3d</option><option>3d-animation</option><option>interactive</option></select>
        <select name="availability"><option>available</option><option>limited</option><option>unavailable</option></select>
        <input name="features" placeholder="Features (comma separated)" />
        <button class="btn btn-primary">Add product</button>
      </form>
      ${table(['Name', 'Price', 'Type', 'Availability', 'Actions'],
        docs.map((p) => `
          <tr>
            <td>${escapeHtml(p.name)}</td><td>${formatPrice(p.price, p.currency)}</td><td>${escapeHtml(p.designType)}</td>
            <td><select data-avail="${p.id}">${['available', 'limited', 'unavailable'].map((a) => `<option ${p.availability === a ? 'selected' : ''}>${a}</option>`).join('')}</select></td>
            <td><button class="btn btn-sm btn-danger" data-del="${p.id}">Delete</button></td>
          </tr>`))}`);
    bindCreate(content, 'new-product', '/products', 'Product created', 'products');
    content.querySelectorAll('[data-avail]').forEach((sel) => sel.addEventListener('change', async () => {
      try { await api.put(`/products/${sel.dataset.avail}`, { availability: sel.value }); toast('Updated'); }
      catch (e) { toast(e.message, 'error'); }
    }));
    bindDelete(content, '/products');
  },

  async orders(content, user) {
    const mine = !['admin', 'super_admin'].includes(user.role);
    const { docs } = await api.get('/orders');
    el(content, `<h2 class="section-title">${mine ? 'My Orders' : 'Orders'}</h2>
      ${table(['Order', 'Total', 'Status', 'Date'],
        docs.map((o) => `<tr><td>${escapeHtml(o.id.slice(0, 8))}…</td><td>${formatPrice(o.total, o.currency)}</td><td>${escapeHtml(o.status)}</td><td>${formatDate(o.createdAt)}</td></tr>`))}`);
  },

  async payments(content, user) {
    const mine = !['admin', 'super_admin'].includes(user.role);
    const { docs } = await api.get(mine ? '/payments' : '/admin/payments');
    el(content, `<h2 class="section-title">${mine ? 'My Payments' : 'Payments'}</h2>
      ${table(['Payment', 'Amount', 'Provider', 'Status', 'Date'],
        docs.map((p) => `<tr><td>${escapeHtml(p.id.slice(0, 8))}…</td><td>${formatPrice(p.amount, p.currency)}</td><td>${escapeHtml(p.provider)}</td><td>${escapeHtml(p.status)}</td><td>${formatDate(p.createdAt)}</td></tr>`))}`);
  },
};
