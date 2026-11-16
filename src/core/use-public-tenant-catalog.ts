import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Property } from '../data/properties';
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
  loadingMore: boolean;
  complete: boolean;
  error: string | null;
}

const EMPTY: CatalogState = {
  properties: [], brand: null, loading: false, loadingMore: false, complete: true, error: null,
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
    image: '',
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
/**
 * Loads all published properties in bounded, stable server-side cursor pages.
 * Each page is tenant-scoped by a security-definer RPC, not by public table reads.
 * Partial inventories are explicitly marked incomplete until every page arrives.
 */
export function usePublicTenantCatalog(tenantSlug?: string | null): CatalogState {
  const [state,setState]=useState<CatalogState>(EMPTY);

  useEffect(()=>{
    const slug=tenantSlug?.trim().toLowerCase();
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setState(EMPTY);
      return;
    }
    let live=true;
    setState({...EMPTY,requestedSlug:slug,loading:true,complete:false});

    void (async()=>{
      const {data,error}=await supabase.rpc('tenant_public_catalog',{tenant_slug:slug});
      if(!live)return;
      if(error || !data || typeof data!=='object' || Array.isArray(data)){
        setState({...EMPTY,requestedSlug:slug,error:'No se pudo consultar el sitio de esta inmobiliaria.'});
        return;
      }
      const value=data as Record<string,unknown>;
      const brand:PublicTenantBrand={
        companyName:text(value.company_name),
        publicHeadline:text(value.public_headline)||undefined,
        publicDescription:text(value.public_description)||undefined,
        publicHeroUrl:text(value.public_hero_url)||undefined,
        publicServices:parsePublicAgencyServices(value.public_services),
        publicPage:parsePublicPageContent(value.public_page_content),
        logoUrl:text(value.logo_url)||undefined,
        primaryColor:text(value.primary_color)||undefined,
        secondaryColor:text(value.secondary_color)||undefined,
        phone:text(value.phone)||undefined,
        email:text(value.email)||undefined,
        website:text(value.website)||undefined,
        whatsapp:text(value.whatsapp)||undefined,
        publicOfficeAddress:text(value.public_office_address)||undefined,
        country:text(value.country)||'CO',
        currency:text(value.currency)||'COP',
        locale:text(value.locale)||'es-CO',
      };
      setState({...EMPTY,requestedSlug:slug,brand,loading:true,complete:false});

      const ids=new Set<string>();
      const properties:Property[]=[];
      let cursor:{after_featured:boolean;after_created_at:string;after_id:string}|null=null;

      // Maximum commercial plan capacity is 2,000 published properties: 40 pages.
      for(let page=0;page<40;page++){
        const args={
          tenant_slug:slug,
          page_size:50,
          ...(cursor??{}),
        };
        const {data:pageData,error:pageError}=await supabase.rpc('tenant_public_catalog_page',args);
        if(!live)return;
        if(pageError || !pageData || typeof pageData!=='object' || Array.isArray(pageData)){
          throw new Error('No se pudo verificar la siguiente página del catálogo.');
        }
        const batch=pageData as Record<string,unknown>;
        if(!Array.isArray(batch.properties) || typeof batch.has_more!=='boolean' ||
           batch.properties.length>50 || (batch.has_more && batch.properties.length!==50)){
          throw new Error('Respuesta de catálogo paginado incompleta.');
        }
        const parsed=batch.properties.filter(
          (item):item is Row=>Boolean(item && typeof item==='object' && !Array.isArray(item))
        );
        if(parsed.length!==batch.properties.length)throw new Error('Fila de catálogo inválida.');
        for(const item of parsed){
          const property=asProperty(item);
          if(!property.id || ids.has(property.id))throw new Error('Propiedad duplicada o inválida.');
          ids.add(property.id);
          properties.push(property);
        }
        const hasMore=batch.has_more;
        const next=batch.next_cursor;
        if(hasMore){
          if(!next || typeof next!=='object' || Array.isArray(next))throw new Error('Cursor de catálogo ausente.');
          const v=next as Record<string,unknown>;
          if(typeof v.after_featured!=='boolean' ||
             typeof v.after_created_at!=='string' || !Number.isFinite(Date.parse(v.after_created_at)) ||
             typeof v.after_id!=='string' ||
             !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.after_id)){
            throw new Error('Cursor de catálogo inválido.');
          }
          cursor={after_featured:v.after_featured,after_created_at:v.after_created_at,after_id:v.after_id};
        }
        setState({
          requestedSlug:slug,brand,properties:[...properties],
          loading:false,loadingMore:hasMore,complete:!hasMore,error:null,
        });
        if(!hasMore)return;
      }
      // A 41st page means plan capacity or catalog integrity is inconsistent.
      throw new Error('El inventario excede el máximo certificado de publicaciones.');
    })().catch(()=>{
      if(live)setState(previous=>previous.requestedSlug===slug
        ? {...previous,loading:false,loadingMore:false,complete:false,
           error:'El inventario no pudo verificarse por completo. Los filtros muestran resultados parciales.'}
        : {...EMPTY,requestedSlug:slug,complete:false,
           error:'No se pudo cargar el catálogo.'});
    });

    return()=>{live=false;};
  },[tenantSlug]);

  // Never flash another tenant's brand, photos or inventory during a route change.
  const requestedSlug=tenantSlug?.trim().toLowerCase();
  return requestedSlug && state.requestedSlug!==requestedSlug
    ? {...EMPTY,requestedSlug,loading:true,complete:false}
    : state;
}
