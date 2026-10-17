export const MAX_AGENCY_LOGO_BYTES=2*1024*1024;
export const VALID_AGENCY_LOGO_TYPES=new Map([
 ['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']
]);
export function validateAgencyLogo(file:Pick<File,'size'|'type'>):string|null {
 if(file.size===0||file.size>MAX_AGENCY_LOGO_BYTES) return 'El logo debe pesar entre 1 byte y 2 MB.';
 if(!VALID_AGENCY_LOGO_TYPES.has(file.type)) return 'Solo se admiten logos PNG, JPG o WebP. No se aceptan SVG.';
 return null;
}

/**
 * Rejects renamed or mislabeled files before they enter the PUBLIC logo bucket.
 * This is an early content check, not a substitute for server-side decoding
 * and storage permission checks.
 */
export async function validateAgencyLogoContents(file:Pick<File,'type'|'size'|'slice'>):Promise<string|null> {
 const metadataError=validateAgencyLogo(file);
 if(metadataError)return metadataError;
 try {
  const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const matches=(prefix:number[],offset=0)=>prefix.every((byte,i)=>bytes[offset+i]===byte);
  const png=file.type==='image/png'&&matches([137,80,78,71,13,10,26,10]);
  const jpeg=file.type==='image/jpeg'&&matches([255,216,255]);
  const webp=file.type==='image/webp'&&matches([82,73,70,70])&&matches([87,69,66,80],8);
  if(png||jpeg||webp)return null;
 } catch {
  return 'No se pudo leer el archivo de imagen. Selecciona un logo válido.';
 }
 return 'El contenido del archivo no corresponde a una imagen PNG, JPG o WebP válida.';
}
