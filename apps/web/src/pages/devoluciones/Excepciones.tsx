import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, EmptyState, ProductoThumb, Spinner } from '../../components/ui';

interface Pendiente {
  id: number;
  autorizacionId: number;
  isbn: string;
  cantidad: number;
  titulo: string | null;
  editorial: string | null;
  imagenUrl: string | null;
  motivoSolicitud: string | null;
  createdAt: string;
  cliente: { id: number; nroCliente: string; nombre: string } | null;
}

export function ExcepcionesConsignacion() {
  const [data, setData] = useState<Pendiente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    api
      .get<Pendiente[]>('/devoluciones/autorizaciones/excepciones/pendientes')
      .then(setData)
      .catch(() => setData([]));
  }, []);
  useEffect(cargar, [cargar]);

  const resolver = async (p: Pendiente, aprobar: boolean) => {
    setError(null);
    try {
      await api.patch(
        `/devoluciones/autorizaciones/${p.autorizacionId}/excepciones/${p.id}/resolver`,
        { aprobar },
      );
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-brand-blue-ink" />
        <h1 className="text-xl font-bold">Autorizaciones de consignación</h1>
      </div>
      <p className="text-sm text-slate-500 -mt-3">
        Solicitudes de clientes para devolver libros fuera de su consignación. Aprobalas o rechazalas;
        recién entonces el cliente puede declarar ese libro en su devolución.
      </p>

      {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg" role="alert">{error}</p>}

      {data === null ? (
        <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>
      ) : data.length === 0 ? (
        <EmptyState titulo="Sin solicitudes pendientes" sub="Cuando un cliente pida autorizar un libro fuera de consignación, aparece acá." />
      ) : (
        <Card className="divide-y divide-slate-100 p-0">
          {data.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-4">
              <ProductoThumb producto={{ isbn: p.isbn, titulo: p.titulo ?? p.isbn, editorial: p.editorial, imagenUrl: p.imagenUrl }} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 truncate">{p.titulo ?? '—'}</div>
                <div className="text-[11px] text-slate-400 tabnum">{p.isbn} · {p.cantidad} u.</div>
                <div className="text-xs text-slate-600 mt-0.5">
                  <Link to={`/devoluciones/${p.autorizacionId}`} className="text-brand-blue-ink tabnum">#{p.autorizacionId}</Link>
                  {p.cliente && <span className="ml-2"><span className="tabnum text-slate-400">{p.cliente.nroCliente}</span> {p.cliente.nombre}</span>}
                </div>
                {p.motivoSolicitud && <div className="text-[11px] text-slate-500 italic truncate">“{p.motivoSolicitud}”</div>}
              </div>
              <span className="flex gap-1 shrink-0">
                <button className="btn-accent !py-1 !px-3 text-xs" onClick={() => resolver(p, true)}>Aprobar</button>
                <button className="btn-ghost !py-1 !px-3 text-xs !text-red-600" onClick={() => resolver(p, false)}>Rechazar</button>
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
