import { useEffect, useState, type FormEvent } from 'react';
import { etiquetaES } from '../../core/etiquetas-es';
import { Building2, CheckCircle2, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { MAX_PHOTOS, validateInventoryPhotos, saveInventoryPhotos, loadInventoryPhotos, type InventoryPhoto } from '../../lib/property-private-photos';

interface PropertyRow {
  id: string;
  code: string;
  title: string;
  operation_type: string;
  property_type: string;
  status: string;
  price: number | null;
  currency: string;
  city: string | null;
  neighborhood: string | null;
  created_at: string;
}

export function PropertiesModule({onCreated,onSelect,onClearSelection,selectedPropertyId}: {
  onCreated?: (propertyId:string)=>void;
  onSelect?: (propertyId:string,propertyName:string)=>void;
  onClearSelection?: () => void;
  selectedPropertyId?: string;
} = {}) {
  const { user, activeMembership, can } = useAuth();
  const { branding } = useTenantBranding();
  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [occupiedPropertyIds,setOccupiedPropertyIds]=useState<Set<string>>(new Set());
  const [occupancyError,setOccupancyError]=useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<PropertyRow | null>(null);
  const [photoList, setPhotoList] = useState<InventoryPhoto[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);

  const organizationId = activeMembership?.organization.id;

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    const [propertyResult,leaseResult]=await Promise.all([
      supabase.from('properties')
        .select('id,code,title,operation_type,property_type,status,price,currency,city,neighborhood,created_at')
        .eq('organization_id',organizationId).order('created_at',{ascending:false}),
      supabase.from('leases').select('property_id',{count:'exact'})
        .eq('organization_id',organizationId).in('status',['ACTIVE','RENEWAL']).limit(501),
    ]);
    const incomplete=leaseResult.count==null||(leaseResult.data??[]).length<leaseResult.count;
    if(propertyResult.error||leaseResult.error||incomplete){
      setOccupancyError(true);
      setOccupiedPropertyIds(new Set());
      setRows([]);
      setMessage('No se puede verificar inventario y contratos activos. Actualiza antes de asignar inmuebles.');
    }else{
      setOccupancyError(false);
      setRows((propertyResult.data??[]) as PropertyRow[]);
      setOccupiedPropertyIds(new Set((leaseResult.data??[]).map(x=>x.property_id)));
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const reload=()=>{void load();};
    const reloadWhenVisible=()=>{if(document.visibilityState==='visible')void load();};
    window.addEventListener('lease-finished',reload);
    window.addEventListener('lease-activated',reload);
    window.addEventListener('tenant-rent-updated',reload);
    window.addEventListener('owner-agency-retired',reload);
    window.addEventListener('focus',reload);
    document.addEventListener('visibilitychange',reloadWhenVisible);
    return()=>{
      window.removeEventListener('lease-finished',reload);
      window.removeEventListener('lease-activated',reload);
      window.removeEventListener('tenant-rent-updated',reload);
      window.removeEventListener('owner-agency-retired',reload);
      window.removeEventListener('focus',reload);
      document.removeEventListener('visibilitychange',reloadWhenVisible);
    };
  }, [organizationId]);

  async function createProperty(event: FormEvent<HTMLFormElement>) {
    if(saving)return;
    const formNode = event.currentTarget;
    event.preventDefault();
    if (!organizationId || !user || !can(PERMISSIONS.PROPERTIES_CREATE)) {
      setMessage('No tienes permiso para crear propiedades.');
      return;
    }

    const form = new FormData(event.currentTarget);
    const code = String(form.get('code') ?? '').trim();
    const title = String(form.get('title') ?? '').trim();
    const propertyType = String(form.get('property_type') ?? '').trim();
    if (!code || !title || !propertyType) {
      setMessage('Código, título y tipo de inmueble son obligatorios.');
      return;
    }
    if (rows.some((property) => property.code.toLowerCase() === code.toLowerCase())) {
      setMessage('Ya existe una propiedad con este código en la inmobiliaria.');
      return;
    }
    const priceValue = String(form.get('price') ?? '').trim();
    const parsedPrice = priceValue ? Number(priceValue) : null;
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setMessage('El precio debe ser un número válido mayor o igual a cero.');
      return;
    }

    const photoError=validateInventoryPhotos(pendingPhotos);
    if(photoError){setMessage(photoError);return;}
    setSaving(true);
    const payload = {
      organization_id: organizationId,
      code,
      title,
      description: String(form.get('description') ?? '').trim() || null,
      operation_type: String(form.get('operation_type') ?? 'SALE'),
      property_type: propertyType,
      status: 'AVAILABLE',
      price: parsedPrice,
      currency: String(form.get('currency') ?? 'COP'),
      city: String(form.get('city') ?? '').trim() || null,
      neighborhood: String(form.get('neighborhood') ?? '').trim() || null,
      address: String(form.get('address') ?? '').trim() || null,
      created_by: user.id,
      assigned_agent_id: user.id,
    };

    const { data: created, error } = await supabase.from('properties').insert(payload).select('id').single();

    if (error) {
      setSaving(false);
      setMessage(error.code === '23505'
        ? 'El código de esta propiedad ya está registrado en la inmobiliaria. Utiliza otro código.'
        : error.message);
      return;
    }

    if(created?.id) onCreated?.(created.id);
    let status='Propiedad creada correctamente.';
    if(pendingPhotos.length && created?.id){
      try{
        const saved=await saveInventoryPhotos(created.id,organizationId,pendingPhotos);
        status=`Propiedad creada y ${saved} fotografías guardadas.`;
      }catch(cause){status=`Propiedad creada, pero las fotos no se completaron: ${cause instanceof Error ? cause.message : 'Error de carga'}. Puedes agregarlas desde el inventario.`;}
    }
    setMessage(status);
    setSaving(false);
    setPendingPhotos([]);
    setShowCreate(false);
    formNode.reset();
    await load();
  }

  async function openGallery(property: PropertyRow) {
    setSelectedProperty(property);
    setPhotoList([]);
    setGalleryFiles([]);
    if(!organizationId)return;
    setGalleryBusy(true);
    try {setPhotoList(await loadInventoryPhotos(property.id,organizationId));}
    catch(cause){setMessage(cause instanceof Error?cause.message:'No fue posible abrir la galería.');}
    finally{setGalleryBusy(false);}
  }
  async function addGalleryPhotos() {
    if(!organizationId||!selectedProperty||galleryBusy)return;
    const issue=validateInventoryPhotos(galleryFiles,photoList.length);
    if(issue){setMessage(issue);return;}
    setGalleryBusy(true);
    try {
      const count=await saveInventoryPhotos(selectedProperty.id,organizationId,galleryFiles);
      setPhotoList(await loadInventoryPhotos(selectedProperty.id,organizationId));
      setGalleryFiles([]);
      setMessage(`${count} fotografías guardadas en la propiedad.`);
    }catch(cause){setMessage(cause instanceof Error?cause.message:'No se pudieron subir las fotografías.');}
    finally{setGalleryBusy(false);}
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Propiedades</h1>
          <p className="mt-1 text-sm text-slate-600">Inventario privado de la inmobiliaria.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
          {can(PERMISSIONS.PROPERTIES_CREATE) && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nueva propiedad
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createProperty} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <Field name="code" label="Código" required />
          <Field name="title" label="Título" required />
          <SelectField name="operation_type" label="Operación" options={[
            ['SALE','Venta'], ['RENT','Arriendo'], ['SALE_OR_RENT','Venta o arriendo'], ['ADMINISTRATION','Administración'],
          ]} />
          <Field name="property_type" label="Tipo de inmueble" placeholder="Apartamento, casa, local..." required />
          <Field name="price" label="Precio" type="number" min="0" step="0.01" />
          <SelectField name="currency" label="Moneda" options={[['COP','COP'],['MXN','MXN'],['USD','USD']]} />
          <Field name="city" label="Ciudad" />
          <Field name="neighborhood" label="Barrio / zona" />
          <div className="md:col-span-2"><Field name="address" label="Dirección" /></div>
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Descripción</span>
            <textarea name="description" rows={4} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>
          <div className="md:col-span-2 rounded-xl border border-stone-200 p-4">
            <label className="block text-sm font-semibold" htmlFor="inventory-new-photos">Fotografías del inmueble (máximo 10)</label>
            <p className="mt-1 text-xs text-slate-600">JPG, PNG o WebP. Hasta 5 MB por fotografía. Solo usuarios autorizados de esta inmobiliaria podrán verlas.</p>
            <input id="inventory-new-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple
              onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';const next=[...pendingPhotos,...files];const issue=validateInventoryPhotos(next);if(issue){setMessage(issue);return;}setPendingPhotos(next);}}
              className="mt-2 w-full text-sm" />
            {pendingPhotos.length>0&&<ul className="mt-2 grid gap-2 sm:grid-cols-2">{pendingPhotos.map((file,i)=><li key={i} className="flex justify-between gap-2 rounded bg-stone-50 p-2 text-xs">
              <span className="truncate">{file.name}</span><button type="button" onClick={()=>setPendingPhotos(list=>list.filter((_,j)=>j!==i))} className="text-red-700">Quitar</button>
            </li>)}</ul>}
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => {setShowCreate(false);setPendingPhotos([]);}} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar propiedad'}</button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      {selectedProperty && <section className="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Galería privada">
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Fotografías: {selectedProperty.title}</h2><button type="button" onClick={()=>setSelectedProperty(null)} className="rounded-lg border px-3 py-1 text-xs">Cerrar</button></div>
        {galleryBusy && <p className="mt-2 text-sm">Procesando fotografías…</p>}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{photoList.map(photo=><a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border">
          <img src={photo.url} alt={`Imagen ${photo.order+1} de ${selectedProperty.title}`} loading="lazy" className="h-36 w-full object-cover" />
        </a>)}</div>
        {!galleryBusy && photoList.length===0&&<p className="mt-2 text-sm text-slate-600">Esta propiedad todavía no tiene fotografías.</p>}
        {can(PERMISSIONS.PROPERTIES_EDIT) && <div className="mt-4 space-y-2">
          <label htmlFor="existing-property-photos" className="block text-sm font-medium">Agregar fotografías ({photoList.length}/{MAX_PHOTOS})</label>
          <input id="existing-property-photos" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={galleryBusy || photoList.length>=MAX_PHOTOS}
            onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';const next=[...galleryFiles,...files];const issue=validateInventoryPhotos(next,photoList.length);if(issue){setMessage(issue);return;}setGalleryFiles(next);}}
            className="w-full text-sm" />
          {galleryFiles.length>0&&<p className="text-xs">{galleryFiles.length} fotografías seleccionadas</p>}
          <button type="button" onClick={()=>void addGalleryPhotos()} disabled={galleryBusy||galleryFiles.length===0} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">Guardar fotografías</button>
        </div>}
      </section>}
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Propiedad</th>
              <th className="px-4 py-3">Operación</th>
              <th className="px-4 py-3">Ubicación</th>
              <th className="px-4 py-3">Precio</th>
              <th className="px-4 py-3">Estado</th><th className="px-4 py-3">Fotos</th>
               {onSelect&&<th className="px-4 py-3">Elegir</th>}
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={onSelect?8:7} className="px-4 py-10 text-center text-slate-500">
                  <Building2 className="mx-auto mb-2 h-6 w-6" />
                  Aún no hay propiedades registradas.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className={'border-t border-stone-100 '+(onSelect&&selectedPropertyId===row.id?'bg-slate-50':'')}>
                <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{row.title}</div>
                  <div className="text-xs text-slate-500">{etiquetaES(row.property_type)}</div>
                </td>
                <td className="px-4 py-3">{operationLabel(row.operation_type)}</td>
                <td className="px-4 py-3">{[row.neighborhood, row.city].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-4 py-3 font-semibold">
                  {row.price == null ? '—' : new Intl.NumberFormat(branding.locale || 'es-CO', { style: 'currency', currency: row.currency || branding.currency || 'COP', maximumFractionDigits: 0 }).format(row.price)}
                </td>
                <td className="px-4 py-3">{occupiedPropertyIds.has(row.id)?'Arrendado · contrato activo':etiquetaES(row.status)}</td>
                <td className="px-4 py-3"><button type="button" onClick={()=>void openGallery(row)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Ver / agregar fotos</button></td>
                {onSelect&&<td className="px-4 py-3">
                  <button type="button" aria-pressed={selectedPropertyId===row.id}
                    disabled={occupancyError}
                    onClick={()=>selectedPropertyId===row.id&&onClearSelection
                       ? onClearSelection()
                       : onSelect(row.id,[row.code,row.title].filter(Boolean).join(' · '))}
                    className={'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-slate-900 '+
                      (selectedPropertyId===row.id?'border-slate-900 bg-slate-900 text-white':'hover:bg-slate-100')}>
                    {selectedPropertyId===row.id?<><CheckCircle2 className="h-3.5 w-3.5"/> {onClearSelection?'Quitar selección':'Seleccionada'}</>:'Seleccionar'}
                  </button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function operationLabel(value: string) {
  return ({ SALE: 'Venta', RENT: 'Arriendo', SALE_OR_RENT: 'Venta / arriendo', ADMINISTRATION: 'Administración' } as Record<string,string>)[value] ?? value;
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input {...inputProps} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
    </label>
  );
}

function SelectField({ name, label, options }: { name: string; label: string; options: [string,string][] }) {
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select name={name} className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  );
}
