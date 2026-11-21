import { Injectable } from '@nestjs/common';
import { RiskResponse } from '@app/contracts';
import { PATH_IDS, PATH_LABELS } from './customers.constants';
import { CustomerCard } from './customers.service';
import { SendOutcome } from './transaction-sender.service';

export interface PageView {
  configured: boolean;
  sends: SendOutcome[];
  customers: CustomerCard[];
}

const STYLE = `
body{font-family:system-ui,sans-serif;margin:12px 20px;font-size:14px;color:#222}
h1{font-size:18px;margin:10px 0 6px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.card{border:1px solid #ccc;border-radius:6px;padding:8px 10px}
.card h2{font-size:15px;margin:0 0 4px}
.card dl{margin:0 0 6px;display:grid;grid-template-columns:auto 1fr;gap:1px 8px;font-size:12px}
.card dt{color:#666}.card dd{margin:0}
.card form{display:block;margin:3px 0}
.card button{width:100%;padding:4px;font-size:12px;cursor:pointer}
table{border-collapse:collapse;width:100%;font-size:12px}
td,th{border:1px solid #ddd;padding:3px 6px;text-align:left}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;color:#fff;font-weight:600}
.badge.allow{background:#2e9e4f}.badge.step_up{background:#e0a100}.badge.hold{background:#d63b3b}
.chip{display:inline-block;padding:1px 7px;border-radius:4px;background:#e8eaf0;color:#333}
`;

@Injectable()
export class BankPageService {
  escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  private aed(minor: number): string {
    return `AED ${Math.round(minor / 100).toLocaleString('en-US').replace(/,/g, ' ')}`;
  }

  private card(c: CustomerCard, configured: boolean): string {
    const e = (s: string) => this.escapeHtml(s);
    const buttons = PATH_IDS.map(
      (p) =>
        `<form method="post" action="/bank/customers/${encodeURIComponent(c.id)}/transactions/${p}"><button type="submit"${configured ? '' : ' disabled'}>${e(PATH_LABELS[p])}</button></form>`,
    ).join('');
    return `<div class="card"><h2>${e(c.name)}</h2><dl>
<dt>City</dt><dd>${e(c.city)}</dd>
<dt>Device</dt><dd>${e(c.deviceLabel)}</dd>
<dt>Usual hours</dt><dd>${e(c.hoursLabel)}</dd>
<dt>Logins</dt><dd>${c.loginsInHistory}</dd>
<dt>Sent 24 h</dt><dd>${c.sent24hCount} · ${e(this.aed(c.sent24hAmountMinor))}</dd>
</dl>${buttons}</div>`;
  }

  render(decisions: RiskResponse[], view: PageView): string {
    const td = (c: string) => `<td>${this.escapeHtml(c)}</td>`;
    const names = new Map(view.sends.map((o) => [o.transactionId, o.customerName]));
    const cards = view.customers.map((c) => this.card(c, view.configured)).join('\n');
    const note = view.configured
      ? ''
      : '<p>Buttons are disabled: set NIGHTWATCH_WEBHOOK_URL and NIGHTWATCH_WEBHOOK_SECRET.</p>';
    const sendRows = view.sends
      .map((o) => `<tr>${[o.at, o.customerName, PATH_LABELS[o.path], o.transactionId, o.accepted ? 'accepted' : 'not accepted', o.detail].map(td).join('')}</tr>`)
      .join('\n');
    const rows = decisions
      .map((d) => {
        const p = d.classification?.takeover_probability;
        const badgeClass = ['allow', 'step_up', 'hold'].includes(d.decision) ? d.decision : '';
        return `<tr>${td(d.decided_at)}${td(names.get(d.transaction_id) ?? '')}${td(d.transaction_id)}<td><span class="badge ${badgeClass}">${this.escapeHtml(d.decision)}</span></td><td><span class="chip">${this.escapeHtml(d.decided_by)}</span></td>${td(p === undefined ? '' : String(p))}${td(d.explanation.analyst)}</tr>`;
      })
      .join('\n');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>Demo bank — Nightwatch decisions</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Customers</h1>
<div class="cards">
${cards}
</div>
${note}
<h1>Sent to Nightwatch</h1>
<table>
<thead><tr><th>Sent</th><th>Customer</th><th>Path</th><th>Transaction</th><th>Webhook</th><th>Detail</th></tr></thead>
<tbody>
${sendRows}
</tbody>
</table>
<h1>Nightwatch decisions</h1>
<table>
<thead><tr><th>Time</th><th>Customer</th><th>Transaction</th><th>Decision</th><th>Decided by</th><th>Takeover probability</th><th>Analyst explanation</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
  }
}
