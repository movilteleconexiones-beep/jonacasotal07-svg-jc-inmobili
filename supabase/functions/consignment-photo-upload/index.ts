import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
 auth: { persistSession:false, autoRefreshToken:false },
});
const origins = new Set(['https://app.inmojco.com','https://www.inmojco.com','https://inmojco.com',
'https://jonacasotal07-svg-jc-inmobili-production.up.railway.app']);
const bucket='jco-consignment-photos';
function respond(code:number, payload:unknown, origin:string|null) {
 return new Response(JSON.stringify(payload),{status:code,headers:{
 'content-type':'application/json','cache-control':'no-store','vary':'Origin',
 ...(origin && origins.has(origin)?{'access-control-allow-origin':origin,
 'access-control-allow-methods':'POST, OPTIONS',
 'access-control-allow-headers':'authorization, apikey, content-type, x-client-info'}:{})
 }});
}
function magic(bytes:Uint8Array,mime:string) {
 if(mime==='image/jpeg') return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/png') return [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
 if(mime==='image/webp') return String.fromCharCode(...bytes.slice(0,4))==='RIFF'
 && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 return false;
}
// A lost HTTP response must not turn a persisted photo into a failed retry.
// Re-validate the scoped submission before every lookup (see handler below).
// Never treat a same-position but DIFFERENT image as successfully uploaded.
async function existingPhotoState(
 consignment: {id:string;organization_id:string},
 position:number,file:File,bytes:Uint8Array,
):Promise<'absent'|'identical'|'conflict'|'unavailable'> {
 const {data,error}=await supabase.from('property_consignment_photos')
  .select('storage_path,mime_type,byte_size')
  .eq('consignment_id',consignment.id).eq('position',position).maybeSingle();
 if(error)return 'unavailable';
 if(!data)return 'absent';
 // Even service-role reads must remain inside the resolved organization's path.
 if(typeof data.storage_path!=='string'||
    !data.storage_path.startsWith(`${consignment.organization_id}/${consignment.id}/${position}-`))
   return 'unavailable';
 if(data.mime_type!==file.type||data.byte_size!==bytes.length)return 'conflict';
 const {data:stored,error:downloadError}=await supabase.storage.from(bucket).download(data.storage_path);
 if(downloadError||!stored||stored.size!==bytes.length)return 'unavailable';
 const [expected,actual]=await Promise.all([
  crypto.subtle.digest('SHA-256',bytes),
  stored.arrayBuffer().then(buffer=>crypto.subtle.digest('SHA-256',buffer)),
 ]);
 const x=new Uint8Array(expected),y=new Uint8Array(actual);
 return x.length===y.length&&x.every((value,i)=>value===y[i])?'identical':'conflict';
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin');
 if(req.method==='OPTIONS')return respond(origin&&origins.has(origin)?200:403,{},origin);
 if(req.method!=='POST')return respond(405,{error:'method_not_allowed'},origin);
 if(origin&&!origins.has(origin))return respond(403,{error:'origin_not_allowed'},origin);
 const length=Number(req.headers.get('content-length')||0);
 if(length>5500000)return respond(413,{error:'too_large'},origin);
 try {
  // Bound streaming payloads even when Content-Length is absent or forged.
  const reader=req.body?.getReader();
  if(!reader)return respond(400,{error:'empty_upload'},origin);
  const chunks:Uint8Array[]=[];
  let total=0;
  try {
    while(true) {
      const {value,done}=await reader.read();
      if(done)break;
      total+=value.length;
      if(total>5500000){await reader.cancel();return respond(413,{error:'too_large'},origin);}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const buffer=new Uint8Array(total);
  let cursor=0;
  for(const chunk of chunks){buffer.set(chunk,cursor);cursor+=chunk.length;}
  const bounded=new Request(req.url,{method:'POST',headers:req.headers,body:buffer});
  const form=await bounded.formData();
  const slug=form.get('siteSlug'), id=form.get('requestId'),reference=form.get('reference'),position=Number(form.get('position'));
  const file=form.get('photo');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(typeof slug!=='string'||!/^[a-z0-9-]{3,80}$/.test(slug)
   ||typeof id!=='string'||!uuid.test(id)
   ||typeof reference!=='string'||!/^CON-[0-9A-F-]{36}$/.test(reference)
   ||!Number.isInteger(position)||position<0||position>9||!(file instanceof File)
   ||file.size<1||file.size>5242880||!['image/jpeg','image/png','image/webp'].includes(file.type))
   return respond(400,{error:'invalid_photo'},origin);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!magic(bytes,file.type))return respond(415,{error:'invalid_file_signature'},origin);
  const {data:resolved,error:resolveError}=await supabase.rpc('resolve_consignment_photo_submission',{
    p_slug:slug,p_request_id:id,p_reference:reference,
  });
  const consignment=Array.isArray(resolved)?resolved[0]:null;
  if(resolveError||!consignment)return respond(404,{error:'submission_unavailable'},origin);
  // Look for an already persisted position BEFORE checking the quota.
  // This also permits retries of the tenth photo without adding a new object.
  const prior=await existingPhotoState(consignment,position,file,bytes);
  if(prior==='identical')return respond(200,{uploaded:true,position,alreadySaved:true},origin);
  if(prior==='conflict')return respond(409,{error:'photo_position_conflict'},origin);
  if(prior==='unavailable')return respond(503,{error:'photo_verification_unavailable'},origin);
  const {count,error:countError}=await supabase.from('property_consignment_photos')
   .select('id',{count:'exact',head:true}).eq('consignment_id',consignment.id);
  if(countError||count===null)return respond(503,{error:'photo_count_unavailable'},origin);
  if(count>=10)return respond(409,{error:'photo_limit'},origin);
  const path=`${consignment.organization_id}/${consignment.id}/${position}-${crypto.randomUUID()}`;
  const {error:uploadError}=await supabase.storage.from(bucket).upload(path,bytes,{
    contentType:file.type,upsert:false,cacheControl:'0'
  });
  if(uploadError)return respond(503,{error:'storage_unavailable'},origin);
  const {error:insertError}=await supabase.from('property_consignment_photos').insert({
   consignment_id:consignment.id,position,storage_path:path,mime_type:file.type,byte_size:bytes.length
  });
  if(insertError){
   const {error:cleanupError}=await supabase.storage.from(bucket).remove([path]);
   if(cleanupError)return respond(503,{error:'photo_cleanup_unavailable'},origin);
   // Two concurrent copies can race past the initial existence check.
   // Only acknowledge a duplicate once the stored bytes are VERIFIED equal.
   const raced=await existingPhotoState(consignment,position,file,bytes);
   if(raced==='identical')return respond(200,{uploaded:true,position,alreadySaved:true},origin);
   if(raced==='unavailable')return respond(503,{error:'photo_verification_unavailable'},origin);
   return respond(409,{error:'photo_position_conflict'},origin);
  }
  return respond(201,{uploaded:true,position},origin);
 }catch{return respond(400,{error:'invalid_upload'},origin);}
});
