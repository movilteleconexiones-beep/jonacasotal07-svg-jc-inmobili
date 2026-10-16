import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { publicAgencyUrl } from '../../core/public-agency-route';

type SiteState={slug:string;enabled:boolean};

export function AgencyPublicSiteControls({organizationId}:{organizationId:string}){
  const {can}=useAuth();
  const [site,setSite]=useState<SiteState|null>(null);
  const [ready,setReady]=useState(false);
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    let cancelled=false;
    setSite(null);setReady(false);setMessage('');
    if(!can(PERMISSIONS.SETTINGS_VIEW))return;
    void (async()=>{
      const {data,error}=await supabase.rpc('get_my_agency_public_site',{p_organization_id:organizationId});
      if(cancelled)return;
      if(error)setMessage('No se pudo verificar el sitio público. Comprueba la migración del catálogo.');
      else{setSite(data?.slug?data as SiteState:null);setReady(true);}
    })();
    return()=>{cancelled=true;};
  },[organizationId,can]);

  if(!can(PERMISSIONS.SETTINGS_VIEW))return null;

  async function change(enabled:boolean){
    if(working||!ready||!can(PERMISSIONS.SETTINGS_EDIT))return;
    if(enabled&&!window.confirm('¿Activar el sitio público de esta inmobiliaria? Ningún inmueble se publicará sin autorización individual.'))return;
    setWorking(true);setMessage('');
    const {data,error}=await supabase.rpc('configure_my_agency_public_site',{
      p_organization_id:organizationId,p_enabled:enabled
    });
    setWorking(false);
    if(error||typeof data!=='string'){setMessage('No se pudo actualizar el sitio. Se conservará su configuración anterior.');return;}
    setSite({slug:data,enabled});
    setMessage(enabled?'Sitio público activo. Ahora puedes autorizar los anuncios disponibles uno a uno.':
      'Sitio público desactivado. No se publican inmuebles.');
  }
  return <section className="rounded-2xl border border-stone-200 bg-white p-4" aria-label="Sitio inmobiliario público">
    <div className="flex flex-wrap justify-between gap-3 items-center">
      <div>
        <h2 className="font-semibold">Catálogo público de mi inmobiliaria</h2>
        <p className="mt-1 text-sm text-stone-600">
          Inventario separado de otras inmobiliarias. Nada se publica automáticamente.
        </p>
        {site?.enabled&&<a href={publicAgencyUrl(site.slug)} target="_blank" rel="noreferrer"
          className="mt-2 inline-block text-sm font-semibold text-[#0F2942] underline">
          Ver mi catálogo público
        </a>}
      </div>
      {ready&&can(PERMISSIONS.SETTINGS_EDIT)&&
        <button type="button" disabled={working} onClick={()=>void change(!site?.enabled)}
          className="rounded-lg border border-slate-900 px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {working?'Guardando…':site?.enabled?'Desactivar catálogo':'Activar catálogo'}
        </button>}
    </div>
    {message&&<p role="status" className="mt-3 text-sm text-amber-900">{message}</p>}
  </section>;
}
