# Portales públicos con marca y dominio propio por inmobiliaria

**Estado:** especificación para implementación; no se ha desplegado ni modificado la base de datos.

## Lo existente
- `organization_branding` ya contiene nombre comercial, nombre de software, logo, favicon, colores, sitio web, teléfono, WhatsApp y correo.
- `useTenantBranding()` obtiene la marca por `activeMembership`; esto sirve para el panel autenticado pero **no** identifica al visitante anónimo que entra por un dominio propio.
- En el esquema oficial consultado no aparece todavía una tabla dedicada a dominios de inmobiliarias.

## Experiencia propuesta
1. El propietario autorizado edita branding y obtiene vista previa.
2. En «Mi dominio» ingresa `www.ejemplo.com` comprado con su proveedor; se muestra el registro DNS requerido según el hosting efectivo.
3. El sistema verifica control del dominio mediante desafío DNS, comprueba configuración de red y emisión de HTTPS; solo entonces activa la asociación.
4. El visitante abre `www.ejemplo.com` y llega directamente al portal público de esa inmobiliaria. Los inmuebles, datos de contacto, formularios y solicitudes quedan asociados a su `organization_id`.
5. El panel privado mantiene autenticación y permisos separados del portal público.

## Requisitos de implementación
- Tabla `organization_domains` con `organization_id`, `hostname` único normalizado, `verification_token_hash`, `verification_status`, `verified_at`, `is_primary`, `created_at`, `updated_at`; revisar también `provisioning_status` y `last_error`. No guardar secretos DNS en frontend.
- Resolver tenant por cabecera `Host` en infraestructura de confianza (edge/proxy) con mapeo de dominios **verificados y activos**, no por `activeMembership` ni por un parámetro manipulable por el cliente.
- Enrutamiento `/portal` o raíz del dominio y lectura pública de propiedades publicadas, con RLS y consultas limitadas por `organization_id`; nunca exponer datos privados ni confiar en filtros solo del navegador.
- Endpoint público de resolución que devuelva únicamente branding y configuración publicables; prevenir enumeración de datos privados.
- DNS y certificados TLS gestionados según el proveedor de despliegue (por decidir); el simple registro en Supabase no configura automáticamente el dominio.
- Formularios de contacto y citas con protección antispam, límites de frecuencia y tenant validado del lado servidor.
- Soportar dominio predeterminado JCO por inmobiliaria mientras se valida el dominio personalizado, y una política explícita de cambios, revocación y duplicados.
- Pruebas de aislamiento entre dos inmobiliarias y de dominio no verificado, suspendido, eliminado y transferido.
- Branding permitido para responsables de la inmobiliaria, pero sin cambiar el propietario de la plataforma, la licencia ni los permisos comerciales.

## Modalidad comercial
El dominio puede ser comprado y renovado directamente por la inmobiliaria. La licencia perpetua otorga uso indefinido del software según contrato, pero no implica que JCO pague eternamente dominio, hosting u otros servicios externos.

## Antes de activar
Revisar hosting real, seguridad de RLS y permisos de edición; preparar migración y pruebas aisladas; pedir autorización antes de aplicar DDL o desplegar en producción.
