// Seeds the local Firestore emulator with realistic test data for local development
// and automated testing. Never touches production. Run with the emulator already
// started (FIRESTORE_EMULATOR_HOST set), e.g. via `firebase emulators:exec`.
const admin = require('firebase-admin');

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
admin.initializeApp({ projectId: 'trabajos-sin-eu' });
const db = admin.firestore();

async function seed() {
    await db.collection('usuarios').doc('demo@tesicnor.com').set({ rol: 'admin' });

    await db.collection('listas_config').doc('tecnicos').set({
        items: [
            { email: 'demo@tesicnor.com', acronimo: 'DEM', nombre: 'Demo Admin', nombre_pila: 'Demo', rol: 'admin' },
            { email: 'tecnico1@tesicnor.com', acronimo: 'JMR', nombre: 'Jokin Martinez', nombre_pila: 'Jokin', rol: 'edicion' },
        ],
    });
    await db.collection('listas_config').doc('servicios').set({ items: ['APQ', 'ATEX', 'RIESGOS'] });
    await db.collection('listas_config').doc('tipos_servicio').set({ items: ['APQ', 'ATEX', 'RIESGOS'] });
    await db.collection('listas_config').doc('oficinas').set({ items: ['Bilbao', 'Madrid'] });
    await db.collection('listas_config').doc('origenes').set({ items: ['Directo', 'Licitacion'] });
    await db.collection('listas_config').doc('tipos_expediente').set({ items: ['Normal', 'Interno'] });

    await db.collection('usuarios_activos').doc('demo@tesicnor.com').set({ activo: true, nombre: 'Demo Admin', acronimo: 'DEM' });

    await db.collection('settings').doc('global').set({ login_password_enabled: false });

    await db.collection('produccion').doc('T-0001').set({
        num_trabajo: 'T-0001', tipo_expediente: 'Normal', cliente: 'Cliente Prueba SA',
        servicio: 'APQ', tipo_servicio: 'APQ', grupo: '1', responsable_g: 'Jokin',
        fecha_inicio: '01/06/2026', fecha_fin: '30/06/2026', presupuesto_m: '1000', gastos_n: '100',
    });

    await db.collection('ofertas').doc('OF-0001').set({
        estado: 'En curso', num_gestiona: 'OF-0001', cliente: 'Cliente Prueba SA',
        oficina: 'Bilbao', servicio: 'APQ', agente_comercial: 'Demo', fecha_oferta: '01/05/2026',
        presupuesto_total: '2000',
    });

    await db.collection('suministro').doc('S-0001').set({
        id_trabajo: 'S-0001', cliente: 'Cliente Prueba SA', servicio: 'APQ',
    });

    console.log('✅ Emulator seeded with test data.');
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
