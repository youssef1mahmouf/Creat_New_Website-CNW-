/** Registration page — Tohama-style: account + contact/business info for the project. */
import { getUser, register } from '../auth/store.js';
import { toast } from '../utils/toast.js';
import { href, go } from '../links.js';

export async function render(page) {
  // Already signed in → don't show the form again, go home.
  if (getUser()) {
    go('/');
    return;
  }

  page.innerHTML = `
    <section class="section">
      <div class="container" style="display:grid;place-items:center">
        <form class="form card" id="register-form" style="width:100%;max-width:640px">
          <h2 style="text-align:center">Create your account</h2>
          <p style="color:var(--muted);text-align:center;margin-bottom:8px">Tell us about you and your business — it helps us build the perfect website for you.</p>

          <h3 style="margin-top:6px;font-size:1rem">👤 Account</h3>
          <label>Full name <input name="name" required minlength="2" maxlength="100" autocomplete="name" /></label>
          <label>Email <input name="email" type="email" required autocomplete="email" /></label>
          <label>Password
            <input name="password" type="password" required minlength="10" autocomplete="new-password" />
            <span style="font-size:0.78rem">Min 10 chars with upper, lower and a digit. Hashed with Argon2id.</span>
          </label>

          <h3 style="margin-top:18px;font-size:1rem">📞 Contact</h3>
          <label>Phone <input name="phone" type="tel" maxlength="40" autocomplete="tel" /></label>
          <label>WhatsApp number
            <input name="whatsapp" type="tel" maxlength="40" placeholder="+20 1xx xxx xxxx" />
            <span style="font-size:0.78rem">Used for in-site chat and project updates.</span>
          </label>

          <h3 style="margin-top:18px;font-size:1rem">💼 Business</h3>
          <label>Business / brand name <input name="business" maxlength="120" /></label>
          <label>Business type
            <select name="businessType">
              <option value="">Select…</option>
              <option>Store / E-commerce</option><option>Restaurant / Café</option>
              <option>Clinic / Health</option><option>School / Education</option>
              <option>Company / Services</option><option>Portfolio / Personal</option>
              <option>Other</option>
            </select>
          </label>
          <label>What do you want to build?
            <textarea name="sitePurpose" rows="3" maxlength="500" placeholder="e.g. An online store with 3D product showcase and WhatsApp ordering…"></textarea>
          </label>
          <label>Budget range
            <select name="budget">
              <option value="">Select…</option>
              <option>Under $100</option><option>$100 – $500</option>
              <option>$500 – $1500</option><option>$1500 – $5000</option>
              <option>$5000+</option>
            </select>
          </label>

          <button class="btn btn-primary" type="submit">Register</button>
          <p class="error-text" id="reg-error"></p>
          <p style="color:var(--muted);font-size:0.9rem">Already have an account? <a href="${href('/login')}">Sign in</a></p>
        </form>
      </div>
    </section>`;

  page.querySelector('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = page.querySelector('#reg-error');
    errEl.textContent = '';
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const fd = new FormData(e.target);
      await register(fd.get('name'), fd.get('email'), fd.get('password'), {
        phone: fd.get('phone'),
        whatsapp: fd.get('whatsapp'),
        business: fd.get('business'),
        businessType: fd.get('businessType'),
        sitePurpose: fd.get('sitePurpose'),
        budget: fd.get('budget'),
      });
      toast('Account created! Please sign in.');
      go('/login');
    } catch (err) {
      errEl.textContent = err.message;
      if (err.details) errEl.textContent += ` (${err.details.map((d) => d.message).join('; ')})`;
    } finally {
      btn.disabled = false;
    }
  });
}
