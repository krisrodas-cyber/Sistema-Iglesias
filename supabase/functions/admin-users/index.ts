/** Edge Function administrativa: valida JWT con cliente público y opera con cliente service role separado. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const localOrigins = ['http://127.0.0.1:5500', 'http://localhost:5500'];
const headers = (origin: string | null) => ({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin ?? 'null', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' });
const respond = (origin: string | null, body: unknown, status = 200) => { console.info('HTTP devuelto:', status); return new Response(JSON.stringify(body), { status, headers: headers(origin) }); };
const fail = (origin: string | null, code: string, message: string, status: number) => respond(origin, { ok: false, error: { code, message } }, status);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const allowedOrigins = [...localOrigins, ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean)];
  if (origin && !allowedOrigins.includes(origin)) return fail(origin, 'FORBIDDEN', 'Origen no autorizado.', 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
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
    const validRole = (value: unknown) => ['1', '2', '3', '4'].includes(String(value));
    const lastAdmin = async (targetId: string) => { const { data: target, error: targetError } = await adminClient.from('perfiles').select('rol_id,activo').eq('id', targetId).maybeSingle(); if (targetError) throw targetError; if (target?.rol_id !== '1' || target.activo !== true) return false; const { count, error } = await adminClient.from('perfiles').select('id', { count: 'exact', head: true }).eq('rol_id', '1').eq('activo', true); if (error) throw error; return (count ?? 0) <= 1; };
    if (action === 'create') { if (!/^\S+@\S+\.\S+$/.test(body.email ?? '') || String(body.password ?? '').length < 10 || !body.nombre?.trim() || !body.apellido?.trim() || !validRole(body.rol_id)) return fail(origin, 'INVALID_INPUT', 'Datos de usuario inválidos.', 400); const { data, error: createError } = await adminClient.auth.admin.createUser({ email: body.email.trim(), password: body.password, email_confirm: true, ban_duration: body.activo === false ? '876000h' : 'none' }); if (createError || !data.user) return fail(origin, 'CONFLICT', 'No fue posible crear el usuario.', 409); const { error: profileInsertError } = await adminClient.from('perfiles').insert({ id: data.user.id, nombre: body.nombre.trim(), apellido: body.apellido.trim(), rol_id: String(body.rol_id), activo: body.activo !== false }); if (profileInsertError) { await adminClient.auth.admin.deleteUser(data.user.id); return fail(origin, 'INTERNAL_ERROR', 'No fue posible crear el perfil.', 500); } return respond(origin, { ok: true, data: { id: data.user.id, email: data.user.email, nombre_completo: `${body.nombre.trim()} ${body.apellido.trim()}` } }, 201); }
    const targetId = String(body.userId ?? body.user_id ?? '');
    if (['updateProfile', 'changeRole', 'activate', 'deactivate', 'resetPassword'].includes(action) && !targetId) return fail(origin, 'INVALID_INPUT', 'Usuario requerido.', 400);
    if (action === 'updateProfile') { if (!body.nombre?.trim() || !body.apellido?.trim()) return fail(origin, 'INVALID_INPUT', 'Nombre y apellido son obligatorios.', 400); const { error } = await adminClient.from('perfiles').update({ nombre: body.nombre.trim(), apellido: body.apellido.trim() }).eq('id', targetId); return error ? fail(origin, 'INTERNAL_ERROR', 'No fue posible actualizar el perfil.', 500) : respond(origin, { ok: true, data: { id: targetId } }); }
    if (action === 'changeRole') { if (!validRole(body.rol_id)) return fail(origin, 'INVALID_INPUT', 'Rol inválido.', 400); if (targetId === user.id) return fail(origin, 'CONFLICT', 'No puede modificar su propio rol.', 409); if (String(body.rol_id) !== '1' && await lastAdmin(targetId)) return fail(origin, 'CONFLICT', 'No puede degradar al último Administrador activo.', 409); const { error } = await adminClient.from('perfiles').update({ rol_id: String(body.rol_id) }).eq('id', targetId); return error ? fail(origin, 'INTERNAL_ERROR', 'No fue posible cambiar el rol.', 500) : respond(origin, { ok: true, data: { id: targetId } }); }
    if (action === 'activate' || action === 'deactivate') { const active = action === 'activate'; if (!active && targetId === user.id) return fail(origin, 'CONFLICT', 'No puede inactivarse a sí mismo.', 409); if (!active && await lastAdmin(targetId)) return fail(origin, 'CONFLICT', 'No puede inactivar al último Administrador activo.', 409); const { error } = await adminClient.from('perfiles').update({ activo: active }).eq('id', targetId); if (error) return fail(origin, 'INTERNAL_ERROR', 'No fue posible actualizar el estado.', 500); const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(targetId, { ban_duration: active ? 'none' : '876000h' }); return authUpdateError ? fail(origin, 'INTERNAL_ERROR', 'No fue posible actualizar el acceso.', 500) : respond(origin, { ok: true, data: { id: targetId, activo: active } }); }
    if (action === 'resetPassword') { if (String(body.password ?? '').length < 10) return fail(origin, 'INVALID_INPUT', 'La contraseña temporal debe tener al menos 10 caracteres.', 400); const { error } = await adminClient.auth.admin.updateUserById(targetId, { password: body.password }); return error ? fail(origin, 'INTERNAL_ERROR', 'No fue posible restablecer la contraseña.', 500) : respond(origin, { ok: true, data: { id: targetId } }); }
    if (action !== 'list') return fail(origin, 'INVALID_ACTION', 'La acción solicitada no está disponible.', 400);
    const page = Math.max(1, Number(body.page) || 1); const perPage = Math.min(100, Math.max(1, Number(body.perPage) || 100));
    const { data: authResult, error: listError } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (listError || !authResult) return fail(origin, 'LIST_USERS_FAILED', 'No fue posible obtener usuarios.', 500);
    const ids = authResult.users.map((item) => item.id);
    const { data: perfiles, error: profilesError } = ids.length ? await adminClient.from('perfiles').select('id,nombre,apellido,rol_id,activo').in('id', ids) : { data: [], error: null };
    if (profilesError) return fail(origin, 'PROFILE_QUERY_FAILED', 'No fue posible obtener perfiles.', 500);
    const roleIds = [...new Set((perfiles ?? []).map((item) => Number(item.rol_id)).filter(Number.isInteger))];
    const { data: roles, error: rolesError } = roleIds.length ? await adminClient.from('roles').select('id,nombre').in('id', roleIds) : { data: [], error: null };
    if (rolesError) return fail(origin, 'ROLE_QUERY_FAILED', 'No fue posible obtener roles.', 500);
    const profilesById = new Map((perfiles ?? []).map((item) => [item.id, item])); const rolesById = new Map((roles ?? []).map((item) => [item.id, item.nombre]));
    const users = authResult.users.map((item) => { const profile = profilesById.get(item.id); const name = profile ? `${profile.nombre ?? ''} ${profile.apellido ?? ''}`.trim() : 'Perfil pendiente'; return { id: item.id, email: item.email ?? '', nombre: profile?.nombre ?? '', apellido: profile?.apellido ?? '', nombre_completo: name || 'Perfil pendiente', rol_id: profile?.rol_id ?? null, rol: profile ? rolesById.get(Number(profile.rol_id)) ?? 'Sin rol' : 'Sin rol', activo: profile?.activo ?? false, created_at: item.created_at, last_sign_in_at: item.last_sign_in_at ?? null }; });
    return respond(origin, { ok: true, data: { users, page, perPage, total: authResult.total ?? users.length } });
  } catch (error) { console.error('admin-users failed:', error instanceof Error ? error.message : 'unknown'); return fail(origin, 'INTERNAL_ERROR', 'No fue posible completar la operación.', 500); }
});
