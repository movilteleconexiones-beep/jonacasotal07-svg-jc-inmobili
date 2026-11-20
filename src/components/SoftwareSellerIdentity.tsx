/**
 * G24 - Public identification of the SaaS license seller as verified against
 * the owner's updated RUT (20 November 2026). This is the software vendor,
 * not the controller or owner of an unrelated real-estate tenant.
 *
 * Never render this component as the identity of a customer agency.
 */
export function SoftwareSellerIdentity() {
  return (
    <section aria-label="Identificación y contacto del proveedor de licencias" className="mt-3 max-w-sm space-y-1 text-xs leading-relaxed text-stone-700">
      <p className="font-semibold text-slate-900">Proveedor de licencias: Jonathan Castaño Otalvaro, persona natural</p>
      <p>NIT: 1017182843-5</p>
      <address className="not-italic">
        Dirección para notificaciones comerciales: VTE GUARNE - AEROPUERTO KM 3 800 VDA CANOAS, Guarne, Antioquia, Colombia.
      </address>
      <p>Teléfono: <a className="underline underline-offset-2 hover:text-slate-900" href="tel:+573235228591">+57 323 522 8591</a></p>
      <p>Atención y PQR: <a className="underline underline-offset-2 hover:text-slate-900" href="mailto:contacto@inmojco.com">contacto@inmojco.com</a></p>
      <p>Soporte: <a className="underline underline-offset-2 hover:text-slate-900" href="mailto:soporte@inmojco.com">soporte@inmojco.com</a></p>
      <p>Datos personales: <a className="underline underline-offset-2 hover:text-slate-900" href="mailto:privacidad@inmojco.com">privacidad@inmojco.com</a></p>
      <p>Facturación: <a className="underline underline-offset-2 hover:text-slate-900" href="mailto:facturacion@inmojco.com">facturacion@inmojco.com</a></p>
    </section>
  );
}
