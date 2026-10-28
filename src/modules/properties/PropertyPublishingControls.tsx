import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';

interface ListingTarget { id:string; title:string; status:string }

/** Manual, opt-in PUBLIC projection. Private inventory photos are never copied. */
export function PropertyPublishingControls({property,organizationId}: {
  property:ListingTarget; organizationId:string;
}) {
  const {can}=useAuth();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [published,setPublished]=useState(false);
  const [description,setDescription]=useState('');
  const [imageUrl,setImageUrl]=useState('');
  const [loaded,setLoaded]=useState(false);
  // Invalidate requests from earlier properties, tenants or closed editors.
  const requestGeneration=useRef(0);
  useEffect(()=>{
    ++requestGeneration.current;
    setOpen(false);setBusy(false);setLoaded(false);setPublished(false);setImageUrl('');setDescription('');setMessage('');
    return()=>{++requestGeneration.current;};
  },[organizationId,property.id]);

  if(!can(PERMISSIONS.PROPERTIES_EDIT))return null;

  async function showEditor(){
    const generation=++requestGeneration.current;
    setOpen(true);setBusy(true);setLoaded(false);setMessage('');
    const {data,error}=await supabase.from('property_publications')
      .select('published,public_description,public_photo_url')
      .eq('organization_id',organizationId).eq('property_id',property.id).maybeSingle();
    if(generation!==requestGeneration.current)return;
    if(error){setMessage('No se pudo verificar la publicación. Esta función requiere la migración de catálogo público.');}
    else{
      setPublished(Boolean(data?.published&&property.status==='AVAILABLE'));
      setDescription(data?.public_description??'');
      setImageUrl(data?.public_photo_url??'');
      setLoaded(true);
    }
    setBusy(false);
  }

  async function save(){
    if(!loaded||busy||!can(PERMISSIONS.PROPERTIES_EDIT))return;
    if(published && property.status!=='AVAILABLE'){
      setMessage('El inmueble debe estar Disponible para publicarse.');return;
    }
    const url=imageUrl.trim();
    if(url){
      try{
        const p=new URL(url);
        if(p.protocol!=='https:'||p.username||p.password||!/^[a-z0-9.-]+$/i.test(p.hostname)||
          url.length>1500||url.toLowerCase().includes('jco-inventory-private')||
          url.toLowerCase().includes('/storage/v1/object/sign/')||
          url.toLowerCase().includes('token=')) throw new Error();
      }catch{setMessage('Utiliza únicamente una URL HTTPS pública de una foto aprobada, no enlaces privados o firmados.');return;}
    }
    if(description.length>600){setMessage('La descripción pública admite hasta 600 caracteres.');return;}
    const generation=requestGeneration.current;
    setBusy(true);setMessage('');
    const {error}=await supabase.from('property_publications').upsert({
      property_id:property.id,organization_id:organizationId,published,
      public_description:description.trim()||null,public_photo_url:url||null,
    },{onConflict:'property_id'});
    if(generation!==requestGeneration.current)return;
    setBusy(false);
    if(error){setMessage('No fue posible actualizar la publicación. Comprueba tus permisos y la publicación del módulo.');return;}
    setMessage(published?'Anuncio guardado. Solo se mostrará en el sitio habilitado de esta inmobiliaria.':
      'Inmueble retirado de su catálogo público.');
  }

  return <>
    <button type="button" onClick={()=>void showEditor()}
      className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Publicación</button>
    {open&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
      <section aria-label={'Publicación de '+property.title}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 text-left shadow-2xl">
        <h2 className="text-xl font-semibold">Publicar inmueble: {property.title}</h2>
        <p className="mt-2 text-sm text-stone-600">
          El catálogo solo mostrará inmuebles disponibles de esta inmobiliaria, aprobados explícitamente.
          No publiques direcciones exactas, información de propietarios, documentos ni imágenes del bucket privado.
        </p>
        {loaded&&<>
          <label className="mt-5 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={published}
              disabled={property.status!=='AVAILABLE'}
              onChange={e=>setPublished(e.target.checked)}/>
            Publicar anuncio
          </label>
          {property.status!=='AVAILABLE'&&<p className="mt-1 text-xs text-amber-800">
            No disponible: primero comprueba el estado real del inmueble. Puedes guardar la despublicación.
          </p>}
          <label className="mt-4 block text-sm font-medium">Descripción comercial pública
            <textarea className="mt-1 w-full rounded-lg border p-3"
              maxLength={600} rows={3} value={description} onChange={e=>setDescription(e.target.value)}/>
          </label>
          <label className="mt-4 block text-sm font-medium">URL HTTPS de una fotografía autorizada para uso público
            <input type="url" className="mt-1 w-full rounded-lg border p-3" value={imageUrl}
              onChange={e=>setImageUrl(e.target.value)} placeholder="https://ejemplo.com/foto-publica.jpg"/>
          </label>
        </>}
        {message&&<p role="status" className="mt-4 rounded-lg bg-stone-100 p-3 text-sm">{message}</p>}
        <div className="mt-5 flex gap-3">
          {loaded&&<button disabled={busy} type="button" onClick={()=>void save()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {busy?'Guardando…':'Guardar publicación'}
          </button>}
          <button type="button" className="rounded-lg border px-4 py-2 text-sm"
            onClick={()=>{++requestGeneration.current;setOpen(false);}}>Cerrar</button>
        </div>
      </section>
    </div>}
  </>;
}
