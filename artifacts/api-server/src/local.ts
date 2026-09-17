import { createLocalApp } from "./localApp.ts";

const port = Number(process.env.PORT || 3001);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Puerto local inválido: ${process.env.PORT}`);
}

createLocalApp().listen(port, "0.0.0.0", () => {
  console.log(`API local lista en http://localhost:${port}`);
});
