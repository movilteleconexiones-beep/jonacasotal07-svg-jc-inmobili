import { CreditCard } from 'lucide-react';

export function RentPaymentsModule() {
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-bold">Pagos de Arriendo</h2>
        <p className="mt-1 text-sm text-slate-600">Control de cánones, pagos recibidos, saldos pendientes y cartera.</p>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <CreditCard className="mx-auto mb-3 h-8 w-8" />
        <p className="font-semibold">Módulo preparado para conexión con rent_payments.</p>
      </div>
    </section>
  );
}
