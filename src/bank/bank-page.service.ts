import { Injectable } from '@nestjs/common';
import { RiskResponse } from '../contracts';
import { SendOutcome } from './scenario-sender.service';
import { SCENARIO_IDS, SCENARIO_LABELS } from './scenarios.constants';

export interface ScenarioView {
  configured: boolean;
  sends: SendOutcome[];
}

@Injectable()
export class BankPageService {
  escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  render(decisions: RiskResponse[], scenarios: ScenarioView): string {
    const buttons = SCENARIO_IDS.map(
      (id) =>
        `<form method="post" action="/bank/scenarios/${id}" style="display:inline"><button type="submit"${scenarios.configured ? '' : ' disabled'}>${this.escapeHtml(SCENARIO_LABELS[id])}</button></form>`,
    ).join('\n');
    const note = scenarios.configured
      ? ''
      : '<p>Scenarios are disabled: set NIGHTWATCH_WEBHOOK_URL and NIGHTWATCH_WEBHOOK_SECRET.</p>';
    const sendRows = scenarios.sends
      .map((o) => {
        const cells = [o.at, SCENARIO_LABELS[o.scenario], o.transactionId, o.accepted ? 'accepted' : 'not accepted', o.detail];
        return `<tr>${cells.map((c) => `<td>${this.escapeHtml(c)}</td>`).join('')}</tr>`;
      })
      .join('\n');
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
        return `<tr>${cells.map((c) => `<td>${this.escapeHtml(c)}</td>`).join('')}</tr>`;
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
<h1>Scenarios</h1>
${buttons}
${note}
<table>
<thead><tr><th>Sent</th><th>Scenario</th><th>Transaction</th><th>Webhook</th><th>Detail</th></tr></thead>
<tbody>
${sendRows}
</tbody>
</table>
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
}
