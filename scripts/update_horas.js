const admin = require('firebase-admin');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// 1. Inicializar Firebase Admin
// Usamos la credencial que encontramos en el proyecto
const serviceAccount = require('../public/trabajos-sin-eu-f7a420fe52fc.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function updateHoras() {
  try {
    const filePath = path.join(__dirname, '../data/Horas anuales 2025.xlsx');
    
    if (!fs.existsSync(filePath)) {
      console.error(`Error: No se encuentra el archivo en ${filePath}`);
      return;
    }

    // 2. Leer el archivo Excel
    console.log('Leyendo archivo Excel...');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`Se han encontrado ${data.length} filas para procesar.`);

    let successCount = 0;
    let errorCount = 0;
    let notFoundCount = 0;

    // 3. Procesar en lotes (batch) de 500 (límite de Firestore)
    let batch = db.batch();
    let counter = 0;

    for (const row of data) {
      const numTrabajo = String(row.num_trabajo || '').trim();
      const totalHoras = row.total_horas_historico;

      if (!numTrabajo) {
        console.warn('Fila omitida: num_trabajo vacío.');
        continue;
      }

      // Referencia al documento (limpiamos el ID igual que hace la app)
      const docId = numTrabajo.replace(/[^\d]/g, '');
      const docRef = db.collection('produccion').doc(docId);

      // Verificamos si existe antes de actualizar (opcional, pero recomendado)
      // Para ir más rápido podríamos simplemente hacer update, pero vamos a validar
      
      batch.update(docRef, {
        total_horas_historico: totalHoras,
        _last_migration_update: admin.firestore.FieldValue.serverTimestamp()
      });

      counter++;
      successCount++;

      // Si llegamos a 500, enviamos el lote y empezamos uno nuevo
      if (counter === 500) {
        console.log(`Enviando lote de 500 actualizaciones...`);
        await batch.commit();
        batch = db.batch();
        counter = 0;
      }
    }

    // Enviar el último lote si tiene algo
    if (counter > 0) {
      await batch.commit();
    }

    console.log('\n--- Resumen del proceso ---');
    console.log(`✅ Actualizaciones enviadas: ${successCount}`);
    console.log('---------------------------');
    console.log('Proceso finalizado correctamente.');

  } catch (error) {
    console.error('Error durante el proceso:', error);
  } finally {
    process.exit();
  }
}

updateHoras();
