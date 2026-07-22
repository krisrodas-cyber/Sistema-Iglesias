/** Carga el Layout común y sus componentes mediante Fetch API. */

/**
 * Obtiene un fragmento HTML reutilizable desde el directorio components.
 *
 * @param {string} componentName Nombre del archivo del componente.
 * @returns {Promise<string>} HTML del componente solicitado.
 */
const fetchComponent = async (componentName) => {
  const componentUrl = new URL(`../components/${componentName}`, import.meta.url);
  const response = await fetch(componentUrl);

  if (!response.ok) {
    throw new Error(`No fue posible cargar el componente ${componentName}.`);
  }

  return response.text();
};

/**
 * Carga los estilos específicos declarados por una vista sin duplicarlos.
 *
 * @param {Document} viewDocument Documento HTML de la vista solicitada.
 * @param {URL} viewUrl URL final de la vista solicitada.
 */
const loadViewStyles = (viewDocument, viewUrl) => {
  viewDocument.querySelectorAll('link[rel="stylesheet"]').forEach((stylesheet) => {
    const stylesheetUrl = new URL(stylesheet.getAttribute('href'), viewUrl).href;

    const stylesheetExists = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .some((existingLink) => new URL(existingLink.getAttribute('href'), document.baseURI).href === stylesheetUrl);

    if (!stylesheetExists) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = stylesheetUrl;
      link.dataset.viewStylesheet = stylesheetUrl;
      document.head.append(link);
    }
  });
};

/**
 * Carga una vista y sustituye únicamente el área principal del Layout existente.
 *
 * @param {URL} viewUrl URL de la vista a cargar.
 * @returns {Promise<void>} Finaliza al actualizar el contenido principal.
 */
export const loadView = async (viewUrl) => {
  const response = await fetch(viewUrl);

  if (!response.ok) {
    throw new Error(`No fue posible cargar la vista ${viewUrl.pathname}.`);
  }

  const viewDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
  const viewTemplate = viewDocument.querySelector('#view-template');

  if (!viewTemplate) {
    throw new Error(`La vista ${viewUrl.pathname} no contiene contenido válido.`);
  }

  loadViewStyles(viewDocument, viewUrl);
  document.querySelectorAll('[data-view-overlay]').forEach((overlay) => overlay.remove());
  if (viewDocument.title) {
    document.title = viewDocument.title;
  }
  document.querySelector('#app-content').replaceChildren(viewTemplate.content.cloneNode(true));
};

/**
 * Inserta el Layout y las piezas reutilizables alrededor del contenido de una vista.
 *
 * @param {HTMLTemplateElement} viewTemplate Template que contiene la vista actual.
 * @returns {Promise<void>} Finaliza al montar todos los componentes.
 */
export const loadLayout = async (viewTemplate) => {
  const appRoot = document.querySelector('#app');
  const [layoutMarkup, sidebarMarkup, topbarMarkup, footerMarkup] = await Promise.all([
    fetchComponent('layout.html'),
    fetchComponent('sidebar.html'),
    fetchComponent('topbar.html'),
    fetchComponent('footer.html'),
  ]);

  appRoot.innerHTML = layoutMarkup;
  document.querySelector('#sidebar-container').innerHTML = sidebarMarkup;
  document.querySelector('#topbar-container').innerHTML = topbarMarkup;
  document.querySelector('#footer-container').innerHTML = footerMarkup;
  document.querySelector('#app-content').append(viewTemplate.content.cloneNode(true));
};
