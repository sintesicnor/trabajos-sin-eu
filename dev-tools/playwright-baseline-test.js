// Drives the app in a real headless browser against the local emulator suite,
// clicking through every main tab and checking for console/page errors. Used as
// a repeatable regression check while refactoring index.html — never touches
// production (Firestore is emulator-backed on localhost, see index.html).
const { chromium } = require('playwright');

const APP_URL = process.argv[2] || 'http://127.0.0.1:5000';
const TABS = [
    { btn: 'tab-produccion', view: 'view-produccion', name: 'Producción' },
    { btn: 'tab-ofertas', view: 'view-ofertas', name: 'Ofertas' },
    { btn: 'tab-suministro', view: 'view-suministro', name: 'Suministro' },
    { btn: 'tab-dashboard', view: 'view-dashboard', name: 'Dashboard' },
    { btn: 'tab-configuracion', view: 'view-configuracion', name: 'Configuración' },
];

async function main() {
    const errors = [];
    const results = [];
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
    page.on('console', (msg) => {
        // Browser's generic wording for the expected first-run 400 above (no URL to match on here)
        if (msg.type() === 'error' && !msg.text().includes('status of 400')) {
            errors.push(`[console.error] ${msg.text()}`);
        }
    });
    page.on('requestfailed', (req) => errors.push(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText}`));
    page.on('response', (res) => {
        // signInWithPassword 400 on first run is expected: the demo account doesn't
        // exist yet on a fresh emulator, and the app's own code creates it right after.
        if (res.status() >= 400 && !res.url().includes('signInWithPassword')) {
            errors.push(`[http ${res.status()}] ${res.url()}`);
        }
    });

    console.log(`Navigating to ${APP_URL} ...`);
    await page.goto(APP_URL, { waitUntil: 'load', timeout: 30000 });

    // App auto-logs-in the local demo account; wait for the main app shell to appear.
    await page.waitForSelector('#app-main', { state: 'visible', timeout: 20000 })
        .then(() => results.push({ step: 'login/app-shell', pass: true }))
        .catch((e) => results.push({ step: 'login/app-shell', pass: false, detail: e.message }));

    await page.screenshot({ path: 'dev-tools/screenshots/01-initial-load.png' });

    for (const tab of TABS) {
        try {
            await page.click(`#${tab.btn}`, { timeout: 5000 });
            await page.waitForTimeout(1500); // allow async data loads to settle
            const isVisible = await page.evaluate((viewId) => {
                const el = document.getElementById(viewId);
                return el && getComputedStyle(el).display !== 'none';
            }, tab.view);
            results.push({ step: `tab:${tab.name}`, pass: !!isVisible });
            await page.screenshot({ path: `dev-tools/screenshots/tab-${tab.name}.png` });
        } catch (e) {
            results.push({ step: `tab:${tab.name}`, pass: false, detail: e.message });
        }
    }

    await browser.close();

    console.log('\n=== RESULTS ===');
    let allPass = true;
    for (const r of results) {
        console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.step}${r.detail ? ' :: ' + r.detail : ''}`);
        if (!r.pass) allPass = false;
    }

    console.log(`\n=== CONSOLE/PAGE ERRORS (${errors.length}) ===`);
    errors.slice(0, 30).forEach((e) => console.log(e));

    if (!allPass || errors.length > 0) {
        console.log('\nBASELINE: ISSUES FOUND');
        process.exit(1);
    } else {
        console.log('\nBASELINE: CLEAN');
        process.exit(0);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
