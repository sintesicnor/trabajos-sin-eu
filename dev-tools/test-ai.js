const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

async function testConnection() {
  try {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      console.log("❌ Error: No hay API KEY en el .env");
      return;
    }

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    
    // Usamos el modelo 2.5 que es el que tu lista mostró como disponible
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    console.log("🔄 Conectando con Gemini 2.5 Flash...");
    
    const result = await model.generateContent("Di: '¡Conexión 2.5 exitosa!'");
    const response = await result.response;
    
    console.log("✅ RESULTADO:", response.text());

  } catch (error) {
    console.error("❌ Error:");
    console.error(error.message);
  }
}

testConnection();