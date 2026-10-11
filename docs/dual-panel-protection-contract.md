# Contrato protegido: panel inmobiliario y SuperAdmin

**Requisito innegociable de regresión**: la cuenta que ya reúne los permisos autorizados de SuperAdmin y la membresía activa de una inmobiliaria puede alternar, sin cerrar sesión, entre los dos paneles.

- **Panel** abre el panel operativo de la inmobiliaria activa (Propiedades, Clientes, CRM, Agenda, Negocios, Comisiones, Usuarios y Configuración según los permisos efectivos).
- **Administración central / SuperAdmin** abre exclusivamente la vista global de la plataforma.
- Si la misma sesión tiene ambos accesos, dentro del panel inmobiliario aparece el acceso visible con escudo **SuperAdmin**.
- No se crea una membresía por ser SuperAdmin. El acceso a una inmobiliaria requiere una membresía **ACTIVE**, roles y permisos válidos. No se permite acceso entre empresas por defecto.
- Las modificaciones de autenticación, perfiles, menú, licencias, RLS, navegación, variables de Railway y despliegue deben ejecutar los tests de regresión y comprobar ambos recorridos antes de producción.
- Una actualización no debe desactivar membresías, modificar la inmobiliaria activa o quitar los enlaces de navegación sin autorización explícita y revisión de impacto.
- No guardar correo, tokens, claves ni identificadores personales en fixtures públicos.

## Criterios de aceptación

1. Una cuenta con ambas autorizaciones abre ambos paneles con una sola sesión.
2. El menú operativo se carga desde su organización activa y conserva sus controles.
3. SuperAdmin mantiene acceso a la administración central.
4. Un SuperAdmin sin membresía no obtiene acceso al CRM privado de otra inmobiliaria.
5. El selector de inmobiliaria no atraviesa los límites de autorización.
6. Validar flujos manualmente en cuenta de ensayo antes de todo cambio relacionado con identidad.
