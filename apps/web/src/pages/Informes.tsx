import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Boxes, CheckCircle2, Clock, PackageX } from 'lucide-react';
import { api } from '../lib/api';
import { ESTADO_LABEL, type Estado } from '../lib/estados';
import { Card, Spinner } from '../components/ui';

interface Resumen {
  total: number;
  procesadas: number;
  enCurso: number;
  libros: { recibido: number; bueno: number; malo: number };
  porEstado: Record<string, number>;
}

const COLORES_ESTADO: Record<string, string> = {
  A_APROBAR: '#D97706', APROBADO: '#0EA5E9', EN_TRANSITO: '#6366F1',
  ENTREGADO: '#8B5CF6', INGRESO_DEPOSITO: '#06B6D4', PROCESADO: '#10B981',
};

function Kpi({ icon: Icon, label, valor, color }: { icon: typeof Boxes; label: string; valor: number; color: string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="h-10 w-10 rounded-lg grid place-items-center text-white" style={{ background: color }}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-bold tabnum leading-none">{valor}</div>
        <div className="text-xs text-slate-500 mt-1">{label}</div>
      </div>
    </div>
  );
}

export function Informes() {
  const [r, setR] = useState<Resumen | null>(null);
  const [serie, setSerie] = useState<{ dia: string; cantidad: number }[]>([]);
  const [clientes, setClientes] = useState<{ nombre: string; cantidad: number }[]>([]);

  useEffect(() => {
    api.get<Resumen>('/devoluciones/informes/resumen').then(setR).catch(() => {});
    api.get<typeof serie>('/devoluciones/informes/serie').then(setSerie).catch(() => {});
    api.get<typeof clientes>('/devoluciones/informes/por-cliente').then(setClientes).catch(() => {});
  }, []);

  if (!r) return <div className="py-12 text-center"><Spinner className="text-slate-400" /></div>;

  const dataEstados = (Object.keys(r.porEstado) as Estado[]).map((e) => ({
    estado: ESTADO_LABEL[e] ?? e,
    key: e,
    cantidad: r.porEstado[e],
  }));
  const calidad = [
    { name: 'Para la venta', value: r.libros.bueno, color: '#10B981' },
    { name: 'Mal estado', value: r.libros.malo, color: '#EF4444' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Informes</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Boxes} label="Devoluciones" valor={r.total} color="#334155" />
        <Kpi icon={CheckCircle2} label="Procesadas" valor={r.procesadas} color="#10B981" />
        <Kpi icon={Clock} label="En curso" valor={r.enCurso} color="#6366F1" />
        <Kpi icon={PackageX} label="Libros en mal estado" valor={r.libros.malo} color="#EF4444" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h2 className="font-semibold mb-4">Por estado</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dataEstados} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="estado" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="cantidad" radius={[4, 4, 0, 0]}>
                {dataEstados.map((d) => (
                  <Cell key={d.key} fill={COLORES_ESTADO[d.key] ?? '#64748B'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="font-semibold mb-4">Estado de los libros controlados</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={calidad} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={100} />
              <Tooltip />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {calidad.map((c) => (
                  <Cell key={c.name} fill={c.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="font-semibold mb-4">Devoluciones por día</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={serie} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="cantidad" stroke="#2A93C4" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="font-semibold mb-4">Top clientes</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={clientes} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11 }} width={110} />
              <Tooltip />
              <Bar dataKey="cantidad" fill="#61CE70" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
