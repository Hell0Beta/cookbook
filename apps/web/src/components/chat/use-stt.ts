"use client";

// Push-to-talk + always-on STT hook — development.md §14.1 / design.md §3.3.4.
//
// Push-to-talk (Standard mode): tap to arm, tap to stop; the clip is
// transcribed locally by the whisper worker and the text lands in the
// caller's onResult.
//
// Always-on mode: startContinuous() keeps the mic open. An AnalyserNode
// samples the stream's RMS every frame and feeds TurnSegmenter (lib/vad.ts);
// trailing silence ends the turn (recorder stops → transcribe → onResult),
// and the caller resumes listening with resume() once the spoken reply
// finishes — the mic is deliberately off while the assistant talks, so it
// never hears itself. Empty/noise transcriptions call onMiss and re-arm.
//
// Capture: MediaRecorder → Blob → decodeAudioData → OfflineAudioContext
// downmix/resample to 16 kHz mono Float32 (what whisper expects). Every
// browser-API branch is try/catch — unsupported browsers degrade to typing.
import { useCallback, useEffect, useRef, useState } from "react";
import { TurnSegmenter, VAD_DEFAULTS } from "@/lib/vad";

export type SttStatus = "idle" | "loading-model" | "listening" | "transcribing" | "error";

interface WorkerStatus {
  type: "status" | "result";
  stage?: "loading" | "ready" | "transcribing" | "error";
  message?: string;
  text?: string;
}

export function useStt(onResult: (text: string) => void, onMiss?: () => void) {
  const [status, setStatus] = useState<SttStatus>("idle");
  const [continuous, setContinuous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onMissRef = useRef(onMiss);
  onMissRef.current = onMiss;
  // Always-on loop state. continuousRef mirrors `continuous` for the async
  // callbacks (onstop/onmessage) that must not see a stale closure.
  const continuousRef = useRef(false);
  const vadCleanupRef = useRef<(() => void) | null>(null);
  // Indirection so ensureWorker (declared before beginCapture) can re-arm
  // the loop without a declaration-order cycle.
  const beginCaptureRef = useRef<() => Promise<void>>(async () => {});

  const haltContinuous = useCallback(() => {
    continuousRef.current = false;
    setContinuous(false);
  }, []);

  /** True while a capture window is actually open (guards double-arming). */
  const capturing = useCallback(
    () => recorderRef.current !== null && recorderRef.current.state !== "inactive",
    [],
  );

  // Worker lifecycle: created on first arm, terminated on unmount.
  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    try {
      const worker = new Worker(new URL("./stt-worker.ts", import.meta.url));
      worker.onmessage = (e: MessageEvent<WorkerStatus>) => {
        const msg = e.data;
        if (msg.type === "status") {
          if (msg.stage === "loading") setStatus("loading-model");
          else if (msg.stage === "ready") setStatus("idle");
          else if (msg.stage === "transcribing") setStatus("transcribing");
          else if (msg.stage === "error") {
            setStatus("error");
            setError(msg.message ?? "Speech recognition failed");
            haltContinuous();
          }
        } else if (msg.type === "result") {
          setStatus("idle");
          if (cancelledRef.current) return;
          if (msg.text) onResultRef.current(msg.text);
          else {
            // Noise-only clip: nothing to send. The always-on loop re-arms
            // (no reply will be spoken); push-to-talk just goes idle.
            onMissRef.current?.();
            if (continuousRef.current && !capturing()) void beginCaptureRef.current();
          }
        }
      };
      worker.onerror = () => {
        setStatus("error");
        setError("Could not start speech recognition in this browser");
        haltContinuous();
      };
      workerRef.current = worker;
      return worker;
    } catch {
      setStatus("error");
      setError("Could not start speech recognition in this browser");
      return null;
    }
  }, [capturing, haltContinuous]);

  // Release the mic analysis tap (interval + AudioContext). Safe to call
  // repeatedly; the stream's own tracks are stopped in recorder.onstop.
  const stopVad = useCallback(() => {
    vadCleanupRef.current?.();
    vadCleanupRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopVad();
      // Leave nothing capturing after unmount (reader navigated away).
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
        recorder.stream.getTracks().forEach((t) => t.stop());
      }
      recorderRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [stopVad]);

  // Shared capture start for push-to-talk and the always-on loop.
  const beginCapture = useCallback(async () => {
    if (capturing()) return; // a window is already open — never double-arm
    setError(null);
    cancelledRef.current = false;
    const worker = ensureWorker();
    if (!worker) return;
    worker.postMessage({ type: "load" }); // arms the pipeline if not yet loaded
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      // Always-on: silence detection taps the same stream. The analyser is
      // not connected to a destination, so this adds no audio path.
      if (continuousRef.current) {
        try {
          const ctx = new AudioContext();
          if (ctx.state === "suspended") void ctx.resume(); // autoplay policy
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          const buf = new Float32Array(analyser.fftSize);
          const seg = new TurnSegmenter();
          const sample = () => {
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
            if (seg.push(Math.sqrt(sum / buf.length)) === "turn-ended") {
              stopVad();
              const r = recorderRef.current;
              if (r && r.state !== "inactive") r.stop(); // → transcribe
            }
          };
          const timer = setInterval(sample, VAD_DEFAULTS.frameMs);
          vadCleanupRef.current = () => {
            clearInterval(timer);
            source.disconnect();
            void ctx.close().catch(() => undefined);
          };
        } catch {
          // Analysis unavailable (old browser) — the loop degrades to
          // push-to-talk semantics rather than failing outright.
          haltContinuous();
        }
      }

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        recorderRef.current = null; // a finished recorder must not block re-arming
        stream.getTracks().forEach((t) => t.stop()); // release the mic
        stopVad();
        void transcribe(worker);
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus("listening");
    } catch {
      setStatus("error");
      setError("Microphone access was denied — you can still type");
      haltContinuous();
    }
  }, [capturing, ensureWorker, haltContinuous, stopVad]);

  beginCaptureRef.current = beginCapture;

  /** Push-to-talk arm (Standard mode). */
  const arm = useCallback(async () => {
    haltContinuous(); // push-to-talk and the loop are mutually exclusive
    await beginCapture();
  }, [beginCapture, haltContinuous]);

  /** Always-on mode: open the mic and keep it open across turns. If a
   *  push-to-talk window is already open, the loop simply adopts it — the
   *  next turn continues in continuous mode. */
  const startContinuous = useCallback(async () => {
    continuousRef.current = true;
    setContinuous(true);
    if (capturing()) return;
    await beginCapture();
  }, [beginCapture, capturing]);

  /** Leave always-on mode (setting flipped off / panel gone). An in-flight
   *  transcription still delivers its result. */
  const stopContinuous = useCallback(() => {
    haltContinuous();
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
  }, [haltContinuous]);

  /** Re-arm after a turn — called by the panel when the spoken reply ends.
   *  No-op unless the loop is still wanted, so a mode flip mid-reply can't
   *  resurrect the mic. */
  const resume = useCallback(async () => {
    if (!continuousRef.current || capturing()) return;
    await beginCapture();
  }, [beginCapture, capturing]);

  /** Push-to-talk stop: ends the capture window, transcription begins. */
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
  }, []);

  /** Decode the captured clip to 16 kHz mono PCM and hand it to the worker. */
  const transcribe = async (worker: Worker) => {
    try {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
      if (blob.size === 0) {
        setStatus("idle");
        return;
      }
      setStatus("transcribing");
      const arrayBuffer = await blob.arrayBuffer();
      const decodeCtx = new AudioContext();
      const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
      await decodeCtx.close();

      // Downmix to mono + resample to 16 kHz in one offline pass.
      const targetRate = 16000;
      const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offline = new OfflineAudioContext(1, length, targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const pcm = rendered.getChannelData(0);
      // Float32Array over the SharedArrayBuffer-backed render buffer must be
      // copied to post it across the worker boundary.
      worker.postMessage({ type: "transcribe", audio: new Float32Array(pcm) });
    } catch {
      setStatus("error");
      setError("Could not process that recording — try again");
      haltContinuous();
    }
  };

  return { status, continuous, error, arm, stop, startContinuous, stopContinuous, resume };
}
