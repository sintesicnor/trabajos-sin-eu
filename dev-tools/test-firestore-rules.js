const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const results = [];
function check(name, pass) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name);
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'trabajos-sin-eu-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  // Seed data as admin (bypasses rules) — simulates existing production data
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('usuarios').doc('admin@tesicnor.com').set({ rol: 'admin' });
    await db.collection('usuarios').doc('lector@tesicnor.com').set({ rol: 'lectura' });
    await db.collection('listas_config').doc('tecnicos').set({ items: [
      { email: 'admin@tesicnor.com', rol: 'admin' },
      { email: 'lector@tesicnor.com', rol: 'lectura' },
    ] });
    await db.collection('configuracion').doc('permisos_roles').set({ admin: { ver_importes: true } });
    await db.collection('produccion').doc('trabajo1').set({ nombre: 'Trabajo 1' });
  });

  const admin = testEnv.authenticatedContext('admin-uid', { email: 'admin@tesicnor.com' });
  const lector = testEnv.authenticatedContext('lector-uid', { email: 'lector@tesicnor.com' });
  const anon = testEnv.unauthenticatedContext();

  // 1. Regular ('lectura') user must NOT be able to grant themselves admin via permisos_roles
  await assertFails(
    lector.firestore().collection('configuracion').doc('permisos_roles').set({ lectura: { ver_importes: true } })
  ).then(() => check('lectura user CANNOT write configuracion/permisos_roles', true))
   .catch(() => check('lectura user CANNOT write configuracion/permisos_roles', false));

  // 2. Regular user must NOT be able to rewrite the technicians list to make themselves admin
  await assertFails(
    lector.firestore().collection('listas_config').doc('tecnicos').set({ items: [
      { email: 'lector@tesicnor.com', rol: 'admin' },
    ] })
  ).then(() => check('lectura user CANNOT write listas_config/tecnicos', true))
   .catch(() => check('lectura user CANNOT write listas_config/tecnicos', false));

  // 3. Regular user must NOT be able to write their own usuarios/{email} doc to set rol: admin
  await assertFails(
    lector.firestore().collection('usuarios').doc('lector@tesicnor.com').set({ rol: 'admin' })
  ).then(() => check('lectura user CANNOT write usuarios/{self} to change own rol', true))
   .catch(() => check('lectura user CANNOT write usuarios/{self} to change own rol', false));

  // 4. Admin CAN still write permisos_roles (feature must keep working for admins)
  await assertSucceeds(
    admin.firestore().collection('configuracion').doc('permisos_roles').set({ lectura: { ver_importes: false } })
  ).then(() => check('admin CAN write configuracion/permisos_roles', true))
   .catch(() => check('admin CAN write configuracion/permisos_roles', false));

  // 5. Admin CAN still write listas_config/tecnicos (technician management must keep working)
  await assertSucceeds(
    admin.firestore().collection('listas_config').doc('tecnicos').set({ items: [
      { email: 'lector@tesicnor.com', rol: 'edicion' },
    ] })
  ).then(() => check('admin CAN write listas_config/tecnicos', true))
   .catch(() => check('admin CAN write listas_config/tecnicos', false));

  // 6. Admin CAN still change another user's rol via usuarios/{email}
  await assertSucceeds(
    admin.firestore().collection('usuarios').doc('lector@tesicnor.com').set({ rol: 'edicion' }, { merge: true })
  ).then(() => check('admin CAN write usuarios/{other} to change their rol', true))
   .catch(() => check('admin CAN write usuarios/{other} to change their rol', false));

  // 7. Everyday app usage must be unaffected: any authenticated user can still read/write produccion
  await assertSucceeds(
    lector.firestore().collection('produccion').doc('trabajo1').get()
  ).then(() => check('lectura user CAN still read produccion (unchanged behavior)', true))
   .catch(() => check('lectura user CAN still read produccion (unchanged behavior)', false));

  await assertSucceeds(
    lector.firestore().collection('produccion').doc('trabajo2').set({ nombre: 'Trabajo 2' })
  ).then(() => check('lectura user CAN still write produccion (unchanged behavior)', true))
   .catch(() => check('lectura user CAN still write produccion (unchanged behavior)', false));

  // 8. Preferences: user can write their own, but not someone else's
  await assertSucceeds(
    lector.firestore().collection('usuarios').doc('lector-uid').collection('preferencias').doc('configuracion_vista').set({ vistas_guardadas: [] })
  ).then(() => check('user CAN write their OWN preferencias', true))
   .catch(() => check('user CAN write their OWN preferencias', false));

  await assertFails(
    lector.firestore().collection('usuarios').doc('admin-uid').collection('preferencias').doc('configuracion_vista').set({ vistas_guardadas: [] })
  ).then(() => check('user CANNOT write ANOTHER user\'s preferencias', true))
   .catch(() => check('user CANNOT write ANOTHER user\'s preferencias', false));

  // 9. Unauthenticated users must still be fully blocked
  await assertFails(
    anon.firestore().collection('produccion').doc('trabajo1').get()
  ).then(() => check('unauthenticated user CANNOT read produccion', true))
   .catch(() => check('unauthenticated user CANNOT read produccion', false));

  await testEnv.cleanup();

  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length > 0) {
    console.log('FAILED CHECKS:', failed.map(f => f.name));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
