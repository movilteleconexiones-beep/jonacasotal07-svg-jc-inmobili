import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Property } from '../data/properties';
import { safePublicPropertyPhoto } from './public-property-photo';
import { parsePublicAgencyServices, type PublicAgencyService } from './public-agency-content';
import { parsePublicPageContent, type PublicPageContent } from './public-page-content';

export interface PublicTenantBrand {
  companyName: string;
  publicHeadline?: string;
  publicDescription?: string;
  publicHeroUrl?: string;
  publicServices: PublicAgencyService[];
  publicPage: PublicPageContent;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  phone?: string;
  email?: string;
  website?: string;
  whatsapp?: string;
  publicOfficeAddress?: string;
  country: string;
  currency: string;
  locale: string;
}

interface CatalogState {
  requestedSlug?: string;
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
    setState({ ...EMPTY, requestedSlug: slug, loading: true });

    void (async () => {
      const { data, error } = await supabase.rpc('tenant_public_catalog', { tenant_slug: slug });
      if (!live) return;
      if (error) {
        setState({ ...EMPTY, requestedSlug: slug, error: 'No se pudo consultar el inventario de la inmobiliaria.' });
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        setState({ ...EMPTY, requestedSlug: slug, error: 'El catálogo no está disponible para esta inmobiliaria.' });
        return;
      }

      const value = data as Record<string, unknown>;
      const brand: PublicTenantBrand = {
        companyName: text(value.company_name),
        publicHeadline: text(value.public_headline) || undefined,
        publicDescription: text(value.public_description) || undefined,
        publicHeroUrl: text(value.public_hero_url) || undefined,
        publicServices: parsePublicAgencyServices(value.public_services),
        publicPage: parsePublicPageContent(value.public_page_content),
        logoUrl: text(value.logo_url) || undefined,
        primaryColor: text(value.primary_color) || undefined,
        secondaryColor: text(value.secondary_color) || undefined,
        phone: text(value.phone) || undefined,
        email: text(value.email) || undefined,
        website: text(value.website) || undefined,
        whatsapp: text(value.whatsapp) || undefined,
        publicOfficeAddress: text(value.public_office_address) || undefined,
        country: text(value.country) || 'CO',
        currency: text(value.currency) || 'COP',
        locale: text(value.locale) || 'es-CO',
      };

      setState({
        requestedSlug: slug,
        brand,
        properties: (Array.isArray(value.properties) ? value.properties : [])
          .filter((item): item is Row => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
          .map(asProperty),
        loading: false, error: null,
      });
    })().catch(() => {
      if (live) setState({ ...EMPTY, requestedSlug: slug, error: 'No se pudo cargar el catálogo.' });
    });

    return () => { live = false; };
  }, [tenantSlug]);

  // Avoid showing previous tenant branding for one render before effect resets it.
  const requestedSlug = tenantSlug?.trim().toLowerCase();
  return requestedSlug && state.requestedSlug !== requestedSlug
    ? { ...EMPTY, requestedSlug, loading: true }
    : state;
}
