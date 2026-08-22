/** Edge Function administrativa: valida JWT con cliente público y opera con cliente service role separado. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:5500', 'http://localhost:5500', 'https://krisrodas-cyber.github.io']);
const getCorsHeaders = (origin: string | null): Record<string, string> => origin && ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : {};
const respond = (origin: string | null, body: unknown, status = 200) => { console.info('HTTP devuelto:', status); return new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' } }); };
const fail = (origin: string | null, code: string, message: string, status: number) => respond(origin, { ok: false, error: { code, message } }, status);

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  console.info('Origin recibido:', origin);
  console.info('Origin permitido:', !origin || ALLOWED_ORIGINS.has(origin));
  if (req.method === 'OPTIONS') { if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 }); return new Response('ok', { status: 200, headers: getCorsHeaders(origin) }); }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return fail(origin, 'FORBIDDEN', 'Origen no autorizado.', 403);
  if (req.method !== 'POST') return fail(origin, 'INVALID_ACTION', 'Método no permitido.', 405);

  const authHeader = req.headers.get('Authorization');
  console.info('Authorization presente:', Boolean(authHeader));
  if (!authHeader) return fail(origin, 'MISSING_AUTHORIZATION', 'Sesión requerida.', 401);
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) return fail(origin, 'INTERNAL_ERROR', 'Configuración administrativa no disponible.', 500);

  try {
    const userClient = createClient(url, anonKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    console.info('Usuario validado:', Boolean(user));
    console.info('UUID solicitante:', user?.id);
    if (userError || !user) return fail(origin, 'INVALID_SESSION', 'Sesión inválida.', 401);

    // No se sobrescribe Authorization: este cliente conserva service_role y evita RLS en la validación administrativa.
    const adminClient = createClient(url, serviceRoleKey);
    const { data: perfil, error: perfilError } = await adminClient.from('perfiles').select('id,nombre,apellido,activo,rol_id').eq('id', user.id).maybeSingle();
    console.info('Perfil encontrado:', Boolean(perfil));
    console.info('Perfil activo:', perfil?.activo);
    console.info('rol_id:', perfil?.rol_id);
    if (perfilError) return fail(origin, 'PROFILE_QUERY_FAILED', 'No fue posible validar el perfil.', 500);
    if (!perfil) return fail(origin, 'PROFILE_NOT_FOUND', 'Perfil no encontrado.', 403);
    if (perfil.activo !== true) return fail(origin, 'USER_INACTIVE', 'Usuario inactivo.', 403);

    const rolId = Number(perfil.rol_id);
    if (!Number.isInteger(rolId)) return fail(origin, 'ROLE_NOT_FOUND', 'Rol no encontrado.', 403);
    const { data: rol, error: rolError } = await adminClient.from('roles').select('id,nombre').eq('id', rolId).maybeSingle();
    console.info('Rol encontrado:', rol?.nombre);
    if (rolError) return fail(origin, 'ROLE_QUERY_FAILED', 'No fue posible validar el rol.', 500);
    if (!rol) return fail(origin, 'ROLE_NOT_FOUND', 'Rol no encontrado.', 403);
    if (rol.nombre !== 'Administrador') return fail(origin, 'ADMIN_REQUIRED', 'No tiene permisos para administrar usuarios.', 403);

    const body = await req.json(); const action = body?.action;
    console.info('Acción:', action);
    const validRoles = ['1', '2', '3', '4'];
    const validRole = (value: unknown) => validRoles.includes(String(value));
    const isUuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    /**
     * Resuelve la parroquia únicamente cuando el rol objetivo es Secretario.
     * El valor recibido nunca se acepta sin comprobar que la parroquia existe y está activa.
     */
    const resolveParishForRole = async (roleId: unknown, parishId: unknown) => {
      if (String(roleId) !== '2') return { parishId: null as string | null, error: null };
      if (!isUuid(parishId)) return { parishId: null as string | null, error: { code: 'PARISH_REQUIRED', message: 'Debe seleccionar una parroquia para el usuario Secretario.', status: 400 } };
      const { data: parish, error } = await adminClient.from('parroquias').select('id,codigo,nombre,estado').eq('id', parishId).maybeSingle();
      if (error) return { parishId: null as string | null, error: { code: 'PARISH_QUERY_FAILED', message: 'No fue posible validar la parroquia seleccionada.', status: 500 } };
      if (!parish || parish.estado !== true) return { parishId: null as string | null, error: { code: 'INVALID_PARISH', message: 'La parroquia seleccionada no existe o está inactiva.', status: 400 } };
      return { parishId: parish.id as string, parish, error: null };
    };
    const lastAdmin = async (targetId: string) => { const { data: target, error: targetError } = await adminClient.from('perfiles').select('rol_id,activo').eq('id', targetId).maybeSingle(); if (targetError) throw targetError; if (target?.rol_id !== '1' || target.activo !== true) return false; const { count, error } = await adminClient.from('perfiles').select('id', { count: 'exact', head: true }).eq('rol_id', '1').eq('activo', true); if (error) throw error; return (count ?? 0) <= 1; };
    if (action === 'create') {
      const rolId = String(body.rol_id ?? '');
      const parroquiaId = body.parroquia_id ?? null;
      console.info('Rol de creación recibido:', rolId);
      if (!validRole(rolId)) return fail(origin, 'INVALID_ROLE', 'El rol seleccionado no es válido.', 400);
      if (!/^\S+@\S+\.\S+$/.test(body.email ?? '') || String(body.password ?? '').length < 10 || !body.nombre?.trim() || !body.apellido?.trim()) return fail(origin, 'INVALID_INPUT', 'Datos de usuario inválidos.', 400);
      const parishResult = await resolveParishForRole(rolId, parroquiaId);
      if (parishResult.error) return fail(origin, parishResult.error.code, parishResult.error.message, parishResult.error.status);
      const finalParroquiaId = rolId === '2' ? parishResult.parishId : null;
      const { data, error: createError } = await adminClient.auth.admin.createUser({ email: body.email.trim(), password: body.password, email_confirm: true, ban_duration: body.activo === false ? '876000h' : 'none' });
      if (createError || !data.user) return fail(origin, 'CONFLICT', 'No fue posible crear el usuario.', 409);
      const { error: profileInsertError } = await adminClient.from('perfiles').insert({ id: data.user.id, nombre: body.nombre.trim(), apellido: body.apellido.trim(), rol_id: rolId, parroquia_id: finalParroquiaId, activo: body.activo !== false });
      if (profileInsertError) { await adminClient.auth.admin.deleteUser(data.user.id); return fail(origin, 'PROFILE_CREATION_FAILED', 'El usuario fue creado, pero no fue posible completar su perfil.', 500); }
      return respond(origin, { ok: true, data: { id: data.user.id, email: data.user.email, nombre_completo: `${body.nombre.trim()} ${body.apellido.trim()}`, rol_id: rolId, parroquia_id: finalParroquiaId } }, 201);
    }
    const targetId = String(body.userId ?? body.user_id ?? '');
    if (['updateProfile', 'changeRole', 'activate', 'deactivate', 'resetPassword'].includes(action) && !targetId) return fail(origin, 'INVALID_INPUT', 'Usuario requerido.', 400);
    if (action === 'updateProfile') { if (!body.nombre?.trim() || !body.apellido?.trim()) return fail(origin, 'INVALID_INPUT', 'Nombre y apellido son obligatorios.', 400); const { error } = await adminClient.from('perfiles').update({ nombre: body.nombre.trim(), apellido: body.apellido.trim() }).eq('id', targetId); return error ? fail(origin, 'INTERNAL_ERROR', 'No fue posible actualizar el perfil.', 500) : respond(origin, { ok: true, data: { id: targetId } }); }
    if (action === 'changeRole') { const rolId = String(body.rol_id ?? ''); if (!validRole(rolId)) return fail(origin, 'INVALID_ROLE', 'Rol inválido.', 400); if (targetId === user.id) return fail(origin, 'CONFLICT', 'No puede modificar su propio rol.', 409); if (rolId !== '1' && await lastAdmin(targetId)) return fail(origin, 'CONFLICT', 'No puede degradar al último Administrador activo.', 409); const parishResult = await resolveParishForRole(rolId, body.parroquia_id); if (parishResult.error) return fail(origin, parishResult.error.code, parishResult.error.message, parishResult.error.status); const finalParroquiaId = rolId === '2' ? parishResult.parishId : null; const { error } = await adminClient.from('perfiles').update({ rol_id: rolId, parroquia_id: finalParroquiaId }).eq('id', targetId); return error ? fail(origin, 'INTERNAL_ERROR', 'No fue posible cambiar el rol.', 500) : respond(origin, { ok: true, data: { id: targetId, rol_id: rolId, parroquia_id: finalParroquiaId } }); }
    if (action === 'activate' || action === 'deactivate') { const active = action === 'activate'; if (!active && targetId === user.id) return fail(origin, 'CONFLICT', 'No puede inactivarse a sí mismo.', 409); if (!active && await lastAdmin(targetId)) return fail(origin, 'CONFLICT', 'No puede inactivar al último Administrador activo.', 409); const { error } = await adminClient.from('perfiles').update({ activo: active }).eq('id', targetId); if (error) return fail(origin, 'INTERNAL_ERROR', 'No fue posible actualizar el estado.', 500); const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(targetId, { ban_duration: active ? 'none' : '876000h' }); return authUpdateError ? fail(origin, 'INTERNAL_ERROR', 'No fue posible actualizar el acceso.', 500) : respond(origin, { ok: true, data: { id: targetId, activo: active } }); }
    if (action === 'resetPassword') { if (String(body.password ?? '').length < 10) return fail(origin, 'INVALID_INPUT', 'La contraseña temporal debe tener al menos 10 caracteres.', 400); const { error } = await adminClient.auth.admin.updateUserById(targetId, { password: body.password }); return error ? fail(origin, 'INTERNAL_ERROR', 'No fue posible restablecer la contraseña.', 500) : respond(origin, { ok: true, data: { id: targetId } }); }
    if (action !== 'list') return fail(origin, 'INVALID_ACTION', 'La acción solicitada no está disponible.', 400);
    const page = Math.max(1, Number(body.page) || 1); const perPage = Math.min(100, Math.max(1, Number(body.perPage) || 100));
    const { data: authResult, error: listError } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (listError || !authResult) return fail(origin, 'LIST_USERS_FAILED', 'No fue posible obtener usuarios.', 500);
    const ids = authResult.users.map((item) => item.id);
    const { data: perfiles, error: profilesError } = ids.length ? await adminClient.from('perfiles').select('id,nombre,apellido,rol_id,parroquia_id,activo').in('id', ids) : { data: [], error: null };
    if (profilesError) return fail(origin, 'PROFILE_QUERY_FAILED', 'No fue posible obtener perfiles.', 500);
    const roleIds = [...new Set((perfiles ?? []).map((item) => Number(item.rol_id)).filter(Number.isInteger))];
    const { data: roles, error: rolesError } = roleIds.length ? await adminClient.from('roles').select('id,nombre').in('id', roleIds) : { data: [], error: null };
    if (rolesError) return fail(origin, 'ROLE_QUERY_FAILED', 'No fue posible obtener roles.', 500);
    const parishIds = [...new Set((perfiles ?? []).map((item) => item.parroquia_id).filter(Boolean))];
    const { data: parishes, error: parishesError } = parishIds.length ? await adminClient.from('parroquias').select('id,codigo,nombre').in('id', parishIds) : { data: [], error: null };
    if (parishesError) return fail(origin, 'PARISH_QUERY_FAILED', 'No fue posible obtener las parroquias asignadas.', 500);
    const profilesById = new Map((perfiles ?? []).map((item) => [item.id, item])); const rolesById = new Map((roles ?? []).map((item) => [item.id, item.nombre])); const parishesById = new Map((parishes ?? []).map((item) => [item.id, item]));
    const users = authResult.users.map((item) => { const profile = profilesById.get(item.id); const parish = profile?.parroquia_id ? parishesById.get(profile.parroquia_id) : null; const name = profile ? `${profile.nombre ?? ''} ${profile.apellido ?? ''}`.trim() : 'Perfil pendiente'; return { id: item.id, email: item.email ?? '', nombre: profile?.nombre ?? '', apellido: profile?.apellido ?? '', nombre_completo: name || 'Perfil pendiente', rol_id: profile?.rol_id ?? null, rol: profile ? rolesById.get(Number(profile.rol_id)) ?? 'Sin rol' : 'Sin rol', parroquia_id: profile?.parroquia_id ?? null, parroquia: parish ? { codigo: parish.codigo, nombre: parish.nombre } : null, activo: profile?.activo ?? false, created_at: item.created_at, last_sign_in_at: item.last_sign_in_at ?? null }; });
    return respond(origin, { ok: true, data: { users, page, perPage, total: authResult.total ?? users.length } });
  } catch (error) { console.error('admin-users failed:', error instanceof Error ? error.message : 'unknown'); return fail(origin, 'INTERNAL_ERROR', 'No fue posible completar la operación.', 500); }
});
