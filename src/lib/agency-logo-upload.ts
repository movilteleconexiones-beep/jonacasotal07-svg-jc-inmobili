import { supabase } from './supabase';

export const AGENCY_LOGO_BUCKET='jco-agency-logos';
export const MAX_AGENCY_LOGO_BYTES=2*1024*1024;
const validTypes=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']]);

export function validateAgencyLogo(file:File):string|null {
 if(file.size===0||file.size>MAX_AGENCY_LOGO_BYTES) return 'El logo debe pesar entre 1 byte y 2 MB.';
 if(!validTypes.has(file.type)) return 'Solo se admiten logos PNG, JPG o WebP. No se aceptan SVG.';
 return null;
}

/** This bucket holds ONLY non-confidential, intentionally public company logos. */
export async function uploadAgencyLogo(organizationId:string,file:File) {
 const error=validateAgencyLogo(file);
 if(error)throw new Error(error);
 if(!/^[0-9a-f-]{36}$/i.test(organizationId))throw new Error('Inmobiliaria inválida');
 const key=`${organizationId}/${crypto.randomUUID()}.${validTypes.get(file.type)}`;
 const {error:uploadError}=await supabase.storage.from(AGENCY_LOGO_BUCKET)
   .upload(key,file,{contentType:file.type,upsert:false});
 if(uploadError)throw new Error('No se pudo subir el logo. Verifica tus permisos y la configuración del almacenamiento.');
 const {data}=supabase.storage.from(AGENCY_LOGO_BUCKET).getPublicUrl(key);
 if(!data?.publicUrl||!data.publicUrl.startsWith('https://')){
   await supabase.storage.from(AGENCY_LOGO_BUCKET).remove([key]);
   throw new Error('No se pudo obtener la URL HTTPS pública del logo.');
 }
 return {url:data.publicUrl,path:key};
}

export async function rollbackAgencyLogoUpload(path:string){
 await supabase.storage.from(AGENCY_LOGO_BUCKET).remove([path]);
}
