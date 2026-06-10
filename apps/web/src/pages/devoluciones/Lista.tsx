import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { PERMISOS, ESTADOS_ORDEN, ESTADO_LABEL, type Estado } from '../../lib/estados';
import { Card, EmptyState, EstadoBadge, Field, Spinner } from '../../components/ui';

interface Autorizacion {
  id: number;
  estado: Estado;
  clienteId: number;
  bultosDeclarados: number | null;
  createdAt: string;
}

export function DevolucionesLista() {
  const { puede, actor } = useAuth();
  const [items, setItems] = useState<Autorizacion[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [clienteId, setClienteId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setItems(null);
    api.get<Autorizacion[]>('/devoluciones/autorizaciones').then(setItems).catch(() => setItems([]));
  };
  useEffect(cargar, []);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const body = actor?.tipo === 'cliente' ? {} : { clienteId: Number(clienteId) };
      await api.post('/devoluciones/autorizaciones', body);
      setCreando(false);
      setClienteId('');
      cargar();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const conteo = (e: Estado) => items?.filter((i) => i.estado === e).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Devoluciones</h1>
        {puede(PERMISOS.SOLICITUD_CREAR) && (
          <button className="btn-primary" onClick={() => setCreando((v) => !v)}>
            <Plus className="h-4 w-4" /> Nueva
          </button>
        )}
      </div>

      {/* KPIs por estado */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {ESTADOS_ORDEN.map((e) => (
          <div key={e} className="card p-3">
            <div className="text-2xl font-bold tabnum text-slate-900">{conteo(e)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{ESTADO_LABEL[e]}</div>
          </div>
        ))}
      </div>

      {creando && (
        <Card>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            {actor?.tipo !== 'cliente' && (
              <Field label="ID de cliente">
                <input
                  className="input w-48"
                  value={clienteId}
                  onChange={(e) => setClienteId(e.target.value)}
                  inputMode="numeric"
                  required
                />
              </Field>
            )}
            <button className="btn-accent" type="submit">
              Crear solicitud
            </button>
            {error && <p className="text-sm text-red-600 w-full">{error}</p>}
          </form>
        </Card>
      )}

      {items === null ? (
        <div className="py-12 text-center text-slate-400">
          <Spinner className="text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState titulo="Sin devoluciones" sub="Creá una nueva solicitud para empezar." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Bultos</th>
                <th className="px-4 py-3 font-medium">Creada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/devoluciones/${a.id}`} className="font-semibold text-brand-blue-ink tabnum">
                      #{a.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <EstadoBadge estado={a.estado} />
                  </td>
                  <td className="px-4 py-3 tabnum text-slate-600">{a.clienteId}</td>
                  <td className="px-4 py-3 tabnum text-slate-600">{a.bultosDeclarados ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
