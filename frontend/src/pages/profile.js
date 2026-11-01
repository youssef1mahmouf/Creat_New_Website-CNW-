/**
 * Profile page — edit the extended Tohama-style info
 * (name, phone, WhatsApp, business, site purpose, budget, bio).
 */
import { getUser, updateProfile } from '../auth/store.js';
import { toast } from '../utils/toast.js';
import { go } from '../links.js';

export async function render(page) {
  const user = getUser();
  if (!user) { toast('Please sign in first', 'error'); go('/login'); return; }

  page.innerHTML = `
    <section class="section">
      <div class="container" style="max-width:720px">
        <h1 class="section-title" data-animate>My Profile</h1>
        <p class="section-sub" data-animate>This info helps us contact you and build the right website — it appears in your chat profile too.</p>
        <form class="form card" id="profile-form" style="max-width:none">
          <h3>👤 Account</h3>
          <label>Full name <input name="name" required minlength="2" maxlength="100" value="${escape(user.name || '')}" /></label>
          <label>Email <input value="${escape(user.email || '')}" disabled /></label>

          <h3 style="margin-top:18px;font-size:1rem">📞 Contact</h3>
          <label>Phone <input name="phone" type="tel" maxlength="40" value="${escape(user.phone || '')}" /></label>
          <label>WhatsApp number <input name="whatsapp" type="tel" maxlength="40" value="${escape(user.whatsapp || '')}" placeholder="+20 1xx xxx xxxx" /></label>

          <h3 style="margin-top:18px;font-size:1rem">💼 Business</h3>
          <label>Business / brand name <input name="business" maxlength="120" value="${escape(user.business || '')}" /></label>
          <label>Business type
            <select name="businessType">
              ${['', 'Store / E-commerce', 'Restaurant / Café', 'Clinic / Health', 'School / Education', 'Company / Services', 'Portfolio / Personal', 'Other']
                .map((t) => `<option ${user.businessType === t ? 'selected' : ''}>${t || 'Select…'}</option>`).join('')}
            </select>
          </label>
          <label>What do you want to build?
            <textarea name="sitePurpose" rows="3" maxlength="500">${escape(user.sitePurpose || '')}</textarea>
          </label>
          <label>Budget range
            <select name="budget">
              ${['', 'Under $100', '$100 – $500', '$500 – $1500', '$1500 – $5000', '$5000+']
                .map((b) => `<option ${user.budget === b ? 'selected' : ''}>${b || 'Select…'}</option>`).join('')}
            </select>
          </label>
          <label>About you <textarea name="bio" rows="3" maxlength="1000">${escape(user.bio || '')}</textarea></label>

          <button class="btn btn-primary" type="submit">Save profile</button>
          <p class="error-text" id="profile-error"></p>
        </form>
      </div>
    </section>`;

  page.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const errEl = page.querySelector('#profile-error');
    errEl.textContent = '';
    btn.disabled = true;
    try {
      const fd = new FormData(e.target);
      const updated = await updateProfile({
        name: fd.get('name'),
        phone: fd.get('phone'),
        whatsapp: fd.get('whatsapp'),
        business: fd.get('business'),
        businessType: fd.get('businessType'),
        sitePurpose: fd.get('sitePurpose'),
        budget: fd.get('budget'),
        bio: fd.get('bio'),
      });
      toast(`Profile saved${updated?.name ? `, ${updated.name}` : ''}!`);
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

const escape = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');