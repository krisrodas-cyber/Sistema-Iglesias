/** Cliente base para futuras solicitudes a servicios HTTP del sistema. */

/** Realiza solicitudes Fetch API y convierte respuestas erróneas en excepciones. */
export const requestApi = async (url, options = {}) => {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`La solicitud no pudo completarse (${response.status}).`);
  }

  return response;
};
