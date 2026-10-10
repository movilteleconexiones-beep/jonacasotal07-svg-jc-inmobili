# Auditoría funcional INMOJCO — evidencia inicial

Fecha: 2026-10-10. Rama: `fix/platform-subscription-rpc-guardrails`. Alcance: inspección estática de código y resultados CI disponibles; **no** es una prueba integral de interfaz ni de producción.

## Criterio de evaluación

Separar cuatro niveles: (1) interfaz presente, (2) lógica implementada, (3) persistencia y permisos de extremo a extremo, (4) pruebas de aceptación en entorno representativo. No se asigna porcentaje global certificado sin inventario de requisitos y ejecución de pruebas de aceptación.

| Área | Evidencia observada | Veredicto |
| --- | --- | --- |
| Arquitectura React/Vite | `package.json` contiene `dev`, `build`, `lint` y pruebas de regresión de autenticación | Implementada; falta prueba completa de despliegue |
| Panel multiempresa | `PrivateDashboard.tsx` contiene navegación de propiedades, contactos, leads, agenda, negocios, propietarios, documentos, comisiones, reportes, usuarios, configuración y licencia | Pantallas conectadas al panel; CRUD y flujos completos por verificar |
| Autenticación y permisos | `auth-context.tsx` carga membresías, roles y permisos de Supabase; propuestas y fixtures de RLS en PR #61 | Pruebas aisladas aprobadas; falta staging real |
| Catálogo de portada | `App.tsx` inicia estado desde `PROPERTIES` importado de `src/data/properties.ts` | Catálogo de demostración; no se ha verificado publicación sincronizada desde Supabase |
| Consignación en portada | `SubmitPropertyModal` llama `setProperties` para insertar en estado React | Persistencia no acreditada para esta ruta |
| Formulario público de contacto | `handleContactSubmit` valida campos y cambia `contactSubmitted` a verdadero | No hay envío persistente demostrado en este handler |
| Academia | `handleAcademyEnroll` almacena la inscripción en estado local y avisa que no se confirma cupo | Demostración, no matrícula transaccional |
| Wompi | Script de servidor y pruebas en CI; credenciales y pagos reales no habilitados | No apto para cobros productivos hasta validación integral |
| Datos públicos y RLS | Revisión previa identificó política SELECT permisiva de `public.properties` | Bloqueante de seguridad para publicar datos reales |

## Priorización de correcciones

**P0 — antes de operar con clientes:** corregir exposición de columnas de propiedades y definir proyección pública explícita; validar autorización multiempresa con Supabase staging; impedir confundir formularios de demostración con registros persistidos.

**P1 — antes de beta:** conectar catálogo público a proyección segura con publicación explícita; persistir formularios y citas con consentimiento, validación y protección contra abuso; probar CRUD y cambios de organización en todos los módulos; probar Wompi sandbox y webhooks firmados.

**P2 — antes de venta:** pruebas E2E, accesibilidad, responsive, observabilidad, recuperación, soporte, políticas legales, rendimiento y guía de operación.

## Google AI Studio y GitHub

Los cambios de esta rama están en GitHub y pueden revisarse allí. Google AI Studio no ha sido modificado ni sincronizado mediante esta auditoría; verificar en AI Studio que se abra/importa la rama correcta y se actualiza la vista del proyecto. No confundir un preview de AI Studio con una ejecución productiva ni con pruebas de Supabase.

## Puertas de salida

- CI verde sobre commit exacto.
- Revisión de código aprobada y PR aún sin fusionar.
- Evidencia por módulo de flujo real: crear, consultar, editar, eliminar, permisos, errores y aislamiento entre organizaciones.
- Staging separado y rollback probado.
- Autorización expresa para merge, despliegue y pagos reales.

**Conclusión:** el 65% comunicado anteriormente es una orientación subjetiva y no debe usarse para publicidad o decisiones comerciales. El avance verificable exige completar la matriz de aceptación por módulo.
