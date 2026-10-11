import React, { useEffect, useState } from 'react';
import { administrativeLabels, loadAdministrativeCatalog, type AdministrativeCatalog } from '../core/location-catalog';
import type { CatalogLocationSelection } from '../core/catalog-location';

interface CatalogLocationFilterProps {
  countryCode: string;
  value: CatalogLocationSelection;
  onChange: (selection: CatalogLocationSelection) => void;
}

export function CatalogLocationFilter({ countryCode, value, onChange }: CatalogLocationFilterProps) {
  const [catalog, setCatalog] = useState<AdministrativeCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const labels = administrativeLabels(countryCode);
  const isColombia = countryCode === 'CO';
  const selectedRegion = catalog?.regions.find(region => region.name === value.region);
  const selectClass = 'w-full min-w-0 px-3 py-2.5 bg-[#F6F6F4] border border-stone-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-[#0F2942] disabled:text-stone-500 disabled:cursor-not-allowed';

  useEffect(() => {
    let active = true;
    setCatalog(null);
    setLoading(true);
    void loadAdministrativeCatalog(countryCode).then(result => {
      if (!active) return;
      setCatalog(result);
      setLoading(false);
    });
    return () => { active = false; };
  }, [countryCode]);

  return (
    <div className="md:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <select
        aria-label={labels.region}
        value={value.region}
        onChange={event => onChange({ region: event.target.value, locality: '' })}
        disabled={loading || !catalog}
        className={selectClass}
      >
        <option value="">{loading ? 'Cargando ubicaciones…' : isColombia ? 'Todos los departamentos' : 'Todas las regiones'}</option>
        {catalog?.regions.map(region => <option key={region.id} value={region.name}>{region.name}</option>)}
      </select>
      <select
        aria-label="Ciudad o municipio"
        title={selectedRegion ? 'Filtrar por ciudad o municipio' : `Primero selecciona ${labels.region.toLocaleLowerCase('es')}`}
        value={value.locality}
        onChange={event => onChange({ ...value, locality: event.target.value })}
        disabled={!selectedRegion}
        className={selectClass}
      >
        <option value="">{isColombia ? 'Todas las ciudades / municipios' : 'Todas las localidades'}</option>
        {selectedRegion?.localities.map(locality => (
          <option key={locality.id} value={locality.name}>
            {locality.name}{locality.kind === 'Área no municipalizada' ? ' (área no municipalizada)' : ''}
          </option>
        ))}
      </select>
      {!loading && !catalog && <p role="status" className="sm:col-span-2 text-xs text-stone-600">No se pudo cargar la lista de ubicaciones. Puedes buscar por ciudad en el campo de búsqueda.</p>}
    </div>
  );
}
