import {request, paintWallet, showError} from "./ui.js";
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const data = await request();
    paintWallet(data);
    document.querySelector("#tracker").textContent = `${data.state.books.length} book${data.state.books.length === 1 ? "" : "s"} calibrated. ${data.trackerStatus}`;
    document.querySelector("#error").hidden = true;
  } catch (error) { showError(error); }
  finally { busy = false; }
}
refresh();
setInterval(refresh, 1000);
