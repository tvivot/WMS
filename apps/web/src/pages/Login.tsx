import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Spinner } from '../components/ui';

export function Login() {
  const { loginUsuario, loginCliente } = useAuth();
  const nav = useNavigate();
  const [modo, setModo] = useState<'usuario' | 'cliente'>('usuario');
  const [u1, setU1] = useState('');
  const [c1, setC1] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      if (modo === 'usuario') await loginUsuario(u1, c1);
      else await loginCliente(u1, c1);
      nav('/devoluciones');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-dvh grid place-items-center bg-shell-900 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/brand/logo-blanco.png" alt="Grupal" className="h-10 mx-auto" />
          <p className="mt-3 text-white/60 text-sm">WMS · Devoluciones</p>
        </div>

        <div className="card p-6">
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-5">
            {(['usuario', 'cliente'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setModo(m);
                  setError(null);
                }}
                className={`h-9 rounded-md text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  modo === m ? 'bg-white shadow-sm text-shell-900' : 'text-slate-500'
                }`}
              >
                {m === 'usuario' ? <User className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                {m === 'usuario' ? 'Interno' : 'Cliente'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">
                {modo === 'usuario' ? 'Usuario' : 'Número de cliente'}
              </label>
              <input
                className="input"
                value={u1}
                onChange={(e) => setU1(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Clave</label>
              <input
                className="input"
                type="password"
                value={c1}
                onChange={(e) => setC1(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={cargando}>
              {cargando ? <Spinner /> : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
