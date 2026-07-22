/** Inicializa el estado activo y la navegación sin recargar el Layout. */

/**
 * Marca el enlace correspondiente a la vista actual.
 *
 * @param {string} viewName Nombre de archivo de la vista activa.
 */
export const setActiveView = (viewName) => {
  document.querySelectorAll('.sidebar__link').forEach((link) => {
    const isActive = link.dataset.view === viewName;
    link.classList.toggle('is-active', isActive);
    link.toggleAttribute('aria-current', isActive);
  });
};

/** Alterna la visibilidad del Sidebar en pantallas móviles. */
const toggleSidebar = () => {
  const sidebar = document.querySelector('.app-sidebar');
  const backdrop = document.querySelector('#sidebar-backdrop');
  const toggleButton = document.querySelector('#sidebar-toggle');
  const isOpen = sidebar.classList.toggle('is-open');

  backdrop.classList.toggle('is-visible', isOpen);
  toggleButton.setAttribute('aria-expanded', String(isOpen));
  toggleButton.setAttribute('aria-label', isOpen ? 'Cerrar navegación' : 'Abrir navegación');
};

/** Cierra el Sidebar móvil cuando está abierto. */
const closeSidebar = () => {
  if (document.querySelector('.app-sidebar').classList.contains('is-open')) {
    toggleSidebar();
  }
};

/** Determina si una interacción debe conservar el comportamiento nativo del enlace. */
const shouldUseNativeNavigation = (event) => event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * Registra navegación SPA, comportamiento móvil y estado activo del Sidebar.
 *
 * @param {(viewName: string) => Promise<void>} navigateTo Función central de navegación.
 * @param {(permission: string) => boolean} canAccess Función de autorización de interfaz.
 */
export const initializeSidebar = (navigateTo, canAccess) => {
  document.querySelectorAll('.sidebar__link').forEach((link) => {
    link.hidden = !canAccess(link.dataset.permission);
  });

  document.querySelector('#sidebar-toggle').addEventListener('click', toggleSidebar);
  document.querySelector('#sidebar-backdrop').addEventListener('click', closeSidebar);

  document.querySelectorAll('[data-view]').forEach((link) => {
    link.addEventListener('click', async (event) => {
      if (shouldUseNativeNavigation(event)) {
        return;
      }

      event.preventDefault();
      await navigateTo(link.dataset.view);
      closeSidebar();
    });
  });
};
