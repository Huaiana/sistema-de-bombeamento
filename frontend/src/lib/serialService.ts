// Gerenciador de Comunicação Serial USB para o Arduino

let port: SerialPort | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let reader: ReadableStreamDefaultReader<string> | null = null;
let keepReading = false;

/**
 * Solicita ao usuário a seleção da porta USB e abre a conexão serial.
 * @param baudRate Taxa de transmissão (ex: 9600 para coincidir com o Serial.begin do Arduino)
 */
export async function connectSerial(baudRate = 9600): Promise<boolean> {
  // Verifica se o navegador suporta a Web Serial API
  if (!("serial" in navigator)) {
    alert("Seu navegador não suporta a Web Serial API. Use o Google Chrome ou Microsoft Edge.");
    return false;
  }

  try {
    // Solicita que o usuário escolha a porta COM/USB do Arduino
    port = await navigator.serial.requestPort();
    
    // Abre a porta com a mesma velocidade do firmware
    await port.open({ baudRate });
    console.log("Porta serial conectada com sucesso!");
    return true;
  } catch (error) {
    console.error("Erro ao conectar à porta USB:", error);
    return false;
  }
}

/**
 * Envia um comando de texto para o Arduino via USB.
 */
export async function sendCommand(command: string): Promise<boolean> {
  if (!port || !port.writable) {
    console.error("A porta serial não está aberta para escrita.");
    return false;
  }

  try {
    const encoder = new TextEncoder();
    writer = port.writable.getWriter();
    
    // Envia o comando adicionando quebra de linha (\n) para o Arduino ler via Serial.readStringUntil()
    await writer.write(encoder.encode(command + "\n"));
    console.log("Comando enviado:", command);
    return true;
  } catch (error) {
    console.error("Erro ao enviar dados pela porta serial:", error);
    return false;
  } finally {
    if (writer) {
      writer.releaseLock();
      writer = null;
    }
  }
}

/**
 * Inicia a leitura contínua de dados vindos do Arduino.
 * @param onDataReceived Função callback chamada toda vez que uma linha de texto é recebida.
 */
export async function startReadingSerial(onDataReceived: (data: string) => void): Promise<void> {
  if (!port || !port.readable) {
    console.error("A porta serial não está aberta para leitura.");
    return;
  }

  keepReading = true;

  try {
    while (port.readable && keepReading) {
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      reader = textDecoder.readable.getReader();

      try {
        while (keepReading) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            // Repassa o texto recebido para a interface
            onDataReceived(value);
          }
        }
      } catch (error) {
        console.error("Erro durante a leitura do fluxo serial:", error);
      } finally {
        if (reader) {
          reader.releaseLock();
          reader = null;
        }
      }
    }
  } catch (error) {
    console.error("Erro no canal de leitura serial:", error);
  }
}

/**
 * Fecha a conexão serial com o Arduino de forma segura.
 */
export async function disconnectSerial(): Promise<void> {
  keepReading = false;
  
  if (reader) {
    try {
      await reader.cancel();
    } catch (e) {
      // Ignora erros ao cancelar o leitor
    }
    reader = null;
  }

  if (port) {
    try {
      await port.close();
      console.log("Porta serial fechada com sucesso.");
    } catch (error) {
      console.error("Erro ao fechar a porta serial:", error);
    }
    port = null;
  }
}
