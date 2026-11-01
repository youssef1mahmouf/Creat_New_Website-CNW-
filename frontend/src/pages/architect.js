/** /architect — visual architecture planning tool (nodes, connections, groups, export). */
import { toast } from '../utils/toast.js';

const NODE_TYPES = ['frontend', 'backend', 'api', 'database', 'service', 'group'];

export async function render(page) {
  page.innerHTML = `
    <section class="section">
      <div class="container">
        <h1 class="section-title" data-animate>Architecture Builder</h1>
        <p class="section-sub" data-animate>Plan websites, apps, systems, APIs and databases visually. Drag nodes, connect them, then export the plan as JSON.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px" id="toolbar">
          ${NODE_TYPES.map((t) => `<button class="btn btn-sm" data-add="${t}">+ ${t}</button>`).join('')}
          <button class="btn btn-sm btn-danger" id="clear-all">Clear</button>
          <button class="btn btn-sm btn-primary" id="export-plan">Export JSON</button>
          <button class="btn btn-sm" id="save-plan">Save as project</button>
        </div>
        <div class="canvas-area" id="arch-canvas"></div>
        <p class="tag" style="margin-top:10px" id="hint">Click a node then another to connect. Nodes are draggable.</p>
      </div>
    </section>`;

  const canvas = page.querySelector('#arch-canvas');
  const state = { nodes: [], links: [], selected: null, pendingLink: null };

  function addNode(type, x = 40 + Math.random() * 300, y = 40 + Math.random() * 300, label) {
    const node = { id: `n${Date.now()}${Math.floor(Math.random() * 999)}`, type, x, y, label: label || type };
    state.nodes.push(node);
    drawNode(node);
    return node;
  }

  function drawNode(node) {
    const el = document.createElement('div');
    el.className = 'arch-node';
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.dataset.id = node.id;
    el.innerHTML = `<div class="node-type">${node.type}</div><div class="node-label">${node.label}</div>`;
    canvas.appendChild(el);

    // Drag behaviour
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.selected = node.id;
      canvas.querySelectorAll('.arch-node').forEach((n) => n.classList.remove('selected'));
      el.classList.add('selected');

      // Connection mode: second click links nodes
      if (state.pendingLink && state.pendingLink !== node.id) {
        state.links.push([state.pendingLink, node.id]);
        state.pendingLink = null;
        drawLinks();
        return;
      }

      const startX = e.clientX - node.x;
      const startY = e.clientY - node.y;
      const move = (ev) => {
        node.x = Math.max(0, ev.clientX - startX);
        node.y = Math.max(0, ev.clientY - startY);
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        drawLinks();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    // Double-click to rename
    el.addEventListener('dblclick', () => {
      const name = prompt('Node label:', node.label);
      if (name) {
        node.label = name.slice(0, 40);
        el.querySelector('.node-label').textContent = node.label;
      }
    });

    // Click (without drag) selects for linking
    el.addEventListener('click', () => {
      if (state.pendingLink === null) state.pendingLink = node.id;
    });
  }

  function drawLinks() {
    canvas.querySelectorAll('svg.links').forEach((s) => s.remove());
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('links');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    const map = Object.fromEntries(state.nodes.map((n) => [n.id, n]));
    for (const [a, b] of state.links) {
      const na = map[a]; const nb = map[b];
      if (!na || !nb) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', na.x + 70); line.setAttribute('y1', na.y + 25);
      line.setAttribute('x2', nb.x + 70); line.setAttribute('y2', nb.y + 25);
      line.setAttribute('stroke', '#00cec9'); line.setAttribute('stroke-width', '2');
      svg.appendChild(line);
    }
    canvas.prepend(svg);
  }

  page.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => addNode(btn.dataset.add)));
  page.querySelector('#clear-all').addEventListener('click', () => {
    state.nodes = []; state.links = [];
    canvas.innerHTML = '';
  });
  page.querySelector('#export-plan').addEventListener('click', () => {
    const plan = {
      name: 'Architecture Plan',
      createdAt: new Date().toISOString(),
      nodes: state.nodes,
      connections: state.links.map(([a, b]) => ({ from: a, to: b })),
    };
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cnw-architecture-plan.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Plan exported');
  });
  page.querySelector('#save-plan').addEventListener('click', async () => {
    const name = prompt('Project name:', 'My Architecture');
    if (!name) return;
    try {
      const { api } = await import('../api/client.js');
      await api.post('/projects', {
        name,
        type: 'system',
        plan: { nodes: state.nodes, connections: state.links },
        status: 'draft',
      });
      toast('Saved as project (see Dashboard → Projects)');
    } catch (e) { toast(e.message, 'error'); }
  });

  // Starter nodes
  const f = addNode('frontend', 60, 60, 'Web App');
  const b = addNode('backend', 320, 60, 'Express API');
  const d = addNode('database', 320, 240, 'MongoDB');
  state.links.push([f.id, b.id], [b.id, d.id]);
  drawLinks();
}
