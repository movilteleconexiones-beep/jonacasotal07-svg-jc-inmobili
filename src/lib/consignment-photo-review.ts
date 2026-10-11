import { supabase } from './supabase';

export interface ConsignmentPhoto { id: string; position: number; url: string }

export async function fetchConsignmentPhotos(consignmentId: string): Promise<ConsignmentPhoto[]> {
 const { data: session, error: authError } = await supabase.auth.getSession();
 if(authError||!session.session?.access_token)throw new Error('Inicia sesión para consultar las fotos.');
 const endpoint=import.meta.env.VITE_SUPABASE_URL as string|undefined;
 const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;
 if(!endpoint||!key)throw new Error('Supabase no está configurado.');
 const response=await fetch(`${endpoint.replace(/\/$/,'')}/functions/v1/consignment-photo-review`,{
  method:'POST',
  headers:{'Content-Type':'application/json',apikey:key,
   Authorization:`Bearer ${session.session.access_token}`},
  body:JSON.stringify({consignmentId})
 });
 if(!response.ok)throw new Error('No se pudieron consultar las fotografías.');
 const result=await response.json() as {photos?:ConsignmentPhoto[]};
 return result.photos??[];
}
