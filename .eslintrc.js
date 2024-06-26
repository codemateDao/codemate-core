module.exports = {
    root: true,
    extends: ['@hydrooj/eslint-config', 'plugin:prettier/recommended'],
    ignorePatterns: ['public/**/*.js', 'packages/ui-default'],
    overrides: [
        {
            files: ['**/{public,frontend}/**/*.{ts,tsx,page.js}'],
            rules: {
                'github/array-foreach': 0,
                '@typescript-eslint/indent': ['warn', 2],
                '@typescript-eslint/no-invalid-this': 0,
            },
            env: {
                browser: true,
                es6: true,
                jquery: true,
            },
            globals: {
                UiContext: true,
                UserContext: true,
                externalModules: true,
                LOCALES: true,
                LANGS: true,
            },
        },
    ],
    rules: {
        '@typescript-eslint/no-invalid-this': 1,
        'simple-import-sort/imports': [
            'warn',
            {
                groups: [
                    ['^\\u0000'],
                    [],
                    [
                        '^(assert|buffer|child_process|cluster|console|constants|crypto|dgram|dns|domain|events|fs|http|https|module|net|os|path|punycode|querystring|readline|repl|stream|string_decoder|sys|timers|tls|tty|url|util|vm|zlib|freelist|v8|process|async_hooks|http2|perf_hooks)(/.*|$)',
                        '^(?!@?hydrooj)(@?\\w.+)',
                        '^@?hydrooj',
                        '^',
                        '^\\.',
                    ],
                ],
            },
        ],
        'no-console': ['error', { allow: ['error', 'warn', 'debug'] }],
        'template-tag-spacing': 'off',
        '@typescript-eslint/indent': 'off',
    },
    settings: {
        'import/parsers': {
            '@typescript-eslint/parser': ['.ts', '.js', '.jsx'],
        },
        'import/resolver': {
            typescript: {
                alwaysTryTypes: true,
            },
        },
    },
    parserOptions: {
        sourceType: 'module',
        project: ['./tsconfig.json', './packages/**/tsconfig.json'],
    },
};
