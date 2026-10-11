import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';

interface Props { onCreated: () => void }

export function CreateOrganizationAdmin({ onCreated }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [country, setCountry] = useState('CO');
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    const { error } = await supabase.rpc('platform_create_organization', {
      p_name: name.trim(),
      p_slug: slug.trim().toLowerCase(),
      p_country: country,
      p_owner: ownerId.trim(),
    });
    setBusy(false);
    if (error) {
      setMessage('No fue posible registrar la inmobiliaria. Comprueba los datos, que el propietario esté verificado y tus permisos SuperAdmin.');
      return;
    }
    setName('');
    setSlug('');
    setOwnerId('');
    setMessage('Inmobiliaria creada con activación comercial pendiente.');
    onCreated();
  }
  return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="crear-inmobiliaria">
    <h2 id="crear-inmobiliaria" className="font-bold">Registrar inmobiliaria</h2>
    <p className="mt-1 text-sm text-slate-600">Solo SuperAdmin. El propietario debe tener una cuenta confirmada. No se activan suscripciones ni pagos al registrar.</p>
    <form onSubmit={e=>void submit(e)} className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-sm font-medium">Nombre de inmobiliaria
        <input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="text-sm font-medium">Identificador único
        <input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())} placeholder="inmobiliaria-ejemplo" className="mt-1 w-full rounded-lg border p-3" />
      </label>
      <label className="text-sm font-medium">País
        <select value={country} onChange={e=>setCountry(e.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="CO">Colombia</option></select>
      </label>
      <label className="text-sm font-medium">ID del propietario verificado (UUID)
        <input required value={ownerId} onChange={e=>setOwnerId(e.target.value)} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" className="mt-1 w-full rounded-lg border p-3" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
      </label>
      <div className="md:col-span-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Registrando…' : 'Crear inmobiliaria pendiente'}</button>
      </div>
    </form>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
