/** Forgot / Reset password page (user/forgot.html — supports #/reset?token=… and ?token=…). */
import { forgotPassword, resetPassword } from '../auth/store.js';
import { toast } from '../utils/toast.js';
import { href, go } from '../links.js';

export async function render(page) {
  const hash = location.hash;
  const queryToken = new URLSearchParams(location.search).get('token') || '';
  const isReset = hash.includes('reset') || Boolean(queryToken);
  const urlToken = isReset ? (hash.split('token=')[1] || queryToken || '') : '';

  page.innerHTML = `
    <section class="section">
      <div class="container" style="display:grid;place-items:center">
        <form class="form card" id="pw-form" style="width:100%">
          <h2 style="text-align:center">${isReset ? 'Set a new password' : 'Forgot password'}</h2>
          ${isReset ? `
            ${urlToken ? '' : '<label>Reset token <input name="token" required /></label>'}
            <label>New password <input name="password" type="password" required minlength="10" autocomplete="new-password" /></label>
          ` : `
            <label>Email <input name="email" type="email" required /></label>
          `}
          <button class="btn btn-primary" type="submit">${isReset ? 'Reset password' : 'Send reset link'}</button>
          <p class="error-text" id="pw-error"></p>
          <p style="color:var(--muted);font-size:0.9rem"><a href="${href('/login')}">Back to sign in</a></p>
        </form>
      </div>
    </section>`;

  page.querySelector('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = page.querySelector('#pw-error');
    errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      if (isReset) {
        const token = urlToken || fd.get('token');
        await resetPassword(token, fd.get('password'));
        toast('Password reset! Please sign in.');
        go('/login');
      } else {
        const res = await forgotPassword(fd.get('email'));
        if (res.devToken) {
          // Development only: the backend returns the token so the flow is testable without email.
          page.querySelector('#pw-error').style.color = 'var(--primary-2)';
          page.querySelector('#pw-error').textContent = `Dev mode — reset token: ${res.devToken}`;
        } else {
          toast('If the account exists, a reset link has been sent.');
        }
      }
    } catch (err) {
      errEl.style.color = '';
      errEl.textContent = err.message;
    }
  });
}
