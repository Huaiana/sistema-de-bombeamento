#pragma once

#include <cstdint>

struct EEPROMSimulada {
  uint8_t dados[1024] = {};
  uint8_t read(int endereco) { return dados[endereco]; }
  void update(int endereco, uint8_t valor) { dados[endereco] = valor; }
};

extern EEPROMSimulada EEPROM;
