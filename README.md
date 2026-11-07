# Quill Toll

A private Brave extension that trades new WritingHabit words for browsing time.

**1 new word earns 1 credit. 1 credit buys 1 minute.**

## Install in Brave

1. Extract this ZIP into a permanent folder on your computer.
2. Open `brave://extensions` in Brave.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted `quill-toll` folder containing `manifest.json`.
5. Open Brave’s extensions menu and pin **Quill Toll**.
6. Click the Quill Toll icon, then **Settings**. Enter your distractions, one domain per line, and save. The list starts empty.
7. Open a chapter in each WritingHabit book you want tracked. Show the **Overall** card with **Total** visible. Keep the page focused until Quill Toll reads it, then check Settings for its starting total.

There is no build step or web-store account. Keep the extracted folder in place. After replacing these files for an update, use **Reload** on the extension card and reload any open WritingHabit chapters. Reloading the extension preserves its saved records.

## Earning credits

Each book is identified by the project ID in its WritingHabit URL. Chapters in the same book share that record.

The first observed total calibrates the book and awards zero credits. A manuscript with 100,000 existing words therefore starts with zero credits. Once that book reaches 100,020, you earn 20 credits. If you delete 10 words and restore them, you still have earned 20. Reaching 100,021 earns the next credit.

The highest recorded total is stored independently for every book. Credits from all books go into one wallet. Older tabs cannot lower a book’s record or award its words again.

Writing on your phone earns credits after that book has been calibrated on desktop. Reopen its chapter on desktop and let WritingHabit synchronize. If the Overall count is stale, reload the chapter. Quill Toll awards the increase once the updated counter appears. Words written before a book’s first desktop calibration become part of its starting total.

The extension reads the labeled `Total project words` element when you focus a WritingHabit chapter and every 30 seconds while the page stays focused. It samples the live total even as you type. A newly displayed book has a brief settling period and requires matching navigation and a fresh counter to avoid attributing a previous book’s total to it. If two books have the same count and WritingHabit reuses the same counter element, reload the new chapter to complete calibration.

WritingHabit itself can update this card in batches. Its displayed total controls when credits appear. If WritingHabit changes its markup or stops displaying this card, Settings shows a tracker message and the last recorded high-water marks stay saved.

## Spending credits

- Listed domains and their subdomains pay the toll. Pasting a full URL uses its hostname and includes the whole site. A leading `www.` is removed.
- Only the active tab in the focused Brave window spends credits. Other tabs, other applications, minimized windows, and a locked computer pause the timer.
- Reading and watching videos in the focused tab still count, even without keyboard or mouse input.
- Time is charged continuously at 1/60 credit per second. Partial minutes persist through tab switches and normal restarts.
- The icon and badge turn amber while spending. The green quill is the default paused icon.
- The badge rounds upward and abbreviates large balances. Hover for the fuller balance or open the popup for two decimal places and remaining time.
- At zero, network navigation to listed sites redirects to the out-of-credits page. Any already-open listed tabs are replaced with that page too. Navigation listeners also cover same-tab routing and cached-page navigation.
- Earning more credits unlocks navigation again. Reopen the site manually. Quill Toll leaves the blocked page in place so your writing can keep your attention.
- Editing the block list takes effect immediately. WritingHabit and its parent domains cannot be added to the list.

The timer checkpoints about every five seconds while spending and at relevant tab, focus, and lock events. Browser or extension crashes can leave up to roughly five seconds of usage uncharged. Long process-suspension gaps are skipped. Browser scheduling can delay enforcement slightly.

## Quick check after installation

1. Add a site such as `example.com`. With zero credits, confirm it opens the “You’re out of credits” page.
2. Open your WritingHabit chapter and confirm Settings shows its existing word count as the starting total with zero credits earned.
3. Add a word and wait until WritingHabit’s **Overall Total** increases. Keep the page focused for up to 30 seconds, then confirm Quill Toll gains one credit.
4. Open your listed site. Confirm the icon turns amber. Switch to an unlisted tab, then check that spending pauses.
5. Spend the remaining minute. Confirm the listed page is replaced and the balance stays at zero.
6. Delete and rewrite that word. Confirm there is no additional credit until the book exceeds its previous highest total.
7. Open another book and confirm it calibrates independently. To check phone writing, first calibrate a book on desktop, write on your phone, then reload the desktop chapter.

You can verify steps 1–5 with `example.com` before adding your regular distractions. Remove it from the list afterward if desired.

## Privacy, permissions, and saved data

All records remain in `chrome.storage.local` in this browser profile. Quill Toll makes no network requests and has no analytics. It reads the overall word count, book ID, and page title. It does not collect chapter prose.

Brave will request access to websites. Host access and declarative network rules allow your editable list to block navigation. Tab and navigation access let the extension recognize listed foreground tabs and replace them at zero. Idle access detects computer locks. Alarms maintain a fallback heartbeat, and storage preserves the wallet and book records. The content script is injected only on `https://studio.writinghabit.app/`.

Your balance is specific to this Brave profile. Phone writing synchronizes through WritingHabit’s displayed total. The extension’s wallet does not synchronize between computers or profiles. Uninstalling the extension or deleting its data clears its wallet and calibration records. It runs in ordinary browser windows. Private windows are excluded.

## Verification and development

The reader was checked against a saved WritingHabit chapter. The distribution includes synthetic test fixtures.

The regression checks exercise accounting, independent book calibration, live focused-page polling, stale observations, domain matching, background event handling, exhaustion, locking, persistence, and DOM parsing. Worker checks use a deterministic Chrome API double, and HTML checks use linkedom with simulated layout visibility.

Full Chromium smoke testing was blocked in the build environment because creating its local process socket was denied. The extension still needs the short Brave check above on your computer. A real-browser smoke test is also included for development.

To run the automated checks with Node.js 20 or later, from this folder run

```sh
npm install
npm test
```

For the optional real-browser smoke test, run

```sh
npx playwright install chromium
npm run test:browser
```

This uses a temporary browser profile and a fabricated WritingHabit page. It checks extension startup, real dynamic rule installation, HTML calibration, earning a credit, and normal page blocking. To select an existing compatible Chromium binary, set `CHROMIUM_PATH` to its absolute path. The test is headless by default. Use `HEADED=1` for a visible browser when a display server is available.

## Technical references

- [Brave extension support](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave)
- [Loading an unpacked Chromium extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
- [Declarative network rules](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Extension alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)
