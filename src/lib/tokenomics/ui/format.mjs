// Display formatters for the tokenomics page. Pure, string in and out.
// null and non-finite input give 'n/a' everywhere.

function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

// $123 under 1,000; $12.3k from 1,000; $1.23M from 1,000,000.
export function fmtUsd(x) {
  const v = num(x);
  if (v === null) return 'n/a';
  if (v < 1000) return '$' + Math.round(v);
  if (v < 1e6) return '$' + (v / 1000).toFixed(1) + 'k';
  return '$' + (v / 1e6).toFixed(2) + 'M';
}

// Three significant digits, for cost per million output tokens ($0.123).
export function fmtUsdSmall(x) {
  const v = num(x);
  if (v === null) return 'n/a';
  return '$' + String(Number(v.toPrecision(3)));
}

// Axis ticks: powers of ten without trailing zeros ($100, $1k, $10k, $1M, $10M,
// $1B, $0.1, $0.01); any other number falls back to fmtUsd.
export function fmtUsdAxis(x) {
  const v = num(x);
  if (v === null) return 'n/a';
  if (v <= 0) return fmtUsd(v);
  const e = Math.round(Math.log10(v));
  if (Math.abs(Math.log10(v) - e) > 1e-6) return fmtUsd(v);
  if (v < 1) return '$' + String(v);
  const unit = e >= 9 ? 1e9 : e >= 6 ? 1e6 : e >= 3 ? 1e3 : 1;
  const suffix = e >= 9 ? 'B' : e >= 6 ? 'M' : e >= 3 ? 'k' : '';
  return '$' + String(Math.round(v / unit)) + suffix;
}

// Integer with thousands separators (1,234,567).
export function fmtInt(x) {
  const v = num(x);
  if (v === null) return 'n/a';
  return Math.round(v).toLocaleString('en-US');
}

// 4,000 under 10,000; 40.0k under 1,000,000; 1.2M above.
export function fmtTokens(x) {
  const v = num(x);
  if (v === null) return 'n/a';
  if (v < 1e4) return fmtInt(v);
  if (v < 1e6) return (v / 1e3).toFixed(1) + 'k';
  return (v / 1e6).toFixed(1) + 'M';
}

// 0..1 to a percent string (0.45 -> 45%).
export function fmtPct(x) {
  const v = num(x);
  if (v === null) return 'n/a';
  return Math.round(v * 100) + '%';
}

// Parallel streams, which can be below 1: whole numbers as ever ("1,000"), under 1
// up to two significant digits ("0.05", "0.3", never rounded up to 1), and one
// decimal only when a number between 1 and 100 is not whole ("2.5").
export function fmtStreams(x) {
  const v = num(x);
  if (v === null) return 'n/a';
  if (v < 1) return String(Math.min(0.99, Number(v.toPrecision(2))));
  if (v < 100 && !Number.isInteger(v)) return String(Number(v.toFixed(1)));
  return fmtInt(v);
}

// "1 parallel stream" for exactly 1, "N parallel streams" otherwise ("0.1 parallel streams").
export function streamsPhrase(x) {
  return x === 1 ? '1 parallel stream' : fmtStreams(x) + ' parallel streams';
}

// Axis ticks on a linear dollar axis: $0, $50, $250, $1.5k, $50k, $2M. Three
// significant digits at most, no trailing zeros.
export function fmtUsdTick(x) {
  const v = num(x);
  if (v === null) return 'n/a';
  const trim = (n) => String(Number(n.toPrecision(3)));
  if (v >= 1e6) return '$' + trim(v / 1e6) + 'M';
  if (v >= 1000) return '$' + trim(v / 1000) + 'k';
  return '$' + trim(v);
}

// A share already in percent (80, 33.3) as text: "80%", "33.3%", at most one decimal.
export function fmtShare(pct) {
  const v = num(pct);
  if (v === null) return 'n/a';
  return String(Math.round(v * 10) / 10) + '%';
}
