/** Controla la información del usuario y el cierre de sesión de la Topbar. */
import { supabase } from '../js/auth.js';
import { getDisplayName, getDisplayRole, getInitials } from '../js/utils.js';

/** Redirige al Login sin conservar una vista privada en el historial. */
const redirectToLogin = () => {
  window.location.replace(new URL('../index.html', import.meta.url));
};

/** Inserta de forma segura el perfil del usuario autenticado en la Topbar. */
const renderUserProfile = (userContext) => {
  const fullName = getDisplayName(userContext);
  document.querySelector('#avatar-initials').textContent = getInitials(fullName);
  document.querySelector('#user-name').textContent = fullName;
  document.querySelector('#user-email').textContent = userContext.user.email ?? 'Correo no disponible';
  document.querySelector('#topbar-user-role').textContent = getDisplayRole(userContext);
  const parish = document.querySelector('#assigned-parish');
  if (userContext.role?.nombre === 'Secretario') {
    parish.textContent = userContext.assignedParish
      ? `Parroquia asignada: ${userContext.assignedParish.codigo} · ${userContext.assignedParish.nombre}`
      : 'El usuario Secretario no tiene una parroquia asignada.';
    parish.classList.remove('d-none');
  } else parish.classList.add('d-none');
};

/** Cierra la sesión de Supabase y devuelve al usuario al Login. */
const handleSignOut = async () => {
  const signOutButton = document.querySelector('#sign-out-button');
  signOutButton.disabled = true;

  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error('No fue posible cerrar la sesión:', error);
  } finally {
    redirectToLogin();
  }
};

/** Inicializa la Topbar con la sesión actual y sus eventos. */
export const initializeTopbar = (userContext) => {
  renderUserProfile(userContext);
  document.querySelector('#sign-out-button').addEventListener('click', handleSignOut);
};
