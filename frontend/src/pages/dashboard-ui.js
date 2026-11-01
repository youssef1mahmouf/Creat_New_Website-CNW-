/** Shared dashboard UI helpers. */
export function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" style="color:var(--muted)">No data</td></tr>`}</tbody></table></div>`;
}
