import { useState, useRef, useCallback } from "react";
import { connectSerial, disconnectSerial, sendCommand, startReadingSerial } from "../lib/serialService";
import { parseLinha, Evento, Leitura, Controle } from "../lib/arduino-parser";

export function useArduinoSerial() {
  const [conectado, setConectado] = useState(false);
  const [modoControle, setModoControle] = useState<Controle["modo"]>("AUTOMATICO");
  const [estadoBomba, setEstadoBomba] = useState<Leitura["estado"]>("AGUARDANDO");
  const [leituraAtual, setLeituraAtual] = useState<Leitura | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  const isRunningRef = useRef(false);

  // Função para conectar na porta USB
  const conectar = async () => {
    const sucesso = await connectSerial(9600);
    if (sucesso) {
      setConectado(true);
      isRunningRef.current = true;
      
      // Inicia a escuta contínua da porta serial em segundo plano
      iniciarEscuta();
    }
  };

  // Função para desconectar
  const desconectar = async () => {
    isRunningRef.current = false;
    await disconnectSerial();
    setConectado(false);
    setEstadoBomba("AGUARDANDO");
  };

  // Loop de leitura integrado com o parseLinha
  const iniciarEscuta = async () => {
    await startReadingSerial((linhaBruta) => {
      // Adiciona aos logs brutos para monitoramento na tela (opcional)
      setLogs((prev) => [...prev.slice(-50), linhaBruta]);

      // Usa o parser que você criou
      const evento: Evento = parseLinha(linhaBruta);

      switch (evento.tipo) {
        case "leitura":
          setLeituraAtual(evento.leitura);
          setEstadoBomba(evento.leitura.estado);
          break;
        case "ligou":
          setEstadoBomba("BOMBEANDO");
          break;
        case "desligou":
          setEstadoBomba("AGUARDANDO");
          break;
        case "controle":
          setModoControle(evento.controle.modo);
          break;
        default:
          break;
      }
    });
  };

  // Função para enviar comandos (ex: ligar, pausar, etc)
  const enviarComandoArduino = async (cmd: string) => {
    await sendCommand(cmd);
  };

  return {
    conectado,
    modoControle,
    estadoBomba,
    leituraAtual,
    logs,
    conectar,
    desconectar,
    enviarComandoArduino,
  };
}
