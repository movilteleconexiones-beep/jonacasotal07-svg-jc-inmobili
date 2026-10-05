import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';

export function LeasesModule() {
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <h2 className="text-xl font-bold">Administración de Arriendos</h2>
          <p className="text-sm text-slate-600">Contratos, cánones, renovaciones y seguimiento de inmuebles administrados.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-white">
          <Plus className="h-4 w-4" /> Nuevo contrato
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {['Contratos activos','Próximos vencimientos','Reajustes pendientes'].map((item) => (
          <div key={item} className="rounded-2xl border border-stone-200 bg-white p-5">
            <FileText className="mb-3 h-5 w-5" />
            <div className="font-semibold">{item}</div>
            <div className="mt-2 text-2xl font-bold">0</div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="font-bold">Crear contrato de arrendamiento</h3>
          <p className="mt-2 text-sm text-slate-600">Formulario inicial conectado al modelo leases de Supabase.</p>
        </div>
      )}
    </section>
  );
}
