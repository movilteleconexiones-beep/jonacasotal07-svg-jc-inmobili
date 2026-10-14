import {useEffect,useMemo,useState} from 'react';
import {ShieldCheck,Save,X} from 'lucide-react';
import {PERMISSIONS} from '../../core/permissions';
import {useAuth} from '../../core/auth-context';
import {supabase} from '../../lib/supabase';

export interface EditablePermission {id:string;key:string;description:string|null}
export interface EditableRole {
 id:string;name:string;key:string|null;active:boolean;
 role_permissions?:Array<{permissions:{key:string}|null}>;
}
const ADMIN_FIXED=new Set(['roles.view','roles.edit','roles.assign','users.view','users.edit']);
const RESTRICTED=new Set([
 'roles.view','roles.edit','roles.assign','roles.create',
 'users.create','users.edit','users.disable','settings.edit',
 'properties.delete','documents.delete',
]);
const SENSITIVE=new Set([
 'rent_payments.create','owner_statements.create','leases.edit',
 'commissions.create','commissions.edit','properties.edit','owners.edit',
]);
const MODULE_LABELS:Record<string,string>={
 appointments:'Agenda y visitas',clients:'Clientes',commissions:'Comisiones',
 deals:'Negocios',documents:'Documentos',leads:'Prospectos',
 leases:'Contratos de arrendamiento',maintenance:'Mantenimiento',
 owner_statements:'Liquidaciones',owners:'Propietarios',
 properties:'Inmuebles',rent_payments:'Cobros y abonos',
 reports:'Reportes',roles:'Gestión de roles',settings:'Configuración',users:'Usuarios',
};

function currentPermissions(role:EditableRole):string[]{
 return [...new Set((role.role_permissions??[])
   .map(x=>x.permissions?.key).filter((x):x is string=>Boolean(x)))].sort();
}

/** Permission edits affect this tenant role, not the identity or user assignment. */
export function RolePermissionEditor({organizationId,role,permissions,onClose,onSaved}:{
 organizationId:string;role:EditableRole;permissions:EditablePermission[];
 onClose:()=>void;onSaved:()=>Promise<void>;
}){
 const {can,activeMembership,refreshMemberships}=useAuth();
 const admin=activeMembership?.roles.some(x=>x.key==='ADMIN')??false;
 const isPrivateClient=role.key==='CLIENT';
 const editable=admin&&can(PERMISSIONS.ROLES_EDIT)&&role.active&&!isPrivateClient;
 const baseline=useMemo(()=>currentPermissions(role),[role]);
 const [chosen,setChosen]=useState<Set<string>>(()=>new Set(baseline));
 const [search,setSearch]=useState('');
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 useEffect(()=>{setChosen(new Set(baseline));},[role.id,baseline.join('|')]);
 const dirty=permissions.some(p=>chosen.has(p.key)!==baseline.includes(p.key));
 const grouped=useMemo(()=>{
   const result:Record<string,EditablePermission[]>={};
   for(const p of permissions){
     if(search&&!((p.key+' '+(p.description??'')).toLowerCase().includes(search.toLowerCase())))continue;
     const category=p.key.split('.')[0]??'other';
     (result[category]??=[]).push(p);
   }
   return Object.entries(result).sort(([a],[b])=>(MODULE_LABELS[a]??a).localeCompare(MODULE_LABELS[b]??b,'es'));
 },[permissions,search]);

 function isBlocked(permission:string){
   if(!editable)return true;
   if(role.key==='ADMIN')return ADMIN_FIXED.has(permission);
   return RESTRICTED.has(permission);
 }

 async function save(){
   if(!editable||saving||!dirty)return;
   const selected=permissions.filter(p=>chosen.has(p.key)).map(p=>p.key).sort();
   const added=selected.filter(k=>!baseline.includes(k));
   const removed=baseline.filter(k=>!chosen.has(k));
   if(role.key==='ADMIN'&&[...ADMIN_FIXED].some(k=>!chosen.has(k))){
     setMessage('Los permisos esenciales del administrador están protegidos.');return;
   }
   if(role.key!=='ADMIN'&&selected.some(k=>RESTRICTED.has(k))){
     setMessage('Este perfil no puede recibir permisos reservados a la administración.');return;
   }
   const sensitive=[...added,...removed].filter(x=>SENSITIVE.has(x));
   const details=added.length+' permiso(s) agregados y '+removed.length+' retirados al perfil '+role.name+'.';
   const confirmation=sensitive.length
     ? details+'\n\nLos cambios incluyen autorizaciones operativas o financieras: '+sensitive.join(', ')+'. ¿Confirmas?'
     : details+' ¿Deseas guardar los cambios?';
   if(!window.confirm(confirmation))return;
   setSaving(true);setMessage('');
   try{
     const {error}=await supabase.rpc('admin_update_role_permissions',{
       target_org:organizationId,target_role:role.id,
       desired_permission_keys:selected,expected_permission_keys:baseline,
     });
     if(error){setMessage('No fue posible actualizar este perfil: '+error.message);return;}
     await onSaved();
     await refreshMemberships();
     setMessage('Permisos guardados y registrados en auditoría. Los usuarios deben actualizar su sesión para verlos de inmediato.');
   }catch{
     setMessage('No se confirmó el guardado. Actualiza para verificar antes de reintentar.');
   }finally{setSaving(false);}
 }

 return <section className="mt-5 space-y-4 rounded-xl border-2 border-slate-800 bg-slate-50 p-4"
   aria-label={'Permisos del perfil '+role.name}>
   <div className="flex flex-wrap items-start justify-between gap-3">
     <div>
       <h3 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5"/>{role.name} · Permisos</h3>
       <p className="mt-1 text-sm text-slate-600">
         {chosen.size} seleccionados de {permissions.length} disponibles.
         Los cambios afectan este perfil en esta inmobiliaria, no otras empresas.
       </p>
       <p className="mt-1 text-xs text-slate-600">
         Los perfiles base no se eliminan. Los permisos de un usuario con varios roles se acumulan.
         Los permisos críticos de administración permanecen protegidos.
       </p>
       {isPrivateClient&&<p role="status" className="mt-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
         El perfil Cliente es exclusivamente para el portal privado. Sus datos se autorizan
         vinculándolo desde «Usuarios → Portal como cliente». No se pueden asignar
         permisos operativos generales porque permitirían consultar información de otros clientes.
       </p>}
     </div>
     <button type="button" onClick={onClose} disabled={saving}
       className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm">
       <X className="h-4 w-4"/> Cerrar
     </button>
   </div>
   <label className="block text-sm font-medium">Buscar permisos
     <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
       placeholder="Ej. pagos, propiedades, documentos…"
       className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2"/>
   </label>
   <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
     {grouped.map(([category,rows])=><div key={category} className="rounded-xl border bg-white p-3">
       <h4 className="mb-2 border-b pb-2 text-sm font-bold">{MODULE_LABELS[category]??category}</h4>
       <div className="space-y-2">
         {rows.map(p=>{
           const blocked=isBlocked(p.key);
           return <label key={p.id} className={'flex items-start gap-2 rounded-lg p-2 text-sm '+(blocked?'bg-slate-50 text-slate-500':'hover:bg-slate-50')}>
             <input type="checkbox" className="mt-1" checked={chosen.has(p.key)}
               disabled={blocked||saving}
               onChange={e=>{
                 const next=new Set(chosen);
                 if(e.target.checked)next.add(p.key);else next.delete(p.key);
                 setChosen(next);setMessage('');
               }}/>
             <span className="min-w-0">
               <span className="block font-medium">{p.description||p.key}</span>
               <span className="block break-all text-xs text-slate-500">{p.key}</span>
               {blocked&&<span className="block text-xs">Reservado / protegido</span>}
             </span>
           </label>;
         })}
       </div>
     </div>)}
   </div>
   {grouped.length===0&&<p className="text-sm text-slate-600">No se encontraron permisos.</p>}
   {message&&<p role="status" className="text-sm text-slate-700">{message}</p>}
   <div className="flex flex-wrap items-center justify-end gap-3">
     <span className="mr-auto text-xs text-slate-600">
       {dirty?'Hay modificaciones sin guardar.':'No hay cambios pendientes.'}
     </span>
     <button type="button" disabled={!editable||saving||!dirty}
       onClick={()=>void save()}
       className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
       <Save className="h-4 w-4"/>{saving?'Guardando permisos…':'Guardar permisos'}
     </button>
   </div>
 </section>;
}
