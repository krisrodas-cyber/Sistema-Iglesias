/** Punto de entrada de las vistas privadas: autenticación, Layout y navegación SPA. */
import { loadLayout, loadView } from '../components/layout.js';
import { initializeSidebar, setActiveView } from '../components/sidebar.js';
import { initializeTopbar } from '../components/topbar.js';
import { getUserContext, hasPermission, supabase } from './auth.js';
import { APP_NAME, APP_VERSION } from './config.js';
import { setFooterMetadata } from './utils.js';

const dashboardUrl = new URL('../pages/dashboard.html', import.meta.url);

/** Registro central de vistas dinámicas privadas. */
const viewRegistry = {
  dashboard: { url: dashboardUrl, permission: 'dashboard.view', initialize: async () => { const module = await import('./dashboard.js'); await module.initDashboard(); return module.destroyDashboard; } },
  parroquias: {
    url: new URL('../app/parroquias.html', import.meta.url),
    permission: 'parishes.view',
    stylesheet: new URL('../css/parroquias.css', import.meta.url),
    initialize: async (context) => {
      const module = await import('./parroquias.js');
      await module.initParroquias(context);
      return module.destroyParroquias;
    },
  },
  sacerdotes: {
    url: new URL('../app/sacerdotes.html', import.meta.url),
    permission: 'priests.view',
    stylesheet: new URL('../css/sacerdotes.css', import.meta.url),
    initialize: async (context) => {
      const module = await import('./sacerdotes.js');
      await module.initSacerdotes(context);
      return module.destroySacerdotes;
    },
  },
  asignaciones: {
    url: new URL('../app/asignaciones.html', import.meta.url),
    permission: 'assignments.view',
    stylesheet: new URL('../css/asignaciones.css', import.meta.url),
    initialize: async (context) => {
      const module = await import('./asignaciones.js');
      await module.initAsignaciones(context);
      return module.destroyAsignaciones;
    },
  },
  comunidades: {
    url: new URL('../app/comunidades.html', import.meta.url), permission: 'communities.view', stylesheet: new URL('../css/comunidades.css', import.meta.url),
    initialize: async (context) => { const module = await import('./comunidades.js'); await module.initComunidades(context); return module.destroyComunidades; },
  },
  capillas: { url: new URL('../app/capillas.html', import.meta.url), permission: 'chapels.view', stylesheet: new URL('../css/capillas.css', import.meta.url), initialize: async (context) => { const module = await import('./capillas.js'); await module.initCapillas(context); return module.destroyCapillas; } },
  consultas: { url: new URL('../app/consultas.html', import.meta.url), permission: 'consultas.view', stylesheet: new URL('../css/consultas.css', import.meta.url), initialize: async (context) => { const module = await import('./consultas.js'); await module.initConsultas(context); return module.destroyConsultas; } },
  inventarioDocumental: { url: new URL('../app/inventario-documental.html', import.meta.url), permission: 'inventory.view', stylesheet: new URL('../css/inventario-documental.css', import.meta.url), initialize: async (context) => { const module = await import('./inventario-documental.js'); await module.initInventarioDocumental(context); return module.destroyInventarioDocumental; } },
  usuarios: { url: new URL('../app/usuarios.html', import.meta.url), permission: 'users.view', stylesheet: new URL('../css/usuarios.css', import.meta.url), initialize: async (context) => { const module = await import('./usuarios.js'); await module.initUsuarios(context); return module.destroyUsuarios; } },
  reportes: { url: new URL('../pages/reportes.html', import.meta.url), permission: 'reports.view' },
  configuracion: { url: new URL('../pages/configuracion.html', import.meta.url), permission: 'settings.view' },
};

let currentUserContext;
let activeView = 'dashboard';
let cleanupActiveView = () => {};

/** Redirige a Login cuando no existe una sesión válida. */
const redirectToLogin = () => window.location.replace(new URL('../index.html', import.meta.url));

/** Devuelve el identificador de vista almacenado en el historial o Dashboard por defecto. */
const getHistoryView = () => window.history.state?.viewId && viewRegistry[window.history.state.viewId]
  ? window.history.state.viewId
  : 'dashboard';

/** Carga el CSS exclusivo de una vista una sola vez. */
const loadViewStylesheet = (view) => {
  if (!view.stylesheet || document.querySelector(`link[data-view-stylesheet="${view.stylesheet.href}"]`)) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = view.stylesheet.href;
  stylesheet.dataset.viewStylesheet = view.stylesheet.href;
  document.head.append(stylesheet);
};

/** Sustituye el contenido central sin recargar Layout ni cambiar la URL privada principal. */
const navigateTo = async (viewId, shouldUpdateHistory = true) => {
  const view = viewRegistry[viewId];
  if (!view) return;

  if (!hasPermission(currentUserContext, view.permission)) {
    if (viewId !== 'dashboard') await navigateTo('dashboard', shouldUpdateHistory);
    return;
  }

  if (shouldUpdateHistory && viewId === activeView) {
    setActiveView(viewId);
    return;
  }

  cleanupActiveView();
  cleanupActiveView = () => {};
  await loadView(view.url);
  loadViewStylesheet(view);
  activeView = viewId;
  setActiveView(viewId);
  cleanupActiveView = await view.initialize?.(currentUserContext) || (() => {});

  if (shouldUpdateHistory) {
    window.history.pushState({ viewId }, '', dashboardUrl.pathname);
  }
};

/** Registra los eventos globales de navegación y Sidebar una sola vez. */
const initializeGlobalEvents = () => {
  document.addEventListener('keydown', (event) => {
    const sidebar = document.querySelector('.app-sidebar');
    const toggleButton = document.querySelector('#sidebar-toggle');
    if (event.key === 'Escape' && sidebar?.classList.contains('is-open')) toggleButton.click();
  });

  window.addEventListener('popstate', async () => navigateTo(getHistoryView(), false));
};

/** Construye la aplicación privada tras confirmar la autenticación con Supabase. */
const initializeApp = async () => {
  try {
    currentUserContext = await getUserContext();
    if (!currentUserContext) {
      await supabase.auth.signOut();
      redirectToLogin();
      return;
    }

    const viewTemplate = document.querySelector('#view-template');
    await loadLayout(viewTemplate);
    initializeTopbar(currentUserContext);
    initializeSidebar(navigateTo, (permission) => hasPermission(currentUserContext, permission));
    setFooterMetadata(APP_NAME, APP_VERSION);
    activeView = '';
    await navigateTo(currentUserContext.profile.rol_id === '3' ? 'consultas' : getHistoryView(), false);
    initializeGlobalEvents();
  } catch (error) {
    console.error('No fue posible inicializar la aplicación:', error);
    redirectToLogin();
  }
};

initializeApp();
