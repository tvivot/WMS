import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, PencilLine, Truck } from 'lucide-react';
import { api } from '../../lib/api';
import { enviarControl } from '../../lib/outbox';
import { useAuth } from '../../lib/auth';
import { PERMISOS, ESTADOS_ORDEN, ESTADO_LABEL, type Estado } from '../../lib/estados';
import { Card, EstadoBadge, Field, Spinner } from '../../components/ui';
import { Scanner } from '../../components/Scanner';

interface Linea { id: number; isbn: string; cantidad: number; productoId: number | null; titulo: string | null }
interface Control { id: number; isbn: string; cantidad: number; malEstado: number; titulo: string | null }
interface Bulto { id: number; numero: number; peso: string | null; estadoControl: string; controles: Control[] }
interface Detalle {
  id: number; estado: Estado; clienteId: number; depositoId: number;
  transportistaId: number | null;
  cliente: { id: number; nroCliente: string; nombre: string } | null;
  transportista: { id: number; nombre: string } | null;
  creadoPor: { tipo: 'usuario' | 'cliente'; nombre: string } | null;
  bultosDeclarados: number | null; pesoTotalDeclarado: string | null; bultosRecibidos: number | null;
  ubicacionEspera: string | null; ubicacionDestinoBueno: string | null; ubicacionDestinoMalo: string | null;
  observaciones: string | null; declaraciones: Linea[]; bultos: Bulto[];
}
interface TransportistaOpcion { id: number; nombre: string }

interface FilaControl { isbn: string; titulo: string; cantidad: number; malEstado: number }
type ResultadoGuardar = { encolado?: true } | void;

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

function PanelDeclaracion({ d, onDone, onError }: { d: Detalle; onDone: () => void; onError: (s: string) => void }) {
  const [lineas, setLineas] = useState<{ isbn: string; titulo: string; cantidad: number }[]>(
    d.declaraciones.map((l) => ({ isbn: l.isbn, titulo: l.titulo ?? l.isbn, cantidad: l.cantidad })),
  );
  const [bultos, setBultos] = useState(String(d.bultosDeclarados ?? ''));
  const [peso, setPeso] = useState(String(d.pesoTotalDeclarado ?? ''));
  const [transportistas, setTransportistas] = useState<TransportistaOpcion[]>([]);
  const [transportistaId, setTransportistaId] = useState<string>(
    d.transportistaId ? String(d.transportistaId) : '',
  );

  useEffect(() => {
    api.get<TransportistaOpcion[]>('/transportistas').then(setTransportistas).catch(() => setTransportistas([]));
  }, []);

  const agregar = async (codigo: string) => {
    try {
      const p = await api.get<{ titulo: string; isbn: string }>(`/catalogo/productos/por-isbn/${codigo}`);
      setLineas((prev) => {
        const i = prev.findIndex((l) => l.isbn === p.isbn);
        if (i >= 0) {
          const copy = [...prev];
          copy[i] = { ...copy[i], cantidad: copy[i].cantidad + 1 };
          return copy;
        }
        return [...prev, { isbn: p.isbn, titulo: p.titulo, cantidad: 1 }];
      });
    } catch (e) {
      onError((e as Error).message);
    }
  };

  // Lanza si falla: quien la llame decide (el botón muestra el error;
  // "despachar" NO debe seguir si el guardado falló).
  const guardarOLanzar = async () => {
    await api.patch(`/devoluciones/autorizaciones/${d.id}/declaracion`, {
      lineas: lineas.map((l) => ({ isbn: l.isbn, cantidad: l.cantidad })),
      bultosDeclarados: Number(bultos),
      pesoTotalDeclarado: Number(peso),
      transportistaId: transportistaId ? Number(transportistaId) : undefined,
    });
  };

  const guardar = async () => {
    try {
      await guardarOLanzar();
      onDone();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const despachar = async () => {
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
      <h2 className="font-semibold mb-3">Declarar devolución</h2>
      <Scanner onScan={agregar} />
      <div className="mt-4 space-y-2">
        {lineas.map((l, i) => (
          <div key={l.isbn} className="flex items-center gap-3 text-sm">
            <span className="tabnum text-slate-400 w-32">{l.isbn}</span>
            <span className="flex-1 truncate">{l.titulo}</span>
            <input
              type="number" min={1} value={l.cantidad}
              onChange={(e) => setLineas((p) => p.map((x, j) => (j === i ? { ...x, cantidad: Number(e.target.value) } : x)))}
              className="input w-20 h-9 tabnum text-center"
            />
          </div>
        ))}
        {lineas.length === 0 && <p className="text-sm text-slate-400">Escaneá ISBN para sumar líneas.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <Field label="Bultos"><input className="input tabnum" inputMode="numeric" value={bultos} onChange={(e) => setBultos(e.target.value)} /></Field>
        <Field label="Peso total (kg)"><input className="input tabnum" inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Transportista" hint={transportistas.length === 0 ? 'No hay transportistas cargados: pedile al depósito que cargue uno.' : undefined}>
          <select className="input" value={transportistaId} onChange={(e) => setTransportistaId(e.target.value)}>
            <option value="">Elegir transportista…</option>
            {transportistas.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex gap-3 mt-4">
        <button className="btn-outline" onClick={guardar}>Guardar</button>
        <button className="btn-accent" onClick={despachar}>
          <Truck className="h-4 w-4" /> Despachar
        </button>
      </div>
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
      <Field label="Ubicación de espera"><input className="input" value={ubi} onChange={(e) => setUbi(e.target.value)} placeholder="Ej: DEV-01" /></Field>
      <button className="btn-accent mt-4" onClick={() => onAccion(() => api.patch(`/devoluciones/autorizaciones/${id}/ingreso`, { ubicacionEspera: ubi }))}>
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
        ubicacionDestinoBueno: destBueno, ubicacionDestinoMalo: destMalo, observaciones: obs || undefined,
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
                inicial={b.controles.map((c) => ({ isbn: c.isbn, titulo: c.titulo ?? c.isbn, cantidad: c.cantidad, malEstado: c.malEstado }))}
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
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Destino BUENOS (picking/pallet)"><input className="input" value={destBueno} onChange={(e) => setDestBueno(e.target.value)} placeholder="Ej: A-01" /></Field>
          <Field label="Destino MALOS (dañados/cuarentena)"><input className="input" value={destMalo} onChange={(e) => setDestMalo(e.target.value)} placeholder="Ej: DAN-01" /></Field>
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

  const agregar = async (codigo: string) => {
    try {
      const p = await api.get<{ titulo: string; isbn: string }>(`/catalogo/productos/por-isbn/${codigo}`);
      setFilas((prev) => {
        const i = prev.findIndex((f) => f.isbn === p.isbn);
        if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], cantidad: c[i].cantidad + 1 }; return c; }
        return [...prev, { isbn: p.isbn, titulo: p.titulo, cantidad: 1, malEstado: 0 }];
      });
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
      <Scanner onScan={agregar} placeholder="Escanear contenido del bulto…" />
      {filas.map((f, i) => (
        <div key={f.isbn} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate">{f.titulo}</span>
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
                inicial={b.controles.map((c) => ({ isbn: c.isbn, titulo: c.titulo ?? c.isbn, cantidad: c.cantidad, malEstado: c.malEstado }))}
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

function PanelReconciliacion({ id, d }: { id: number; d: Detalle }) {
  const [rec, setRec] = useState<{ isbn: string; titulo: string | null; declarado: number; recibido: number; bueno: number; malo: number }[] | null>(null);
  useEffect(() => { api.get<typeof rec>(`/devoluciones/autorizaciones/${id}/reconciliacion`).then(setRec).catch(() => setRec([])); }, [id]);
  return (
    <Card>
      <h2 className="font-semibold mb-1 flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" /> Procesado</h2>
      <p className="text-sm text-slate-500 mb-4">Buenos → {d.ubicacionDestinoBueno} · Malos → {d.ubicacionDestinoMalo}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-500 text-left"><tr>
            <th className="py-2 font-medium">Título</th><th className="font-medium">ISBN</th><th className="font-medium text-right">Decl.</th><th className="font-medium text-right">Recib.</th><th className="font-medium text-right">Bueno</th><th className="font-medium text-right">Malo</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rec?.map((r) => (
              <tr key={r.isbn}>
                <td className="py-2 pr-2 max-w-48 truncate">{r.titulo ?? '—'}</td>
                <td className="tabnum text-slate-500">{r.isbn}</td>
                <td className="text-right tabnum">{r.declarado}</td>
                <td className="text-right tabnum">{r.recibido}</td>
                <td className="text-right tabnum text-emerald-700 font-semibold">{r.bueno}</td>
                <td className="text-right tabnum text-red-600 font-semibold">{r.malo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        <dt className="text-slate-400">Transportista</dt>
        <dd>{d.transportista?.nombre ?? '—'}</dd>
        <dt className="text-slate-400">Bultos declarados</dt><dd className="tabnum">{d.bultosDeclarados ?? '—'}</dd>
        <dt className="text-slate-400">Peso declarado</dt><dd className="tabnum">{d.pesoTotalDeclarado ?? '—'} kg</dd>
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
