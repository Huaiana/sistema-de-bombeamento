import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  parseLinha,
  nivelPercent,
  volumeMl,
  CAPACIDADE_ML,
  type Controle,
  type Leitura,
} from "@/lib/arduino-parser";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Monitor Água da Chuva — Arduino via USB" },
      {
        name: "description",
        content:
          "Acompanhe em tempo real os reservatórios e a bomba do Arduino Uno pelo navegador (Web Serial).",
      },
      { property: "og:title", content: "Monitor Água da Chuva — Arduino via USB" },
      {
        property: "og:description",
        content: "Leituras ao vivo dos sensores HC-SR04 e da bomba pelo cabo USB.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

// Limites do código Arduino (cm)
const T1L = { ligar: 8, desligar: 15 };
const T2L = { cheio: 5, libera: 8 };
type Calib = { t1Cheio: number; t1Vazio: number; t2Cheio: number; t2Vazio: number };
const CALIB_PADRAO: Calib = { t1Cheio: 8, t1Vazio: 15, t2Cheio: 5, t2Vazio: 8 };
const CALIB_KEY = "calibracao-tanques";

type SerialPortLike = {
  open: (o: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

function Index() {
  const [suportado, setSuportado] = useState(true);
  const [conectado, setConectado] = useState(false);
  const [atual, setAtual] = useState<Leitura | null>(null);
  const [hist, setHist] = useState<Leitura[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [ciclos, setCiclos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const [protocolo, setProtocolo] = useState(false);
  const [controle, setControle] = useState<Controle | null>(null);
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const ultimoProtocoloRef = useRef(0);
  const ultimaLeituraRef = useRef(0);
  const encerrandoRef = useRef(false);

  const [calib, setCalib] = useState<Calib>(CALIB_PADRAO);
  useEffect(() => {
    setSuportado("serial" in navigator);
    try {
      const c = localStorage.getItem(CALIB_KEY);
      if (c) setCalib({ ...CALIB_PADRAO, ...JSON.parse(c) });
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(
    () => () => {
      encerrandoRef.current = true;
      readerRef.current?.cancel().catch((e) => console.error("Erro ao liberar a porta USB:", e));
    },
    [],
  );
  const salvarCalib = (c: Calib) => {
    setCalib(c);
    localStorage.setItem(CALIB_KEY, JSON.stringify(c));
  };
  const T1 = { cheio: calib.t1Cheio, vazio: calib.t1Vazio };
  const T2 = { cheio: calib.t2Cheio, vazio: calib.t2Vazio };

  const addLog = (s: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${s}`, ...l].slice(0, 200));

  async function enviar(comando: string) {
    const writer = writerRef.current;
    if (!writer) throw new Error("Porta serial não está disponível para escrita.");
    await writer.write(new TextEncoder().encode(`${comando}\n`));
  }

  async function enviarComando(comando: string) {
    try {
      await enviar(comando);
      addLog(`Comando enviado: ${comando} (aguardando resposta do Arduino)`);
    } catch (e) {
      setErro(`Falha ao enviar comando: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function conectar() {
    if (conectando || portRef.current) return;
    setConectando(true);
    setErro(null);
    setAtual(null);
    setControle(null);
    setProtocolo(false);
    ultimoProtocoloRef.current = 0;
    ultimaLeituraRef.current = 0;
    encerrandoRef.current = false;
    let port: SerialPortLike | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      port = await (navigator as any).serial.requestPort();
      if (!port) throw new Error("Nenhuma porta serial selecionada.");
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      if (!port.readable || !port.writable) throw new Error("Porta serial sem leitura ou escrita.");
      reader = port.readable.getReader();
      writer = port.writable.getWriter();
      readerRef.current = reader;
      writerRef.current = writer;
      setConectado(true);
      setConectando(false);
      addLog("Conectado (9600 baud)");
      const inicio = Date.now();
      const ping = async () => {
        if (encerrandoRef.current) return;
        if (Date.now() - (ultimoProtocoloRef.current || inicio) > 10000) {
          setProtocolo(false);
          setControle(null);
        }
        if (Date.now() - (ultimaLeituraRef.current || inicio) > 6000) setAtual(null);
        try {
          await enviar("PING");
        } catch (e) {
          setErro(`Falha na comunicação USB: ${e instanceof Error ? e.message : String(e)}`);
          try {
            await readerRef.current?.cancel();
          } catch (cancelError) {
            console.error("Erro ao interromper leitura USB:", cancelError);
          }
        }
      };
      heartbeat = setInterval(() => void ping(), 2000);
      void ping();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          if (!encerrandoRef.current) setErro("A leitura da porta USB foi encerrada.");
          break;
        }
        buf += decoder.decode(value, { stream: true });
        const linhas = buf.split(/\r?\n/);
        buf = linhas.pop() ?? "";
        for (const linha of linhas) {
          if (!linha.trim()) continue;
          const ev = parseLinha(linha);
          if (ev.tipo === "leitura") {
            ultimaLeituraRef.current = Date.now();
            setAtual(ev.leitura);
            setHist((h) => [...h, ev.leitura].slice(-120));
          } else if (ev.tipo === "protocolo") {
            ultimoProtocoloRef.current = Date.now();
            setProtocolo(true);
          } else if (ev.tipo === "controle") {
            setControle(ev.controle);
          } else if (ev.tipo === "ligou") {
            setCiclos((c) => c + 1);
            addLog("💧 Bomba LIGADA");
          } else if (ev.tipo === "desligou") {
            addLog(`⏹ Bomba DESLIGADA — ${ev.motivo}`);
          } else addLog(ev.texto);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!encerrandoRef.current && !/No port selected/i.test(msg)) setErro(msg);
    } finally {
      encerrandoRef.current = true;
      if (heartbeat) clearInterval(heartbeat);
      readerRef.current = null;
      writerRef.current = null;
      reader?.releaseLock();
      writer?.releaseLock();
      if (portRef.current === port) {
        try {
          await port?.close();
        } catch (e) {
          setErro(`Falha ao fechar a porta USB: ${e instanceof Error ? e.message : String(e)}`);
        }
        portRef.current = null;
      }
      setConectado(false);
      setConectando(false);
      setProtocolo(false);
      setControle(null);
      setAtual(null);
      if (port) addLog("Conexão encerrada");
    }
  }

  async function desconectar() {
    encerrandoRef.current = true;
    try {
      await readerRef.current?.cancel();
    } catch (e) {
      setErro(`Falha ao desconectar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const p1 = nivelPercent(atual?.coleta ?? null, T1.cheio, T1.vazio);
  const p2 = nivelPercent(atual?.caixa ?? null, T2.cheio, T2.vazio);
  const bombeando = atual?.estado === "BOMBEANDO";

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* poeira sobre a bancada */}
      <div aria-hidden className="noise pointer-events-none absolute inset-0 opacity-[0.07]" />
      {/* faixa de perigo de chão de oficina */}
      <div aria-hidden className="hazard relative h-2 w-full border-b-2 border-border" />

      <div className="relative mx-auto max-w-6xl px-5 py-8">
        <header className="plate rivets grunge relative rounded-sm border-2 border-border p-5 bezel">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="stencil text-[11px] text-muted-foreground stamp">
                Oficina · Arduino Uno · HC-SR04 ×2 · Relé
              </p>
              <h1 className="stencil mt-1 text-3xl font-bold tracking-tight text-foreground stamp sm:text-4xl">
                Aproveitamento de água da chuva
              </h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                Nº de série OA-150 · reservatórios de {CAPACIDADE_ML} ml
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <span
                className={`flex items-center gap-2 rounded-sm border border-border bg-oil px-3 py-1 font-mono text-xs uppercase tracking-wider text-oil-foreground inset-stamp ${conectado ? "text-primary" : ""}`}
              >
                <span
                  className={`lamp h-2.5 w-2.5 rounded-full ${conectado ? "animate-pulse bg-primary text-primary" : "bg-muted-foreground text-muted-foreground"}`}
                />
                {conectado ? "USB conectado" : "Desconectado"}
              </span>
              {conectado ? (
                <button
                  onClick={() => desconectar()}
                  className="stencil rounded-sm border-2 border-border bg-secondary px-5 py-2.5 text-sm font-bold text-secondary-foreground bezel transition active:translate-y-[3px] active:shadow-none hover:bg-secondary/80"
                >
                  Desconectar
                </button>
              ) : (
                <button
                  onClick={conectar}
                  disabled={!suportado || conectando}
                  className="stencil rounded-sm border-2 border-border bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground bezel transition active:translate-y-[3px] active:shadow-none hover:bg-primary/90 disabled:opacity-40"
                >
                  {conectando ? "Conectando..." : "Conectar Arduino (USB)"}
                </button>
              )}
            </div>
          </div>
        </header>

        {!suportado && (
          <div className="mt-6 rounded-sm border-2 border-destructive bg-hazard/25 p-4 text-sm font-semibold text-foreground">
            Este navegador não suporta Web Serial. Use Google Chrome ou Microsoft Edge no
            computador.
          </div>
        )}
        {erro && (
          <div className="mt-6 rounded-sm border-2 border-destructive bg-destructive/15 p-4 text-sm">
            Erro: {erro}. Se não conseguir conectar, feche o Monitor Serial da IDE do Arduino.
          </div>
        )}

        <section className="plate mt-6 rounded-sm border-2 border-border p-5 bezel">
          <h2 className="stencil text-base text-foreground">Controle da bomba</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {!conectado
              ? "Conecte o Arduino para enviar comandos."
              : !protocolo
                ? "Aguardando resposta do firmware de controle. Carregue a versão atual do programa no Arduino."
                : `Modo confirmado: ${controle?.modo === "PAUSADO" ? "pausado" : controle ? "automático" : "aguardando estado"}.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { comando: "LIGAR", label: "Solicitar ligar" },
              { comando: "PARAR", label: "Desligar e pausar" },
              { comando: "AUTOMATICO", label: "Retomar automático" },
            ].map(({ comando, label }) => (
              <button
                key={comando}
                onClick={() => void enviarComando(comando)}
                disabled={!conectado || !protocolo || !controle}
                className="stencil rounded-sm border-2 border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Ligar retoma o automático: a bomba só parte após as confirmações e condições de nível e
            descanso. Parar interrompe a bomba e pausa o automático.
          </p>
          <label className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            Ao perder conexão:
            <select
              value={controle?.desconexao ?? ""}
              disabled={!conectado || !protocolo || !controle}
              onChange={(e) =>
                void enviarComando(e.target.value === "PARAR" ? "USB_PARAR" : "USB_AUTO")
              }
              className="rounded-sm border-2 border-border bg-background px-2 py-1 disabled:opacity-40"
            >
              {!controle && <option value="">Aguardando Arduino</option>}
              <option value="AUTOMATICO">Continuar automático</option>
              <option value="PARAR">Parar e aguardar comando</option>
            </select>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            O Arduino detecta a perda após 15 segundos sem sinal; a opção fica salva na placa. Abas
            em segundo plano podem ter a comunicação suspensa pelo navegador.
          </p>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-[1fr_auto_1fr]">
          <Tanque
            nome="Reservatório de coleta"
            sub="Tanque 1 · chuva"
            dist={atual?.coleta}
            pct={p1}
            marcas={[
              { label: `liga ${T1L.ligar}cm`, pct: nivelPercent(T1L.ligar, T1.cheio, T1.vazio)! },
              {
                label: `para ${T1L.desligar}cm`,
                pct: nivelPercent(T1L.desligar, T1.cheio, T1.vazio)!,
              },
            ]}
          />

          <Bomba bombeando={bombeando} estado={atual?.estado ?? null} ciclos={ciclos} />

          <Tanque
            nome="Caixa-d'água"
            sub="Tanque 2"
            dist={atual?.caixa}
            pct={p2}
            marcas={[
              { label: `cheia ${T2L.cheio}cm`, pct: nivelPercent(T2L.cheio, T2.cheio, T2.vazio)! },
              {
                label: `libera ${T2L.libera}cm`,
                pct: nivelPercent(T2L.libera, T2.cheio, T2.vazio)!,
              },
            ]}
          />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="plate rivets grunge rounded-sm border-2 border-border p-5 bezel">
            <h2 className="stencil text-base text-foreground stamp">Distâncias</h2>
            <p className="font-mono text-xs text-muted-foreground">
              Últimas {hist.length} leituras · menor distância = mais água
            </p>
            <Grafico hist={hist} />
            <div className="mt-3 flex gap-2 font-mono text-xs">
              <span className="rounded-sm border border-border bg-oil px-2 py-0.5 text-chart-1">
                ■ Coleta
              </span>
              <span className="rounded-sm border border-border bg-oil px-2 py-0.5 text-chart-2">
                ■ Caixa
              </span>
            </div>
          </div>

          <Calibracao calib={calib} onChange={salvarCalib} />

          <div className="rounded-sm border-2 border-dashed border-border bg-secondary/60 p-5 lg:col-span-2">
            <h2 className="stencil text-base text-foreground">Registro de eventos</h2>
            <p className="font-mono text-xs text-muted-foreground">
              Folha da bancada — mais recente em cima
            </p>
            <div className="mt-3 h-64 overflow-auto rounded-sm border border-border bg-background/70 p-3 font-mono text-xs leading-relaxed text-foreground/90">
              {log.length === 0 ? (
                <p className="text-muted-foreground">Conecte o Arduino para ver as mensagens…</p>
              ) : (
                log.map((l, i) => (
                  <div key={i} className="border-b border-dashed border-border/60 py-0.5">
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-sm border-2 border-border p-4 wood">
          <p className="stencil text-xs text-oil-foreground">Bancada de testes · água da chuva</p>
          <p className="font-mono text-xs text-oil-foreground/80">
            9600 baud · 150 ml por reservatório
          </p>
        </footer>
      </div>
    </main>
  );
}

function Tanque({
  nome,
  sub,
  dist,
  pct,
  marcas,
}: {
  nome: string;
  sub: string;
  dist: number | null | undefined;
  pct: number | null;
  marcas: { label: string; pct: number }[];
}) {
  const erro = dist === null;
  return (
    <div className="plate rivets grunge rounded-sm border-2 border-border p-5 bezel">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="stencil text-base text-foreground stamp">{nome}</h2>
          <p className="font-mono text-xs text-muted-foreground">{sub}</p>
        </div>
        <p className="rounded-sm border border-border bg-oil px-2 py-0.5 font-mono text-xs text-oil-foreground inset-stamp">
          {erro ? "ERRO" : dist == null ? "—" : `${dist.toFixed(1)} cm`}
        </p>
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold">
        {volumeMl(erro ? null : pct) ?? "—"} ml{" "}
        <span className="text-base text-muted-foreground">/ {CAPACIDADE_ML} ml</span>
      </p>

      {/* visor de nível: tubo de vidro com conexões de latão */}
      <div className="mt-4 h-3 rounded-sm border-y-2 border-border bg-brass/70" />
      <div className="graduacao relative h-56 overflow-hidden border-x-2 border-border bg-muted inset-stamp">
        <div
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-primary via-primary to-accent transition-all duration-500"
          style={{ height: `${pct ?? 0}%` }}
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-accent-foreground/25" />
        </div>
        {/* reflexo do vidro */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-3 w-5 bg-gradient-to-r from-card/45 to-transparent"
        />
        <div
          aria-hidden
          className="absolute inset-y-0 right-6 w-2 bg-gradient-to-l from-card/25 to-transparent"
        />
        {marcas.map((m) => (
          <div
            key={m.label}
            className="absolute inset-x-0 border-t border-dashed border-foreground/50"
            style={{ bottom: `${m.pct}%` }}
          >
            <span className="stencil absolute right-1 -top-4 rounded-sm bg-foreground/85 px-1 py-px text-[9px] text-background">
              {m.label}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-center justify-center font-mono text-3xl font-bold text-foreground">
          {erro ? (
            <span className="stencil text-base text-destructive">Erro sensor</span>
          ) : pct == null ? (
            ""
          ) : (
            `${Math.round(pct)}%`
          )}
        </div>
      </div>
      <div className="h-3 rounded-sm border-y-2 border-border bg-brass/70" />
    </div>
  );
}

function Bomba({
  bombeando,
  estado,
  ciclos,
}: {
  bombeando: boolean;
  estado: string | null;
  ciclos: number;
}) {
  const digitos = String(ciclos).padStart(3, "0").split("");
  return (
    <div className="gauge-face rivets flex flex-col items-center justify-center gap-3 rounded-sm border-2 border-border px-6 py-6 bezel">
      <p className="stencil text-xs text-oil-foreground/70">Bomba</p>
      <div
        className={`flex h-24 w-24 items-center justify-center rounded-full border-4 ${bombeando ? "border-primary" : "border-oil-foreground/25"}`}
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-12 w-12 ${bombeando ? "animate-spin text-primary" : "text-oil-foreground/45"}`}
          style={{ animationDuration: "1.2s" }}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
        </svg>
      </div>
      <p className="stencil text-lg text-oil-foreground">{estado ?? "—"}</p>
      <div className="flex gap-1" aria-label={`${ciclos} ciclos nesta sessão`}>
        {digitos.map((d, i) => (
          <span
            key={i}
            className="w-7 rounded-sm border border-oil-foreground/25 bg-oil-foreground/10 py-0.5 text-center font-mono text-lg text-oil-foreground inset-stamp"
          >
            {d}
          </span>
        ))}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-oil-foreground/85">
        ciclos nesta sessão
      </p>
    </div>
  );
}

function Grafico({ hist }: { hist: Leitura[] }) {
  const W = 500,
    H = 180,
    max = 40;
  const linha = (k: "coleta" | "caixa") =>
    hist
      .map((h, i) =>
        h[k] == null
          ? null
          : `${(i / Math.max(1, hist.length - 1)) * W},${(Math.min(h[k]!, max) / max) * H}`,
      )
      .filter(Boolean)
      .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 h-48 w-full rounded-sm border border-border bg-oil gauge-face"
    >
      {[10, 20, 30].map((v) => (
        <g key={v}>
          <line
            x1="0"
            x2={W}
            y1={(v / max) * H}
            y2={(v / max) * H}
            className="stroke-oil-foreground/40"
            strokeDasharray="4 4"
          />
          <text
            x="4"
            y={(v / max) * H - 2}
            className="fill-oil-foreground/90"
            fontSize="11"
            fontFamily="IBM Plex Mono, monospace"
          >
            {v}cm
          </text>
        </g>
      ))}
      <polyline points={linha("coleta")} fill="none" className="stroke-chart-1" strokeWidth="2" />
      <polyline points={linha("caixa")} fill="none" className="stroke-chart-2" strokeWidth="2" />
    </svg>
  );
}

function Calibracao({ calib, onChange }: { calib: Calib; onChange: (c: Calib) => void }) {
  const campo = (k: keyof Calib, label: string) => (
    <label className="flex flex-col gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
      {label}
      <input
        type="number"
        step="0.5"
        min="0"
        value={calib[k]}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange({ ...calib, [k]: v });
        }}
        className="rounded-sm border-2 border-border bg-background px-3 py-2 font-mono text-sm text-foreground inset-stamp focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
  const invalido = calib.t1Vazio <= calib.t1Cheio || calib.t2Vazio <= calib.t2Cheio;
  return (
    <div className="plate rivets grunge rounded-sm border-2 border-border p-5 bezel">
      <div className="flex items-baseline justify-between">
        <h2 className="stencil text-base text-foreground stamp">Calibração</h2>
        <button
          onClick={() => onChange(CALIB_PADRAO)}
          className="stencil rounded-sm border border-border bg-secondary px-2 py-1 text-[11px] text-secondary-foreground transition hover:bg-secondary/70 active:translate-y-px"
        >
          Restaurar padrão
        </button>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        Distância do sensor até a água (cm), medida na bancada. Capacidade: {CAPACIDADE_ML} ml cada.
      </p>
      <p className="stencil mt-4 text-xs text-accent-foreground">Reservatório de coleta</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {campo("t1Cheio", "Cheio (cm)")}
        {campo("t1Vazio", "Vazio (cm)")}
      </div>
      <p className="stencil mt-4 text-xs text-accent-foreground">Caixa-d'água</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {campo("t2Cheio", "Cheio (cm)")}
        {campo("t2Vazio", "Vazio (cm)")}
      </div>
      {invalido && (
        <p className="mt-3 font-mono text-xs text-destructive">
          A distância "vazio" deve ser maior que "cheio".
        </p>
      )}
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">
        Ajustes ficam salvos neste navegador.
      </p>
    </div>
  );
}
