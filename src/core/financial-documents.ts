import { safeBrandUrl } from './tenant-palette';

export interface InternalDocumentLine {
  concept: string;
  amount: number;
}
export interface InternalFinancialDocument {
  kind: 'TENANT_ACCOUNT' | 'OWNER_SETTLEMENT';
  issuer: string;
  taxId?: string;
  logoUrl?: string;
  recipient: string;
  reference: string;
  period: string;
  currency: string;
  lines: InternalDocumentLine[];
  recordedStatus: string;
  note?: string;
}

const escapeHtml = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[char] ?? char));
const money = (value: number, currency: string) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);

export function renderInternalDocument(document: InternalFinancialDocument): string {
  if (!document.issuer.trim() || !document.recipient.trim() || !document.reference.trim() || !document.period.trim())
    throw new Error('El comprobante requiere inmobiliaria, beneficiario, referencia y período.');
  if (!/^[A-Z]{3}$/.test(document.currency)) throw new Error('Moneda del documento inválida.');
  if (!document.lines.length || document.lines.some(line => !Number.isFinite(line.amount) || !line.concept.trim()))
    throw new Error('El comprobante contiene conceptos o valores inválidos.');
  const title = document.kind === 'TENANT_ACCOUNT' ? 'Estado de cuenta del inquilino' : 'Liquidación interna del propietario';
  const logo = safeBrandUrl(document.logoUrl) ?? null;
  const rows = document.lines.map(line => `<tr><td>${escapeHtml(line.concept)}</td><td class="number">${escapeHtml(money(line.amount, document.currency))}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body{font:15px Arial,sans-serif;color:#172033;padding:30px;max-width:820px;margin:auto;line-height:1.5}
      header{display:flex;align-items:center;gap:18px;border-bottom:2px solid #172033;padding-bottom:14px}
      header img{max-width:100px;max-height:75px;object-fit:contain}
      h1{font-size:22px;margin:24px 0 6px}h2{font-size:18px}
      .meta{color:#374151;margin-bottom:22px}table{width:100%;border-collapse:collapse;margin:24px 0}
      th,td{padding:12px;border-bottom:1px solid #e5e7eb;text-align:left}
      .number{text-align:right;white-space:nowrap}
      .notice{padding:12px;background:#fff3db;border-left:4px solid #c57916;margin-top:25px}
      .footer{font-size:12px;color:#64748b;padding-top:14px;border-top:1px solid #e5e7eb}
      @media print{body{padding:0}.notice{print-color-adjust:exact}}
    </style></head><body>
    <header>${logo ? `<img src="${escapeHtml(logo)}" alt="Logo de la inmobiliaria">` : ''}
      <div><strong>${escapeHtml(document.issuer)}</strong>
      ${document.taxId ? `<div>NIT / identificación: ${escapeHtml(document.taxId)}</div>` : ''}</div></header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta"><div><strong>Destinatario:</strong> ${escapeHtml(document.recipient)}</div>
      <div><strong>Referencia:</strong> ${escapeHtml(document.reference)}</div>
      <div><strong>Período:</strong> ${escapeHtml(document.period)}</div>
      <div><strong>Estado registrado:</strong> ${escapeHtml(document.recordedStatus)}</div></div>
    <table><thead><tr><th>Concepto</th><th class="number">Valor</th></tr></thead><tbody>${rows}</tbody></table>
    ${document.note ? `<p>${escapeHtml(document.note)}</p>` : ''}
    <p class="notice"><strong>DOCUMENTO INTERNO — NO ES FACTURA ELECTRÓNICA DIAN.</strong>
      Los valores reflejan únicamente registros de esta inmobiliaria. Un saldo o estado «pagado»
      no certifica por sí mismo una transferencia ni constituye factura electrónica autorizada.</p>
    <p class="footer">Emitido para consulta y conciliación por la inmobiliaria identificada. Verificar soportes y datos tributarios antes de utilizar con fines fiscales.</p>
    </body></html>`;
}

/** Must be called from a direct user click to avoid popup blockers. */
export function printInternalDocument(doc: InternalFinancialDocument) {
  const content = renderInternalDocument(doc);
  const popup = window.open('', '_blank', 'width=960,height=720');
  if (!popup) throw new Error('El navegador bloqueó la ventana del comprobante. Permite ventanas emergentes para INMOJCO.');
  popup.document.open();
  popup.document.write(content);
  popup.document.close();
  popup.focus();
  popup.print();
}
