import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Property } from '../data/properties';
import { safePublicPropertyPhoto } from './public-property-photo';

export interface PublicTenantBrand {
  companyName: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  phone?: string;
  email?: string;
  website?: string;
  country: string;
  currency: string;
  locale: string;
}

interface CatalogState {
  properties: Property[];
  brand: PublicTenantBrand | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: CatalogState = {
  properties: [], brand: null, loading: false, error: null,
};

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function numeric(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function operation(value: unknown): Property['operation'] {
  return value === 'RENT' ? 'Renta' : value === 'ADMINISTRATION' ? 'Administración' : 'Venta';
}
function category(value: unknown): Property['category'] {
  const label = text(value).toUpperCase();
  if (label.includes('APART') || label.includes('DEPART')) return 'Departamento';
  if (label.includes('COMMERCIAL') || label.includes('LOT') || label.includes('LAND') || label.includes('LOCAL')) {
    return 'Comercial y Terreno';
  }
  return 'Residencial';
}

function asProperty(row: Row): Property {
  const op = operation(row.operation_type);
  const price = numeric(row.price);
  const city = text(row.city);
  const state = text(row.state);
  return {
    id: text(row.id),
    code: text(row.code),
    title: text(row.title),
    neighborhood: text(row.neighborhood),
    municipality: [city, state].filter(Boolean).join(', '),
    countryCode: text(row.country) || 'CO',
    region: state,
    city,
    operation: op,
    category: category(row.property_type),
    priceCOP: price,
    monthlyRentEstimationCOP: op === 'Renta' ? price : 0,
    maintenanceFeeCOP: numeric(row.administration_fee),
    landAreaM2: numeric(row.lot_area),
    constructionAreaM2: numeric(row.built_area),
    bedrooms: numeric(row.bedrooms),
    bathrooms: numeric(row.bathrooms),
    parkingSpaces: numeric(row.parking_spaces),
    annualAppreciationPct: 0,
    rentalYieldPct: 0,
    image: safePublicPropertyPhoto(row.image_url),
    secondaryImage: '',
    legalStatus: '',
    architecturalSummary: text(row.description),
    highlights: [],
    domoticsAndMaintenance: [],
    coordinatesLabel: [city, state].filter(Boolean).join(', '),
    yearBuilt: 0,
    currency: text(row.currency) || 'COP',
  };
}

/**
 * Public data is supplied only by the server-side allowlisted RPC. Never
 * query private tenant inventory or read private photo buckets as anonymous.
 */
export function usePublicTenantCatalog(tenantSlug?: string | null): CatalogState {
  const [state, setState] = useState<CatalogState>(EMPTY);

  useEffect(() => {
    const slug = tenantSlug?.trim().toLowerCase();
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setState(EMPTY);
      return;
    }
    let live = true;
    setState({ ...EMPTY, loading: true });

    void (async () => {
      const { data, error } = await supabase.rpc('tenant_public_catalog', { tenant_slug: slug });
      if (!live) return;
      if (error) {
        setState({ ...EMPTY, error: 'No se pudo consultar el inventario de la inmobiliaria.' });
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        setState({ ...EMPTY, error: 'El catálogo no está disponible para esta inmobiliaria.' });
        return;
      }

      const value = data as Record<string, unknown>;
      const brand: PublicTenantBrand = {
        companyName: text(value.company_name),
        logoUrl: text(value.logo_url) || undefined,
        primaryColor: text(value.primary_color) || undefined,
        secondaryColor: text(value.secondary_color) || undefined,
        phone: text(value.phone) || undefined,
        email: text(value.email) || undefined,
        website: text(value.website) || undefined,
        country: text(value.country) || 'CO',
        currency: text(value.currency) || 'COP',
        locale: text(value.locale) || 'es-CO',
      };

      setState({
        brand,
        properties: (Array.isArray(value.properties) ? value.properties : [])
          .filter((item): item is Row => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
          .map(asProperty),
        loading: false, error: null,
      });
    })().catch(() => {
      if (live) setState({ ...EMPTY, error: 'No se pudo cargar el catálogo.' });
    });

    return () => { live = false; };
  }, [tenantSlug]);

  return state;
}
