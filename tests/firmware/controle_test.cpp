#include "Arduino.h"
#include "EEPROM.h"
#include <cassert>
#include <iostream>

unsigned long tempoSimulado = 0;
int estadoRele = HIGH;
long ecoColeta = 350;
long ecoCaixa = 600;
SerialSimulada Serial;
EEPROMSimulada EEPROM;

unsigned long millis() { return tempoSimulado; }
void delay(unsigned long ms) { tempoSimulado += ms; }
void delayMicroseconds(unsigned int) {}
void pinMode(int, int) {}
void digitalWrite(int pin, int value) { if (pin == 8) estadoRele = value; }
long pulseIn(int pin, int, unsigned long) { return pin == 3 ? ecoColeta : ecoCaixa; }

#include "../../sistema_bombeamento.ino"

void comando(const char* texto) {
  Serial.entrada += std::string(texto) + '\n';
  lerComandos();
}

void leitura() {
  comando("PING");
  tempoSimulado += INTERVALO_LEITURA;
  loop();
}

int main() {
  setup();
  assert(!controlePausado && !pararNaDesconexao && estadoRele == BOMBA_DESLIGADA);
  comando("PING");
  assert(painelConectado);
  assert(Serial.saida.find("PROTOCOLO: 1") != std::string::npos);

  tempoSimulado += TEMPO_DESCANSO;
  leitura();
  assert(estado == AGUARDANDO);
  leitura();
  leitura();
  assert(estadoRele == BOMBA_DESLIGADA);
  leitura();
  assert(estado == BOMBEANDO && estadoRele == BOMBA_LIGADA);

  comando("PARAR");
  assert(controlePausado && estado == DESCANSO && estadoRele == BOMBA_DESLIGADA);
  tempoSimulado += TEMPO_DESCANSO;
  leitura();
  leitura();
  leitura();
  leitura();
  assert(estadoRele == BOMBA_DESLIGADA);

  comando("LIGAR");
  assert(!controlePausado && estadoRele == BOMBA_DESLIGADA);
  ecoCaixa = 0;
  leitura();
  leitura();
  leitura();
  assert(estadoRele == BOMBA_DESLIGADA);
  ecoCaixa = 600;
  leitura();
  leitura();
  leitura();
  assert(estadoRele == BOMBA_LIGADA);

  comando("PARAR");
  tempoSimulado += TEMPO_CONEXAO_USB;
  lerComandos();
  assert(!painelConectado && !controlePausado && estadoRele == BOMBA_DESLIGADA);

  comando("PING");
  comando("USB_PARAR");
  assert(pararNaDesconexao && EEPROM.read(EEPROM_ENDERECO_POLITICA) == 1);
  tempoSimulado += TEMPO_DESCANSO;
  leitura();
  leitura();
  leitura();
  leitura();
  assert(estadoRele == BOMBA_LIGADA);
  tempoSimulado = ultimoSinalPainel + TEMPO_CONEXAO_USB - 1;
  lerComandos();
  assert(painelConectado && estadoRele == BOMBA_LIGADA);
  tempoSimulado++;
  lerComandos();
  assert(!painelConectado && controlePausado && estadoRele == BOMBA_DESLIGADA);

  setup();
  assert(pararNaDesconexao && controlePausado && estadoRele == BOMBA_DESLIGADA);
  comando("PING");
  comando("AUTOMATICO");
  assert(!controlePausado);
  comando("USB_AUTO");
  assert(!pararNaDesconexao && EEPROM.read(EEPROM_ENDERECO_POLITICA) == 0);

  setup();
  assert(!pararNaDesconexao && !controlePausado);
  comando("PING");
  comando("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  assert(Serial.saida.find("ERRO: COMANDO MUITO LONGO") != std::string::npos);
  tempoSimulado += TEMPO_DESCANSO;
  leitura();
  leitura();
  leitura();
  leitura();
  assert(estadoRele == BOMBA_LIGADA);
  tempoSimulado += TEMPO_MAX_LIGADA;
  leitura();
  assert(estadoRele == BOMBA_DESLIGADA && estado == DESCANSO);
  std::cout << "Firmware control tests passed\n";
}
