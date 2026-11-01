/** Dashboard sections: pages / designs / projects / plugins. */
import { api } from '../api/client.js';
import { toast, escapeHtml, formatDate, formatPrice } from '../utils/toast.js';
import { table } from './dashboard-ui.js';
import { el, bindCreate, bindDelete } from './dashboard-sections.js';
import { href } from '../links.js';

// Design type helpers for visual preview
const DESIGN_GRADIENTS = {
  'formal': '#1e3a5f, #2d5a87',
  '3d': '#667eea, #764ba2',
  '3d-animation': '#f093fb, #f5576c',
  'interactive': '#4facfe, #00f2fe',
};
const DESIGN_ICONS = {
  'formal': '🏢',
  '3d': '🧊',
  '3d-animation': '🎬',
  'interactive': '🎮',
};

function getDesignGradient(type) {
  return DESIGN_GRADIENTS[type] || '#667eea, #764ba2';
}

function getDesignIcon(type) {
  return DESIGN_ICONS[type] || '📄';
}

export const contentSections = {
  async pages(content) {
    const { docs } = await api.get('/pages?limit=100');
    el(content, `
      <h2 class="section-title">Pages</h2>
      <form class="card" id="new-page" style="margin-bottom:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;max-width:none">
        <input name="title" placeholder="Title" required />
        <input name="slug" placeholder="slug-url" required pattern="[a-z0-9-]+" />
        <select name="status"><option>draft</option><option>published</option></select>
        <button class="btn btn-primary">Create page</button>
      </form>
      ${table(['Title', 'Slug', 'Status', 'Updated', 'Actions'],
        docs.map((p) => `<tr><td>${escapeHtml(p.title)}</td><td>${escapeHtml(p.slug)}</td><td>${escapeHtml(p.status)}</td><td>${formatDate(p.updatedAt)}</td>
          <td><button class="btn btn-sm btn-danger" data-del="${p.id}">Delete</button></td></tr>`))}`);
    bindCreate(content, 'new-page', '/pages', 'Page created', 'pages');
    bindDelete(content, '/pages');
  },

  async designs(content) {
    const { docs } = await api.get('/designs?limit=100');
    let filterType = 'all';
    let filterStatus = 'all';
    
    function renderDesigns(designs) {
      const filtered = designs.filter(d => {
        if (filterType !== 'all' && d.designType !== filterType) return false;
        if (filterStatus !== 'all' && d.status !== filterStatus) return false;
        return true;
      });
      
      el(content, `
        <h2 class="section-title">🎨 Designs</h2>
        <div class="card filters" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:20px">
          <span style="font-weight:600">Filter:</span>
          <select id="design-filter-type" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border)">
            <option value="all" ${filterType === 'all' ? 'selected' : ''}>All types</option>
            <option value="formal" ${filterType === 'formal' ? 'selected' : ''}>Formal</option>
            <option value="3d" ${filterType === '3d' ? 'selected' : ''}>3D</option>
            <option value="3d-animation" ${filterType === '3d-animation' ? 'selected' : ''}>3D Animation</option>
            <option value="interactive" ${filterType === 'interactive' ? 'selected' : ''}>Interactive</option>
          </select>
          <select id="design-filter-status" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border)">
            <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>All status</option>
            <option value="active" ${filterStatus === 'active' ? 'selected' : ''}>Active</option>
            <option value="draft" ${filterStatus === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="archived" ${filterStatus === 'archived' ? 'selected' : ''}>Archived</option>
          </select>
          <span class="tag" id="design-count">${filtered.length} designs</span>
        </div>
        <div class="grid grid-3" id="designs-grid">
          ${filtered.map((d) => `
            <div class="card design-card" data-id="${d.id}">
              <div class="design-preview" style="height:120px;background:linear-gradient(135deg,${getDesignGradient(d.designType)});border-radius:8px;display:flex;align-items:center;justify-content:center;color:white;font-size:2rem;overflow:hidden">
                <span style="text-shadow:0 2px 8px rgba(0,0,0,0.3)">${getDesignIcon(d.designType)}</span>
              </div>
              <div class="design-info">
                <h3>${escapeHtml(d.name)}</h3>
                <div class="design-meta">
                  <span class="tag">${d.designType}</span>
                  <span class="tag ${d.status === 'active' ? 'ok' : d.status === 'draft' ? 'warn' : 'off'}">${d.status}</span>
                  ${d.price ? `<span class="tag" style="background:#00b894;color:white">${formatPrice(d.price, d.currency || 'USD')}</span>` : ''}
                </div>
                <p style="margin-top:10px;color:var(--muted);font-size:0.9rem">${escapeHtml(d.concept || 'No description')}</p>
                ${d.capabilities?.length ? `<div style="margin:10px 0;display:flex;flex-wrap:wrap;gap:6px">${(d.capabilities || []).map(c => `<span class="tag small">${c}</span>`).join('')}</div>` : ''}
                <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
                  <a class="btn btn-sm btn-primary" href="${href('/editor')}?design=${d.id}">✏️ Edit</a>
                  <a class="btn btn-sm" href="${href('/designs')}?design=${d.id}" target="_blank">👁️ Preview</a>
                  <button class="btn btn-sm btn-danger" data-del-design="${d.id}" ${d.status === 'active' ? '' : 'disabled'}>🗑️</button>
                </div>
              </div>
            </div>`).join('')}
        </div>
        ${filtered.length === 0 ? '<div class="card" style="text-align:center;padding:40px"><p style="color:var(--muted)">No designs match the filter</p></div>' : ''}`);
      
      // Bind filter events
      content.querySelector('#design-filter-type')?.addEventListener('change', (e) => {
        filterType = e.target.value;
        renderDesigns(docs);
      });
      content.querySelector('#design-filter-status')?.addEventListener('change', (e) => {
        filterStatus = e.target.value;
        renderDesigns(docs);
      });
      content.querySelectorAll('[data-del-design]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this design?')) return;
          try {
            await api.del(`/designs/${btn.dataset.delDesign}`);
            toast('Design deleted');
            renderDesigns(docs);
          } catch (e) { toast(e.message, 'error'); }
        });
      });
    }
    
    renderDesigns(docs);
  },

  async projects(content) {
    const { docs } = await api.get('/projects?limit=100');
    el(content, `
      <h2 class="section-title">Projects</h2>
      <form class="card" id="new-project" style="margin-bottom:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;max-width:none">
        <input name="name" placeholder="Project name" required />
        <select name="type"><option>website</option><option>app</option><option>system</option></select>
        <button class="btn btn-primary">Create project</button>
      </form>
      ${table(['Name', 'Type', 'Status', 'Created'],
        docs.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.type)}</td><td>${escapeHtml(p.status)}</td><td>${formatDate(p.createdAt)}</td></tr>`))}`);
    bindCreate(content, 'new-project', '/projects', 'Project created', 'projects');
  },

  async plugins(content) {
    const { plugins } = await api.get('/plugins');
    el(content, `
      <h2 class="section-title">Plugins</h2>
      <p style="color:var(--muted);margin-bottom:16px">Permission-based plugin system — plugins only access what you grant.</p>
      <form class="card" id="install-plugin" style="margin-bottom:20px;display:grid;gap:12px;max-width:none">
        <textarea name="manifest" rows="5" placeholder='{"id":"my-plugin","name":"My Plugin","version":"1.0.0","permissions":["read:products"]}'></textarea>
        <button class="btn btn-primary">Install plugin (manifest JSON)</button>
      </form>
      <div class="grid grid-2">
        ${plugins.map((p) => `
          <div class="card">
            <h3>${escapeHtml(p.name)} <span class="tag">v${p.version}</span></h3>
            <p>${escapeHtml(p.description)}</p>
            <p style="margin:10px 0">${(p.permissions || []).map((x) => `<span class="tag">${escapeHtml(x)}</span>`).join('')}</p>
            <span class="tag ${p.status === 'active' ? 'ok' : p.status === 'blocked' ? 'off' : 'warn'}">${p.status}</span>
            <div style="display:flex;gap:10px;margin-top:14px">
              ${p.status === 'active'
                ? `<button class="btn btn-sm" data-deact="${p.pluginId}">Deactivate</button>`
                : `<button class="btn btn-sm btn-primary" data-act="${p.pluginId}">Activate</button>`}
              <button class="btn btn-sm btn-danger" data-uninstall="${p.pluginId}">Uninstall</button>
            </div>
          </div>`).join('')}
      </div>`);
    content.querySelector('#install-plugin').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const manifest = JSON.parse(new FormData(e.target).get('manifest'));
        await api.post('/plugins', manifest);
        toast('Plugin installed');
        contentSections.plugins(content);
      } catch (err) { toast(`Install failed: ${err.message}`, 'error'); }
    });
    content.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.post(`/plugins/${b.dataset.act}/activate`); toast('Activated'); contentSections.plugins(content); }
      catch (e) { toast(e.message, 'error'); }
    }));
    content.querySelectorAll('[data-deact]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.post(`/plugins/${b.dataset.deact}/deactivate`); toast('Deactivated'); contentSections.plugins(content); }
      catch (e) { toast(e.message, 'error'); }
    }));
    content.querySelectorAll('[data-uninstall]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.del(`/plugins/${b.dataset.uninstall}`); toast('Uninstalled'); contentSections.plugins(content); }
      catch (e) { toast(e.message, 'error'); }
    }));
  },
};
