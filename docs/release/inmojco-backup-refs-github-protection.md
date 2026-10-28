# Administrar las ramas de respaldo de INMOJCO

**Estado actual:** el repositorio todavía no tiene reglas de protección
verificadas. El archivo `security/recovery/backup-refs-ruleset.json` es una
**configuración preparada, NO aplicada**. No ofrece ninguna protección
hasta que un usuario con permisos GitHub **Administration: write** la
active y se verifique efectivamente.

## Aplicación por una única persona administradora

En una terminal de equipo autorizado, desde la raíz del repositorio,
autenticarse en GitHub CLI con `gh auth login` usando su cuenta de
administración. **Nunca pegar tokens en ChatGPT ni subirlos al repositorio.**

```powershell
gh api --method POST repos/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/rulesets --input security/recovery/backup-refs-ruleset.json
gh api repos/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/rulesets
gh api "repos/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/rules/branches/backup/inmojco-2026-10-27-verificado"
```

La configuración se dirige únicamente a las referencias
`refs/heads/backup/**`, que deben **poder crearse** para nuevas copias
sin quedar actualizables o borrables después. Aplica tres reglas:
`deletion`, `non_fast_forward`, `update` sin permiso de actualización.

**Verificación obligatoria:** confirmar `enforcement: active` y que
las ramas `backup/**` estén cubiertas por las reglas. Probar el
bloqueo de actualización/borrado con una rama `backup/test-proteccion-*`
creada con anterioridad; no probar sobre los respaldos auténticos.
Verificar que un nuevo respaldo bajo `backup/**` todavía puede
crearse. Los resultados deben quedar registrados sin compartir
credenciales ni archivos privados.

Para aplicarlo mediante interfaz administrativa:
`Settings → Rules → Rulesets → New branch ruleset`, nombre
`INMOJCO — Immutable code backups`, alcance `backup/**`,
**Restrict updates**, **Restrict deletions** y **Block force pushes**,
con aplicación **Active**.

No crear un segundo ruleset idéntico si existe uno aplicado: revisar
`GET /rulesets` antes de usar POST, y cambiar el existente solo
mediante una revisión administrativa aprobada.

## Límites de esta medida

GitHub almacena **código**, no copias de PostgreSQL ni bytes de los
documentos de Supabase Storage. Las ramas GitHub protegidas no
constituyen un backup completo y restaurable del SaaS. Un administrador
con poder de modificar reglas puede cambiar o desactivar esta política;
registrar esa atribución de permisos y revisar el cumplimiento
periódicamente.

El conector GitHub de este chat permite leer reglas y gestionar archivos,
pero **no crear reglas de administración del repositorio**. Este paso
requiere la acción de una persona con dichos permisos. No hay ningún
cambio en Railway ni Supabase al preparar este archivo.
