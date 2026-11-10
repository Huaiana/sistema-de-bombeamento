# Documentação do sistema de bombeamento de água da chuva

## 1. Objetivo e escopo

O sistema monitora um reservatório de coleta e uma caixa-d'água usando um
Arduino Uno e dois sensores ultrassônicos HC-SR04. O Arduino aciona um relé
para transferir água conforme os níveis configurados. Um painel web permite
acompanhar as leituras e enviar comandos por USB.

Este é um projeto de bancada, não uma solução certificada para segurança
industrial, água potável ou operação sem supervisão.

## 2. Arquitetura e componentes

| Componente | Responsabilidade |
|---|---|
| [Firmware](./sistema_bombeamento.ino) | Mede distâncias, controla o relé, recebe comandos e aplica as regras de operação. |
| [Painel web](./frontend/) | Exibe medições, estado, histórico e eventos; envia comandos pela Web Serial API. |
| Arduino Uno e cabo USB | Executam o firmware e ligam a porta serial ao navegador do computador. |
| Dois HC-SR04 | Medem a distância entre cada sensor e a superfície da água. |
| Relé e bomba | O relé comanda a bomba conforme o firmware. |

O navegador comunica-se **diretamente com o Arduino via USB**. Não há servidor
de aplicação intermediário, acesso remoto ou conexão Wi-Fi neste projeto.
O servidor Vite apenas entrega os arquivos do painel durante o desenvolvimento.

### Pinos configurados no firmware

| Ligação | Pino do Arduino Uno |
|---|---:|
| TRIG da caixa-d'água | 2 |
| ECHO da caixa-d'água | 3 |
| TRIG do reservatório de coleta | 4 |
| ECHO do reservatório de coleta | 5 |
| LED vermelho (falha de sensor) | 6 |
| LED azul (bomba ligada) | 7 |
| Buzzer (apito ao ligar/desligar a bomba) | 8 |
| Comando do relé da bomba | 10 |

O relé está configurado como **ativo em nível baixo**. Confira a compatibilidade
com o módulo utilizado; o firmware contém as constantes para inverter o nível
de acionamento, se necessário. Dimensione alimentação, relé e proteção elétrica
para os componentes reais. Não ligue a bomba diretamente a um pino do Arduino.
Desligue a alimentação antes de alterar as conexões.

## 3. Preparação e modo de uso

1. Monte os componentes conforme seus manuais e confira os pinos e a alimentação.
2. Na Arduino IDE, abra [sistema_bombeamento.ino](./sistema_bombeamento.ino),
   selecione **Arduino Uno** e a porta correta e carregue o firmware atualizado.
   O controle pelo painel exige essa versão do firmware.
3. Conecte o Arduino ao computador por um cabo USB de dados. Feche o Monitor
   Serial e outros programas que estejam usando a mesma porta.
4. No PowerShell, na pasta principal deste projeto, execute:

   ```powershell
   npm --prefix ".\frontend" install
   npm --prefix ".\frontend" run dev
   ```

5. Abra o endereço exibido pelo Vite no Chrome ou Microsoft Edge para computador.
   Web Serial requer um contexto seguro: `localhost` ou HTTPS.
6. Clique em **Conectar Arduino (USB)** e selecione a porta da placa. Aguarde a
   resposta do firmware e as leituras. Abrir a porta serial pode reiniciar um
   Arduino Uno; aguarde a inicialização.
7. Observe a distância dos dois sensores, o estado da bomba e o registro de
   eventos. Teste os comandos inicialmente com a bomba desconectada ou em
   condições supervisionadas e seguras.

### Comandos do painel

- **Solicitar ligar** libera o modo automático. A partida não é forçada: depende
  dos níveis, das confirmações e do período de descanso. Se essas condições já
  forem satisfeitas, o modo automático também pode iniciar a bomba sem clicar
  nesse botão.
- **Desligar e pausar** desliga a bomba sem esperar o tempo mínimo e impede novas
  partidas automáticas enquanto o modo permanecer pausado.
- **Retomar automático** retira a pausa; uma futura partida continua sujeita
  às mesmas condições e ao descanso.
- A opção **Ao perder conexão** escolhe entre continuar no automático ou parar
  e aguardar um novo comando. A opção confirmada pelo Arduino é exibida no painel.

Um comando exibido como enviado no registro não é, por si só, confirmação de
execução. Confira as mensagens e o modo informado pelo Arduino. A abertura da
porta também não garante que o firmware correto esteja instalado: os comandos
ficam desabilitados até o painel reconhecer a resposta do protocolo.

## 4. Controle automático

Os seguintes valores estão no firmware e podem ser ajustados para a instalação:

| Parâmetro | Valor inicial | Efeito |
|---|---:|---|
| Coleta: ligar | 8 cm | A coleta deve estar a essa distância ou mais próxima do sensor. |
| Coleta: desligar | 15 cm | Para quando a água baixa até essa distância, após o tempo mínimo. |
| Caixa: cheia | 5 cm | Para quando a água chega a essa distância ou mais próxima. |
| Caixa: liberar | 8 cm | A caixa deve estar nessa distância ou mais longe para permitir a partida. |
| Confirmações | 3 leituras | As condições de partida ou parada precisam se repetir. |
| Tempo mínimo ligada | 5 s | Aplicado à parada por nível baixo da coleta, não à parada manual ou por caixa cheia. |
| Tempo máximo ligada | 60 s | Encerra o ciclo mesmo se os sensores não indicarem parada. |
| Descanso | 10 s | Impede nova partida imediatamente após desligar ou inicializar. |

Distâncias menores indicam mais água. O firmware faz até cinco medições por
sensor e usa a mediana das leituras válidas. A coleta e a caixa precisam ter
leituras válidas para iniciar. As temporizações são verificadas no ciclo de
medição e podem ser observadas com pequeno atraso.

**Limitação importante:** se um sensor falhar depois que a bomba ligar, o
firmware atual não necessariamente interrompe a bomba imediatamente; o tempo
máximo encerra o ciclo. O sistema não substitui proteção independente contra
transbordamento, funcionamento a seco, falha do relé ou falha da alimentação.

## 5. Conexão, desconexão e reinicialização

O painel envia um sinal periódico enquanto está conectado. Após 15 segundos
sem receber o sinal, o Arduino aplica a opção de desconexão escolhida:

- **Continuar automático**: cancela a pausa e retoma as regras automáticas.
- **Parar e aguardar comando**: desliga a bomba e pausa o automático. Para
  retomá-lo, reconecte e envie **Solicitar ligar** ou **Retomar automático**.

A opção é salva na EEPROM do Arduino. Se ainda não houver uma escolha salva,
o padrão é continuar no automático. Ao reiniciar com a opção de parar salva,
o Arduino inicia pausado; com a opção automática, inicia em descanso e pode
voltar a bombear automaticamente. Isso pressupõe alimentação disponível e não
impede falhas elétricas ou mecânicas. Se o Arduino for alimentado apenas por
USB, desconectar o cabo também pode desligá-lo; o comportamento do relé nessa
situação depende do hardware.

O navegador pode suspender ou reduzir temporizadores em abas em segundo plano,
fazendo o Arduino considerar a conexão perdida mesmo com o cabo conectado.
Fechar a aba, perder a conexão ou uma falha de comunicação também aciona a
política após o prazo. O painel oculta o estado instantâneo quando as leituras
deixam de chegar; o histórico permanece apenas na sessão aberta.

## 6. Calibração e estimativas

No painel, informe as distâncias medidas para tanque cheio e vazio; a distância
de vazio deve ser maior que a de cheio. A calibração muda apenas o cálculo visual
de percentual, não os limites de acionamento do Arduino. Para alterar os limites
reais, edite as constantes no firmware e carregue-o novamente.

O painel calcula o volume proporcionalmente ao percentual e à capacidade fixa
de **150 ml por reservatório** em
[arduino-parser.ts](./frontend/src/lib/arduino-parser.ts). É uma estimativa e
pressupõe relação linear entre nível e volume; tanques de geometria irregular
podem apresentar desvios. Ajuste a capacidade no código para os tanques reais.

## 7. Qualidades e limitações de uso

- **Autonomia:** o controle é executado no Arduino e não depende da página
  depois que a política de desconexão for aplicada.
- **Transparência:** o painel mostra leituras, estados, eventos e confirmações;
  os valores apresentados não substituem a inspeção física.
- **Simplicidade:** o acesso usa USB, sem configurar rede ou serviço em nuvem.
- **Estabilidade de medição:** mediana, confirmações, histerese e descanso
  reduzem oscilações, mas não eliminam falhas de sensores.
- **Portabilidade limitada:** Web Serial depende de navegador compatível em
  computador e de permissão explícita para usar a porta.
- **Persistência limitada:** a política de desconexão é salva na placa; a
  calibração é local ao navegador, e o histórico não é permanente.

## 8. Segurança e vulnerabilidades conhecidas

- Quem tiver acesso físico à porta e permissão do navegador pode enviar
  comandos; o protocolo serial não implementa autenticação ou criptografia.
- Não exponha a porta serial a usuários não autorizados. O painel não oferece
  autenticação de usuários e não foi projetado para controle pela internet.
- Uma falha de software, sensor, relé, cabo, energia ou temporização pode
  impedir o comportamento desejado. Utilize proteções independentes adequadas
  e supervisione a instalação; o desligamento pelo painel não é parada de emergência.
- Os testes automatizados simulam a comunicação e não comprovam o funcionamento
  elétrico ou hidráulico. Faça testes supervisionados com o equipamento real.
- Avalie periodicamente as dependências do frontend com `npm audit`; resultados
  dependem das versões instaladas e não são uma auditoria completa do sistema.

## 9. Diagnóstico

| Sintoma | Verificação |
|---|---|
| `package.json` não encontrado | Execute os comandos com `npm --prefix ".\frontend"` a partir da pasta principal. |
| Porta não aparece | Verifique cabo de dados, alimentação, driver e porta na Arduino IDE. |
| Não conecta | Feche o Monitor Serial e confirme que nenhum outro programa usa a porta. |
| Controles desabilitados | Aguarde a inicialização e carregue o firmware atualizado; confira o navegador e o registro. |
| Sem medições ou `ERRO SENSOR` | Confira alimentação, ligações, posição e faixa dos sensores. |
| A bomba não liga | Confira os níveis configurados, três confirmações, modo pausado e período de descanso. |
| O sistema para ou retoma sozinho | Confira a política de desconexão e se a aba foi suspensa. |

## 10. Protocolo serial

A porta usa 9600 baud e linhas terminadas em `\n`. O painel envia `PING`
periodicamente; o firmware responde `PROTOCOLO: 1` e uma linha de controle,
como `CONTROLE: PAUSADO | DESCONEXAO: PARAR`. Os demais comandos são `LIGAR`,
`PARAR`, `AUTOMATICO`, `USB_AUTO` e `USB_PARAR`. O Arduino envia confirmações
textuais, eventos da bomba e linhas de leitura; comandos não reconhecidos são
reportados como erro.

Somente um programa deve utilizar a porta por vez. Alterações no formato do
firmware exigem atualização correspondente do painel e de seus testes.

## 11. Testes

Na pasta principal, rode `npm --prefix ".\frontend" test` para os testes do
painel e `npm --prefix ".\frontend" run build` para a compilação web. Os testes
em [tests/firmware](./tests/firmware/) exercitam o sketch com sensores, tempo,
EEPROM e serial simulados; com um compilador C++ disponível, podem ser
compilados com `g++ -std=c++11 -I tests/firmware tests/firmware/controle_test.cpp -o controle_test`
e executados em seguida. Para gravar e validar a placa, compile e carregue o
sketch pela Arduino IDE e faça os testes físicos em condições seguras.
