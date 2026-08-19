import { readdir } from 'node:fs/promises';

const MIGRATIONS_DIR = 'src/infrastructure/database/migrations';

/**
 * Exige que o tipo esteja em posição de definição de coluna, para não acusar a
 * palavra "real" em comentário — que numa base brasileira aparece o tempo todo.
 */
const FORBIDDEN =
  /\b(double\s+precision|float4|float8|real)\b(?=\s*(,|\)|not\s+null|null|default|check|;|$))/gim;

const withoutComments = (source: string): string =>
  source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const files = await readdir(MIGRATIONS_DIR);
const offences: string[] = [];

for (const file of files.filter((name) => name.endsWith('.ts'))) {
  const path = `${MIGRATIONS_DIR}/${file}`;
  const source = withoutComments(await Bun.file(path).text());

  for (const match of source.matchAll(FORBIDDEN)) {
    const line = source.slice(0, match.index).split('\n').length;

    offences.push(`${path}:${line} usa "${match[1]}"`);
  }
}

if (offences.length > 0) {
  console.error(
    'Ponto flutuante em migration é falha eliminatória (seção 14). Ocorrências:',
  );
  offences.forEach((offence) => console.error(`  ${offence}`));
  process.exit(1);
}

console.log(`nenhum tipo de ponto flutuante em ${files.length} migrations`);