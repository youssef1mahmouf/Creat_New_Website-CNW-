/** /ai-builder — describe a website, AI drafts a structured plan, admin approves. */
import { api } from '../api/client.js';
import { isAdmin } from '../auth/store.js';
import { toast, escapeHtml } from '../utils/toast.js';
import { href, go } from '../links.js';

export async function render(page) {
  if (!isAdmin()) {
    page.innerHTML = `<section class="section"><div class="container">
      <h1 class="section-title">AI Website Builder</h1>
      <p class="section-sub">This tool is available to admins. <a href="${href('/login')}">Sign in</a> with an admin account.</p>
    </div></section>`;
    return;
  }

  page.innerHTML = `
    <section class="section">
      <div class="container">
        <h1 class="section-title" data-animate>AI Website Builder</h1>
        <p class="section-sub" data-animate>Describe the website you want. The AI produces a structured plan → it is validated → you preview and approve → pages are generated as drafts. The AI never executes code directly.</p>
        <div class="card" style="max-width:760px">
          <form class="form" id="builder-form" style="max-width:none">
            <label>Description
              <textarea name="description" rows="4" required minlength="10"
                placeholder="Create a modern company website with a 3D hero section, services page, and contact form…"></textarea>
            </label>
            <button class="btn btn-primary">Generate plan</button>
            <p class="error-text" id="builder-error"></p>
          </form>
        </div>
        <div id="plan-output" style="margin-top:26px"></div>
      </div>
    </section>`;

  const output = page.querySelector('#plan-output');

  page.querySelector('#builder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = page.querySelector('#builder-error');
    errEl.textContent = '';
    output.innerHTML = '<p style="color:var(--muted)">Thinking…</p>';
    try {
      const fd = new FormData(e.target);
      const res = await api.post('/ai/builder', { description: fd.get('description') });
      if (!res.plan) {
        output.innerHTML = `<div class="card"><p>AI reply (no structured plan detected):</p><pre style="white-space:pre-wrap;color:var(--muted)">${escapeHtml(res.reply)}</pre></div>`;
        return;
      }
      const valid = res.validation?.valid;
      output.innerHTML = `
        <div class="card ${valid ? '' : ''}" style="border-color:${valid ? 'var(--ok)' : 'var(--danger)'}">
          <h3>Structured plan ${valid ? '✅ valid' : '❌ needs revision'}</h3>
          <pre style="white-space:pre-wrap;color:var(--muted);margin:14px 0">${escapeHtml(JSON.stringify(res.plan, null, 2))}</pre>
          ${valid
            ? `<button class="btn btn-primary" id="approve-plan">Approve & generate pages</button>`
            : `<p class="error-text">${(res.validation?.errors || []).map(escapeHtml).join('<br>')}</p>`}
        </div>`;
      output.querySelector('#approve-plan')?.addEventListener('click', async () => {
        try {
          const done = await api.post('/ai/builder/approve', { plan: res.plan });
          toast(`Project "${done.project.name}" created with draft pages!`);
          go('/dashboard/projects');
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) {
      output.innerHTML = '';
      errEl.textContent = err.message;
    }
  });
}
