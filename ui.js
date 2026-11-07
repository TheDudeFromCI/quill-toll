export async function request(message = {type: "getState"}) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Quill Toll did not respond. Reload the extension and this page.");
  return response;
}

export function paintWallet(data) {
  document.querySelector("#balance").textContent = (data.state.balanceMs / 60_000).toLocaleString(undefined, {maximumFractionDigits: 2});
  document.querySelector("#wallet").classList.toggle("burning", data.spending);
  document.querySelector("#mode").textContent = data.spending ? "Spending" : "Paused";
  const seconds = Math.ceil(data.state.balanceMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  document.querySelector("#time").textContent = `${hours.toLocaleString()}h ${minutes}m ${seconds % 60}s of browsing available`;
}

export function showError(error) {
  const element = document.querySelector("#error");
  element.textContent = error.message || String(error);
  element.hidden = false;
}
