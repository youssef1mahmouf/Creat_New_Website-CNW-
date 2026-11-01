/**
 * Contact page — standalone page (user/contact.html) with its own stylesheet
 * (styles/contact.css). Layout inspired by the Tohama reference site
 * (hero band + info card grid + FAQ) with a security-hardened form:
 * honeypot field, submission time-trap, client validation and the backend
 * contact rate limiter (10 submissions/hour/IP).
 */
import { toast } from '../utils/toast.js';
import { getUser } from '../auth/store.js';
import { api } from '../api/client.js';
import { t } from '../utils/i18n.js';
import { href } from '../links.js';

export async function render(page) {
  const openedAt = Date.now(); // time-trap: measured again on submit

  page.innerHTML = `
    <section class="cu-hero">
      <div class="container">
        <div class="cu-hero-grid">
          <div>
            <span class="cu-kicker">Get in touch</span>
            <h1 class="section-title">Contact <span class="gradient-text">Us</span></h1>
            <p>Reach me directly — I usually reply within one business day.
               Every submission is protected by spam filtering and rate limiting,
               and your message is stored securely and encrypted at rest.</p>
          </div>
          <div class="cu-hero-badges">
            <div class="cu-badge">🛡️ Honeypot + time-trap spam protection</div>
            <div class="cu-badge">⏱️ Rate limited (10 / hour / IP)</div>
            <div class="cu-badge">🔐 Encrypted at rest, audited access</div>
          </div>
        </div>
      </div>
    </section>

    <section class="cu-section">
      <div class="container">
        <div class="cu-grid cu-grid-3" data-stagger>
          <div class="card cu-info"><div class="icon-wrap">📞</div><h3>Phone</h3><p><a href="tel:+201102734090">+20 110 273 4090</a></p></div>
          <div class="card cu-info"><div class="icon-wrap">💬</div><h3>WhatsApp</h3><p><a href="https://wa.me/201102734090?text=Hi%20Youssef%2C%20I%27m%20interested%20in%20a%20website%20project" target="_blank" rel="noopener">01102734090</a></p></div>
          <div class="card cu-info"><div class="icon-wrap">📧</div><h3>Email</h3><p><a href="mailto:youssef1mahmouf24@gmail.com">youssef1mahmouf24@gmail.com</a></p></div>
          <div class="card cu-info"><div class="icon-wrap">🐙</div><h3>GitHub</h3><p><a href="https://github.com/youssef1mahmouf" target="_blank" rel="noopener">github.com/youssef1mahmouf</a></p></div>
          <div class="card cu-info"><div class="icon-wrap">💼</div><h3>LinkedIn</h3><p><a href="https://www.linkedin.com/in/youssef1mahmouf" target="_blank" rel="noopener">Youssef Mahmouf</a></p></div>
          <div class="card cu-info"><div class="icon-wrap">🌍</div><h3>Location</h3><p>Remote-first, worldwide</p></div>
        </div>
        <div class="cu-grid cu-grid-2" id="contact-grid">
          <form class="form card cu-form" id="contact-form" novalidate>
            <h3>Project inquiry</h3>

            <!-- Honeypot: hidden from humans, bots fill it → silent spam drop -->
            <div class="hp-field" aria-hidden="true">
              <label>Company website (leave empty)
                <input name="honeypot" type="text" tabindex="-1" autocomplete="off" />
              </label>
            </div>

            <label>Name
              <input name="name" required minlength="2" maxlength="100" autocomplete="name" />
            </label>
            <label>Email
              <input name="email" type="email" required maxlength="200" autocomplete="email" />
            </label>
            <label>Phone <span style="color:var(--muted);font-weight:400">(optional)</span>
              <input name="phone" type="tel" maxlength="40" autocomplete="tel" />
            </label>
            <label>Project type
              <select name="type">
                <option>Formal Design</option><option>3D Design</option>
                <option>3D Animation</option><option>Interactive Design</option>
                <option>Other / not sure yet</option>
              </select>
            </label>
            <label>Message
              <textarea name="message" rows="5" required minlength="5" maxlength="4000"></textarea>
              <span class="cu-counter"><span id="msg-count">0</span> / 4000</span>
            </label>

            <button class="btn btn-primary" type="submit" id="contact-send">${t('common.send')}</button>
            <p class="error-text" id="contact-error" role="alert"></p>
            <p class="cu-security-note">🔒 This form is monitored for spam and abuse. Submissions are rate limited and stored securely.</p>
          </form>

          <aside class="cu-aside">
            <div class="card">
              <h3>⚡ Fast response</h3>
              <p style="color:var(--muted)">Messages sent through this form reach me instantly by email and SMS. Average first reply: under one business day.</p>
            </div>
            <div class="card">
              <h3>❓ FAQ</h3>
              <details class="cu-faq"><summary>How long does a website take?</summary><p style="color:var(--muted)">A formal site typically ships in 1–2 weeks; 3D and interactive builds take 2–4 weeks depending on scope.</p></details>
              <details class="cu-faq"><summary>Do you work with existing designs?</summary><p style="color:var(--muted)">Yes — send any Figma/Sketch files or references and I will turn them into a fast, secure build.</p></details>
              <details class="cu-faq"><summary>Is maintenance included?</summary><p style="color:var(--muted)">Every package includes a support window; ongoing care plans are available on request.</p></details>
            </div>
            <div class="card">
              <h3>🤖 AI assistant</h3>
              <p style="color:var(--muted)">Or ask our AI assistant${getUser() ? ` in your <a href="${href('/dashboard/ai')}">dashboard</a>` : ` after <a href="${href('/login')}">signing in</a>`}.</p>
            </div>
          </aside>
        </div>
      </div>
    </section>`;

  // ---- Live character counter ----
  const msgEl = page.querySelector('[name="message"]');
  const counter = page.querySelector('#msg-count');
  msgEl.addEventListener('input', () => { counter.textContent = String(msgEl.value.length); });

  // ---- Secure submission: client validation + honeypot + time-trap ----
  page.querySelector('#contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('#contact-send');
    const errEl = form.querySelector('#contact-error');
    errEl.textContent = '';

    // Client-side validation (the backend validates everything again).
    let invalid = false;
    ['name', 'email', 'message'].forEach((f) => {
      const input = form.querySelector(`[name="${f}"]`);
      const ok = input.checkValidity();
      input.classList.toggle('invalid', !ok);
      if (!ok) invalid = true;
    });
    if (invalid) {
      errEl.textContent = 'Please fill in the highlighted fields correctly.';
      return;
    }

    btn.disabled = true;
    try {
      const fd = new FormData(form);
      await api.post('/contact', {
        name: String(fd.get('name') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        phone: String(fd.get('phone') || '').trim(),
        type: fd.get('type'),
        message: String(fd.get('message') || '').trim(),
        honeypot: fd.get('honeypot') || '',
        elapsedMs: Date.now() - openedAt,
      });
      form.reset();
      counter.textContent = '0';
      toast(t('contact.success'));
    } catch (err) {
      errEl.textContent = err.message || t('contact.error');
      toast(t('contact.error'), 'error');
    } finally {
      btn.disabled = false;
    }
  });
}
