/** Reusable stat card for dashboards. */
import { escapeHtml } from '../utils/toast.js';

export function statCard(label, value, icon = 'activity') {
  return `
    <div class="stat">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="lbl">${escapeHtml(label)}</span>
        <i data-lucide="${escapeHtml(icon)}" style="color:var(--primary-2)"></i>
      </div>
      <div class="num">${escapeHtml(String(value))}</div>
    </div>`;
}
