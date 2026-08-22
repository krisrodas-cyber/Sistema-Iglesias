/** La interfaz delega todas las operaciones sensibles en la Edge Function admin-users. */
import { supabase, hasPermission } from './auth.js';

let e, users = [], parishes = [], selected = null, mode = 'create', formModal, confirmModal, toast, pendingAction, events;
const SECRETARY = '2';
const login = () => window.location.replace(new URL('../index.html', import.meta.url));
const alert = (message) => { e.alert.textContent = message; e.alert.classList.remove('d-none'); };
const hideAlert = () => e.alert.classList.add('d-none');
const notify = (message, ok = true) => { e.toastMessage.textContent = message; e.toastIcon.className = `bi ${ok ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill'}`; toast.show(); };
const cache = () => ({
  alert: document.querySelector('#users-alert'), summary: document.querySelector('#users-summary'), loader: document.querySelector('#users-loader'), table: document.querySelector('#users-table'), form: document.querySelector('#user-form'), title: document.querySelector('#user-modal-title'), save: document.querySelector('#user-save'), emailGroup: document.querySelector('#user-email-group'), roleGroup: document.querySelector('#user-role-group'), passwordGroup: document.querySelector('#user-password-group'), activeGroup: document.querySelector('#user-active-group'), parishGroup: document.querySelector('#user-parish-group'), parish: document.querySelector('#user-parish'), role: document.querySelector('#user-role'), password: document.querySelector('#user-password'), togglePassword: document.querySelector('#toggle-user-password'), confirmTitle: document.querySelector('#user-confirm-title'), confirmMessage: document.querySelector('#user-confirm-message'), confirmButton: document.querySelector('#user-confirm-button'), toastMessage: document.querySelector('#users-toast-message'), toastIcon: document.querySelector('#users-toast-icon'),
});

/** Invoca la API segura y solo registra datos técnicos no sensibles. */
const invoke = async (body) => {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    const status = error.context?.status; let response;
    try { response = await error.context?.clone?.().json(); } catch { /* Puede tratarse de un error de red. */ }
    const message = !status ? 'No fue posible comunicarse con el servicio de usuarios.' : response?.error?.message ?? error.message;
    console.error('admin-users', { action: body.action, status, code: response?.error?.code, message });
    if (status === 401) login();
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error?.message ?? 'No fue posible completar la operación.');
  return data.data;
};

const cell = (value) => { const td = document.createElement('td'); td.textContent = value ?? '—'; return td; };
const parishLabel = (user) => user.parroquia ? `${user.parroquia.codigo} · ${user.parroquia.nombre}` : '—';
const action = (icon, label, modifier, handler) => { const button = document.createElement('button'); const image = document.createElement('i'); button.className = `btn user-action-button ${modifier}`; button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); image.className = `bi ${icon}`; image.setAttribute('aria-hidden', 'true'); button.append(image); button.addEventListener('click', handler); return button; };

const render = () => {
  e.table.replaceChildren();
  users.forEach((user) => {
    const row = document.createElement('tr'); const td = document.createElement('td'); const actions = document.createElement('div'); actions.className = 'user-actions';
    actions.append(action('bi-eye', `Ver detalle de ${user.nombre_completo}`, '', () => details(user)), action('bi-pencil-square', `Editar perfil de ${user.nombre_completo}`, '', () => openEdit(user, 'profile')), action('bi-person-badge', `Cambiar rol de ${user.nombre_completo}`, 'user-action-button--role', () => openEdit(user, 'role')), action(user.activo ? 'bi-person-slash' : 'bi-person-check', `${user.activo ? 'Inactivar' : 'Activar'} a ${user.nombre_completo}`, user.activo ? 'user-action-button--danger' : 'user-action-button--active', () => confirmStatus(user)), action('bi-key', `Restablecer contraseña de ${user.nombre_completo}`, 'user-action-button--password', () => openEdit(user, 'password')));
    td.append(actions); row.append(cell(user.nombre_completo), cell(user.email), cell(user.rol), cell(parishLabel(user)), cell(user.activo ? 'Activo' : 'Inactivo'), cell(user.created_at ? new Intl.DateTimeFormat('es-GT').format(new Date(user.created_at)) : '—'), td); e.table.append(row);
  });
  const stats = [['Total de usuarios', users.length], ['Administradores activos', users.filter((user) => user.rol_id === '1' && user.activo).length], ['Usuarios activos', users.filter((user) => user.activo).length], ['Usuarios inactivos', users.filter((user) => !user.activo).length]];
  e.summary.replaceChildren(...stats.map(([label, value]) => { const card = document.createElement('div'); card.className = 'inventory-summary__card'; card.append(Object.assign(document.createElement('span'), { textContent: label }), Object.assign(document.createElement('strong'), { textContent: String(value) })); return card; }));
};

/** Carga exclusivamente parroquias activas, ordenadas por nombre. */
const cargarParroquias = async () => {
  const { data, error } = await supabase.from('parroquias').select('id,codigo,nombre').eq('estado', true).order('nombre', { ascending: true });
  if (error) throw error;
  parishes = data ?? []; e.parish.replaceChildren(new Option('Seleccione una parroquia', ''));
  parishes.forEach((parish) => e.parish.add(new Option(`${parish.codigo} · ${parish.nombre}`, parish.id)));
};
/** Presenta y valida la parroquia solo en creación o cambio de rol de Secretario. */
const syncParishField = () => { const show = e.role.value === SECRETARY && (mode === 'create' || mode === 'role'); e.parishGroup.hidden = !show; e.parish.required = show; if (!show) e.parish.value = ''; };

export async function cargarUsuarios() {
  e.loader.classList.remove('d-none'); hideAlert();
  try { const { data: { session } } = await supabase.auth.getSession(); if (!session) return login(); const data = await invoke({ action: 'list', page: 1, perPage: 100 }); users = data.users ?? []; render(); }
  catch (error) { console.error('Usuarios:', error.message); alert(error.message); }
  finally { e.loader.classList.add('d-none'); }
}

const reset = () => { selected = null; mode = 'create'; e.form.reset(); e.form.classList.remove('was-validated'); hideAlert(); e.title.textContent = 'Nuevo usuario'; e.emailGroup.hidden = false; e.roleGroup.hidden = false; e.passwordGroup.hidden = false; e.activeGroup.hidden = false; e.form.elements.email.required = true; e.password.required = true; e.role.value = SECRETARY; syncParishField(); };
const openNew = () => { reset(); formModal.show(); };
const openEdit = (user, nextMode) => { selected = user; mode = nextMode; e.form.reset(); e.form.classList.remove('was-validated'); hideAlert(); e.form.elements.nombre.value = user.nombre; e.form.elements.apellido.value = user.apellido; e.role.value = user.rol_id ?? ''; e.parish.value = user.parroquia_id ?? ''; e.emailGroup.hidden = true; e.activeGroup.hidden = true; e.roleGroup.hidden = nextMode !== 'role'; e.passwordGroup.hidden = nextMode !== 'password'; e.form.elements.email.required = false; e.password.required = nextMode === 'password'; e.title.textContent = nextMode === 'profile' ? 'Editar perfil' : nextMode === 'role' ? 'Cambiar rol y parroquia' : 'Restablecer contraseña temporal'; syncParishField(); formModal.show(); };

const details = (user) => { e.confirmTitle.textContent = 'Detalle de usuario'; e.confirmMessage.replaceChildren(); [['Nombre', user.nombre_completo], ['Correo', user.email], ['Rol', user.rol], ['Parroquia asignada', parishLabel(user)], ['Estado', user.activo ? 'Activo' : 'Inactivo']].forEach(([label, value]) => { const line = document.createElement('p'); line.textContent = `${label}: ${value}`; e.confirmMessage.append(line); }); e.confirmButton.hidden = true; confirmModal.show(); };
const execute = async (body, successMessage) => { e.save.disabled = true; e.save.querySelector('.spinner-border').classList.remove('d-none'); try { await invoke(body); formModal.hide(); notify(successMessage); reset(); await cargarUsuarios(); } catch (error) { alert(error.message); } finally { e.save.disabled = false; e.save.querySelector('.spinner-border').classList.add('d-none'); } };

const submit = async (event) => {
  event.preventDefault(); syncParishField(); const passwordMode = mode === 'create' || mode === 'password'; const passwordValid = !passwordMode || /(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}/.test(e.password.value);
  if (!e.form.checkValidity() || !passwordValid) { e.form.classList.add('was-validated'); alert(passwordValid ? 'Complete los campos obligatorios.' : 'La contraseña debe tener mínimo 10 caracteres, mayúscula, minúscula, número y carácter especial.'); e.form.querySelector(':invalid')?.focus(); return; }
  const data = new FormData(e.form); const parishId = e.role.value === SECRETARY ? data.get('parroquia_id') : null;
  if ((mode === 'create' || mode === 'role') && e.role.value === SECRETARY && !parishId) { alert('Debe seleccionar una parroquia para el usuario Secretario.'); e.parish.focus(); return; }
  let body; let success = 'Usuario actualizado correctamente.';
  if (mode === 'create') { body = { action: 'create', nombre: data.get('nombre').trim(), apellido: data.get('apellido').trim(), email: data.get('email').trim(), rol_id: e.role.value, parroquia_id: parishId, password: data.get('password'), activo: data.get('activo') === 'on' }; success = 'Usuario creado correctamente.'; }
  if (mode === 'profile') body = { action: 'updateProfile', userId: selected.id, nombre: data.get('nombre').trim(), apellido: data.get('apellido').trim() };
  if (mode === 'role') body = { action: 'changeRole', userId: selected.id, rol_id: e.role.value, parroquia_id: parishId };
  if (mode === 'password') body = { action: 'resetPassword', userId: selected.id, password: data.get('password') };
  const run = () => execute(body, success);
  if (mode === 'role' && selected?.rol_id === SECRETARY && e.role.value === SECRETARY && String(selected.parroquia_id ?? '') !== String(parishId ?? '')) { const previous = parishLabel(selected); const next = parishes.find((parish) => parish.id === parishId); e.confirmTitle.textContent = 'Confirmar cambio de parroquia'; e.confirmMessage.textContent = `El usuario dejará de tener acceso a la información de ${previous} y pasará a trabajar únicamente con ${next ? `${next.codigo} · ${next.nombre}` : 'la parroquia seleccionada'}.`; e.confirmButton.hidden = false; pendingAction = async () => { await run(); confirmModal.hide(); }; confirmModal.show(); return; }
  await run();
};

const confirmStatus = (user) => { e.confirmTitle.textContent = user.activo ? 'Inactivar usuario' : 'Activar usuario'; e.confirmMessage.textContent = `¿Desea ${user.activo ? 'inactivar' : 'activar'} a ${user.nombre_completo}?`; e.confirmButton.hidden = false; pendingAction = async () => { await invoke({ action: user.activo ? 'deactivate' : 'activate', userId: user.id }); confirmModal.hide(); notify(user.activo ? 'Usuario inactivado correctamente.' : 'Usuario activado correctamente.'); await cargarUsuarios(); }; confirmModal.show(); };

export async function initUsuarios(context) {
  if (!hasPermission(context, 'users.view')) return;
  e = cache(); formModal = bootstrap.Modal.getOrCreateInstance(document.querySelector('#user-modal')); confirmModal = bootstrap.Modal.getOrCreateInstance(document.querySelector('#user-confirm-modal')); toast = bootstrap.Toast.getOrCreateInstance(document.querySelector('#users-toast')); events = new AbortController(); const options = { signal: events.signal };
  document.querySelector('#new-user').addEventListener('click', openNew, options); e.form.addEventListener('submit', submit, options); e.role.addEventListener('change', syncParishField, options); e.togglePassword.addEventListener('click', () => { e.password.type = e.password.type === 'password' ? 'text' : 'password'; }, options);
  document.querySelector('#user-confirm-modal').addEventListener('hidden.bs.modal', () => { e.confirmButton.hidden = false; pendingAction = null; }, options); e.confirmButton.addEventListener('click', async () => { e.confirmButton.disabled = true; try { await pendingAction?.(); } catch (error) { alert(error.message); } finally { e.confirmButton.disabled = false; } }, options);
  try { await cargarParroquias(); } catch (error) { console.error('No fue posible cargar parroquias:', error.message); alert('No fue posible cargar las parroquias activas.'); }
  await cargarUsuarios();
}
export const destroyUsuarios = () => { events?.abort(); formModal?.dispose(); confirmModal?.dispose(); toast?.dispose(); };
