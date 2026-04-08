import { Server } from "@colyseus/core";
import { createServer } from "http";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BattleRoom } from "./rooms/BattleRoom.js";

const port = Number(process.env.PORT || 2567);
const server = createServer();

const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
  }),
});

gameServer.define("battle", BattleRoom);

gameServer.listen(port);
console.log(`Colyseus listening on ws://localhost:${port}`);
