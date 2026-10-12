import { useState } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { PropertiesModule } from '../properties/PropertiesModule';
import { OwnersModule } from '../owners/OwnersModule';
import { ContactsModule } from '../contacts/ContactsModule';
import { TenantRentEntry } from '../finance/TenantRentEntry';

const STEPS = ['Vivienda', 'Cliente', 'Contrato', 'PDF firmado', 'Aprobación', 'Cobros'] as const;
const HINTS = [
  'Registra una vivienda nueva o usa una que ya está en el inventario. Si el propietario aún no existe, regístralo aquí.',
  'Registra al arrendatario una sola vez. Si ya existe, selecciónalo en el paso Contrato.',
  'El asesor puede preparar un borrador; este paso no habilita cobros ni ocupa el inmueble.',
  'Adjunta el PDF firmado de las partes en el depósito privado de la inmobiliaria.',
  'Un administrador revisa el contrato y aprueba su activación. No se permite duplicar un contrato activo para la misma vivienda.',
  'Con el contrato activo, el administrador puede crear el cobro mensual y registrar abonos realmente recibidos.',
] as const;

export function RentalIntakeWizard({ organizationId }: { organizationId: string }) {
  const { can } = useAuth();
  const [step, setStep] = useState(0);
  const [propertyTab, setPropertyTab] = useState<'PROPERTY' | 'OWNER'>('PROPERTY');
  const [propertyId, setPropertyId] = useState<string>();
  const [propertyName, setPropertyName] = useState('');
  const [ownerId, setOwnerId] = useState<string>();
  const [ownerName, setOwnerName] = useState('');
  const [tenantId, setTenantId] = useState<string>();
  const [leaseId, setLeaseId] = useState<string>();
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
      </div>
      {propertyTab === 'PROPERTY' && <PropertiesModule
        selectedPropertyId={propertyId}
        onSelect={(id,name) => {
          if (id !== propertyId) { setOwnerId(undefined); setOwnerName(''); }
          setPropertyId(id); setPropertyName(name);
        }}
        onCreated={id => {
          setPropertyId(id); setPropertyName('Nueva vivienda · '+id.slice(0,8));
          setOwnerId(undefined); setOwnerName('');
        }} />}
      {propertyTab === 'OWNER' && <OwnersModule ownersOnly
        selectedOwnerId={ownerId}
        onSelect={(id,name) => { setOwnerId(id); setOwnerName(name); }}
        onCreated={(id,name) => { setOwnerId(id); setOwnerName(name); }} />}
      <div className="grid gap-2 sm:grid-cols-2" aria-label="Selección para el nuevo contrato">
        <p role="status" className="rounded-lg border bg-white p-3 text-sm">
          <strong>Vivienda elegida:</strong> {propertyId ? propertyName || propertyId.slice(0,8) : 'Pendiente de selección'}
        </p>
        <p role="status" className="rounded-lg border bg-white p-3 text-sm">
          <strong>Propietario elegido:</strong> {ownerId ? ownerName || ownerId.slice(0,8) : 'Pendiente de selección'}
        </p>
      </div>
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
