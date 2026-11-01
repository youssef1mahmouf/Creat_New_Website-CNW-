/**
 * Terminal presentation layer for the CNW backend developer console.
 *
 * Pure Node.js — no dependency. Responsibilities:
 *  - ANSI colors, but NEVER color-only meaning: every line stays readable
 *    when colors are stripped (NO_COLOR, pipes, legacy CMD).
 *  - Layout primitives: banner, section, aligned `label : value` rows, tables.
 *  - Unicode box drawing when the terminal can render it, plain ASCII
 *    otherwise (Windows 10 conhost / CMD), so output is never mojibake.
 *
 * Overrides: CNW_TERM_ASCII=1 (force ASCII), CNW_TERM_UNICODE=1 (force Unicode),
 * CNW_NO_COLOR=1 (disable colors), NO_COLOR / FORCE_COLOR (standard).
 */

const isWindows = process.platform === 'win32';

/** True when the terminal is expected to render UTF-8 box drawing correctly. */
function detectUnicode() {
  if (process.env.CNW_TERM_ASCII === '1') return false;
  if (process.env.CNW_TERM_UNICODE === '1') return true;
  if (!isWindows) return true;
  // Piped / redirected output (log files, `> out.txt`, collectors): legacy
  // Windows console hosts transcode UTF-8 box drawing into mojibake, so
  // default to plain ASCII there. Interactive terminals still get Unicode.
  if (process.stdout && !process.stdout.isTTY) return false;
  // Modern Windows terminals advertise themselves; legacy conhost (cp437) does not.
  return Boolean(
    process.env.WT_SESSION || process.env.ALACRITTY_WINDOW_ID ||
    process.env.TERM_PROGRAM || process.env.TERM ||
    process.env.ANSICON || process.env.ConEmuANSI === 'ON' ||
    process.env.CI
  );
}

/** True when ANSI escape codes should be emitted. */
function detectColor() {
  if (process.env.CNW_NO_COLOR === '1' || process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  if (!process.stdout || !process.stdout.isTTY) return false;
  // Legacy Windows console without a known VT-capable host: keep colors off.
  return detectUnicode();
}

const UNICODE = detectUnicode();
const COLOR = detectColor();

const GLYPH = UNICODE
  ? { h: '─', H: '═', ok: '✓', warn: '!', err: '×', dot: '·' }
  : { h: '-', H: '=', ok: '+', warn: '!', err: 'x', dot: '.' };

const CODES = {
  reset: 0, bold: 1, dim: 2,
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90,
};

/** Wrap text in an ANSI style (no-op when colors are disabled). */
function paint(text, ...styles) {
  const value = String(text);
  if (!COLOR || styles.length === 0) return value;
  const codes = styles.map((s) => CODES[s]).filter((c) => c !== undefined);
  if (codes.length === 0) return value;
  return `\x1b[${codes.join(';')}m${value}\x1b[${CODES.reset}m`;
}

const DEFAULT_WIDTH = 60;
const MIN_WIDTH = 46;
const MAX_WIDTH = 100;

/** Usable console width (columns), clamped so columns never wrap badly. */
function width() {
  const cols = (process.stdout && process.stdout.columns) || 0;
  if (!cols) return DEFAULT_WIDTH;
  return Math.min(Math.max(cols, MIN_WIDTH), MAX_WIDTH);
}

/** Horizontal rule across the current terminal width. */
function rule(char = GLYPH.h) {
  return char.repeat(width());
}

/** Centered double-line banner: `title` (optional `subtitle`). */
function banner(title, subtitle) {
  const w = width();
  const lines = [GLYPH.H.repeat(w)];
  const pad = (text) => {
    const textLength = String(text).length;
    const left = Math.max(1, Math.floor((w - textLength) / 2));
    return `${' '.repeat(left)}${text}`;
  };
  lines.push(paint(pad(title), 'bold', 'cyan'));
  if (subtitle) lines.push(paint(pad(subtitle), 'gray'));
  lines.push(GLYPH.H.repeat(w));
  return `${lines.join('\n')}\n`;
}

/** Section header: rule / ` TITLE` / rule. */
function section(title) {
  return `\n${rule()}\n${paint(` ${String(title).toUpperCase()}`, 'bold', 'cyan')}\n${rule()}\n`;
}

const TAG_STYLES = {
  ok: [' OK ', 'green'],
  warn: ['WARN', 'yellow'],
  err: ['ERROR', 'red'],
  info: ['INFO', 'cyan'],
  debug: ['DEBUG', 'gray'],
  boot: ['BOOT', 'cyan'],
  shutdown: ['SHUTDOWN', 'magenta'],
};

/** `[ TAG  ] text` line, e.g. `[BOOT] Starting backend...`. */
function tagLine(tag, text, color) {
  const padded = `[${String(tag).padStart(4)}]`;
  return `${color ? paint(padded, color) : padded} ${text}`;
}

/** Standalone tagged line (`[ OK ] text`, `[WARN] text`, ...). */
function line(tagKey, text) {
  const [tag, color] = TAG_STYLES[tagKey] || TAG_STYLES.info;
  return tagLine(tag, text, color);
}

// Track the widest label per block so columns stay aligned.
let labelWidth = 18;

/** Set label alignment for the current block (call before each block). */
function align(labels = []) {
  labelWidth = Math.max(18, ...labels.map((l) => String(l).length + 1));
}

/** `[ OK ] Label            : value` row for status/diagnostic blocks. */
function status(tagKey, label, value = '') {
  const [tag, color] = TAG_STYLES[tagKey] || TAG_STYLES.info;
  const padded = String(label).padEnd(labelWidth, ' ');
  const suffix = value === undefined || value === null || value === '' ? '' : ` : ${value}`;
  return tagLine(tag, `${padded}${suffix}`, color);
}

/** Plain aligned `Label : value` row (no status tag), indented under status rows. */
function kv(label, value = '') {
  const padded = String(label).padEnd(labelWidth, ' ');
  return `${' '.repeat(7)}${padded} : ${value}`;
}

/** Two-column table (used for the API route listing). */
function table(rows, { leftWidth = 8, gap = 2 } = {}) {
  const w = width();
  return rows
    .map(([left, right]) => {
      const method = String(left).padEnd(leftWidth, ' ');
      const colored = /^(GET|POST|PUT|PATCH|DELETE)$/.test(left)
        ? paint(method, left === 'GET' ? 'green' : left === 'DELETE' ? 'red' : 'yellow')
        : paint(method, 'gray');
      const room = Math.max(10, w - leftWidth - gap);
      const text = String(right);
      return `  ${colored}${' '.repeat(gap)}${text.length > room ? `${text.slice(0, room - 1)}~` : text}`;
    })
    .join('\n');
}

/** Write a block of text (adds the trailing newline). */
function print(text = '') {
  process.stdout.write(`${text}\n`);
}

module.exports = {
  COLOR, UNICODE, GLYPH, paint, width, rule, banner, section, line, tagLine,
  align, status, kv, table, print,
};