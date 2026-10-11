import { supabase } from './supabase';

export const PHOTO_BUCKET = 'jco-inventory-private';
export const MAX_PHOTOS = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const MIME = new Set(['image/jpeg','image/png','image/webp']);

export function validateInventoryPhotos(files: File[], existingCount = 0): string | null {
 if (files.length + existingCount > MAX_PHOTOS) return 'Máximo 10 fotografías por propiedad.';
 if (files.some(f => f.size < 1 || f.size > MAX_BYTES || !MIME.has(f.type)))
  return 'Solo fotografías JPG, PNG o WebP de hasta 5 MB cada una.';
 return null;
}

interface StoredPhoto { id: string; image_order: number; storage_path: string }
export interface InventoryPhoto { id: string; order: number; url: string; path: string }

async function metadata(propertyId: string, organizationId: string): Promise<StoredPhoto[]> {
 const { data, error } = await supabase.from('property_private_photos')
  .select('id,image_order,storage_path').eq('organization_id',organizationId)
  .eq('property_id',propertyId).order('image_order');
 if (error) throw new Error('No fue posible consultar las fotos de esta propiedad.');
 return data ?? [];
}

export async function loadInventoryPhotos(propertyId: string, organizationId: string): Promise<InventoryPhoto[]> {
 const items = await metadata(propertyId,organizationId);
 const results: InventoryPhoto[] = [];
 for (const item of items) {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(item.storage_path,300);
  if (error || !data?.signedUrl) throw new Error('No se pudo abrir la galería privada.');
  results.push({id:item.id,order:item.image_order,url:data.signedUrl,path:item.storage_path});
 }
 return results;
}

export async function saveInventoryPhotos(propertyId: string, organizationId: string, files: File[]): Promise<number> {
 const old=await metadata(propertyId,organizationId);
 const problem=validateInventoryPhotos(files,old.length);
 if(problem)throw new Error(problem);
 const used = new Set(old.map(x=>x.image_order));
 let done=0;
 for(const file of files) {
  const slot=Array.from({length:10},(_,i)=>i).find(i=>!used.has(i));
  if(slot===undefined)throw new Error('No hay espacio para más fotografías.');
  const extension=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
  const path=`${organizationId}/${propertyId}/${crypto.randomUUID()}.${extension}`;
  const {error:uploaded}=await supabase.storage.from(PHOTO_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
  if(uploaded)throw new Error(`Se guardaron ${done} de ${files.length} fotos. Error al cargar la siguiente imagen.`);
  const {error:recorded}=await supabase.from('property_private_photos').insert({
   organization_id:organizationId,property_id:propertyId,storage_path:path,
   image_order:slot,mime_type:file.type,byte_size:file.size
  });
  if(recorded){
   await supabase.storage.from(PHOTO_BUCKET).remove([path]);
   throw new Error(`Se guardaron ${done} de ${files.length} fotos. No se pudo registrar otra imagen.`);
  }
  used.add(slot);done++;
 }
 return done;
}
