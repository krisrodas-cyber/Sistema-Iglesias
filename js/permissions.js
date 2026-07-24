/** Fuente única de permisos de interfaz. RLS y la Edge Function mantienen la seguridad real. */
const all=['dashboard','parishes','priests','assignments','communities','chapels','inventory','consultas','users','settings'];
const read=['dashboard','parishes','priests','assignments','communities','chapels','inventory','consultas'];
export const ROLE_PERMISSIONS={
  '1':{modules:all,resources:{'*':['view','create','edit','deactivate','reactivate','print','view_restricted','manage_users','manage_settings']}},
  '2':{modules:['dashboard','parishes','priests','communities','chapels','inventory','consultas'],resources:{parishes:['view','create'],priests:['view','create'],communities:['view','create'],chapels:['view','create'],inventory:['view','create'],consultas:['view','print']}},
  '3':{modules:['consultas'],resources:{consultas:['view','print']}},
  '4':{modules:read,resources:{dashboard:['view'],parishes:['view'],priests:['view'],assignments:['view'],communities:['view'],chapels:['view'],inventory:['view','view_restricted'],consultas:['view','print']}},
};
const resourceForModule={dashboard:'dashboard',parroquias:'parishes',sacerdotes:'priests',asignaciones:'assignments',comunidades:'communities',capillas:'chapels','inventario-documental':'inventory',consultas:'consultas',usuarios:'users',configuracion:'settings'};
const role=context=>ROLE_PERMISSIONS[context?.profile?.rol_id]??{modules:[],resources:{}};
export const canPerform=(context,resource,action)=>{const p=role(context);if(p.resources['*'])return true;const normalized=action==='update'?'edit':action;return p.resources[resource]?.includes(normalized)||false};
export const canAccessModule=(context,module)=>role(context).modules.includes(resourceForModule[module]??module)||canPerform(context,resourceForModule[module]??module,'view');
export const canViewRestrictedDocuments=context=>canPerform(context,'inventory','view_restricted');
export const canManageUsers=context=>canPerform(context,'users','manage_users');
/** Compatibilidad con permisos existentes recurso.acción. */
export const hasInterfacePermission=(context,permission)=>{const [resource,action='view']=permission.split('.');return canPerform(context,resource,action)};
