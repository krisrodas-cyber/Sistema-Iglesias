/**
 * Servicios de autenticación para el Sistema de Gestión de Iglesias.
 * La dependencia corresponde a la librería oficial @supabase/supabase-js.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { hasInterfacePermission } from './permissions.js';

/** Cliente único de Supabase reutilizado por los módulos de la aplicación. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/**
 * Inicia una sesión con correo electrónico y contraseña.
 *
 * @param {string} email Correo electrónico del usuario.
 * @param {string} password Contraseña del usuario.
 * @returns {Promise<{data: object, error: object|null}>} Resultado de Supabase Auth.
 */
export const signInWithEmail = async (email, password) => {
  return supabase.auth.signInWithPassword({ email, password });
};

/**
 * Obtiene la sesión activa almacenada por Supabase en el navegador.
 *
 * @returns {Promise<object|null>} La sesión activa o null cuando no existe.
 * @throws {object} Propaga un error inesperado al consultar la sesión.
 */
export const getActiveSession = async () => {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
};

/**
 * Confirma con Supabase la identidad del usuario autenticado.
 *
 * @returns {Promise<object|null>} Usuario autenticado o null cuando no existe una sesión válida.
 */
export const getAuthenticatedUser = async () => {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return data.user;
};


/**
 * Obtiene el usuario de Auth, su perfil público y el rol relacionado.
 * El UUID de Auth se consulta directamente en public.perfiles.id.
 *
 * @returns {Promise<{user: object, profile: object, role: object}|null>} Contexto autorizado o null.
 */
export const getUserContext = async () => {
  const session = await getActiveSession();

  if (!session) {
    return null;
  }

  // Diagnóstico temporal para verificar la relación Auth → perfiles → roles.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  console.log('Usuario autenticado:', user);
  console.log('Error de autenticación:', userError);

  if (userError || !user) {
    return null;
  }

  const { data: perfil, error: perfilError } = await supabase
    .from('perfiles')
    .select('id, nombre, apellido, activo, rol_id')
    .eq('id', user.id)
    .maybeSingle();

  console.log('Perfil encontrado:', perfil);
  console.log('Error al consultar perfil:', perfilError);

  const { data: rol, error: rolError } = await supabase
    .from('roles')
    .select('id, nombre')
    .eq('id', perfil?.rol_id)
    .maybeSingle();

  console.log('Rol encontrado:', rol);
  console.log('Error al consultar rol:', rolError);

  if (perfilError || !perfil || !perfil.activo || rolError || !rol) {
    return null;
  }

  return { user, profile: perfil, role: rol };
};

/**
 * Determina si el contexto autorizado puede mostrar una acción de interfaz.
 * Las políticas RLS continúan validando la autorización real en Supabase.
 *
 * @param {{profile: {rol_id: string}}|null} userContext Contexto de usuario autorizado.
 * @param {string} permission Permiso solicitado.
 * @returns {boolean} Indica si el rol puede acceder a la acción solicitada.
 */
export const hasPermission = (userContext, permission) => {
  return hasInterfacePermission(userContext, permission);
};
