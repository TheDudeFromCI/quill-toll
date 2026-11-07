/* Optional real-Chromium smoke test. Never contacts the real WritingHabit service. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

(async () => {
  const extension = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'quill-toll-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: process.env.CHROMIUM_PATH ? undefined : 'chromium',
      executablePath: process.env.CHROMIUM_PATH,
      headless: process.env.HEADED !== '1',
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    await context.route('https://studio.writinghabit.app/**', route => route.fulfill({
      contentType: 'text/html',
      body: `<html><head><title>WritingHabit | Smoke test</title></head><body>
        <a class="MuiButton-root" href="https://studio.writinghabit.app/write/testBook/chapterA">Write</a>
        <div>Overall</div><div aria-label="Total project words"><div>Total</div><div id="total">185,176</div></div>
        </body></html>`
    }));
    await context.route('https://example.com/**', route => route.fulfill({contentType: 'text/html', body: '<h1>Test distraction</h1>'}));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const origin = worker.url().split('/').slice(0, 3).join('/');
    const options = await context.newPage();
    await options.goto(`${origin}/options.html`);
    await options.locator('#domains').fill('example.com');
    await options.locator('#save').click();
    await options.locator('#saved').filter({hasText: 'Saved.'}).waitFor();
    const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    assert.equal(rules.length, 1);
    const distraction = await context.newPage();
    await distraction.goto('https://example.com/').catch(error => {
      if (!error.message.includes('ERR_ABORTED')) throw error;
    });
    await distraction.waitForURL(`${origin}/blocked.html`);
    assert.match(await distraction.locator('h1').innerText(), /out of credits/);
    const writing = await context.newPage();
    await writing.goto('https://studio.writinghabit.app/write/testBook/chapterA');
    await writing.bringToFront();
    await options.waitForFunction(() => document.querySelector('#books').textContent.includes('185,176'));
    const calibrated = await options.evaluate(() => chrome.runtime.sendMessage({type: 'getState'}));
    assert.equal(calibrated.state.balanceMs, 0);
    await writing.locator('#total').evaluate(element => { element.textContent = '185,177'; });
    await options.waitForFunction(async () => (await chrome.runtime.sendMessage({type: 'getState'})).state.earned === 1, undefined, {polling: 250, timeout: 45_000});
    const earned = await options.evaluate(() => chrome.runtime.sendMessage({type: 'getState'}));
    assert.equal(earned.state.balanceMs, 60000);
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 0);
    await distraction.goto('https://example.com/');
    await distraction.bringToFront();
    await options.waitForFunction(async () => (await chrome.runtime.sendMessage({type: 'getState'})).spending);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const spending = await options.evaluate(() => chrome.runtime.sendMessage({type: 'getState'}));
    assert.ok(spending.state.balanceMs < 60000);
    await writing.bringToFront();
    await options.waitForFunction(async () => !(await chrome.runtime.sendMessage({type: 'getState'})).spending);
    await writing.locator('#total').evaluate(element => { element.textContent = '185,176'; });
    await options.bringToFront();
    await writing.bringToFront();
    await options.waitForFunction(async () => (await chrome.runtime.sendMessage({type: 'getState'})).state.books[0].lastTotal === 185176);
    await writing.locator('#total').evaluate(element => { element.textContent = '185,177'; });
    await options.bringToFront();
    await writing.bringToFront();
    await options.waitForFunction(async () => (await chrome.runtime.sendMessage({type: 'getState'})).state.books[0].lastTotal === 185177);
    assert.equal((await options.evaluate(() => chrome.runtime.sendMessage({type: 'getState'}))).state.earned, 1);
    console.log('Passed Chromium smoke test.');
  } finally {
    if (context) await context.close();
    await fs.rm(profile, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
