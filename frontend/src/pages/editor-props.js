/** Design editor — properties panel & toolbar logic. */
import { escapeHtml } from '../utils/toast.js';

export function attachPropsPanel({ page, canvas, getData, draw, newLayer }) {
  let selectedId = null;

  function select(id) {
    selectedId = id;
    const layer = getData().layers.find((l) => l.id === id);
    const body = page.querySelector('#props-body');
    if (!layer) { body.innerHTML = '<p style="color:var(--muted)">Select a layer</p>'; draw(); return; }
    body.innerHTML = `
      <div class="prop-row"><span>X</span><input type="number" data-prop="x" value="${layer.x}" /></div>
      <div class="prop-row"><span>Y</span><input type="number" data-prop="y" value="${layer.y}" /></div>
      <div class="prop-row"><span>Width</span><input type="number" data-prop="w" value="${layer.w}" /></div>
      <div class="prop-row"><span>Height</span><input type="number" data-prop="h" value="${layer.h}" /></div>
      <div class="prop-row"><span>Color</span><input type="color" data-prop="color" value="${layer.color}" /></div>
      <div class="prop-row"><span>Radius</span><input type="number" data-prop="radius" value="${layer.radius || 8}" /></div>
      ${layer.type === 'text' ? `
        <div class="prop-row"><span>Text</span><input data-prop="text" value="${escapeHtml(layer.text)}" /></div>
        <div class="prop-row"><span>Font size</span><input type="number" data-prop="fontSize" value="${layer.fontSize || 16}" /></div>` : ''}
      <button class="btn btn-sm btn-danger" id="del-layer" style="margin-top:8px">Delete layer</button>`;
    body.querySelectorAll('[data-prop]').forEach((input) => {
      input.addEventListener('input', () => {
        const prop = input.dataset.prop;
        layer[prop] = prop === 'text' ? input.value : (input.type === 'number' ? parseFloat(input.value) || 0 : input.value);
        draw();
      });
    });
    body.querySelector('#del-layer').addEventListener('click', () => {
      const data = getData();
      data.layers = data.layers.filter((l) => l.id !== id);
      selectedId = null;
      body.innerHTML = '<p style="color:var(--muted)">Select a layer</p>';
      draw();
    });
    draw();
  }

  // Expose select to the canvas click handler via dataset on canvas element
  canvas.addEventListener('shape-selected', (e) => select(e.detail));

  return { select };
}

export function wireToolbar({ page, canvasData, designId, designName, draw, toast, api }) {
  page.querySelector('#add-shape').addEventListener('click', () => {
    canvasData.layers.push(makeLayer('rect'));
    draw();
  });
  page.querySelector('#add-text').addEventListener('click', () => {
    canvasData.layers.push(makeLayer('text'));
    draw();
  });
  page.querySelector('#save-canvas').addEventListener('click', async () => {
    try {
      if (!designId) { toast('No design record loaded — open one from Dashboard → Designs', 'error'); return; }
      await api.put(`/designs/${designId}/canvas`, { canvas: canvasData });
      toast('Design saved');
    } catch (e) { toast(e.message, 'error'); }
  });
  page.querySelector('#preview').addEventListener('click', () => {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Preview — ${escapeHtml(designName)}</title></head>
      <body style="margin:0;background:${canvasData.background};position:relative;width:100vw;height:100vh">
      ${canvasData.layers.map((l) => l.type === 'text'
        ? `<div style="position:absolute;left:${l.x}px;top:${l.y}px;color:${l.color};font-size:${l.fontSize}px;font-family:sans-serif">${escapeHtml(l.text)}</div>`
        : `<div style="position:absolute;left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px;background:${l.color};border-radius:${l.radius}px"></div>`).join('')}
      </body></html>`);
    w.document.close();
  });
}

function makeLayer(type) {
  return {
    id: `l${Date.now()}`, type,
    x: 60 + Math.random() * 120, y: 60 + Math.random() * 120,
    w: type === 'text' ? 220 : 140, h: type === 'text' ? 40 : 110,
    color: ['#6c5ce7', '#00cec9', '#fd79a8', '#fdcb6e'][Math.floor(Math.random() * 4)],
    text: type === 'text' ? 'Double-click to edit' : '',
    fontSize: 18, radius: 10,
  };
}
