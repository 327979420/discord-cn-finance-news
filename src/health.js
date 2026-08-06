import http from "node:http";

export function startHealthServer(port, state, store) {
  const server = http.createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/") {
      response.writeHead(state.lastCycleOk === false ? 503 : 200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: state.lastCycleOk === false ? "degraded" : "ok", ...state, store: store.stats() }, null, 2));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(port);
  return server;
}
