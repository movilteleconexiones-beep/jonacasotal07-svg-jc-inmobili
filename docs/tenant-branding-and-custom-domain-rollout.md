# Personalización por inmobiliaria: logo, colores y sitio web

## Alcance de esta fase

- Cada inmobiliaria con una membresía autorizada mantiene su propia `organization_branding`, aislada por `organization_id` y las políticas RLS actuales.
- Los administradores autorizados con `settings.edit` pueden registrar una URL HTTPS para su logo, configurar su sitio web y elegir colores manualmente.
- El botón **Adaptar colores al logo** del Panel analiza la imagen HTTPS, calcula un color principal con contraste suficiente para letras blancas, genera un fondo suave y guarda **solo los colores de la inmobiliaria actual**. La marca, la navegación y los colores originales del sitio de INMOJCO y la ruta SuperAdmin no se modifican.
- En Configuración, se puede previsualizar la paleta y luego guardar. Si el alojamiento del logo bloquea CORS para leer los píxeles, el sistema indica el problema sin inventar colores; se pueden seleccionar los colores manualmente o alojar la imagen en una URL HTTPS que permita CORS.
- El sitio web de una inmobiliaria se guarda como enlace HTTPS y se muestra en el encabezado de su Panel. Eso **no** significa que ya se estén atendiendo peticiones HTTP desde ese dominio.

## Dominios propios — fase pendiente y controlada

No se asignarán dominios por solo introducir una URL en la ficha. Para enlazar `www.inmobiliaria.com` o `panel.inmobiliaria.com` directamente a un sitio INMOJCO hay que:

1. Validar que el solicitante puede editar la inmobiliaria y demostrar titularidad del dominio mediante DNS TXT/token único, desde un servicio de backend, no una afirmación enviada por navegador.
2. Verificar exclusividad del hostname (un dominio no puede apuntar a dos inmobiliarias), normalizar IDN/hostname y bloquear dominios reservados, puertos inesperados o hosts internos.
3. Configurar en infraestructura el dominio y el certificado TLS, con estado `pending`, `verified`, `active`, `failed`, sin modificar el dominio central `app.inmojco.com`.
4. Resolver la inmobiliaria por hostname **validado** en backend y obtener solamente datos públicos permitidos por sus políticas RLS. No usar una cabecera `Host` sin validación como permiso de lectura o autenticación; sesiones, cookies y redirecciones requieren revisión independiente.
5. Probar DNS, certificados, registros de prueba, redirecciones, enlaces absolutos y aislamiento entre inmobiliarias; conservar el acceso al SuperAdmin exclusivamente en la ruta central protegida.
6. No habilitar marca blanca ni reventa por registrar un dominio; todas las licencias continúan sin derecho de redistribución.

No se crea un bucket público ni se amplían las políticas de lectura existentes en esta fase. Para logos alojados, preferir imágenes públicas HTTPS confiables; permitir una futura carga de logos únicamente con un bucket dedicado, validación de formatos/tamaño y restricciones de permisos por organización.

## Compromisos de regresión

- El usuario autorizado conserva **Panel inmobiliario** y **SuperAdmin** con una sesión.
- Los colores se aplican únicamente al Panel privado de la inmobiliaria seleccionada cuando esta ha configurado su paleta.
- El cambio de inmobiliaria invalida cargas de branding anteriores, evitando mezclar logos o colores.
- Solo `settings.edit` puede persistir la configuración; la lectura respeta la membresía.
- El sitio central de INMOJCO, sus colores originales, su titularidad y las prohibiciones de reventa/sublicencia continúan intactos.
