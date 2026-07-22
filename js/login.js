/** Controla la interfaz y autenticación de la pantalla de inicio de sesión. */
import { getUserContext, signInWithEmail, supabase } from './auth.js';

const loginForm = document.querySelector('#formulario-login');
const emailInput = document.querySelector('#correo');
const passwordInput = document.querySelector('#contrasena');
const passwordToggle = document.querySelector('#alternar-contrasena');
const submitButton = document.querySelector('#boton-ingresar');
const errorAlert = document.querySelector('#mensaje-error');
const showPasswordIcon = document.querySelector('.password-toggle__show');
const hidePasswordIcon = document.querySelector('.password-toggle__hide');
const loadingSpinner = document.querySelector('.spinner-border');
const loadingText = document.querySelector('.loading-text');

/** Redirige al usuario autenticado sin conservar el Login en el historial. */
const redirectToDashboard = () => {
  window.location.replace('pages/dashboard.html');
};

/** Muestra un mensaje de error accesible usando el componente Alert de Bootstrap. */
const showError = (message) => {
  errorAlert.textContent = message;
  errorAlert.classList.remove('d-none');
};

/** Oculta el Alert de Bootstrap y elimina el contenido del mensaje anterior. */
const hideError = () => {
  errorAlert.textContent = '';
  errorAlert.classList.add('d-none');
};

/**
 * Actualiza el botón durante una operación asíncrona para prevenir envíos duplicados.
 *
 * @param {boolean} isLoading Indica si existe una operación en curso.
 */
const setLoadingState = (isLoading) => {
  submitButton.disabled = isLoading;
  loadingSpinner.classList.toggle('d-none', !isLoading);
  loadingText.classList.toggle('d-none', !isLoading);
};

/** Alterna la visibilidad del campo de contraseña y sus ayudas accesibles. */
const togglePasswordVisibility = () => {
  const isPasswordHidden = passwordInput.type === 'password';
  passwordInput.type = isPasswordHidden ? 'text' : 'password';
  passwordToggle.setAttribute('aria-label', isPasswordHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
  passwordToggle.setAttribute('aria-pressed', String(isPasswordHidden));
  showPasswordIcon.classList.toggle('d-none', isPasswordHidden);
  hidePasswordIcon.classList.toggle('d-none', !isPasswordHidden);
};

/**
 * Procesa las credenciales enviadas y presenta mensajes seguros y comprensibles.
 *
 * @param {SubmitEvent} event Evento submit del formulario.
 */
const handleLogin = async (event) => {
  event.preventDefault();
  hideError();

  if (!loginForm.checkValidity()) {
    loginForm.classList.add('was-validated');
    showError('Complete el correo electrónico y la contraseña para continuar.');
    return;
  }

  setLoadingState(true);

  try {
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const { error } = await signInWithEmail(email, password);

    if (error) {
      showError('El correo electrónico o la contraseña no son correctos. Intente nuevamente.');
      return;
    }

    redirectToDashboard();
  } catch (error) {
    console.error('No fue posible iniciar sesión:', error);
    showError('No fue posible iniciar sesión. Verifique su conexión e intente de nuevo.');
  } finally {
    setLoadingState(false);
  }
};

/** Comprueba si existe una sesión antes de permitir que el usuario vea el formulario. */
const checkExistingSession = async () => {
  setLoadingState(true);

  try {
    const userContext = await getUserContext();

    if (userContext) {
      redirectToDashboard();
      return;
    }

    await supabase.auth.signOut();
  } catch (error) {
    console.error('No fue posible comprobar la sesión actual:', error);
  } finally {
    setLoadingState(false);
  }
};

loginForm.addEventListener('submit', handleLogin);
passwordToggle.addEventListener('click', togglePasswordVisibility);
checkExistingSession();
