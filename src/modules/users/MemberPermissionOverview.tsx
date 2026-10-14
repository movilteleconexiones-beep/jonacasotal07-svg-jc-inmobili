import {useEffect,useMemo,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {supabase} from '../../lib/supabase';

interface RoleAssignment {role_id:string;roles:{id:string;name:string;key:string|null}|null}
interface RoleWithGrants {
 id:string;name:string;active:boolean;
 role_permissions?:Array<{permissions:{key:string}|null}>;
}
interface Permission {key:string;description:string|null}
interface Override {effect:'ALLOW'|'DENY';permissions:{key:string}|null}

const MODULES:Record<string,string>={
 appointments:'Agenda',clients:'Clientes',commissions:'Comisiones',deals:'Negocios',
 documents:'Documentos',leads:'CRM',leases:'Contratos',maintenance:'Mantenimiento',
 owner_statements:'Liquidaciones',owners:'Propietarios',properties:'Propiedades',
 rent_payments:'Cobros y abonos',reports:'Reportes',roles:'Perfiles',settings:'Configuración',
 users:'Usuarios',
};

export function MemberPermissionOverview({memberId,status,assignments,allRoles,catalog}:{
 memberId:string;status:string;assignments:RoleAssignment[];
 allRoles:RoleWithGrants[];catalog:Permission[];
}) {
 const [overrides,setOverrides]=useState<Override[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{
   let mounted=true;setLoading(true);setError('');setOverrides([]);
   void (async()=>{
     try{
       const {data,count,error:queryError}=await supabase.from('member_permissions')
         .select('effect,permissions(key)',{count:'exact'})
         .eq('organization_member_id',memberId).limit(501);
       if(queryError||count===null||count===undefined||(data??[]).length!==count)
         throw new Error('No es posible verificar todas las excepciones individuales.');
       if(!mounted)return;
       const values=data as unknown as Override[];
       if(values.some(x=>!x.permissions?.key||!['ALLOW','DENY'].includes(x.effect)))
         throw new Error('La información de excepciones está incompleta.');
       setOverrides(values);
     }catch(cause){
       if(mounted)setError(cause instanceof Error?cause.message:'No se pudieron consultar los permisos.');
     }finally{if(mounted)setLoading(false);}
   })();
   return()=>{mounted=false};
 },[memberId]);

 const derived=useMemo(()=>{
   const byKey=new Map<string,string[]>();
   const missing:string[]=[];
   for(const assignment of assignments){
     const role=allRoles.find(r=>r.id===assignment.role_id);
     if(!role){missing.push(assignment.roles?.name??'Rol no identificado');continue;}
     if(!role.active)continue;
     for(const grant of role.role_permissions??[]){
       const key=grant.permissions?.key;
       if(!key)continue;
       byKey.set(key,[...new Set([...(byKey.get(key)??[]),role.name])]);
     }
   }
   const source=new Map<string,{effect:string;roles:string[]}>();
   for(const [key,roles] of byKey)source.set(key,{effect:'INHERITED',roles});
   for(const item of overrides){
     const key=item.permissions?.key;
     if(!key)continue;
     if(item.effect==='DENY')source.set(key,{effect:'DENY',roles:byKey.get(key)??[]});
     if(item.effect==='ALLOW')source.set(key,{effect:'ALLOW',roles:byKey.get(key)??[]});
   }
   const groups=new Map<string,Array<{key:string;label:string;source:string}>>();
   for(const permission of catalog){
     const grant=source.get(permission.key);
     if(!grant||grant.effect==='DENY')continue;
     const group=permission.key.split('.')[0]??'otros';
     const label=grant.effect==='ALLOW'?'Autorizado individualmente':
       'Heredado de '+grant.roles.join(', ');
     groups.set(group,[...(groups.get(group)??[]),{
       key:permission.key,label:permission.description||permission.key,source:label,
     }]);
   }
   return {
     groups:[...groups].sort(([a],[b])=>(MODULES[a]??a).localeCompare(MODULES[b]??b,'es')),
     denied:overrides.filter(x=>x.effect==='DENY').map(x=>x.permissions?.key??''),
     missing,
     total:[...groups.values()].reduce((n,rows)=>n+rows.length,0),
   };
 },[assignments,allRoles,catalog,overrides]);

 return <section className="mt-3 space-y-3 rounded-xl border border-stone-300 bg-slate-50 p-4"
   aria-label="Detalle de permisos del usuario">
   <div>
     <h3 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4"/>Permisos asignados a este usuario</h3>
     <p className="mt-1 text-xs text-slate-600">
       Resumen de roles acumulados y excepciones individuales. El plan contratado, el estado del usuario y los controles del servidor pueden restringirlos adicionalmente.
     </p>
   </div>
   {loading?<p role="status" className="text-sm">Verificando autorizaciones…</p>:
    error?<p role="alert" className="text-sm text-red-700">{error}</p>:
    <>
      {status!=='ACTIVE'&&<p className="rounded-lg border border-amber-300 p-3 text-sm text-amber-900">
        Este usuario está inactivo o suspendido: no tiene acceso operativo aunque sus roles se conserven.
      </p>}
      {derived.missing.length>0&&<p role="alert" className="text-xs text-amber-900">
        Hay roles no legibles en esta sesión; no se garantiza que la lista esté completa.
      </p>}
      <p className="text-sm font-semibold">
        {derived.total} autorizaciones derivadas · {derived.denied.length} denegaciones individuales
      </p>
      {derived.denied.length>0&&<div className="rounded-lg border border-stone-200 bg-white p-3 text-xs">
        <span className="font-semibold">Denegados individualmente:</span> {derived.denied.join(', ')}
      </div>}
      {derived.groups.length===0?<p className="text-sm text-slate-600">
        Sin permisos operativos asignados. El acceso privado de Cliente se configura en «Portal como cliente», no en esta lista.
      </p>:
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {derived.groups.map(([group,rows])=><div key={group} className="rounded-lg border bg-white p-3">
          <h4 className="mb-2 text-sm font-semibold">{MODULES[group]??group}</h4>
          <div className="space-y-2">
            {rows.map(row=><div key={row.key} className="border-t pt-2 text-xs">
              <div className="font-medium">{row.label}</div>
              <div className="break-all text-slate-500">{row.key}</div>
              <div className="text-slate-600">{row.source}</div>
            </div>)}
          </div>
        </div>)}
      </div>}
    </>}
 </section>;
}
