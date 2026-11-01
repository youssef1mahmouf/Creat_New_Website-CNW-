/** Login / Sign-in page — after sign-in always lands on the home page. */
import { getUser, login } from '../auth/store.js';
import { renderHeader } from '../layouts/header.js';
import { toast } from '../utils/toast.js';
import { href, go } from '../links.js';

export async function render(page) {
  // Already signed in → don't show the form again, go home.
  if (getUser()) {
    go('/');
    return;
  }

  if (location.hash.includes('logout')) {
    go('/login');
    return;
  }

  page.innerHTML = `
    <section class="section">
      <div class="container" style="display:grid;place-items:center">
        <form class="form card" id="login-form" style="width:100%">
          <h2 style="text-align:center">Welcome back</h2>
          <p style="color:var(--muted);text-align:center;margin-bottom:8px">Sign in to your CNW account</p>
          <label>Email <input name="email" type="email" required autocomplete="email" /></label>
          <label>Password <input name="password" type="password" required minlength="1" autocomplete="current-password" /></label>
          <button class="btn btn-primary" type="submit">Sign In</button>
          <p class="error-text" id="login-error"></p>
          <p style="color:var(--muted);font-size:0.9rem">
            <a href="${href('/register')}">Register</a> ·
            <a href="${href('/forgot')}">Forgot password?</a>
          </p>
        </form>
      </div>
    </section>`;

  page.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = page.querySelector('#login-error');
    errEl.textContent = '';
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const fd = new FormData(e.target);
      const user = await login(fd.get('email'), fd.get('password'));
      renderHeader();
      toast(`Welcome back, ${user.name}!`);
      go('/');
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
