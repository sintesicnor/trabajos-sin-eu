const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const axios = require("axios");

/**
 * PASO 1: BACKEND - Cloud Function como Proxy Seguro
 * Esta función actúa como un puente entre el cliente y la API de Google Gemini.
 * La clave de API se recupera de forma segura desde Firebase Secret Manager.
 */
exports.callGoogleApi = onCall({
    // Definimos el secreto que debe estar disponible para esta función
    secrets: ["GOOGLE_API_KEY"],
    // Restringimos instancias para control de costes
    maxInstances: 10 
}, async (request) => {
    // Verificación de autenticación (opcional pero recomendado si quieres restringir a usuarios logueados)
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'El usuario debe estar autenticado para consultar la IA.');
    }

    const { prompt } = request.data;

    if (!prompt) {
        throw new HttpsError('invalid-argument', 'No se ha proporcionado un mensaje para la IA.');
    }

    logger.info("📩 Conexión segura establecida. Procesando petición para Gemini Pro...", { usuario: request.auth.token.email });

    try {
        const apiKey = process.env.GOOGLE_API_KEY; // Acceso seguro al secreto mediante variable de entorno inyectada
        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${apiKey}`;

        // Petición robusta usando axios
        const response = await axios.post(apiUrl, {
            contents: [{
                parts: [{ text: prompt }]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const data = response.data;

        // Validación de la estructura de respuesta de Google
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
            return {
                success: true,
                response: data.candidates[0].content.parts[0].text
            };
        } else {
            logger.error("❌ Estructura de respuesta inesperada de Gemini:", data);
            throw new HttpsError('internal', 'La IA devolvió una respuesta con formato inválido.');
        }

    } catch (error) {
        // Log detallado en el servidor para depuración
        logger.error("❌ ERROR CRÍTICO EN PROXY IA:", {
            message: error.message,
            googleResponse: error.response?.data,
            stack: error.stack
        });

        // Error genérico al cliente para no filtrar detalles de infraestructura o claves
        throw new HttpsError('internal', 'Error al procesar la solicitud con la IA. Por favor, inténtelo de nuevo más tarde.');
    }
});
