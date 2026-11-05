#include <Arduino.h>

// ======================================================
// SISTEMA DE APROVEITAMENTO DE ÁGUA DA CHUVA - ARDUINO UNO
// 2 sensores ultrassônicos HC-SR04
// 1 módulo relé (acionado em LOW)
// 1 bomba de água 5 V
//
// CORREÇÕES EM RELAÇÃO À VERSÃO ANTERIOR:
//  1) HISTERESE: a bomba liga com o reservatório CHEIO e
//     só desliga quando ele estiver BAIXO (dois níveis
//     diferentes). Antes era um único nível, então a bomba
//     ligava/desligava sem parar perto do limite.
//  2) FILTRO: cada leitura é a mediana de 5 medições, para
//     ignorar a água balançando e leituras falsas.
//  3) CONFIRMAÇÃO: a condição precisa se repetir 3 leituras
//     seguidas antes de ligar ou desligar a bomba.
//  4) TEMPO MÍNIMO LIGADA: a bomba fica ligada pelo menos
//     alguns segundos, dando tempo de a água chegar.
//  5) DESCANSO: depois de desligar, espera um tempo antes
//     de poder ligar de novo.
//  6) SEGURANÇA: tempo máximo ligada (evita a bomba rodar
//     a seco se algum sensor falhar).
// ======================================================

// ------------------------------
// PINOS
// ------------------------------
const int TRIG_TANQUE1 = 2;   // Reservatório de coleta (chuva)
const int ECHO_TANQUE1 = 3;
const int TRIG_TANQUE2 = 4;   // Caixa-d'água
const int ECHO_TANQUE2 = 5;
const int RELE_BOMBA   = 8;

// Relé acionado em LOW (igual ao seu código original).
// Se o seu relé for acionado em HIGH, inverta estes dois.
const int BOMBA_LIGADA    = LOW;
const int BOMBA_DESLIGADA = HIGH;

// ======================================================
// AJUSTE DOS NÍVEIS (distância do sensor até a água, em cm)
// Lembre: MENOR distância = MAIS água
// ======================================================

// Reservatório de coleta (Tanque 1)
const float T1_NIVEL_LIGAR    = 8.0;   // água chegou aqui -> pode bombear
const float T1_NIVEL_DESLIGAR = 15.0;  // água baixou até aqui -> para

// Caixa-d'água (Tanque 2)
const float T2_NIVEL_CHEIO    = 5.0;   // cheia -> para a bomba
const float T2_NIVEL_LIBERA   = 8.0;   // baixou até aqui -> pode encher de novo

// ======================================================
// AJUSTE DOS TEMPOS (milissegundos)
// ======================================================
const unsigned long TEMPO_MIN_LIGADA = 5000;   // 5 s ligada no mínimo
const unsigned long TEMPO_MAX_LIGADA = 60000;  // 60 s no máximo (segurança)
const unsigned long TEMPO_DESCANSO   = 10000;  // 10 s parada após desligar
const unsigned long INTERVALO_LEITURA = 300;   // intervalo entre leituras

const int CONFIRMACOES = 3;  // leituras seguidas para confirmar

// ======================================================
// MÁQUINA DE ESTADOS
// ======================================================
enum Estado { AGUARDANDO, BOMBEANDO, DESCANSO };
Estado estado = AGUARDANDO;

unsigned long inicioEstado = 0;
unsigned long ultimaLeitura = 0;
int contadorLigar = 0;
int contadorDesligar = 0;


// ======================================================
// MEDIÇÃO SIMPLES (retorna -1 se não houver eco)
// ======================================================
float medirDistancia(int trigPin, int echoPin)
{
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duracao = pulseIn(echoPin, HIGH, 30000);
  if (duracao == 0) return -1;

  return duracao * 0.0343 / 2.0;
}

// ======================================================
// MEDIÇÃO FILTRADA: mediana de 5 leituras válidas
// ======================================================
float medirFiltrado(int trigPin, int echoPin)
{
  float v[5];
  int n = 0;

  for (int i = 0; i < 5; i++)
  {
    float d = medirDistancia(trigPin, echoPin);
    if (d > 1.0 && d < 400.0) v[n++] = d;
    delay(30);  // evita eco da medição anterior
  }

  if (n == 0) return -1;  // sensor sem resposta

  // ordena (poucos valores, bubble sort basta)
  for (int i = 0; i < n - 1; i++)
    for (int j = 0; j < n - 1 - i; j++)
      if (v[j] > v[j + 1]) { float t = v[j]; v[j] = v[j + 1]; v[j + 1] = t; }

  return v[n / 2];
}

// ======================================================
// LIGA / DESLIGA
// ======================================================
void ligarBomba()
{
  digitalWrite(RELE_BOMBA, BOMBA_LIGADA);
  estado = BOMBEANDO;
  inicioEstado = millis();
  contadorLigar = 0;
  contadorDesligar = 0;
  Serial.println(">>> BOMBA LIGADA");
}

void desligarBomba(const char* motivo)
{
  digitalWrite(RELE_BOMBA, BOMBA_DESLIGADA);
  estado = DESCANSO;
  inicioEstado = millis();
  contadorLigar = 0;
  contadorDesligar = 0;
  Serial.print(">>> BOMBA DESLIGADA - motivo: ");
  Serial.println(motivo);
}


// ======================================================
// CONFIGURAÇÃO
// ======================================================
void setup()
{
  pinMode(TRIG_TANQUE1, OUTPUT);
  pinMode(ECHO_TANQUE1, INPUT);
  pinMode(TRIG_TANQUE2, OUTPUT);
  pinMode(ECHO_TANQUE2, INPUT);

  // Desliga o relé ANTES de configurar como saída,
  // para a bomba não dar um "pulso" ao ligar o Arduino
  digitalWrite(RELE_BOMBA, BOMBA_DESLIGADA);
  pinMode(RELE_BOMBA, OUTPUT);

  Serial.begin(9600);
  Serial.println("=================================");
  Serial.println("SISTEMA DE BOMBEAMENTO - INICIADO");
  Serial.println("=================================");

  // Começa em descanso para os sensores estabilizarem
  estado = DESCANSO;
  inicioEstado = millis();
}


// ======================================================
// PROGRAMA PRINCIPAL
// ======================================================
void loop()
{
  if (millis() - ultimaLeitura < INTERVALO_LEITURA) return;
  ultimaLeitura = millis();

  float d1 = medirFiltrado(TRIG_TANQUE1, ECHO_TANQUE1);
  delay(50);
  float d2 = medirFiltrado(TRIG_TANQUE2, ECHO_TANQUE2);

  bool d1ok = (d1 > 0);
  bool d2ok = (d2 > 0);
  unsigned long tempoNoEstado = millis() - inicioEstado;

  switch (estado)
  {
    // --------------------------------------------------
    case AGUARDANDO:
      // Só liga se o reservatório de coleta estiver CHEIO
      // e a caixa-d'água tiver espaço de verdade.
      // Com sensor falhando, não liga.
      if (d1ok && d2ok &&
          d1 <= T1_NIVEL_LIGAR &&
          d2 >= T2_NIVEL_LIBERA)
      {
        contadorLigar++;
        if (contadorLigar >= CONFIRMACOES) ligarBomba();
      }
      else
      {
        contadorLigar = 0;
      }
      break;

    // --------------------------------------------------
    case BOMBEANDO:
      // Segurança: tempo máximo
      if (tempoNoEstado >= TEMPO_MAX_LIGADA)
      {
        desligarBomba("TEMPO MAXIMO (verifique sensores/mangueira)");
        break;
      }

      // Caixa-d'água cheia: para (vale a qualquer momento)
      if (d2ok && d2 <= T2_NIVEL_CHEIO)
      {
        contadorDesligar++;
        if (contadorDesligar >= CONFIRMACOES)
          desligarBomba("CAIXA-D'AGUA CHEIA");
        break;
      }

      // Reservatório de coleta baixo: para
      // (só depois do tempo mínimo ligada)
      if (tempoNoEstado >= TEMPO_MIN_LIGADA &&
          d1ok && d1 >= T1_NIVEL_DESLIGAR)
      {
        contadorDesligar++;
        if (contadorDesligar >= CONFIRMACOES)
          desligarBomba("RESERVATORIO DE COLETA VAZIO");
        break;
      }

      contadorDesligar = 0;
      break;

    // --------------------------------------------------
    case DESCANSO:
      if (tempoNoEstado >= TEMPO_DESCANSO)
      {
        estado = AGUARDANDO;
        Serial.println("Pronto para novo ciclo");
      }
      break;
  }

  // ---------------- MONITOR SERIAL ----------------
  Serial.print("Estado: ");
  if (estado == AGUARDANDO) Serial.print("AGUARDANDO");
  else if (estado == BOMBEANDO) Serial.print("BOMBEANDO");
  else Serial.print("DESCANSO");

  Serial.print(" | Coleta: ");
  if (d1ok) { Serial.print(d1, 1); Serial.print(" cm"); }
  else Serial.print("ERRO SENSOR");

  Serial.print(" | Caixa: ");
  if (d2ok) { Serial.print(d2, 1); Serial.println(" cm"); }
  else Serial.println("ERRO SENSOR");
}
