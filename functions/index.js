const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ─── GOOGLE AI PROXY (función existente) ──────────────────────────────────────
exports.callGoogleApi = onCall({
    secrets: ["GOOGLE_API_KEY"],
    maxInstances: 10,
}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "El usuario debe estar autenticado.");
    const { prompt } = request.data;
    if (!prompt) throw new HttpsError("invalid-argument", "No se ha proporcionado un mensaje.");
    logger.info("📩 Procesando petición Gemini", { usuario: request.auth.token.email });
    try {
        const apiKey = process.env.GOOGLE_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
        const response = await axios.post(apiUrl, { contents: [{ parts: [{ text: prompt }] }] }, { headers: { "Content-Type": "application/json" } });
        const data = response.data;
        if (data.candidates?.[0]?.content?.parts) {
            return { success: true, response: data.candidates[0].content.parts[0].text };
        }
        throw new HttpsError("internal", "Respuesta inesperada de la IA.");
    } catch (error) {
        logger.error("❌ ERROR PROXY IA:", { message: error.message, stack: error.stack });
        throw new HttpsError("internal", "Error al procesar la solicitud con la IA.");
    }
});

// ─── SHAREPOINT SECRETS ───────────────────────────────────────────────────────
const SP_SECRETS = [
    "SHAREPOINT_TENANT_ID",
    "SHAREPOINT_CLIENT_ID",
    "SHAREPOINT_CLIENT_SECRET",
    "SHAREPOINT_SITE_URL",
    "SHAREPOINT_FILE_PATH",
];

// ─── COLUMN DEFINITIONS ───────────────────────────────────────────────────────
const OFERTAS_HEADERS = [
    "ESTADO", "N° GESTIONA", "PERTENECE A LICITACION", "ES UNA LICITACION?",
    "FECHA OFERTA", "AGENTE COMERCIAL", "OFICINA", "CLIENTE", "GRUPO",
    "OBJETO DE LA OFERTA", "TIPO SERVICIO", "ORIGEN", "COMENTARIOS",
    "PRESUPUESTO", "GASTOS", "T1", "FIN LICITACION",
    "INGRESOS 2026", "INGRESOS 2027", "INGRESOS 2028", "INGRESOS 2029", "INGRESOS 2030",
];

const PRODUCCION_HEADERS = [
    "Nº TRABAJO", "TIPO EXPEDIENTE", "EXP GESTIONA", "OFERTA GESTIONA",
    "FECHA INICIO", "FECHA FIN", "CLIENTE", "SERVICIO", "TIPO SERVICIO", "GRUPO",
    "RESPONSABLE", "EJECUTOR T1", "APOYO AM", "APOYO AN",
    "PRESUPUESTO", "GASTOS", "GESTIONADO", "VB CLIENTE",
    "FECHA AP", "FECHA AR", "Nº AT", "MES FACTURACION", "OBSERVACIONES",
];

const toNum = (v) => {
    const n = parseFloat(String(v || "").replace(",", "."));
    return isNaN(n) ? "" : n;
};

const ofertaToRow = (docId, d) => [
    d.estado || "",
    d.num_gestiona || docId,
    d.pertenece_a_licitacion || "",
    d.es_licitacion || "",
    d.fecha_oferta || "",
    d.agente_comercial || "",
    d.oficina || "",
    d.cliente || "",
    d.grupo || "",
    d.objeto || "",
    d.servicio || "",
    d.origen || "",
    d.comentarios || "",
    toNum(d.presupuesto_total),
    toNum(d.gastos_estimados),
    d.tecnico_t1 || "",
    d.fin_licitacion || "",
    toNum(d.ingresos_2026),
    toNum(d.ingresos_2027),
    toNum(d.ingresos_2028),
    toNum(d.ingresos_2029),
    toNum(d.ingresos_2030),
];

const produccionToRow = (d) => [
    d.num_trabajo || "",
    d.tipo_expediente || "",
    d.exp_gestiona || "",
    d.oferta_gestiona || "",
    d.fecha_inicio || "",
    d.fecha_fin || "",
    d.cliente || "",
    d.servicio || "",
    d.tipo_servicio || "",
    d.grupo || "",
    d.responsable_g || "",
    d.ejecutor_t1 || "",
    d.apoyo_am || "",
    d.apoyo_an || "",
    toNum(d.presupuesto_m),
    toNum(d.gastos_n),
    d.gestionado || "",
    d.visto_vb_cliente || "",
    d.fecha_ap || "",
    d.fecha_ar || "",
    d.num_at || "",
    d.mes_facturacion || "",
    d.observaciones || "",
];

// ─── GRAPH API HELPERS ────────────────────────────────────────────────────────

async function getMsToken() {
    const tenantId = process.env.SHAREPOINT_TENANT_ID;
    const clientId = process.env.SHAREPOINT_CLIENT_ID;
    const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;
    const resp = await axios.post(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: "https://graph.microsoft.com/.default",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return resp.data.access_token;
}

async function getGraphResource(token, url) {
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return resp.data;
}

// Devuelve { siteId, itemId } cacheados en Firestore para no llamar a Graph en cada trigger
async function getSpIds(token) {
    const cacheRef = db.doc("metadata/sharepoint_ids");
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
        const c = cacheSnap.data();
        // Caché válida 24 horas
        if (c.cached_at && (Date.now() - c.cached_at) < 86400000) {
            return { siteId: c.siteId, itemId: c.itemId };
        }
    }

    const siteUrl = process.env.SHAREPOINT_SITE_URL; // ej: https://empresa.sharepoint.com/sites/nombre
    const filePath = process.env.SHAREPOINT_FILE_PATH; // ej: Documentos compartidos/Gestion/Datos.xlsx

    const urlObj = new URL(siteUrl);
    const hostname = urlObj.hostname;
    const sitePath = urlObj.pathname;

    const siteData = await getGraphResource(token, `https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}`);
    const siteId = siteData.id;

    const fileData = await getGraphResource(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURIComponent(filePath)}`);
    const itemId = fileData.id;

    await cacheRef.set({ siteId, itemId, cached_at: Date.now() });
    return { siteId, itemId };
}

// Convierte índice de columna (1-based) a letras Excel: 1→A, 26→Z, 27→AA…
function colLetter(n) {
    let s = "";
    while (n > 0) {
        s = String.fromCharCode(64 + ((n - 1) % 26 + 1)) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

async function writeSheet(token, siteId, itemId, sheetName, headers, rows) {
    const data = [headers, ...rows];
    const nRows = data.length;
    const nCols = headers.length;
    const endCol = colLetter(nCols);
    const baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/workbook/worksheets/${encodeURIComponent(sheetName)}`;

    // 1. Limpiar contenido existente (rango generoso para borrar filas antiguas)
    await axios.post(
        `${baseUrl}/range(address='A1:${endCol}10000')/clear`,
        { applyTo: "Contents" },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    // 2. Escribir datos nuevos desde A1
    await axios.patch(
        `${baseUrl}/range(address='A1:${endCol}${nRows}')`,
        { values: data },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    logger.info(`✅ SharePoint sync OK — hoja "${sheetName}": ${rows.length} filas`);
}

async function readSheet(token, siteId, itemId, sheetName) {
    const baseUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/workbook/worksheets/${encodeURIComponent(sheetName)}`;
    const resp = await axios.get(`${baseUrl}/usedRange`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return resp.data.values || []; // array 2D
}

// ─── SYNC FIRESTORE → SHAREPOINT ─────────────────────────────────────────────

// Guarda en Firestore un timestamp de "última sincronización" para cada colección.
// Si otra instancia ya sincronizó en los últimos 15 s, marcamos como pendiente
// y salimos — el siguiente trigger lo enviará igualmente.
async function runSync(collection, sheetName, headers, buildRow) {
    const lockRef = db.doc(`metadata/sharepoint_sync_${collection}`);
    const lockSnap = await lockRef.get();
    const lastSync = lockSnap.data()?.last_sync_ms || 0;

    if (Date.now() - lastSync < 15000) {
        // Demasiado reciente: marcar pendiente y dejar que el siguiente trigger lo procese
        await lockRef.set({ pending: true, last_sync_ms: lastSync }, { merge: true });
        logger.info(`⏳ Sync ${collection} diferido (última sync hace <15 s)`);
        return;
    }

    // Reservar slot
    await lockRef.set({ last_sync_ms: Date.now(), pending: false }, { merge: true });

    const snap = await db.collection(collection).get();
    const rows = [];
    snap.forEach((doc) => rows.push(buildRow(doc.id, doc.data())));

    const token = await getMsToken();
    const { siteId, itemId } = await getSpIds(token);
    await writeSheet(token, siteId, itemId, sheetName, headers, rows);

    // Si quedó pendiente durante la sync, programar otro ciclo inmediato
    const after = await lockRef.get();
    if (after.data()?.pending) {
        await lockRef.set({ pending: false }, { merge: true });
        await runSync(collection, sheetName, headers, buildRow);
    }
}

exports.syncOfertasToSharePoint = onDocumentWritten({
    document: "ofertas/{docId}",
    secrets: SP_SECRETS,
    timeoutSeconds: 120,
    memory: "256MiB",
}, async () => {
    try {
        await runSync("ofertas", "Ofertas", OFERTAS_HEADERS, ofertaToRow);
    } catch (err) {
        logger.error("❌ syncOfertasToSharePoint error:", err.message, err.response?.data);
    }
});

exports.syncProduccionToSharePoint = onDocumentWritten({
    document: "produccion/{docId}",
    secrets: SP_SECRETS,
    timeoutSeconds: 120,
    memory: "256MiB",
}, async () => {
    try {
        await runSync("produccion", "Produccion", PRODUCCION_HEADERS,
            (_id, d) => produccionToRow(d));
    } catch (err) {
        logger.error("❌ syncProduccionToSharePoint error:", err.message, err.response?.data);
    }
});

// ─── SYNC SHAREPOINT → FIRESTORE (callable desde la web) ─────────────────────
// Lee la hoja de SharePoint y devuelve las filas al cliente como array de objetos.
// El cliente hace el upsert en Firestore (reutiliza la lógica de import existente).

exports.syncFromSharePoint = onCall({
    secrets: SP_SECRETS,
    timeoutSeconds: 120,
    memory: "256MiB",
}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");

    const { coleccion } = request.data; // "ofertas" | "produccion"
    if (!["ofertas", "produccion"].includes(coleccion)) {
        throw new HttpsError("invalid-argument", "coleccion debe ser 'ofertas' o 'produccion'.");
    }

    try {
        const token = await getMsToken();
        const { siteId, itemId } = await getSpIds(token);
        const sheetName = coleccion === "ofertas" ? "Ofertas" : "Produccion";
        const values = await readSheet(token, siteId, itemId, sheetName);

        if (values.length < 2) return { filas: [] };

        const headers = values[0].map((h) => String(h || "").trim());
        const filas = values.slice(1)
            .filter((row) => row.some((cell) => cell !== "" && cell !== null))
            .map((row) => {
                const obj = {};
                headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
                return obj;
            });

        logger.info(`📥 syncFromSharePoint ${coleccion}: ${filas.length} filas leídas`);
        return { filas };
    } catch (err) {
        logger.error("❌ syncFromSharePoint error:", err.message, err.response?.data);
        throw new HttpsError("internal", `Error leyendo SharePoint: ${err.message}`);
    }
});
