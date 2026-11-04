// MAIN world, document_start: HIDIVE/Netflix/etc. bind player shortcuts on window/document.
// Our panel is in an open Shadow DOM, so event.target retargets to the host and their
// "ignore inputs" checks fail — Space/K/arrows pause or seek while typing in search.
// Wrap page key listeners so they skip events that originated inside our panel.
(() => {
  if (window.__ksKeyGuard) return;
  window.__ksKeyGuard = true;

  const PANEL_IDS = new Set(["ks-site-panel", "cr-corner-host", "crunchilist-tabbar", "ks-watch-guide"]);

  function fromPanel(event) {
    try {
      return event.composedPath().some((node) => node && PANEL_IDS.has(node.id));
    } catch {
      return false;
    }
  }

  const wrapped = new WeakMap();

  function wrap(listener) {
    if (!listener) return listener;
    const cached = wrapped.get(listener);
    if (cached) return cached;
    if (typeof listener === "function") {
      const next = function ksKeyGuard(event) {
        if (fromPanel(event)) return;
        return listener.call(this, event);
      };
      wrapped.set(listener, next);
      return next;
    }
    if (typeof listener === "object" && typeof listener.handleEvent === "function") {
      const next = {
        handleEvent(event) {
          if (fromPanel(event)) return;
          return listener.handleEvent(event);
        },
      };
      wrapped.set(listener, next);
      return next;
    }
    return listener;
  }

  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;

  proto.addEventListener = function (type, listener, options) {
    if (type === "keydown" || type === "keyup" || type === "keypress") {
      return add.call(this, type, wrap(listener), options);
    }
    return add.call(this, type, listener, options);
  };

  proto.removeEventListener = function (type, listener, options) {
    if (type === "keydown" || type === "keyup" || type === "keypress") {
      return remove.call(this, type, wrapped.get(listener) || listener, options);
    }
    return remove.call(this, type, listener, options);
  };
})();
