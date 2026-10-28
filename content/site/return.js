(() => {
  // content/sites/return.js
  (async () => {
    if (window.top !== window || document.getElementById("kivori-sekai-return")) return;
    const reply = await chrome.runtime.sendMessage({ type: "returnCheck" }).catch(() => null);
    if (!reply?.ok || !reply.show) return;
    const host = document.createElement("div");
    host.id = "kivori-sekai-return";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
    .card { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 320px; padding: 16px 16px 14px; border-radius: 16px;
      background: #1c1714; color: #f7efe9; border: 1px solid #342a25; box-shadow: 0 18px 50px rgba(0,0,0,.45);
      font: 14px/1.45 "Segoe UI", system-ui, sans-serif; animation: rise .3s cubic-bezier(.2,.8,.2,1) both; }
    @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
    .top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #ff7a2f; box-shadow: 0 0 0 4px rgba(255,122,47,.18); }
    .dot.ready { background: #3ecf8e; box-shadow: 0 0 0 4px rgba(62,207,142,.18); }
    b { flex: 1; font-size: 14px; }
    p { margin: 0 0 12px; color: #ab9a8f; font-size: 13px; }
    button { font: inherit; cursor: pointer; }
    .back { width: 100%; height: 38px; border: 0; border-radius: 10px; background: #ff7a2f; color: #1a0d05; font-weight: 700; }
    .back:hover { filter: brightness(1.08); }
    .close { width: 26px; height: 26px; border: 0; border-radius: 8px; background: transparent; color: #ab9a8f; font-size: 18px; line-height: 1; }
    .close:hover { background: #271f1b; color: #f7efe9; }`;
    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Kivori SekAI");
    const top = document.createElement("div");
    top.className = "top";
    const dot = document.createElement("span");
    dot.className = "dot";
    const title = document.createElement("b");
    title.textContent = `${reply.name} is connected`;
    const close = document.createElement("button");
    close.className = "close";
    close.setAttribute("aria-label", "Hide");
    close.textContent = "\xD7";
    const note = document.createElement("p");
    note.textContent = reply.note;
    const back = document.createElement("button");
    back.className = "back";
    back.textContent = "Back to Kivori SekAI";
    top.append(dot, title, close);
    card.append(top, note, back);
    root.append(style, card);
    document.documentElement.append(host);
    function paintReady(next) {
      const ready = Boolean(next?.ready);
      note.textContent = next?.note || reply.note;
      dot.classList.toggle("ready", ready);
      title.textContent = ready ? `${reply.name} is ready` : `${reply.name} is connected`;
    }
    paintReady(reply);
    const poll = window.setInterval(async () => {
      if (!document.documentElement.contains(host)) {
        window.clearInterval(poll);
        return;
      }
      const next = await chrome.runtime.sendMessage({ type: "returnCheck" }).catch(() => null);
      if (!next?.ok || !next.show) {
        window.clearInterval(poll);
        host.remove();
        return;
      }
      paintReady(next);
      if (next.ready) window.clearInterval(poll);
    }, 1500);
    close.addEventListener("click", () => {
      window.clearInterval(poll);
      host.remove();
      chrome.runtime.sendMessage({ type: "returnDismiss" }).catch(() => {
      });
    });
    back.addEventListener("click", () => {
      window.clearInterval(poll);
      host.remove();
      chrome.runtime.sendMessage({ type: "returnBack" }).catch(() => {
      });
    });
  })();
})();
