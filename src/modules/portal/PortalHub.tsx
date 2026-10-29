import {useEffect,useState} from 'react';
import {Building2,FileCheck2,Home,KeyRound} from 'lucide-react';
import {useAuth} from '../../core/auth-context';
import {supabase} from '../../lib/supabase';
import {etiquetaES} from '../../core/etiquetas-es';
import { tenantPublicPath } from '../../core/public-tenant-route';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { isSignedLeaseDocument, SIGNED_LEASE_BUCKET, type SignedLeaseDocumentRef } from '../../core/signed-lease-pdf';

type LinkRow={owner_id:string|null;contact_id:string|null};
type PropertyRow={id:string;code:string;title:string;status:string;city:string|null};
type LeaseRow={id:string;property_id:string;owner_id:string;status:string;monthly_rent:number|null;start_date:string;end_date:string|null};
type PaymentRow={id:string;lease_id:string;period_month:string;paid_amount:number;status:string};
type StatementRow={id:string;owner_id:string;period_month:string;net_amount:number;status:string};
type SignedContractRow=SignedLeaseDocumentRef&{id:string;title:string};

const money=(value:number|null,locale:string,currency:string)=>value===null?'—':
  new Intl.NumberFormat(locale,{style:'currency',currency,maximumFractionDigits:0}).format(value);

/**
 * External account presentation is not an authorization boundary.
 * Each backend query must be scoped by the authenticated user through RLS
 * AND by the portal_access_links validated for the current organization.
 * Contact-only prospects get the public catalog and consignment intake,
 * not private CRM, lead activity, quotes or documents.
 */
export function PortalHub(){
  const {activeMembership,user}=useAuth();
  const organizationId=activeMembership?.organization.id;
  const storefrontPath=tenantPublicPath(activeMembership?.organization.slug??'');
  const { branding } = useTenantBranding();
  const [owners,setOwners]=useState<string[]>([]);
  const [contacts,setContacts]=useState<string[]>([]);
  const [properties,setProperties]=useState<PropertyRow[]>([]);
  const [leases,setLeases]=useState<LeaseRow[]>([]);
  const [payments,setPayments]=useState<PaymentRow[]>([]);
  const [statements,setStatements]=useState<StatementRow[]>([]);
  const [signedContracts,setSignedContracts]=useState<SignedContractRow[]>([]);
  const [documentError,setDocumentError]=useState('');
  const [loading,setLoading]=useState(true);
  const [portalError,setPortalError]=useState('');

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setPortalError('');setDocumentError('');
    setOwners([]);setContacts([]);setProperties([]);setLeases([]);setPayments([]);setStatements([]);setSignedContracts([]);
    if(!organizationId||!user?.id){setLoading(false);return;}
    const checked=async <T,>(request:PromiseLike<{data:T[]|null;error:{message:string}|null;count:number|null}>):Promise<T[]>=>{
      const result=await request;
      if(result.error||result.count==null||result.count>500||!result.data||result.data.length!==result.count)
        throw new Error('No se pudo verificar la información privada completa');
      return result.data;
    };
    void (async()=>{
      try{
        const links=await checked<LinkRow>(supabase.from('portal_access_links')
          .select('owner_id,contact_id',{count:'exact'})
          .eq('organization_id',organizationId).eq('user_id',user.id).limit(501));
        if(cancelled)return;
        const ownerIds=[...new Set(links.map(x=>x.owner_id).filter((v):v is string=>!!v))];
        const contactIds=[...new Set(links.map(x=>x.contact_id).filter((v):v is string=>!!v))];
        setOwners(ownerIds);setContacts(contactIds);
        const ownerships=ownerIds.length?await checked(
          supabase.from('property_ownerships').select('property_id',{count:'exact'})
            .in('owner_id',ownerIds).limit(501)
        ):[];
        const tenantLeases=contactIds.length?await checked<LeaseRow>(
          supabase.from('leases')
            .select('id,property_id,owner_id,status,monthly_rent,start_date,end_date',{count:'exact'})
            .eq('organization_id',organizationId).in('tenant_id',contactIds)
            .in('status',['ACTIVE','TERMINATED']).limit(501)
        ):[];
        const ownerLeases=ownerIds.length?await checked<LeaseRow>(
          supabase.from('leases')
            .select('id,property_id,owner_id,status,monthly_rent,start_date,end_date',{count:'exact'})
            .eq('organization_id',organizationId).in('owner_id',ownerIds)
            .in('status',['ACTIVE','TERMINATED']).limit(501)
        ):[];
        const ownLeases=[...new Map([...tenantLeases,...ownerLeases].map(x=>[x.id,x])).values()];
        const propertyIds=[...new Set([...ownerships.map(x=>x.property_id),...ownLeases.map(x=>x.property_id)]
          .filter((v):v is string=>!!v))];
        const leaseIds=ownLeases.map(x=>x.id);
        const [ownProperties,ownPayments,issuedStatements,leaseDocuments]=await Promise.all([
          propertyIds.length?checked<PropertyRow>(supabase.from('properties')
            .select('id,code,title,status,city',{count:'exact'})
            .eq('organization_id',organizationId).in('id',propertyIds).limit(501)):Promise.resolve([]),
          leaseIds.length?checked<PaymentRow>(supabase.from('rent_payments')
            .select('id,lease_id,period_month,paid_amount,status',{count:'exact'})
            .eq('organization_id',organizationId).in('lease_id',leaseIds).limit(501)):Promise.resolve([]),
          ownerIds.length?checked<StatementRow>(supabase.from('owner_statements')
            .select('id,owner_id,period_month,net_amount,status',{count:'exact'})
            .eq('organization_id',organizationId).in('owner_id',ownerIds)
            .in('status',['GENERATED','ISSUED']).not('issued_at','is',null).limit(501)):Promise.resolve([]),
          leaseIds.length?checked<SignedContractRow>(supabase.from('documents')
            .select('id,title,organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path',{count:'exact'})
            .eq('organization_id',organizationId)
            .eq('entity_type','GENERAL')
            .eq('document_type','CONTRACT')
            .eq('storage_bucket',SIGNED_LEASE_BUCKET)
            .in('entity_id',leaseIds).limit(501)):Promise.resolve([]),
        ]);
        if(cancelled)return;
        const safeContracts=leaseDocuments.filter(document=>
          ownLeases.some(lease=>isSignedLeaseDocument(document,organizationId,lease.id)));
        setProperties(ownProperties);setLeases(ownLeases);setPayments(ownPayments);
        setStatements(issuedStatements);setSignedContracts(safeContracts);
      }catch{
        if(cancelled)return;
        setPortalError('No se pudo comprobar el acceso privado. No mostraremos información sin verificar tus vínculos.');
        setOwners([]);setContacts([]);setProperties([]);setLeases([]);setPayments([]);setStatements([]);setSignedContracts([]);
      }finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[organizationId,user?.id]);

  async function viewSignedContract(document:SignedContractRow) {
    if(!organizationId||!user?.id||!leases.some(lease=>isSignedLeaseDocument(document,organizationId,lease.id)))return;
    setDocumentError('');
    try{
      const {data,error}=await supabase.storage.from(SIGNED_LEASE_BUCKET)
        .createSignedUrl(document.storage_path,60);
      if(error||!data?.signedUrl)throw new Error('signed url unavailable');
      window.open(data.signedUrl,'_blank','noopener,noreferrer');
    }catch{
      setDocumentError('No fue posible abrir tu contrato firmado. Comprueba tu acceso con la inmobiliaria.');
    }
  }

  if(loading)return <section role="status" className="rounded-xl border bg-white p-6">
    Verificando los vínculos personales de tu portal…
  </section>;
  if(portalError)return <section role="alert" className="rounded-xl border border-amber-300 bg-white p-6 text-amber-900">
    {portalError}
  </section>;
  const isOwner=owners.length>0;
  const isTenant=leases.length>0&&contacts.length>0;
  return <section className="space-y-5" aria-label="Portal privado externo">
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <h1 className="text-xl font-bold">Mi portal · {activeMembership?.organization.name || 'Mi inmobiliaria'}</h1>
      <p className="mt-2 text-sm text-slate-700">
        {isOwner?'Consulta únicamente tus propiedades vinculadas y liquidaciones emitidas.':
          isTenant?'Consulta solamente tu contrato y los pagos relacionados.':
          'Acceso público: consulta el catálogo y consigna una propiedad. Los expedientes privados requieren una vinculación comprobada.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`${storefrontPath}#catalogo`} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          <Home className="h-4 w-4"/> Ver catálogo de propiedades
        </a>
        <a href={`${storefrontPath}?consignar=1`} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold">
          <Building2 className="h-4 w-4"/> Consignar mi propiedad
        </a>
      </div>
    </div>
    {properties.length>0&&<section className="rounded-2xl border bg-white p-5">
      <h2 className="flex items-center gap-2 font-bold"><Building2 className="h-4 w-4"/> Inmuebles vinculados</h2>
      <div className="mt-3 divide-y">{properties.map(property=><div key={property.id} className="py-3">
        <div className="font-medium">{property.code} · {property.title}</div>
        <div className="text-xs text-slate-600">{property.city??'Sin ciudad'} · {etiquetaES(property.status)}</div>
      </div>)}</div>
    </section>}
    {leases.length>0&&<section className="rounded-2xl border bg-white p-5">
      <h2 className="flex items-center gap-2 font-bold"><KeyRound className="h-4 w-4"/> Mis contratos vinculados</h2>
      <div className="mt-3 divide-y">{leases.map(lease=><div key={lease.id} className="py-3 text-sm">
        <p className="font-semibold">{properties.find(p=>p.id===lease.property_id)?.title??'Inmueble vinculado'}</p>
        <p>Estado: {etiquetaES(lease.status)} · Canon: {money(lease.monthly_rent,branding.locale,branding.currency)}</p>
        <p className="text-xs text-slate-600">Inicio: {lease.start_date} · Terminación: {lease.end_date??'Sin fecha registrada'}</p>
      </div>)}</div>
    </section>}
    {signedContracts.length>0&&<section className="rounded-2xl border bg-white p-5">
      <h2 className="flex items-center gap-2 font-bold"><FileCheck2 className="h-4 w-4"/> Mis contratos firmados (PDF)</h2>
      <p className="mt-1 text-xs text-slate-600">Solo documentos de tus contratos vinculados. Los enlaces caducan en 60 segundos.</p>
      <div className="mt-3 divide-y">{signedContracts.map(document=><div key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
        <span>{document.title}</span>
        <button type="button" className="rounded-lg border px-3 py-1.5 font-semibold"
          onClick={()=>void viewSignedContract(document)}>Ver PDF privado</button>
      </div>)}</div>
      {documentError&&<p role="alert" className="mt-2 text-sm text-amber-800">{documentError}</p>}
    </section>}
    {payments.length>0&&<section className="rounded-2xl border bg-white p-5">
      <h2 className="font-bold">Pagos de mis contratos</h2>
      <div className="mt-3 divide-y">{payments.map(payment=><div key={payment.id} className="flex justify-between gap-2 py-3 text-sm">
        <span>{payment.period_month} · {etiquetaES(payment.status)}</span>
        <strong>{money(payment.paid_amount,branding.locale,branding.currency)}</strong>
      </div>)}</div>
    </section>}
    {statements.length>0&&<section className="rounded-2xl border bg-white p-5">
      <h2 className="flex items-center gap-2 font-bold"><FileCheck2 className="h-4 w-4"/> Liquidaciones emitidas de mis inmuebles</h2>
      <div className="mt-3 divide-y">{statements.map(s=><div key={s.id} className="flex justify-between gap-2 py-3 text-sm">
        <span>{s.period_month} · {etiquetaES(s.status)}</span><strong>{money(s.net_amount,branding.locale,branding.currency)}</strong>
      </div>)}</div>
    </section>}
    {!isOwner&&!isTenant&&<p className="rounded-lg bg-stone-50 p-4 text-sm text-slate-600">
      Para consultar un contrato de arrendamiento o tus inmuebles, solicita a la inmobiliaria vincular tu cuenta a tu ficha de inquilino o propietario.
    </p>}
  </section>;
}
