import { supabase } from './supabase';

export async function uploadConsignmentPhoto(siteSlug: string, requestId: string,
  reference: string, position: number, photo: File): Promise<void> {
  const endpoint = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!endpoint || !key) throw new Error('Almacenamiento de fotografías sin configurar.');
  const body = new FormData();
  body.set('siteSlug', siteSlug);
  body.set('requestId', requestId);
  body.set('reference', reference);
  body.set('position', String(position));
  body.set('photo', photo);
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`${endpoint.replace(/\/$/,'')}/functions/v1/consignment-photo-upload`, {
    method: 'POST',
    headers: {
      apikey: key,
      ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } :
        { Authorization: `Bearer ${key}` }),
    },
    body,
  });
  if (!response.ok) throw new Error('No se pudo guardar la fotografía.');
}
