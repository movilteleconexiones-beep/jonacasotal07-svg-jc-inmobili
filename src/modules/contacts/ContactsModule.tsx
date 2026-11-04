import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ContactRound, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';
import { sameContactIdentity } from '../../core/contact-identity';

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string;
  created_at: string;
}

export function ContactsModule({contactsOnly=false,onCreated,onSelected}: {contactsOnly?:boolean;onCreated?:(contactId:string)=>void;onSelected?:(contactId:string)=>void} = {}) {
  const { user, activeMembership, can } = useAuth();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');
  const [editContact, setEditContact] = useState<ContactRow|null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const loadVersion = useRef(0);
  // Synchronous lock: a second submit can fire before React renders busy state.
  const createInFlight = useRef(false);
  // One synchronous lock for CREATE, CORRECT and DELETE: React state updates
  // are asynchronous, so a fast second click must not submit a second RPC.
  const contactMutationInFlight = useRef(false);

  const organizationId = activeMembership?.organization.id;
  const currentOrganization = useRef(organizationId);
  currentOrganization.current = organizationId;
  const adminMayCorrect=Boolean(activeMembership?.roles.some(r=>r.key==='ADMIN')) &&
    can(PERMISSIONS.CLIENTS_EDIT);

  async function load() {
    const version = ++loadVersion.current;
    setRows([]);
    if (!organizationId) { setLoading(false); return; }
    setLoading(true);
    setMessage('');
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email, phone, whatsapp, source, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (version !== loadVersion.current) return;
      if (error) setMessage('No se pudieron consultar los contactos. Verifica tus permisos y vuelve a intentar.');
      else setRows((data ?? []) as ContactRow[]);
    } catch {
      if (version !== loadVersion.current) return;
      setMessage('No se pudo conectar con los contactos. Intenta actualizar.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    // Never retain another inmobiliaria's editable contact after switching tenant.
    setEditContact(null);
    setShowCreate(false);
    void load();
    return () => { ++loadVersion.current; };
  }, [organizationId]);

  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createInFlight.current || contactMutationInFlight.current || contactBusy) return;
    if (!organizationId || !user || !can(PERMISSIONS.CLIENTS_CREATE)) {
      setMessage('No tienes permiso para crear contactos.');
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get('email') ?? '').trim();
    const firstName = String(form.get('first_name') ?? '').trim();
    const lastName = String(form.get('last_name') ?? '').trim();
    const candidateIdentity = { email, first_name: firstName, last_name: lastName };
    const phone = String(form.get('phone') ?? '').trim();
    const whatsapp = String(form.get('whatsapp') ?? '').trim();
    if (!email && !phone && !whatsapp) {
      setMessage('Ingresa al menos un medio de contacto: correo, teléfono o WhatsApp.');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage('Ingresa un correo electrónico válido.');
      return;
    }
    if (email && rows.some(row => sameContactIdentity(row, candidateIdentity))) {
      setMessage('Ya existe una ficha con este correo y nombre. Utiliza «Editar cliente» para corregirla en lugar de crear otra.');
      return;
    }
    for (const number of [phone, whatsapp]) {
      const length = number.replace(/\D/g, '').length;
      if (number && (length < 7 || length > 15)) {
        setMessage('Los teléfonos deben contener entre 7 y 15 dígitos.');
        return;
      }
    }
    const payload = {
      organization_id: organizationId,
      first_name: firstName,
      last_name: lastName || null,
      email: email || null,
      phone: phone || null,
      whatsapp: whatsapp || null,
      source: String(form.get('source') ?? 'MANUAL'),
      notes: String(form.get('notes') ?? '').trim() || null,
      assigned_agent_id: user.id,
      created_by: user.id,
    };

    createInFlight.current = true;
    contactMutationInFlight.current = true;
    setContactBusy(true);
    try {
      if (email) {
        // The rendered list can be stale (other staff may have registered this email).
        // Escape SQL LIKE wildcards so a literal '_' or '%' in an email is not a wildcard.
        const literalEmailPattern = email.replace(/[\\%_]/g, character => '\\' + character);
        const { data: duplicates, error: duplicateError, count } = await supabase.from('contacts')
          .select('id,first_name,last_name,email', { count: 'exact' })
          .eq('organization_id', organizationId)
          .ilike('email', literalEmailPattern)
          .limit(500);
        if (currentOrganization.current !== organizationId) return;
        // Fail closed on error or incomplete paginated result: unseen contacts
        // must not be mistaken for evidence that the identity does not exist.
        if (duplicateError || count === null || count > (duplicates?.length ?? 0)) {
          setMessage('No fue posible comprobar todas las fichas con este correo. Actualiza la lista antes de registrar.');
          return;
        }
        if (duplicates?.some(row => sameContactIdentity(row, candidateIdentity))) {
          setMessage('Ya existe una ficha con este correo y nombre. Selecciona el cliente existente para evitar duplicados.');
          return;
        }
      }

      // UI preflight reduces duplicate submissions; the server must still enforce
      // concurrency guarantees if two sessions insert simultaneously.
      const { data:created, error } = await supabase.from('contacts').insert(payload).select('id').single();
      if (currentOrganization.current !== organizationId) return;
      if (error) {
        // Database-level uniqueness also arbitrates independent staff sessions.
        // Do not blindly retry an INSERT after a 23505 identity conflict.
        if (error.code === '23505' &&
            error.message.includes('jco_contacts_tenant_email_name_unique')) {
          setMessage('Otro usuario ya registró este cliente. Actualiza la lista y selecciona su ficha; no lo registres de nuevo.');
        } else {
          setMessage('No se pudo registrar el contacto: ' + error.message);
        }
        return;
      }
      if (created?.id) onCreated?.(created.id);
      setShowCreate(false);
      formElement.reset();
      await load();
      if (currentOrganization.current === organizationId) {
        setMessage('Cliente/contacto creado correctamente.');
      }
    } catch {
      if (currentOrganization.current === organizationId) {
        // A timeout can occur after a successful INSERT; verify before retrying.
        setMessage('No se confirmó el registro. Actualiza y comprueba si el cliente existe antes de reintentar.');
      }
    } finally {
      createInFlight.current = false;
      contactMutationInFlight.current = false;
      setContactBusy(false);
    }
  }

  async function correctContact(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!editContact||!organizationId||!adminMayCorrect||contactMutationInFlight.current||contactBusy)return;
    const data=new FormData(event.currentTarget);
    const reason=String(data.get('reason')||'').trim();
    const fields={
      new_first_name:String(data.get('first_name')||'').trim(),
      new_last_name:String(data.get('last_name')||'').trim(),
      new_email:String(data.get('email')||'').trim(),
      new_phone:String(data.get('phone')||'').trim(),
      new_whatsapp:String(data.get('whatsapp')||'').trim(),
    };
    if(fields.new_first_name.length<2||reason.length<12||reason.length>500||
       !(fields.new_email||fields.new_phone||fields.new_whatsapp)){
      setMessage('Completa el nombre, un contacto válido y el motivo (12-500 caracteres).');
      return;
    }
    if(fields.new_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.new_email)){
      setMessage('Correo electrónico inválido.');return;
    }
    for(const value of [fields.new_phone,fields.new_whatsapp]){
      if(value&&(value.replace(/\D/g,'').length<7||value.replace(/\D/g,'').length>15)){
        setMessage('Teléfonos de 7 a 15 dígitos.');return;
      }
    }
    if(!window.confirm('¿Guardar correcciones en esta ficha? Quedarán en auditoría con el motivo.'))return;
    if(currentOrganization.current!==organizationId||contactMutationInFlight.current)return;
    contactMutationInFlight.current=true;
    setContactBusy(true);
    try{
      const {error}=await supabase.rpc('admin_correct_client_contact',{
        target_org:organizationId,target_contact:editContact.id,...fields,reason,
      });
      // A response from an earlier tenant must never clear or replace the
      // active tenant's contact editor, list or success/error notices.
      if(currentOrganization.current!==organizationId)return;
      if(error){
        setMessage(error.code==='23505' && error.message.includes('jco_contacts_tenant_email_name_unique')
          ? 'La corrección duplicaría la ficha de otro cliente. Actualiza y utiliza la ficha existente.'
          : 'No se pudo corregir: '+error.message);
        return;
      }
      setEditContact(null);
      await load();
      if(currentOrganization.current===organizationId)
        setMessage('Ficha corregida y auditada, sin crear otro cliente.');
    }catch{
      if(currentOrganization.current===organizationId)
        setMessage('No se confirmó la corrección. Actualiza antes de reintentar.');
    }finally{
      contactMutationInFlight.current=false;
      setContactBusy(false);
    }
  }

  async function deleteUnlinkedContact(contact:ContactRow){
    if(!organizationId||!adminMayCorrect||contactMutationInFlight.current||contactBusy)return;
    const reason=window.prompt('Motivo de eliminación (12-500 caracteres). Si existe cualquier contrato, negocio o vínculo, se bloqueará.')?.trim();
    if(!reason)return;
    if(reason.length<12||reason.length>500){setMessage('Motivo obligatorio de 12-500 caracteres.');return;}
    if(!window.confirm('¿Eliminar esta ficha SOLO si nunca tuvo operaciones vinculadas? No se eliminará ningún contrato, abono ni prospecto.'))return;
    if(currentOrganization.current!==organizationId||contactMutationInFlight.current)return;
    contactMutationInFlight.current=true;
    setContactBusy(true);
    try{
      const {error}=await supabase.rpc('admin_delete_unlinked_contact',{
        target_org:organizationId,target_contact:contact.id,reason,
      });
      if(currentOrganization.current!==organizationId)return;
      if(error){setMessage('No se puede eliminar esta ficha: '+error.message);return;}
      setEditContact(null);await load();
      if(currentOrganization.current===organizationId)
        setMessage('Ficha sin relaciones eliminada con auditoría. No se modificó ningún contrato ni pago.');
    }catch{
      if(currentOrganization.current===organizationId)
        setMessage('No se confirmó la eliminación. Consulta los registros antes de reintentar.');
    }finally{
      contactMutationInFlight.current=false;
      setContactBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes y contactos</h1>
          <p className="mt-1 text-sm text-slate-600">{contactsOnly
            ? 'Selecciona un cliente registrado o crea una ficha una sola vez. Continuarás al contrato.'
            : 'Registra, consulta y corrige clientes y contactos sin crear contratos ni cobros desde aquí.'}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
          {can(PERMISSIONS.CLIENTS_CREATE) && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} disabled={contactBusy} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Plus className="h-4 w-4" /> Nuevo contacto
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createContact} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <Field name="first_name" label="Nombre" required />
          <Field name="last_name" label="Apellido" />
          <Field name="email" label="Correo" type="email" />
          <Field name="phone" label="Teléfono" />
          <Field name="whatsapp" label="WhatsApp" />
          <label>
            <span className="mb-1 block text-sm font-medium">Origen</span>
            <select name="source" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="MANUAL">Manual</option>
              <option value="WEBSITE">Sitio web</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="FACEBOOK">Facebook</option>
              <option value="PORTAL">Portal inmobiliario</option>
              <option value="REFERRAL">Referido</option>
              <option value="PHONE">Llamada</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Notas</span>
            <textarea name="notes" rows={3} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} disabled={contactBusy} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={contactBusy} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{contactBusy ? 'Guardando...' : 'Guardar contacto'}</button>
          </div>
        </form>
      )}

      {editContact&&adminMayCorrect&&<form key={editContact.id} onSubmit={event=>void correctContact(event)}
        aria-label="Corregir ficha de cliente"
        className="grid gap-4 rounded-2xl border border-sky-300 bg-sky-50 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Corregir cliente: {editContact.first_name} {editContact.last_name||''}</h2>
        <Field name="first_name" label="Nombre" required defaultValue={editContact.first_name}/>
        <Field name="last_name" label="Apellido" defaultValue={editContact.last_name||''}/>
        <Field name="email" label="Correo" type="email" defaultValue={editContact.email||''}/>
        <Field name="phone" label="Teléfono" defaultValue={editContact.phone||''}/>
        <Field name="whatsapp" label="WhatsApp" defaultValue={editContact.whatsapp||''}/>
        <label className="md:col-span-2 text-sm font-medium">Motivo de corrección
          <textarea name="reason" minLength={12} maxLength={500} required
            placeholder="Explica el dato equivocado (mínimo 12 caracteres)"
            className="mt-1 block w-full rounded-xl border p-3"/>
        </label>
        <div className="md:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={()=>setEditContact(null)}
            className="rounded-xl border px-4 py-2">Cancelar</button>
          <button type="submit" disabled={contactBusy}
            className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Guardar corrección</button>
        </div>
      </form>}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}


      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3">Teléfono</th>
              <th className="px-4 py-3">WhatsApp</th>
              <th className="px-4 py-3">Origen</th>
              {(adminMayCorrect || (contactsOnly && Boolean(onSelected)))&&<th className="px-4 py-3">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={(adminMayCorrect || (contactsOnly && Boolean(onSelected)))?6:5} className="px-4 py-10 text-center text-slate-500">
                  <ContactRound className="mx-auto mb-2 h-6 w-6" />
                  Aún no hay clientes o contactos registrados.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-stone-100">
                <td className="px-4 py-3 font-semibold">{[row.first_name, row.last_name].filter(Boolean).join(' ')}</td>
                <td className="px-4 py-3">{row.email || '—'}</td>
                <td className="px-4 py-3">{row.phone || '—'}</td>
                <td className="px-4 py-3">{row.whatsapp || '—'}</td>
                <td className="px-4 py-3">{row.source}</td>
                {(adminMayCorrect || (contactsOnly && Boolean(onSelected)))&&<td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {contactsOnly&&onSelected&&<button type="button" onClick={()=>onSelected(row.id)}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                      Elegir cliente para el contrato
                    </button>}
                    {adminMayCorrect&&!contactsOnly&&<>
                    <button type="button" disabled={contactBusy}
                      onClick={()=>{setEditContact(row);setMessage('');}}
                      className="rounded-lg border px-3 py-1.5 text-xs font-semibold">Editar cliente</button>
                    <button type="button" disabled={contactBusy}
                      onClick={()=>void deleteUnlinkedContact(row)}
                      className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-800">
                      Eliminar si no está vinculado
                    </button>
                    </>}
                  </div>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
