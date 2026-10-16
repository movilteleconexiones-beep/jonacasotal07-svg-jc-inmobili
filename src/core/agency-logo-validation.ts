export const MAX_AGENCY_LOGO_BYTES=2*1024*1024;
export const VALID_AGENCY_LOGO_TYPES=new Map([
 ['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']
]);
export function validateAgencyLogo(file:Pick<File,'size'|'type'>):string|null {
 if(file.size===0||file.size>MAX_AGENCY_LOGO_BYTES) return 'El logo debe pesar entre 1 byte y 2 MB.';
 if(!VALID_AGENCY_LOGO_TYPES.has(file.type)) return 'Solo se admiten logos PNG, JPG o WebP. No se aceptan SVG.';
 return null;
}
