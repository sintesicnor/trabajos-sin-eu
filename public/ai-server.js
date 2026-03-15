const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// --- SOPORTE CORS ROBUSTO ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// --- RUTA PRINCIPAL DE LA IA (FETCH DIRECTO) ---
app.post('/api/chat', async (req, res) => {
    console.log('📩 Petición recibida en /api/chat');
    console.log('🔗 Conectado a Gemini Pro - Analizando datos...');
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "No se ha proporcionado un mensaje." });
        }

        console.log("📩 Generando respuesta para:", prompt.substring(0, 50) + "...");

        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${apiKey}`;

        // Petición fetch directa a la API REST de Google Gemini
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("❌ Error en la API de Google:", data);
            throw new Error(data.error?.message || "Error en la petición a Gemini");
        }

        // Extracción de la respuesta según la estructura solicitada
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
            const aiText = data.candidates[0].content.parts[0].text;
            res.json({
                success: true,
                response: aiText
            });
        } else {
            throw new Error("Estructura de respuesta inesperada de Gemini");
        }

    } catch (error) {
        console.error("❌ ERROR DETALLADO EN EL SERVIDOR DE IA:", error);
        res.status(500).json({ 
            error: "Error al procesar la solicitud con Gemini",
            details: error.message,
            stack: error.stack
        });
    }
});

// Ruta de salud del sistema
app.get('/health', (req, res) => {
    res.json({ status: 'OK', model: 'Gemini 1.5 Pro (Direct Fetch)' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`--- SERVIDOR DE IA ACTIVO ---`);
    console.log(`🚀 Puerto: ${port}`);
    console.log(`🌍 Interfaz: 0.0.0.0 (Escuchando en todas)`);
    console.log(`🧠 Modelo: Gemini 1.5 Pro (Direct Fetch)`);
    console.log(`-----------------------------`);
});