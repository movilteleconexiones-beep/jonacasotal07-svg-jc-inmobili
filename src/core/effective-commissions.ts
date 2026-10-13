export interface CommissionLedgerRecord { id:string; status:string; amount:number|null; }
export interface CommissionRectificationRecord { commission_id:string; archived_from_active:boolean; }
/** Active reportable commissions: rectified mistakes belong in the separate audit trail,
 * never in operational PAID/PENDING totals or current-period commission exports. */
export function effectiveCommissionRows<T extends CommissionLedgerRecord>(
 rows:readonly T[],rectifications:readonly CommissionRectificationRecord[]
):T[] {
 const excluded=new Set(rectifications.map(item=>item.commission_id));
 return rows.filter(item=>item.status!=='CANCELLED'&&!excluded.has(item.id));
}
export function effectiveCommissionTotals(
 rows:readonly CommissionLedgerRecord[],rectifications:readonly CommissionRectificationRecord[]
):{paid:number;pending:number} {
 return effectiveCommissionRows(rows,rectifications).reduce((sum,item)=>{
  const n=Number(item.amount??0);
  if(!Number.isFinite(n)||n<0) throw new Error('Importe de comisión inválido');
  if(item.status==='PAID') sum.paid+=n;
  else sum.pending+=n;
  return sum;
 },{paid:0,pending:0});
}
