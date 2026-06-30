import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Mail, Plus, Send, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Card, EmptyState, Field, Spinner } from '../components/ui';
import { ESTADO_LABEL, ESTADOS_ORDEN, type Estado } from '../lib/estados';

interface VarO365 {
  nombre: string;
  descripcion: string;
  presente: boolean;
  secreto: boolean;
}
interface EstadoO365 {
  office365Configurado: boolean;
  from: string | null;
  variables: VarO365[];
}

interface Grupo {
  id: number;
  nombre: string;
  emails: string;
  activo: boolean;
}
interface UsuarioNotif {
  id: number;
  nombre: string;
  username: string;
  email: string | null;
}
interface Regla {
  id: number;
  modulo: string;
  estado: string;
  incluirCliente: boolean;
  asunto: string;
  cuerpo: string;
  activo: boolean;
  grupoIds: number[];
  usuarioIds: number[];
}

const PLACEHOLDERS = '{{nro}} · {{cliente}} · {{estado}} · {{estadoAnterior}} · {{fecha}} · {{detalle}}';

/** Etiquetas de reglas que no son un estado de la máquina (claves lógicas). */
const ETIQUETA_REGLA: Record<string, string> = {
  LOTE_EVALUADO: 'Validación de lote (ERP)',
};
function etiquetaRegla(estado: string): string {
  return ETIQUETA_REGLA[estado] ?? ESTADO_LABEL[estado as Estado] ?? estado;
}
/** Orden: estados de la máquina primero (por su orden), claves lógicas al final. */
function ordenRegla(estado: string): number {
  const i = ESTADOS_ORDEN.indexOf(estado as Estado);
  return i === -1 ? 999 : i;
}

export function Notificaciones() {
  const [office365, setOffice365] = useState<EstadoO365 | null>(null);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioNotif[]>([]);
  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    setError(null);
    try {
      const [est, g, u, r] = await Promise.all([
        api.get<EstadoO365>('/notificaciones/estado'),
        api.get<Grupo[]>('/notificaciones/grupos'),
        api.get<UsuarioNotif[]>('/notificaciones/usuarios'),
        api.get<Regla[]>('/notificaciones/reglas'),
      ]);
      setOffice365(est);
      setGrupos(g);
      setUsuarios(u);
      setReglas(r);
    } catch (e) {
      setError((e as Error).message);
      setGrupos([]);
      setReglas([]);
    }
  };
  useEffect(() => {
    void cargar();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Mail className="h-5 w-5 text-slate-500" />
        <h1 className="text-xl font-bold">Notificaciones por email</h1>
      </div>
      <p className="text-sm text-slate-500 max-w-3xl">
        Configurá a qué grupos de correo y/o usuarios se notifica en cada cambio de estado de una
        devolución, y si además se le avisa al cliente. El correo sale por Office365.
      </p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg" role="alert">{error}</p>
      )}

      <EstadoOffice365 estado={office365} onError={setError} />

      <GruposPanel grupos={grupos} onCambio={cargar} onError={setError} />

      <ReglasPanel
        reglas={reglas}
        grupos={grupos ?? []}
        usuarios={usuarios}
        onCambio={cargar}
        onError={setError}
      />
    </div>
  );
}

/* ----------------------------- Office365 + prueba ----------------------------- */

function EstadoOffice365({
  estado,
  onError,
}: {
  estado: EstadoO365 | null;
  onError: (m: string) => void;
}) {
  const [to, setTo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);

  const probar = async () => {
    setEnviando(true);
    setOk(false);
    onError('');
    try {
      await api.post('/notificaciones/test', { to });
      setOk(true);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  if (estado === null) {
    return (
      <Card>
        <Spinner className="text-slate-400" />
      </Card>
    );
  }

  const configurado = estado.office365Configurado;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {configurado ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          )}
          <div>
            <div className="font-semibold text-sm">Correo saliente · Office365 (Microsoft Graph)</div>
            <div className="text-xs text-slate-500">
              {configurado
                ? `Configurado: los envíos están habilitados. Remitente: ${estado.from}.`
                : 'No configurado: completá las variables de abajo. Mientras tanto, los avisos quedan en cola y se envían solos cuando termines.'}
            </div>
          </div>
        </div>
        {configurado && (
          <div className="flex items-end gap-2">
            <Field label="Probar envío a">
              <input
                className="input w-60"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="vos@grupal.com"
              />
            </Field>
            <button className="btn-accent" onClick={probar} disabled={enviando || !to.includes('@')}>
              <Send className="h-4 w-4" /> {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        )}
      </div>

      {ok && (
        <p className="mt-3 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
          Correo de prueba enviado. Revisá la casilla.
        </p>
      )}

      {/* Guía de configuración: qué variable es cada una y cuáles están cargadas. */}
      <div className="mt-4 border-t border-slate-100 pt-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-2">Variables a cargar (en hPanel → Variables de entorno)</h3>
          <div className="space-y-1.5">
            {estado.variables.map((v) => (
              <div key={v.nombre} className="flex items-start gap-2 text-sm">
                {v.presente ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                )}
                <div>
                  <code className="font-mono text-[13px] font-semibold">{v.nombre}</code>
                  <span className={`ml-2 text-xs ${v.presente ? 'text-emerald-700' : 'text-red-600'}`}>
                    {v.presente ? 'cargada' : 'falta'}
                  </span>
                  {v.secreto && <span className="ml-1 text-xs text-slate-400">(secreto — no se muestra)</span>}
                  <div className="text-xs text-slate-500">{v.descripcion}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Después de cargarlas o cambiarlas, hay que <strong>redeployar</strong> la app para que tomen efecto.
            Los secretos van solo en variables de entorno, nunca se guardan en el sistema.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Cómo obtener esos valores (Azure / Microsoft 365)</h3>
          <ol className="list-decimal ml-5 space-y-1 text-sm text-slate-600">
            <li>
              En <strong>Azure Portal → Microsoft Entra ID (Azure AD) → Registros de aplicaciones → Nueva
              aplicación</strong>. Anotá el <em>Directory (tenant) ID</em> → <code className="font-mono text-xs">O365_TENANT_ID</code> y
              el <em>Application (client) ID</em> → <code className="font-mono text-xs">O365_CLIENT_ID</code>.
            </li>
            <li>
              En la app → <strong>Certificados y secretos → Nuevo secreto de cliente</strong>. Copiá el
              <em> Valor</em> (no el Secret ID) → <code className="font-mono text-xs">O365_CLIENT_SECRET</code>.
              El valor se ve una sola vez.
            </li>
            <li>
              En la app → <strong>Permisos de API → Agregar permiso → Microsoft Graph → Permisos de
              aplicación → <code className="font-mono text-xs">Mail.Send</code></strong>, y después
              <strong> Conceder consentimiento de administrador</strong>.
            </li>
            <li>
              Elegí el buzón remitente (una casilla real del tenant) → <code className="font-mono text-xs">MAIL_FROM</code>,
              ej. <code className="font-mono text-xs">devoluciones@tudominio.com</code>.
            </li>
          </ol>
        </div>
      </div>
    </Card>
  );
}

/* --------------------------------- Grupos ---------------------------------- */

function GruposPanel({
  grupos,
  onCambio,
  onError,
}: {
  grupos: Grupo[] | null;
  onCambio: () => void;
  onError: (m: string) => void;
}) {
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({ nombre: '', emails: '' });

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    onError('');
    try {
      await api.post('/notificaciones/grupos', { nombre: form.nombre, emails: form.emails });
      setForm({ nombre: '', emails: '' });
      setCreando(false);
      onCambio();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Grupos de correo</h2>
        <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
          <Plus className="h-4 w-4" /> Grupo
        </button>
      </div>

      {creando && (
        <Card>
          <form onSubmit={crear} className="space-y-3">
            <Field label="Nombre del grupo">
              <input
                className="input w-72"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
                minLength={2}
              />
            </Field>
            <Field label="Emails" hint="Separados por coma, punto y coma o salto de línea.">
              <textarea
                className="input w-full min-h-20"
                value={form.emails}
                onChange={(e) => setForm({ ...form, emails: e.target.value })}
                placeholder="deposito@grupal.com, gerencia@grupal.com"
              />
            </Field>
            <button className="btn-accent" type="submit">Crear grupo</button>
          </form>
        </Card>
      )}

      {grupos === null ? (
        <div className="py-8 text-center"><Spinner className="text-slate-400" /></div>
      ) : grupos.length === 0 ? (
        <EmptyState titulo="Sin grupos" sub="Creá un grupo con los correos que reciben los avisos." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {grupos.map((g) => (
            <GrupoCard key={g.id} grupo={g} onCambio={onCambio} onError={onError} />
          ))}
        </div>
      )}
    </section>
  );
}

function GrupoCard({
  grupo,
  onCambio,
  onError,
}: {
  grupo: Grupo;
  onCambio: () => void;
  onError: (m: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ nombre: grupo.nombre, emails: grupo.emails });

  const guardar = async () => {
    onError('');
    try {
      await api.put(`/notificaciones/grupos/${grupo.id}`, form);
      setEditando(false);
      onCambio();
    } catch (err) {
      onError((err as Error).message);
    }
  };
  const toggle = async () => {
    onError('');
    try {
      await api.put(`/notificaciones/grupos/${grupo.id}`, { activo: !grupo.activo });
      onCambio();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <Card>
      {editando ? (
        <div className="space-y-3">
          <Field label="Nombre">
            <input className="input w-full" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </Field>
          <Field label="Emails">
            <textarea className="input w-full min-h-20" value={form.emails} onChange={(e) => setForm({ ...form, emails: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <button className="btn-accent" onClick={guardar}>Guardar</button>
            <button className="btn-ghost" onClick={() => { setForm({ nombre: grupo.nombre, emails: grupo.emails }); setEditando(false); }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{grupo.nombre}</span>
            <button
              onClick={toggle}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold transition-colors ${
                grupo.activo ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${grupo.activo ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {grupo.activo ? 'Activo' : 'Inactivo'}
            </button>
          </div>
          <p className="text-sm text-slate-500 break-words">{grupo.emails || '—'}</p>
          <button className="btn-ghost h-8 mt-1" onClick={() => setEditando(true)}>Editar</button>
        </div>
      )}
    </Card>
  );
}

/* --------------------------- Reglas por estado ----------------------------- */

function ReglasPanel({
  reglas,
  grupos,
  usuarios,
  onCambio,
  onError,
}: {
  reglas: Regla[] | null;
  grupos: Grupo[];
  usuarios: UsuarioNotif[];
  onCambio: () => void;
  onError: (m: string) => void;
}) {
  // Ordena las reglas por el orden de la máquina de estados.
  const ordenadas = reglas
    ? [...reglas].sort((a, b) => ordenRegla(a.estado) - ordenRegla(b.estado))
    : null;

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Reglas por estado</h2>
      {ordenadas === null ? (
        <div className="py-8 text-center"><Spinner className="text-slate-400" /></div>
      ) : ordenadas.length === 0 ? (
        <EmptyState titulo="Sin reglas" sub="Las reglas se crean automáticamente por estado." />
      ) : (
        <div className="space-y-3">
          {ordenadas.map((r) => (
            <ReglaCard
              key={r.id}
              regla={r}
              grupos={grupos}
              usuarios={usuarios}
              onCambio={onCambio}
              onError={onError}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReglaCard({
  regla,
  grupos,
  usuarios,
  onCambio,
  onError,
}: {
  regla: Regla;
  grupos: Grupo[];
  usuarios: UsuarioNotif[];
  onCambio: () => void;
  onError: (m: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({
    asunto: regla.asunto,
    cuerpo: regla.cuerpo,
    incluirCliente: regla.incluirCliente,
    grupoIds: regla.grupoIds,
    usuarioIds: regla.usuarioIds,
  });
  const [guardando, setGuardando] = useState(false);

  const label = etiquetaRegla(regla.estado);
  const destinos = regla.grupoIds.length + regla.usuarioIds.length + (regla.incluirCliente ? 1 : 0);

  const toggleGrupo = (id: number) =>
    setForm((f) => ({
      ...f,
      grupoIds: f.grupoIds.includes(id) ? f.grupoIds.filter((x) => x !== id) : [...f.grupoIds, id],
    }));
  const toggleUsuario = (id: number) =>
    setForm((f) => ({
      ...f,
      usuarioIds: f.usuarioIds.includes(id) ? f.usuarioIds.filter((x) => x !== id) : [...f.usuarioIds, id],
    }));

  const guardar = async () => {
    setGuardando(true);
    onError('');
    try {
      await api.put(`/notificaciones/reglas/${regla.id}`, form);
      setAbierto(false);
      onCambio();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };
  const toggleActivo = async () => {
    onError('');
    try {
      await api.put(`/notificaciones/reglas/${regla.id}`, { activo: !regla.activo });
      onCambio();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button className="flex items-center gap-3 text-left" onClick={() => setAbierto((v) => !v)}>
          <span className="font-semibold">{label}</span>
          <span className="text-xs text-slate-500">
            {destinos === 0 ? 'sin destinos' : `${destinos} destino${destinos > 1 ? 's' : ''}`}
            {regla.incluirCliente ? ' · incluye cliente' : ''}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleActivo}
            title={regla.activo ? 'Clic para desactivar el aviso de este estado' : 'Clic para activar'}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-xs font-semibold transition-colors ${
              regla.activo ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${regla.activo ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {regla.activo ? 'Activo' : 'Inactivo'}
          </button>
          <button className="btn-ghost h-8" onClick={() => setAbierto((v) => !v)}>
            {abierto ? 'Cerrar' : 'Configurar'}
          </button>
        </div>
      </div>

      {abierto && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-slate-50/50">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Grupos de correo</label>
              <div className="space-y-1.5 mt-1">
                {grupos.length === 0 && <p className="text-xs text-slate-400">No hay grupos creados.</p>}
                {grupos.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-brand-green-ink" checked={form.grupoIds.includes(g.id)} onChange={() => toggleGrupo(g.id)} />
                    {g.nombre}
                    {!g.activo && <span className="text-xs text-slate-400">(inactivo)</span>}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Usuarios internos</label>
              <div className="space-y-1.5 mt-1 max-h-40 overflow-auto">
                {usuarios.length === 0 && <p className="text-xs text-slate-400">No hay usuarios con email cargado.</p>}
                {usuarios.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-brand-green-ink" checked={form.usuarioIds.includes(u.id)} onChange={() => toggleUsuario(u.id)} />
                    {u.nombre} <span className="text-xs text-slate-400">{u.email}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-green-ink"
              checked={form.incluirCliente}
              onChange={(e) => setForm({ ...form, incluirCliente: e.target.checked })}
            />
            Incluir también al cliente de la devolución (usa el email del cliente)
          </label>

          <Field label="Asunto" hint={`Placeholders: ${PLACEHOLDERS}`}>
            <input className="input w-full" value={form.asunto} onChange={(e) => setForm({ ...form, asunto: e.target.value })} maxLength={255} />
          </Field>
          <Field label="Cuerpo">
            <textarea className="input w-full min-h-28" value={form.cuerpo} onChange={(e) => setForm({ ...form, cuerpo: e.target.value })} />
          </Field>

          <div className="flex gap-2">
            <button className="btn-accent" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setForm({
                  asunto: regla.asunto,
                  cuerpo: regla.cuerpo,
                  incluirCliente: regla.incluirCliente,
                  grupoIds: regla.grupoIds,
                  usuarioIds: regla.usuarioIds,
                });
                setAbierto(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
