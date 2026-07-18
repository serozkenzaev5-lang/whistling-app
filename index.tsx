import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Свист-Эхо — приложение, которое отвечает свистом" },
      {
        name: "description",
        content:
          "Свистни в микрофон — приложение услышит свист и ответит свистом той же частоты.",
      },
      { property: "og:title", content: "Свист-Эхо" },
      {
        property: "og:description",
        content: "Свистни — и приложение свистнет в ответ.",
      },
    ],
  }),
  component: Index,
});

// Диапазон типичного человеческого свиста
const MIN_FREQ = 800;
const MAX_FREQ = 4000;
// Порог громкости доминирующей частоты (0..255 по getByteFrequencyData)
const MAGNITUDE_THRESHOLD = 160;
// Пауза после ответа, чтобы не реагировать на собственный свист
const COOLDOWN_MS = 900;

function Index() {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Нажми кнопку и разреши доступ к микрофону");
  const [lastFreq, setLastFreq] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef(0);

  const playWhistle = useCallback((freq: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const now = ctx.currentTime;
    const dur = 0.55;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
    gain.gain.linearRampToValueAtTime(0.35, now + dur - 0.1);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    // лёгкое вибрато для «живого» свиста
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5;
    lfoGain.gain.value = freq * 0.01;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + dur);
    lfo.stop(now + dur);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    setListening(false);
    setStatus("Остановлено");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = audioCtxRef.current ?? new AudioCtx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bins = new Uint8Array(analyser.frequencyBinCount);
      const binHz = ctx.sampleRate / analyser.fftSize;
      const minBin = Math.floor(MIN_FREQ / binHz);
      const maxBin = Math.min(bins.length - 1, Math.ceil(MAX_FREQ / binHz));

      setListening(true);
      setStatus("Слушаю... свистни!");

      const loop = () => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteFrequencyData(bins);

        let peakBin = -1;
        let peakVal = 0;
        for (let i = minBin; i <= maxBin; i++) {
          if (bins[i] > peakVal) {
            peakVal = bins[i];
            peakBin = i;
          }
        }

        // Проверка «тоновости»: пик должен заметно выделяться над соседями
        const now = performance.now();
        if (
          peakBin > 0 &&
          peakVal > MAGNITUDE_THRESHOLD &&
          now > cooldownUntilRef.current
        ) {
          const neighborAvg =
            (bins[Math.max(minBin, peakBin - 10)] +
              bins[Math.min(maxBin, peakBin + 10)]) /
            2;
          if (peakVal - neighborAvg > 30) {
            const freq = peakBin * binHz;
            setLastFreq(freq);
            setStatus(`Услышал свист ~${Math.round(freq)} Гц — отвечаю!`);
            cooldownUntilRef.current = now + COOLDOWN_MS;
            playWhistle(freq);
          }
        }

        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось получить доступ к микрофону";
      setError(msg);
      setStatus("Ошибка");
      setListening(false);
    }
  }, [playWhistle]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b from-background to-muted px-6 py-12 text-foreground">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Свист-Эхо</h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground sm:text-base">
          Свистни в микрофон — приложение услышит и ответит свистом той же частоты.
        </p>
      </header>

      <div
        className={`relative flex h-56 w-56 items-center justify-center rounded-full border transition-all ${
          listening
            ? "border-primary/40 bg-primary/5 shadow-[0_0_60px_-10px_var(--color-primary)]"
            : "border-border bg-card"
        }`}
      >
        {listening && (
          <>
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" />
            <span className="absolute inset-4 animate-pulse rounded-full bg-primary/5" />
          </>
        )}
        <div className="relative text-center">
          <div className="text-6xl">🎵</div>
          <div className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
            {listening ? "в эфире" : "готов"}
          </div>
        </div>
      </div>

      <button
        onClick={listening ? stop : start}
        className="rounded-full bg-primary px-8 py-3 text-base font-medium text-primary-foreground shadow-lg transition hover:opacity-90 active:scale-95"
      >
        {listening ? "Остановить" : "Начать слушать"}
      </button>

      <div className="min-h-[3rem] text-center">
        <p className="text-sm text-muted-foreground">{status}</p>
        {lastFreq !== null && (
          <p className="mt-1 text-xs text-muted-foreground/70">
            Последняя частота: {Math.round(lastFreq)} Гц
          </p>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>

      <footer className="max-w-sm text-center text-xs text-muted-foreground/70">
        Совет: свисти чётко и держи телефон на расстоянии 10–20 см. Работает лучше в
        тишине.
      </footer>
    </main>
  );
}
