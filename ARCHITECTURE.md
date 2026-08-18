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