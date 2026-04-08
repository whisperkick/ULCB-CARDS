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
  hp: number;
  maxHp: number;
  onChange: (cb: () => void) => void;
};

type DeckStateMessage = {
  drawPileCount: number;
  discardPileCount: number;
};

type CombatEventMessage = {
  type: "monsterAttack" | "playerCardPlayed";
  sourceId: string;
  targetId: string;
  cardId?: string;
  value: number;
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

  constructor(scene: Phaser.Scene, onCardSelected: (cardId: string) => void) {
    this.scene = scene;
    this.onCardSelected = onCardSelected;
    this.playerText = this.scene.add.text(120, 320, "Player HP: --", {
      color: "#ffffff",
      fontSize: "20px"
    });
    this.monsterText = this.scene.add.text(560, 320, "Monster HP: --", {
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
    monsterHp: number;
    monsterMaxHp: number;
    playerMana: number;
    playerMaxMana: number;
  }): void {
    this.playerText.setText(`Player HP: ${params.playerHp}/${params.playerMaxHp}`);
    this.monsterText.setText(`Monster HP: ${params.monsterHp}/${params.monsterMaxHp}`);
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
      const stats = this.scene.add.text(-48, 10, `Cost: ${cardDef.cost}\nDmg: ${cardDef.value}`, {
        color: "#8be58b",
        fontSize: "16px"
      });

      const container = this.scene.add.container(startX + spacing * index, y, [bg, label, stats]);
      container.setSize(120, 140);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-60, -70, 120, 140),
        Phaser.Geom.Rectangle.Contains
      );
      container.on("pointerdown", () => this.onCardSelected(cardId));
      container.on("pointerover", () => {
        this.scene.tweens.add({ targets: container, y: y - 10, duration: 100 });
      });
      container.on("pointerout", () => {
        this.scene.tweens.add({ targets: container, y, duration: 100 });
      });
      this.handButtons.push(container);
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
  private monsterHp = 0;
  private monsterMaxHp = 0;
  private drawPileCount = 0;
  private discardPileCount = 0;
  private monsterId = "monster_1";

  private uiManager?: BattleUIManager;
  private monsterSprite?: Phaser.GameObjects.Rectangle;
  private playerSprite?: Phaser.GameObjects.Rectangle;

  constructor() {
    super("battle");
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#1b1b2f");
    this.playerSprite = this.add.rectangle(180, 240, 90, 120, 0x4e9fd1);
    this.monsterSprite = this.add.rectangle(620, 220, 110, 140, 0xc24646);
    this.uiManager = new BattleUIManager(this, (cardId) => this.tryPlayCard(cardId));

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
    this.monsterId = this.room.state.monster.id;
    this.monsterHp = this.room.state.monster.hp;
    this.monsterMaxHp = this.room.state.monster.maxHp;

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
        this.takeDamage("player");
      }
      if (
        event.type === "playerCardPlayed" &&
        event.targetId === this.monsterId &&
        event.sourceId === this.playerId
      ) {
        this.monsterHitTween();
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

    const monster = this.room.state.monster as MonsterLike;
    monster.onChange(() => {
      this.monsterHp = monster.hp;
      this.monsterMaxHp = monster.maxHp;
      this.renderHud();
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
    this.uiManager?.renderVitals({
      playerHp: this.playerHp,
      playerMaxHp: this.playerMaxHp,
      monsterHp: this.monsterHp,
      monsterMaxHp: this.monsterMaxHp,
      playerMana: this.playerMana,
      playerMaxMana: this.playerMaxMana
    });
    this.uiManager?.renderDeckCounts(this.drawPileCount, this.discardPileCount);
  }

  private tryPlayCard(cardId: string): void {
    if (!this.room) {
      return;
    }
    this.playerAttackTween();
    this.room.send("playCard", {
      cardId,
      targetId: this.monsterId
    });
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

  private monsterHitTween(): void {
    if (!this.monsterSprite) {
      return;
    }
    this.tweens.add({
      targets: this.monsterSprite,
      x: this.monsterSprite.x + 12,
      yoyo: true,
      repeat: 2,
      duration: 50
    });
    this.tweens.add({
      targets: this.monsterSprite,
      alpha: 0.45,
      yoyo: true,
      repeat: 1,
      duration: 70
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
      this.monsterHitTween();
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
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 520,
  parent: "app",
  scene: [BattleScene]
});

export default game;
