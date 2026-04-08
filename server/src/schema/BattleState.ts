import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

export class CardSchema extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") cost = 0;
  @type("number") value = 0;
}

export class PlayerSchema extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") hp = 100;
  @type("number") maxHp = 100;
  @type("number") mana = 0;
  @type("number") maxMana = 10;

  // Only the playable hand is synced to clients.
  @type(["string"]) hand = new ArraySchema<string>();
}

export class MonsterSchema extends Schema {
  @type("string") id = "monster_1";
  @type("string") name = "Forest Wraith";
  @type("number") hp = 120;
  @type("number") maxHp = 120;
  @type("number") attackDamage = 7;
  @type("number") attackIntervalMs = 3000;
}

export class BattleState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: MonsterSchema }) monsters = new MapSchema<MonsterSchema>();
  @type({ map: CardSchema }) cardLibrary = new MapSchema<CardSchema>();
}
