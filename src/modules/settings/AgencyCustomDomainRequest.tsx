import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../core/auth-context';

interface DomainRequest {
 hostname:string; status:string; dns_record:string; dns_value:string;
}

/** Only submits a DNS ownership request. Platform-controlled TLS deployment
 * and authoritative DNS verification remain separate operations. */
export function AgencyCustomDomainRequest({organizationId}:{organizationId:string}){
 const {can}=useAuth();
 const requestGeneration=useRef(0);
 const activeOrganizationRef=useRef(organizationId);
 activeOrganizationRef.current=organizationId;
 const [hostname,setHostname]=useState('');
 const [record,setRecord]=useState<DomainRequest|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);

 useEffect(()=>{
  let disposed=false;
  ++requestGeneration.current;
  setRecord(null);setHostname('');setError('');setLoading(true);setBusy(false);
  void (async()=>{
   const {data,error:requestError}=await supabase.rpc('get_my_agency_custom_domain',{
     p_organization_id:organizationId
   });
   if(disposed)return;
   if(requestError)setError('La gestión de dominios está pendiente de activación en INMOJCO.');
   else if(data?.hostname){setRecord(data as DomainRequest);setHostname(data.hostname);}
   setLoading(false);
  })();
  return()=>{disposed=true;++requestGeneration.current;};
 },[organizationId]);

 if(!can('settings.view'))return null;

 async function requestDomain(){
  if(busy||loading||!can('settings.edit'))return;
  const requestedOrgId=organizationId;
  const generation=++requestGeneration.current;
  const host=hostname.trim().toLowerCase();
  if(!host||host.includes('://')||host.includes('/')||host.includes(':')){
   setError('Registra solo el dominio o subdominio, sin https://, rutas ni puertos.');
   return;
  }
  setBusy(true);setError('');
  let data:DomainRequest|null=null;
  let requestFailed=false;
  try{
   const result=await supabase.rpc('request_agency_custom_domain',{
    p_organization_id:requestedOrgId,p_hostname:host
   });
   requestFailed=Boolean(result.error);
   data=result.data as DomainRequest|null;
  }catch{requestFailed=true;}
  if(generation!==requestGeneration.current||activeOrganizationRef.current!==requestedOrgId)return;
  setBusy(false);
  if(requestFailed||!data?.hostname){
   setError('No se pudo registrar el dominio. Comprueba que sea válido, propio y no esté asociado a otra inmobiliaria.');
   return;
  }
  setRecord(data as DomainRequest);setHostname(data.hostname);
 }

 return <section aria-label="Dominio propio de la inmobiliaria"
   className="rounded-xl border border-stone-200 bg-stone-50 p-4">
   <h2 className="font-semibold">Solicitar conexión de dominio propio</h2>
   <p className="mt-2 text-xs text-stone-600">
     Este procedimiento es distinto de registrar tu sitio web comercial.
     Un dominio requiere comprobar su propiedad mediante DNS y configurar un certificado HTTPS.
     Ningún dominio queda activo automáticamente.
   </p>
   <label className="mt-3 block text-sm font-medium">
     Dominio o subdominio de la inmobiliaria
     <input type="text" value={hostname} onChange={e=>setHostname(e.target.value)}
       disabled={loading||busy||!can('settings.edit')||Boolean(record&&!['PENDING_DNS','REJECTED'].includes(record.status))}
       placeholder="www.inmobiliariaejemplo.com"
       className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm"/>
   </label>
   <button type="button" disabled={loading||busy||!can('settings.edit')||Boolean(record&&!['PENDING_DNS','REJECTED'].includes(record.status))}
     onClick={()=>void requestDomain()}
     className="mt-3 rounded-lg border border-slate-900 px-4 py-2 text-sm font-semibold disabled:opacity-50">
     {busy?'Registrando…':'Solicitar verificación DNS'}
   </button>
   {record&&<div className="mt-4 rounded-lg border bg-white p-3 text-sm">
     <p>Dominio solicitado: <strong>{record.hostname}</strong></p>
     <p className="mt-1">Estado: <strong>{record.status==='ACTIVE'?'Activo':record.status==='PENDING_DNS'?'Pendiente de verificación DNS':record.status}</strong></p>
     <p className="mt-2 text-xs text-stone-600">Crea un registro DNS TXT en tu proveedor de dominio:</p>
     <p className="mt-2 break-all font-mono text-xs">Nombre: {record.dns_record}</p>
     <p className="mt-1 break-all font-mono text-xs">Valor: {record.dns_value}</p>
     <p className="mt-2 text-xs text-stone-600">La verificación de propiedad, certificado TLS y activación los gestionará la plataforma. Este estado no confirma que tu dominio ya dirija al panel.</p>
   </div>}
   {error&&<p role="alert" className="mt-3 text-sm text-amber-800">{error}</p>}
 </section>;
}
