import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const url=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const privileged=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
 auth:{persistSession:false,autoRefreshToken:false}
});
const origins=new Set(['https://app.inmojco.com','https://www.inmojco.com','https://inmojco.com',
'https://jonacasotal07-svg-jc-inmobili-production.up.railway.app']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');
 const headers={'Content-Type':'application/json','Cache-Control':'no-store',
 'Vary':'Origin',...(origin&&origins.has(origin)?{
 'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
 'Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==='OPTIONS')return reply(origin&&origins.has(origin)?200:403,{});
 if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
 if(origin&&!origins.has(origin))return reply(403,{error:'origin_denied'});
 const bearer=req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!bearer)return reply(401,{error:'authentication_required'});
 const {data:identity,error:authError}=await privileged.auth.getUser(bearer);
 if(authError||!identity.user)return reply(401,{error:'authentication_required'});
 let body:unknown;
 try{const raw=await req.text();if(raw.length>1024)return reply(413,{error:'payload_too_large'});body=JSON.parse(raw);}
 catch{return reply(400,{error:'invalid_payload'});}
 const id=(body&&typeof body==='object'&&'consignmentId' in body)?
 (body as {consignmentId:unknown}).consignmentId:null;
 if(typeof id!=='string'||!uuid.test(id))return reply(400,{error:'invalid_id'});
 const asUser=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${bearer}`}},
 auth:{persistSession:false,autoRefreshToken:false}});
 // The requester's RLS must grant access to the private consignment first.
 const {data:accessible,error:readError}=await asUser.from('property_consignments')
  .select('id').eq('id',id).maybeSingle();
 if(readError||!accessible)return reply(404,{error:'not_found'});
 const {data:photos,error:photoError}=await asUser.from('property_consignment_photos')
  .select('id,position,storage_path').eq('consignment_id',id).order('position');
 if(photoError)return reply(403,{error:'access_denied'});
 const results=[];
 for(const photo of photos??[]){
  const {data,error}=await privileged.storage.from('jco-consignment-photos')
   .createSignedUrl(photo.storage_path,300);
  if(error||!data?.signedUrl)return reply(503,{error:'storage_unavailable'});
  results.push({id:photo.id,position:photo.position,url:data.signedUrl});
 }
 return reply(200,{photos:results});
});
