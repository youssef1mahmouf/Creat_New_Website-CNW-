/** Lucide icon rendering helper (tree-shaken SVG icons). */
import { createIcons, icons } from 'lucide';

export function renderIcons(scope = document) {
  createIcons({ icons, nameAttr: 'data-lucide', attrs: { width: 18, height: 18 } });
}
