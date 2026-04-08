import Phaser from "phaser";
import { Client, Room } from "colyseus.js";

type CardDef = {
  id: string;
  cost: number;
  value: number;
};

type PlayerLike = {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  hand: string[];
  onChange: (cb: () => void) => void;
};

type MonsterLike = {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  attackDamage: number;
  attackIntervalMs: number;
  onChange: (cb: () => void) => void;
};

type DeckStateMessage = {
  drawPileCount: number;
  discardPileCount: number;
};

type CombatEventMessage = {
  type: "monsterAttack" | "playerCardPlayed" | "playerCardDiscarded";
  sourceId: string;
  targetId: string;
  cardId?: string;
  value: number;
};

type MonsterSnapshot = {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
};

class BattleUIManager {
  private scene: Phaser.Scene;
  private playerText: Phaser.GameObjects.Text;
  private monsterText: Phaser.GameObjects.Text;
  private manaText: Phaser.GameObjects.Text;
  private manaBarBg: Phaser.GameObjects.Rectangle;
  private manaBarFill: Phaser.GameObjects.Rectangle;
  private deckText: Phaser.GameObjects.Text;
  private statusText: Phaser.GameObjects.Text;
  private handButtons: Phaser.GameObjects.Container[] = [];
  private readonly onCardSelected: (cardId: string) => void;
  private readonly onCardDiscarded: (cardId: string) => void;
  private readonly onMonsterSelected: (monsterId: string) => void;
  private monsterButtons: Phaser.GameObjects.Container[] = [];

  constructor(
    scene: Phaser.Scene,
    onCardSelected: (cardId: string) => void,
    onCardDiscarded: (cardId: string) => void,
    onMonsterSelected: (monsterId: string) => void
  ) {
    this.scene = scene;
    this.onCardSelected = onCardSelected;
    this.onCardDiscarded = onCardDiscarded;
    this.onMonsterSelected = onMonsterSelected;
    this.playerText = this.scene.add.text(120, 320, "Player HP: --", {
      color: "#ffffff",
      fontSize: "20px"
    });
    this.monsterText = this.scene.add.text(430, 320, "Target HP: --", {
      color: "#ffffff",
      fontSize: "20px"
    });
    this.manaText = this.scene.add.text(40, 30, "Mana: --/--", {
      color: "#7ee0ff",
      fontSize: "24px"
    });
    this.manaBarBg = this.scene.add.rectangle(250, 45, 220, 18, 0x1c2c42).setOrigin(0, 0.5);
    this.manaBarFill = this.scene.add.rectangle(250, 45, 220, 18, 0x3ca7ff).setOrigin(0, 0.5);
    this.deckText = this.scene.add.text(40, 62, "Deck: -- | Discard: --", {
      color: "#bdd8ff",
      fontSize: "16px"
    });
    this.statusText = this.scene.add.text(40, 90, "Connecting...", {
      color: "#cccccc",
      fontSize: "18px"
    });
  }

  setStatus(text: string): void {
    this.statusText.setText(text);
  }

  renderVitals(params: {
    playerHp: number;
    playerMaxHp: number;
    targetMonsterHp: number;
    targetMonsterMaxHp: number;
    playerMana: number;
    playerMaxMana: number;
  }): void {
    this.playerText.setText(`Player HP: ${params.playerHp}/${params.playerMaxHp}`);
    this.monsterText.setText(`Target HP: ${params.targetMonsterHp}/${params.targetMonsterMaxHp}`);
    this.manaText.setText(`Mana: ${params.playerMana}/${params.playerMaxMana}`);
    const ratio = params.playerMaxMana > 0 ? params.playerMana / params.playerMaxMana : 0;
    this.manaBarFill.width = 220 * Phaser.Math.Clamp(ratio, 0, 1);
  }

  renderDeckCounts(drawPileCount: number, discardPileCount: number): void {
    this.deckText.setText(`Deck: ${drawPileCount} | Discard: ${discardPileCount}`);
  }

  renderHand(handCardIds: string[], cardDefs: Record<string, CardDef>): void {
    for (const button of this.handButtons) {
      button.destroy();
    }
    this.handButtons = [];

    const startX = 110;
    const y = 450;
    const spacing = 130;

    handCardIds.forEach((cardId, index) => {
      const cardDef = cardDefs[cardId] ?? { id: cardId, cost: 0, value: 0 };

      const bg = this.scene.add.rectangle(0, 0, 120, 140, 0x2f2f3b);
      bg.setStrokeStyle(2, 0x6666aa);
      const label = this.scene.add.text(-48, -58, cardDef.id, {
        color: "#ffffff",
        fontSize: "14px",
        wordWrap: { width: 100 }
      });
      const stats = this.scene.add.text(-48, -4, `Cost: ${cardDef.cost}\nDmg: ${cardDef.value}`, {
        color: "#8be58b",
        fontSize: "16px"
      });
      const discardButton = this.scene.add.rectangle(0, 50, 96, 24, 0x5f3b57);
      discardButton.setStrokeStyle(1, 0xdca5cf);
      const discardLabel = this.scene.add.text(-30, 42, "Discard", {
        color: "#ffdff2",
        fontSize: "13px"
      });

      const container = this.scene.add.container(startX + spacing * index, y, [
        bg,
        label,
        stats,
        discardButton,
        discardLabel
      ]);
      container.setSize(120, 140);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-60, -70, 120, 140),
        Phaser.Geom.Rectangle.Contains
      );
      container.on("pointerdown", (_pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
        if (localY > 35) {
          this.onCardDiscarded(cardId);
          return;
        }
        this.onCardSelected(cardId);
      });
      container.on("pointerover", () => {
        this.scene.tweens.add({ targets: container, y: y - 10, duration: 100 });
      });
      container.on("pointerout", () => {
        this.scene.tweens.add({ targets: container, y, duration: 100 });
      });
      this.handButtons.push(container);
    });
  }

  renderMonsters(monsters: MonsterSnapshot[], selectedMonsterId: string | undefined): void {
    for (const button of this.monsterButtons) {
      button.destroy();
    }
    this.monsterButtons = [];

    const baseX = 430;
    const y = 170;
    const spacing = 170;

    monsters.forEach((monster, index) => {
      const isSelected = selectedMonsterId === monster.id;
      const bg = this.scene.add.rectangle(0, 0, 150, 110, isSelected ? 0x5b2f2f : 0x2b1f2f);
      bg.setStrokeStyle(2, isSelected ? 0xffd35c : 0x9a7d7d);
      const title = this.scene.add.text(-66, -42, monster.name, {
        color: "#fff1f1",
        fontSize: "14px",
        wordWrap: { width: 132 }
      });
      const hpText = this.scene.add.text(-66, 2, `HP: ${monster.hp}/${monster.maxHp}`, {
        color: "#ffd0d0",
        fontSize: "16px"
      });
      const pickText = this.scene.add.text(-66, 30, isSelected ? "Selected target" : "Click to target", {
        color: isSelected ? "#ffe89c" : "#c9b1b1",
        fontSize: "12px"
      });
      const container = this.scene.add.container(baseX + index * spacing, y, [bg, title, hpText, pickText]);
      container.setSize(150, 110);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-75, -55, 150, 110),
        Phaser.Geom.Rectangle.Contains
      );
      container.on("pointerdown", () => this.onMonsterSelected(monster.id));
      this.monsterButtons.push(container);
    });
  }
}

class BattleScene extends Phaser.Scene {
  private room?: Room;
  private playerId?: string;
  private handCardIds: string[] = [];
  private cardLibrary: Record<string, CardDef> = {};

  private playerHp = 0;
  private playerMaxHp = 0;
  private playerMana = 0;
  private playerMaxMana = 0;
  private monsters = new Map<string, MonsterSnapshot>();
  private drawPileCount = 0;
  private discardPileCount = 0;
  private selectedMonsterId?: string;

  private uiManager?: BattleUIManager;
  private monsterSprites = new Map<string, Phaser.GameObjects.Rectangle>();
  private playerSprite?: Phaser.GameObjects.Rectangle;

  constructor() {
    super("battle");
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#1b1b2f");
    this.playerSprite = this.add.rectangle(180, 240, 90, 120, 0x4e9fd1);
    this.uiManager = new BattleUIManager(
      this,
      (cardId) => this.tryPlayCard(cardId),
      (cardId) => this.tryDiscardCard(cardId),
      (monsterId) => this.selectMonster(monsterId)
    );

    this.connect().catch((error) => {
      this.uiManager?.setStatus(`Connection failed: ${String(error)}`);
    });
  }

  private async connect(): Promise<void> {
    const endpoint = import.meta.env.VITE_COLYSEUS_ENDPOINT ?? "ws://localhost:2567";
    const client = new Client(endpoint);
    this.room = await client.joinOrCreate("battle");
    this.playerId = this.room.sessionId;
    this.uiManager?.setStatus("Connected. Fight!");

    this.hydrateCardLibrary();
    this.room.state.monsters.forEach((monster: MonsterLike, key: string) => {
      this.registerMonster(monster, key);
    });
    this.room.state.monsters.onAdd((monster: MonsterLike, key: string) => {
      this.registerMonster(monster, key);
    });
    this.room.state.monsters.onRemove((_monster: MonsterLike, key: string) => {
      this.monsters.delete(key);
      const sprite = this.monsterSprites.get(key);
      if (sprite) {
        sprite.destroy();
      }
      this.monsterSprites.delete(key);
      if (this.selectedMonsterId === key) {
        this.selectedMonsterId = this.getFirstLivingMonsterId();
      }
      this.renderHud();
    });

    this.room.onMessage("deckState", (message: DeckStateMessage) => {
      this.drawPileCount = message.drawPileCount;
      this.discardPileCount = message.discardPileCount;
      this.uiManager?.renderDeckCounts(this.drawPileCount, this.discardPileCount);
    });

    this.room.onMessage("error", (message: { code: string }) => {
      this.uiManager?.setStatus(`Action blocked: ${message.code}`);
    });

    this.room.onMessage("combatEvent", (event: CombatEventMessage) => {
      if (event.type === "monsterAttack") {
        this.monsterAttackTween(event.sourceId);
      }
      if (event.type === "playerCardDiscarded" && event.sourceId === this.playerId) {
        this.uiManager?.setStatus(`Discarded ${event.cardId ?? "card"} and drew a replacement.`);
      }
    });

    this.room.state.players.onAdd((player: PlayerLike, key: string) => {
      if (key !== this.playerId) {
        return;
      }
      this.syncPlayer(player);

      player.onChange(() => {
        const previousHp = this.playerHp;
        this.syncPlayer(player);
        if (this.playerHp < previousHp) {
          this.takeDamage("player");
        }
      });
    });

    this.renderHud();
    this.uiManager?.renderHand(this.handCardIds, this.cardLibrary);
  }

  private syncPlayer(player: PlayerLike): void {
    this.playerHp = player.hp;
    this.playerMaxHp = player.maxHp;
    this.playerMana = player.mana;
    this.playerMaxMana = player.maxMana;
    this.handCardIds = [...player.hand];
    this.renderHud();
    this.uiManager?.renderHand(this.handCardIds, this.cardLibrary);
  }

  private renderHud(): void {
    const targetMonster = this.getSelectedOrFallbackMonster();
    const targetMonsterHp = targetMonster?.hp ?? 0;
    const targetMonsterMaxHp = targetMonster?.maxHp ?? 0;
    this.uiManager?.renderVitals({
      playerHp: this.playerHp,
      playerMaxHp: this.playerMaxHp,
      targetMonsterHp,
      targetMonsterMaxHp,
      playerMana: this.playerMana,
      playerMaxMana: this.playerMaxMana
    });
    this.uiManager?.renderDeckCounts(this.drawPileCount, this.discardPileCount);
    this.uiManager?.renderMonsters([...this.monsters.values()], this.selectedMonsterId);
  }

  private tryPlayCard(cardId: string): void {
    if (!this.room) {
      return;
    }
    const targetId = this.selectedMonsterId ?? this.getFirstLivingMonsterId();
    if (!targetId) {
      this.uiManager?.setStatus("No living monster to target.");
      return;
    }
    this.playerAttackTween();
    this.room.send("playCard", {
      cardId,
      targetId
    });
  }

  private tryDiscardCard(cardId: string): void {
    if (!this.room) {
      return;
    }
    this.room.send("discardCard", { cardId });
  }

  private playerAttackTween(): void {
    if (!this.playerSprite) {
      return;
    }
    this.tweens.add({
      targets: this.playerSprite,
      x: this.playerSprite.x + 35,
      duration: 90,
      yoyo: true,
      ease: "Quad.easeInOut"
    });
  }

  private monsterHitTween(monsterId: string): void {
    const sprite = this.monsterSprites.get(monsterId);
    if (!sprite) {
      return;
    }
    this.tweens.add({
      targets: sprite,
      x: sprite.x + 12,
      yoyo: true,
      repeat: 2,
      duration: 50
    });
    this.tweens.add({
      targets: sprite,
      alpha: 0.45,
      yoyo: true,
      repeat: 1,
      duration: 70
    });
  }

  private monsterAttackTween(monsterId: string): void {
    const sprite = this.monsterSprites.get(monsterId);
    if (!sprite) {
      return;
    }
    this.tweens.add({
      targets: sprite,
      x: sprite.x - 16,
      duration: 90,
      yoyo: true,
      ease: "Quad.easeInOut"
    });
  }

  private takeDamage(target: "player" | "monster"): void {
    if (target === "player" && this.playerSprite) {
      this.tweens.add({
        targets: this.playerSprite,
        alpha: 0.4,
        yoyo: true,
        repeat: 1,
        duration: 70
      });
    }
    if (target === "monster") {
      if (this.selectedMonsterId) {
        this.monsterHitTween(this.selectedMonsterId);
      }
    }
    this.cameras.main.shake(120, 0.008);
  }

  private hydrateCardLibrary(): void {
    this.cardLibrary = {};
    this.room?.state.cardLibrary.forEach((value: CardDef, key: string) => {
      this.cardLibrary[key] = {
        id: value.id,
        cost: value.cost,
        value: value.value
      };
    });
  }

  private registerMonster(monster: MonsterLike, key: string): void {
    this.monsters.set(key, {
      id: monster.id,
      name: monster.name,
      hp: monster.hp,
      maxHp: monster.maxHp
    });
    if (!this.selectedMonsterId || !this.isMonsterLiving(this.selectedMonsterId)) {
      this.selectedMonsterId = key;
    }
    if (!this.monsterSprites.has(key)) {
      const index = this.monsterSprites.size;
      const sprite = this.add.rectangle(430 + index * 170, 170, 80, 90, 0xc24646);
      this.monsterSprites.set(key, sprite);
    }
    monster.onChange(() => {
      const previous = this.monsters.get(key);
      this.monsters.set(key, {
        id: monster.id,
        name: monster.name,
        hp: monster.hp,
        maxHp: monster.maxHp
      });
      if (previous && monster.hp < previous.hp) {
        this.monsterHitTween(key);
      }
      if (this.selectedMonsterId === key && monster.hp <= 0) {
        this.selectedMonsterId = this.getFirstLivingMonsterId();
      }
      this.renderHud();
    });
    this.renderHud();
  }

  private selectMonster(monsterId: string): void {
    if (!this.isMonsterLiving(monsterId)) {
      return;
    }
    this.selectedMonsterId = monsterId;
    this.renderHud();
  }

  private isMonsterLiving(monsterId: string): boolean {
    const monster = this.monsters.get(monsterId);
    return Boolean(monster && monster.hp > 0);
  }

  private getFirstLivingMonsterId(): string | undefined {
    for (const monster of this.monsters.values()) {
      if (monster.hp > 0) {
        return monster.id;
      }
    }
    return undefined;
  }

  private getSelectedOrFallbackMonster(): MonsterSnapshot | undefined {
    if (this.selectedMonsterId) {
      const selected = this.monsters.get(this.selectedMonsterId);
      if (selected && selected.hp > 0) {
        return selected;
      }
    }
    const firstId = this.getFirstLivingMonsterId();
    if (!firstId) {
      return undefined;
    }
    this.selectedMonsterId = firstId;
    return this.monsters.get(firstId);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 520,
  parent: "app",
  scene: [BattleScene]
});

export default game;
