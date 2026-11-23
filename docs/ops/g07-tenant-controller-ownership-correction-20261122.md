# G07 — Agencia y vendedor SaaS: titularidad jurídica verificada

## Fuente

Corrección expresa del propietario de la plataforma del **22 de noviembre de 2026**, y verificación read-only en Supabase de cuentas y privilegios. No representa modificación de registros societarios ni comprobación ante autoridad gubernamental.

| Organización técnica actual | Cuenta | Naturaleza declarada | Estado jurídico de la política propia |
|---|---|---|---|
| `jco-inmodigital-global` | `jonacasotal` | Inmobiliaria personal del único SuperAdmin; la persona titular declara ser su representante legal y el vendedor/distribuidor del SaaS | Requiere política propia que incorpore su identificación legal, aprobación exacta, firma/adopción y URL PDF verificada |
| `sistema-inmobiliario-jco` | cuenta separada `movilteleconexiones` | Inmobiliaria de **futuro propietario y representante legal diferentes**, con **nuevo nombre pendiente** | La política v1.2 históricamente publicada con ese slug NO prueba aprobación del futuro responsable. Requiere nuevo nombre, identificación del responsable, documento y aprobación de él |

El vendedor de licencias de software y su actividad SaaS pertenecen al propietario de la plataforma, **no** a la inmobiliaria externa. El control de vendedor G24 es independiente de G07.

## Efecto jurídico-operativo

El manifiesto `security/legal/approved-policy-publication.json` demuestra qué PDF y hash fueron aprobados/publicados en la fecha histórica. **No atribuir ese documento, su acta ni el contenido jurídico del operador al representante legal nuevo de otra inmobiliaria.** No borrar el manifiesto histórico ni reescribir huellas como si nada hubiera ocurrido.

El antiguo candidato `security/candidates/g07_register_approved_jco_v1_2_REVIEW_ONLY.sql` se conserva solo como evidencia histórica, con un `RAISE EXCEPTION` incondicional **antes** de cualquier registro en la base de datos. No ejecutar ni extraer su `INSERT` manualmente. Sustituirlo por un flujo nuevo que exija aprobación genuina por organización y evidencias de identidad, fecha, versión y SHA-256, con comprobación de titularidad.

## Puertas NO-GO

- Captación pública y recibos de consentimiento G07 permanecen cerrados hasta que el verdadero responsable de cada inmobiliaria apruebe su propia política y se pruebe su asignación al tenant correcto.
- No dar roles de SuperAdmin a la cuenta de la inmobiliaria externa; no cambiar ni otorgar licencias vitalicias por la corrección documental.
- Wompi LIVE se rige por G12: validación del comercio del vendedor, webhook auténtico, pago real controlado, conciliación y activación íntegra. No confundir políticas de las inmobiliarias con términos SaaS del vendedor.
