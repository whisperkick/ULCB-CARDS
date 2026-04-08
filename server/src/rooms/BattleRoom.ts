import { Client, Room } from "colyseus";
import { BattleState, CardSchema, PlayerSchema } from "../schema/BattleState.js";

type CardDefinition = {
  id: string;
  cost: number;
  value: number;
};

type PlayCardPayload = {
  cardId: string;
  targetId: string;
};

const TICK_MS = 100;
const MANA_REGEN_PER_SECOND = 1;
const MIN_DECK_SIZE = 10;
const HAND_SIZE = 5;

const CARD_LIBRARY: CardDefinition[] = [
  { id: "strike", cost: 2, value: 8 },
  { id: "flame_bolt", cost: 3, value: 12 },
  { id: "quick_stab", cost: 1, value: 5 },
  { id: "heavy_slash", cost: 4, value: 16 },
  { id: "arcane_shot", cost: 2, value: 9 }
];

const cardById = new Map<string, CardDefinition>(CARD_LIBRARY.map((card) => [card.id, card]));

export class BattleRoom extends Room<BattleState> {
  private lastUpdateAt = Date.now();
  private monsterAttackAccumulatorMs = 0;
  private manaAccumulatorMs = 0;
  private deckStateByPlayerId = new Map<
    string,
    {
      drawPile: string[];
      discardPile: string[];
    }
  >();
  private deckStateSnapshotByPlayerId = new Map<
    string,
    {
      drawPileCount: number;
      discardPileCount: number;
    }
  >();

  onCreate() {
    this.setState(new BattleState());
    this.createSingleMonsterEncounter();
    this.onMessage("playCard", (client, payload: PlayCardPayload) => {
      this.handlePlayCard(client, payload);
    });
    this.setSimulationInterval(() => this.onUpdate(), TICK_MS);
  }

  onJoin(client: Client) {
    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.name = `Hero-${client.sessionId.slice(0, 4)}`;
    player.hp = 100;
    player.maxHp = 100;
    player.maxMana = 10;
    player.mana = 5;
    this.state.players.set(client.sessionId, player);

    const drawPile = this.createInitialDeckIds();
    this.shuffleInPlace(drawPile);
    this.deckStateByPlayerId.set(client.sessionId, {
      drawPile,
      discardPile: []
    });
    this.deckStateSnapshotByPlayerId.set(client.sessionId, {
      drawPileCount: drawPile.length,
      discardPileCount: 0
    });
    this.drawUpToHandSize(player.id);
    this.sendDeckState(client.sessionId);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.deckStateByPlayerId.delete(client.sessionId);
    this.deckStateSnapshotByPlayerId.delete(client.sessionId);
  }

  private onUpdate() {
    const now = Date.now();
    const dt = Math.max(0, now - this.lastUpdateAt);
    this.lastUpdateAt = now;

    this.updateManaRegen(dt);
    this.updateMonsterAttacks(dt);
  }

  private updateManaRegen(dtMs: number) {
    this.manaAccumulatorMs += dtMs;
    const manaTicks = Math.floor(this.manaAccumulatorMs / 1000);
    if (manaTicks <= 0) {
      return;
    }
    this.manaAccumulatorMs -= manaTicks * 1000;
    this.state.players.forEach((player) => {
      player.mana = Math.min(player.maxMana, player.mana + manaTicks * MANA_REGEN_PER_SECOND);
    });
  }

  private updateMonsterAttacks(dtMs: number) {
    this.monsterAttackAccumulatorMs += dtMs;
    const interval = this.state.monster.attackIntervalMs;
    while (this.monsterAttackAccumulatorMs >= interval) {
      this.monsterAttackAccumulatorMs -= interval;
      this.resolveMonsterAutoAttack();
    }
  }

  private resolveMonsterAutoAttack() {
    const monster = this.state.monster;
    if (monster.hp <= 0) {
      return;
    }
    const player = this.getFirstLivingPlayer();
    if (!player) {
      return;
    }
    player.hp = Math.max(0, player.hp - monster.attackDamage);
    this.broadcast("combatEvent", {
      type: "monsterAttack",
      sourceId: monster.id,
      targetId: player.id,
      value: monster.attackDamage
    });
  }

  private handlePlayCard(client: Client, payload: PlayCardPayload) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0) {
      return;
    }
    const target = this.state.monster;
    if (payload.targetId !== target.id || target.hp <= 0) {
      return;
    }
    const handIndex = player.hand.indexOf(payload.cardId);
    if (handIndex === -1) {
      return;
    }
    const definition = cardById.get(payload.cardId);
    if (!definition) {
      return;
    }
    if (player.mana < definition.cost) {
      this.send(client, "error", { code: "NOT_ENOUGH_MANA", cardId: definition.id });
      return;
    }

    player.mana -= definition.cost;
    target.hp = Math.max(0, target.hp - definition.value);

    // Move from hand to discard and draw replacement.
    player.hand.splice(handIndex, 1);
    const deckState = this.deckStateByPlayerId.get(player.id);
    if (!deckState) {
      return;
    }
    deckState.discardPile.push(definition.id);
    this.drawCards(player.id, 1);

    this.broadcast("combatEvent", {
      type: "playerCardPlayed",
      sourceId: player.id,
      targetId: target.id,
      cardId: definition.id,
      value: definition.value
    });
    this.sendDeckState(client.sessionId);
  }

  private drawUpToHandSize(playerId: string) {
    const player = this.state.players.get(playerId);
    if (!player) {
      return;
    }
    while (player.hand.length < HAND_SIZE) {
      if (!this.tryDrawOneCard(playerId)) {
        break;
      }
    }
  }

  private drawCards(playerId: string, count: number) {
    for (let i = 0; i < count; i += 1) {
      if (!this.tryDrawOneCard(playerId)) {
        break;
      }
    }
  }

  private tryDrawOneCard(playerId: string): boolean {
    const player = this.state.players.get(playerId);
    const deckState = this.deckStateByPlayerId.get(playerId);
    if (!player || !deckState) {
      return false;
    }

    if (deckState.drawPile.length === 0) {
      if (deckState.discardPile.length === 0) {
        return false;
      }
      deckState.drawPile = this.shuffle(deckState.discardPile);
      deckState.discardPile = [];
    }
    const drawn = deckState.drawPile.shift();
    if (!drawn) {
      return false;
    }
    player.hand.push(drawn);
    return true;
  }

  private sendDeckState(playerId: string) {
    const client = this.clients.find((value) => value.sessionId === playerId);
    const deckState = this.deckStateByPlayerId.get(playerId);
    if (!client || !deckState) {
      return;
    }
    const snapshot = {
      drawPileCount: deckState.drawPile.length,
      discardPileCount: deckState.discardPile.length
    };
    const previous = this.deckStateSnapshotByPlayerId.get(playerId);
    if (
      previous &&
      previous.drawPileCount === snapshot.drawPileCount &&
      previous.discardPileCount === snapshot.discardPileCount
    ) {
      return;
    }
    this.deckStateSnapshotByPlayerId.set(playerId, snapshot);
    this.send(client, "deckState", snapshot);
  }

  private createInitialDeckIds(): string[] {
    const deck: string[] = [];
    let idx = 0;
    while (deck.length < MIN_DECK_SIZE) {
      const card = CARD_LIBRARY[idx % CARD_LIBRARY.length];
      deck.push(card.id);
      idx += 1;
    }
    return deck;
  }

  private shuffleInPlace(values: string[]) {
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
  }

  private createSingleMonsterEncounter() {
    this.state.monster.id = "monster_1";
    this.state.monster.name = "Forest Wraith";
    this.state.monster.hp = 120;
    this.state.monster.maxHp = 120;
    this.state.monster.attackDamage = 7;
    this.state.monster.attackIntervalMs = 3000;

    CARD_LIBRARY.forEach((card) => {
      const cardSchema = new CardSchema();
      cardSchema.id = card.id;
      cardSchema.name = card.id;
      cardSchema.cost = card.cost;
      cardSchema.value = card.value;
      this.state.cardLibrary.set(card.id, cardSchema);
    });
  }

  private getFirstLivingPlayer() {
    const players = [...this.state.players.values()];
    return players.find((player) => player.hp > 0);
  }

  private shuffle(items: string[]) {
    const copy = [...items];
    this.shuffleInPlace(copy);
    return copy;
  }
}
