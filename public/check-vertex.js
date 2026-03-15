const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path');
require('dotenv').config();

async function verificarConexion() {
    console.log("🔍 Iniciando verificación profunda...");

    const jsonPath = path.join(__dirname, 'trabajos-sin-eu-f7a420fe52fc.json');
    console.log("📂 Buscando llave en:", jsonPath);

    try {
        // Forzamos la autenticación mediante el archivo directamente
        const vertexAI = new VertexAI({
            project: 'trabajos-sin-eu',
            location: 'us-central1', // Asegúrate de que sea tu región activa
            keyFilename: jsonPath
        });

        const model = 'gemini-3.1-flash-lite-001';
        const generativeModel = vertexAI.getGenerativeModel({ model: model });

        console.log("📡 Enviando señal a Vertex AI...");

        const request = {
            contents: [{ role: 'user', parts: [{ text: 'Responde solo: OK' }] }],
        };

        const resp = await generativeModel.generateContent(request);
        const result = await resp.response;

        console.log("✅ RESPUESTA RECIBIDA:", JSON.stringify(result.candidates[0].content.parts[0].text));
        console.log("🚀 ¡CONEXIÓN EXITOSA CON TRABAJOS-SIN-EU!");

    } catch (error) {
        console.error("❌ ERROR DETECTADO:");
        console.error("- Mensaje:", error.message);
        if (error.message.includes("404")) console.log("💡 Tip: El ID del proyecto o el modelo podrían ser incorrectos.");
        if (error.message.includes("403")) console.log("💡 Tip: Verifica que la API de Vertex AI esté habilitada en Google Cloud Console.");
        if (error.message.includes("ENOENT")) console.log("💡 Tip: No se encuentra el archivo .json en esa ruta.");
    }
}

verificarConexion();