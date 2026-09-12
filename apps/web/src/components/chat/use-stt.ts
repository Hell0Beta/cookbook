"use client";

// Push-to-talk STT hook — development.md §14.1 / design.md §3.3.4. Tap to arm,
// tap to stop; the clip is transcribed locally by the whisper worker and the
// text lands in the caller's onResult (which routes it through the same
// editable-input path as typing, so a mis-transcription can be corrected
// before sending — design.md §3.3.4 "editing affordance").
//
// Capture: MediaRecorder → Blob → decodeAudioData → OfflineAudioContext
// downmix/resample to 16 kHz mono Float32 (what whisper expects). Every
// browser-API branch is try/catch — unsupported browsers degrade to typing.
import { useCallback, useEffect, useRef, useState } from "react";

export type SttStatus = "idle" | "loading-model" | "listening" | "transcribing" | "error";

interface WorkerStatus {
  type: "status" | "result";
  stage?: "loading" | "ready" | "transcribing" | "error";
  message?: string;
  text?: string;
}

export function useStt(onResult: (text: string) => void) {
  const [status, setStatus] = useState<SttStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

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
          }
        } else if (msg.type === "result") {
          setStatus("idle");
          if (!cancelledRef.current && msg.text) onResultRef.current(msg.text);
        }
      };
      worker.onerror = () => {
        setStatus("error");
        setError("Could not start speech recognition in this browser");
      };
      workerRef.current = worker;
      return worker;
    } catch {
      setStatus("error");
      setError("Could not start speech recognition in this browser");
      return null;
    }
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const arm = useCallback(async () => {
    setError(null);
    cancelledRef.current = false;
    const worker = ensureWorker();
    if (!worker) return;
    worker.postMessage({ type: "load" }); // arms the pipeline if not yet loaded
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); // release the mic
        void transcribe(worker);
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus("listening");
    } catch {
      setStatus("error");
      setError("Microphone access was denied — you can still type");
    }
  }, [ensureWorker]);

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
    }
  };

  return { status, error, arm, stop };
}
