/** CNW vanilla table helpers (alternative to @tanstack/react-table).
 * @tanstack/react-table ships React hooks — incompatible with this vanilla-JS
 * MPA — so it is intentionally NOT installed. These pure helpers add
 * sort/filter/paginate behaviour on top of the existing `table()` renderer
 * in `src/pages/dashboard-ui.js` for future admin tables.
 */

/** Sort rows by key. direction: 'asc' | 'desc'. Works for strings/numbers/dates. */
export function sortRows(rows, key, direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

/** Case-insensitive substring filter across the given keys (or all keys). */
export function filterRows(rows, query, keys = []) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const vals = keys.length ? keys.map((k) => r?.[k]) : Object.values(r || {});
    return vals.some((v) => String(v ?? '').toLowerCase().includes(q));
  });
}

/** Slice rows into a page. Returns { page, totalPages, total, rows }. */
export function paginateRows(rows, { page = 1, perPage = 20 } = {}) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safe = Math.min(Math.max(1, page), totalPages);
  const start = (safe - 1) * perPage;
  return { page: safe, totalPages, total, rows: rows.slice(start, start + perPage) };
}
