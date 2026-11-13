import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  isElectronApp,
  getActiveSimulatorSession,
  showDesktopNotification,
  type ActiveSimulatorSession,
} from "../lib/streamdbClient";

// Sonido sutil de alerta con Web Audio API (agradable campana de 2 tonos)
function playAlertBeep(isWarning = false) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };

    if (isWarning) {
      // Tono suave de aviso previo (1 tono suave)
      playTone(659.25, 0, 0.3); // E5
    } else {
      // Tono de tiempo cumplido (2 tonos festivos/campana)
      playTone(587.33, 0, 0.25); // D5
      playTone(880.00, 0.15, 0.4); // A5
    }
  } catch {}
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function SimulatorLiveBadge() {
  const isElectron = isElectronApp();
  const [activeSession, setActiveSession] = useState<ActiveSimulatorSession | null>(null);
  const [lastFinishedSession, setLastFinishedSession] = useState<ActiveSimulatorSession | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [isOpen, setIsOpen] = useState(false);

  // Configuración del Timer (minutos objetivo)
  const [targetMinutes, setTargetMinutes] = useState<number>(() => {
    const saved = localStorage.getItem("tracksim_live_timer_minutes");
    return saved ? Number(saved) || 15 : 15;
  });
  const [customInput, setCustomInput] = useState<string>(() => String(targetMinutes));
  const [warningAlertFired, setWarningAlertFired] = useState<boolean>(false);
  const [timerAlertFired, setTimerAlertFired] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const prevSessionIdRef = useRef<number | null>(null);
  const activeSessionRef = useRef<ActiveSimulatorSession | null>(null);
  activeSessionRef.current = activeSession;

  // Guardar preferencia de minutos
  const updateTargetMinutes = (mins: number) => {
    const valid = Math.max(1, Math.min(180, mins));
    setTargetMinutes(valid);
    setCustomInput(String(valid));
    localStorage.setItem("tracksim_live_timer_minutes", String(valid));
  };

  // Sondeo del simulador cada 4 segundos (100% SOLO LECTURA)
  useEffect(() => {
    if (!isElectron) return;

    let isMounted = true;

    const poll = async () => {
      try {
        const res = await getActiveSimulatorSession();
        if (!isMounted) return;

        if (res.ok && res.active && res.session) {
          const current = res.session;
          setActiveSession(current);
          setElapsed(current.elapsedSeconds);

          // Si cambió de sesión (nuevo conductor o nuevo ejercicio), resetear alertas de timer
          if (prevSessionIdRef.current !== current.id) {
            prevSessionIdRef.current = current.id;
            setWarningAlertFired(false);
            setTimerAlertFired(false);
          }
        } else {
          // Si había una sesión activa y ya terminó
          if (activeSessionRef.current) {
            setLastFinishedSession(activeSessionRef.current);
          }
          setActiveSession(null);
          prevSessionIdRef.current = null;
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isElectron]);

  // Cronómetro local segundo a segundo mientras haya sesión activa
  useEffect(() => {
    if (!activeSession) return;
    const ticker = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(ticker);
  }, [activeSession]);

  // Chequeo de Timer y disparo de alertas (Toast, Escritorio y Beep)
  useEffect(() => {
    if (!activeSession) return;

    const targetSeconds = targetMinutes * 60;
    const warningSeconds = Math.max(0, targetSeconds - 15);

    // 1. Alerta de aviso previo (15 segundos antes)
    if (elapsed >= warningSeconds && elapsed < targetSeconds && !warningAlertFired) {
      setWarningAlertFired(true);

      const title = "⚠️ Quedan 15 segundos";
      const body = `El ejercicio de ${activeSession.driver} terminará en 15 segundos.`;

      playAlertBeep(true);
      showDesktopNotification(title, body).catch(() => {});
      setToastMessage(body);
      setTimeout(() => setToastMessage(null), 6000);
    }

    // 2. Alerta de tiempo cumplido
    if (elapsed >= targetSeconds && !timerAlertFired) {
      setTimerAlertFired(true);

      const title = "⏱️ Tiempo cumplido en Simulador";
      const body = `${activeSession.driver} ha alcanzado los ${targetMinutes} min de ejercicio en el simulador.`;

      // Alerta sonora final
      playAlertBeep(false);

      // Notificación de escritorio Windows nativa
      showDesktopNotification(title, body).catch(() => {});

      // Toast visual en pantalla
      setToastMessage(body);
      setTimeout(() => setToastMessage(null), 8000);
    }
  }, [elapsed, targetMinutes, activeSession, warningAlertFired, timerAlertFired]);

  // Solo mostrar en la aplicación de escritorio
  if (!isElectron) return null;

  const targetSeconds = targetMinutes * 60;
  const progressPercent = Math.min(100, Math.round((elapsed / Math.max(1, targetSeconds)) * 100));
  const isTimeOver = elapsed >= targetSeconds;

  return (
    <>
      {/* Toast emergente si se cumple el tiempo */}
      {toastMessage && (
        <div className="fixed bottom-12 right-6 z-50 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-xl text-slate-800 animate-bounce">
          <span className="text-2xl">⏱️</span>
          <div>
            <div className="text-xs font-bold uppercase text-amber-800">Alerta de Tiempo de Simulación</div>
            <div className="text-sm font-semibold">{toastMessage}</div>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-slate-700 text-lg leading-none cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* Botón Badge en la barra de estado */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`group relative flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition cursor-pointer select-none ${
          activeSession
            ? isTimeOver
              ? "border-amber-400 bg-amber-50 text-amber-900 shadow-xs"
              : "border-emerald-400 bg-emerald-50 text-emerald-900 shadow-xs"
            : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
        }`}
        title="Clic para ver monitor en vivo y configurar timer de ejercicio"
      >
        {activeSession ? (
          <>
            <span className="relative flex h-2 w-2">
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                  isTimeOver ? "bg-amber-500" : "bg-emerald-500"
                }`}
              />
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isTimeOver ? "bg-amber-600" : "bg-emerald-600"
                }`}
              />
            </span>
            <span className="max-w-[140px] truncate font-bold">{activeSession.driver}</span>
            <span className="font-mono text-[10px] text-slate-500">
              {formatSeconds(elapsed)} / {targetMinutes}m
            </span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            <span>Simulador en espera</span>
          </>
        )}
      </button>

      {/* Modal de Monitoreo y Ajuste de Timer montado en document.body mediante Portal */}
      {isOpen &&
        createPortal(
          <div
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5"
            >
              {/* Encabezado */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-3 w-3 relative">
                    {activeSession ? (
                      <>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                      </>
                    ) : (
                      <span className="h-3 w-3 rounded-full bg-slate-300" />
                    )}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">
                    {activeSession ? "Simulación en Vivo" : "Simulador en Espera"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Estado del Conductor Actual */}
              {activeSession ? (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                        Conductor en cabina
                      </div>
                      <div className="text-lg font-extrabold text-slate-900">{activeSession.driver}</div>
                      {activeSession.instructor && (
                        <div className="text-xs text-slate-600 mt-0.5">
                          Instructor: <span className="font-semibold">{activeSession.instructor}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black font-mono text-emerald-700">
                        {formatSeconds(elapsed)}
                      </div>
                      <div className="text-[10px] text-slate-500">transcurrido</div>
                    </div>
                  </div>

                  {activeSession.exercise && (
                    <div className="text-xs text-slate-700 bg-white/70 rounded-lg p-2 border border-emerald-100/60">
                      <div className="font-semibold text-slate-800 line-clamp-2">
                        {activeSession.exercise.replace(/\n+/g, " · ")}
                      </div>
                    </div>
                  )}

                  {/* Barra de progreso contra el timer objetivo */}
                  <div>
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>Progreso del ejercicio</span>
                      <span className="font-bold">
                        {formatSeconds(elapsed)} de {targetMinutes}:00 min ({progressPercent}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          isTimeOver ? "bg-amber-500" : "bg-emerald-500"
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-center space-y-1">
                  <div className="text-slate-400 text-3xl">⏸️</div>
                  <div className="text-sm font-semibold text-slate-700">No hay conductor activo actualmente</div>
                  <div className="text-xs text-slate-500">
                    En cuanto alguien inicie un ejercicio en el simulador Lander, aparecerá aquí automáticamente.
                  </div>
                  {lastFinishedSession && (
                    <div className="mt-3 pt-3 border-t border-slate-200 text-left text-xs text-slate-600">
                      <span className="font-bold text-slate-700">Última sesión finalizada:</span>{" "}
                      {lastFinishedSession.driver} ({formatSeconds(lastFinishedSession.elapsedSeconds)})
                    </div>
                  )}
                </div>
              )}

              {/* Configuración del Timer de Ejercicio */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    ⏱️ Duración Objetivo del Timer
                  </label>
                  <span className="text-xs font-bold text-indigo-600">{targetMinutes} minutos</span>
                </div>

                {/* Botones de tiempos rápidos */}
                <div className="grid grid-cols-4 gap-2">
                  {[10, 15, 20, 25].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => updateTargetMinutes(mins)}
                      className={`rounded-lg py-1.5 text-xs font-bold transition cursor-pointer ${
                        targetMinutes === mins
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {mins} min
                    </button>
                  ))}
                </div>

                {/* Input personalizado */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-slate-500">O personalizar:</span>
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onBlur={() => {
                      const n = Number(customInput);
                      if (!isNaN(n) && n > 0) updateTargetMinutes(n);
                      else setCustomInput(String(targetMinutes));
                    }}
                    className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-center text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                  <span className="text-xs text-slate-500">minutos</span>
                  <button
                    type="button"
                    onClick={() => {
                      playAlertBeep();
                      showDesktopNotification(
                        "🔔 Prueba de Notificación",
                        "Si ves este aviso, las notificaciones de Windows están funcionando correctamente."
                      ).catch(() => {});
                    }}
                    className="ml-auto text-[11px] text-slate-500 hover:text-indigo-600 cursor-pointer underline"
                    title="Probar sonido y notificación de escritorio"
                  >
                    Probar alerta 🔔
                  </button>
                </div>

                <p className="text-[11px] text-slate-400 italic">
                  * Conexión con Lander DB en modo estrictamente de solo lectura (SELECT). Al llegar a la duración fijada,
                  recibirás notificación toast y aviso de escritorio en Windows.
                </p>
              </div>

              {/* Pie del modal */}
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

