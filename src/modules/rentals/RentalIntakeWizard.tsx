import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { PropertiesModule } from '../properties/PropertiesModule';
import { OwnersModule } from '../owners/OwnersModule';
import { ContactsModule } from '../contacts/ContactsModule';
import { TenantRentEntry } from '../finance/TenantRentEntry';
import { RentalContractClosure } from './RentalContractClosure';
import { supabase } from '../../lib/supabase';
import {
  automaticOwnerId, canPrepareRental, rentalAvailability,
  type LinkedRentalProperty,
} from '../../core/rental-owner-selection';

type OwnerChoice = { id: string; name: string; is_primary: boolean; ownership_percentage: number };

const STEPS = ['Vivienda', 'Cliente', 'Contrato', 'PDF firmado', 'Aprobación', 'Cobros'] as const;
const HINTS = [
  'Elige un inmueble y se buscará su propietario vinculado. Un mismo propietario puede tener varios inmuebles; elige el disponible para este contrato.',
  'Registra al arrendatario una sola vez. Si ya existe, selecciónalo en el paso Contrato.',
  'El asesor puede preparar un borrador; este paso no habilita cobros ni ocupa el inmueble.',
  'Adjunta el PDF firmado de las partes en el depósito privado de la inmobiliaria.',
  'Un administrador revisa el contrato y aprueba su activación. No se permite duplicar un contrato activo para la misma vivienda.',
  'Con el contrato activo, el administrador puede crear el cobro mensual y registrar abonos realmente recibidos.',
] as const;

export function RentalIntakeWizard({ organizationId }: { organizationId: string }) {
  const { can } = useAuth();
  const [step, setStep] = useState(0);
  const [propertyTab, setPropertyTab] = useState<'PROPERTY' | 'OWNER' | 'CLOSURE'>('PROPERTY');
  const [propertyId, setPropertyId] = useState<string>();
  const [propertyName, setPropertyName] = useState('');
  const [ownerId, setOwnerId] = useState<string>();
  const [ownerName, setOwnerName] = useState('');
  const [tenantId, setTenantId] = useState<string>();
  const [leaseId, setLeaseId] = useState<string>();
  const [selectionNotice, setSelectionNotice] = useState('');
  const [ownerChoices, setOwnerChoices] = useState<OwnerChoice[]>([]);
  const [ownerLookup, setOwnerLookup] = useState<'idle'|'loading'|'loaded'|'error'>('idle');
  const [ownerLookupMessage, setOwnerLookupMessage] = useState('');
  const [linkedProperties, setLinkedProperties] = useState<LinkedRentalProperty[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState('');
  const lookupVersion = useRef(0);
  const canViewOwners = can(PERMISSIONS.OWNERS_VIEW);

  // Ignore responses from a previously selected property, changed membership or unmounted wizard.
  useEffect(() => () => { lookupVersion.current += 1; }, [organizationId]);

  async function resolvePropertyOwner(selectedId: string) {
    const version = ++lookupVersion.current;
    setOwnerChoices([]);
    setOwnerLookupMessage('');
    setOwnerLookup('loading');
    if (!canViewOwners) {
      setOwnerLookup('error');
      setOwnerLookupMessage('Tu perfil no tiene permiso para consultar los propietarios vinculados.');
      return;
    }
    try {
      const links = await supabase.from('property_ownerships')
        .select('owner_id,is_primary,ownership_percentage',{count:'exact'})
        .eq('property_id',selectedId).limit(501);
      if (version !== lookupVersion.current) return;
      if (links.error || links.count == null || links.count > (links.data??[]).length ||
          (links.data??[]).length > 500)
        throw new Error('No fue posible consultar todas las vinculaciones del inmueble.');
      const rows = links.data??[];
      if (!rows.length) {
        setOwnerLookupMessage('Este inmueble no tiene propietario vinculado. Regístralo o vincúlalo antes del contrato.');
        setOwnerLookup('loaded');
        return;
      }
      const ids = [...new Set(rows.map(row=>row.owner_id))];
      const owners = await supabase.from('property_owners')
        .select('id,first_name,last_name').eq('organization_id',organizationId).eq('agency_status','ACTIVE').in('id',ids).limit(501);
      if (version !== lookupVersion.current) return;
      if (owners.error || (owners.data??[]).length !== ids.length)
        throw new Error('Hay vínculos cuyos propietarios no pueden verificarse en esta inmobiliaria.');
      const choices: OwnerChoice[] = rows.map(link=>{
        const owner=owners.data!.find(item=>item.id===link.owner_id)!;
        return {
          id:owner.id, name:[owner.first_name,owner.last_name].filter(Boolean).join(' '),
          is_primary:link.is_primary,ownership_percentage:Number(link.ownership_percentage),
        };
      });
      const preferred=automaticOwnerId(rows);
      setOwnerChoices(choices);
      setOwnerLookup('loaded');
      if (preferred) {
        const owner=choices.find(choice=>choice.id===preferred)!;
        setOwnerId(owner.id);setOwnerName(owner.name);
        setOwnerLookupMessage('Propietario vinculado seleccionado automáticamente. Puedes cambiarlo si hay copropietarios.');
      } else {
        setOwnerLookupMessage('Hay varios propietarios sin un principal único. Elige quién figurará en el borrador.');
      }
    } catch (cause) {
      if (version !== lookupVersion.current) return;
      setOwnerLookup('error');
      setOwnerLookupMessage(cause instanceof Error?cause.message:'Error al consultar el propietario.');
    }
  }

  // A selected owner may be linked to many properties; never infer ownership from the visible code.
  useEffect(() => {
    let cancelled=false;
    setLinkedProperties([]);setLinksError('');setLinksLoading(Boolean(ownerId&&canViewOwners));
    if (!ownerId || !canViewOwners) return () => {cancelled=true;};
    void (async()=>{
      try {
        const links=await supabase.from('property_ownerships')
          .select('property_id',{count:'exact'}).eq('owner_id',ownerId).limit(501);
        if (cancelled)return;
        if(links.error||links.count==null||links.count>(links.data??[]).length||(links.data??[]).length>500)
          throw new Error('No se pudo consultar la totalidad de inmuebles del propietario.');
        const ids=[...new Set((links.data??[]).map(link=>link.property_id))];
        if(!ids.length){
          if(propertyId){
            setPropertyId(undefined);setPropertyName('');
            setSelectionNotice('El propietario seleccionado todavía no está vinculado al inmueble anterior.');
          }
          return;
        }
        const [p,l]=await Promise.all([
          supabase.from('properties').select('id,code,title,status,operation_type')
            .eq('organization_id',organizationId).in('id',ids).limit(501),
          supabase.from('leases').select('property_id',{count:'exact'})
            .eq('organization_id',organizationId).in('property_id',ids)
            .in('status',['ACTIVE','RENEWAL']).limit(501),
        ]);
        if(cancelled)return;
        if(p.error||l.error||(p.data??[]).length!==ids.length||l.count==null||
           l.count>(l.data??[]).length||(l.data??[]).length>500)
          throw new Error('No se pudo comprobar el inventario o los contratos activos del propietario.');
        const occupied=new Set((l.data??[]).map(row=>row.property_id));
        const options:LinkedRentalProperty[]=(p.data??[]).map(item=>({
          ...item,has_active_lease:occupied.has(item.id),
        })).sort((a,b)=>a.code.localeCompare(b.code,'es'));
        setLinkedProperties(options);
        if(propertyId&&!options.some(option=>option.id===propertyId)){
          setPropertyId(undefined);setPropertyName('');
          setLeaseId(undefined);
          setSelectionNotice('La vivienda anterior no corresponde al propietario seleccionado. Elige una de sus propiedades vinculadas.');
        }
      }catch(cause){
        if(!cancelled)setLinksError(cause instanceof Error?cause.message:'Error consultando inmuebles vinculados.');
      }finally{
        if(!cancelled)setLinksLoading(false);
      }
    })();
    return()=>{cancelled=true;};
  },[ownerId,organizationId,canViewOwners]);


  // Only the wizard's choices are cleared; persisted properties, owners and contracts remain unchanged.
  const resetDraftPreference = () => {
    if (leaseId) setSelectionNotice('La vinculación anterior permanece guardada. Solo se cambió la selección de este asistente.');
    else setSelectionNotice('');
    setLeaseId(undefined);
  };
  const clearOwnerSelection = () => {
    lookupVersion.current += 1;
    setOwnerId(undefined);
    setOwnerName('');
    resetDraftPreference();
  };
  const clearPropertySelection = () => {
    lookupVersion.current += 1;
    setOwnerChoices([]);setOwnerLookup('idle');setOwnerLookupMessage('');
    setPropertyId(undefined);
    setPropertyName('');
    setOwnerId(undefined);
    setOwnerName('');
    resetDraftPreference();
  };
  const canDraft = can(PERMISSIONS.LEASES_CREATE);
  const canActivate = can(PERMISSIONS.LEASES_EDIT);
  const canCollect = can(PERMISSIONS.RENT_PAYMENTS_CREATE);
  const canView = can(PERMISSIONS.PROPERTIES_VIEW) && can(PERMISSIONS.CLIENTS_VIEW);

  if (!canView) return <div role="alert" className="rounded-2xl border bg-white p-5 text-sm">
    Tu perfil requiere permiso de lectura sobre Propiedades y Clientes para iniciar una vinculación.
  </div>;

  return <section className="space-y-5" aria-label="Nueva vinculación de arrendamiento">
    <header className="rounded-2xl border border-stone-200 bg-white p-5">
      <h1 className="text-2xl font-bold">Nueva vinculación de arrendamiento</h1>
      <p className="mt-1 text-sm text-slate-600">
        Ruta guiada para asesores y administradores: inmueble → cliente → borrador → PDF → aprobación → cobros.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {STEPS.map((name, index) => <button key={name} type="button"
          aria-current={step === index ? 'step' : undefined}
          onClick={() => setStep(index)}
          className={'rounded-xl border px-3 py-3 text-left text-xs font-semibold ' +
            (step === index ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white text-slate-700')}>
          <span className="block text-base">{index + 1}</span>{name}
        </button>)}
      </div>
      <p className="mt-3 text-sm text-slate-700">{HINTS[step]}</p>
      <p className="mt-2 text-xs text-slate-500">
        Puedes regresar a pasos anteriores sin duplicar registros. Los permisos y el estado del contrato
        se comprueban nuevamente en el servidor.
      </p>
    </header>

    {step === 0 && <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPropertyTab('PROPERTY')}
          className={'rounded-lg border px-3 py-2 text-sm font-semibold ' +
            (propertyTab === 'PROPERTY' ? 'bg-slate-900 text-white' : 'bg-white')}>Vivienda / inventario</button>
        <button type="button" onClick={() => setPropertyTab('OWNER')}
          className={'rounded-lg border px-3 py-2 text-sm font-semibold ' +
            (propertyTab === 'OWNER' ? 'bg-slate-900 text-white' : 'bg-white')}>Registrar / vincular propietario</button>
        {can(PERMISSIONS.LEASES_EDIT) && <button type="button" onClick={() => setPropertyTab('CLOSURE')}
          className={'rounded-lg border px-3 py-2 text-sm font-semibold ' +
            (propertyTab === 'CLOSURE' ? 'bg-slate-900 text-white' : 'bg-white')}>
          Finalizar contrato / liberar inmueble
        </button>}
      </div>
      {propertyTab === 'CLOSURE' && <RentalContractClosure organizationId={organizationId}
        onFinished={finishedPropertyId=>{
          if(propertyId===finishedPropertyId)clearPropertySelection();
        }}/>}
      {propertyTab === 'PROPERTY' && <PropertiesModule
        selectedPropertyId={propertyId}
        onClearSelection={clearPropertySelection}
        onSelect={(id,name) => {
          if (id !== propertyId) {
            setOwnerId(undefined);
            setOwnerName('');
            resetDraftPreference();
          }
          setPropertyId(id); setPropertyName(name);
          void resolvePropertyOwner(id);
        }}
        onCreated={id => {
          resetDraftPreference();
          setPropertyId(id); setPropertyName('Nueva vivienda · '+id.slice(0,8));
          setOwnerId(undefined); setOwnerName('');
          void resolvePropertyOwner(id);
        }} />}
      {propertyTab === 'OWNER' && <OwnersModule ownersOnly
        selectedOwnerId={ownerId}
        onClearSelection={clearOwnerSelection}
        onSelect={(id,name) => {
          if (id !== ownerId) resetDraftPreference();
          lookupVersion.current += 1;
          setOwnerChoices([]);setOwnerLookup('idle');setOwnerLookupMessage('');
          setOwnerId(id); setOwnerName(name);
        }}
        onCreated={(id,name) => {
          resetDraftPreference();
          lookupVersion.current += 1;
          setOwnerChoices([]);setOwnerLookup('idle');setOwnerLookupMessage('');
          setOwnerId(id); setOwnerName(name);
        }} />}
      {propertyId && ownerLookup==='loading' && <p role="status" className="rounded-lg border bg-white p-3 text-sm">
        Buscando el propietario vinculado al inmueble…
      </p>}
      {propertyId && ownerLookupMessage && <p role={ownerLookup==='error'?'alert':'status'}
        className={'rounded-lg border p-3 text-sm '+(ownerLookup==='error'?'border-amber-400 text-amber-900':'bg-white text-slate-700')}>
        {ownerLookupMessage}
      </p>}
      {propertyId && ownerChoices.length>1 && <div className="space-y-2 rounded-xl border bg-white p-3">
        <p className="text-sm font-semibold">Copropietarios registrados · seleccionar para el borrador</p>
        <div className="flex flex-wrap gap-2">
          {ownerChoices.map(choice=><button type="button" key={choice.id} aria-pressed={ownerId===choice.id}
            onClick={()=>{
              lookupVersion.current+=1;
              resetDraftPreference();setOwnerId(choice.id);setOwnerName(choice.name);
            }}
            className={'rounded-lg border px-3 py-2 text-sm '+(ownerId===choice.id?'bg-slate-900 text-white':'hover:bg-stone-100')}>
            {choice.name} · {choice.ownership_percentage}%{choice.is_primary?' · Principal':''}
          </button>)}
        </div>
      </div>}
      {ownerId && canViewOwners && <div className="space-y-2 rounded-xl border bg-white p-3"
        aria-label="Inmuebles vinculados al propietario">
        <p className="font-semibold text-sm">Inmuebles de {ownerName}</p>
        <p className="text-xs text-slate-600">Un propietario puede tener varios inmuebles. Selecciona el disponible o el que corresponda al trámite; los ocupados o no aptos no se habilitan para un nuevo arriendo.</p>
        {linksLoading && <p role="status" className="text-sm">Comprobando inmuebles y contratos activos…</p>}
        {linksError && <p role="alert" className="text-sm text-red-800">{linksError}</p>}
        {!linksLoading&&!linksError&&linkedProperties.length===0&&<p className="text-sm text-amber-900">
          No hay inmuebles vinculados a este propietario. Primero registra la vinculación en Propietarios.
        </p>}
        {!linksLoading&&!linksError&&linkedProperties.map(item=>{
          const available=canPrepareRental(item);
          return <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <div>
              <p className="font-semibold">{item.code} · {item.title}</p>
              <p className={available?'text-slate-600':'text-amber-800'}>{rentalAvailability(item)}</p>
            </div>
            <button type="button" disabled={!available} aria-pressed={propertyId===item.id}
              onClick={()=>{
                if(!canPrepareRental(item))return;
                lookupVersion.current+=1;
                resetDraftPreference();setOwnerChoices([]);setOwnerLookup('idle');setOwnerLookupMessage('');
                setPropertyId(item.id);setPropertyName(item.code+' · '+item.title);
              }}
              className={'rounded-lg border px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50 '+
                (propertyId===item.id?'bg-slate-900 text-white':'hover:bg-stone-100')}>
              {propertyId===item.id?'Inmueble elegido':'Elegir inmueble'}
            </button>
          </div>;
        })}
      </div>}
      {propertyTab !== 'CLOSURE' && <div className="grid gap-2 sm:grid-cols-2" aria-label="Selección para el nuevo contrato">
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm">
          <span><strong>Vivienda elegida:</strong> {propertyId ? propertyName || propertyId.slice(0,8) : 'Pendiente de selección'}</span>
          {propertyId && <button type="button" onClick={clearPropertySelection}
            aria-label="Quitar selección de vivienda"
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-stone-100">Quitar selección</button>}
        </div>
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm">
          <span><strong>Propietario elegido:</strong> {ownerId ? ownerName || ownerId.slice(0,8) : 'Pendiente de selección'}</span>
          {ownerId && <button type="button" onClick={clearOwnerSelection}
            aria-label="Quitar selección de propietario"
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-stone-100">Quitar selección</button>}
        </div>
      </div>}
      {selectionNotice && <p role="status" className="text-xs text-slate-600">{selectionNotice}</p>}
      <p className="text-xs text-slate-600">
        Elegir un propietario aquí lo prepara para el contrato; no modifica las escrituras,
        la participación de propiedad ni las vinculaciones registradas del inmueble.
      </p>
      <p className="text-sm text-slate-600">
        Si la vivienda ya figura en el inventario, no la dupliques. Se podrá elegir directamente al crear el contrato.
        Si tenía un arrendamiento anterior, el administrador debe confirmar su cierre antes de activar uno nuevo.
      </p>
    </div>}

    {step === 1 && <ContactsModule contactsOnly onCreated={id => setTenantId(id)} />}

    {step === 2 && <div className="space-y-3">
      {!canDraft && <p role="alert" className="rounded-lg border border-amber-300 p-3 text-sm text-amber-800">
        El administrador de la inmobiliaria debe habilitar «leases.create» para preparar borradores.
      </p>}
      <TenantRentEntry key={'draft-' + organizationId} organizationId={organizationId} mode="DRAFT"
        preferredPropertyId={propertyId} preferredTenantId={tenantId} preferredOwnerId={ownerId}
        onDraftCreated={id => { setLeaseId(id); setStep(3); }} />
    </div>}

    {step === 3 && <TenantRentEntry key={'signed-' + organizationId} organizationId={organizationId}
      mode="SIGNED_PDF" preferredLeaseId={leaseId}
      onPdfUploaded={id => { setLeaseId(id); setStep(4); }} />}

    {step === 4 && <div className="space-y-3">
      {!canActivate && <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm text-amber-800">
        Tu parte como asesor termina al preparar el borrador y adjuntar el contrato firmado.
        Solicita al administrador que ingrese a este mismo paso para revisar y activar.
      </p>}
      <TenantRentEntry key={'approval-' + organizationId} organizationId={organizationId}
        mode="APPROVAL" preferredLeaseId={leaseId}
        onActivated={id => { setLeaseId(id); setStep(5); }} />
    </div>}

    {step === 5 && <div className="space-y-3">
      {!canCollect && <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm text-amber-800">
        Los cobros y abonos están reservados a perfiles con autorización financiera.
      </p>}
      <TenantRentEntry key={'billing-' + organizationId} organizationId={organizationId}
        mode="BILLING" preferredLeaseId={leaseId} />
    </div>}

    <footer className="flex items-center justify-between gap-3 rounded-2xl border bg-white p-4">
      <button type="button" onClick={() => setStep(s => Math.max(0, s - 1))}
        disabled={step === 0} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">
        Anterior
      </button>
      <span className="text-xs text-slate-500">Paso {step + 1} de 6</span>
      <button type="button" onClick={() => setStep(s => Math.min(5, s + 1))}
        disabled={step === 5}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
        Siguiente
      </button>
    </footer>
  </section>;
}
