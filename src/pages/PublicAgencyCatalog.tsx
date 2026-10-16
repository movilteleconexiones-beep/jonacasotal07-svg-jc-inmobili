import { useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Search, X, Home, ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ResilientImage } from '../components/ResilientImage';
import { SubmitPropertyModal } from '../components/SubmitPropertyModal';
import { publicAgencySlug } from '../core/public-agency-route';

interface Site { slug: string; company_name: string; country: string; currency: string }
interface Listing {
  id: string; code: string; title: string;
  operation_type: string; property_type: string;
  price: number | null; currency: string;
  country: string | null; state: string | null; city: string | null;
  neighborhood: string | null; bedrooms: number | null; bathrooms: number | null;
  parking_spaces: number | null; built_area: number | null; lot_area: number | null;
  featured: boolean; description: string | null; image_url: string | null;
}
const operations: Record<string,string> = {
 SALE:'Venta', RENT:'Arriendo', SALE_OR_RENT:'Venta o arriendo',
 ADMINISTRATION:'Administración',
};

function safeListingImage(url: string | null): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
       parsed.href.toLowerCase().includes('jco-inventory-private') ||
       parsed.pathname.includes('/storage/v1/object/sign/')) return '';
    return parsed.href;
  } catch { return ''; }
}
function money(price: number | null, currency: string) {
  if (price === null || !Number.isFinite(price)) return 'Consultar precio';
  try {
    return new Intl.NumberFormat('es-CO',{style:'currency',currency:currency||'COP',maximumFractionDigits:0}).format(price);
  } catch { return 'Consultar precio'; }
}
function verifiedListing(value: unknown): value is Listing {
  if (!value || typeof value !== 'object') return false;
  const record=value as Partial<Listing>;
  return typeof record.id === 'string' && typeof record.code === 'string' &&
    typeof record.title === 'string' && typeof record.operation_type === 'string' &&
    typeof record.property_type === 'string' && typeof record.currency === 'string' &&
    (record.price === null || typeof record.price === 'number');
}

/**
 * Independent public storefront. Even if a user is authenticated for another
 * tenant, this page never uses activeMembership or the private properties table.
 */
export function PublicAgencyCatalog() {
  const slug = publicAgencySlug(window.location.pathname);
  const [site,setSite]=useState<Site|null>(null);
  const [listings,setListings]=useState<Listing[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [operation,setOperation]=useState('ALL');
  const [selected,setSelected]=useState<Listing|null>(null);
  const [consigning,setConsigning]=useState(()=>
    new URLSearchParams(window.location.search).get('consignar')==='1'
  );

  useEffect(()=>{
    let disposed=false;
    setLoading(true);setSite(null);setListings([]);setError('');
    if(!slug) {setError('Enlace de inmobiliaria no válido.');setLoading(false);return;}
    void (async()=>{
      try {
        const [siteResult,catalogResult]=await Promise.all([
          supabase.rpc('get_public_property_intake_site',{p_slug:slug}),
          supabase.rpc('get_public_agency_listings',{p_site_slug:slug}),
        ]);
        if(disposed)return;
        if(siteResult.error||catalogResult.error||!siteResult.data?.slug ||
          siteResult.data.slug!==slug||!Array.isArray(catalogResult.data)||
          catalogResult.data.some(v=>!verifiedListing(v))) {
          throw new Error('No fue posible comprobar el inventario público de esta inmobiliaria.');
        }
        setSite(siteResult.data as Site);
        setListings(catalogResult.data as Listing[]);
      }catch(e){
        if(!disposed){
          setError(e instanceof Error?e.message:'No se pudo consultar el catálogo público.');
          setListings([]);setSite(null);
        }
      }finally{if(!disposed)setLoading(false);}
    })();
    return()=>{disposed=true;};
  },[slug]);

  const visible=useMemo(()=>listings.filter(item=>{
    if(operation!=='ALL'&&item.operation_type!==operation)return false;
    const text=[item.title,item.code,item.city,item.state,item.neighborhood,item.property_type]
      .filter(Boolean).join(' ').toLocaleLowerCase('es-CO');
    return text.includes(search.trim().toLocaleLowerCase('es-CO'));
  }),[listings,search,operation]);

  return <div className="min-h-screen bg-[#F9F9F7] text-slate-900">
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto max-w-[1200px] px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border p-3"><Building2 className="h-7 w-7 text-[#0F2942]"/></div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">INMOJCO · Catálogo inmobiliario</p>
            <h1 className="text-xl font-semibold">{site?.company_name||'Portal de inmobiliaria'}</h1>
          </div>
        </div>
        <a href="/" className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium">
          <ArrowLeft className="h-4 w-4"/> Volver a INMOJCO
        </a>
      </div>
    </header>
    <main className="mx-auto max-w-[1200px] px-6 py-12">
      <div className="flex flex-wrap justify-between items-end gap-6 mb-10">
        <div>
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">Inventario público verificado</p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Inmuebles de esta inmobiliaria</h2>
          <p className="mt-3 max-w-xl text-sm text-stone-600">
            Solo propiedades reales disponibles y autorizadas para publicación por esta inmobiliaria.
            Los expedientes privados de otras empresas no forman parte de este catálogo.
          </p>
        </div>
        {site && <button type="button" onClick={()=>setConsigning(true)}
          className="rounded-lg bg-[#0F2942] px-5 py-3 text-sm font-semibold text-white">
          Consignar mi propiedad
        </button>}
      </div>

      {error && <div role="alert" className="rounded-xl border border-amber-300 bg-white p-6 text-amber-900">{error}</div>}
      {loading && <p role="status" className="rounded-xl border bg-white p-8">Verificando el catálogo de la inmobiliaria…</p>}
      {!error&&!loading&&site&&<>
        <div className="mb-8 flex flex-wrap gap-3">
          <label className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-3 h-4 w-4 text-stone-500"/>
            <input aria-label="Buscar inmueble" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Buscar por ciudad, zona o inmueble" className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-10 pr-3 text-sm"/>
          </label>
          <select aria-label="Filtrar operación" value={operation} onChange={e=>setOperation(e.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm">
            <option value="ALL">Todas las operaciones</option>
            {Object.entries(operations).map(([value,label])=><option value={value} key={value}>{label}</option>)}
          </select>
        </div>
        {visible.length===0 && <div className="rounded-2xl border bg-white p-10 text-center text-stone-600">
          <Home className="mx-auto mb-4 h-9 w-9 text-[#0F2942]"/>
          {listings.length===0?'Esta inmobiliaria todavía no tiene inmuebles aprobados para publicación.':
            'No hay inmuebles que coincidan con los filtros.'}
        </div>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {visible.map(item=><article key={item.id}
            className="group bg-white border border-stone-200/90 rounded-xl overflow-hidden flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5">
            <div>
              <button type="button" onClick={()=>setSelected(item)}
                className="relative aspect-4/3 w-full bg-stone-100 overflow-hidden text-left">
                <ResilientImage src={safeListingImage(item.image_url)} alt={item.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"/>
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/55 via-transparent to-transparent"/>
                <div className="absolute bottom-3 left-4 text-white font-semibold text-xl">{money(item.price,item.currency)}</div>
              </button>
              <div className="p-5">
                <div className="flex justify-between text-xs text-stone-500 mb-2">
                  <span>{operations[item.operation_type]||item.operation_type}</span><span>{item.code}</span>
                </div>
                <h3 className="text-lg font-semibold leading-snug">{item.title}</h3>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-stone-600">
                  <MapPin className="h-4 w-4 shrink-0"/>
                  {[item.neighborhood,item.city,item.state].filter(Boolean).join(', ')||'Ubicación por confirmar'}
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs text-stone-600">
                  {item.built_area!=null&&<span className="rounded border px-2 py-1">{item.built_area} m²</span>}
                  {item.bedrooms!=null&&<span className="rounded border px-2 py-1">{item.bedrooms} habitaciones</span>}
                  {item.bathrooms!=null&&<span className="rounded border px-2 py-1">{item.bathrooms} baños</span>}
                </div>
              </div>
            </div>
            <button type="button" onClick={()=>setSelected(item)}
              className="mx-5 mb-5 rounded-lg border border-[#0F2942] py-2.5 text-sm font-semibold text-[#0F2942] hover:bg-stone-50">
              Ver ficha del inmueble
            </button>
          </article>)}
        </div>
      </>}
    </main>
    {selected&&<div role="dialog" aria-modal="true" aria-label={'Ficha de '+selected.title}
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4">
      <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white">
        <button type="button" aria-label="Cerrar ficha" onClick={()=>setSelected(null)}
          className="absolute right-3 top-3 z-10 rounded-lg bg-white p-2"><X className="h-5 w-5"/></button>
        <ResilientImage src={safeListingImage(selected.image_url)} alt={selected.title}
          className="aspect-video w-full object-cover"/>
        <div className="p-6">
          <p className="text-xs uppercase text-stone-500">{selected.code} · {operations[selected.operation_type]||selected.operation_type}</p>
          <h2 className="mt-2 text-2xl font-semibold">{selected.title}</h2>
          <p className="mt-2 text-xl font-semibold text-[#0F2942]">{money(selected.price,selected.currency)}</p>
          <p className="mt-3 text-stone-600">{[selected.neighborhood,selected.city,selected.state].filter(Boolean).join(', ')}</p>
          {selected.description&&<p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed">{selected.description}</p>}
          <p className="mt-6 border-t pt-4 text-xs text-stone-500">
            Ficha comercial pública. Los datos personales y el expediente del inmueble no se divulgan.
          </p>
        </div>
      </div>
    </div>}
    <SubmitPropertyModal isOpen={Boolean(site)&&consigning} onClose={()=>setConsigning(false)}/>
  </div>;
}
