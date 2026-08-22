/** CRUD, filtros y permisos de interfaz para el módulo de Sacerdotes. */
import { hasPermission, supabase } from './auth.js';

const PAGE_SIZE = 10;
const DEFAULT_NATIONALITY = 'Guatemalteca';
const DETAIL_FIELDS = [
  ['Código', 'codigo'], ['Nombre completo', 'fullName'], ['Nombre religioso', 'nombre_religioso'], ['Fecha de nacimiento', 'fecha_nacimiento'], ['Fecha de ordenación', 'fecha_ordenacion'], ['Tipo de clero', 'tipo_clero'], ['Congregación', 'congregacion'], ['Teléfono', 'telefono'], ['Correo', 'correo'], ['Dirección', 'direccion'], ['Nacionalidad', 'nacionalidad'], ['Estado ministerial', 'estado_ministerial'], ['Estado del registro', 'activo'], ['Observaciones', 'observaciones'], ['Fecha de registro', 'created_at'], ['Última actualización', 'updated_at'],
];

let priests = [];
let currentPage = 1;
let editingPriestId = null;
let pendingStatusChange = null;
let userContext;
let elements;
let formModal;
let detailModal;
let statusModal;
let toast;
let eventController;
let selectedPhoto = null;
let previewObjectUrl = null;
const signedPhotoUrls = new Map();
const PHOTO_BUCKET = 'sacerdotes-fotos';
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

/** Inserta el bloque de fotografía sin duplicar el formulario dinámico. */
const ensurePhotoField = () => {
  if (document.querySelector('#priest-photo')) return;
  const notes = document.querySelector('#priest-notes')?.closest('.col-12'); if (!notes) return;
  const group = document.createElement('section'); group.className = 'col-12 priest-photo-field';
  group.innerHTML = '<label class="form-label" for="priest-photo">Fotografía del sacerdote</label><div class="priest-photo-editor"><div id="priest-photo-preview" class="priest-photo priest-photo--placeholder"><i class="bi bi-person-circle" aria-hidden="true"></i></div><div><input id="priest-photo" class="form-control" type="file" accept="image/jpeg,image/png,image/webp"><p class="form-text mb-0">JPG, PNG o WEBP · Máximo 5 MB</p><button id="remove-priest-photo" class="btn btn-link p-0 mt-2 d-none" type="button">Eliminar fotografía</button></div></div>';
  notes.before(group);
};

const clearPreview = () => { if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; selectedPhoto = null; };
const photoExtension = (file) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]);
const signedPhotoUrl = async (path) => { if (!path) return null; if (signedPhotoUrls.has(path)) return signedPhotoUrls.get(path); const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600); if (error) throw error; signedPhotoUrls.set(path, data.signedUrl); return data.signedUrl; };
const renderPhoto = async (target, path) => { target.replaceChildren(); target.className = 'priest-photo priest-photo--placeholder'; if (!path) { target.append(Object.assign(document.createElement('i'), { className: 'bi bi-person-circle' })); return; } try { const image = document.createElement('img'); image.src = await signedPhotoUrl(path); image.alt = 'Fotografía del sacerdote'; image.onerror = () => { signedPhotoUrls.delete(path); target.replaceChildren(Object.assign(document.createElement('i'), { className: 'bi bi-person-circle' })); }; target.className = 'priest-photo'; target.append(image); } catch (error) { console.error('No fue posible generar la URL firmada de la fotografía:', error); target.append(Object.assign(document.createElement('i'), { className: 'bi bi-person-circle' })); } };

/** Devuelve los componentes Bootstrap disponibles desde la página privada principal. */
const getBootstrap = () => {
  if (!window.bootstrap?.Modal || !window.bootstrap?.Toast) throw new Error('Bootstrap JavaScript no está disponible.');
  return window.bootstrap;
};

/** Lleva los overlays fuera del área reemplazable del Layout para conservar el apilamiento Bootstrap. */
const mountOverlays = () => {
  [document.querySelector('#priest-modal'), document.querySelector('#priest-detail-modal'), document.querySelector('#priest-status-modal'), document.querySelector('#priest-toast')?.closest('.toast-container')]
    .filter(Boolean)
    .forEach((overlay) => { overlay.dataset.viewOverlay = 'sacerdotes'; document.body.append(overlay); });
};

/** Almacena las referencias del DOM una vez que la plantilla dinámica existe. */
const cacheElements = () => ({
  form: document.querySelector('#priest-form'), code: document.querySelector('#priest-code'), photo: document.querySelector('#priest-photo'), photoPreview: document.querySelector('#priest-photo-preview'), removePhoto: document.querySelector('#remove-priest-photo'), clergyType: document.querySelector('#priest-clergy-type'), congregationGroup: document.querySelector('#priest-congregation-group'), congregation: document.querySelector('#priest-congregation'), birthDate: document.querySelector('#priest-birth-date'), ordinationDate: document.querySelector('#priest-ordination-date'), search: document.querySelector('#priest-search'), clergyFilter: document.querySelector('#priest-clergy-filter'), ministryFilter: document.querySelector('#priest-ministry-filter'), recordFilter: document.querySelector('#priest-record-filter'), table: document.querySelector('#priest-table-body'), wrapper: document.querySelector('#priest-table-wrapper'), loader: document.querySelector('#priest-loader'), empty: document.querySelector('#priest-empty-state'), emptyMessage: document.querySelector('#priest-empty-state p'), count: document.querySelector('#priest-count'), pagination: document.querySelector('#priest-pagination'), error: document.querySelector('#priest-error'), title: document.querySelector('#priest-modal-title'), save: document.querySelector('#save-priest-button'), detail: document.querySelector('#priest-detail-content'), statusTitle: document.querySelector('#priest-status-title'), statusMessage: document.querySelector('#priest-status-message'), confirmStatus: document.querySelector('#confirm-priest-status-button'), toastMessage: document.querySelector('#priest-toast-message'), toastIcon: document.querySelector('#priest-toast-icon'),
});

/** Convierte entradas opcionales vacías a null antes de enviarlas a Supabase. */
const optional = (value) => value.trim() || null;

/** Formatea una fecha de base de datos para la interfaz. */
const formatDate = (value, includeTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-GT', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
};

/** Devuelve el nombre completo de un sacerdote sin interpolar HTML externo. */
const fullName = (priest) => [priest.nombres, priest.apellidos].filter(Boolean).join(' ') || '—';

/** Muestra u oculta el campo Congregación de acuerdo con el tipo de clero. */
const syncCongregation = () => {
  const isReligious = elements.clergyType.value === 'Religioso';
  elements.congregationGroup.classList.toggle('d-none', !isReligious);
  if (!isReligious) elements.congregation.value = '';
};

/** Muestra un error Bootstrap visible en el módulo. */
const showError = (message) => { elements.error.textContent = message; elements.error.classList.remove('d-none'); };
/** Oculta el error Bootstrap visible del módulo. */
const hideError = () => { elements.error.textContent = ''; elements.error.classList.add('d-none'); };
/** Muestra una confirmación o error con Toast Bootstrap. */
const showToast = (message, success = true) => { elements.toastMessage.textContent = message; elements.toastIcon.className = `bi ${success ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill'}`; toast.show(); };

/** Traduce errores frecuentes de Supabase a mensajes seguros para el usuario. */
const databaseMessage = (error) => {
  if (error?.code === '23505') return 'No fue posible generar un código único para el sacerdote. Intente nuevamente.';
  if (error?.code === '42501') return 'No cuenta con permisos para realizar esta operación.';
  if (error?.name === 'AbortError') return 'La consulta tardó demasiado. Verifique su conexión e intente nuevamente.';
  if (error instanceof TypeError) return 'No fue posible conectar con el servidor. Intente nuevamente.';
  return 'No fue posible completar la operación. Intente nuevamente.';
};

/** Construye solo las columnas permitidas para inserción o actualización. */
const buildPayload = () => {
  const data = new FormData(elements.form);
  const religious = data.get('tipo_clero') === 'Religioso';
  return { nombres: data.get('nombres').trim(), apellidos: data.get('apellidos').trim(), nombre_religioso: optional(data.get('nombre_religioso')), fecha_nacimiento: data.get('fecha_nacimiento') || null, fecha_ordenacion: data.get('fecha_ordenacion') || null, tipo_clero: data.get('tipo_clero'), congregacion: religious ? optional(data.get('congregacion')) : null, telefono: optional(data.get('telefono')), correo: optional(data.get('correo')), direccion: optional(data.get('direccion')), nacionalidad: optional(data.get('nacionalidad')), estado_ministerial: data.get('estado_ministerial'), observaciones: optional(data.get('observaciones')), activo: data.get('activo') === 'true' };
};

/** Valida los campos nativos y la relación entre las fechas del formulario. */
const validateForm = () => {
  if (!elements.form.checkValidity()) return 'Complete los campos obligatorios y revise el correo electrónico.';
  if (elements.birthDate.value && elements.ordinationDate.value && elements.ordinationDate.value < elements.birthDate.value) return 'La fecha de ordenación no puede ser anterior a la fecha de nacimiento.';
  return null;
};

/** Valida y previsualiza la fotografía elegida sin iniciar ninguna subida. */
const handlePhotoSelection = () => { const file = elements.photo.files?.[0]; if (!file) return; if (!ALLOWED_PHOTO_TYPES.has(file.type)) { elements.photo.value = ''; showError('Seleccione una imagen JPG, PNG o WEBP.'); return; } if (file.size > MAX_PHOTO_SIZE) { elements.photo.value = ''; showError('La fotografía no puede superar 5 MB.'); return; } clearPreview(); selectedPhoto = file; previewObjectUrl = URL.createObjectURL(file); const image = document.createElement('img'); image.src = previewObjectUrl; image.alt = 'Vista previa de la fotografía'; elements.photoPreview.className = 'priest-photo'; elements.photoPreview.replaceChildren(image); };
const uploadPhoto = async (priestId, previousPath = null) => { if (!selectedPhoto) return previousPath; const path = `${priestId}/perfil.${photoExtension(selectedPhoto)}`; const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, selectedPhoto, { upsert: true, contentType: selectedPhoto.type }); if (error) throw error; if (previousPath && previousPath !== path) await supabase.storage.from(PHOTO_BUCKET).remove([previousPath]); const { error: updateError } = await supabase.from('sacerdotes').update({ foto_path: path }).eq('id', priestId); if (updateError) throw updateError; return path; };

/** Filtra en memoria por texto, tipo de clero, estado ministerial y estado del registro. */
const filteredPriests = () => {
  const query = elements.search.value.trim().toLocaleLowerCase('es');
  return priests.filter((priest) => {
    const matchesText = [priest.codigo, priest.nombres, priest.apellidos, priest.nombre_religioso, priest.congregacion, priest.telefono, priest.correo].some((value) => value?.trim().toLocaleLowerCase('es').includes(query));
    return matchesText && (!elements.clergyFilter.value || priest.tipo_clero === elements.clergyFilter.value) && (!elements.ministryFilter.value || priest.estado_ministerial === elements.ministryFilter.value) && (elements.recordFilter.value === '' || String(priest.activo) === elements.recordFilter.value);
  });
};

/** Crea un botón de acción sin insertar valores de base de datos como HTML. */
const actionButton = (icon, label, modifier, handler) => {
  const button = document.createElement('button'); const image = document.createElement('i');
  button.className = `btn priest-action-button${modifier ? ` ${modifier}` : ''}`; button.type = 'button'; button.setAttribute('aria-label', label);
  image.className = `bi ${icon}`; image.setAttribute('aria-hidden', 'true'); button.append(image); button.addEventListener('click', handler); return button;
};

/** Inserta una fila y muestra exclusivamente las acciones permitidas al rol actual. */
const appendRow = (priest) => {
  const row = document.createElement('tr');
  [priest.codigo, priest.tipo_clero, priest.congregacion || '—', priest.telefono || '—'].forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }); const nameCell = document.createElement('td'); nameCell.className = 'priest-table__name priest-table__identity'; const thumbnail = document.createElement('span'); renderPhoto(thumbnail, priest.foto_path); nameCell.append(thumbnail, document.createTextNode(fullName(priest))); row.insertBefore(nameCell, row.children[1]);
  const ministry = document.createElement('td'); const ministryBadge = document.createElement('span'); ministryBadge.className = `priest-badge${priest.estado_ministerial === 'Activo' ? ' priest-badge--active' : priest.estado_ministerial === 'Suspendido' ? ' priest-badge--warning' : ''}`; ministryBadge.textContent = priest.estado_ministerial; ministry.append(ministryBadge); row.append(ministry);
  const record = document.createElement('td'); const recordBadge = document.createElement('span'); recordBadge.className = `priest-badge ${priest.activo ? 'priest-badge--active' : 'priest-badge--inactive'}`; recordBadge.textContent = priest.activo ? 'Activo' : 'Inactivo'; record.append(recordBadge); row.append(record);
  const actions = document.createElement('td'); const actionGroup = document.createElement('div'); actionGroup.className = 'priest-actions'; actionGroup.append(actionButton('bi-eye', `Ver ${fullName(priest)}`, '', () => openDetails(priest)));
  if (hasPermission(userContext, 'priests.update')) { actionGroup.append(actionButton('bi-pencil', `Editar ${fullName(priest)}`, '', () => openEdit(priest))); actionGroup.append(actionButton(priest.activo ? 'bi-pause-circle' : 'bi-play-circle', priest.activo ? `Inactivar ${fullName(priest)}` : `Reactivar ${fullName(priest)}`, priest.activo ? 'priest-action-button--warning' : '', () => openStatus(priest))); }
  actions.append(actionGroup); row.append(actions); elements.table.append(row);
};

/** Renderiza tabla, contador, estado vacío y paginación del lado del cliente. */
const renderTable = () => {
  const records = filteredPriests(); const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE)); currentPage = Math.min(currentPage, pages); const visible = records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  elements.count.textContent = `${records.length} ${records.length === 1 ? 'registro' : 'registros'}`; elements.table.replaceChildren(); visible.forEach(appendRow); elements.wrapper.classList.toggle('d-none', records.length === 0); elements.empty.classList.toggle('d-none', records.length > 0); elements.pagination.replaceChildren(); elements.pagination.classList.toggle('d-none', pages <= 1);
  for (let page = 1; page <= pages; page += 1) { const button = document.createElement('button'); button.className = `priest-pagination__button${page === currentPage ? ' is-active' : ''}`; button.type = 'button'; button.textContent = String(page); button.addEventListener('click', () => { currentPage = page; renderTable(); }); elements.pagination.append(button); }
};

/** Consulta los sacerdotes permitidos por RLS y garantiza la salida del loader. */
const fetchPriests = async () => {
  elements.loader.classList.remove('d-none'); elements.wrapper.classList.add('d-none'); elements.empty.classList.add('d-none'); hideError(); const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 15000);
  try { const { data, error } = await supabase.from('sacerdotes').select('*').order('apellidos', { ascending: true }).order('nombres', { ascending: true }).abortSignal(controller.signal); if (error) throw error; priests = data ?? []; currentPage = 1; renderTable(); }
  catch (error) { console.error('No fue posible consultar los sacerdotes:', error); priests = []; elements.emptyMessage.textContent = 'No fue posible cargar los sacerdotes.'; elements.empty.classList.remove('d-none'); showError(databaseMessage(error)); }
  finally { window.clearTimeout(timeout); elements.loader.classList.add('d-none'); }
};

/** Restablece el formulario para registrar un sacerdote nuevo. */
/** Alterna el aviso de creación y el código generado no editable. */
const setCodePresentation = (codigo = null) => { const hasCode = Boolean(codigo); elements.code.value = codigo ?? ''; elements.code.classList.toggle('d-none', !hasCode); document.querySelector('#priest-code-auto-note').classList.toggle('d-none', hasCode); };

const resetForm = () => { clearPreview(); editingPriestId = null; elements.form.reset(); elements.form.classList.remove('was-validated'); elements.photoPreview.replaceChildren(Object.assign(document.createElement('i'), { className: 'bi bi-person-circle', ariaHidden: 'true' })); elements.photoPreview.className = 'priest-photo priest-photo--placeholder'; elements.form.elements.tipo_clero.value = 'Diocesano'; elements.form.elements.nacionalidad.value = DEFAULT_NATIONALITY; elements.form.elements.estado_ministerial.value = 'Activo'; elements.form.elements.activo.value = 'true'; elements.title.textContent = 'Nuevo sacerdote'; elements.save.querySelector('span').textContent = 'Guardar'; syncCongregation(); setCodePresentation(); };

/** Abre el formulario en modo creación después de aplicar el permiso de interfaz. */
const openNew = () => { if (!hasPermission(userContext, 'priests.create')) return showToast('No cuenta con permisos para registrar sacerdotes.', false); resetForm(); formModal.show(); };
/** Precarga el formulario en modo edición para administradores. */
const openEdit = (priest) => { if (!hasPermission(userContext, 'priests.update')) return showToast('Acceso no autorizado.', false); editingPriestId = priest.id; elements.form.reset(); Object.entries(priest).forEach(([key, value]) => { const field = elements.form.elements.namedItem(key); if (field) field.value = key === 'activo' ? String(value) : value ?? ''; }); elements.form.classList.remove('was-validated'); elements.title.textContent = 'Editar sacerdote'; elements.save.querySelector('span').textContent = 'Guardar cambios'; setCodePresentation(priest.codigo); syncCongregation(); formModal.show(); };

/** Muestra el detalle de un sacerdote sin exponer UUID ni insertar HTML no confiable. */
const openDetails = (priest) => { elements.detail.replaceChildren(); const hero = document.createElement('header'); hero.className = 'priest-detail-hero'; const photo = document.createElement('div'); renderPhoto(photo, priest.foto_path); const copy = document.createElement('div'); const name = document.createElement('strong'); name.textContent = fullName(priest); const metadata = document.createElement('span'); metadata.textContent = `${priest.codigo} · ${priest.tipo_clero} · ${priest.congregacion || 'Sin congregación'} · ${priest.estado_ministerial}`; copy.append(name, metadata); hero.append(photo, copy); elements.detail.append(hero); const grid = document.createElement('dl'); grid.className = 'priest-details__grid'; DETAIL_FIELDS.forEach(([label, key]) => { const term = document.createElement('dt'); const description = document.createElement('dd'); term.textContent = label; description.textContent = key === 'fullName' ? fullName(priest) : key === 'activo' ? (priest.activo ? 'Activo' : 'Inactivo') : key.includes('_at') ? formatDate(priest[key], true) : key.startsWith('fecha_') ? formatDate(priest[key]) : priest[key] || '—'; grid.append(term, description); }); elements.detail.append(grid); detailModal.show(); };

/** Solicita confirmación antes de inactivar o reactivar un registro. */
const openStatus = (priest) => { if (!hasPermission(userContext, 'priests.update')) return showToast('Acceso no autorizado.', false); pendingStatusChange = { id: priest.id, activo: !priest.activo }; const action = priest.activo ? 'Inactivar' : 'Reactivar'; elements.statusTitle.textContent = `${action} sacerdote`; elements.statusMessage.textContent = `¿Desea ${action.toLowerCase()} al sacerdote “${fullName(priest)}”?`; elements.confirmStatus.querySelector('span').textContent = action; statusModal.show(); };

/** Inserta o actualiza el formulario utilizando siempre el id como filtro al editar. */
const savePriest = async (event) => {
  event.preventDefault(); if (!hasPermission(userContext, editingPriestId ? 'priests.update' : 'priests.create')) return showToast('Acceso no autorizado.', false); const validation = validateForm(); if (validation) { elements.form.classList.add('was-validated'); showError(validation); return; } hideError(); const payload = buildPayload(); const editing = Boolean(editingPriestId); elements.save.disabled = true; elements.save.querySelector('.spinner-border').classList.remove('d-none');
  try { const query = editing ? supabase.from('sacerdotes').update(payload).eq('id', editingPriestId).select().single() : supabase.from('sacerdotes').insert(payload).select().single(); const { data, error } = await query; if (error) throw error; let photoWarning = false; if (selectedPhoto) { try { await uploadPhoto(data.id, data.foto_path); } catch (photoError) { photoWarning = true; console.error('No fue posible subir la fotografía:', photoError); } } formModal.hide(); resetForm(); await fetchPriests(); showToast(photoWarning ? 'El sacerdote fue registrado correctamente, pero no fue posible guardar la fotografía.' : (editing ? 'Sacerdote actualizado correctamente.' : `Sacerdote ${data.codigo} registrado correctamente.`), !photoWarning); }
  catch (error) { console.error('No fue posible guardar el sacerdote:', error); showError(databaseMessage(error)); showToast(databaseMessage(error), false); }
  finally { elements.save.disabled = false; elements.save.querySelector('.spinner-border').classList.add('d-none'); }
};

/** Cambia únicamente el campo activo tras una confirmación de Administrador. */
const changeStatus = async () => {
  if (!pendingStatusChange || !hasPermission(userContext, 'priests.update')) return showToast('Acceso no autorizado.', false); elements.confirmStatus.disabled = true; elements.confirmStatus.querySelector('.spinner-border').classList.remove('d-none');
  try { const { error } = await supabase.from('sacerdotes').update({ activo: pendingStatusChange.activo }).eq('id', pendingStatusChange.id).select().single(); if (error) throw error; statusModal.hide(); await fetchPriests(); showToast(pendingStatusChange.activo ? 'Sacerdote reactivado correctamente.' : 'Sacerdote inactivado correctamente.'); }
  catch (error) { console.error('No fue posible actualizar el estado:', error); showError(databaseMessage(error)); showToast(databaseMessage(error), false); }
  finally { pendingStatusChange = null; elements.confirmStatus.disabled = false; elements.confirmStatus.querySelector('.spinner-border').classList.add('d-none'); }
};

/** Inicializa el módulo una vez que app.js insertó su plantilla en el DOM. */
export async function initSacerdotes(context) {
  if (!context || !hasPermission(context, 'priests.view')) return;
  destroySacerdotes(); userContext = context; mountOverlays(); ensurePhotoField(); elements = cacheElements(); const bootstrap = getBootstrap();
  formModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('priest-modal')); detailModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('priest-detail-modal')); statusModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('priest-status-modal')); toast = bootstrap.Toast.getOrCreateInstance(document.getElementById('priest-toast')); eventController = new AbortController(); const options = { signal: eventController.signal };
  document.querySelector('#new-priest-button').hidden = !hasPermission(userContext, 'priests.create'); document.querySelector('#new-priest-button').addEventListener('click', openNew, options); elements.form.addEventListener('submit', savePriest, options); elements.photo.addEventListener('change', handlePhotoSelection, options); elements.clergyType.addEventListener('change', syncCongregation, options); [elements.search, elements.clergyFilter, elements.ministryFilter, elements.recordFilter].forEach((control) => control.addEventListener(control === elements.search ? 'input' : 'change', () => { currentPage = 1; renderTable(); }, options)); elements.confirmStatus.addEventListener('click', changeStatus, options); await fetchPriests();
}

/** Elimina listeners, instancias Bootstrap y overlays al abandonar el módulo. */
export const destroySacerdotes = () => { clearPreview(); eventController?.abort(); eventController = null; formModal?.dispose(); detailModal?.dispose(); statusModal?.dispose(); toast?.dispose(); formModal = null; detailModal = null; statusModal = null; toast = null; document.querySelectorAll('[data-view-overlay="sacerdotes"]').forEach((overlay) => overlay.remove()); };
