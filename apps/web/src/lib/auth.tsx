import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, clearToken, getToken, setToken } from './api';

export interface Actor {
  sub: number;
  tipo: 'usuario' | 'cliente';
  nombre: string;
  permisos: string[];
  primerIngreso: boolean;
}

interface LoginResp {
  token: string;
  tipo: 'usuario' | 'cliente';
  nombre: string;
  permisos: string[];
  primerIngreso: boolean;
}

interface AuthCtx {
  actor: Actor | null;
  cargando: boolean;
  loginUsuario: (username: string, clave: string) => Promise<void>;
  loginCliente: (nroCliente: string, clave: string) => Promise<void>;
  logout: () => void;
  puede: (permiso: string) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setCargando(false);
      return;
    }
    api
      .get<Actor>('/auth/me')
      .then(setActor)
      .catch(() => clearToken())
      .finally(() => setCargando(false));
  }, []);

  const aplicar = (r: LoginResp) => {
    setToken(r.token);
    setActor({
      sub: 0,
      tipo: r.tipo,
      nombre: r.nombre,
      permisos: r.permisos,
      primerIngreso: r.primerIngreso,
    });
  };

  const value: AuthCtx = {
    actor,
    cargando,
    loginUsuario: async (username, clave) => {
      aplicar(await api.post<LoginResp>('/auth/login/usuario', { username, clave }));
    },
    loginCliente: async (nroCliente, clave) => {
      aplicar(await api.post<LoginResp>('/auth/login/cliente', { nroCliente, clave }));
    },
    logout: () => {
      clearToken();
      setActor(null);
    },
    puede: (permiso) => !!actor?.permisos.includes(permiso),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fuera de AuthProvider');
  return c;
}
