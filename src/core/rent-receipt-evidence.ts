/** Private receipt evidence formats accepted by both client and storage bucket. */
export const RENT_RECEIPT_EVIDENCE_BUCKET='jco-rent-receipts-private';
export const RENT_RECEIPT_EVIDENCE_MAX_BYTES=10*1024*1024;

export type RentEvidenceMime='image/jpeg'|'image/png'|'image/webp'|'application/pdf';

export function evidenceExtension(mime:RentEvidenceMime):string {
  return {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[mime];
}

export function receiptEvidencePath(
  org:string,payment:string,actor:string,requestKey:string,mime:RentEvidenceMime,
):string {
  // Validate all segments locally; PostgreSQL independently validates ownership and keys.
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(![org,payment,actor,requestKey].every(id=>uuid.test(id)))
    throw new Error('Identificadores inválidos para el soporte del abono.');
  return `${org}/${payment}/${actor}/${requestKey}/comprobante.${evidenceExtension(mime)}`;
}

/** Check both extension and actual signature; browser MIME labels are not sufficient. */
export async function validateRentReceiptEvidence(file:File):Promise<{
  error:string|null; mime:RentEvidenceMime|null;
}> {
  if(file.size<8||file.size>RENT_RECEIPT_EVIDENCE_MAX_BYTES)
    return {error:'El comprobante debe tener entre 8 bytes y 10 MB.',mime:null};
  const allowed:Record<string,RentEvidenceMime>={
    jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',
  };
  const ext=file.name.split('.').pop()?.toLowerCase()??'';
  const mime=allowed[ext]??null;
  if(!mime||file.type!==mime)
    return {error:'Solo se aceptan imágenes JPG, PNG, WEBP o documentos PDF válidos.',mime:null};

  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const matches=mime==='image/jpeg'
    ? bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff
    : mime==='image/png'
      ? [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)
      : mime==='image/webp'
        ? [82,73,70,70].every((v,i)=>bytes[i]===v)&&
          [87,69,66,80].every((v,i)=>bytes[i+8]===v)
        : [37,80,68,70,45].every((v,i)=>bytes[i]===v);
  if(!matches)return {error:'El contenido no corresponde al formato declarado del comprobante.',mime:null};
  return {error:null,mime};
}
