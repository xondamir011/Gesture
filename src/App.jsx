import { useEffect, useRef, useState } from "react";
import { Camera, VideoOff, Mic, MicOff } from "lucide-react";
import {
  FilesetResolver,
  GestureRecognizer,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const COLORS = [
  { id: "c-cyan", color: "#22d3ee" },
  { id: "c-purple", color: "#a855f7" },
  { id: "c-green", color: "#84cc16" },
  { id: "c-orange", color: "#fb923c" },
];

const OPS = ["+", "-", "x", "/"];
const DWELL = 900; 
const HOLD = 1200; 

const STATUS_LABEL = {
  idle: "CHIZISH",
  draw: "CHIZISH",
  erase: "O‘CHIRISH",
  select: "TANLASH",
  math: "MATEMATIKA",
};

const LANGS = [
  { code: "uz-UZ", label: "UZ" },
  { code: "ru-RU", label: "RU" },
  { code: "en-US", label: "EN" },
];

const NUMBER_WORDS = {
  nol: 0, zero: 0, ноль: 0,
  bir: 1, one: 1, один: 1,
  ikki: 2, two: 2, два: 2,
  uch: 3, three: 3, три: 3,
  tort: 4, four: 4, четыре: 4,
  besh: 5, five: 5, пять: 5,
  olti: 6, six: 6, шесть: 6,
  yetti: 7, seven: 7, семь: 7,
  sakkiz: 8, eight: 8, восемь: 8,
  toqqiz: 9, nine: 9, девять: 9,
  on: 10, ten: 10, десять: 10,
};

const VOICE_COMMANDS = [
  [/^(chiz|draw|рисов|рисуй)/, "draw"],
  [/^(math|mat|hisob|математ|счет|счёт)/, "math"],
  [/^(tozala|ochir|clear|очист|сотри|стере|удали)/, "clear"],
  [/^(saqla|save|сохран)/, "save"],
  [/^(kok|havorang|cyan|голуб|син)/, "c-cyan"],
  [/^(binafsha|purple|фиолет)/, "c-purple"],
  [/^(yashil|green|зелен|зелён)/, "c-green"],
  [/^(sariq|orange|apelsin|оранж|желт|жёлт)/, "c-orange"],
  [/^(qalin|yogon|thick|толст)/, "size-up"],
  [/^(ingichka|yupqa|thin|тонк)/, "size-down"],
  [/^(plyus|plus|qosh|плюс|сложи)/, "op-+"],
  [/^(minus|ayir|минус|вычти)/, "op--"],
  [/^(kopay|marta|multiply|times|умнож)/, "op-x"],
  [/^(bol|divide|делит|раздел)/, "op-/"],
];

const emptyMath = { stage: "a", a: null, op: null, b: null, result: null };

function Toolbar({ buttons, hover, onPress }) {
  return (
    <div className="absolute left-0 right-0 top-0 z-30 flex select-none flex-wrap gap-1.5 bg-black/70 p-1.5 backdrop-blur sm:flex-nowrap sm:gap-2 sm:overflow-x-auto sm:p-2">
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          data-btn={b.id}
          onClick={() => onPress(b.id)}
          className={`relative h-10 grow basis-[calc(20%-6px)] border-2 px-1 text-[11px] font-black text-white/90 transition sm:h-14 sm:min-w-[64px] sm:shrink-0 sm:grow-0 sm:basis-auto sm:px-4 sm:text-xs ${
            b.active ? "border-white" : "border-transparent"
          }`}
          style={{ background: b.bg }}
        >
          {b.label}
          {hover?.id === b.id && (
            <span
              className="absolute bottom-0 left-0 h-1.5 bg-white"
              style={{ width: `${Math.round(hover.pct * 100)}%` }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const boxRef = useRef(null);
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const drawRef = useRef(null);
  const cursorRef = useRef(null);
  const streamRef = useRef(null);
  const recognizerRef = useRef(null);
  const frameRef = useRef(null);
  const runningRef = useRef(false);
  const lastVideoTime = useRef(-1);

  const modeRef = useRef("draw");
  const colorRef = useRef(COLORS[0].color);
  const sizeRef = useRef(8);
  const mathRef = useRef({ ...emptyMath });
  const holdRef = useRef({ value: -1, since: 0 });
  const hoverRef = useRef({ id: null, since: 0, fired: false });
  const smoothRef = useRef(null);
  const lastPointRef = useRef(null);
  const actionRef = useRef("idle");
  const liveRef = useRef({ n: 0, pct: 0 });
  const fpsRef = useRef({ frames: 0, last: 0 });
  const pressRef = useRef(() => {});

  const speechRef = useRef(null);
  const micOnRef = useRef(false);
  const langRef = useRef(0);
  const voiceRef = useRef(() => {});

  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [langIndex, setLangIndex] = useState(0);
  const [heard, setHeard] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("draw");
  const [color, setColor] = useState(COLORS[0].color);
  const [action, setAction] = useState("idle");
  const [fps, setFps] = useState(0);
  const [hover, setHover] = useState(null);
  const [math, setMath] = useState({ ...emptyMath });
  const [live, setLive] = useState({ n: 0, pct: 0 });
  const [toast, setToast] = useState("");

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognizerRef.current?.close();
      micOnRef.current = false;
      const r = speechRef.current;
      if (r) {
        r.onend = null;
        try { r.stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  function flash(text) {
    setToast(text);
    setTimeout(() => setToast(""), 1500);
  }

  function updateMath(next) {
    mathRef.current = next;
    setMath({ ...next });
  }

  function compute(a, op, b) {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "x") return a * b;
    if (b === 0) return "∞";
    return Number((a / b).toFixed(2));
  }

  function clearDrawing() {
    const c = drawRef.current;
    if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height);
    lastPointRef.current = null;
  }

  function saveImage() {
    const v = videoRef.current;
    const d = drawRef.current;
    if (!v || !d || !v.videoWidth) {
      flash("Avval kamerani yoqing");
      return;
    }
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const x = c.getContext("2d");
    x.translate(c.width, 0);
    x.scale(-1, 1);
    x.drawImage(v, 0, 0);
    x.drawImage(d, 0, 0);
    const a = document.createElement("a");
    a.download = `gesture-${Date.now()}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
    flash("Saqlandi");
  }

  function pressButton(id) {
    if (id === "draw") {
      modeRef.current = "draw";
      setMode("draw");
      return;
    }

    if (id === "math") {
      modeRef.current = "math";
      setMode("math");
      holdRef.current = { value: -1, since: 0 };
      updateMath({ ...emptyMath });
      return;
    }

    const col = COLORS.find((c) => c.id === id);
    if (col) {
      colorRef.current = col.color;
      setColor(col.color);
      return;
    }

    if (id === "size-down") {
      sizeRef.current = Math.max(2, sizeRef.current - 2);
      flash(`Qalinlik: ${sizeRef.current}`);
      return;
    }

    if (id === "size-up") {
      sizeRef.current = Math.min(40, sizeRef.current + 2);
      flash(`Qalinlik: ${sizeRef.current}`);
      return;
    }

    if (id.startsWith("op-")) {
      const op = id.slice(3);
      const m = mathRef.current;
      if (m.a !== null && (m.stage === "op" || m.stage === "b")) {
        holdRef.current = { value: -1, since: 0 };
        updateMath({ ...m, op, stage: "b" });
      }
      return;
    }

    if (id === "clear") {
      clearDrawing();
      if (modeRef.current === "math") updateMath({ ...emptyMath });
      return;
    }

    if (id === "save") saveImage();
  }

  pressRef.current = pressButton;

  // ---------- OVOZLI BOSHQARUV ----------

  function voiceNumber(n) {
    if (modeRef.current !== "math") return;
    const m = mathRef.current;
    holdRef.current = { value: -1, since: 0 };

    if (m.stage === "a") {
      updateMath({ ...m, a: n, stage: "op" });
    } else if (m.stage === "b") {
      updateMath({ ...m, b: n, stage: "done", result: compute(m.a, m.op, n) });
    }
  }

  function handleVoice(text) {
    const words = text
      .toLowerCase()
      .replace(/[’‘'ʻʼ`´]/g, "")
      .split(/[\s,.!?]+/)
      .filter(Boolean);

    for (const w of words) {
      if (/^\d+$/.test(w)) {
        voiceNumber(Number(w));
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, w)) {
        voiceNumber(NUMBER_WORDS[w]);
        continue;
      }

      const cmd = VOICE_COMMANDS.find(([re]) => re.test(w));
      if (cmd) pressRef.current(cmd[1]);
    }
  }

  voiceRef.current = handleVoice;

  async function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SR) {
      setError("Bu brauzer ovozli buyruqni qo‘llamaydi. Chrome yoki Edge ishlating.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Mikrofon uchun localhost yoki HTTPS manzilidan foydalaning.");
      return;
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      setError(
        e.name === "NotAllowedError"
          ? "Mikrofon ruxsati berilmadi. Brauzer sozlamalaridan ruxsat bering."
          : e.name === "NotFoundError"
          ? "Mikrofon topilmadi. Qurilmaga mikrofon ulang."
          : "Mikrofonni ochib bo‘lmadi."
      );
      return;
    }

    const rec = new SR();
    rec.lang = LANGS[langRef.current].code;
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const text = e.results[i][0].transcript.trim();
          setHeard(text);
          voiceRef.current(text);
        }
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        micOnRef.current = false;
        setMicOn(false);
        setError("Mikrofon ruxsati berilmadi.");
      } else if (e.error === "network") {
        setError("Ovozni aniqlash uchun internet kerak.");
      }
    };

    rec.onend = () => {
      if (micOnRef.current) {
        try { rec.start(); } catch { /* ignore */ }
      }
    };

    speechRef.current = rec;
    micOnRef.current = true;
    setMicOn(true);
    setError("");

    try {
      rec.start();
    } catch { /* ignore */ }
  }

  function stopVoice() {
    micOnRef.current = false;
    setMicOn(false);
    const r = speechRef.current;
    speechRef.current = null;
    if (r) {
      r.onend = null;
      try { r.stop(); } catch { /* ignore */ }
    }
  }

  function toggleMic() {
    if (micOnRef.current) stopVoice();
    else startVoice();
  }

  async function changeLang() {
    const next = (langRef.current + 1) % LANGS.length;
    langRef.current = next;
    setLangIndex(next);

    if (micOnRef.current) {
      stopVoice();
      await startVoice();
    }
  }

  // ---------- KAMERA ----------

  async function startCamera() {
    setError("");
    setLoading(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Kamera uchun localhost yoki HTTPS manzilidan foydalaning.");
      }

      // Telefonlarda ortiqcha zoom bo'lmasligi uchun yumshoq resolution
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;

      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        throw new Error("Kamera oynasi topilmadi. Sahifani yangilang.");
      }

      video.srcObject = stream;
      await video.play();

      setCameraOn(true);
      await startTracking();
    } catch (e) {
      setError(
        e.name === "NotAllowedError"
          ? "Kamera ruxsati berilmadi. Brauzer sozlamalaridan ruxsat bering."
          : e.name === "NotFoundError"
          ? "Kamera topilmadi."
          : e.message || "Kamerani ochib bo‘lmadi."
      );
    } finally {
      setLoading(false);
    }
  }

  function stopCamera() {
    runningRef.current = false;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    const o = overlayRef.current;
    if (o) o.getContext("2d").clearRect(0, 0, o.width, o.height);
    if (cursorRef.current) cursorRef.current.style.display = "none";

    setCameraOn(false);
    setAction("idle");
    setHover(null);
  }

  async function startTracking() {
    if (runningRef.current) return;

    if (!recognizerRef.current) {
      const vision = await FilesetResolver.forVisionTasks(WASM);
      const make = (delegate) =>
        GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: "VIDEO",
          numHands: 2,
        });

      try {
        recognizerRef.current = await make("GPU");
      } catch {
        recognizerRef.current = await make("CPU");
      }
    }

    if (!streamRef.current) throw new Error("Kamera oqimi uzildi. Kamerani qayta yoqing.");

    runningRef.current = true;
    lastVideoTime.current = -1;
    frameRef.current = requestAnimationFrame(detect);
  }

  function dist(a, b, vw, vh) {
    return Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
  }

  function countFingers(l, vw, vh) {
    const d = (a, b) => dist(l[a], l[b], vw, vh);
    let n = 0;
    [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([tip, pip]) => {
      if (d(tip, 0) > d(pip, 0) * 1.1) n++;
      });
    if (d(4, 17) > d(2, 17) * 1.1) n++;
    return n;
  }

  function detect() {
    if (!runningRef.current) return;

    const video = videoRef.current;
    const overlay = overlayRef.current;
    const draw = drawRef.current;
    const box = boxRef.current;
    const rec = recognizerRef.current;

    if (
      video && overlay && draw && box && rec &&
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.currentTime !== lastVideoTime.current
    ) {
      lastVideoTime.current = video.currentTime;

      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (overlay.width !== vw || overlay.height !== vh) {
        overlay.width = vw;
        overlay.height = vh;
      }
      if (draw.width !== vw || draw.height !== vh) {
        draw.width = vw;
        draw.height = vh;
      }

      const now = performance.now();
      const octx = overlay.getContext("2d");
      octx.clearRect(0, 0, vw, vh);

      const result = rec.recognizeForVideo(video, now);
      const hands = result.landmarks || [];

      const utils = new DrawingUtils(octx);
      hands.forEach((l) => {
        utils.drawConnectors(l, GestureRecognizer.HAND_CONNECTIONS, {
          color: "#6366f1",
          lineWidth: Math.max(2, vw / 400),
        });
        utils.drawLandmarks(l, {
          color: "#facc15",
          lineWidth: 1,
          radius: Math.max(2, vw / 250),
        });
      });

      const lm = hands[0];
      const name = result.gestures?.[0]?.[0]?.categoryName;
      const mode = modeRef.current;
      const cursor = cursorRef.current;

      // ---- Harakat turini aniqlash ----
      let act = "idle";
      let target = null;

      if (lm) {
        const palm = dist(lm[0], lm[9], vw, vh);
        const pinch = dist(lm[4], lm[8], vw, vh) < palm * 0.4;

        if (pinch) {
          act = "draw";
          target = { x: ((lm[4].x + lm[8].x) / 2) * vw, y: ((lm[4].y + lm[8].y) / 2) * vh };
        } else if (name === "Victory") {
          act = "select";
          target = { x: lm[8].x * vw, y: lm[8].y * vh };
        } else if (name === "Open_Palm") {
          act = "erase";
          target = { x: lm[9].x * vw, y: lm[9].y * vh };
        } else {
          target = { x: lm[8].x * vw, y: lm[8].y * vh };
        }
      }

      // ---- Silliqlash ----
      let p = null;
      if (target) {
        const s = smoothRef.current;
        p = s
          ? { x: s.x + (target.x - s.x) * 0.5, y: s.y + (target.y - s.y) * 0.5 }
          : target;
        smoothRef.current = p;
      } else {
        smoothRef.current = null;
        lastPointRef.current = null;
      }

      // ---- Ekran koordinatasi (object-cover + mirror) ----
      const W = box.clientWidth;
      const H = box.clientHeight;
      const scale = Math.max(W / vw, H / vh);
      let sx = 0;
      let sy = 0;
      if (p) {
        sx = W - ((W - vw * scale) / 2 + p.x * scale);
        sy = (H - vh * scale) / 2 + p.y * scale;
      }

      // ---- Kursor ----
      if (cursor) {
        if (p) {
          const isErase = act === "erase" && mode === "draw";
          const ring = isErase
            ? 110 * (vw / 1280) * scale
            : act === "draw"
            ? Math.max(12, sizeRef.current * (vw / 1280) * scale)
            : 22;
          cursor.style.display = "block";
          cursor.style.width = `${ring}px`;
          cursor.style.height = `${ring}px`;
          cursor.style.transform = `translate(${sx - ring / 2}px, ${sy - ring / 2}px)`;
          cursor.style.background =
            act === "draw" && mode === "draw" ? colorRef.current : "transparent";
          cursor.style.borderColor =
            act === "select" ? "#f5b301" : isErase ? "#ef4444" : "#ffffff";
        } else {
          cursor.style.display = "none";
        }
      }

      // ---- Chizish / o'chirish ----
      if (mode === "draw" && p) {
        const dctx = draw.getContext("2d");

        if (act === "draw") {
          dctx.globalCompositeOperation = "source-over";
          dctx.strokeStyle = colorRef.current;
          dctx.lineWidth = sizeRef.current * (vw / 1280);
          dctx.lineCap = "round";
          dctx.lineJoin = "round";
          dctx.beginPath();
          const last = lastPointRef.current;
          dctx.moveTo(last ? last.x : p.x, last ? last.y : p.y);
          dctx.lineTo(p.x, p.y);
          dctx.stroke();
          lastPointRef.current = { x: p.x, y: p.y };
        } else if (act === "erase") {
          dctx.globalCompositeOperation = "destination-out";
          dctx.beginPath();
          dctx.arc(p.x, p.y, 55 * (vw / 1280), 0, Math.PI * 2);
          dctx.fill();
          dctx.globalCompositeOperation = "source-over";
          lastPointRef.current = null;
        } else {
          lastPointRef.current = null;
        }
      }

      // ---- Tugmalarni tanlash (V belgisi + ushlab turish) ----
      if (act === "select" && p) {
        const rect = box.getBoundingClientRect();
        const el = document
          .elementFromPoint(rect.left + sx, rect.top + sy)
          ?.closest("[data-btn]");
        const id = el?.getAttribute("data-btn") || null;
        const h = hoverRef.current;

        if (id !== h.id) {
          hoverRef.current = { id, since: now, fired: false };
          setHover(id ? { id, pct: 0 } : null);
        } else if (id && !h.fired) {
          const pct = Math.min(1, (now - h.since) / DWELL);
          setHover({ id, pct });
          if (pct >= 1) {
            h.fired = true;
            pressRef.current(id);
          }
        }
      } else if (hoverRef.current.id) {
        hoverRef.current = { id: null, since: 0, fired: false };
        setHover(null);
      }

      // ---- Matematika: barmoq sanash ----
      if (mode === "math") {
        const m = mathRef.current;
        let total = 0;
        hands.forEach((l) => (total += countFingers(l, vw, vh)));

        if (m.stage === "a" || m.stage === "b") {
          const hold = holdRef.current;
          if (hands.length && total > 0 && total === hold.value) {
            const pct = Math.min(1, (now - hold.since) / HOLD);
            if (liveRef.current.n !== total || Math.abs(liveRef.current.pct - pct) > 0.04) {
              liveRef.current = { n: total, pct };
              setLive({ n: total, pct });
            }
            if (pct >= 1) {
              holdRef.current = { value: -1, since: 0 };
              if (m.stage === "a") {
                updateMath({ ...m, a: total, stage: "op" });
              } else {
                updateMath({
                  ...m,
                  b: total,
                  stage: "done",
                  result: compute(m.a, m.op, total),
                });
              }
              liveRef.current = { n: 0, pct: 0 };
              setLive({ n: 0, pct: 0 });
            }
          } else {
            holdRef.current = { value: hands.length ? total : -1, since: now };
            const n = hands.length ? total : 0;
            if (liveRef.current.n !== n || liveRef.current.pct !== 0) {
              liveRef.current = { n, pct: 0 };
              setLive({ n, pct: 0 });
            }
          }
        }
      }

      // ---- Holat paneli ----
      const shownAction = mode === "math" ? (act === "select" ? "select" : "math") : act;
      if (actionRef.current !== shownAction) {
        actionRef.current = shownAction;
        setAction(shownAction);
      }

      // ---- FPS ----
      const f = fpsRef.current;
      f.frames++;
      if (now - f.last >= 1000) {
        setFps(Math.round((f.frames * 1000) / (now - f.last)));
        f.frames = 0;
        f.last = now;
      }
    }

    if (runningRef.current) frameRef.current = requestAnimationFrame(detect);
  }

  // ---- Tugmalar ro'yxati ----
  const buttons = [
    { id: "draw", label: "CHIZISH", bg: "#f5b301", active: mode === "draw" },
    { id: "math", label: "MATH", bg: "#e63ca8", active: mode === "math" },
    ...(mode === "draw"
      ? [
          ...COLORS.map((c) => ({
            id: c.id,
            label: "",
            bg: c.color,
            active: color === c.color,
          })),
          { id: "size-down", label: "-", bg: "#6b7280" },
          { id: "size-up", label: "+", bg: "#6b7280" },
        ]
      : OPS.map((o) => ({
          id: `op-${o}`,
          label: o,
          bg: "#84cc16",
          active: math.op === o,
        }))),
    { id: "clear", label: "CLEAR", bg: "#ef4444" },
    { id: "save", label: "SAVE", bg: "#84cc16" },
  ];

  // ---- Matematika paneli matnlari ----
  const numA = math.a ?? (math.stage === "a" ? live.n || "?" : "?");
  const numB = math.b ?? (math.stage === "b" ? live.n || "?" : "?");
  const opText = math.op ? (math.op === "x" ? "×" : math.op) : "?";
  const resText = math.result ?? "?";

  const mathHint =
    math.stage === "a"
      ? "Birinchi sonni barmoq yoki ovoz bilan ayting"
      : math.stage === "op"
      ? "Amalni tanlang:  +  -  ×  /"
      : math.stage === "b"
      ? "Ikkinchi sonni barmoq yoki ovoz bilan ayting"
      : "Qayta boshlash uchun MATH tugmasini tanlang";

  const hint =
    mode === "math"
      ? "Barmoq soni: son tanlash | V belgisi: amal tanlash"
      : "Pinch: chizish | Ochiq kaft: o‘chirish | V belgisi: tugma tanlash";

  const voiceHint =
    mode === "math"
      ? "Ovoz: “to‘rt plyus to‘rt”, minus, ko‘paytir, bo‘l"
      : "Ovoz: chizish, math, tozala, saqla, ko‘k, binafsha, yashil, sariq, qalin, ingichka";

  return (
    <div className="fixed inset-0 select-none bg-black text-white">
      <div ref={boxRef} className="absolute inset-0 overflow-hidden bg-[#05070b]">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`absolute inset-0 h-full w-full -scale-x-100 object-cover ${cameraOn ? "" : "hidden"}`}
        />

        <canvas
          ref={drawRef}
          className={`pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-cover ${cameraOn ? "" : "hidden"}`}
        />

        <canvas
          ref={overlayRef}
          className={`pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-cover ${cameraOn ? "" : "hidden"}`}
        />

        <div
          ref={cursorRef}
          className="pointer-events-none absolute left-0 top-0 z-20 hidden rounded-full border-2"
        />

        <Toolbar buttons={buttons} hover={hover} onPress={pressButton} />

        {!cameraOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
            <VideoOff size={44} className="mb-4 text-slate-500" />
            <h1 className="text-2xl font-black">Havoda chizish</h1>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
              Kamerani yoqing va brauzer so‘raganda ruxsat bering. Ovoz uchun keyin
              mikrofon tugmasini bosing.
            </p>
            <button
              type="button"
              onClick={startCamera}
              disabled={loading}
              className="mt-5 flex items-center cursor-pointer gap-2 bg-[#84cc16] px-6 py-3 font-black text-black transition hover:brightness-110 disabled:opacity-50"
            >
              <Camera size={18} />
              {loading ? "Yuklanmoqda..." : "Kamerani yoqish"}
            </button>
          </div>
        )}

        {cameraOn && loading && (
          <div className="absolute left-1/2 top-24 z-20 -translate-x-1/2 bg-black/80 px-4 py-2 text-xs font-bold sm:top-28">
            Gesture modeli yuklanmoqda...
          </div>
        )}

        {cameraOn && mode === "math" && (
          <div className="absolute left-1/2 top-[55%] z-10 w-[min(92%,640px)] -translate-x-1/2 -translate-y-1/2 bg-[#2a0a14]/90 px-3 py-6 text-center backdrop-blur sm:top-1/2 sm:px-6 sm:py-10">
            <p className="text-3xl font-black tracking-wide text-[#c8f01a] sm:text-6xl">
              {numA} {opText} {numB} = {resText}
            </p>
            <p className="mt-4 text-xs font-semibold text-white/80 sm:mt-6 sm:text-sm">
              {mathHint}
            </p>
            {(math.stage === "a" || math.stage === "b") && (
              <div className="mx-auto mt-4 h-1.5 w-40 bg-white/15 sm:w-48">
                <div
                  className="h-full bg-[#c8f01a] transition-[width]"
                  style={{ width: `${Math.round(live.pct * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {toast && (
          <div className="absolute left-1/2 top-28 z-30 -translate-x-1/2 bg-black/80 px-4 py-2 text-xs font-bold sm:top-24">
            {toast}
          </div>
        )}

        {error && (
          <div className="absolute bottom-28 left-3 right-3 z-30 border border-red-400/30 bg-red-950/90 p-3 text-sm text-red-200 sm:bottom-24">
            {error}
          </div>
        )}

        {cameraOn && micOn && (
          <div className="absolute bottom-24 left-3 right-3 z-20 flex items-center gap-2 text-xs sm:bottom-24 sm:left-4 sm:right-auto sm:max-w-md">
            <span className="flex min-w-0 items-center gap-2 bg-black/70 px-3 py-1.5 text-[#c8f01a]">
              <Mic size={14} className="shrink-0" />
              <span className="truncate">{heard || "Eshitilmoqda..."}</span>
            </span>
          </div>
        )}

        {cameraOn && (
          <div
            className="absolute bottom-0 left-0 right-0 z-20 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pt-8 sm:gap-3 sm:px-4"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="min-w-0">
              <p className="text-sm font-black tracking-wide text-[#c8f01a]">
                {STATUS_LABEL[action] || "CHIZISH"} | FPS {fps}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-white/70 sm:text-[11px]">
                {hint}
              </p>
              {micOn && (
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-white/50 sm:text-[11px]">
                  {voiceHint}
                </p>
              )}
            </div>

            <div className="flex shrink-0 gap-1.5 sm:gap-2">
              {micOn && (
                <button
                  type="button"
                  onClick={changeLang}
                  title="Ovoz tili"
                  className="flex h-10 items-center justify-center border border-white/20 px-2 text-xs font-black text-white/80"
                >
                  {LANGS[langIndex].label}
                </button>
              )}
              <button
                type="button"
                onClick={toggleMic}
                title="Ovozli boshqaruv"
                className={`flex h-10 w-10 items-center cursor-pointer justify-center border ${
                  micOn ? "border-[#84cc16] text-[#84cc16]" : "border-white/20 text-white/60"
                }`}
              >
                {micOn ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
              <button
                type="button"
                onClick={stopCamera}
                title="Kamerani o‘chirish"
                className="flex h-10 w-10 items-center justify-center cursor-pointer border border-red-400/40 text-red-300"
              >
                <VideoOff size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}