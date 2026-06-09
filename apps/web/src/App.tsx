import { useEffect, useState } from 'react';
import type { HealthResponse } from '@wms/shared';

type Estado = 'cargando' | 'ok' | 'error';

export default function App() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [salud, setSalud] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthResponse>)
      .then((data) => {
        setSalud(data);
        setEstado(data.db === 'up' ? 'ok' : 'error');
      })
      .catch(() => setEstado('error'));
  }, []);

  const badge =
    estado === 'cargando'
      ? { texto: 'Conectando…', color: '#6b7280' }
      : estado === 'ok'
        ? { texto: 'DB-OK', color: '#16a34a' }
        : { texto: 'DB-DOWN', color: '#dc2626' };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0b0b0b',
        color: '#fff',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>
          WMS Grupal — Devoluciones
        </h1>
        <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>
          Esqueleto desplegable · API + PWA en un solo deployable
        </p>
        <div
          style={{
            marginTop: '1.5rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderRadius: '9999px',
            background: 'rgba(255,255,255,0.08)',
            border: `1px solid ${badge.color}`,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: badge.color,
              boxShadow: `0 0 10px ${badge.color}`,
            }}
          />
          <strong>{badge.texto}</strong>
        </div>
        {salud && (
          <p style={{ opacity: 0.5, marginTop: '1rem', fontSize: '0.8rem' }}>
            status: {salud.status} · {salud.ts}
          </p>
        )}
      </div>
    </main>
  );
}
