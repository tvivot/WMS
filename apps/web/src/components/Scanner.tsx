import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, CameraOff, ScanLine } from 'lucide-react';

interface Props {
  onScan: (codigo: string) => void;
  placeholder?: string;
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
export function Scanner({ onScan, placeholder = 'Escanear o tipear ISBN…' }: Props) {
  const [manual, setManual] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ultimoRef = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const stopRef = useRef<(() => void) | null>(null);

  const emitir = (code: string) => {
    const limpio = code.trim();
    if (!limpio) return;
    const now = Date.now();
    if (ultimoRef.current.code === limpio && now - ultimoRef.current.t < 1500) return;
    ultimoRef.current = { code: limpio, t: now };
    onScan(limpio);
    if (navigator.vibrate) navigator.vibrate(40);
  };

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
              if (r[0]?.rawValue) emitir(r[0].rawValue);
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
            if (res) emitir(res.getText());
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
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          emitir(manual);
          setManual('');
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
            onChange={(e) => setManual(e.target.value)}
            placeholder={placeholder}
            className="input pl-10 tabnum"
          />
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
