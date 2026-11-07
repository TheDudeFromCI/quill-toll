import {request, paintWallet, showError} from "./ui.js";
let initialized = false;
let busy = false;

function render(data) {
  paintWallet(data);
  if (!initialized) {
    document.querySelector("#domains").value = data.state.domains.join("\n");
    initialized = true;
  }
  const lastSeen = data.trackerSeenAt ? ` Last checked ${new Date(data.trackerSeenAt).toLocaleTimeString()}.` : "";
  document.querySelector("#tracker").textContent = data.trackerStatus + lastSeen;
  const rows = data.state.books.map(book => {
    const row = document.createElement("tr");
    for (const value of [book.name, book.baseline.toLocaleString(), book.highWater.toLocaleString(), book.earned.toLocaleString()]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    row.title = `Book ID ${book.id}. Last total ${book.lastTotal.toLocaleString()}. Seen ${new Date(book.lastSeen).toLocaleString()}.`;
    return row;
  });
  document.querySelector("#books").replaceChildren(...rows);
  document.querySelector("#empty").hidden = rows.length > 0;
}

document.querySelector("#sites-form").addEventListener("submit", async event => {
  event.preventDefault();
  document.querySelector("#save").disabled = true;
  document.querySelector("#saved").textContent = "";
  try {
    const data = await request({type: "saveDomains", text: document.querySelector("#domains").value});
    document.querySelector("#domains").value = data.state.domains.join("\n");
    render(data);
    document.querySelector("#error").hidden = true;
    document.querySelector("#saved").textContent = "Saved. Your block list is active.";
  } catch (error) { showError(error); }
  finally { document.querySelector("#save").disabled = false; }
});

async function refresh() {
  if (busy) return;
  busy = true;
  try { render(await request()); }
  catch (error) { showError(error); }
  finally { busy = false; }
}
refresh();
setInterval(refresh, 3000);
