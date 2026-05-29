import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
    // Base JS rules
    js.configs.recommended,

    // TypeScript rules
    ...tseslint.configs.recommended,

    // Project-wide settings
    {
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            // React Hooks
            ...reactHooks.configs.recommended.rules,

            // Allow explicit `any` with a warning (many Tauri/xterm APIs need it)
            '@typescript-eslint/no-explicit-any': 'warn',

            // Unused vars: allow underscore-prefixed names (including catch variables)
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
            ],

            // Allow console.error / console.warn, flag console.log
            'no-console': ['warn', { allow: ['error', 'warn'] }],

            // Non-null assertion is common with Tauri refs — warn only
            '@typescript-eslint/no-non-null-assertion': 'warn',

            // Empty functions are common for cleanup callbacks
            '@typescript-eslint/no-empty-function': 'off',

            // react-hooks v7 new strict rules — disabled due to false positives
            // (loading data in effects, resetting state on prop change, xterm refs,
            //  and ref mutations inside pointer-event callbacks)
            'react-hooks/set-state-in-effect': 'off',
            'react-hooks/purity': 'off',
            'react-hooks/refs': 'off',
            'react-hooks/immutability': 'off',
        },
    },

    // Prettier must be last to disable any formatting rules
    prettierConfig,

    // Ignore build output and Rust workspace
    {
        ignores: ['dist/', 'src-tauri/', 'node_modules/'],
    },
);
