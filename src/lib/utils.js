export const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const inr = n => { n = Number(n || 0); const f = Number.isInteger(n) ? 0 : 2; return '₹' + n.toLocaleString('en-IN', {minimumFractionDigits: f, maximumFractionDigits: f}); };
export const today = () => new Date().toISOString().slice(0, 10);
export const nowStamp = () => new Date().toLocaleString('en-IN', {dateStyle: 'medium', timeStyle: 'short'});
export const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 864e5);
export const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'}) : '';
export const monthKey = d => d.slice(0, 7);
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function amountInWords(num) {
  num = Math.round(num);
  if (num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = n => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  const three = n => (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
  const parts = [];
  const crore = Math.floor(num / 1e7); num %= 1e7;
  const lakh = Math.floor(num / 1e5); num %= 1e5;
  const th = Math.floor(num / 1e3); num %= 1e3;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (th) parts.push(two(th) + ' Thousand');
  if (num) parts.push(three(num));
  return parts.join(' ') + ' Rupees Only';
}
export function fyOf(date) {
  const d = new Date(date + 'T00:00:00'); const y = d.getFullYear(), m = d.getMonth();
  const s = m >= 3 ? y : y - 1;
  return String(s).slice(2) + '-' + String(s + 1).slice(2);
}
export function downloadFile(name, text, type) {
  const blob = new Blob([text], {type});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function toCSV(rows) {
  return rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
}

