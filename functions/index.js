const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule }        = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin  = require("firebase-admin");
const axios  = require("axios");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ─── GOOGLE AI PROXY ──────────────────────────────────────────────────────────
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

// ─── SHAREPOINT CONFIG ────────────────────────────────────────────────────────
const SP_SITE_URL     = "https://tesicnorsl.sharepoint.com/sites/sin";
const SP_LIBRARY_NAME = "GESTION DEPARTAMENTO";
const SP_FILE_NAME    = "PO04-REG03-2026.xlsm";
const SP_SHEET_OFERTAS    = "Ofertas";
const SP_SHEET_PRODUCCION = "Producción";

const SP_SECRETS = [
    "SHAREPOINT_TENANT_ID",
    "SHAREPOINT_CLIENT_ID",
    "SHAREPOINT_CLIENT_SECRET",
];

// ─── COLUMN DEFINITIONS (Excel → Firestore write-back) ───────────────────────
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

// ─── FIELD MAPS (Excel → Firestore, SharePoint→Firestore direction) ───────────

// Normaliza nombre de columna: sin BOM, sin tildes, sin puntuación, lowercase
function normCol(s) {
    return String(s).replace(/^﻿/, '').trim()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

const COL_MAP_OFE = {
    'estado': 'estado', 'aprobacion': 'estado', 'aprobado': 'estado',
    'n gestiona': 'num_gestiona', 'no gestiona': 'num_gestiona',
    'pertenece a licitacion': 'pertenece_a_licitacion',
    'es una licitacion': 'es_licitacion',
    'fecha oferta': 'fecha_oferta', 'agente comercial': 'agente_comercial',
    'oficina': 'oficina', 'cliente': 'cliente', 'grupo': 'grupo',
    'objeto de la oferta': 'objeto', 'tipo servicio': 'servicio',
    'origen': 'origen', 'comentarios': 'comentarios',
    'presupuesto': 'presupuesto_total', 'gastos': 'gastos_estimados',
    't1': 'tecnico_t1', 'fin licitacion': 'fin_licitacion',
    'ingresos 2026': 'ingresos_2026', 'ingresos 2027': 'ingresos_2027',
    'ingresos 2028': 'ingresos_2028', 'ingresos 2029': 'ingresos_2029',
    'ingresos 2030': 'ingresos_2030',
};

const COL_MAP_PROD = {
    // Cabeceras estándar
    'n trabajo': 'num_trabajo', 'no trabajo': 'num_trabajo',
    'tipo expediente': 'tipo_expediente', 'exp gestiona': 'exp_gestiona',
    'oferta gestiona': 'oferta_gestiona',
    'fecha inicio': 'fecha_inicio', 'fecha fin': 'fecha_fin',
    'cliente': 'cliente', 'servicio': 'servicio',
    'tipo servicio': 'tipo_servicio', 'grupo': 'grupo',
    'responsable': 'responsable_g', 'ejecutor t1': 'ejecutor_t1',
    'apoyo am': 'apoyo_am', 'apoyo an': 'apoyo_an',
    'presupuesto': 'presupuesto_m',
    'gastos': 'gastos_n',
    'gestionado': 'gestionado', 'vb cliente': 'visto_vb_cliente',
    'fecha ap': 'fecha_ap', 'fecha ar': 'fecha_ar',
    'n at': 'num_at', 'mes facturacion': 'mes_facturacion',
    'observaciones': 'observaciones',
    // Aliases del Excel original
    'tipo exp': 'tipo_expediente',
    'fecha entrega': 'fecha_fin',
    'tecnico rble': 'responsable_g',
    't1': 'ejecutor_t1', 't2': 'apoyo_am', 't3': 'apoyo_an',
    'ica': 'cliente',
    'ppto total sin iva': 'presupuesto_m',
    'gastos est': 'gastos_n',
    'gastos gest': '_gastos_gest',   // campo ficticio: evita que GASTOS GEST. machaque gastos_n
    'vb clie': 'visto_vb_cliente',          // cabecera real: "VB CLIE."
    'fecha finalizacion': 'fecha_ap',       // cabecera real: "FECHA FINALIZACIÓN"
    'fecha facturacion': 'fecha_ar',        // cabecera real: "FECHA FACTURACION"
    'n fact': 'num_at',                     // cabecera real: "Nº Fact"
};

const NUM_FIELDS     = new Set(['presupuesto_total', 'gastos_estimados', 'presupuesto_m', 'gastos_n',
                                 'ingresos_2026', 'ingresos_2027', 'ingresos_2028', 'ingresos_2029', 'ingresos_2030']);
const TEC_FIELDS     = new Set(['responsable_g', 'ejecutor_t1', 'apoyo_am', 'apoyo_an']);
// Campos que gestiona la web: el Excel nunca debe sobreescribirlos en Firestore
const PROD_WEB_ONLY  = new Set(['fecha_ar', 'observaciones', 'num_at']);

const APROBACION_NORM = {
    'aceptado': 'Aceptada', 'aceptada': 'Aceptada',
    'pendiente': 'Pendiente',
    'rechazado': 'Rechazada', 'rechazada': 'Rechazada',
    'en curso': 'En curso',
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const toNum = (v) => {
    const n = parseFloat(String(v || "").replace(",", "."));
    return isNaN(n) ? "" : n;
};

// Convierte array de arrays (valores Excel) a array de objetos {header: value}
function parseRows(values) {
    if (!values || values.length < 2) return [];
    const headers = values[0].map((h) => String(h || "").trim());
    return values.slice(1)
        .filter((row) => row.some((c) => c !== "" && c !== null))
        .map((row) => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
            return obj;
        });
}

// Transforma filas Excel en operaciones Firestore ({ coleccion, docId, docData })
function buildFirestoreOps(filas, colMap, idField, coleccion, resolverNombre) {
    const ops = [];
    filas.forEach(fila => {
        const docData = {};
        Object.keys(fila).forEach(col => {
            const field = colMap[normCol(col)];
            if (!field || field.startsWith('_')) return;   // omitir campos ficticios
            const raw = fila[col];
            let val = (raw === null || raw === undefined) ? '' : String(raw).trim();
            if (typeof raw === 'number' && NUM_FIELDS.has(field)) val = String(raw);
            if (val !== '') docData[field] = val;
        });
        if (coleccion === 'ofertas' && docData.estado) {
            docData.estado = APROBACION_NORM[docData.estado.toLowerCase()] || docData.estado;
        }
        if (coleccion === 'produccion' && resolverNombre) {
            TEC_FIELDS.forEach(f => {
                if (docData[f]) {
                    const nombre = resolverNombre(docData[f]);
                    if (nombre) docData[f] = nombre;
                }
            });
        }
        const docId = docData[idField];
        if (!docId) return;
        if (Object.keys(docData).filter(k => k !== idField).length === 0) return;
        ops.push({ coleccion, docId, docData });
    });
    return ops;
}

// ─── GRAPH API HELPERS ────────────────────────────────────────────────────────

async function getMsToken() {
    const resp = await axios.post(
        `https://login.microsoftonline.com/${process.env.SHAREPOINT_TENANT_ID}/oauth2/v2.0/token`,
        new URLSearchParams({
            grant_type:    "client_credentials",
            client_id:     process.env.SHAREPOINT_CLIENT_ID,
            client_secret: process.env.SHAREPOINT_CLIENT_SECRET,
            scope:         "https://graph.microsoft.com/.default",
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return resp.data.access_token;
}

// siteId, driveId e itemId cacheados 24 h en Firestore
async function getSpIds(token) {
    const cacheRef  = db.doc("metadata/sharepoint_ids");
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
        const c = cacheSnap.data();
        if (c.cached_at && (Date.now() - c.cached_at) < 86400000 && c.driveId) {
            return { siteId: c.siteId, driveId: c.driveId, itemId: c.itemId };
        }
    }
    const urlObj   = new URL(SP_SITE_URL);
    const siteResp = await axios.get(
        `https://graph.microsoft.com/v1.0/sites/${urlObj.hostname}:${urlObj.pathname}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const siteId = siteResp.data.id;

    const drivesResp = await axios.get(
        `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const drive = drivesResp.data.value.find((d) => d.name === SP_LIBRARY_NAME);
    if (!drive) throw new Error(`Biblioteca '${SP_LIBRARY_NAME}' no encontrada.`);
    const driveId = drive.id;

    const fileResp = await axios.get(
        `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/root:/${encodeURIComponent(SP_FILE_NAME)}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const itemId = fileResp.data.id;

    await cacheRef.set({ siteId, driveId, itemId, cached_at: Date.now() });
    logger.info("🔗 SharePoint IDs resueltos y cacheados", { siteId, driveId, itemId });
    return { siteId, driveId, itemId };
}

// Índice de columna (1-based) → letras Excel  (1→A, 26→Z, 27→AA…)
function colLetter(n) {
    let s = "";
    while (n > 0) { s = String.fromCharCode(64 + ((n - 1) % 26 + 1)) + s; n = Math.floor((n - 1) / 26); }
    return s;
}

async function readSheet(token, siteId, driveId, itemId, sheetName, nCols) {
    const sheet = encodeURIComponent(sheetName);
    const base  = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${itemId}/workbook/worksheets/${sheet}`;

    // Paso 1: obtener la columna real usada (petición ligera, solo metadatos).
    // Se respeta la columna real del Excel (puede superar nCols: las cabeceras reales
    // no siempre están en el mismo orden/posición que COL_MAP, recortar por nCols
    // puede dejar fuera columnas como VB CLIENTE, FECHA AP o FECHA AR).
    // OJO: el número de FILA de usedRange no es fiable (a veces infrarrepresenta los
    // datos reales tras borrados/formatos), así que las filas se leen con un tope fijo.
    let endCol = colLetter(nCols || 60);
    const endRow = 5000;
    try {
        const addrResp = await axios.get(`${base}/usedRange?$select=address`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const address  = (addrResp.data.address || '').split('!').pop(); // "A1:BF423"
        const colMatch = address.match(/([A-Z]+)\d+$/);
        if (colMatch) endCol = colMatch[1];
        logger.info(`📊 readSheet "${sheetName}" usedRange: ${address} → hasta col ${endCol}`);
    } catch (e) {
        logger.warn(`⚠️ usedRange address falló para "${sheetName}": ${e.message} — usando col ${endCol}`);
    }

    // Paso 2: leer values solo con las columnas y filas necesarias
    const resp = await axios.get(`${base}/range(address='A1:${endCol}${endRow}')`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const values = resp.data.values || [];
    logger.info(`📊 readSheet "${sheetName}": ${values.length} filas × col ${endCol}`);
    return values;
}

async function writeSheet(token, siteId, driveId, itemId, sheetName, headers, rows) {
    const data   = [headers, ...rows];
    const nRows  = data.length;
    const nCols  = headers.length;
    const endCol = colLetter(nCols);
    const sheet  = encodeURIComponent(sheetName);
    const base   = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${itemId}/workbook/worksheets/${sheet}`;

    await axios.post(`${base}/range(address='A1:${endCol}5000')/clear`,
        { applyTo: "Contents" },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
    await axios.patch(`${base}/range(address='A1:${endCol}${nRows}')`,
        { values: data },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
    logger.info(`✅ SharePoint "${sheetName}" actualizado: ${rows.length} filas`);
}

// ─── NÚCLEO: SHAREPOINT → FIRESTORE ─────────────────────────────────────────
// Función reutilizada tanto por el callable manual como por la tarea programada.

async function runSyncToFirestore() {
    const token = await getMsToken();
    const { siteId, driveId, itemId } = await getSpIds(token);

    // Secuencial: la API de Excel Online no admite peticiones paralelas sobre el mismo libro
    const vOfe  = await readSheet(token, siteId, driveId, itemId, SP_SHEET_OFERTAS,    OFERTAS_HEADERS.length    + 8);
    const vProd = await readSheet(token, siteId, driveId, itemId, SP_SHEET_PRODUCCION, PRODUCCION_HEADERS.length + 8);

    const filasOfe  = parseRows(vOfe);
    const filasProd = parseRows(vProd);

    // Cargar lista de técnicos de Firestore para resolver acrónimos → nombres
    const tecSnap      = await db.doc('listas_config/tecnicos').get();
    const listaTec     = tecSnap.exists ? (tecSnap.data().items || []) : [];
    const resolverNombre = (val) => {
        if (!val) return null;
        const upper = String(val).trim().toUpperCase();
        const tec   = listaTec.find(t => (t.acronimo || '').toUpperCase() === upper);
        return (tec && (tec.nombre_pila || tec.nombre)) || null;
    };

    const opsOfe  = buildFirestoreOps(filasOfe,  COL_MAP_OFE,  'num_gestiona', 'ofertas',    null);
    const opsProd = buildFirestoreOps(filasProd, COL_MAP_PROD, 'num_trabajo',  'produccion', resolverNombre);

    // Campos que gestiona la web: la web tiene prioridad, pero si está vacía se acepta el valor del Excel.
    // Solo leemos de Firestore los documentos donde el Excel trae algún campo PROD_WEB_ONLY con valor
    // (el resto ya viene filtrado vacío por buildFirestoreOps y no llega a op.docData).
    const opsWithWebOnly = opsProd.filter(op => [...PROD_WEB_ONLY].some(f => f in op.docData));
    if (opsWithWebOnly.length > 0) {
        const chunkSize = 200;
        const existingMap = {};
        for (let i = 0; i < opsWithWebOnly.length; i += chunkSize) {
            const chunk = opsWithWebOnly.slice(i, i + chunkSize);
            const refs  = chunk.map(op => db.collection('produccion').doc(op.docId));
            const snaps = await db.getAll(...refs);
            snaps.forEach(snap => { existingMap[snap.id] = snap.exists ? snap.data() : {}; });
        }
        opsWithWebOnly.forEach(op => {
            const existing = existingMap[op.docId] || {};
            PROD_WEB_ONLY.forEach(f => {
                if (!(f in op.docData)) return;
                const webVal = existing[f];
                if (webVal !== undefined && webVal !== null && String(webVal).trim() !== '') {
                    delete op.docData[f]; // web tiene valor → no sobreescribir
                }
                // web vacío → dejar pasar el valor del Excel
            });
        });
    }

    const allOps = [...opsOfe, ...opsProd];

    // Escritura en Firestore en lotes de 499 (límite de batch)
    for (let i = 0; i < allOps.length; i += 499) {
        const batch = db.batch();
        allOps.slice(i, i + 499).forEach(({ coleccion, docId, docData }) => {
            batch.set(db.collection(coleccion).doc(docId), docData, { merge: true });
        });
        await batch.commit();
    }

    logger.info(`✅ runSyncToFirestore: ${opsOfe.length} ofertas, ${opsProd.length} producciones escritas`);
    return { ofertas: opsOfe.length, produccion: opsProd.length };
}

// ─── SYNC FIRESTORE → SHAREPOINT (triggers por cambio en Firestore) ───────────

async function runSyncToSharePoint(coleccion, sheetName, headers, buildRow) {
    const lockRef  = db.doc(`metadata/sharepoint_sync_${coleccion}`);
    const lockSnap = await lockRef.get();
    const lastSync = lockSnap.data()?.last_sync_ms || 0;

    if (Date.now() - lastSync < 15000) {
        await lockRef.set({ pending: true, last_sync_ms: lastSync }, { merge: true });
        logger.info(`⏳ Sync ${coleccion} diferido (<15 s desde la última sync)`);
        return;
    }
    await lockRef.set({ last_sync_ms: Date.now(), pending: false }, { merge: true });

    const snap = await db.collection(coleccion).get();
    const rows = [];
    snap.forEach((d) => rows.push(buildRow(d.id, d.data())));

    const token = await getMsToken();
    const { siteId, driveId, itemId } = await getSpIds(token);
    await writeSheet(token, siteId, driveId, itemId, sheetName, headers, rows);

    const after = await lockRef.get();
    if (after.data()?.pending) {
        await lockRef.set({ pending: false }, { merge: true });
        await runSyncToSharePoint(coleccion, sheetName, headers, buildRow);
    }
}

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

exports.syncOfertasToSharePoint = onDocumentWritten({
    document:       "ofertas/{docId}",
    secrets:        SP_SECRETS,
    timeoutSeconds: 120,
    memory:         "256MiB",
}, async () => {
    try {
        await runSyncToSharePoint("ofertas", SP_SHEET_OFERTAS, OFERTAS_HEADERS, ofertaToRow);
    } catch (err) {
        logger.error("❌ syncOfertasToSharePoint:", err.message, err.response?.data);
    }
});

exports.syncProduccionToSharePoint = onDocumentWritten({
    document:       "produccion/{docId}",
    secrets:        SP_SECRETS,
    timeoutSeconds: 120,
    memory:         "256MiB",
}, async () => {
    try {
        await runSyncToSharePoint("produccion", SP_SHEET_PRODUCCION, PRODUCCION_HEADERS,
            (_id, d) => produccionToRow(d));
    } catch (err) {
        logger.error("❌ syncProduccionToSharePoint:", err.message, err.response?.data);
    }
});

// ─── SYNC SHAREPOINT → FIRESTORE (callable manual desde la web) ───────────────
exports.syncFromSharePoint = onCall({
    secrets:        SP_SECRETS,
    timeoutSeconds: 300,
    memory:         "1GiB",
}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");

    const { coleccion } = request.data;
    if (!["ofertas", "produccion", "ambos"].includes(coleccion)) {
        throw new HttpsError("invalid-argument", "coleccion debe ser 'ofertas', 'produccion' o 'ambos'.");
    }

    try {
        const token = await getMsToken();
        const { siteId, driveId, itemId } = await getSpIds(token);

        if (coleccion === "ambos") {
            const vOfe  = await readSheet(token, siteId, driveId, itemId, SP_SHEET_OFERTAS,    OFERTAS_HEADERS.length    + 8);
            const vProd = await readSheet(token, siteId, driveId, itemId, SP_SHEET_PRODUCCION, PRODUCCION_HEADERS.length + 8);
            const ofertas    = parseRows(vOfe);
            const produccion = parseRows(vProd);
            logger.info(`📥 syncFromSharePoint ambos: ${ofertas.length} ofertas, ${produccion.length} producción`);
            return { ofertas, produccion };
        }

        const sheetName = coleccion === "ofertas" ? SP_SHEET_OFERTAS : SP_SHEET_PRODUCCION;
        const colCount  = (coleccion === "ofertas" ? OFERTAS_HEADERS.length : PRODUCCION_HEADERS.length) + 8;
        const values    = await readSheet(token, siteId, driveId, itemId, sheetName, colCount);
        const filas     = parseRows(values);
        logger.info(`📥 syncFromSharePoint ${coleccion}: ${filas.length} filas`);
        return { filas };
    } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 400) : '';
        logger.error("❌ syncFromSharePoint:", err.message, detail, err.response?.data);
        throw new HttpsError("internal", `Error leyendo SharePoint: ${err.message}${detail ? ' | ' + detail : ''}`);
    }
});

// ─── SYNC AUTOMÁTICA PROGRAMADA (SharePoint → Firestore) ─────────────────────
// Cada 30 minutos en horario laboral (lunes-viernes, 8:00-19:30, hora Madrid)
exports.scheduledSyncFromSharePoint = onSchedule({
    schedule:       "0,30 8-19 * * 1-5",
    timeZone:       "Europe/Madrid",
    secrets:        SP_SECRETS,
    timeoutSeconds: 300,
    memory:         "1GiB",
}, async () => {
    logger.info("⏰ Iniciando sync automática desde SharePoint...");
    try {
        const result = await runSyncToFirestore();
        logger.info(`✅ Sync automática completada: ${result.ofertas} ofertas, ${result.produccion} producciones`);
    } catch (err) {
        logger.error("❌ Sync automática falló:", err.message, err.response?.data);
    }
});
