# Departamentos y ciudades del catálogo

El buscador público permite elegir primero un departamento y luego una ciudad o municipio. Cambiar el departamento limpia la ciudad anterior. Las opciones incluyen toda Colombia, aunque una ubicación todavía no tenga inmuebles; en ese caso se muestra el estado sin resultados. La búsqueda de texto también reconoce ciudad, departamento y nombres sin tildes. Las operaciones, categorías, ordenación y restablecimiento siguen combinándose con la ubicación.

## Fuente y mantenimiento

La tabla `src/data/colombia-divipola.ts` adapta el conjunto [DIVIPOLA – Códigos municipios](https://www.datos.gov.co/Mapas-Nacionales/DIVIPOLA-C-digos-municipios/gdxc-w37w), publicado por el Departamento Administrativo Nacional de Estadística (DANE). La descarga verificada contiene 32 departamentos y Bogotá, D.C.; 1.122 ubicaciones: 1.103 registros de tipo Municipio, uno de tipo Isla y 18 áreas no municipalizadas. Conserva los códigos oficiales y las tildes, ajusta las mayúsculas de presentación y ordena las listas. La fecha de actualización de los datos publicada por la fuente es 2025-01-24, con corte declarado 2024-12-30.

La tabla adaptada se distribuye bajo [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/). El buscador muestra atribución y enlaces a la fuente y licencia. El código de la aplicación conserva su licencia.

Para actualizar la tabla desde la fuente oficial:

```sh
node scripts/update-colombia-divipola.mjs
node --import tsx --test tests/catalog-location.test.mjs
npm run lint
npm run build
```

El generador valida la entidad publicadora, licencia, códigos únicos, cobertura de las 33 entidades de primer nivel, Bogotá y Nuevo Belén de Bajirá antes de escribir. La aplicación incluye la tabla en su publicación: Colombia no depende de una descarga externa al abrir el buscador o el formulario de consignación. Las integraciones de otros países conservan su fuente existente.

## Compatibilidad de los inmuebles

El filtro utiliza `region`, `city` y `countryCode` cuando están informados. Los registros antiguos admiten `municipality` con el formato `Ciudad, Departamento`, incluido `Bogotá, D.C.`. La comparación de ciudad es exacta después de normalizar tildes, mayúsculas y puntuación; el departamento evita confundir municipios homónimos. Esta corrección no modifica direcciones, inventario, permisos ni registros de las inmobiliarias.
