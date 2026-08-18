// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
    
  }, 
     
  {
      files: ['src/domain/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "CallExpression[callee.name='Number']",
            message:
              'Conversão para number é proibida no domínio: dinheiro é Money sobre Decimal e trafega como string.',
          },
          {
            selector: "CallExpression[callee.name=/^parse(Float|Int)$/]",
            message:
              'parseFloat/parseInt são proibidos no domínio: introduzem ponto flutuante e truncam silenciosamente.',
          },
          {
            selector:
              "MemberExpression[object.name='Number'][property.name=/^parse(Float|Int)$/]",
            message:
              'Number.parseFloat/parseInt são proibidos no domínio pelo mesmo motivo que suas versões globais.',
          },
          {
            selector: "CallExpression[callee.property.name='toFixed']",
            message:
              'toFixed é proibido no domínio: formata ponto flutuante e arredonda de forma não determinística. Use Money.toString().',
          },
          {
            selector: "UnaryExpression[operator='+'][argument.type!='Literal']",
            message:
              'Coerção numérica com + unário é proibida no domínio: é a forma mais silenciosa de transformar dinheiro em float.',
          },
        ],
      },
  },
  
);
