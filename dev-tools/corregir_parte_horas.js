// Herramienta de correccion manual para partes_horas (Firestore, proyecto trabajos-sin-eu).
//
// Corrige el caso en que una linea de horas se corrigio en el ERP pero la
// sincronizacion automatica (data/sincronizar_partes.ps1) no propago el
// cambio porque el filtro incremental (HoraSer >= syncFrom) no volvio a
// seleccionar la fila editada.
//
// CREDENCIALES: no incluye ninguna clave. Usa Application Default
// Credentials, así que antes de ejecutar hay que iniciar sesion con una
// cuenta que tenga permisos de Firestore sobre el proyecto trabajos-sin-eu:
//   gcloud auth application-default login
// (o exportar GOOGLE_APPLICATION_CREDENTIALS apuntando a una service account
// key con rol de Firestore).
//
// USO:
//   Buscar (no escribe nada):
//     node dev-tools/corregir_parte_horas.js --fecha 2026-08-07 --of 2026001848 --trabajador Belen
//
//   Corregir tras confirmar cual es el documento correcto:
//     node dev-tools/corregir_parte_horas.js --doc erp_12345 --horas 7 --apply

const admin = require('firebase-admin');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  admin.initializeApp({ projectId: 'trabajos-sin-eu' });
  const db = admin.firestore();
  const col = db.collection('partes_horas');

  // Modo directo: ya sabemos el ID del documento (tras haberlo localizado en una busqueda previa)
  if (args.doc) {
    const ref = col.doc(args.doc);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error(`No existe ningun documento con id "${args.doc}"`);
      process.exit(1);
    }
    console.log('Documento actual:', JSON.stringify(snap.data(), null, 2));

    if (!args.horas) {
      console.log('\n(Modo consulta: pasa --horas <n> --apply para corregirlo)');
      return;
    }
    const nuevasHoras = Number(args.horas);
    if (Number.isNaN(nuevasHoras)) {
      console.error('--horas debe ser un numero, p.ej. --horas 7');
      process.exit(1);
    }
    if (!args.apply) {
      console.log(`\n(Simulacion) Se cambiaria horas: ${snap.data().horas} -> ${nuevasHoras}`);
      console.log('Anade --apply para aplicar el cambio de verdad.');
      return;
    }
    await ref.update({ horas: nuevasHoras });
    console.log(`Corregido: ${args.doc} -> horas=${nuevasHoras}`);
    return;
  }

  // Modo busqueda: por fecha + OF (+ trabajador opcional) para localizar el/los documentos candidatos
  if (!args.fecha) {
    console.error('Falta --fecha (formato YYYY-MM-DD) o --doc <id>. Ver cabecera del script para el uso.');
    process.exit(1);
  }

  const candidatos = new Map();

  if (args.of) {
    const snap = await col.where('proyecto_id', '==', String(args.of)).get();
    snap.forEach(d => candidatos.set(d.id, d.data()));
  }

  const snapFecha = await col.where('fecha', '==', args.fecha).get();
  snapFecha.forEach(d => candidatos.set(d.id, d.data()));

  let resultados = [...candidatos.entries()];
  if (args.trabajador) {
    const needle = String(args.trabajador).toLowerCase();
    resultados = resultados.filter(([, d]) => (d.trabajador || '').toLowerCase().includes(needle));
  }
  if (args.of) {
    resultados = resultados.filter(([, d]) => String(d.proyecto_id) === String(args.of) || (d.observaciones_crudas || '').includes(args.of));
  }

  if (resultados.length === 0) {
    console.log('Sin coincidencias con esos filtros.');
    return;
  }

  console.log(`${resultados.length} documento(s) encontrados:\n`);
  resultados.forEach(([id, d]) => {
    console.log(`  id=${id}`);
    console.log('  ' + JSON.stringify(d));
    console.log('');
  });
  console.log('Para corregir uno en concreto:');
  console.log(`  node dev-tools/corregir_parte_horas.js --doc <id> --horas <n> --apply`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('ERROR', e); process.exit(1); });
