/** Advisory only: a listing may have been repriced or a different rent negotiated.
 * Never silently overwrite a signed contract or an issued rent period.
 */
export function rentalCanonDifference(
  listedCanon: number | null | undefined, enteredCanon: number | null | undefined,
  operationType: string | null | undefined,
): {listedCanon:number;enteredCanon:number;delta:number;direction:'superior'|'inferior'} | null {
  if(operationType!=='RENT' || listedCanon==null || enteredCanon==null ||
     !Number.isFinite(listedCanon) || !Number.isFinite(enteredCanon) ||
     listedCanon<=0 || enteredCanon<=0) return null;
  const listed=Math.round(listedCanon*100);
  const entered=Math.round(enteredCanon*100);
  if(listed===entered) return null;
  return {listedCanon:listed/100,enteredCanon:entered/100,
    delta:Math.abs(entered-listed)/100,direction:entered>listed?'superior':'inferior'};
}
export function formatRentalCanonCOP(value:number):string {
  return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:2}).format(value);
}
export function rentalCanonWarning(
  difference:NonNullable<ReturnType<typeof rentalCanonDifference>>,
):string {
  return 'Alerta de canon: el inmueble está publicado por '+
    formatRentalCanonCOP(difference.listedCanon)+
    ' al mes, pero el contrato indica '+formatRentalCanonCOP(difference.enteredCanon)+
    ' ('+formatRentalCanonCOP(difference.delta)+' '+difference.direction+' al anunciado). '+
    'Confirma el valor pactado y su soporte antes de guardar.';
}
