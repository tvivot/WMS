import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Catalogo } from './pages/Catalogo';
import { Clientes } from './pages/Clientes';
import { Transportistas } from './pages/Transportistas';
import { Usuarios } from './pages/Usuarios';
import { Roles } from './pages/Roles';
import { Configuracion } from './pages/Configuracion';
import { Informes } from './pages/Informes';
import { DevolucionesLista } from './pages/devoluciones/Lista';
import { DevolucionDetalle } from './pages/devoluciones/Detalle';
import { Spinner } from './components/ui';

function Protegido({ children }: { children: React.ReactNode }) {
  const { actor, cargando } = useAuth();
  if (cargando)
    return (
      <div className="min-h-dvh grid place-items-center bg-slate-50">
        <Spinner className="text-slate-400 h-6 w-6" />
      </div>
    );
  if (!actor) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Protegido>
                <AppShell />
              </Protegido>
            }
          >
            <Route path="/devoluciones" element={<DevolucionesLista />} />
            <Route path="/devoluciones/:id" element={<DevolucionDetalle />} />
            <Route path="/informes" element={<Informes />} />
            <Route path="/catalogo" element={<Catalogo />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/transportistas" element={<Transportistas />} />
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/roles" element={<Roles />} />
            <Route path="/configuracion" element={<Configuracion />} />
          </Route>
          <Route path="*" element={<Navigate to="/devoluciones" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
