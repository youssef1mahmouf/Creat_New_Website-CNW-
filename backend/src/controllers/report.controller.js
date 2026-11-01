/**
 * Report controller — admin data exports in Excel (xls), CSV and PDF.
 * Zero external dependencies:
 *  - xls  : Excel-compatible HTML table (Excel/WPS/Sheets open it natively)
 *  - csv  : standard comma-separated values
 *  - pdf  : minimal handcrafted PDF (Helvetica text grid)
 * Datasets: users | orders | payments | contact-messages | subscriptions | errors
 */
const db = require('../services/db.service');
const asyncHandler = require('../utils/async-handler');
const ApiError = require('../utils/api-error');

const DATASETS = {
  users: {
    title: 'CNW — Users Report',
    columns: ['ID', 'Name', 'Email', 'Role', 'Status', 'Phone', 'WhatsApp', 'Business', 'Business Type', 'Site Purpose', 'Budget', 'Registered', 'Last Login'],
    rows: async () => (await db.find('users', {}, { limit: 1000, sort: '-createdAt' })).docs.map((u) => [
      u.id, u.name, u.email, u.role, u.status, u.phone || '', u.whatsapp || '',
      u.business || '', u.businessType || '', u.sitePurpose || '', u.budget || '',
      u.createdAt || '', u.lastLoginAt || '',
    ]),
  },
  orders: {
    title: 'CNW — Orders Report',
    columns: ['ID', 'User ID', 'Items', 'Subtotal', 'Tax', 'Total', 'Currency', 'Status', 'Created'],
    rows: async () => (await db.find('orders', {}, { limit: 1000, sort: '-createdAt' })).docs.map((o) => [
      o.id, o.userId, (o.items || []).map((i) => `${i.name} x${i.quantity}`).join('; '),
      o.subtotal, o.tax, o.total, o.currency, o.status, o.createdAt,
    ]),
  },
  payments: {
    title: 'CNW — Payments Report',
    columns: ['ID', 'Order ID', 'User ID', 'Provider', 'Amount', 'Currency', 'Status', 'Created'],
    rows: async () => (await db.find('payments', {}, { limit: 1000, sort: '-createdAt' })).docs.map((p) => [
      p.id, p.orderId, p.userId, p.provider, p.amount, p.currency, p.status, p.createdAt,
    ]),
  },
  'contact-messages': {
    title: 'CNW — Contact Messages Report',
    columns: ['ID', 'Name', 'Email', 'Phone', 'Type', 'Status', 'Message', 'Created'],
    rows: async () => (await db.find('contact_messages', {}, { limit: 1000, sort: '-createdAt' })).docs.map((m) => [
      m.id, m.name, m.email, m.phone, m.type, m.status, String(m.message || '').slice(0, 300), m.createdAt,
    ]),
  },
  subscriptions: {
    title: 'CNW — Subscriptions Report',
    columns: ['ID', 'User ID', 'Plan', 'Cadence', 'Price', 'Currency', 'Status', 'Started', 'Renews'],
    rows: async () => (await db.find('subscriptions', {}, { limit: 1000, sort: '-createdAt' })).docs.map((s) => [
      s.id, s.userId, s.planName, s.cadence, s.price, s.currency, s.status, s.startedAt, s.renewsAt,
    ]),
  },
  errors: {
    title: 'CNW — Error Reports',
    columns: ['ID', 'Source', 'Level', 'Message', 'Path', 'Resolved', 'Created'],
    rows: async () => (await db.find('error_reports', {}, { limit: 1000, sort: '-createdAt' })).docs.map((e) => [
      e.id, e.source, e.level, String(e.message || '').slice(0, 200), e.path, e.resolved ? 'yes' : 'no', e.createdAt,
    ]),
  },
};

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pdfEsc = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?');

function toXls(title, columns, rows) {
  const th = columns.map((c) => `<th style="background:#6c5ce7;color:#fff;padding:6px;border:1px solid #999">${esc(c)}</th>`).join('');
  const trs = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:4px;border:1px solid #bbb">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head>
<body><h2>${esc(title)}</h2><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
}

function toCsv(columns, rows) {
  const line = (arr) => arr.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  return '\uFEFF' + [line(columns), ...rows.map(line)].join('\r\n');
}

/** Minimal valid PDF with one page of text lines (no dependencies). */
function toPdf(title, columns, rows) {
  const lines = [title, '', columns.join(' | ')];
  for (const r of rows) lines.push(r.map((c) => String(c ?? '').slice(0, 40)).join(' | '));

  let content = 'BT /F1 9 Tf 12 TL 36 800 Td\n';
  for (const l of lines.slice(0, 120)) content += `(${pdfEsc(l.slice(0, 130))}) Tj T*\n`;
  content += 'ET';

  const objs = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 842 842] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1} /Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

/** GET /api/admin/reports/:dataset?format=xls|csv|pdf — file download. */
exports.download = asyncHandler(async (req, res) => {
  const dataset = DATASETS[req.params.dataset];
  if (!dataset) throw ApiError.badRequest(`Unknown dataset. Use: ${Object.keys(DATASETS).join(', ')}`);
  const format = ['xls', 'csv', 'pdf'].includes(req.query.format) ? req.query.format : 'xls';
  const rows = await dataset.rows();
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `cnw-${req.params.dataset}-${stamp}`;

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv(dataset.columns, rows));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    return res.send(toPdf(dataset.title, dataset.columns, rows));
  }
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.xls"`);
  res.send(toXls(dataset.title, dataset.columns, rows));
});

/** GET /api/admin/reports — JSON summary for the AI + dashboard. */
exports.summary = asyncHandler(async (req, res) => {
  const [users, orders, payments, subs, messages] = await Promise.all([
    db.find('users', {}, { limit: 1000 }),
    db.find('orders', {}, { limit: 1000 }),
    db.find('payments', {}, { limit: 1000 }),
    db.find('subscriptions', {}, { limit: 1000 }),
    db.find('contact_messages', {}, { limit: 1000 }),
  ]);
  const paid = payments.docs.filter((p) => p.status === 'succeeded');
  const revenue = paid.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  res.json({
    success: true,
    summary: {
      users: users.total,
      orders: orders.total,
      paidOrders: orders.docs.filter((o) => o.status === 'paid').length,
      payments: payments.total,
      revenue: Math.round(revenue * 100) / 100,
      activeSubscriptions: subs.docs.filter((s) => s.status === 'active').length,
      contactMessages: messages.total,
      newMessages: messages.docs.filter((m) => m.status === 'new').length,
    },
    downloads: Object.fromEntries(
      Object.keys(DATASETS).flatMap((d) => [
        [`${d}.xls`, `/api/admin/reports/${d}?format=xls`],
        [`${d}.csv`, `/api/admin/reports/${d}?format=csv`],
        [`${d}.pdf`, `/api/admin/reports/${d}?format=pdf`],
      ]),
    ),
  });
});