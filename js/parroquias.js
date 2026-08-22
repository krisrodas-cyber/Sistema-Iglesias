/** CRUD de parroquias, filtros y permisos de interfaz sobre Supabase. */
import { hasPermission, supabase } from './auth.js';

const PAGE_SIZE = 10;
const DEFAULT_DEPARTMENT = 'Quetzaltenango';
const PARISH_FIELDS = [
  ['Identificador', 'id'], ['Código', 'codigo'], ['Nombre', 'nombre'], ['Patrono', 'patrono'], ['Dirección', 'direccion'],
  ['Municipio', 'municipio'], ['Departamento', 'departamento'], ['Decanato', 'decanato'], ['Teléfono', 'telefono'], ['Correo', 'correo'],
  ['Fecha de fundación', 'fecha_fundacion'], ['Estado', 'estado'], ['Observaciones', 'observaciones'],
  ['Fecha de registro', 'created_at'], ['Última actualización', 'updated_at'], ['Creado por', 'creado_por'], ['Actualizado por', 'actualizado_por'],
];

let parishes = [];
let deaneries = [];
let currentPage = 1;
let editingParishId = null;
let pendingStatusChange = null;
let userContext;
let elements;
let formModal;
let detailModal;
let statusModal;
let toast;
let eventController;

/** Mueve los overlays al documento para que Bootstrap controle correctamente su apilamiento. */
const mountOverlays = () => {
  const overlays = [
    document.querySelector('#parish-modal'),
    document.querySelector('#parish-detail-modal'),
    document.querySelector('#parish-status-modal'),
    document.querySelector('#parish-toast')?.closest('.toast-container'),
  ].filter(Boolean);

  overlays.forEach((overlay) => {
    overlay.dataset.viewOverlay = 'parroquias';
    document.body.append(overlay);
  });
};

/** Inserta el selector de catálogo sin alterar los identificadores técnicos del formulario. */
const ensureDeaneryField = () => {
  if (document.querySelector('#parish-deanery')) return;
  const departmentField = document.querySelector('#parish-department')?.closest('.col-md-6');
  if (!departmentField) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'col-md-6';
  const label = document.createElement('label');
  label.className = 'form-label'; label.htmlFor = 'parish-deanery'; label.textContent = 'Decanato *';
  const select = document.createElement('select');
  select.id = 'parish-deanery'; select.name = 'decanato_id'; select.className = 'form-select'; select.required = true;
  select.append(new Option('Seleccione un decanato', ''));
  wrapper.append(label, select);
  departmentField.before(wrapper);
};

/** Devuelve los componentes Bootstrap globales cargados una única vez por Dashboard. */
const getBootstrap = () => {
  if (!window.bootstrap?.Modal || !window.bootstrap?.Toast) {
    throw new Error('Bootstrap JavaScript no está disponible.');
  }
  return window.bootstrap;
};

/** Obtiene y almacena las referencias DOM del módulo ya montado. */
const cacheElements = () => ({
  form: document.querySelector('#parish-form'), codeInput: document.querySelector('#parish-code'), deaneryInput: document.querySelector('#parish-deanery'), searchInput: document.querySelector('#parish-search'), deaneryFilter: document.querySelector('#parish-deanery-filter'), municipalityFilter: document.querySelector('#parish-municipality-filter'), statusFilter: document.querySelector('#parish-status-filter'), tableBody: document.querySelector('#parish-table-body'), tableWrapper: document.querySelector('#parish-table-wrapper'), loader: document.querySelector('#parish-loader'), emptyState: document.querySelector('#parish-empty-state'), emptyMessage: document.querySelector('#parish-empty-state p'), pagination: document.querySelector('#parish-pagination'), count: document.querySelector('#parish-count'), errorAlert: document.querySelector('#parish-error'), saveButton: document.querySelector('#save-parish-button'), formTitle: document.querySelector('#parish-modal-title'), detailContent: document.querySelector('#parish-detail-content'), statusTitle: document.querySelector('#parish-status-title'), statusMessage: document.querySelector('#parish-status-message'), confirmStatusButton: document.querySelector('#confirm-parish-status-button'), toastMessage: document.querySelector('#parish-toast-message'), toastIcon: document.querySelector('#parish-toast-icon'),
});

/** Convierte valores vacíos en null para no enviar cadenas sin contenido a Supabase. */
const getOptionalValue = (value) => value.trim() || null;

/** Formatea fechas de base de datos de forma legible y segura. */
const formatDate = (value, includeTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-GT', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
};

/** Muestra un error visible sin ocultar innecesariamente el contenido existente. */
const showError = (message) => {
  elements.errorAlert.textContent = message;
  elements.errorAlert.classList.remove('d-none');
};

/** Oculta el mensaje de error visible del módulo. */
const hideError = () => {
  elements.errorAlert.textContent = '';
  elements.errorAlert.classList.add('d-none');
};

/** Presenta confirmaciones y errores de operaciones mediante Toast Bootstrap. */
const showToast = (message, isSuccess = true) => {
  elements.toastMessage.textContent = message;
  elements.toastIcon.className = `bi ${isSuccess ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill'}`;
  toast.show();
};

/** Traduce errores conocidos de Supabase a mensajes útiles para la interfaz. */
const getDatabaseErrorMessage = (error) => {
  if (error?.code === '23505') return 'No fue posible generar un código único para la parroquia. Intente nuevamente.';
  if (error?.code === '42501') return 'No cuenta con permisos para realizar esta operación.';
  if (error?.name === 'AbortError') return 'La consulta tardó demasiado. Verifique su conexión e intente nuevamente.';
  if (error instanceof TypeError) return 'No fue posible conectar con el servidor. Intente nuevamente.';
  return 'No fue posible completar la operación. Intente nuevamente.';
};

/** Genera el payload permitido, excluyendo las columnas administradas por PostgreSQL. */
const buildPayload = () => {
  const formData = new FormData(elements.form);
  return {

    nombre: formData.get('nombre').trim(),
    patrono: getOptionalValue(formData.get('patrono')),
    direccion: getOptionalValue(formData.get('direccion')),
    municipio: formData.get('municipio').trim(),
    departamento: formData.get('departamento').trim(),
    telefono: getOptionalValue(formData.get('telefono')),
    correo: getOptionalValue(formData.get('correo')),
    fecha_fundacion: formData.get('fecha_fundacion') || null,
    decanato_id: formData.get('decanato_id') ? Number(formData.get('decanato_id')) : null,
    observaciones: getOptionalValue(formData.get('observaciones')),
    estado: formData.get('estado') === 'true',
  };
};

/** Devuelve un mensaje claro para la primera validación del formulario que falle. */
/** Alterna entre el aviso de creación y el código generado de solo lectura. */
const setCodePresentation = (codigo = null) => {
  const hasCode = Boolean(codigo);
  elements.codeInput.value = codigo ?? '';
  elements.codeInput.classList.toggle('d-none', !hasCode);
  document.querySelector('#parish-code-auto-note').classList.toggle('d-none', hasCode);
};

const getFormValidationMessage = () => {
  const email = elements.form.elements.correo;
  if (email.value && !email.validity.valid) return 'Ingrese un correo electrónico válido.';
  return 'Complete los campos obligatorios para continuar.';
};

/** Devuelve los registros que cumplen simultáneamente la búsqueda y filtros actuales. */
const getFilteredParishes = () => {
  const query = elements.searchInput.value.trim().toLocaleLowerCase('es');
  const municipality = elements.municipalityFilter.value;
  const deanery = elements.deaneryFilter.value;
  const status = elements.statusFilter.value;
  return parishes.filter((parish) => {
    const searchableValues = [parish.codigo, parish.nombre, parish.patrono, parish.municipio, parish.decanato, parish.decanato_codigo];
    const matchesQuery = searchableValues.some((value) => value?.trim().toLocaleLowerCase('es').includes(query));
    const matchesMunicipality = !municipality || parish.municipio === municipality;
    const matchesDeanery = !deanery || (deanery === '__unassigned__' ? !parish.decanato_id : String(parish.decanato_id) === deanery);
    const matchesStatus = status === '' || String(parish.estado) === status;
    return matchesQuery && matchesDeanery && matchesMunicipality && matchesStatus;
  });
};

/** Crea un botón de acción para una fila sin interpolar valores externos en HTML. */
const createActionButton = (icon, label, modifier, handler) => {
  const button = document.createElement('button');
  const iconElement = document.createElement('i');
  button.className = `btn parish-action-button${modifier ? ` ${modifier}` : ''}`;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  iconElement.className = `bi ${icon}`;
  iconElement.setAttribute('aria-hidden', 'true');
  button.append(iconElement);
  button.addEventListener('click', handler);
  return button;
};

/** Inserta la fila de una parroquia y sus acciones permitidas por el rol. */
const appendParishRow = (parish) => {
  const row = document.createElement('tr');
  const values = [parish.codigo, parish.nombre, parish.patrono || '—', parish.decanato || 'Sin asignar', parish.municipio, parish.telefono || '—'];
  values.forEach((value, index) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (index === 1) cell.className = 'parish-table__name';
    row.append(cell);
  });

  const statusCell = document.createElement('td');
  const statusBadge = document.createElement('span');
  statusBadge.className = `parish-status ${parish.estado ? 'parish-status--active' : 'parish-status--inactive'}`;
  statusBadge.textContent = parish.estado ? 'Activa' : 'Inactiva';
  statusCell.append(statusBadge);
  row.append(statusCell);

  const actionsCell = document.createElement('td');
  const actions = document.createElement('div');
  actions.className = 'parish-actions';
  actions.append(createActionButton('bi-eye', `Ver ${parish.nombre}`, '', () => openDetails(parish)));

  if (hasPermission(userContext, 'parishes.update')) {
    actions.append(createActionButton('bi-pencil', `Editar ${parish.nombre}`, '', () => openEditForm(parish)));
    actions.append(createActionButton(parish.estado ? 'bi-pause-circle' : 'bi-play-circle', parish.estado ? `Inactivar ${parish.nombre}` : `Reactivar ${parish.nombre}`, parish.estado ? 'parish-action-button--warning' : '', () => openStatusConfirmation(parish)));
  }

  actionsCell.append(actions);
  row.append(actionsCell);
  elements.tableBody.append(row);
};

/** Dibuja la tabla, el estado vacío, contador y paginación del lado del cliente. */
const renderTable = () => {
  const filteredParishes = getFilteredParishes();
  const totalPages = Math.max(1, Math.ceil(filteredParishes.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visibleParishes = filteredParishes.slice(start, start + PAGE_SIZE);
  elements.count.textContent = `${filteredParishes.length} ${filteredParishes.length === 1 ? 'registro' : 'registros'}`;
  elements.tableBody.replaceChildren();
  visibleParishes.forEach(appendParishRow);
  elements.tableWrapper.classList.toggle('d-none', filteredParishes.length === 0);
  elements.emptyState.classList.toggle('d-none', filteredParishes.length > 0);
  renderPagination(totalPages);
};

/** Dibuja los controles de paginación sin volver a consultar la base de datos. */
const renderPagination = (totalPages) => {
  elements.pagination.replaceChildren();
  elements.pagination.classList.toggle('d-none', totalPages <= 1);
  for (let page = 1; page <= totalPages; page += 1) {
    const button = document.createElement('button');
    button.className = `parish-pagination__button${page === currentPage ? ' is-active' : ''}`;
    button.type = 'button';
    button.textContent = String(page);
    button.addEventListener('click', () => { currentPage = page; renderTable(); });
    elements.pagination.append(button);
  }
};

/** Actualiza las opciones de municipio a partir de los datos recuperados. */
const populateMunicipalities = () => {
  const selectedValue = elements.municipalityFilter.value;
  const municipalities = [...new Set(parishes.map((parish) => parish.municipio).filter(Boolean))].sort((first, second) => first.localeCompare(second, 'es'));
  elements.municipalityFilter.replaceChildren(new Option('Todos los municipios', ''));
  municipalities.forEach((municipality) => elements.municipalityFilter.add(new Option(municipality, municipality)));
  elements.municipalityFilter.value = selectedValue;
};

/** Carga el catálogo activo de decanatos para formulario y filtro local. */
const loadDeaneries = async () => {
  const { data, error } = await supabase.from('decanatos').select('id, codigo, nombre').eq('activo', true).order('nombre', { ascending: true });
  if (error) throw error;
  deaneries = data ?? [];
  const selectedFormValue = elements.deaneryInput.value;
  const selectedFilterValue = elements.deaneryFilter.value;
  elements.deaneryInput.replaceChildren(new Option('Seleccione un decanato', ''));
  elements.deaneryFilter.replaceChildren(new Option('Todos los decanatos', ''), new Option('Sin decanato asignado', '__unassigned__'));
  deaneries.forEach((deanery) => {
    const label = `${deanery.codigo} · ${deanery.nombre}`;
    elements.deaneryInput.add(new Option(label, String(deanery.id)));
    elements.deaneryFilter.add(new Option(label, String(deanery.id)));
  });
  elements.deaneryInput.value = selectedFormValue;
  elements.deaneryFilter.value = selectedFilterValue;
};

/** Consulta todas las parroquias autorizadas por RLS y actualiza la vista. */
const fetchParishes = async () => {
  elements.loader.classList.remove('d-none');
  elements.tableWrapper.classList.add('d-none');
  elements.emptyState.classList.add('d-none');
  hideError();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const [{ data, error }] = await Promise.all([supabase.from('parroquias').select('*, decanatos(codigo, nombre)').order('nombre', { ascending: true }).abortSignal(controller.signal), loadDeaneries()]);
    if (error) throw error;
    parishes = (data ?? []).map((parish) => ({ ...parish, decanato: parish.decanato ?? parish.decanatos?.nombre ?? null, decanato_codigo: parish.decanato_codigo ?? parish.decanatos?.codigo ?? null }));
    currentPage = 1;
    populateMunicipalities();
    renderTable();
  } catch (error) {
    console.error('No fue posible consultar las parroquias:', error);
    parishes = [];
    elements.emptyMessage.textContent = 'No fue posible cargar las parroquias.';
    elements.emptyState.classList.remove('d-none');
    showError(getDatabaseErrorMessage(error));
  } finally {
    window.clearTimeout(timeout);
    elements.loader.classList.add('d-none');
  }
};

/** Restablece el formulario y configura los valores predeterminados para un nuevo registro. */
const resetForm = () => {
  editingParishId = null;
  elements.form.reset();
  elements.form.classList.remove('was-validated');
  elements.form.elements.departamento.value = DEFAULT_DEPARTMENT;
  elements.form.elements.estado.value = 'true';
  elements.formTitle.textContent = 'Nueva parroquia';
  elements.saveButton.querySelector('span').textContent = 'Guardar';
  setCodePresentation();
};

/** Abre el formulario en modo creación si el rol tiene permiso de registrar. */
const openNewForm = () => {
  if (!hasPermission(userContext, 'parishes.create')) {
    showToast('No cuenta con permisos para registrar parroquias.', false);
    return;
  }
  resetForm();
  formModal.show();
};

/** Precarga el formulario para editar una parroquia existente. */
const openEditForm = (parish) => {
  if (!hasPermission(userContext, 'parishes.update')) {
    showToast('Acceso no autorizado.', false);
    return;
  }
  editingParishId = parish.id;
  elements.form.reset();
  Object.entries(parish).forEach(([key, value]) => {
    const field = elements.form.elements.namedItem(key);
    if (field) field.value = key === 'estado' ? String(value) : value ?? '';
  });
  elements.form.classList.remove('was-validated');
  elements.formTitle.textContent = 'Editar parroquia';
  elements.saveButton.querySelector('span').textContent = 'Guardar cambios';
  setCodePresentation(parish.codigo);
  formModal.show();
};

/** Muestra todos los datos de una parroquia en un modal de solo lectura. */
const openDetails = (parish) => {
  elements.detailContent.replaceChildren();
  const grid = document.createElement('dl');
  grid.className = 'parish-details__grid';
  PARISH_FIELDS.forEach(([label, key]) => {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = key === 'decanato' ? (parish.decanato ? `${parish.decanato_codigo ? `${parish.decanato_codigo} · ` : ''}${parish.decanato}` : 'Sin decanato asignado') : key === 'estado' ? (parish.estado ? 'Activa' : 'Inactiva') : (key.includes('_at') ? formatDate(parish[key], true) : key === 'fecha_fundacion' ? formatDate(parish[key]) : parish[key] || '—');
    grid.append(term, description);
  });
  elements.detailContent.append(grid);
  detailModal.show();
};

/** Solicita confirmación antes de inactivar o reactivar una parroquia. */
const openStatusConfirmation = (parish) => {
  if (!hasPermission(userContext, 'parishes.update')) {
    showToast('Acceso no autorizado.', false);
    return;
  }
  pendingStatusChange = { id: parish.id, estado: !parish.estado };
  const action = parish.estado ? 'Inactivar' : 'Reactivar';
  elements.statusTitle.textContent = `${action} parroquia`;
  elements.statusMessage.textContent = `¿Desea ${action.toLowerCase()} la parroquia “${parish.nombre}”?`;
  elements.confirmStatusButton.querySelector('span').textContent = action;
  statusModal.show();
};

/** Inserta o actualiza una parroquia con filtro obligatorio por id al editar. */
const saveParish = async (event) => {
  event.preventDefault();
  if (!hasPermission(userContext, editingParishId ? 'parishes.update' : 'parishes.create')) {
    showToast('Acceso no autorizado.', false);
    return;
  }
  if (!elements.form.checkValidity()) {
    elements.form.classList.add('was-validated');
    showError(getFormValidationMessage());
    return;
  }
  hideError();
  const payload = buildPayload();
  const isEditing = Boolean(editingParishId);
  elements.saveButton.disabled = true;
  elements.saveButton.querySelector('.spinner-border').classList.remove('d-none');
  try {
    const query = isEditing
      ? supabase.from('parroquias').update(payload).eq('id', editingParishId).select().single()
      : supabase.from('parroquias').insert(payload).select().single();
    const { data, error } = await query;
    if (error) throw error;
    formModal.hide();
    resetForm();
    await fetchParishes();
    showToast(isEditing ? 'Parroquia actualizada correctamente.' : `Parroquia ${data.codigo} registrada correctamente.`);
  } catch (error) {
    console.error('No fue posible guardar la parroquia:', error);
    showError(getDatabaseErrorMessage(error));
    showToast(getDatabaseErrorMessage(error), false);
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.querySelector('.spinner-border').classList.add('d-none');
  }
};

/** Actualiza únicamente el estado de una parroquia después de la confirmación. */
const changeParishStatus = async () => {
  if (!pendingStatusChange || !hasPermission(userContext, 'parishes.update')) {
    showToast('Acceso no autorizado.', false);
    return;
  }
  elements.confirmStatusButton.disabled = true;
  elements.confirmStatusButton.querySelector('.spinner-border').classList.remove('d-none');
  try {
    const { error } = await supabase.from('parroquias').update({ estado: pendingStatusChange.estado }).eq('id', pendingStatusChange.id).select().single();
    if (error) throw error;
    statusModal.hide();
    await fetchParishes();
    showToast(pendingStatusChange.estado ? 'Parroquia reactivada correctamente.' : 'Parroquia inactivada correctamente.');
  } catch (error) {
    console.error('No fue posible actualizar el estado:', error);
    showError(getDatabaseErrorMessage(error));
    showToast(getDatabaseErrorMessage(error), false);
  } finally {
    pendingStatusChange = null;
    elements.confirmStatusButton.disabled = false;
    elements.confirmStatusButton.querySelector('.spinner-border').classList.add('d-none');
  }
};

/** Inicializa eventos, permisos y consulta inicial del módulo de Parroquias. */
export async function initParroquias(context) {
  if (!context || !hasPermission(context, 'parishes.view')) return;
  destroyParroquias();
  userContext = context;
  mountOverlays();
  ensureDeaneryField();
  elements = cacheElements();
  const bootstrap = getBootstrap();
  const modalElement = document.getElementById('parish-modal');
  formModal = bootstrap.Modal.getOrCreateInstance(modalElement);
  detailModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('parish-detail-modal'));
  statusModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('parish-status-modal'));
  toast = bootstrap.Toast.getOrCreateInstance(document.getElementById('parish-toast'));
  eventController = new AbortController();
  const eventOptions = { signal: eventController.signal };
  document.querySelector('#new-parish-button').hidden = !hasPermission(userContext, 'parishes.create');
  document.querySelector('#new-parish-button').addEventListener('click', openNewForm, eventOptions);
  elements.form.addEventListener('submit', saveParish, eventOptions);

  elements.searchInput.addEventListener('input', () => { currentPage = 1; renderTable(); }, eventOptions);
  [elements.deaneryFilter, elements.municipalityFilter, elements.statusFilter].forEach((control) => control.addEventListener('change', () => { currentPage = 1; renderTable(); }, eventOptions));
  elements.confirmStatusButton.addEventListener('click', changeParishStatus, eventOptions);
  if (userContext.role?.nombre === 'Secretario' && !userContext.profile?.parroquia_id) {
    elements.loader.classList.add('d-none');
    elements.emptyMessage.textContent = 'Su usuario no tiene una parroquia asignada. Contacte al Administrador.';
    elements.emptyState.classList.remove('d-none');
    showError('Su usuario no tiene una parroquia asignada. Contacte al Administrador.');
    return;
  }
  await fetchParishes();
}

/** Libera eventos, instancias Bootstrap y overlays antes de cambiar de vista. */
export const destroyParroquias = () => {
  eventController?.abort();
  eventController = null;
  formModal?.dispose();
  detailModal?.dispose();
  statusModal?.dispose();
  toast?.dispose();
  formModal = null;
  detailModal = null;
  statusModal = null;
  toast = null;
  document.querySelectorAll('[data-view-overlay="parroquias"]').forEach((overlay) => overlay.remove());
};
