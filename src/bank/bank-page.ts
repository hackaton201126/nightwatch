import { RiskResponse } from '../contracts';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderBankPage(decisions: RiskResponse[]): string {
  const rows = decisions
    .map((d) => {
      const p = d.classification?.takeover_probability;
      const cells = [
        d.decided_at,
        d.transaction_id,
        d.decision,
        d.decided_by,
        p === undefined ? '' : String(p),
        d.explanation.analyst,
      ];
      return `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>Demo bank — Nightwatch decisions</title>
<style>body{font-family:sans-serif}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}table{border-collapse:collapse}</style>
</head>
<body>
<h1>Nightwatch decisions</h1>
<table>
<thead><tr><th>Time</th><th>Transaction</th><th>Decision</th><th>Decided by</th><th>Takeover probability</th><th>Analyst explanation</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}
