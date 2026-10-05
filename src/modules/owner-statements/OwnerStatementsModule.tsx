import { Receipt } from 'lucide-react';

export function OwnerStatementsModule() {
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-bold">Estados de Cuenta del Propietario</h2>
        <p className="mt-1 text-sm text-slate-600">Liquidaciones, descuentos autorizados y pagos al propietario.</p>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <Receipt className="mx-auto mb-3 h-8 w-8" />
        <p className="font-semibold">Módulo preparado para owner_statements.</p>
      </div>
    </section>
  );
}
