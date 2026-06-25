import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, PencilLine, Trash2, Truck, Upload, X } from 'lucide-react';
import { api } from '../../lib/api';
import { enviarControl } from '../../lib/outbox';
import { useAuth } from '../../lib/auth';
import { PERMISOS, ESTADOS_ORDEN, ESTADO_LABEL, type Estado } from '../../lib/estados';
import { Card, EstadoBadge, Field, ProductoThumb, Spinner } from '../../components/ui';
import { Scanner } from '../../components/Scanner';
import type { ProductoLite } from '../../lib/producto';

interface Linea { id: number; isbn: string; cantidad: number; productoId: number | null; titulo: string | null; editorial: string | null; imagenUrl: string | null }
interface Control { id: number; isbn: string; cantidad: number; malEstado: number; titulo: string | null; editorial: string | null; imagenUrl: string | null }
interface Bulto { id: number; numero: number; peso: string | null; estadoControl: string; controles: Control[] }
type ExcepcionEstado = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
interface Excepcion {
  id: number; isbn: string; cantidad: number; estado: ExcepcionEstado;
  titulo: string | null; editorial: string | null; imagenUrl: string | null;
  motivoSolicitud: string | null; motivoResolucion: string | null; createdAt: string;
}
interface Detalle {
  id: number; estado: Estado; clienteId: number; depositoId: number;
  transportistaId: number | null;
  cliente: { id: number; nroCliente: string; nombre: string } | null;
  transportista: { id: number; nombre: string } | null;
  creadoPor: { tipo: 'usuario' | 'cliente'; nombre: string } | null;
  motivo: { id: number; nombre: string } | null;
  cantidadUnidades: number | null;
  bultosDeclarados: number | null; pesoTotalDeclarado: string | null; bultosRecibidos: number | null;
  ubicacionEspera: string | null; ubicacionDestinoBueno: string | null; ubicacionDestinoMalo: string | null;
  observaciones: string | null; declaraciones: Linea[]; bultos: Bulto[]; excepciones: Excepcion[];
}
interface TransportistaOpcion { id: number; nombre: string }

interface FilaControl { isbn: string; titulo: string; editorial: string | null; imagenUrl: string | null; cantidad: number; malEstado: number }
type ResultadoGuardar = { encolado?: true } | void;
/** Forma que devuelve /catalogo/productos/por-isbn (resolución de un escaneo). */
type ProductoResuelto = ProductoLite & { id: number; codigoInterno: string };

export function DevolucionDetalle() {
  const { id } = useParams();
  const { puede } = useAuth();
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    api.get<Detalle>(`/devoluciones/autorizaciones/${id}`).then(setD).catch((e) => setError(e.message));
  }, [id]);
  useEffect(cargar, [cargar]);

  const accion = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!d) return <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link to="/devoluciones" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold tabnum">Devolución #{d.id}</h1>
        <EstadoBadge estado={d.estado} />
      </div>

      <Stepper estado={d.estado} />

      {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg" role="alert">{error}</p>}

      {/* Panel de acción según estado + permiso */}
      {d.estado === 'A_APROBAR' && puede(PERMISOS.SOLICITUD_APROBAR) && (
        <Card>
          <h2 className="font-semibold mb-1">Solicitud pendiente de aprobación</h2>
          <p className="text-sm text-slate-500 mb-3">
            Al aprobarla, el cliente va a poder cargar los libros y despachar la devolución.
          </p>
          <button className="btn-accent" onClick={() => accion(() => api.patch(`/devoluciones/autorizaciones/${d.id}/aprobar`))}>
            <CheckCircle2 className="h-4 w-4" /> Aprobar solicitud
          </button>
        </Card>
      )}

      {d.estado === 'A_APROBAR' && !puede(PERMISOS.SOLICITUD_APROBAR) && (
        <Card className="border-amber-200">
          <h2 className="font-semibold text-amber-700 mb-1">Esperando aprobación</h2>
          <p className="text-sm text-slate-600">
            La solicitud todavía no fue aprobada. La aprueba un usuario con permiso de aprobación
            (por defecto: Vendedor, Gerencial o Administrador) entrando a esta devolución o con el
            botón <b>Aprobar</b> de la lista. Cuando esté aprobada vas a poder cargar los libros.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            ¿Tendrías que poder aprobar y no ves el botón? Cerrá sesión y volvé a entrar: los
            permisos se actualizan al iniciar sesión.
          </p>
        </Card>
      )}

      {d.estado === 'APROBADO' && puede(PERMISOS.SOLICITUD_CREAR) && (
        <PanelDeclaracion d={d} onDone={cargar} onError={setError} />
      )}

      {(d.estado === 'APROBADO' || d.excepciones.length > 0) && (
        <PanelExcepciones d={d} onDone={cargar} onError={setError} />
      )}

      {d.estado === 'EN_TRANSITO' && puede(PERMISOS.DEPOSITO_RECIBIR) && (
        <PanelRecibir d={d} onAccion={accion} />
      )}

      {d.estado === 'ENTREGADO' && puede(PERMISOS.DEPOSITO_INGRESAR) && (
        <PanelIngreso onAccion={accion} id={d.id} />
      )}

      {d.estado === 'INGRESO_DEPOSITO' && puede(PERMISOS.DEPOSITO_CONTROLAR) && (
        <PanelControl d={d} onDone={cargar} onError={setError} />
      )}

      {d.estado === 'PROCESADO' && <PanelReconciliacion id={d.id} d={d} />}

      {d.estado === 'PROCESADO' && puede(PERMISOS.DEVOLUCION_CORREGIR) && (
        <PanelCorreccion d={d} onDone={cargar} onError={setError} />
      )}

      <ResumenDatos d={d} />
    </div>
  );
}

function Stepper({ estado }: { estado: Estado }) {
  const idx = ESTADOS_ORDEN.indexOf(estado);
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {ESTADOS_ORDEN.map((e, i) => (
        <div key={e} className="flex items-center gap-1 shrink-0">
          <div className={`h-2 w-2 rounded-full ${i <= idx ? 'bg-brand-green-ink' : 'bg-slate-300'}`} />
          <span className={`text-xs ${i === idx ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
            {ESTADO_LABEL[e]}
          </span>
          {i < ESTADOS_ORDEN.length - 1 && <div className={`h-px w-4 ${i < idx ? 'bg-brand-green-ink' : 'bg-slate-200'}`} />}
        </div>
      ))}
    </div>
  );
}

interface LineaDecl { isbn: string; titulo: string; editorial: string | null; imagenUrl: string | null; cantidad: number }

function PanelDeclaracion({ d, onDone, onError }: { d: Detalle; onDone: () => void; onError: (s: string) => void }) {
  const [lineas, setLineas] = useState<LineaDecl[]>(
    d.declaraciones.map((l) => ({
      isbn: l.isbn, titulo: l.titulo ?? l.isbn, editorial: l.editorial, imagenUrl: l.imagenUrl, cantidad: l.cantidad,
    })),
  );
  const [bultos, setBultos] = useState(String(d.bultosDeclarados ?? ''));
  const [transportistas, setTransportistas] = useState<TransportistaOpcion[]>([]);
  const [transportistaId, setTransportistaId] = useState<string>(
    d.transportistaId ? String(d.transportistaId) : '',
  );
  const [guardado, setGuardado] = useState(false);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    api.get<TransportistaOpcion[]>('/transportistas').then(setTransportistas).catch(() => setTransportistas([]));
  }, []);

  // Importación desde Excel/CSV: suma las líneas importadas a las ya cargadas
  // (autosuma por ISBN, igual que el escaneo). El cliente las ve y puede
  // editarlas/quitarlas antes de guardar → siempre controla lo que envía.
  const importar = (imp: LineaDecl[]) => {
    setGuardado(false);
    setLineas((prev) => {
      const map = new Map(prev.map((l) => [l.isbn, { ...l }]));
      for (const l of imp) {
        const ya = map.get(l.isbn);
        if (ya) ya.cantidad += l.cantidad;
        else map.set(l.isbn, { ...l });
      }
      return [...map.values()];
    });
  };

  // Suma una unidad del producto (autosuma si el ISBN ya está en la lista).
  const sumar = (p: ProductoLite) => {
    setGuardado(false);
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.isbn === p.isbn);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], cantidad: copy[i].cantidad + 1 };
        return copy;
      }
      return [...prev, { isbn: p.isbn, titulo: p.titulo, editorial: p.editorial, imagenUrl: p.imagenUrl, cantidad: 1 }];
    });
  };

  // Quita un libro de la declaración. Permitido mientras la devolución no se
  // despachó (este panel solo se muestra en estado APROBADO). Al guardar,
  // declarar() reemplaza las líneas → la quitada se elimina en el backend.
  const quitar = (isbn: string) => {
    setGuardado(false);
    setLineas((prev) => prev.filter((l) => l.isbn !== isbn));
  };

  // Escaneo/wedge: resuelve el código por ISBN y suma (trae título + portada).
  const agregar = async (codigo: string) => {
    try {
      const p = await api.get<ProductoResuelto>(`/catalogo/productos/por-isbn/${codigo}`);
      sumar(p);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // Guarda como BORRADOR: manda lo que haya. Bultos vacíos van como undefined
  // (no se exigen hasta despachar). Lanza si falla: quien la llame decide (el botón
  // muestra el error; "despachar" NO debe seguir si el guardado falló).
  const guardarOLanzar = async () => {
    await api.patch(`/devoluciones/autorizaciones/${d.id}/declaracion`, {
      lineas: lineas.map((l) => ({ isbn: l.isbn, cantidad: l.cantidad })),
      bultosDeclarados: bultos.trim() ? Number(bultos) : undefined,
      transportistaId: transportistaId ? Number(transportistaId) : undefined,
    });
  };

  const guardar = async () => {
    try {
      await guardarOLanzar();
      setGuardado(true);
      onDone();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const despachar = async () => {
    // Pre-checks con mensajes claros (el backend igual valida el gate completo).
    if (lineas.length === 0) {
      onError('Cargá al menos un libro antes de despachar.');
      return;
    }
    if (!bultos.trim() || Number(bultos) < 1) {
      onError('Indicá la cantidad de bultos antes de despachar.');
      return;
    }
    if (!transportistaId) {
      onError('Elegí el transportista antes de despachar.');
      return;
    }
    try {
      await guardarOLanzar();
      await api.patch(`/devoluciones/autorizaciones/${d.id}/despachar`);
      onDone();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Card>
      <h2 className="font-semibold mb-1">Declarar devolución</h2>
      <p className="text-sm text-slate-500 mb-3">
        Cargá los libros y guardá cuando quieras: la devolución queda editable hasta que la
        despaches. Al <b>despachar</b> la cerrás (pasa a <i>En tránsito</i>) y ya no se modifica.
      </p>
      <Scanner onScan={agregar} onElegir={sumar} />

      <div className="mt-3">
        {!importando ? (
          <button type="button" className="btn-outline !py-1.5 text-sm" onClick={() => setImportando(true)}>
            <FileSpreadsheet className="h-4 w-4" /> Importar desde Excel/CSV
          </button>
        ) : (
          <ImportarExcel
            autorizacionId={d.id}
            onImportar={importar}
            onError={onError}
            onClose={() => setImportando(false)}
          />
        )}
      </div>

      <div className="mt-4 space-y-2">
        {lineas.map((l, i) => (
          <div key={l.isbn} className="flex items-center gap-3 text-sm">
            <ProductoThumb producto={l} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{l.titulo}</span>
              <span className="block truncate text-xs text-slate-400 tabnum">{l.isbn}</span>
            </span>
            <input
              type="number" min={1} value={l.cantidad}
              onChange={(e) => { setGuardado(false); setLineas((p) => p.map((x, j) => (j === i ? { ...x, cantidad: Number(e.target.value) } : x))); }}
              className="input w-20 h-9 tabnum text-center"
            />
            <button
              type="button"
              onClick={() => quitar(l.isbn)}
              aria-label={`Quitar ${l.titulo}`}
              title="Quitar libro"
              className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {lineas.length === 0 && <p className="text-sm text-slate-400">Escaneá o buscá un ISBN para sumar líneas.</p>}
      </div>
      <div className="mt-4">
        <Field label="Bultos"><input className="input tabnum" inputMode="numeric" value={bultos} onChange={(e) => { setGuardado(false); setBultos(e.target.value); }} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Transportista" hint={transportistas.length === 0 ? 'No hay transportistas cargados: pedile al depósito que cargue uno.' : undefined}>
          <select className="input" value={transportistaId} onChange={(e) => { setGuardado(false); setTransportistaId(e.target.value); }}>
            <option value="">Elegir transportista…</option>
            {transportistas.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button className="btn-outline" onClick={guardar}>Guardar</button>
        <button className="btn-accent" onClick={despachar}>
          <Truck className="h-4 w-4" /> Despachar
        </button>
        {guardado && (
          <span className="inline-flex items-center gap-1 text-sm text-brand-green-ink">
            <CheckCircle2 className="h-4 w-4" /> Guardado
          </span>
        )}
      </div>
    </Card>
  );
}

interface ColumnaArchivo { indice: number; encabezado: string; ejemplo: string | null }
interface LineaImportada { isbn: string; cantidad: number; productoId: number | null; titulo: string | null; editorial: string | null; imagenUrl: string | null }
interface ErrorImportacion { fila: number; isbn: string | null; cantidad: string | null; motivo: string }
interface PreviewImportacion {
  columnas: ColumnaArchivo[];
  mapeo: { isbnCol: number | null; cantidadCol: number | null; tieneEncabezado: boolean };
  resultado: { lineas: LineaImportada[]; errores: ErrorImportacion[]; filasLeidas: number; totalUnidades: number; truncado: boolean } | null;
}

/**
 * Importación de líneas desde un Excel/CSV (cliente que procesó la devolución en
 * otro sistema). Flujo: subir archivo → elegir columna de ISBN y de cantidad
 * (con auto-detección) → revisar qué libros/cantidades se importan → aceptar.
 * El backend NO persiste: solo previsualiza. Al aceptar, las líneas se cargan en
 * la declaración editable y recién se confirman al guardar/despachar.
 */
function ImportarExcel({ autorizacionId, onImportar, onError, onClose }: {
  autorizacionId: number;
  onImportar: (lineas: LineaDecl[]) => void;
  onError: (s: string) => void;
  onClose: () => void;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [columnas, setColumnas] = useState<ColumnaArchivo[]>([]);
  const [isbnCol, setIsbnCol] = useState('');
  const [cantidadCol, setCantidadCol] = useState('');
  const [tieneEncabezado, setTieneEncabezado] = useState(true);
  const [resultado, setResultado] = useState<PreviewImportacion['resultado']>(null);
  const [busy, setBusy] = useState(false);

  const llamar = async (
    file: File,
    opts: { encabezado: boolean; isbnCol?: string; cantidadCol?: string },
  ) => {
    const form = new FormData();
    form.append('archivo', file);
    form.append('tieneEncabezado', String(opts.encabezado));
    if (opts.isbnCol) form.append('isbnCol', opts.isbnCol);
    if (opts.cantidadCol) form.append('cantidadCol', opts.cantidadCol);
    setBusy(true);
    onError('');
    try {
      const r = await api.upload<PreviewImportacion>(
        `/devoluciones/autorizaciones/${autorizacionId}/declaracion/importar`,
        form,
      );
      setColumnas(r.columnas);
      if (r.mapeo.isbnCol) setIsbnCol(String(r.mapeo.isbnCol));
      if (r.mapeo.cantidadCol) setCantidadCol(String(r.mapeo.cantidadCol));
      setResultado(r.resultado);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (f: File | null) => {
    setArchivo(f);
    setResultado(null); setColumnas([]); setIsbnCol(''); setCantidadCol('');
    if (f) llamar(f, { encabezado: tieneEncabezado });
  };

  const cambiarEncabezado = (v: boolean) => {
    setTieneEncabezado(v);
    // Conserva el mapeo ya elegido al cambiar si la primera fila es encabezado.
    if (archivo) llamar(archivo, { encabezado: v, isbnCol: isbnCol || undefined, cantidadCol: cantidadCol || undefined });
  };

  const previsualizar = () => {
    if (archivo && isbnCol && cantidadCol) {
      llamar(archivo, { encabezado: tieneEncabezado, isbnCol, cantidadCol });
    }
  };

  const aceptar = () => {
    if (!resultado || resultado.lineas.length === 0) return;
    onImportar(
      resultado.lineas.map((l) => ({
        isbn: l.isbn, titulo: l.titulo ?? l.isbn, editorial: l.editorial, imagenUrl: l.imagenUrl, cantidad: l.cantidad,
      })),
    );
    onClose();
  };

  const opcionCol = (c: ColumnaArchivo) =>
    `${c.encabezado}${c.ejemplo ? ` (ej: ${c.ejemplo.slice(0, 24)})` : ''}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-brand-green-ink" /> Importar desde Excel/CSV</h3>
        <button type="button" className="text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Cerrar importación"><X className="h-4 w-4" /></button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Subí el archivo (.xlsx o .csv) que exportaste de tu sistema y elegí en qué columna está el
        ISBN y en cuál la cantidad. Vas a poder revisar qué se importa antes de aceptarlo.
      </p>

      <label className="inline-flex items-center gap-2 cursor-pointer btn-outline !py-1.5 text-sm">
        <Upload className="h-4 w-4" /> {archivo ? 'Cambiar archivo' : 'Elegir archivo'}
        <input
          type="file" accept=".xlsx,.csv" className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {archivo && <span className="ml-2 text-xs text-slate-500">{archivo.name}</span>}

      {busy && <p className="text-xs text-slate-400 mt-3 inline-flex items-center gap-2"><Spinner className="text-slate-400" /> Procesando archivo…</p>}

      {columnas.length > 0 && (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={tieneEncabezado} onChange={(e) => cambiarEncabezado(e.target.checked)} />
            La primera fila es un encabezado (títulos de columna)
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Columna del ISBN">
              <select className="input" value={isbnCol} onChange={(e) => setIsbnCol(e.target.value)}>
                <option value="">Elegir…</option>
                {columnas.map((c) => <option key={c.indice} value={c.indice}>{opcionCol(c)}</option>)}
              </select>
            </Field>
            <Field label="Columna de la cantidad">
              <select className="input" value={cantidadCol} onChange={(e) => setCantidadCol(e.target.value)}>
                <option value="">Elegir…</option>
                {columnas.map((c) => <option key={c.indice} value={c.indice}>{opcionCol(c)}</option>)}
              </select>
            </Field>
          </div>
          <button type="button" className="btn-outline !py-1.5 text-sm" disabled={busy || !isbnCol || !cantidadCol} onClick={previsualizar}>
            Previsualizar importación
          </button>
        </div>
      )}

      {resultado && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-3">
            <span className="font-semibold text-slate-700">{resultado.lineas.length} título(s) · {resultado.totalUnidades} unidad(es)</span>
            {resultado.errores.length > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-4 w-4" /> {resultado.errores.length} fila(s) con problema</span>
            )}
          </div>

          {resultado.lineas.length > 0 ? (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {resultado.lineas.map((l) => (
                <div key={l.isbn} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <ProductoThumb producto={{ isbn: l.isbn, titulo: l.titulo ?? l.isbn, editorial: l.editorial, imagenUrl: l.imagenUrl }} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{l.titulo ?? l.isbn}</span>
                    <span className="block truncate text-xs text-slate-400 tabnum">{l.isbn}</span>
                  </span>
                  <span className="tabnum font-medium">{l.cantidad}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No se reconoció ningún libro con ese mapeo de columnas.</p>
          )}

          {resultado.errores.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-amber-700 font-medium">Ver {resultado.errores.length} fila(s) con problema</summary>
              <div className="mt-2 max-h-40 overflow-y-auto rounded border border-amber-200 bg-amber-50 divide-y divide-amber-100">
                {resultado.errores.map((er, i) => (
                  <div key={`${er.fila}-${i}`} className="px-2 py-1 flex justify-between gap-2">
                    <span className="text-slate-600">Fila {er.fila}{er.isbn ? ` · ${er.isbn}` : ''}</span>
                    <span className="text-amber-700">{er.motivo}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {resultado.truncado && (
            <p className="mt-2 text-xs text-amber-700">Se procesaron las primeras 5000 filas del archivo (tope). Dividí el archivo si hay más.</p>
          )}

          <button type="button" className="btn-accent mt-4 disabled:opacity-50" disabled={resultado.lineas.length === 0} onClick={aceptar}>
            <CheckCircle2 className="h-4 w-4" /> Aceptar importación
          </button>
        </div>
      )}
    </div>
  );
}

const EXC_COLOR: Record<ExcepcionEstado, string> = {
  PENDIENTE: 'bg-amber-100 text-amber-700',
  APROBADA: 'bg-emerald-100 text-emerald-700',
  RECHAZADA: 'bg-red-100 text-red-700',
};

/** Excepciones de consignación: el cliente solicita autorizar un libro fuera de
 *  su consignación; Gerencia (permiso) aprueba/rechaza. */
function PanelExcepciones({ d, onDone, onError }: { d: Detalle; onDone: () => void; onError: (s: string) => void }) {
  const { puede } = useAuth();
  const puedeAutorizar = puede(PERMISOS.DEVOLUCION_AUTORIZAR_EXCEPCION);
  const editable = d.estado === 'APROBADO';
  const [isbn, setIsbn] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  const solicitar = async () => {
    onError('');
    setBusy(true);
    try {
      await api.post(`/devoluciones/autorizaciones/${d.id}/excepciones`, {
        isbn: isbn.trim(),
        cantidad: Number(cantidad),
        motivo: motivo.trim() || undefined,
      });
      setIsbn(''); setCantidad('1'); setMotivo('');
      onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resolver = async (excId: number, aprobar: boolean) => {
    onError('');
    try {
      await api.patch(`/devoluciones/autorizaciones/${d.id}/excepciones/${excId}/resolver`, { aprobar });
      onDone();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Card>
      <h2 className="font-semibold mb-1">Autorizaciones fuera de consignación</h2>
      <p className="text-sm text-slate-500 mb-4">
        El cliente solo puede devolver libros que tiene en consignación. Para devolver un libro fuera de
        esa lista (o más unidades de las que tiene), se solicita autorización; la aprueba Gerencia.
      </p>

      {d.excepciones.length > 0 ? (
        <div className="divide-y divide-slate-100 mb-2">
          {d.excepciones.map((e) => (
            <div key={e.id} className="flex items-center gap-2 py-2">
              <ProductoThumb producto={{ isbn: e.isbn, titulo: e.titulo ?? e.isbn, editorial: e.editorial, imagenUrl: e.imagenUrl }} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800 truncate">{e.titulo ?? '—'}</div>
                <div className="text-[11px] text-slate-400 tabnum">{e.isbn} · {e.cantidad} u.</div>
                {e.motivoSolicitud && <div className="text-[11px] text-slate-500 italic truncate">“{e.motivoSolicitud}”</div>}
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${EXC_COLOR[e.estado]}`}>{e.estado}</span>
              {puedeAutorizar && e.estado === 'PENDIENTE' && (
                <span className="flex gap-1 ml-1 shrink-0">
                  <button className="btn-accent !py-1 !px-2 text-xs" onClick={() => resolver(e.id, true)}>Aprobar</button>
                  <button className="btn-ghost !py-1 !px-2 text-xs !text-red-600" onClick={() => resolver(e.id, false)}>Rechazar</button>
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400 mb-2">Sin solicitudes de excepción.</p>
      )}

      {editable && (
        <div className="border-t border-slate-100 pt-4 mt-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Solicitar autorización</h3>
          <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
            <Field label="ISBN">
              <input className="input" value={isbn} onChange={(ev) => setIsbn(ev.target.value)} placeholder="ISBN del libro" />
            </Field>
            <Field label="Cantidad">
              <input className="input w-24 tabnum" type="number" min={1} value={cantidad} onChange={(ev) => setCantidad(ev.target.value)} />
            </Field>
            <button className="btn-accent" disabled={busy || !isbn.trim()} onClick={solicitar}>Solicitar</button>
          </div>
          <div className="mt-2">
            <Field label="Motivo (opcional)">
              <input className="input" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Por qué se devuelve fuera de consignación" />
            </Field>
          </div>
        </div>
      )}
    </Card>
  );
}

function PanelRecibir({ d, onAccion }: { d: Detalle; onAccion: (fn: () => Promise<unknown>) => void }) {
  const [bultos, setBultos] = useState(String(d.bultosDeclarados ?? ''));
  const [obs, setObs] = useState('');
  return (
    <Card>
      <h2 className="font-semibold mb-3">Recepción</h2>
      <p className="text-sm text-slate-500 mb-3">Declarados: <b className="tabnum">{d.bultosDeclarados ?? '—'}</b></p>
      <div className="grid gap-3">
        <Field label="Bultos recibidos"><input className="input tabnum" inputMode="numeric" value={bultos} onChange={(e) => setBultos(e.target.value)} /></Field>
        <Field label="Observación (obligatoria si difieren)"><input className="input" value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
      </div>
      <button className="btn-accent mt-4" onClick={() => onAccion(() => api.patch(`/devoluciones/autorizaciones/${d.id}/recibir`, { bultosRecibidos: Number(bultos), observaciones: obs || undefined }))}>
        Confirmar recepción
      </button>
    </Card>
  );
}

function PanelIngreso({ id, onAccion }: { id: number; onAccion: (fn: () => Promise<unknown>) => void }) {
  const [ubi, setUbi] = useState('');
  return (
    <Card>
      <h2 className="font-semibold mb-3">Ingreso a depósito</h2>
      <Field label="Ubicación de espera (opcional)"><input className="input" value={ubi} onChange={(e) => setUbi(e.target.value)} placeholder="Ej: DEV-01" /></Field>
      <p className="text-xs text-slate-400 mt-1.5">Informativa: podés registrar el ingreso sin completarla.</p>
      <button className="btn-accent mt-4" onClick={() => onAccion(() => api.patch(`/devoluciones/autorizaciones/${id}/ingreso`, { ubicacionEspera: ubi || undefined }))}>
        Registrar ingreso
      </button>
    </Card>
  );
}

function PanelControl({ d, onDone, onError }: { d: Detalle; onDone: () => void; onError: (s: string) => void }) {
  const [activo, setActivo] = useState<number | null>(null);
  const [destBueno, setDestBueno] = useState('');
  const [destMalo, setDestMalo] = useState('');
  const [obs, setObs] = useState('');
  const todosControlados = d.bultos.every((b) => b.estadoControl === 'CONTROLADO');

  const cerrar = async () => {
    try {
      await api.patch(`/devoluciones/autorizaciones/${d.id}/cierre`, {
        ubicacionDestinoBueno: destBueno || undefined, ubicacionDestinoMalo: destMalo || undefined, observaciones: obs || undefined,
      });
      onDone();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Card>
      <h2 className="font-semibold mb-3">Control bulto por bulto</h2>
      <div className="space-y-2">
        {d.bultos.map((b) => (
          <div key={b.id}>
            <button
              onClick={() => setActivo(activo === b.numero ? null : b.numero)}
              className={`w-full flex items-center justify-between px-4 h-12 rounded-lg border ${
                b.estadoControl === 'CONTROLADO' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
              }`}
            >
              <span className="font-medium">Bulto {b.numero}</span>
              <span className={`text-xs font-semibold ${b.estadoControl === 'CONTROLADO' ? 'text-emerald-700' : 'text-slate-400'}`}>
                {b.estadoControl === 'CONTROLADO' ? 'Controlado ✓' : 'Pendiente'}
              </span>
            </button>
            {activo === b.numero && (
              <ControlBulto
                inicial={b.controles.map((c) => ({ isbn: c.isbn, titulo: c.titulo ?? c.isbn, editorial: c.editorial, imagenUrl: c.imagenUrl, cantidad: c.cantidad, malEstado: c.malEstado }))}
                pesoInicial={b.peso ?? ''}
                etiqueta="Marcar controlado"
                onGuardar={(payload) => enviarControl(d.id, b.numero, payload)}
                onDone={() => { setActivo(null); onDone(); }}
                onError={onError}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 pt-5 border-t border-slate-100">
        <h3 className="font-semibold mb-3">Cierre → destinos</h3>
        <p className="text-xs text-slate-400 mb-3">Las ubicaciones son informativas: podés cerrar y procesar sin completarlas.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Destino BUENOS (picking/pallet) — opcional"><input className="input" value={destBueno} onChange={(e) => setDestBueno(e.target.value)} placeholder="Ej: A-01" /></Field>
          <Field label="Destino MALOS (dañados/cuarentena) — opcional"><input className="input" value={destMalo} onChange={(e) => setDestMalo(e.target.value)} placeholder="Ej: DAN-01" /></Field>
        </div>
        <Field label="Observación (si peso/bultos difieren)"><input className="input mt-1" value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        <button className="btn-accent mt-4 disabled:opacity-50" disabled={!todosControlados} onClick={cerrar}>
          Cerrar y procesar
        </button>
        {!todosControlados && <p className="text-xs text-amber-600 mt-2">Faltan bultos por controlar.</p>}
      </div>
    </Card>
  );
}

/**
 * Editor del contenido de un bulto (escaneo + cantidades + mal estado).
 * Reusado por el control normal (outbox offline) y por la corrección
 * post-Procesado (directo a la API): cambia solo `onGuardar`.
 */
function ControlBulto({ inicial, pesoInicial, etiqueta, onGuardar, onDone, onError }: {
  inicial?: FilaControl[];
  pesoInicial?: string;
  etiqueta: string;
  onGuardar: (payload: { peso?: number; controles: { isbn: string; cantidad: number; malEstado: number }[] }) => Promise<ResultadoGuardar>;
  onDone: () => void;
  onError: (s: string) => void;
}) {
  const [filas, setFilas] = useState<FilaControl[]>(inicial ?? []);
  const [peso, setPeso] = useState(pesoInicial ?? '');
  const [encolado, setEncolado] = useState(false);

  const sumar = (p: ProductoLite) => {
    setFilas((prev) => {
      const i = prev.findIndex((f) => f.isbn === p.isbn);
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], cantidad: c[i].cantidad + 1 }; return c; }
      return [...prev, { isbn: p.isbn, titulo: p.titulo, editorial: p.editorial, imagenUrl: p.imagenUrl, cantidad: 1, malEstado: 0 }];
    });
  };

  const agregar = async (codigo: string) => {
    try {
      const p = await api.get<ProductoResuelto>(`/catalogo/productos/por-isbn/${codigo}`);
      sumar(p);
    } catch (e) { onError((e as Error).message); }
  };

  const guardar = async () => {
    try {
      const r = await onGuardar({
        peso: peso ? Number(peso) : undefined,
        controles: filas.map((f) => ({ isbn: f.isbn, cantidad: f.cantidad, malEstado: f.malEstado })),
      });
      if (r && r.encolado) {
        // Sin conexión: quedó guardado localmente y se sincronizará solo.
        setEncolado(true);
      } else {
        onDone();
      }
    } catch (e) { onError((e as Error).message); }
  };

  return (
    <div className="mt-2 p-4 bg-slate-50 rounded-lg space-y-3 animate-fade-in">
      <Scanner onScan={agregar} onElegir={sumar} placeholder="Escanear contenido del bulto…" />
      {filas.map((f, i) => (
        <div key={f.isbn} className="flex items-center gap-2 text-sm">
          <ProductoThumb producto={f} size={32} />
          <span className="min-w-0 flex-1 truncate">{f.titulo}</span>
          <label className="text-xs text-slate-400">cant</label>
          <input type="number" min={0} value={f.cantidad} onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, cantidad: Number(e.target.value) } : x))} className="input w-16 h-9 tabnum text-center" />
          <label className="text-xs text-red-400">mal</label>
          <input type="number" min={0} value={f.malEstado} onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, malEstado: Number(e.target.value) } : x))} className="input w-16 h-9 tabnum text-center" />
        </div>
      ))}
      {filas.length === 0 && <p className="text-xs text-slate-400">Escaneá al menos un ISBN (un bulto vacío se carga con cantidad 0).</p>}
      <div className="flex items-end gap-3">
        <Field label="Peso bulto (kg)"><input className="input w-28 tabnum" inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} /></Field>
        <button className="btn-primary" onClick={guardar}>{etiqueta}</button>
      </div>
      {encolado && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
          Sin conexión: el control quedó <b>guardado en el dispositivo</b> y se sincronizará automáticamente al volver la red.
        </p>
      )}
    </div>
  );
}

/** Corrección post-Procesado: solo con permiso devolucion.corregir (Admin). Queda en auditoría. */
function PanelCorreccion({ d, onDone, onError }: { d: Detalle; onDone: () => void; onError: (s: string) => void }) {
  const [activo, setActivo] = useState<number | null>(null);
  const [obs, setObs] = useState('');

  return (
    <Card className="border-amber-200">
      <h2 className="font-semibold mb-1 flex items-center gap-2 text-amber-700">
        <PencilLine className="h-4 w-4" /> Corrección (Administrador)
      </h2>
      <p className="text-xs text-slate-500 mb-3">
        La devolución no se reabre: la corrección reemplaza el control del bulto, queda en auditoría
        y re-emite el resultado por ISBN.
      </p>
      <Field label="Motivo de la corrección">
        <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: error de tipeo en cantidad" />
      </Field>
      <div className="space-y-2 mt-3">
        {d.bultos.map((b) => (
          <div key={b.id}>
            <button
              onClick={() => setActivo(activo === b.numero ? null : b.numero)}
              className="w-full flex items-center justify-between px-4 h-11 rounded-lg border border-slate-200 bg-white text-sm"
            >
              <span className="font-medium">Bulto {b.numero}</span>
              <span className="text-xs text-slate-400">{activo === b.numero ? 'cerrar' : 'corregir'}</span>
            </button>
            {activo === b.numero && (
              <ControlBulto
                inicial={b.controles.map((c) => ({ isbn: c.isbn, titulo: c.titulo ?? c.isbn, editorial: c.editorial, imagenUrl: c.imagenUrl, cantidad: c.cantidad, malEstado: c.malEstado }))}
                pesoInicial={b.peso ?? ''}
                etiqueta="Guardar corrección"
                onGuardar={(payload) =>
                  api.patch(`/devoluciones/autorizaciones/${d.id}/bultos/${b.numero}/correccion`, {
                    ...payload,
                    observaciones: obs || undefined,
                  }) as Promise<void>
                }
                onDone={() => { setActivo(null); onDone(); }}
                onError={onError}
              />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

type LineaRec = { isbn: string; titulo: string | null; declarado: number; recibido: number; bueno: number; malo: number; saldoConsignacion: number | null; excedeConsignacion: boolean };

function PanelReconciliacion({ id, d }: { id: number; d: Detalle }) {
  const [rec, setRec] = useState<LineaRec[] | null>(null);
  useEffect(() => { api.get<LineaRec[]>(`/devoluciones/autorizaciones/${id}/reconciliacion`).then(setRec).catch(() => setRec([])); }, [id]);
  const hayExceso = rec?.some((r) => r.excedeConsignacion);
  return (
    <Card>
      <h2 className="font-semibold mb-1 flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" /> Procesado</h2>
      <p className="text-sm text-slate-500 mb-4">Buenos → {d.ubicacionDestinoBueno || '—'} · Malos → {d.ubicacionDestinoMalo || '—'}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-500 text-left"><tr>
            <th className="py-2 font-medium">Título</th><th className="font-medium">ISBN</th><th className="font-medium text-right">Decl.</th><th className="font-medium text-right">Recib.</th><th className="font-medium text-right">Bueno</th><th className="font-medium text-right">Malo</th><th className="font-medium text-right">Consig.</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rec?.map((r) => (
              <tr key={r.isbn} className={r.excedeConsignacion ? 'bg-amber-50' : undefined}>
                <td className="py-2 pr-2 max-w-48 truncate">{r.titulo ?? '—'}</td>
                <td className="tabnum text-slate-500">{r.isbn}</td>
                <td className="text-right tabnum">{r.declarado}</td>
                <td className="text-right tabnum">{r.recibido}</td>
                <td className="text-right tabnum text-emerald-700 font-semibold">{r.bueno}</td>
                <td className="text-right tabnum text-red-600 font-semibold">{r.malo}</td>
                <td className="text-right tabnum">
                  {r.saldoConsignacion ?? '—'}
                  {r.excedeConsignacion && (
                    <span className="ml-1 inline-flex items-center rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700" title="La devolución excede el saldo en consignación">excede</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hayExceso && (
        <p className="mt-3 text-xs text-amber-700">Hay títulos cuya cantidad recibida supera el saldo en consignación del cliente (ver observaciones).</p>
      )}
    </Card>
  );
}

function ResumenDatos({ d }: { d: Detalle }) {
  return (
    <Card className="text-sm">
      <h2 className="font-semibold mb-3">Datos</h2>
      <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-slate-600">
        <dt className="text-slate-400">Cliente</dt>
        <dd>{d.cliente ? `${d.cliente.nroCliente} · ${d.cliente.nombre}` : d.clienteId}</dd>
        <dt className="text-slate-400">Solicitada por</dt>
        <dd>
          {d.creadoPor ? (
            <>
              {d.creadoPor.nombre}{' '}
              <span className="text-xs text-slate-400">
                ({d.creadoPor.tipo === 'cliente' ? 'cliente' : 'usuario interno'})
              </span>
            </>
          ) : '—'}
        </dd>
        <dt className="text-slate-400">Motivo</dt>
        <dd>{d.motivo?.nombre ?? '—'}</dd>
        <dt className="text-slate-400">Cantidad de unidades</dt>
        <dd className="tabnum">{d.cantidadUnidades ?? '—'}</dd>
        <dt className="text-slate-400">Transportista</dt>
        <dd>{d.transportista?.nombre ?? '—'}</dd>
        <dt className="text-slate-400">Bultos declarados</dt><dd className="tabnum">{d.bultosDeclarados ?? '—'}</dd>
        <dt className="text-slate-400">Bultos recibidos</dt><dd className="tabnum">{d.bultosRecibidos ?? '—'}</dd>
        <dt className="text-slate-400">Ubicación espera</dt><dd>{d.ubicacionEspera ?? '—'}</dd>
        {d.observaciones && (<><dt className="text-slate-400">Observaciones</dt><dd>{d.observaciones}</dd></>)}
      </dl>
      {d.declaraciones.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Líneas declaradas</h3>
          {d.declaraciones.map((l) => (
            <div key={l.id} className="flex justify-between gap-3 py-1 border-b border-slate-50">
              <span className="truncate">{l.titulo ?? l.isbn}</span>
              <span className="flex gap-3 shrink-0">
                <span className="tabnum text-slate-400">{l.isbn}</span>
                <span className="tabnum font-medium">{l.cantidad}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
