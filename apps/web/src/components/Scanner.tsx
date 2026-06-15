import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BookOpen, Camera, CameraOff, ScanLine } from 'lucide-react';
import { buscarProductos, type ProductoLite } from '../lib/producto';

interface Props {
  onScan: (codigo: string) => void;
  placeholder?: string;
  /**
   * Si se pasa, activa el typeahead de catálogo: al tipear (≥4 caracteres) se
   * sugieren productos con su portada y, al elegir uno (click o Enter), se llama
   * a `onElegir` con el producto ya resuelto (sin re-consultar por ISBN).
   */
  onElegir?: (p: ProductoLite) => void;
}

// Tipado mínimo de la API nativa BarcodeDetector (no está en lib.dom).
type BarcodeDetectorLike = {
  detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Escáner de ISBN: input manual (sirve también como wedge para lectores USB) +
 * cámara con BarcodeDetector nativo y fallback a ZXing. Debounce anti doble-lectura.
 */
export function Scanner({ onScan, placeholder = 'Escanear o tipear ISBN…', onElegir }: Props) {
  const [manual, setManual] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<ProductoLite[]>([]);
  const [activo, setActivo] = useState(-1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ultimoRef = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const vistosRef = useRef<Map<string, number>>(new Map());
  const stopRef = useRef<(() => void) | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const reqRef = useRef(0);
  const cajaRef = useRef<HTMLDivElement>(null);

  const emitir = (code: string) => {
    const limpio = code.trim();
    if (!limpio) return;
    const now = Date.now();
    if (ultimoRef.current.code === limpio && now - ultimoRef.current.t < 1500) return;
    ultimoRef.current = { code: limpio, t: now };
    onScan(limpio);
    if (navigator.vibrate) navigator.vibrate(40);
  };

  /**
   * Detección por cámara: el mismo código sostenido frente al lente NO debe
   * re-sumar en cada frame. Solo se emite si el código dejó de verse por un
   * rato (salió del cuadro) — para sumar otra copia, retirá el libro y volvé
   * a mostrarlo.
   */
  const emitirDesdeCamara = (code: string) => {
    const limpio = code.trim();
    if (!limpio) return;
    const now = Date.now();
    const ultimaVez = vistosRef.current.get(limpio);
    vistosRef.current.set(limpio, now);
    if (ultimaVez !== undefined && now - ultimaVez < 1200) return; // sigue en cuadro
    onScan(limpio);
    if (navigator.vibrate) navigator.vibrate(40);
  };

  const cerrarSugerencias = () => {
    setSugerencias([]);
    setActivo(-1);
  };

  const elegir = (p: ProductoLite) => {
    onElegir?.(p);
    setManual('');
    cerrarSugerencias();
    if (navigator.vibrate) navigator.vibrate(40);
  };

  // Typeahead: busca productos (con portada) tras 250ms sin tipear, ≥4 chars.
  // `reqRef` descarta respuestas viejas que llegan fuera de orden.
  const onCambioManual = (valor: string) => {
    setManual(valor);
    if (!onElegir) return;
    clearTimeout(debounceRef.current);
    if (valor.trim().length < 4) {
      cerrarSugerencias();
      return;
    }
    const req = ++reqRef.current;
    debounceRef.current = setTimeout(() => {
      buscarProductos(valor)
        .then((r) => {
          if (req !== reqRef.current) return; // respuesta obsoleta
          setSugerencias(r);
          setActivo(-1);
        })
        .catch(() => {
          if (req === reqRef.current) cerrarSugerencias();
        });
    }, 250);
  };

  const onTeclaManual = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (sugerencias.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActivo((i) => (i + 1) % sugerencias.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivo((i) => (i <= 0 ? sugerencias.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      // Con el dropdown abierto, Enter carga la sugerencia resaltada (o la 1ª):
      // gana al submit del form y evita resolver un título como si fuera ISBN.
      e.preventDefault();
      elegir(sugerencias[activo >= 0 ? activo : 0]);
    } else if (e.key === 'Escape') {
      cerrarSugerencias();
    }
  };

  // Cerrar el dropdown al hacer click fuera.
  useEffect(() => {
    if (sugerencias.length === 0) return;
    const cerrar = (e: MouseEvent) => {
      if (!cajaRef.current?.contains(e.target as Node)) cerrarSugerencias();
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [sugerencias.length]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  useEffect(() => {
    if (!camOn) {
      stopRef.current?.();
      stopRef.current = null;
      return;
    }
    let cancelado = false;
    setError(null);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        if (window.BarcodeDetector) {
          const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8'] });
          const loop = async () => {
            if (cancelado) return;
            try {
              const r = await det.detect(video);
              if (r[0]?.rawValue) emitirDesdeCamara(r[0].rawValue);
            } catch {
              /* ignora frames sin código */
            }
            requestAnimationFrame(loop);
          };
          loop();
          stopRef.current = () => stream.getTracks().forEach((t) => t.stop());
        } else {
          // Fallback ZXing (iOS Safari sin BarcodeDetector).
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromStream(stream, video, (res) => {
            if (res) emitirDesdeCamara(res.getText());
          });
          stopRef.current = () => {
            controls.stop();
            stream.getTracks().forEach((t) => t.stop());
          };
        }
      } catch {
        if (!cancelado) {
          setError('No se pudo abrir la cámara. Usá el ingreso manual.');
          setCamOn(false);
        }
      }
    })();

    return () => {
      cancelado = true;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [camOn]);

  return (
    <div className="space-y-3" ref={cajaRef}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          emitir(manual);
          setManual('');
          cerrarSugerencias();
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          {/* autoFocus: captura el wedge del lector USB */}
          <input
            autoFocus
            inputMode="numeric"
            value={manual}
            onChange={(e) => onCambioManual(e.target.value)}
            onKeyDown={onTeclaManual}
            placeholder={placeholder}
            className="input pl-10 tabnum"
            autoComplete="off"
          />
          {sugerencias.length > 0 && (
            <ul className="absolute left-0 right-0 top-12 z-30 card p-1 max-h-72 overflow-auto animate-fade-in">
              {sugerencias.map((s, i) => (
                <li key={`${s.isbn}-${i}`}>
                  <button
                    type="button"
                    // mousedown (no click): elige antes de que el blur cierre el dropdown
                    onMouseDown={(e) => { e.preventDefault(); elegir(s); }}
                    onMouseEnter={() => setActivo(i)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left ${
                      i === activo ? 'bg-brand-green/10' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-100">
                      {s.imagenUrl ? (
                        <img src={s.imagenUrl} alt={s.titulo} className="h-full w-full object-cover" />
                      ) : (
                        <BookOpen className="h-4 w-4 text-slate-300" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{s.titulo}</span>
                      <span className="block truncate text-xs text-slate-400 tabnum">
                        {s.isbn}{s.editorial ? ` · ${s.editorial}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="btn-primary">
          Agregar
        </button>
        <button
          type="button"
          onClick={() => setCamOn((v) => !v)}
          className={camOn ? 'btn-accent' : 'btn-outline'}
          aria-label={camOn ? 'Apagar cámara' : 'Encender cámara'}
        >
          {camOn ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
        </button>
      </form>

      {camOn && (
        <div className="relative overflow-hidden rounded-xl bg-black aspect-video">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 bg-brand-green animate-scan-pulse" />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
