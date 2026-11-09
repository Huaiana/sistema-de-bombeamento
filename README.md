# Sistema de bombeamento de água da chuva

Este repositório reúne o firmware do Arduino Uno e o painel web criado no
Lovable. O Arduino é responsável por ler os sensores e controlar a bomba. O
painel acompanha as leituras e permite solicitar o controle por USB, sem
ignorar os limites do firmware.

## Componentes

- `sistema_bombeamento.ino`: firmware para Arduino Uno, com dois sensores
  HC-SR04 e um relé.
- `frontend/`: painel web React que recebe os dados pela Web Serial API.

O firmware envia estado, distâncias dos tanques e eventos pela serial a
9600 baud. O painel também envia comandos e recebe a confirmação de estado.
As proteções e os limites de operação da bomba permanecem no Arduino.

## Executar

1. Abra `sistema_bombeamento.ino` na Arduino IDE, selecione Arduino Uno e a
   porta correspondente e carregue o programa.
2. No terminal, entre na pasta `frontend/`, instale as dependências e inicie
   o painel:

   ```sh
   npm install
   npm run dev
   ```

3. Abra no computador o endereço local indicado pelo Vite. Use Google Chrome
   ou Microsoft Edge, conecte o Arduino por USB e selecione **Conectar Arduino
   (USB)**. Feche o Monitor Serial da Arduino IDE antes de conectar, pois
   apenas um programa pode usar a porta serial por vez.

O acesso à porta serial requer um navegador compatível e um contexto seguro:
localhost funciona para desenvolvimento; em outro endereço, use HTTPS.

## Calibração e limites

A calibração no painel altera somente a conversão visual de distância para
percentual. Os limites que ligam e desligam a bomba são definidos no firmware
(`T1_NIVEL_LIGAR`, `T1_NIVEL_DESLIGAR`, `T2_NIVEL_CHEIO` e
`T2_NIVEL_LIBERA`) e precisam ser alterados e carregados na Arduino IDE.

O volume mostrado no painel é uma estimativa. A capacidade inicial de cada
reservatório está definida como 150 ml em `frontend/src/lib/arduino-parser.ts`;
ajuste `CAPACIDADE_ML` à capacidade real do seu sistema.

Para a descrição completa dos comandos, da desconexão, das limitações e do
protocolo, consulte [a documentação do sistema](./DOCUMENTACAO.md).
