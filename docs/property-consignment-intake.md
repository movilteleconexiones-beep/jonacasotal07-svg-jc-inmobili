# Consignaciones del portal

El formulario guarda una solicitud en `property_consignments` y devuelve una referencia de recepción. No agrega fichas al catálogo del navegador ni publica inmuebles automáticamente. El nombre y teléfono se utilizan para atender la solicitud; la interfaz pide autorización de contacto.

`VITE_PUBLIC_SITE_SLUG` identifica un destino registrado por operación en `private.property_intake_sites`. La inmobiliaria se resuelve en el servidor, independientemente de la membresía activa de quien visita el portal. El sitio debe estar habilitado, la organización activa y el portal no deshabilitado. El país y moneda proceden de la configuración de la inmobiliaria, con CO/COP como valores predeterminados.

La recepción valida el contrato completo en PostgreSQL. Los visitantes únicamente pueden ejecutar una operación acotada de recepción y consultar nombre, país y moneda del sitio. No tienen lectura ni escritura directa en la bandeja. Las solicitudes conservan un UUID de reintento para impedir duplicados, con límites serializados por inmobiliaria: tres solicitudes por teléfono en 24 horas y cuotas globales configurables (60/hora y 500/día inicialmente). Estos límites reducen abuso; no verifican identidad ni sustituyen un CAPTCHA frente a ataques distribuidos. Si se detecta abuso sostenido, deshabilitar el sitio y añadir verificación humana en un endpoint de servidor antes de reabrirlo.

La bandeja privada requiere `properties.view` y `clients.view`. La revisión requiere además `properties.edit`. Aceptar exige también `properties.create`, `clients.create` y `leads.edit`. La aceptación crea, dentro de una transacción, un inmueble DRAFT, un contacto WEBSITE y un lead NEW. La titularidad y documentación siguen pendientes de verificación. La solicitud conserva el año de construcción, el actor, la fecha y las notas de revisión. Rechazar conserva el historial sin crear inventario ni CRM.

Se retira la política `Permitir lectura publica de propiedades`, que exponía todos los borradores de todas las inmobiliarias. El catálogo actual se alimenta de datos de ejemplo; no depende de esa política. La publicación de inventario real requiere una proyección pública explícita de inmuebles aprobados en un trabajo posterior.

## Publicación y validación

1. Ejecutar TypeScript, pruebas de contrato y SQL en PostgreSQL aislado, incluidas concurrencia, aislamiento, cuotas, rechazo de parámetros de revisión, reintentos y reversión de fallos parciales.
2. Aplicar exclusivamente `20261010212630_property_consignment_intake.sql`; no ejecutar en bloque las migraciones de pagos pendientes.
3. Registrar el sitio activo de la inmobiliaria comprobada y configurar `VITE_PUBLIC_SITE_SLUG` en Railway.
4. Fusionar solo el commit cuyo CI terminó correctamente, comprobar el SHA desplegado y verificar el formulario público.
5. La recepción y revisión deben funcionar por API. Las pruebas contra producción deben usar datos sintéticos y una transacción que termine en ROLLBACK, o limpieza restringida a los identificadores creados para la prueba.

Para detener recepción, actualizar únicamente `private.property_intake_sites.enabled=false` para el slug afectado. La tabla y las solicitudes se conservan. Revertir el frontend con el despliegue anterior no requiere eliminar datos. No restaurar la política de lectura indiscriminada.

La cuenta principal identificada en la guía de recuperación tiene membresía activa y carecía de roles operativos. Para este flujo se puede asignar un rol local `CONSIGNMENT_REVIEWER`, limitado a las nueve claves de propiedades, clientes y leads usadas por la interfaz. El panel privado y la administración central se cargan bajo demanda para reducir la descarga inicial del portal. Las dependencias se instalan desde el lockfile y Supabase JS queda fijado a la versión validada.

No asignar roles globales, permisos de usuarios/licencias ni delegación de roles como parte de esta corrección. Verificar identidad, membresía y organización exactas antes de la asignación.
