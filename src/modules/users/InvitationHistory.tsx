import {useMemo,useState} from 'react';
import {Clock3} from 'lucide-react';

export interface InvitationRow {
  id:string;
  email:string;
  full_name:string|null;
  status:string;
  expires_at:string;
  created_at:string;
  accepted_at:string|null;
  invitation_roles:Array<{
    role_id:string;
    roles:{id:string;name:string;key:string|null}|null;
  }>;
}

export type InvitationDisplayStatus='PENDING'|'ACCEPTED'|'CANCELLED'|'EXPIRED'|'UNKNOWN';

/** Expiry is a view of a pending invitation; never rewrite its stored status. */
export function invitationDisplayStatus(invite:Pick<InvitationRow,'status'|'expires_at'>,now=Date.now()):InvitationDisplayStatus{
  if(invite.status==='ACCEPTED')return 'ACCEPTED';
  if(invite.status==='CANCELLED')return 'CANCELLED';
  if(invite.status==='EXPIRED')return 'EXPIRED';
  if(invite.status==='PENDING')return new Date(invite.expires_at).getTime()<=now?'EXPIRED':'PENDING';
  return 'UNKNOWN';
}
const LABELS:Record<InvitationDisplayStatus,string>={
  PENDING:'Pendiente de aceptación',
  ACCEPTED:'Aceptada',
  CANCELLED:'Cancelada',
  EXPIRED:'Vencida',
  UNKNOWN:'Estado no reconocido',
};
const dateText=(iso:string|null)=>{
  if(!iso||!Number.isFinite(new Date(iso).getTime()))return '—';
  return new Intl.DateTimeFormat('es-CO',{
    dateStyle:'medium',timeStyle:'short',timeZone:'America/Bogota',
  }).format(new Date(iso));
};

type Filter='ALL'|'PENDING'|'ACCEPTED'|'EXPIRED'|'CANCELLED';

export function InvitationHistory({invitations,loading,error,canCancel,onCancel}:{
  invitations:InvitationRow[];loading:boolean;error:string;
  canCancel:boolean;onCancel:(id:string)=>void;
}){
  const [filter,setFilter]=useState<Filter>('ALL');
  const now=Date.now();
  const summary=useMemo(()=>{
    const counts:Record<InvitationDisplayStatus,number>={
      PENDING:0,ACCEPTED:0,CANCELLED:0,EXPIRED:0,UNKNOWN:0,
    };
    for(const invitation of invitations)counts[invitationDisplayStatus(invitation,now)]++;
    return counts;
  },[invitations,now]);
  const visible=invitations.filter(item=>filter==='ALL'||invitationDisplayStatus(item,now)===filter);
  const filters:Array<{key:Filter;label:string}>= [
    {key:'ALL',label:'Todas'},
    {key:'PENDING',label:'Pendientes'},
    {key:'ACCEPTED',label:'Aceptadas'},
    {key:'EXPIRED',label:'Vencidas'},
    {key:'CANCELLED',label:'Canceladas'},
  ];

  return <section className="rounded-2xl border border-stone-200 bg-white" aria-label="Invitaciones e historial">
    <div className="border-b border-stone-200 px-5 py-4">
      <h2 className="font-bold">Invitaciones e historial</h2>
      <p className="mt-1 text-xs text-slate-600">
        Consulta todas las invitaciones registradas para esta inmobiliaria.
        Una invitación desaparece de «Pendientes» cuando el usuario la acepta,
        pero permanece en este historial.
      </p>
    </div>
    {loading?<p role="status" className="p-5 text-sm text-slate-600">Consultando invitaciones…</p>:
      error?<p role="alert" className="m-5 rounded-lg border border-amber-300 p-4 text-sm text-amber-900">
        {error} No se mostrará una lista incompleta como si estuviera vacía.
      </p>:
      <>
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
          {([
            {label:'Pendientes',value:summary.PENDING},
            {label:'Aceptadas',value:summary.ACCEPTED},
            {label:'Vencidas',value:summary.EXPIRED},
            {label:'Canceladas',value:summary.CANCELLED},
          ]).map(stat=><div key={stat.label} className="rounded-xl border border-stone-200 p-3">
            <div className="text-2xl font-semibold tabular-nums">{stat.value}</div>
            <div className="text-xs text-slate-600">{stat.label}</div>
          </div>)}
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-4" role="group" aria-label="Filtrar invitaciones">
          {filters.map(item=><button type="button" key={item.key}
            aria-pressed={filter===item.key}
            onClick={()=>setFilter(item.key)}
            className={'rounded-lg border px-3 py-2 text-xs font-semibold '+
              (filter===item.key?'border-slate-900 bg-slate-900 text-white':'border-stone-300 bg-white')}>
            {item.label}
          </button>)}
        </div>
        {visible.length===0?
          <p className="px-5 pb-5 text-sm text-slate-600" role="status">
            {invitations.length===0?
              'No existen invitaciones registradas para esta inmobiliaria. Usa «Invitar usuario» para crear una.':
              filter==='PENDING'?
                'No hay invitaciones pendientes de aceptación. Consulta «Todas» o «Aceptadas» para ver el historial.':
                'No hay invitaciones con este estado.'}
          </p>:
          <div className="divide-y divide-stone-100 border-t">
            {visible.map(invitation=>{
              const status=invitationDisplayStatus(invitation,now);
              return <article key={invitation.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-semibold">{invitation.full_name||invitation.email}</p>
                  <p className="break-all text-xs text-slate-600">{invitation.email}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Invitada: {dateText(invitation.created_at)}
                    {status==='ACCEPTED'? ' · Aceptada: '+dateText(invitation.accepted_at):
                      status==='PENDING'?' · Vence: '+dateText(invitation.expires_at):''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {invitation.invitation_roles.map(item=><span key={item.role_id}
                      className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-medium">
                      {item.roles?.name??'Rol registrado'}
                    </span>)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-700">
                    {status==='PENDING'&&<Clock3 className="h-3.5 w-3.5"/>}
                    {LABELS[status]}
                  </span>
                  {status==='PENDING'&&canCancel&&
                    <button type="button" onClick={()=>onCancel(invitation.id)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold">
                      Cancelar invitación
                    </button>}
                </div>
              </article>;
            })}
          </div>}
      </>}
  </section>;
}
