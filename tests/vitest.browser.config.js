import { defineConfig } from 'vitest/config';

// A path in the forward slashes Vite matches aliases by, decoded from its URL so a space in the checkout path resolves.
const resolved = path => decodeURIComponent(new URL(path, import.meta.url).pathname);

// The tests that need a real browser's layout, run in headless Chromium; `npm run test:browser` runs them.
export default defineConfig({
    resolve: {
        alias: [
            { find: '#domql/', replacement: resolved('../src/') },
        ],
    },
    test: {
        include: ['**/*.browser.js'],
        browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
        },
    },
});
