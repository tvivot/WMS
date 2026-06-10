import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  LogOut,
  Menu,
  PackageCheck,
  Shield,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { PERMISOS } from '../lib/estados';
import { OfflineIndicator } from './OfflineIndicator';

interface NavItem {
  to: string;
  label: string;
  icon: typeof BookOpen;
  permiso?: string;
}

const ITEMS: NavItem[] = [
  { to: '/devoluciones', label: 'Devoluciones', icon: ClipboardList },
  { to: '/informes', label: 'Informes', icon: BarChart3, permiso: PERMISOS.INFORMES_VER },
  { to: '/catalogo', label: 'Catálogo', icon: BookOpen, permiso: PERMISOS.CATALOGO_ADMINISTRAR },
  { to: '/clientes', label: 'Clientes', icon: Building2, permiso: PERMISOS.CLIENTE_ADMINISTRAR },
  { to: '/transportistas', label: 'Transportistas', icon: Truck, permiso: PERMISOS.TRANSPORTISTA_ADMINISTRAR },
  { to: '/usuarios', label: 'Usuarios', icon: Users, permiso: PERMISOS.USUARIO_ADMINISTRAR },
  { to: '/roles', label: 'Roles', icon: Shield, permiso: PERMISOS.ROL_ADMINISTRAR },
];

export function AppShell() {
  const { actor, logout, puede } = useAuth();
  const nav = useNavigate();
  const [abierto, setAbierto] = useState(false);

  const visibles = ITEMS.filter((i) => !i.permiso || puede(i.permiso));

  const salir = () => {
    logout();
    nav('/login');
  };

  return (
    <div className="min-h-dvh flex flex-col bg-slate-50">
      <header className="bg-shell-900 text-white sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-4">
          <button
            className="md:hidden p-2 -ml-2"
            onClick={() => setAbierto((v) => !v)}
            aria-label="Menú"
          >
            {abierto ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          <img src="/brand/logo-blanco.png" alt="Grupal" className="h-7 w-auto" />
          <span className="hidden sm:inline text-sm font-medium text-white/60">
            WMS · Devoluciones
          </span>

          <nav className="hidden md:flex items-center gap-1 ml-6">
            {visibles.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                className={({ isActive }) =>
                  `px-3 h-9 inline-flex items-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-white/15 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <i.icon className="h-4 w-4" />
                {i.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <OfflineIndicator />
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-sm font-semibold">{actor?.nombre}</div>
              <div className="text-[11px] text-white/50 capitalize">{actor?.tipo}</div>
            </div>
            <button
              onClick={salir}
              className="p-2 rounded-lg hover:bg-white/10"
              aria-label="Salir"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        {abierto && (
          <nav className="md:hidden border-t border-white/10 px-4 py-2 space-y-1">
            {visibles.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                onClick={() => setAbierto(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 h-11 rounded-lg text-sm font-medium ${
                    isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                  }`
                }
              >
                <i.icon className="h-5 w-5" />
                {i.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">
        <Outlet />
      </main>

      <footer className="py-4 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
        <PackageCheck className="h-3.5 w-3.5" />
        WMS Grupal · módulo Devoluciones
      </footer>
    </div>
  );
}
