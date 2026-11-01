/** Global footer (i18n-aware). */
import { t } from '../utils/i18n.js';
import { href } from '../links.js';

export function renderFooter() {
  document.getElementById('site-footer').innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="logo" style="margin-bottom:10px"><span class="logo-mark">C</span> CNW</div>
          <p>${t('footer.tagline')}</p>
        </div>
        <div>
          <h4>${t('footer.company')}</h4>
          <ul>
            <li><a href="${href('/about')}">${t('nav.about')}</a></li>
            <li><a href="${href('/contact')}">${t('nav.contact')}</a></li>
            <li><a href="${href('/pricing')}">${t('nav.pricing')}</a></li>
          </ul>
        </div>
        <div>
          <h4>${t('footer.services')}</h4>
          <ul>
            <li><a href="${href('/designs/formal')}">Formal Design</a></li>
            <li><a href="${href('/designs/3d')}">3D Design</a></li>
            <li><a href="${href('/designs/3d-animation')}">3D Animation</a></li>
            <li><a href="${href('/designs/interactive')}">Interactive</a></li>
          </ul>
        </div>
        <div>
          <h4>${t('footer.contact')}</h4>
          <ul>
            <li><a href="https://wa.me/201102734090" target="_blank" rel="noopener">WhatsApp: 01102734090</a></li>
            <li><a href="mailto:youssef1mahmouf24@gmail.com">youssef1mahmouf24@gmail.com</a></li>
            <li><a href="https://github.com/youssef1mahmouf" target="_blank" rel="noopener">GitHub</a></li>
            <li><a href="https://www.linkedin.com/in/youssef1mahmouf" target="_blank" rel="noopener">LinkedIn</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} CNW — Create New Website. ${t('footer.rights')}</span>
        <span>
          <a href="mailto:youssef1mahmouf24@gmail.com" aria-label="Email">✉️</a> ·
          <a href="https://wa.me/201102734090" target="_blank" rel="noopener" aria-label="WhatsApp">WhatsApp</a> ·
          <a href="https://github.com/youssef1mahmouf" target="_blank" rel="noopener" aria-label="GitHub">GitHub</a> ·
          <a href="https://www.linkedin.com/in/youssef1mahmouf" target="_blank" rel="noopener" aria-label="LinkedIn">LinkedIn</a>
        </span>
      </div>
    </div>`;
}
