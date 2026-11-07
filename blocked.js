document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
async function refresh() {
  try {
    const data = await chrome.runtime.sendMessage({type: "getState"});
    if (!data?.ok) return;
    if (data.state.balanceMs > 0) {
      document.querySelector("h1").textContent = "The gate is open.";
      document.querySelector("#explanation").textContent = `You have ${(data.state.balanceMs / 60_000).toLocaleString(undefined, {maximumFractionDigits: 2})} credits. Open the site again whenever you’re ready.`;
    } else {
      document.querySelector("h1").textContent = "You’re out of credits.";
      document.querySelector("#explanation").textContent = "Your next sentence can open the gate. Add words to a WritingHabit book to earn more browsing time.";
    }
  } catch { /* The extension may have been reloaded. */ }
}
refresh();
setInterval(refresh, 5000);
