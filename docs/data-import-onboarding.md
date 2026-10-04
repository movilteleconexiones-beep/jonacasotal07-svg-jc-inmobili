# Importación de datos para inmobiliarias

El sistema soporta dos escenarios de onboarding:

1. **Inmobiliaria nueva**: puede empezar sin clientes ni propiedades previas y registrar información directamente en el software.
2. **Inmobiliaria existente**: puede importar posteriormente clientes/contactos y propiedades desde CSV, XLSX o XLS.

La importación no depende del modelo comercial. Debe estar disponible tanto en:
- instalación dedicada / pago único;
- SaaS con administración y pago mensual.

## Flujo seguro

1. Seleccionar tipo de datos.
2. Subir archivo.
3. Detectar columnas.
4. Mapear columnas del archivo a campos del software.
5. Validar filas.
6. Mostrar errores antes de importar.
7. Confirmar importación.
8. Registrar el trabajo en import_jobs.
9. Mantener trazabilidad mediante import_job_id y auditoría.

Cada trabajo de importación pertenece a una sola organization_id, por lo que no puede mezclar información entre inmobiliarias.

## Límites iniciales

La vista previa procesa hasta 5.000 filas por archivo. Para migraciones grandes se deberá ejecutar importación por lotes en backend/Edge Function para evitar depender del navegador.
