const protocol = "nsdeploy-actions-v1";
const peer = window.opener || (window.parent !== window ? window.parent : null);

if (!peer) {
  document.body.append("Open this page through an agent action.");
} else {
  let connected = false;
  const ready = () => {
    if (!connected) peer.postMessage({ protocol, type: "ready" }, "*");
  };
  const interval = setInterval(ready, 250);
  ready();
  window.addEventListener("pagehide", () => clearInterval(interval), { once: true });
  window.addEventListener("message", (event) => {
    if (
      connected ||
      event.source !== peer ||
      event.data?.protocol !== protocol ||
      event.data?.type !== "connect" ||
      event.ports?.length !== 1
    ) {
      return;
    }
    connected = true;
    clearInterval(interval);
    const port = event.ports[0];
    port.onmessage = ({ data }) => {
      const id = data?.id;
      if (!Number.isSafeInteger(id)) return;
      if (data.type === "catalog") {
        port.postMessage({ id, ok: true, value: [] });
        return;
      }
      port.postMessage({
        id,
        ok: false,
        error: "This static demo does not expose site actions to other origins.",
      });
    };
    port.start();
  });
}
