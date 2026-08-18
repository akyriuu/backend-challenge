# Arquitetura

Este documento registra as decisões técnicas do projeto no momento em que foram
tomadas, junto com os trade-offs aceitos e as limitações conhecidas. Cada decisão
descreve o contexto, a escolha, suas consequências e a alternativa descartada.

## Fundação: runtime, compilação e testes

### 1. O Bun é o runtime; o TypeScript é apenas verificador de tipos

**Contexto.** O scaffold do NestJS compila com `tsc` para `dist/` e executa o
resultado com `node dist/main`. Nessa configuração o Bun atuava apenas como
executor de scripts do `package.json` — o processo da aplicação era Node. A stack
obrigatória do desafio define Bun 1.x como runtime.

**Decisão.** A aplicação é executada diretamente pelo Bun (`bun run src/main.ts`),
sem etapa de build. O `tsc` permanece no projeto exclusivamente como verificador
(`tsc --noEmit`), exposto no script `typecheck` e agregado ao script `check`.

**Consequência.** O Bun transpila TypeScript sem verificar tipos, então a
verificação deixa de ser automática e passa a ser um portão explícito. Divergências
de tipo que o runtime tolera só são detectadas se `bun run typecheck` for executado
— por isso ele é o primeiro comando do `check` e precisa fazer parte do CI. Em
contrapartida, desaparecem `dist/`, o cache incremental e toda a classe de falhas
associada a artefatos de build dessincronizados.

**Alternativa descartada.** Manter `nest build` com `node dist/main`, que é o
caminho convencional do Nest e traz verificação de tipos embutida no ciclo de
desenvolvimento, mas descumpre a stack obrigatória.

### 2. Decorators legados protegidos por teste de regressão

**Contexto.** O NestJS depende de decorators legados (`experimentalDecorators`) e
de metadados de reflexão (`emitDecoratorMetadata`) para injeção de dependência. A
partir do Bun 1.3.10 o transpilador passou a emitir decorators no formato TC39, e
há relatos de `experimentalDecorators` sendo ignorado
([oven-sh/bun#27575](https://github.com/oven-sh/bun/issues/27575)) e de falhas na
descoberta de entidades do MikroORM
([mikro-orm/mikro-orm#7381](https://github.com/mikro-orm/mikro-orm/issues/7381)).
A versão em uso é a 1.3.14, dentro dessa janela.

**Decisão.** Ambas as flags permanecem ligadas, e a garantia de que elas funcionam
sob o Bun é verificada por um teste dedicado (`test/toolchain.spec.ts`), que afirma
que `design:paramtypes` de um controller resolve para o serviço injetado.

**Consequência.** Uma premissa de toolchain vira asserção executável. Se uma
atualização do Bun quebrar a emissão de metadados, o teste falha no CI antes que a
injeção de dependência falhe em produção, com uma mensagem que aponta a causa real
em vez de um "Cannot resolve dependency" genérico.

**Limitação conhecida.** A garantia vale para execução direta de TypeScript
(`bun run`), que é o modo adotado. O `bun build` não é usado no projeto justamente
porque é nele que os relatos de quebra se concentram.

### 3. Resolução de módulos alinhada ao comportamento do runtime

**Contexto.** O `tsconfig.json` do scaffold usava `moduleResolution: node`, o
algoritmo legado que antecede o campo `exports` do `package.json` e o ignora. O Bun
honra `exports` ao resolver módulos em runtime. Tipos e execução divergiam, e a
configuração original chegou a produzir erro de compilação ao tentar habilitar
`resolvePackageJsonExports` sobre esse algoritmo.

**Decisão.** `module: Preserve` com `moduleResolution: bundler` e `noEmit: true`.

**Consequência.** O TypeScript passa a resolver tipos pelo mesmo critério que o Bun
usa para resolver código, o que evita divergências em pacotes modernos publicados
apenas com mapa de `exports`. As opções ligadas à emissão (`outDir`, `rootDir`,
`declaration`, `sourceMap`, `incremental`) foram removidas por terem deixado de ter
efeito, assim como o `tsconfig.build.json`.

### 4. `verbatimModuleSyntax` deliberadamente desabilitado

**Contexto.** A configuração recomendada pelo Bun inclui `verbatimModuleSyntax`.

**Decisão.** A opção não é usada.

**Justificativa.** Com ela ativa, o TypeScript exige `import type` para importações
usadas apenas em posição de tipo — e o tipo de um parâmetro de construtor tem essa
aparência. Como `import type` é apagado na transpilação, o valor deixa de existir
em runtime e `emitDecoratorMetadata` passa a registrar `Object` no lugar da classe,
quebrando a injeção de dependência do Nest com um erro que aparece só no boot.
O ganho de explicitude não compensa esse risco num projeto baseado em decorators.

### 5. Modo estrito com verificação de acesso indexado

**Contexto.** O scaffold desliga `noImplicitAny` e `strictBindCallApply`, e liga
apenas `strictNullChecks`. O desafio exige TypeScript em modo estrito.

**Decisão.** `strict: true`, acrescido de `noUncheckedIndexedAccess` e
`noImplicitOverride`.

**Consequência.** `noUncheckedIndexedAccess` obriga a tratar acesso indexado como
possivelmente indefinido. Em código que reconstrói saldo a partir de coleções de
lançamentos, isso força a lidar explicitamente com coleções vazias, que é
exatamente onde erros de reconciliação costumam se esconder.

### 6. `bun test` como test runner, sem camada de transpilação intermediária

**Contexto.** O scaffold trazia Jest, `ts-jest`, `@types/jest` e `supertest`. A
stack obrigatória define o Bun como test runner.

**Decisão.** Jest e `ts-jest` foram removidos e os testes rodam em `bun test`. Os
arquivos de teste importam `describe`, `it` e `expect` explicitamente de `bun:test`
em vez de depender de globais.

**Consequências e armadilhas registradas.**

- `@types/jest` foi desinstalado porque seus globais colidem com os do `@types/bun`.
  Como o TypeScript 6 deixou de descobrir pacotes `@types/*` automaticamente, o
  `tsconfig.json` declara `types: ["bun", "node"]` de forma explícita.
- O Bun descobre testes pelos padrões `*.test.ts`, `*_test.ts`, `*.spec.ts` e
  `*_spec.ts`. O nome `app.e2e-spec.ts`, herdado do Jest, não casa com nenhum deles
  e era silenciosamente ignorado. Os arquivos foram renomeados para `*.spec.ts`.
  Uma suíte que não roda é indistinguível de uma suíte que passa, então a contagem
  de arquivos no resultado do `bun test` é verificada a cada execução.
- O `supertest` foi substituído por um servidor real (`app.listen(0)`) consumido
  via `fetch`. Além de remover uma dependência, isso aproxima o teste de ponta a
  ponta do cenário que os testes de concorrência vão exigir mais adiante, com
  múltiplas instâncias atendendo em portas distintas.

### 7. Separação entre suítes que dependem de infraestrutura e as que não dependem

**Decisão.** O script `test` executa apenas testes unitários e de ponta a ponta
em processo, sem dependências externas. Testes que exigem contêineres ficam em
`test/integration` e são executados por `test:integration`, com timeout ampliado.

**Justificativa.** Mantém o ciclo de feedback local rápido e sem pré-requisitos,
enquanto preserva a exigência do desafio de que PostgreSQL e SQS reais sejam
usados nos testes de integração — sem que uma coisa bloqueie a outra.


--------------------------------------------------------------------------------------


## Persistência: ORM, mapeamento e representação de dinheiro

As decisões desta seção foram validadas por um spike executável antes de
qualquer modelagem de domínio (`test/integration/orm.spike.spec.ts`), com
Bun 1.3.14, MikroORM 7.1.12, driver `pg` e PostgreSQL 17.

### 8. Agregados de domínio mapeados por modelo de persistência e mapper explícito

**Contexto.** O desafio indica o MikroORM como opção preferencial pelo Unit of
Work, Identity Map, `em.transactional()` e `LockMode` explícitos. Ao mesmo tempo,
o modelo de domínio exige construtor privado com factories `create` e `rehydrate`,
sendo que a reidratação a partir do banco deve passar por `rehydrate`. A
documentação do MikroORM afirma que construtores nunca são executados para
entidades gerenciadas — a hidratação ocorre via `Object.create` seguida de
atribuição direta de propriedades. Mapear o agregado diretamente tornaria a
factory `rehydrate` letra morta. O padrão `defineEntity + class` da v7 agrava o
problema, pois exige que o agregado herde de uma classe base gerada pelo ORM.

**Decisão.** As entidades registradas no ORM são modelos de persistência anônimos,
definidos por `defineEntity` sem classe de domínio associada. Os repositórios
traduzem explicitamente entre o registro e o agregado, chamando `Wallet.rehydrate`
na leitura e projetando o estado do agregado na escrita. O domínio não importa
nada de `@mikro-orm/*`.

**Consequência.** A reidratação passa de fato pela factory, e o domínio permanece
testável sem banco, sem contêiner e sem metadados de ORM. Perde-se o rastreamento
automático de alterações sobre o agregado — o que aqui é desejável: as escritas
financeiras precisam ser SQL explícito e determinístico (atualização condicionada
à versão, ou leitura sob `for update`), e não o resultado de uma inferência do
Unit of Work sobre campos privados. Continuam em uso `em.transactional()` para
demarcação de transação e `LockMode` para bloqueio.

**Custo aceito.** Um mapper manual por agregado, com o risco de divergência entre
o registro e o domínio quando um campo novo é adicionado. Mitigado por testes de
ida e volta que comparam o agregado reidratado com o original.

**Alternativa descartada.** Anotar o agregado diretamente como entidade. Economiza
o mapper, mas silencia as factories, expõe os campos privados à manipulação do
ORM e acopla o núcleo do sistema ao framework de persistência.

### 9. Dinheiro em `numeric(20,2)`, transportado como string em todas as fronteiras

**Contexto.** O desafio proíbe `number`, `float` e `double` para dinheiro, e exige
escala fixa de duas casas com representação exata na persistência.

**Decisão.** A coluna é `numeric(20,2)`. O `DecimalType` do MikroORM faz o
mapeamento, e seu comportamento padrão — devolver `string` em vez de `number`,
justamente para não perder precisão — é fixado no nível de tipos com
`p.type(t.decimal).$type<string>()`. O valor em runtime é encapsulado por `Money`,
implementado sobre `decimal.js`. Valor e moeda ocupam colunas separadas e são
recompostos como `Money` na reidratação.

**Consequência.** Nenhum valor monetário existe como ponto flutuante em ponto
algum do caminho: string no banco, string no driver, `Decimal` dentro de `Money`,
string na serialização. O anotação `$type<string>()` não muda comportamento — o
valor já vinha como string — mas transforma uma futura troca para o mapeamento
numérico em erro de compilação em `Money.from`, em vez de arredondamento
silencioso.

**Evidência.** O spike consulta `information_schema.columns` e afirma que a coluna
é `numeric` com escala 2, verifica que o valor persistido retorna como a string
exata `'1000.00'`, e confirma que `0.10 + 0.20` sobrevive ao ciclo completo de
ida e volta como `'0.30'`.

**Limitação conhecida.** A escala 2 é assumida globalmente. Moedas com escala
diferente — ienes, que não têm casas decimais, ou dinares, que têm três —
exigiriam escala por moeda no schema e no `Money`. Está fora do escopo assumido
(moeda única BRL), mas o modelo permanece multimoeda e os conflitos de moeda são
verificados.

### 10. Bloqueio pessimista por carteira, validado no nível do SQL emitido

**Contexto.** A unidade de concorrência é a carteira, e as garantias precisam
estar no banco, não em recursos de ordenação do broker.

**Decisão.** A estratégia candidata é bloqueio pessimista por linha, com
`em.transactional()` demarcando a transação e `LockMode.PESSIMISTIC_WRITE` na
leitura da carteira, que o driver PostgreSQL traduz para `select ... for update`.
A escolha definitiva entre bloqueio pessimista e atualização condicionada à versão
é fechada junto com o caso de uso de aposta, sob teste de concorrência real.

**Evidência.** O spike captura o SQL emitido pelo logger do ORM dentro de uma
transação e afirma a presença de `for update`. O que está validado aqui é o
mecanismo — que o `LockMode` atravessa o ORM, o driver e o Bun até virar SQL —
não ainda a correção sob concorrência, que depende do teste do cenário obrigatório.

### 11. Spike descartável antes da modelagem

**Contexto.** A combinação Bun 1.3.14, MikroORM v7 e driver `pg` é recente, e há
relatos abertos de instabilidade na emissão de decorators pelo Bun a partir da
versão 1.3.10.

**Decisão.** Antes de escrever qualquer domínio definitivo, um único arquivo de
teste prova quatro premissas: que o ORM inicializa sob o Bun, que o driver conecta
ao PostgreSQL, que decimais atravessam o mapeamento sem perda, e que o bloqueio
pessimista chega ao banco.

**Consequência.** O arquivo é explicitamente descartável. O domínio embutido nele
é substituído pelo domínio real, e o DDL declarado em linha é substituído por
migrations versionadas com as constraints definitivas. O que permanece é o
registro de quais premissas foram verificadas e como.

**Justificativa.** Uma hora gasta aqui elimina o risco de descobrir na véspera da
entrega que a stack obrigatória não comporta o ORM escolhido — momento em que
trocar de ORM ou de runtime custaria a reescrita da camada de persistência
inteira.

### 12. Ambiente local: porta publicada e ausência de volume

**Contexto.** A máquina de desenvolvimento já possui uma instância de PostgreSQL
ocupando a porta 5432, o que provocava falhas de autenticação difíceis de
interpretar: a aplicação alcançava o servidor errado.

**Decisão.** O contêiner publica a porta 2004 do host apontando para a 5432 do
contêiner, mantendo o PostgreSQL na porta padrão internamente — o que preserva a
comunicação entre contêineres quando o LocalStack e a aplicação entrarem na mesma
rede. O serviço não declara volume nomeado, de modo que recriar o contêiner
reinicializa o cluster.

**Consequência.** O banco local é efêmero por construção, o que favorece testes
determinísticos e elimina estado acumulado entre execuções. A URL de conexão passou a vir de `DATABASE_URL`,
lida em `src/config/env.ts`. O LocalStack entrou na mesma composição, publicando
a porta 4566, e o provisionamento das filas acontece por script de inicialização
em vez de comando manual.



--------------------------------------------------------------------------------------


## Infraestrutura: ambiente local, migrations e sinais de saúde

### 13. Liveness e readiness respondem a perguntas diferentes

**Contexto.** O desafio exige dois health checks. A tentação é implementar os dois
verificando as mesmas dependências e mudar apenas o nome da rota.

**Decisão.** `/health/live` não toca em dependência alguma: responde 200 enquanto
o processo estiver de pé e o event loop respondendo. `/health/ready` consulta
PostgreSQL e SQS e responde 503 se qualquer um deles estiver inacessível.

**Justificativa.** As duas rotas são consumidas por atores distintos com poderes
distintos. O liveness é lido por quem pode **matar e reiniciar** o processo; o
readiness, por quem pode **tirá-lo do balanceador**. Se o liveness verificasse o
banco, uma indisponibilidade do PostgreSQL faria o orquestrador reiniciar em
cascata todas as instâncias saudáveis, transformando uma degradação parcial numa
interrupção total — e ainda por cima destruindo, a cada reinício, o trabalho em
andamento do consumidor e do publisher. Readiness protege o usuário de receber
erro; liveness protege o sistema de um processo travado. Confundir os dois
significa não medir nenhum dos dois.

**Evidência.** O caso `live responde ok mesmo com dependência fora`, em
`src/health/health.controller.spec.ts`, instancia o controller com uma sonda que
falha e ainda assim exige 200. Se alguém acrescentar uma verificação de banco ao
liveness, esse teste fica vermelho imediatamente.

### 14. Sondas independentes, com timeout próprio e diagnóstico por dependência

**Contexto.** O modo mais comum de falha de infraestrutura não é a conexão
recusada — que retorna rápido — e sim a conexão que fica pendurada até o timeout
do sistema operacional, na casa de dezenas de segundos.

**Decisão.** Cada dependência é uma implementação da interface `HealthProbe`,
registrada por um token de injeção (`HEALTH_PROBES`). O controller executa todas
em paralelo, cada uma sob um `Promise.race` com limite de 2 segundos, e compõe
uma resposta que informa o estado e a latência de cada uma individualmente.

**Consequência.** Um readiness que trava é indistinguível de uma aplicação
travada: o orquestrador não recebe resposta e toma a decisão errada. Com o limite
explícito, uma dependência pendurada vira 503 em 2 segundos, com `error: timeout`
identificando qual. O custo é que o limite precisa ser maior que a latência
normal das sondas — se ficar apertado demais, o readiness passa a oscilar sob
carga e a instância entra e sai do balanceador sem motivo.

**Detalhe deliberado.** A sonda de SQS consulta os atributos da fila configurada
em `SQS_QUEUE_URL`, e não a lista de filas. Isso prova duas coisas de uma vez:
que o serviço está alcançável e que a fila que o consumidor vai usar realmente
existe. Um `ListQueues` responderia 200 num ambiente sem fila provisionada.

**Alternativa descartada.** `@nestjs/terminus`, que é a solução idiomática do
Nest e traz indicadores prontos. Foi descartada porque a lógica que importa aqui
— separação entre live e ready, timeout por sonda, formato do diagnóstico — cabe
em cerca de cinquenta linhas explícitas, enquanto adotar a biblioteca traria uma
dependência a mais e faria justamente essa lógica virar configuração implícita,
difícil de testar unitariamente e de justificar numa avaliação.

### 15. Migrations escritas à mão, sem snapshot nem diffing automático

**Contexto.** O MikroORM sabe gerar migrations comparando os metadados das
entidades com o schema do banco. O desafio, porém, avalia explicitamente o
desenho do schema: unicidade parcial, imutabilidade do ledger, não-negatividade
de saldo e revogação de privilégios.

**Decisão.** As migrations são escritas manualmente, com `up` e `down`
simétricos. A configuração usa `snapshot: false` e `disableForeignKeys: false`.

**Justificativa.** Um gerador por diferença produz o que o modelo de objetos
consegue expressar — colunas, tipos, índices simples. Ele não produz
`CHECK (balance >= 0)`, nem índice único parcial com predicado, nem
`REVOKE UPDATE, DELETE ON ledger`. Como essas cláusulas são exatamente o que está
sendo avaliado, escrevê-las à mão não é trabalho extra: é o trabalho. O
`snapshot: false` evita que o migrator mantenha um arquivo de estado que
divergiria de migrations que ele não gerou. O `disableForeignKeys: false` evita
que o MikroORM tente desabilitar a checagem de chaves estrangeiras na sessão,
operação que no PostgreSQL exige privilégio de superusuário.

**Consequência.** Toda alteração de schema exige escrever o `down` correspondente
e exercitá-lo. Em troca, o conteúdo de cada migration é revisável como SQL, e o
que está no banco é exatamente o que foi escrito.

**Decisão de ferramenta.** O migrator é acionado por um script próprio
(`src/infrastructure/database/migrate.ts`) que chama `orm.migrator` diretamente,
em vez da CLI do MikroORM. Isso evita depender do mecanismo de descoberta de
configuração da CLI sob o Bun e entrega o mesmo comando que será usado como etapa
de migração no Docker.

### 16. Filas provisionadas na subida do LocalStack, com deduplicação por conteúdo desligada

**Contexto.** O consumidor precisa de uma fila FIFO e de uma DLQ. Criá-las por
comando manual torna o `docker compose up` insuficiente para reproduzir o
ambiente.

**Decisão.** Um script em `docker/localstack/init/ready.d/` cria a DLQ, lê o ARN
dela, e cria a fila principal já com `RedrivePolicy` apontando para a DLQ e
`maxReceiveCount` igual a 5. `ContentBasedDeduplication` fica **desligado**.

**Justificativa da deduplicação desligada.** O SQS FIFO deduplica dentro de uma
janela de 5 minutos. A idempotência exigida pelo desafio é permanente, e precisa
valer também para reentregas que ocorram depois dessa janela, para mensagens
reprocessadas a partir da DLQ e para o caso de a fila ser recriada. Delegar essa
garantia ao broker produziria um sistema que parece idempotente em teste e falha
em produção. A deduplicação real é responsabilidade da tabela de inbox, com
unicidade no banco; o recurso do broker seria, na melhor das hipóteses, uma
otimização redundante. A consequência prática é que todo envio precisa informar
`MessageDeduplicationId` explicitamente, já que a fila é FIFO.

**Armadilha registrada.** O script é montado por bind mount e executado dentro do
contêiner. Em máquinas Windows, o Git entrega o arquivo com quebras de linha CRLF
por causa de `core.autocrlf`, e o interpretador falha com um erro que não menciona
line endings. Por isso o repositório fixa `*.sh text eol=lf` no `.gitattributes`.

### 17. Configuração validada na importação, com falha no boot

**Contexto.** Variável de ambiente ausente costuma se manifestar tarde: a
aplicação sobe, o liveness responde 200, e o erro aparece na primeira requisição
que precisa daquele valor.

**Decisão.** `src/config/env.ts` lê e valida todas as variáveis no momento da
importação do módulo, lançando com o nome da variável faltante. Valor vazio é
tratado como ausente. O `.env` é carregado nativamente pelo Bun, sem `dotenv`.

**Consequência.** Configuração incompleta derruba o processo antes de abrir a
porta, com código de saída 1 — que é o sinal que o Docker e o orquestrador
precisam para não considerar o contêiner saudável. O efeito colateral aceito é
que o script de migrations, que não usa SQS, também exige as variáveis de fila.
Para desenvolvimento isso é desejável: há um único lugar onde a configuração é
descrita. Se um job de CI passar a rodar apenas migrations, a validação será
separada em `env.database` e `env.sqs` com avaliação preguiçosa.

**Alternativa descartada.** `@nestjs/config` com schema de validação. Traz
dependência e um módulo a registrar, em troca de recursos — namespaces,
configuração por ambiente, injeção do `ConfigService` — que este serviço não usa.
Vinte linhas explícitas e tipadas cobrem o caso e falham mais cedo, no import,
em vez de no ciclo de vida do módulo.

--------------------------------------------------------------------------------------
## Domínio: representação de dinheiro
### 18. `Money` não consegue representar valor negativo
**Contexto.** Saldo negativo é uma das falhas eliminatórias do enunciado. A
abordagem usual é permitir que o tipo monetário carregue sinal e verificar a
não-negatividade no agregado, antes de cada escrita.
**Decisão.** `Money.from` rejeita qualquer entrada com sinal negativo, e
`subtract` lança quando o resultado ficaria abaixo de zero. Não existe instância
de `Money` com valor negativo em nenhum ponto do ciclo de vida.
**Consequência.** A invariante deixa de depender de alguém lembrar de chamar uma
verificação: um saldo negativo é inexprimível no sistema de tipos do domínio, e
não apenas proibido por convenção. O `Wallet` compara antes de subtrair
(`balance.isLessThan(amount)`) para produzir `InsufficientFundsError` com saldo
disponível e valor solicitado; o lançamento dentro de `subtract` é a rede de
segurança final, para o caso de algum caminho futuro esquecer a comparação.
**Custo aceito.** Operações que precisariam de sinal — por exemplo, reconciliar
somando créditos e subtraindo débitos — têm que ser expressas por comparação e
direção explícita (`DEBIT`/`CREDIT`) em vez de aritmética com sinal. Isso é mais
verboso, mas evita que a direção do lançamento fique implícita no sinal do valor,
que é uma fonte clássica de erro em ledger.
**Alternativa descartada.** `Money` com sinal, deixando a não-negatividade a
cargo do agregado. Mais flexível, e foi o que o spike do passo 1 usou — mas move
a garantia para um ponto que pode ser contornado por qualquer código novo que
construa um `Money` diretamente.
### 19. A única exceção de lint do projeto, e por que ela existe
**Contexto.** A guarda de `src/domain` proíbe `Number(`, `parseFloat`,
`parseInt`, `+` unário e `toFixed`, por casamento sintático. O casamento de
`toFixed` é feito pelo nome do método, e o ESLint não tem como saber sobre qual
tipo ele está sendo chamado.
**Decisão.** `Money.toString()` usa `Decimal.prototype.toFixed(2)`, com um
`eslint-disable-next-line no-restricted-syntax` local e comentado. É o único
`eslint-disable` do repositório.
**Justificativa.** O `toFixed` proibido pelo enunciado é o do `Number`, que
formata um binário de ponto flutuante e arredonda de forma dependente de
representação. O do `Decimal` é aritmética decimal exata, e é a única forma de
preservar o zero à direita — `new Decimal('100.50').toString()` devolve
`'100.5'`, que violaria a escala fixa de duas casas exigida pela coluna
`numeric(20,2)` e pela serialização na fronteira HTTP.
**Alternativa descartada.** Formatar à mão, dividindo a string no ponto e
completando com `padEnd`. Elimina o `disable` e é igualmente exata, já que
`Money.from` garante no máximo duas casas — mas reimplementa mal o que a
biblioteca já faz, e troca uma exceção explícita e justificada por código que
parece desconhecer a ferramenta.
**Verificação.** A exceção foi confirmada removendo o comentário de `disable` e
observando a guarda acusar a linha, e recolocando-o em seguida. Um `disable` que
silencia uma regra que nunca dispararia é ruído; este silencia uma detecção real.