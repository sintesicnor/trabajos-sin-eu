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

    // Datos de prueba para el panel de gasto por usuario del Chat IA: dos
    // conversaciones de DOS usuarios normales distintos, cada una con un
    // mensaje de coste conocido.
    const ahora = new Date();
    await db.collection('chats_ia').doc('chat-lector').set({
      usuario_uid: 'lector-uid', usuario_email: 'lector@tesicnor.com', titulo: 'Chat de lector',
      modelo_actual: 'gemini-2.5-flash-lite', fecha_creacion: ahora, fecha_actualizacion: ahora,
      num_mensajes: 1, coste_total_eur: 1.5, archivado: false,
    });
    await db.collection('chats_ia/chat-lector/mensajes').doc('msg-lector').set({
      usuario_uid: 'lector-uid', rol: 'assistant', contenido: 'Respuesta', modelo: 'gemini-2.5-flash-lite',
      fecha: ahora, tokens_entrada: 10, tokens_salida: 10, coste_eur: 1.5, coste_verificado: false,
    });
    await db.collection('chats_ia').doc('chat-admin').set({
      usuario_uid: 'admin-uid', usuario_email: 'admin@tesicnor.com', titulo: 'Chat de admin',
      modelo_actual: 'gemini-2.5-flash-lite', fecha_creacion: ahora, fecha_actualizacion: ahora,
      num_mensajes: 1, coste_total_eur: 2.75, archivado: false,
    });
    await db.collection('chats_ia/chat-admin/mensajes').doc('msg-admin').set({
      usuario_uid: 'admin-uid', rol: 'assistant', contenido: 'Respuesta', modelo: 'gemini-2.5-flash-lite',
      fecha: ahora, tokens_entrada: 10, tokens_salida: 10, coste_eur: 2.75, coste_verificado: false,
    });
  });

  const admin = testEnv.authenticatedContext('admin-uid', { email: 'admin@tesicnor.com' });
  const lector = testEnv.authenticatedContext('lector-uid', { email: 'lector@tesicnor.com' });
  const atoledo = testEnv.authenticatedContext('atoledo-uid', { email: 'atoledo@tesicnor.com' });
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

  // 10. Panel de gasto por usuario del Chat IA: SOLO atoledo@tesicnor.com
  // puede leer chats_ia y mensajes de otros usuarios; nadie más, ni siquiera
  // el rol admin general (isAdminSIN), debe poder hacer estas consultas
  // amplias sin filtrar por usuario_uid.
  await assertSucceeds(
    atoledo.firestore().collection('chats_ia').get()
  ).then(() => check('atoledo CAN list chats_ia without usuario_uid filter (todos los usuarios)', true))
   .catch(() => check('atoledo CAN list chats_ia without usuario_uid filter (todos los usuarios)', false));

  await assertSucceeds(
    atoledo.firestore().collectionGroup('mensajes').where('rol', '==', 'assistant').get()
  ).then(() => check('atoledo CAN query collectionGroup(mensajes) across ALL users', true))
   .catch(() => check('atoledo CAN query collectionGroup(mensajes) across ALL users', false));

  await assertSucceeds(
    atoledo.firestore().collection('chats_ia').doc('chat-lector').get()
  ).then(() => check('atoledo CAN read a single chat_ia doc belonging to another user', true))
   .catch(() => check('atoledo CAN read a single chat_ia doc belonging to another user', false));

  await assertFails(
    lector.firestore().collection('chats_ia').get()
  ).then(() => check('regular user (lector) CANNOT list chats_ia without usuario_uid filter', true))
   .catch(() => check('regular user (lector) CANNOT list chats_ia without usuario_uid filter', false));

  await assertFails(
    admin.firestore().collection('chats_ia').get()
  ).then(() => check('general admin role (not atoledo) CANNOT list chats_ia without usuario_uid filter', true))
   .catch(() => check('general admin role (not atoledo) CANNOT list chats_ia without usuario_uid filter', false));

  await assertFails(
    lector.firestore().collectionGroup('mensajes').where('rol', '==', 'assistant').get()
  ).then(() => check('regular user (lector) CANNOT query collectionGroup(mensajes) across all users', true))
   .catch(() => check('regular user (lector) CANNOT query collectionGroup(mensajes) across all users', false));

  // 11. Regresion: las consultas propias de un usuario normal deben seguir
  // funcionando exactamente igual que antes de anadir el panel de admin.
  await assertSucceeds(
    lector.firestore().collection('chats_ia').where('usuario_uid', '==', 'lector-uid').get()
  ).then(() => check('regular user (lector) CAN still list their OWN chats_ia (regresion)', true))
   .catch(() => check('regular user (lector) CAN still list their OWN chats_ia (regresion)', false));

  await assertSucceeds(
    lector.firestore().collectionGroup('mensajes').where('usuario_uid', '==', 'lector-uid').where('fecha', '>=', new Date(0)).get()
  ).then(() => check('regular user (lector) CAN still query their OWN mensajes by date (regresion)', true))
   .catch(() => check('regular user (lector) CAN still query their OWN mensajes by date (regresion)', false));

  // ─── PROYECTOS IA ────────────────────────────────────────────────────────
  const tecnico2 = testEnv.authenticatedContext('tecnico2-uid', { email: 'tecnico2@tesicnor.com' });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const ahora = new Date();
    const proyectoBase = {
      descripcion: '', instrucciones: '', contexto_texto: '', contexto_archivos: [],
      memoria: '', memoria_actualizada: null, num_mensajes_total: 0,
      memoria_num_mensajes_en_ultima_actualizacion: 0, permitir_edicion_miembros: false,
      fecha_creacion: ahora, fecha_actualizacion: ahora, archivado: false,
    };
    await db.collection('proyectos_ia').doc('proy-privado-lector').set({
      ...proyectoBase, propietario_uid: 'lector-uid', propietario_email: 'lector@tesicnor.com',
      nombre: 'Proyecto privado de lector', visibilidad: 'privado', modo_colaboracion: 'individual',
    });
    await db.collection('proyectos_ia').doc('proy-publico-individual').set({
      ...proyectoBase, propietario_uid: 'admin-uid', propietario_email: 'admin@tesicnor.com',
      nombre: 'Proyecto publico individual', visibilidad: 'publico', modo_colaboracion: 'individual',
    });
    await db.collection('proyectos_ia').doc('proy-publico-grupal').set({
      ...proyectoBase, propietario_uid: 'admin-uid', propietario_email: 'admin@tesicnor.com',
      nombre: 'Proyecto publico grupal', visibilidad: 'publico', modo_colaboracion: 'grupal',
    });

    const chatBase = {
      modelo_actual: 'gemini-2.5-flash-lite', fecha_creacion: ahora, fecha_actualizacion: ahora,
      num_mensajes: 0, coste_total_eur: 0, archivado: false,
    };
    await db.collection('chats_ia').doc('chat-proy-individual-admin').set({
      ...chatBase, usuario_uid: 'admin-uid', usuario_email: 'admin@tesicnor.com', titulo: 'Chat individual admin',
      proyecto_id: 'proy-publico-individual', proyecto_visibilidad: 'publico', proyecto_modo_colaboracion: 'individual',
    });
    await db.collection('chats_ia/chat-proy-individual-admin/mensajes').doc('msg-privado-admin').set({
      usuario_uid: 'admin-uid', rol: 'user', contenido: 'Mensaje privado de admin', fecha: ahora,
    });
    await db.collection('chats_ia').doc('chat-proy-grupal').set({
      ...chatBase, usuario_uid: 'admin-uid', usuario_email: 'admin@tesicnor.com', titulo: 'Canal del equipo',
      proyecto_id: 'proy-publico-grupal', proyecto_visibilidad: 'publico', proyecto_modo_colaboracion: 'grupal',
    });
  });

  const ahora = new Date();
  const nuevoProyectoBase = {
    propietario_uid: 'lector-uid', propietario_email: 'lector@tesicnor.com',
    nombre: 'Nuevo', descripcion: '', instrucciones: '', contexto_texto: '',
    contexto_archivos: [], memoria: '', memoria_actualizada: null,
    num_mensajes_total: 0, memoria_num_mensajes_en_ultima_actualizacion: 0,
    visibilidad: 'privado', modo_colaboracion: 'individual', permitir_edicion_miembros: false,
    fecha_creacion: ahora, fecha_actualizacion: ahora, archivado: false,
  };

  // 12. Crear proyecto propio: OK
  await assertSucceeds(
    lector.firestore().collection('proyectos_ia').add({ ...nuevoProyectoBase })
  ).then(() => check('user CAN create their own proyecto_ia', true))
   .catch(() => check('user CAN create their own proyecto_ia', false));

  // 13. Crear proyecto suplantando a otro propietario: bloqueado
  await assertFails(
    lector.firestore().collection('proyectos_ia').add({
      ...nuevoProyectoBase, propietario_uid: 'admin-uid', propietario_email: 'admin@tesicnor.com',
    })
  ).then(() => check('user CANNOT create proyecto_ia impersonating another propietario_uid', true))
   .catch(() => check('user CANNOT create proyecto_ia impersonating another propietario_uid', false));

  // 13b. Regresión de bug real: cuentas Microsoft pueden tener distinta
  // capitalización entre auth.currentUser.email (usado por el cliente para
  // rellenar propietario_email) y request.auth.token.email (usado por la
  // regla) — propietario_email NO debe validarse por igualdad exacta contra
  // el token, solo es un campo denormalizado para mostrar "creado por".
  const tecnicoMayus = testEnv.authenticatedContext('tecnico-mayus-uid', { email: 'Juan.Perez@TesicNor.com' });
  await assertSucceeds(
    tecnicoMayus.firestore().collection('proyectos_ia').add({
      ...nuevoProyectoBase, propietario_uid: 'tecnico-mayus-uid', propietario_email: 'juan.perez@tesicnor.com',
    })
  ).then(() => check('user CAN create proyecto_ia even if auth email casing differs from propietario_email', true))
   .catch(() => check('user CAN create proyecto_ia even if auth email casing differs from propietario_email', false));

  // 14. Leer proyecto privado ajeno: bloqueado (usa un usuario NO admin — un
  // admin real puede leer cualquier proyecto via isAdminSIN(), por diseño,
  // igual que ya ocurre con chats_ia)
  await assertFails(
    atoledo.firestore().collection('proyectos_ia').doc('proy-privado-lector').get()
  ).then(() => check("non-admin user CANNOT read ANOTHER user's private proyecto_ia", true))
   .catch(() => check("non-admin user CANNOT read ANOTHER user's private proyecto_ia", false));

  // 15. Leer proyecto publico ajeno: permitido
  await assertSucceeds(
    lector.firestore().collection('proyectos_ia').doc('proy-publico-individual').get()
  ).then(() => check("user CAN read ANOTHER user's public proyecto_ia", true))
   .catch(() => check("user CAN read ANOTHER user's public proyecto_ia", false));

  // 16. Propietario edita instrucciones: OK
  await assertSucceeds(
    lector.firestore().collection('proyectos_ia').doc('proy-privado-lector').update({ instrucciones: 'Nuevas instrucciones' })
  ).then(() => check('owner CAN edit instrucciones on their own proyecto_ia', true))
   .catch(() => check('owner CAN edit instrucciones on their own proyecto_ia', false));

  // 17. No propietario sin permiso intenta editar contenido de proyecto publico: bloqueado
  await assertFails(
    lector.firestore().collection('proyectos_ia').doc('proy-publico-individual').update({ instrucciones: 'Intento ajeno' })
  ).then(() => check('non-owner WITHOUT permitir_edicion_miembros CANNOT edit content of a public proyecto_ia', true))
   .catch(() => check('non-owner WITHOUT permitir_edicion_miembros CANNOT edit content of a public proyecto_ia', false));

  // 18. Propietario activa permitir_edicion_miembros
  await assertSucceeds(
    admin.firestore().collection('proyectos_ia').doc('proy-publico-individual').update({ permitir_edicion_miembros: true })
  ).then(() => check('owner CAN toggle permitir_edicion_miembros', true))
   .catch(() => check('owner CAN toggle permitir_edicion_miembros', false));

  // 19. Ahora un miembro SI puede editar contenido...
  await assertSucceeds(
    lector.firestore().collection('proyectos_ia').doc('proy-publico-individual').update({ instrucciones: 'Editado por miembro' })
  ).then(() => check('non-owner WITH permitir_edicion_miembros CAN edit content', true))
   .catch(() => check('non-owner WITH permitir_edicion_miembros CAN edit content', false));

  // 20. ...pero NO puede tocar visibilidad aunque tenga permiso de contenido
  await assertFails(
    lector.firestore().collection('proyectos_ia').doc('proy-publico-individual').update({ visibilidad: 'privado' })
  ).then(() => check('non-owner WITH permitir_edicion_miembros still CANNOT change visibilidad', true))
   .catch(() => check('non-owner WITH permitir_edicion_miembros still CANNOT change visibilidad', false));

  // 21. Nadie (ni el propio propietario) puede escribir memoria desde el cliente
  await assertFails(
    admin.firestore().collection('proyectos_ia').doc('proy-publico-individual').update({ memoria: 'Falsificada' })
  ).then(() => check('owner CANNOT write memoria field directly from client', true))
   .catch(() => check('owner CANNOT write memoria field directly from client', false));

  // 22. Nadie puede cambiar propietario_uid
  await assertFails(
    admin.firestore().collection('proyectos_ia').doc('proy-publico-individual').update({ propietario_uid: 'lector-uid' })
  ).then(() => check('owner CANNOT transfer propietario_uid', true))
   .catch(() => check('owner CANNOT transfer propietario_uid', false));

  // ─── chats_ia dentro de proyectos ──────────────────────────────────────
  const chatIndividualBase = {
    usuario_uid: 'tecnico2-uid', usuario_email: 'tecnico2@tesicnor.com', titulo: 'Mi chat en el proyecto',
    modelo_actual: 'gemini-2.5-flash-lite', fecha_creacion: ahora, fecha_actualizacion: ahora,
    num_mensajes: 0, coste_total_eur: 0, archivado: false,
  };

  // 23. Crear chat individual propio dentro de un proyecto publico-individual: OK
  await assertSucceeds(
    tecnico2.firestore().collection('chats_ia').add({
      ...chatIndividualBase, proyecto_id: 'proy-publico-individual',
      proyecto_visibilidad: 'publico', proyecto_modo_colaboracion: 'individual',
    })
  ).then(() => check('user CAN create their own chat inside a public individual proyecto', true))
   .catch(() => check('user CAN create their own chat inside a public individual proyecto', false));

  // 24. Crear chat dentro de un proyecto privado ajeno: bloqueado
  await assertFails(
    tecnico2.firestore().collection('chats_ia').add({
      ...chatIndividualBase, proyecto_id: 'proy-privado-lector',
      proyecto_visibilidad: 'privado', proyecto_modo_colaboracion: 'individual',
    })
  ).then(() => check("user CANNOT create a chat inside ANOTHER user's private proyecto", true))
   .catch(() => check("user CANNOT create a chat inside ANOTHER user's private proyecto", false));

  // 25. Crear chat con foto de proyecto falsificada (el proyecto real es individual, se declara grupal): bloqueado
  await assertFails(
    tecnico2.firestore().collection('chats_ia').add({
      ...chatIndividualBase, proyecto_id: 'proy-publico-individual',
      proyecto_visibilidad: 'publico', proyecto_modo_colaboracion: 'grupal',
    })
  ).then(() => check('user CANNOT spoof proyecto_modo_colaboracion when creating a project chat', true))
   .catch(() => check('user CANNOT spoof proyecto_modo_colaboracion when creating a project chat', false));

  // 26. Otro usuario NO puede leer el chat individual de admin dentro del proyecto publico-individual
  await assertFails(
    tecnico2.firestore().collection('chats_ia').doc('chat-proy-individual-admin').get()
  ).then(() => check("another member CANNOT read someone else's individual-mode project chat", true))
   .catch(() => check("another member CANNOT read someone else's individual-mode project chat", false));

  // 27. Cualquier usuario SI puede leer el chat grupal del proyecto publico-grupal
  await assertSucceeds(
    tecnico2.firestore().collection('chats_ia').doc('chat-proy-grupal').get()
  ).then(() => check('any user CAN read the shared chat of a public grupal proyecto', true))
   .catch(() => check('any user CAN read the shared chat of a public grupal proyecto', false));

  // 28. Un usuario ajeno puede publicar un mensaje en el chat grupal
  await assertSucceeds(
    tecnico2.firestore().collection('chats_ia/chat-proy-grupal/mensajes').add({
      usuario_uid: 'tecnico2-uid', rol: 'user', contenido: 'Hola equipo', fecha: ahora,
    })
  ).then(() => check('another member CAN post a message into the shared grupal chat', true))
   .catch(() => check('another member CAN post a message into the shared grupal chat', false));

  // 29. Ese mismo usuario puede leer los mensajes del chat grupal
  await assertSucceeds(
    tecnico2.firestore().collection('chats_ia/chat-proy-grupal/mensajes').get()
  ).then(() => check('another member CAN read messages of the shared grupal chat', true))
   .catch(() => check('another member CAN read messages of the shared grupal chat', false));

  // 30. Pero NO puede leer los mensajes de un chat individual ajeno
  await assertFails(
    tecnico2.firestore().collection('chats_ia/chat-proy-individual-admin/mensajes').get()
  ).then(() => check("another member CANNOT read messages of someone else's individual-mode chat", true))
   .catch(() => check("another member CANNOT read messages of someone else's individual-mode chat", false));

  // 31. Nadie puede reescribir proyecto_visibilidad de un chat existente desde el cliente
  await assertFails(
    admin.firestore().collection('chats_ia').doc('chat-proy-grupal').update({ proyecto_visibilidad: 'privado' })
  ).then(() => check('nobody CAN rewrite proyecto_visibilidad on an existing chat from the client', true))
   .catch(() => check('nobody CAN rewrite proyecto_visibilidad on an existing chat from the client', false));

  await testEnv.cleanup();

  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length > 0) {
    console.log('FAILED CHECKS:', failed.map(f => f.name));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
