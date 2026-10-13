export type StatementBalance={id:string;status:string;other_deductions:number|null};
export type DeductionBalance={statement_id:string;status:string;responsible_party:string;category:string;amount:number|null};
export function reconciliationAlerts(statements:readonly StatementBalance[],deductions:readonly DeductionBalance[]){
 const totals=new Map<string,number>();
 for(const d of deductions){
  if(d.status!=='APPROVED'||d.responsible_party!=='OWNER'||d.category==='TAX'||d.category==='COMMISSION')continue;
  const n=Number(d.amount??0);
  if(!Number.isFinite(n)||n<0)throw new Error('Importe de deducción inválido');
  totals.set(d.statement_id,(totals.get(d.statement_id)??0)+n);
 }
 return statements.filter(s=>s.status==='DRAFT'&&Math.abs(Number(s.other_deductions??0)-(totals.get(s.id)??0))>0.005)
 .map(s=>({id:s.id,registered:Number(s.other_deductions??0),approved:totals.get(s.id)??0}));
}
