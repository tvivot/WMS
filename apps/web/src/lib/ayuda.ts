/**
 * Manual de usuario por pantalla. Lo muestra el botón "?" del header
 * (AyudaPanel): según la ruta actual y el tipo de actor (cliente del portal
 * o usuario interno) se eligen las secciones a mostrar.
 *
 * Escrito para gente NO técnica: pasos concretos, sin jerga.
 */

export interface SeccionAyuda {
  titulo: string;
  /** Párrafos explicativos (texto corrido). */
  parrafos?: string[];
  /** Lista numerada de pasos a seguir. */
  pasos?: string[];
  /** Si está, la sección solo se muestra a ese tipo de usuario. */
  solo?: 'cliente' | 'interno';
}

export interface AyudaPantalla {
  titulo: string;
  intro: string;
  secciones: SeccionAyuda[];
}

const ESTADOS: SeccionAyuda = {
  titulo: 'Los estados de una devolución (el recorrido completo)',
  parrafos: [
    'Cada devolución pasa por estos estados, siempre en este orden. No se pueden saltear pasos.',
  ],
  pasos: [
    'A Aprobar: alguien creó la solicitud y está esperando que la apruebe un usuario autorizado (Vendedor, Gerencial o Administrador).',
    'Aprobado: la solicitud fue aceptada. Recién ahora el cliente puede cargar los libros que va a devolver.',
    'En tránsito: el cliente terminó de cargar (libros, bultos, peso y transportista) y despachó la mercadería. Está viajando al depósito.',
    'Entregado: la mercadería llegó al depósito y se registró cuántos bultos llegaron.',
    'Ingreso a depósito: los bultos ya tienen una ubicación de espera dentro del depósito, listos para ser controlados.',
    'Procesado: el depósito controló todos los bultos, se comparó lo declarado contra lo recibido y la devolución quedó cerrada.',
  ],
};

const AYUDA_LISTA: AyudaPantalla = {
  titulo: 'Devoluciones — Pantalla principal',
  intro:
    'Acá ves todas las devoluciones a las que tenés acceso, en qué estado está cada una, y podés crear solicitudes nuevas.',
  secciones: [
    {
      titulo: 'Los contadores de arriba (tarjetas por estado)',
      parrafos: [
        'Cada tarjeta muestra cuántas devoluciones hay en ese estado. Si tocás una tarjeta, la lista de abajo se filtra y muestra solo las devoluciones de ese estado. Tocala de nuevo para quitar el filtro.',
      ],
    },
    {
      titulo: 'Cómo crear una solicitud de devolución',
      pasos: [
        'Tocá el botón "+ Nueva" arriba a la derecha.',
        'Si sos usuario de la empresa: buscá y elegí el cliente (por número o nombre). Si entraste como cliente, la solicitud es automáticamente tuya.',
        'Tocá "Crear solicitud". La devolución queda en estado "A Aprobar".',
        'Importante: todavía no se cargan los libros. Primero alguien con permiso tiene que aprobarla.',
      ],
    },
    {
      titulo: 'Cómo aprobar una solicitud pendiente',
      solo: 'interno',
      parrafos: [
        'Solo pueden aprobar los usuarios que tengan el permiso de aprobación (por defecto: Vendedor, Gerencial y Administrador).',
      ],
      pasos: [
        'Buscá la devolución en estado "A Aprobar" (podés tocar la tarjeta "A Aprobar" para filtrarlas).',
        'Tocá el botón verde "Aprobar" que aparece en la fila, o entrá al detalle (tocando el número) y usá "Aprobar solicitud".',
        'Una vez aprobada, el cliente ya puede cargar los libros y despachar.',
        'Si te corresponde aprobar y no ves el botón: cerrá sesión y volvé a entrar (los permisos se actualizan al iniciar sesión). Si sigue sin aparecer, pedile al Administrador que revise tu rol en la sección Usuarios.',
      ],
    },
    {
      titulo: 'La grilla (lista de devoluciones)',
      parrafos: [
        'Podés ordenar por cualquier columna tocando su título (un toque ordena de menor a mayor, otro invierte el orden).',
        'Con el botón "Columnas" (arriba a la derecha de la grilla) elegís qué columnas ver u ocultar. Tu elección queda guardada en este dispositivo.',
        'Tocá el número (por ejemplo #12) para entrar al detalle de esa devolución y operar sobre ella.',
      ],
    },
    ESTADOS,
  ],
};

const AYUDA_DETALLE: AyudaPantalla = {
  titulo: 'Detalle de una devolución',
  intro:
    'Esta pantalla muestra todo lo que pasó con una devolución y te ofrece la acción que corresponde según su estado y tus permisos. Si no ves botones de acción, es porque el paso actual le toca a otra persona.',
  secciones: [
    ESTADOS,
    {
      titulo: 'Paso 1 — Aprobar la solicitud (Vendedor / Gerencial / Administrador)',
      solo: 'interno',
      parrafos: [
        'Si la devolución está "A Aprobar" y tenés el permiso, vas a ver el botón "Aprobar solicitud". Al aprobarla, el cliente queda habilitado para cargar los libros.',
      ],
    },
    {
      titulo: 'Paso 2 — Declarar y despachar (lo hace el cliente)',
      parrafos: [
        'Con la devolución "Aprobada", aparece el panel "Declarar devolución". Acá cargás qué libros devolvés y cómo los mandás.',
      ],
      pasos: [
        'Escaneá el código de barras (ISBN) de cada libro: con la cámara del celular, con un lector USB, o escribiendo el número y tocando agregar.',
        'Al escanear, aparece el título del libro con cantidad 1. Si volvés a escanear el mismo libro, la cantidad suma sola. También podés escribir la cantidad directamente en el casillero.',
        'Si el sistema dice que el código no existe en el catálogo, avisá a la empresa: ese libro no se puede cargar hasta que esté en el catálogo.',
        'Indicá en cuántos bultos (cajas/paquetes) va la mercadería y el peso total en kilos.',
        'Elegí el transportista con el que la enviás (es obligatorio para despachar).',
        '"Guardar" deja todo anotado para seguir después. "Despachar" cierra la carga y avisa al depósito que la mercadería está en camino (estado "En tránsito"). Después de despachar ya no se puede modificar la carga.',
      ],
    },
    {
      titulo: 'Paso 3 — Recepción (Depósito)',
      solo: 'interno',
      pasos: [
        'Cuando llega la mercadería, contá los bultos recibidos y anotalos en el panel "Recepción".',
        'Si la cantidad recibida no coincide con la declarada, el sistema te exige escribir una observación explicando la diferencia. No bloquea: se registra y se sigue.',
        'Al confirmar, la devolución pasa a "Entregado".',
      ],
    },
    {
      titulo: 'Paso 4 — Ingreso a depósito (Depósito)',
      solo: 'interno',
      pasos: [
        'Si querés, indicá en qué ubicación física quedan los bultos esperando el control (por ejemplo "DEV-01"). Es opcional e informativo: podés registrar el ingreso sin completarla.',
        'Al registrar, la devolución pasa a "Ingreso a depósito" y ya se puede controlar.',
      ],
    },
    {
      titulo: 'Paso 5 — Control bulto por bulto (Depósito)',
      solo: 'interno',
      parrafos: [
        'Se abre cada bulto y se cuenta lo que realmente vino. Un mismo título puede venir repartido en varios bultos: no hay problema, el sistema después suma todo.',
      ],
      pasos: [
        'Tocá el bulto para abrirlo y escaneá cada libro que contiene (la cantidad suma sola al re-escanear).',
        'Si un libro está dañado, cargá cuántos ejemplares están en mal estado en el casillero "mal". El resto se considera bueno (para la venta).',
        'Pesá el bulto y anotá el peso.',
        'Tocá "Marcar controlado". Si se corta internet, no perdés nada: el control queda guardado en el dispositivo y se envía solo cuando vuelve la conexión.',
      ],
    },
    {
      titulo: 'Paso 6 — Cierre y destinos (Depósito)',
      solo: 'interno',
      pasos: [
        'Solo se puede cerrar cuando TODOS los bultos figuran como controlados.',
        'Si querés, indicá a qué ubicación van los libros buenos (estantería de venta o pallet) y a cuál van los dañados (zona de dañados o cuarentena). Son datos informativos y opcionales: podés cerrar y procesar sin completarlos.',
        'Si la suma de los pesos de los bultos no coincide con el peso declarado, el sistema pide una observación.',
        'Al tocar "Cerrar y procesar", la devolución queda "Procesada" y se muestra la reconciliación: por cada título, cuánto se declaró, cuánto llegó, cuánto bueno y cuánto malo.',
      ],
    },
    {
      titulo: 'Corrección de un control (solo Administrador)',
      solo: 'interno',
      parrafos: [
        'Si después de procesar se detecta un error de carga, el Administrador puede corregir el contenido de un bulto desde el panel "Corrección". La devolución no se reabre: se reemplaza el control de ese bulto, queda registrado quién lo corrigió y por qué, y se recalcula la reconciliación.',
      ],
    },
    {
      titulo: '¿Por qué no veo botones para operar?',
      parrafos: [
        'Cada paso lo hace un rol distinto: aprobar (Vendedor/Gerencial/Admin), cargar y despachar (el cliente), recibir/ingresar/controlar (Depósito). Si el paso actual no te corresponde, esta pantalla te muestra los datos pero no los botones.',
        'Si creés que deberías ver una acción y no aparece: cerrá sesión y volvé a entrar. Si sigue igual, el Administrador puede revisar tus permisos en la sección Roles y Usuarios.',
      ],
    },
  ],
};

const AYUDA_INFORMES: AyudaPantalla = {
  titulo: 'Informes',
  intro:
    'Tablero con números y gráficos para entender cómo vienen las devoluciones: cuántas hay, en qué estado están y la calidad de lo que vuelve.',
  secciones: [
    {
      titulo: 'Cómo leer los indicadores (KPIs)',
      parrafos: [
        'Las tarjetas de arriba resumen los totales: cantidad de devoluciones, cuántas están terminadas (procesadas), cuántas en curso, y los libros recibidos con su estado (buenos vs dañados).',
      ],
    },
    {
      titulo: 'Los gráficos',
      parrafos: [
        'Pasá el mouse (o el dedo) por encima de un gráfico para ver el valor exacto de cada barra o porción.',
        'Distribución por estado: cuántas devoluciones hay en cada paso del circuito; sirve para detectar cuellos de botella (por ejemplo, muchas "A Aprobar" acumuladas).',
        'Buen estado vs mal estado: qué proporción de los libros devueltos llega en condiciones de venderse.',
      ],
    },
  ],
};

const AYUDA_CATALOGO: AyudaPantalla = {
  titulo: 'Catálogo de productos',
  intro:
    'El catálogo es la lista maestra de libros que el sistema reconoce. Cuando alguien escanea un código de barras (ISBN), acá se busca el título. Si un libro no está en el catálogo, no se puede declarar ni controlar.',
  secciones: [
    {
      titulo: 'Qué es cada dato',
      parrafos: [
        'Código interno: el identificador propio de la empresa para el producto.',
        'ISBN: el código de barras impreso en el libro. Un mismo título puede tener más de un ISBN (reimpresiones, ediciones); todos apuntan al mismo producto.',
        'Título y editorial: lo que ven el cliente y el depósito al escanear.',
      ],
    },
    {
      titulo: 'Cómo se carga el catálogo',
      parrafos: [
        'La carga masiva la hace el sistema de gestión de la empresa en forma automática (por la API). Desde esta pantalla podés consultar, agregar o corregir productos puntuales.',
        'Si un escaneo da "ISBN no catalogado", lo más probable es que falte cargar ese producto acá.',
      ],
    },
  ],
};

const AYUDA_CLIENTES: AyudaPantalla = {
  titulo: 'Clientes',
  intro:
    'Administración de los clientes que pueden operar devoluciones. Cada cliente entra al portal con su número de cliente y una clave.',
  secciones: [
    {
      titulo: 'Cómo dar de alta un cliente',
      pasos: [
        'Tocá "+ Cliente" y completá número, nombre y dirección.',
        'La clave podés elegirla vos (escribila en el campo "Clave", mínimo 8 caracteres) o dejar el campo vacío para que el sistema genere una automática.',
        'Si la generó el sistema: anotala y entregásela al cliente — por seguridad no se vuelve a mostrar — y al primer ingreso se le pedirá cambiarla. Si la elegiste vos, queda como definitiva.',
      ],
    },
    {
      titulo: 'Cambiar o resetear la clave de un cliente',
      pasos: [
        'Tocá el botón "Clave" en la fila del cliente.',
        'Escribí la clave nueva que quieras asignarle, o tocá "Generar automática".',
        'Entregale la clave al cliente. Si fue generada, deberá cambiarla al entrar; si la escribiste vos, queda definitiva.',
        'El reseteo también desbloquea al cliente si quedó bloqueado por intentos fallidos.',
      ],
    },
    {
      titulo: 'Activar / desactivar un cliente',
      parrafos: [
        'Tocando la etiqueta de estado (Activo/Inactivo) se cambia. Un cliente inactivo no puede entrar al portal ni crear devoluciones, y no aparece al buscar clientes; sus devoluciones viejas se conservan como historial. Se puede reactivar cuando haga falta.',
      ],
    },
    {
      titulo: 'Clientes importados desde el sistema de gestión',
      parrafos: [
        'Los clientes que entran por la importación automática quedan SIN clave de portal: no pueden loguear hasta que les asignes una con el botón "Clave".',
      ],
    },
  ],
};

const AYUDA_TRANSPORTISTAS: AyudaPantalla = {
  titulo: 'Transportistas',
  intro:
    'Lista de transportistas disponibles. El cliente tiene que elegir uno obligatoriamente al despachar una devolución, así el depósito sabe con quién llega la mercadería.',
  secciones: [
    {
      titulo: 'Cómo se administra',
      parrafos: [
        'Con "+ Transportista" agregás uno nuevo. Si un transportista deja de usarse, desactivalo: deja de aparecer como opción para los clientes pero las devoluciones viejas conservan el dato.',
        'Si un cliente avisa que no puede despachar porque no hay transportistas para elegir, revisá que haya al menos uno activo acá.',
      ],
    },
  ],
};

const AYUDA_USUARIOS: AyudaPantalla = {
  titulo: 'Usuarios',
  intro:
    'Administración de las personas de la empresa que usan el sistema (vendedores, gerencia, depósito, administradores). Los clientes NO se cargan acá: van en la sección Clientes.',
  secciones: [
    {
      titulo: 'Cómo crear un usuario',
      pasos: [
        'Tocá "+ Usuario" y completá usuario (con el que va a loguear), nombre y email.',
        'Elegí uno o más roles: el rol define qué puede hacer (ver la sección Roles).',
        'La clave podés escribirla vos (mínimo 8 caracteres, queda definitiva) o dejar el campo vacío para que se genere una automática (en ese caso, al primer ingreso se le pedirá cambiarla).',
        'Anotá la clave y entregásela: por seguridad no se vuelve a mostrar.',
      ],
    },
    {
      titulo: 'Cambiar o resetear una clave',
      parrafos: [
        'Botón "Clave" en la fila del usuario: escribís la clave nueva o generás una automática. También desbloquea la cuenta si quedó bloqueada por intentos fallidos.',
      ],
    },
    {
      titulo: 'Roles y permisos: por qué alguien "no ve" una sección o un botón',
      parrafos: [
        'Lo que cada usuario ve y puede hacer depende de los permisos de sus roles. Por ejemplo, para aprobar devoluciones hace falta el permiso de aprobación (lo tienen Vendedor, Gerencial y Administrador por defecto).',
        'Importante: si le cambiás el rol a alguien, el cambio se aplica cuando esa persona cierra sesión y vuelve a entrar.',
      ],
    },
    {
      titulo: 'Activar / desactivar',
      parrafos: [
        'Un usuario inactivo no puede entrar al sistema. Usalo cuando alguien deja la empresa o no debe operar más; no hace falta borrarlo.',
      ],
    },
  ],
};

const AYUDA_ROLES: AyudaPantalla = {
  titulo: 'Roles y permisos',
  intro:
    'Un rol es un paquete de permisos. A cada usuario se le asignan roles, y los permisos de esos roles definen exactamente qué puede hacer en el sistema. Acá podés crear roles nuevos o cambiar qué permisos tiene cada uno.',
  secciones: [
    {
      titulo: 'Los roles que vienen armados',
      parrafos: [
        'Cliente: crea devoluciones propias, carga los libros y despacha. Solo ve lo suyo.',
        'Vendedor: crea solicitudes para sus clientes, puede aprobarlas y ve informes.',
        'Gerencial: como Vendedor, y además administra clientes.',
        'Depósito: recibe la mercadería, registra el ingreso y hace el control de los bultos.',
        'Administrador: puede hacer todo, incluida la administración de usuarios y roles.',
      ],
    },
    {
      titulo: 'Permisos importantes (qué habilita cada uno)',
      parrafos: [
        'Crear solicitud: permite crear devoluciones nuevas.',
        'Aprobar solicitud: habilita el botón "Aprobar" de las devoluciones pendientes. Es configurable: se lo podés dar a quien decida la empresa.',
        'Recibir / Ingresar / Controlar (depósito): los tres pasos del circuito en el depósito.',
        'Administrar clientes / usuarios / roles / catálogo / transportistas: habilitan las secciones de administración correspondientes.',
        'Ver informes: habilita la sección Informes.',
      ],
    },
    {
      titulo: 'Cuándo se aplican los cambios',
      parrafos: [
        'Si cambiás los permisos de un rol, los usuarios que lo tienen ven el cambio la próxima vez que inicien sesión. Si alguien no ve un botón que debería ver, pedile que cierre sesión y vuelva a entrar.',
      ],
    },
  ],
};

const AYUDA_CONFIGURACION: AyudaPantalla = {
  titulo: 'Configuración',
  intro:
    'Acá se administran las integraciones del WMS con sistemas externos y algunas tareas de mantenimiento. Es una pantalla de uso ocasional, pensada para el Administrador.',
  secciones: [
    {
      titulo: 'Portadas desde WooCommerce (imágenes de los libros)',
      parrafos: [
        'El sistema completa solo la portada de los productos que no tienen imagen, buscándola en la tienda WooCommerce por el código del libro (SKU = ISBN). Tener portada ayuda a reconocer el libro de un vistazo al escanear y controlar.',
        'Esta sincronización corre sola en el servidor cada 48 horas. Desde acá podés forzar una corrida manual si necesitás las imágenes ya.',
      ],
    },
    {
      titulo: 'Cómo forzar una actualización de portadas',
      pasos: [
        'Tocá "Actualizar portadas ahora".',
        'Esperá a que termine: procesa hasta 200 productos por corrida y al final muestra cuántas portadas actualizó, cuántas revisó y cuántas quedaron sin imagen.',
        'Si dice "No hay productos pendientes de portada", está todo al día.',
      ],
    },
    {
      titulo: 'Si dice "No configurado" o "Faltan variables de entorno"',
      parrafos: [
        'Significa que faltan cargar en el servidor las credenciales de la tienda (WOO_URL, WOO_KEY y WOO_SECRET). Hasta que estén, el botón queda deshabilitado.',
        'Esto lo resuelve quien administra el servidor: se cargan las tres variables en Hostinger (hPanel → Variables de entorno) y se reinicia/redeploya la app, porque los cambios de entorno recién toman efecto al reiniciar.',
      ],
    },
  ],
};

const AYUDA_STOCK: AyudaPantalla = {
  titulo: 'Stock de Devoluciones',
  intro:
    'Muestra qué libros hay físicamente en el depósito provenientes de devoluciones que todavía no se procesaron, y en qué devolución está cada uno.',
  secciones: [
    {
      titulo: 'Qué cuenta como stock acá',
      parrafos: [
        'Aparecen los libros de las devoluciones que ya llegaron al depósito (estados "Entregado" e "Ingreso a depósito") y aún no se cerraron.',
        'La cantidad mostrada es la DECLARADA por el cliente ("en principio" lo que viene en los bultos). El conteo real bulto por bulto se ve al controlar y procesar la devolución.',
        'Cuando una devolución se PROCESA, sus libros dejan de aparecer en este stock: a partir de ahí el stock real lo lleva el módulo de Inventario.',
      ],
    },
    {
      titulo: 'Buscar un libro y ver dónde está',
      pasos: [
        'Usá el buscador de la grilla para encontrar un libro por título o ISBN.',
        'Hacé doble clic sobre el libro para abrir el detalle.',
        'El detalle lista en qué devoluciones está ese libro, con la cantidad por devolución y el contenido completo (todos los libros y cantidades) de cada una.',
        'Desde ahí podés abrir la devolución con el número (#) para operarla.',
      ],
    },
  ],
};

const POR_RUTA: { prefijo: string; ayuda: AyudaPantalla }[] = [
  { prefijo: '/stock-devoluciones', ayuda: AYUDA_STOCK },
  { prefijo: '/devoluciones/', ayuda: AYUDA_DETALLE },
  { prefijo: '/devoluciones', ayuda: AYUDA_LISTA },
  { prefijo: '/informes', ayuda: AYUDA_INFORMES },
  { prefijo: '/catalogo', ayuda: AYUDA_CATALOGO },
  { prefijo: '/clientes', ayuda: AYUDA_CLIENTES },
  { prefijo: '/transportistas', ayuda: AYUDA_TRANSPORTISTAS },
  { prefijo: '/usuarios', ayuda: AYUDA_USUARIOS },
  { prefijo: '/roles', ayuda: AYUDA_ROLES },
  { prefijo: '/configuracion', ayuda: AYUDA_CONFIGURACION },
];

/**
 * Devuelve el manual de la pantalla actual, con las secciones filtradas
 * según el tipo de actor (un cliente no ve la operatoria interna del depósito).
 */
export function ayudaPara(
  pathname: string,
  tipoActor: 'usuario' | 'cliente' | undefined,
): AyudaPantalla | null {
  const match = POR_RUTA.find((r) => pathname.startsWith(r.prefijo));
  if (!match) return null;
  const esCliente = tipoActor === 'cliente';
  return {
    ...match.ayuda,
    secciones: match.ayuda.secciones.filter((s) => {
      if (!s.solo) return true;
      return esCliente ? s.solo === 'cliente' : s.solo === 'interno';
    }),
  };
}
