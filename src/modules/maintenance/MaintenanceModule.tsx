import { Wrench } from 'lucide-react';

export function MaintenanceModule() {
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-bold">Mantenimiento</h2>
        <p className="mt-1 text-sm text-slate-600">Solicitudes, proveedores, costos y seguimiento.</p>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <Wrench className="mx-auto mb-3 h-8 w-8" />
        <p className="font-semibold">Módulo preparado para maintenance_requests.</p>
      </div>
    </section>
  );
}
