/** /editor — original Figma-like visual design editor: canvas, layers, properties, preview. */
import { api } from '../api/client.js';
import { isAdmin } from '../auth/store.js';
import { toast, escapeHtml } from '../utils/toast.js';
import { href } from '../links.js';

export async function render(page) {
  if (!isAdmin()) {
    page.innerHTML = `<section class="section"><div class="container">
      <h1 class="section-title">Design Editor</h1><p class="section-sub">Admins only. <a href="${href('/login')}">Sign in</a>.</p></div></section>`;
    return;
  }

  // In the multi-page site the design id arrives as ?design=<id>.
  const designId = new URLSearchParams(location.search).get('design') || '';
  let canvasData = { layers: [], background: '#0b0f1a' };
  let designName = 'Untitled design';
  if (designId) {
    try {
      const res = await api.get(`/designs/${designId}`);
      if (res.doc?.data?.layers) canvasData = res.doc.data;
      if (res.doc?.name) designName = res.doc.name;
    } catch { /* fresh canvas */ }
  }

  page.innerHTML = `
    <section class="section" style="padding-top:30px">
      <div class="container">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <h1 class="section-title" style="margin:0">Design Editor — ${escapeHtml(designName)}</h1>
          <div style="display:flex;gap:10px">
            <button class="btn btn-sm" id="add-shape">+ Shape</button>
            <button class="btn btn-sm" id="add-text">+ Text</button>
            <button class="btn btn-sm btn-primary" id="save-canvas">Save</button>
            <button class="btn btn-sm" id="preview">Preview</button>
          </div>
        </div>
        <div class="editor-layout">
          <div class="card" id="layers-panel" style="padding:14px"><h4 style="margin-bottom:10px">Layers</h4><div id="layers-list"></div></div>
          <div class="canvas-area" id="editor-canvas" style="min-height:560px"></div>
          <div class="card" id="props-panel" style="padding:14px"><h4 style="margin-bottom:10px">Properties</h4><div id="props-body"><p style="color:var(--muted)">Select a layer</p></div></div>
        </div>
      </div>
    </section>`;

  const canvas = page.querySelector('#editor-canvas');
  canvas.style.background = canvasData.background;
  let selectedId = null;

  function draw() {
    canvas.innerHTML = '';
    for (const layer of canvasData.layers) {
      const el = document.createElement('div');
      el.className = 'canvas-shape';
      el.dataset.id = layer.id;
      el.style.cssText = `left:${layer.x}px;top:${layer.y}px;width:${layer.w}px;height:${layer.h}px;
        background:${layer.type === 'text' ? 'transparent' : layer.color};color:${layer.color};
        border:${layer.type === 'text' ? 'none' : `2px solid ${layer.color}`};border-radius:${layer.radius || 8}px;
        font-size:${layer.fontSize || 16}px;${selectedId === layer.id ? 'outline:2px solid var(--primary-2)' : ''}`;
      el.textContent = layer.type === 'text' ? layer.text : '';
      makeDraggable(el, layer);
      el.addEventListener('click', (e) => { e.stopPropagation(); select(layer.id); });
      canvas.appendChild(el);
    }
    renderLayers();
  }

  function makeDraggable(el, layer) {
    el.addEventListener('pointerdown', (e) => {
      const startX = e.clientX - layer.x;
      const startY = e.clientY - layer.y;
      const move = (ev) => {
        layer.x = ev.clientX - startX;
        layer.y = ev.clientY - startY;
        el.style.left = `${layer.x}px`;
        el.style.top = `${layer.y}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function renderLayers() {
    const list = page.querySelector('#layers-list');
    list.innerHTML = canvasData.layers.map((l) => `
      <div class="layer-item ${selectedId === l.id ? 'active' : ''}" data-layer="${l.id}">
        ${l.type === 'text' ? `“${escapeHtml(l.text)}”` : `${l.type} ${l.w}×${l.h}`}
      </div>`).join('') || '<p style="color:var(--muted);font-size:0.85rem">Empty canvas</p>';
    list.querySelectorAll('[data-layer]').forEach((item) => {
      item.addEventListener('click', () => select(item.dataset.layer));
    });
  }

  const newLayer = (type) => ({
    id: `l${Date.now()}`, type,
    x: 60 + Math.random() * 120, y: 60 + Math.random() * 120,
    w: type === 'text' ? 220 : 140, h: type === 'text' ? 40 : 110,
    color: ['#6c5ce7', '#00cec9', '#fd79a8', '#fdcb6e'][Math.floor(Math.random() * 4)],
    text: type === 'text' ? 'Double-click to edit' : '',
    fontSize: 18, radius: 10,
  });

  // ---- properties panel & toolbar (editor-props.js) ----
  const { attachPropsPanel, wireToolbar } = await import('./editor-props.js');
  const { select } = attachPropsPanel({ page, canvas, getData: () => canvasData, draw });
  wireToolbar({ page, canvasData, designId, designName, draw, toast, api });

  canvas.addEventListener('click', () => {
    selectedId = null;
    page.querySelector('#props-body').innerHTML = '<p style="color:var(--muted)">Select a layer</p>';
    draw();
  });

  draw();
}
