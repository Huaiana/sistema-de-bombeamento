#pragma once

#include <cstdint>
#include <string>

using byte = uint8_t;

constexpr int LOW = 0;
constexpr int HIGH = 1;
constexpr int OUTPUT = 1;
constexpr int INPUT = 0;
#define F(value) value

extern unsigned long tempoSimulado;
extern int estadoRele;
extern long ecoColeta;
extern long ecoCaixa;

unsigned long millis();
void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
void pinMode(int pin, int mode);
void digitalWrite(int pin, int value);
long pulseIn(int pin, int value, unsigned long timeout);

struct SerialSimulada {
  std::string entrada;
  std::string saida;
  void begin(int) {}
  int available() { return static_cast<int>(entrada.size()); }
  int read() {
    char c = entrada.front();
    entrada.erase(0, 1);
    return c;
  }
  void print(const char* texto) { saida += texto; }
  void print(float valor, int) { saida += std::to_string(valor); }
  void println(const char* texto) { print(texto); saida += '\n'; }
};

extern SerialSimulada Serial;
