/** Utilidades puras reutilizables para presentar datos de usuario. */

/** @param {object} userContext Contexto autorizado. @returns {string} Nombre visible. */
export const getDisplayName = (userContext) => {
  const { profile = {}, user = {} } = userContext;
  const fullName = [profile.nombre, profile.apellido].filter(Boolean).join(' ');
  return fullName || user.email?.split('@')[0] || 'Usuario del sistema';
};

/** @param {string} fullName Nombre visible. @returns {string} Máximo dos iniciales. */
export const getInitials = (fullName) => fullName.trim().split(/\s+/).slice(0, 2).map((namePart) => namePart.charAt(0)).join('').toUpperCase();

/** @param {object} userContext Contexto autorizado. @returns {string} Rol visible desde public.roles. */
export const getDisplayRole = (userContext) => {
  const role = userContext.role ?? {};
  return role.nombre ?? role.name ?? role.descripcion ?? role.rol ?? role.id ?? 'Usuario';
};

/** Inserta el año actual en el Footer reutilizable. */
export const setFooterMetadata = (applicationName, applicationVersion) => {
  document.querySelector('#application-name').textContent = applicationName;
  document.querySelector('#application-version').textContent = applicationVersion;
  document.querySelector('#current-year').textContent = String(new Date().getFullYear());
};
