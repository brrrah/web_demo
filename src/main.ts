import Phaser from 'phaser';
import { CombatSimulation, SimpleCombatAI, type CombatEvent, type Fighter, type FighterInput } from './combat';
import { activeWeaponSweep, attackTimeline, combatPose, facingAngle, type CombatPose } from './combatMotion';
import { predictAttackTelegraph, type AttackTelegraph } from './combatTelegraph';
import { GROUND_DASH, PARRY } from './combatData';
import { DoubleTapDashDetector, PLAYER_GROUND_BINDINGS, type MoveKey } from './groundInput';
import { PARRY_READABILITY, VIEW_FEEL, parryCueStyle, visibleWorldSize } from './presentationData';

const WIDTH = VIEW_FEEL.viewportWidth; const HEIGHT = VIEW_FEEL.viewportHeight; const STEP_MS = 1000 / 60;

interface FighterPalette { body: number; bodyDark: number; skin: number; arm: number; blade: number; glow: number }
const PLAYER_PALETTE: FighterPalette = { body: 0x157f86, bodyDark: 0x0a4850, skin: 0xd7faff, arm: 0x3fcad1, blade: 0xcaffff, glow: 0x63ffff };
const AI_PALETTE: FighterPalette = { body: 0x9a246f, bodyDark: 0x58113e, skin: 0xffd9ef, arm: 0xe85aaa, blade: 0xffd1f0, glow: 0xff69c8 };

class ProceduralFighterView {
  readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) { this.graphics = scene.add.graphics(); }

  render(fighter: Fighter, pose: CombatPose, palette: FighterPalette): void {
    this.graphics.clear();
    const displayPalette = pose.parryActive
      ? { body: 0xf22d36, bodyDark: 0x741018, skin: 0xff7676, arm: 0xff3b42, blade: palette.blade, glow: 0xff2028 }
      : palette;
    const speed = Math.hypot(fighter.velocity.x, fighter.velocity.y);
    if (pose.animation === 'move' && speed >= VIEW_FEEL.movementTrailThreshold) {
      this.graphics.lineStyle(3, palette.glow, 0.18).lineBetween(fighter.position.x - fighter.velocity.x * 3.4, fighter.position.y - fighter.velocity.y * 3.4 + 18, fighter.position.x - fighter.velocity.x * 0.4, fighter.position.y - fighter.velocity.y * 0.4 + 18);
      this.drawFigure(fighter, pose, displayPalette, 0.09, -fighter.velocity.x * VIEW_FEEL.movementGhostOffset, -fighter.velocity.y * VIEW_FEEL.movementGhostOffset);
    }
    if (pose.animation === 'dash') {
      this.graphics.lineStyle(5, palette.glow, 0.5).lineBetween(fighter.position.x - fighter.velocity.x * 7.4, fighter.position.y - fighter.velocity.y * 7.4 + 18, fighter.position.x - fighter.velocity.x * 0.5, fighter.position.y - fighter.velocity.y * 0.5 + 18);
      for (let ghost = 0; ghost < VIEW_FEEL.dashGhostOffsets.length; ghost += 1) {
        const offset = VIEW_FEEL.dashGhostOffsets[ghost];
        this.drawFigure(fighter, pose, displayPalette, 0.05 + ghost * 0.055, -fighter.velocity.x * offset, -fighter.velocity.y * offset);
      }
    } else if (pose.animation === 'dodge') {
      this.graphics.lineStyle(5, palette.glow, 0.24).lineBetween(fighter.position.x - fighter.velocity.x * 4.2, fighter.position.y - fighter.velocity.y * 4.2 + 19, fighter.position.x - fighter.velocity.x * 0.5, fighter.position.y - fighter.velocity.y * 0.5 + 19);
      this.drawFigure(fighter, pose, displayPalette, 0.08, -fighter.velocity.x * 3.4, -fighter.velocity.y * 3.4);
      this.drawFigure(fighter, pose, displayPalette, 0.18, -fighter.velocity.x * 1.7, -fighter.velocity.y * 1.7);
    }
    const spawnAlpha = pose.animation === 'respawn' ? Math.max(0.25, 1 - fighter.spawnFrames / 16) : 1;
    this.drawFigure(fighter, pose, displayPalette, fighter.flashFrames > 0 ? 1 : spawnAlpha, 0, 0);
  }

  private drawFigure(fighter: Fighter, pose: CombatPose, palette: FighterPalette, alpha: number, offsetX: number, offsetY: number): void {
    const g = this.graphics;
    const origin = { x: fighter.position.x + offsetX, y: fighter.position.y + offsetY };
    const travelFace = pose.rollPhase !== 'none' && Math.hypot(fighter.velocity.x, fighter.velocity.y) > 0.01
      ? Math.atan2(fighter.velocity.y, fighter.velocity.x)
      : facingAngle(fighter.facing);
    const bodyAngle = travelFace + pose.bodyTwist * 0.45 + pose.lean * (pose.rollPhase === 'none' ? 1 : 0.35);
    const forward = { x: Math.cos(bodyAngle), y: Math.sin(bodyAngle) };
    const side = { x: -forward.y, y: forward.x };
    const rollSin = Math.sin(pose.rollRotation);
    const rollCos = Math.cos(pose.rollRotation);
    const rollForward = pose.rollTuck * rollSin * 8;
    const rollDrop = pose.rollTuck * (1 - rollCos) * 5;
    const body = {
      x: origin.x + forward.x * (3 + rollForward),
      y: origin.y + forward.y * (3 + rollForward) - 10 + rollDrop,
    };
    const shoulderSpread = 11 * (1 - pose.rollTuck * 0.48);
    const shoulderLift = 4 - pose.rollTuck * 3;
    const shoulderLeft = { x: body.x + side.x * shoulderSpread, y: body.y + side.y * 7 - shoulderLift };
    const shoulderRight = { x: body.x - side.x * shoulderSpread, y: body.y - side.y * 7 - shoulderLift };
    const hipSpread = 8 * (1 - pose.rollTuck * 0.62);
    const hipPull = 12 - pose.rollTuck * 6;
    const hipLeft = { x: body.x + side.x * hipSpread - forward.x * hipPull, y: body.y + side.y * 6 - forward.y * 8 + 13 - pose.rollTuck * 5 };
    const hipRight = { x: body.x - side.x * hipSpread - forward.x * hipPull, y: body.y - side.y * 6 - forward.y * 8 + 13 - pose.rollTuck * 5 };
    const head = pose.rollPhase === 'none'
      ? { x: body.x + forward.x * 4, y: body.y + forward.y * 3 - 18 }
      : {
          x: body.x + forward.x * (rollCos * 4 + rollSin * 12),
          y: body.y + forward.y * (rollSin * 8) - rollCos * 17,
        };
    const hand = { x: pose.hand.x + offsetX, y: pose.hand.y + offsetY };
    const tip = { x: pose.tip.x + offsetX, y: pose.tip.y + offsetY };
    const elbow = { x: (shoulderRight.x + hand.x) / 2 - side.x * (7 - pose.rollTuck * 4), y: (shoulderRight.y + hand.y) / 2 - side.y * (5 - pose.rollTuck * 3) };

    g.fillStyle(0x05080d, 0.34 * alpha).fillEllipse(origin.x + 3, origin.y + 18, 52, 18);
    g.lineStyle(7, palette.bodyDark, alpha).lineBetween(hipLeft.x, hipLeft.y, origin.x + side.x * (10 - pose.rollTuck * 5) - forward.x * 10, origin.y + 15 + side.y * 4);
    g.lineBetween(hipRight.x, hipRight.y, origin.x - side.x * (10 - pose.rollTuck * 5) - forward.x * 10, origin.y + 15 - side.y * 4);
    g.fillStyle(palette.body, alpha).beginPath().moveTo(shoulderLeft.x, shoulderLeft.y).lineTo(shoulderRight.x, shoulderRight.y).lineTo(hipRight.x, hipRight.y).lineTo(hipLeft.x, hipLeft.y).closePath().fillPath();
    g.lineStyle(2, palette.bodyDark, alpha).strokeTriangle(shoulderLeft.x, shoulderLeft.y, shoulderRight.x, shoulderRight.y, hipRight.x, hipRight.y);
    g.fillStyle(fighter.flashFrames > 0 ? 0xffffff : palette.skin, alpha).fillCircle(head.x, head.y, 9);
    g.fillStyle(palette.bodyDark, alpha).fillTriangle(head.x + forward.x * 12, head.y + forward.y * 9, head.x + side.x * 4, head.y + side.y * 3, head.x - side.x * 4, head.y - side.y * 3);
    g.lineStyle(7, palette.arm, alpha).lineBetween(shoulderLeft.x, shoulderLeft.y, hand.x - side.x * (5 - pose.rollTuck * 2), hand.y - side.y * (5 - pose.rollTuck * 2));
    g.lineBetween(shoulderRight.x, shoulderRight.y, elbow.x, elbow.y).lineBetween(elbow.x, elbow.y, hand.x, hand.y);
    g.fillStyle(palette.skin, alpha).fillCircle(hand.x, hand.y, 5);

    if (pose.phase === 'active') {
      g.lineStyle(fighter.attack === 'heavy' ? 12 : 8, palette.glow, 0.2 * alpha);
      g.lineBetween(pose.previousTip.x + offsetX, pose.previousTip.y + offsetY, tip.x, tip.y);
    }
    g.lineStyle(fighter.attack === 'heavy' ? 7 : 5, palette.blade, alpha).lineBetween(hand.x, hand.y, tip.x, tip.y);
    g.lineStyle(3, 0xffffff, 0.8 * alpha).lineBetween(hand.x, hand.y, tip.x, tip.y);
    const guardAngle = pose.weaponAngle + Math.PI / 2;
    g.lineStyle(5, palette.bodyDark, alpha).lineBetween(hand.x - Math.cos(guardAngle) * 8, hand.y - Math.sin(guardAngle) * 8, hand.x + Math.cos(guardAngle) * 8, hand.y + Math.sin(guardAngle) * 8);
  }
}

class CombatScene extends Phaser.Scene {
  private sim = new CombatSimulation();
  private ai = new SimpleCombatAI();
  private accumulator = 0;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private playerView!: ProceduralFighterView;
  private aiView!: ProceduralFighterView;
  private arena!: Phaser.GameObjects.Graphics;
  private telegraphLayer!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Graphics;
  private debugLayer!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private parryCue!: Phaser.GameObjects.Text;
  private attackWarningCue!: Phaser.GameObjects.Text;
  private parryBreakCue!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private debug = false;
  private pending: { light: boolean; heavy: boolean; dodge: boolean; parry: boolean; feint: boolean; dash: { x: number; y: number } | null } = { light: false, heavy: false, dodge: false, parry: false, feint: false, dash: null };
  private readonly dashDetector = new DoubleTapDashDetector();
  private lastFrameMs = 0;
  private frameTimes: number[] = [];
  private renderedFrames = 0;
  private totalFixedTicks = 0;
  private maxBacklogTicks = 0;
  private droppedBacklogMs = 0;
  private focusResetCount = 0;
  private lastPredictedContactTick: number | null = null;
  private lastActualContactTick: number | null = null;
  private lastPredictionDelta: number | null = null;
  private activeAfterimageCount = 0;
  private activeFxCount = 0;
  private readonly fxPoolCapacity = 16;
  private readonly onFocusLoss = (): void => {
    this.pending = { light: false, heavy: false, dodge: false, parry: false, feint: false, dash: null };
    this.dashDetector.reset();
    this.sim.clearTransientControl();
    this.accumulator = 0;
    this.input.keyboard?.resetKeys();
    this.telegraphLayer?.clear(); this.effects?.clear(); this.parryCue?.setVisible(false); this.attackWarningCue?.setVisible(false); this.parryBreakCue?.setVisible(false);
    this.lastPredictedContactTick = null;
    this.focusResetCount += 1;
  };
  private readonly onVisibilityChange = (): void => { if (document.hidden) this.onFocusLoss(); };

  constructor() { super('combat'); }

  create(): void {
    this.cameras.main.setBackgroundColor('#10151c');
    this.arena = this.add.graphics(); this.telegraphLayer = this.add.graphics(); this.effects = this.add.graphics(); this.debugLayer = this.add.graphics();
    this.drawArena();
    this.playerView = new ProceduralFighterView(this); this.aiView = new ProceduralFighterView(this);
    this.hud = this.add.text(20, 18, '', { fontFamily: 'monospace', fontSize: '17px', color: '#f5f7fa' }).setDepth(10);
    this.parryCue = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: PARRY_READABILITY.countdownFontSize.toString() + 'px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#7d5b00dd', padding: { x: 11, y: 6 } }).setOrigin(0.5).setDepth(13).setVisible(false);
    this.attackWarningCue = this.add.text(0, 0, 'WINDUP', { fontFamily: 'monospace', fontSize: PARRY_READABILITY.windupFontSize.toString() + 'px', fontStyle: 'bold', color: '#231900', backgroundColor: '#ffd84fe8', padding: { x: 8, y: 4 } }).setOrigin(0.5).setDepth(12).setVisible(false);
    this.parryBreakCue = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#fff3d0', backgroundColor: '#8a1f16e6', padding: { x: 8, y: 4 } }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.debugText = this.add.text(20, 380, '', { fontFamily: 'monospace', fontSize: '12px', color: '#9fffc2', backgroundColor: '#000c', padding: { x: 8, y: 6 } }).setDepth(12);
    this.cameras.main.setZoom(VIEW_FEEL.worldCameraZoom).centerOn(VIEW_FEEL.worldCenterX, VIEW_FEEL.worldCenterY);
    this.uiCamera = this.cameras.add(0, 0, WIDTH, HEIGHT).setName('ui');
    this.cameras.main.ignore([this.hud, this.debugText, this.parryCue, this.attackWarningCue, this.parryBreakCue]);
    this.uiCamera.ignore([this.arena, this.telegraphLayer, this.effects, this.debugLayer, this.playerView.graphics, this.aiView.graphics]);
    const keyboard = this.input.keyboard!;
    this.keys = keyboard.addKeys('W,A,S,D,SPACE,Q,R,F3,SHIFT') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => { if (pointer.leftButtonDown()) this.pending.light = true; if (pointer.rightButtonDown()) this.pending.heavy = true; });
    this.input.mouse?.disableContextMenu();
    for (const key of ['W', 'A', 'S', 'D'] as MoveKey[]) {
      keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        const dash = this.dashDetector.keyDown(key, this.sim.frame, event.repeat);
        if (dash) this.pending.dash = dash;
      });
      keyboard.on(`keyup-${key}`, () => this.dashDetector.keyUp(key));
    }
    keyboard.on(`keydown-${PLAYER_GROUND_BINDINGS.roll}`, () => { this.pending.dodge = true; });
    keyboard.on(`keydown-${PLAYER_GROUND_BINDINGS.feint}`, () => { this.pending.feint = true; });
    keyboard.on('keydown-R', () => this.restart());
    keyboard.on('keydown-F3', () => { this.debug = !this.debug; });
    window.addEventListener('blur', this.onFocusLoss);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', this.onFocusLoss);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    });
    window.__GAME_P0B__ = { snapshot: () => this.snapshot(), restart: () => this.restart() };
    this.renderState();
  }

  update(_time: number, delta: number): void {
    this.lastFrameMs = delta; this.renderedFrames += 1; this.frameTimes.push(delta);
    if (this.frameTimes.length > 600) this.frameTimes.shift();
    const accumulated = this.accumulator + delta; const backlogLimitMs = STEP_MS * 8;
    if (accumulated > backlogLimitMs) this.droppedBacklogMs += accumulated - backlogLimitMs;
    this.accumulator = Math.min(accumulated, backlogLimitMs);
    this.maxBacklogTicks = Math.max(this.maxBacklogTicks, Math.floor(this.accumulator / STEP_MS));
    while (this.accumulator >= STEP_MS) {
      this.sim.step(this.readInput(), this.ai.decide(this.sim));
      this.recordFixedTelemetry();
      if (this.sim.player.state === 'dead') { this.dashDetector.reset(); this.pending.dash = null; }
      this.accumulator -= STEP_MS; this.totalFixedTicks += 1;
    }
    if (this.sim.winner && Phaser.Input.Keyboard.JustDown(this.keys.R)) this.restart();
    this.renderState();
  }

  private recordFixedTelemetry(): void {
    const event = this.sim.events.at(-1);
    const isContact = event?.frame === this.sim.frame && (event.type === 'hit' || event.type === 'parry' || event.type === 'death');
    if (isContact) {
      this.lastActualContactTick = event.frame;
      this.lastPredictionDelta = this.lastPredictedContactTick === null ? null : event.frame - this.lastPredictedContactTick;
      this.lastPredictedContactTick = null;
      return;
    }
    const telegraph = predictAttackTelegraph(this.sim.ai, this.sim.player, this.sim.frame);
    this.lastPredictedContactTick = telegraph.active ? telegraph.predictedContactTick : null;
  }

  private readInput(): FighterInput {
    const pointer = this.input.activePointer;
    const move = { x: Number(this.keys.D.isDown) - Number(this.keys.A.isDown), y: Number(this.keys.S.isDown) - Number(this.keys.W.isDown) };
    const pointerWorld = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const aim = { x: pointerWorld.x - this.sim.player.position.x, y: pointerWorld.y - this.sim.player.position.y };
    const result = { move, aim, light: this.pending.light, heavy: this.pending.heavy, dodge: this.pending.dodge, parry: false, feint: this.pending.feint, dash: this.pending.dash, delayHeavy: this.keys.SHIFT.isDown };
    this.pending = { light: false, heavy: false, dodge: false, parry: false, feint: false, dash: null };
    return result;
  }

  private restart(): void {
    this.sim.restart(); this.ai.reset(); this.accumulator = 0;
    this.pending = { light: false, heavy: false, dodge: false, parry: false, feint: false, dash: null };
    this.dashDetector.reset();
    this.lastPredictedContactTick = null; this.lastActualContactTick = null; this.lastPredictionDelta = null;
    this.activeFxCount = 0; this.activeAfterimageCount = 0;
    this.telegraphLayer.clear(); this.effects.clear(); this.parryCue.setVisible(false); this.attackWarningCue.setVisible(false); this.parryBreakCue.setVisible(false); this.input.keyboard?.resetKeys();
  }

  private snapshot(): BrowserSnapshot {
    const samples = this.frameTimes.slice(1);
    const averageFrameMs = samples.length > 0 ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
    const maxFrameMs = samples.length > 0 ? Math.max(...samples) : 0;
    const telegraph = predictAttackTelegraph(this.sim.ai, this.sim.player, this.sim.frame);
    const playerPose = combatPose(this.sim.player);
    return {
      ready: true, renderedFrames: this.renderedFrames, totalFixedTicks: this.totalFixedTicks,
      fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0, averageFrameMs, maxFrameMs,
      currentBacklogTicks: Math.floor(this.accumulator / STEP_MS), maxBacklogTicks: this.maxBacklogTicks,
      droppedBacklogMs: this.droppedBacklogMs, focusResetCount: this.focusResetCount, cameraZoom: VIEW_FEEL.worldCameraZoom, worldView: visibleWorldSize(),
      restartCount: this.sim.restartCount, sceneObjectCount: this.children.length,
      sceneInputListenerCount: this.input.listenerCount('pointerdown'),
      player: { position: { ...this.sim.player.position }, hp: this.sim.player.hp, state: this.sim.player.state, attackPhase: this.sim.attackPhase(this.sim.player), parryPhase: this.sim.parryPhase(this.sim.player), dodgeCharges: this.sim.player.dodgeCharges, bladeActionState: this.sim.bladeActionState(this.sim.player), parryActive: playerPose.parryActive, parryBreakFrames: this.sim.player.state === 'parried' ? this.sim.player.stateFrame : 0, lastBladeActionResult: this.sim.player.lastBladeActionResult, dashCooldown: this.sim.player.dashCooldown, rollPhase: playerPose.rollPhase, rollInvulnerable: playerPose.rollInvulnerable, attackForwardMomentum: this.sim.player.attackForwardMomentum },
      ai: { position: { ...this.sim.ai.position }, hp: this.sim.ai.hp, state: this.sim.ai.state, attackPhase: this.sim.attackPhase(this.sim.ai), parryPhase: this.sim.parryPhase(this.sim.ai), parryActive: this.sim.parryPhase(this.sim.ai) === 'active', parryBreakFrames: this.sim.ai.state === 'parried' ? this.sim.ai.stateFrame : 0 },
      telegraph: { active: telegraph.active, predictedContactTick: telegraph.predictedContactTick, countdownTicks: telegraph.countdownTicks, ringProgress: telegraph.ringProgress, yellowArcActive: telegraph.yellowArcActive, promptActive: telegraph.promptActive },
      winner: this.sim.winner, recentEvents: this.sim.events.slice(-16).map((event) => ({ ...event })),
    };
  }

  private drawArena(): void {
    this.arena.clear().fillStyle(0x252b33).lineStyle(4, 0x77808c).beginPath();
    this.arena.moveTo(120, 90).lineTo(840, 90).lineTo(900, 510).lineTo(60, 510).closePath().fillPath().strokePath();
    this.arena.lineStyle(1, 0x3b434e, 0.8);
    for (let y = 130; y < 510; y += 40) this.arena.lineBetween(66 + (y - 90) / 7, y, 894 - (y - 90) / 7, y);
    for (let x = 140; x < 860; x += 80) this.arena.lineBetween(x, 92, x + (x - 480) * 0.08, 508);
  }

  private renderState(): void {
    const playerPose = combatPose(this.sim.player); const aiPose = combatPose(this.sim.ai);
    const telegraph = predictAttackTelegraph(this.sim.ai, this.sim.player, this.sim.frame);
    this.activeFxCount = 0;
    this.activeAfterimageCount =
      (playerPose.animation === 'dash' ? 3 : playerPose.animation === 'dodge' ? 2 : playerPose.animation === 'move' && Math.hypot(this.sim.player.velocity.x, this.sim.player.velocity.y) >= VIEW_FEEL.movementTrailThreshold ? 1 : 0)
      + (aiPose.animation === 'dash' ? 3 : aiPose.animation === 'dodge' ? 2 : aiPose.animation === 'move' && Math.hypot(this.sim.ai.velocity.x, this.sim.ai.velocity.y) >= VIEW_FEEL.movementTrailThreshold ? 1 : 0);
    this.playerView.render(this.sim.player, playerPose, PLAYER_PALETTE); this.aiView.render(this.sim.ai, aiPose, AI_PALETTE);
    this.drawTelegraph(telegraph);
    this.drawEffects(playerPose, aiPose);
    this.drawParryBreakCue();
    const seconds = Math.ceil(this.sim.roundFrames / 60);
    this.hud.setText([`PLAYER ${this.sim.player.hp.toString().padStart(3)}   ${seconds.toString().padStart(2)}s   AI ${this.sim.ai.hp.toString().padStart(3)}`, 'WASD move | double-tap WW/AA/SS/DD = fast ground dash | mouse aim', 'WINDUP + 6..1 ring = real contact timing | LMB! = intercept now | RED = active parry', 'PARRY SUCCESS = enemy PARRY BREAK for 1.0s', 'LMB otherwise light | RMB heavy | Shift+RMB delay | Q feint | Space phased invulnerable roll | R restart | F3 debug', this.sim.winner ? `WINNER: ${this.sim.winner.toUpperCase()} - press R` : ''].filter(Boolean));
    this.drawDebug(playerPose, aiPose, telegraph);
  }

  private worldToUi(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - VIEW_FEEL.worldCenterX) * VIEW_FEEL.worldCameraZoom + WIDTH / 2,
      y: (y - VIEW_FEEL.worldCenterY) * VIEW_FEEL.worldCameraZoom + HEIGHT / 2,
    };
  }

  private drawParryBreakCue(): void {
    const fighter = this.sim.player.state === 'parried' ? this.sim.player : this.sim.ai.state === 'parried' ? this.sim.ai : null;
    if (!fighter) { this.parryBreakCue.setVisible(false); return; }
    const seconds = fighter.stateFrame / this.sim.fixedHz;
    const screen = this.worldToUi(fighter.position.x, fighter.position.y - 76);
    this.parryBreakCue.setVisible(true).setPosition(screen.x, screen.y).setText(`PARRY BREAK ${seconds.toFixed(1)}s`);
  }

  private drawTelegraph(telegraph: AttackTelegraph): void {
    this.telegraphLayer.clear();
    const cueAllowed = this.sim.player.state === 'idle' || this.sim.player.state === 'dash';
    const cue = parryCueStyle(telegraph.ringActive, telegraph.countdownTicks, cueAllowed);
    const playerScreen = this.worldToUi(this.sim.player.position.x, this.sim.player.position.y - 82);
    this.parryCue.setVisible(cue !== null).setPosition(playerScreen.x, playerScreen.y);
    if (cue) this.parryCue.setText(cue.label).setColor(cue.color).setBackgroundColor(cue.background);
    const warningScreen = this.worldToUi(this.sim.ai.position.x, this.sim.ai.position.y - 75);
    this.attackWarningCue.setVisible(telegraph.active && telegraph.yellowArcActive).setPosition(warningScreen.x, warningScreen.y);
    if (telegraph.yellowArcActive && telegraph.predictedOrigin && telegraph.arcStartAngle !== null && telegraph.arcEndAngle !== null) {
      const base = facingAngle(this.sim.ai.facing);
      const start = base + telegraph.arcStartAngle;
      const end = base + telegraph.arcEndAngle;
      this.telegraphLayer.fillStyle(0xffd84f, 0.09).beginPath().moveTo(telegraph.predictedOrigin.x, telegraph.predictedOrigin.y).arc(telegraph.predictedOrigin.x, telegraph.predictedOrigin.y, telegraph.reach, start, end).closePath().fillPath();
      this.telegraphLayer.lineStyle(PARRY_READABILITY.sweepWidth, 0xffd84f, 0.9).beginPath().arc(telegraph.predictedOrigin.x, telegraph.predictedOrigin.y, telegraph.reach, start, end).strokePath();
      this.telegraphLayer.lineStyle(2, 0xffffff, 0.62).beginPath().arc(telegraph.predictedOrigin.x, telegraph.predictedOrigin.y, telegraph.reach - 7, start, end).strokePath();
      this.activeFxCount += 3;
    }
    if (telegraph.ringActive && telegraph.countdownTicks !== null) {
      const progress = (PARRY_READABILITY.countdownTicks - telegraph.countdownTicks) / (PARRY_READABILITY.countdownTicks - 1);
      const radius = PARRY_READABILITY.ringStartRadius + (PARRY_READABILITY.ringEndRadius - PARRY_READABILITY.ringStartRadius) * progress;
      const urgent = telegraph.countdownTicks <= 3;
      const color = telegraph.promptActive ? 0xffffff : urgent ? 0xff8a32 : 0xffd84f;
      this.telegraphLayer.lineStyle(PARRY_READABILITY.ringWidth, color, 0.94).strokeCircle(this.sim.player.position.x, this.sim.player.position.y - 2, radius);
      this.telegraphLayer.lineStyle(2, 0xffffff, urgent ? 0.76 : 0.48).strokeCircle(this.sim.player.position.x, this.sim.player.position.y - 2, Math.max(15, radius - 10));
      const notch = radius + 8;
      const x = this.sim.player.position.x; const y = this.sim.player.position.y - 2;
      this.telegraphLayer.lineStyle(4, color, 0.9).lineBetween(x - notch - 10, y, x - notch + 5, y).lineBetween(x + notch - 5, y, x + notch + 10, y).lineBetween(x, y - notch - 10, x, y - notch + 5).lineBetween(x, y + notch - 5, x, y + notch + 10);
      this.activeFxCount += 6;
    }
    if (telegraph.contactFlashActive && telegraph.predictedContactPoint) {
      this.telegraphLayer.fillStyle(0xffffff, 0.98).fillCircle(telegraph.predictedContactPoint.x, telegraph.predictedContactPoint.y, 12);
      this.telegraphLayer.lineStyle(4, 0xffe26e, 0.95).strokeCircle(telegraph.predictedContactPoint.x, telegraph.predictedContactPoint.y, 22);
      this.activeFxCount += 2;
    }
  }

  private drawEffects(playerPose: CombatPose, aiPose: CombatPose): void {
    this.effects.clear();
    for (const [fighter, pose] of [[this.sim.player, playerPose], [this.sim.ai, aiPose]] as const) {
      if (pose.parryActive) {
        this.effects.lineStyle(7, 0xff2638, 0.94).strokeCircle(fighter.position.x, fighter.position.y - 3, 38);
        this.effects.lineStyle(2, 0xffffff, 0.82).strokeCircle(fighter.position.x, fighter.position.y - 3, 46);
        this.activeFxCount += 2;
      }
    }
    const last = this.sim.events.at(-1);
    if (last && this.sim.hitstopFrames > 0 && (last.type === 'parry' || last.type === 'hit' || last.type === 'death')) {
      const x = last.contactX ?? (playerPose.tip.x + aiPose.tip.x) / 2;
      const y = last.contactY ?? (playerPose.tip.y + aiPose.tip.y) / 2;
      if (last.type === 'parry') {
        this.effects.fillStyle(0xffffff, 0.96).fillCircle(x, y, 13).lineStyle(4, 0xffff8a, 0.9).strokeCircle(x, y, 24);
        this.effects.lineStyle(3, 0xffffff, 0.8).lineBetween(x - 18, y - 18, x + 18, y + 18).lineBetween(x - 18, y + 18, x + 18, y - 18);
        this.activeFxCount += 3;
      } else {
        this.effects.fillStyle(0xfff2d5, 0.92).fillCircle(x, y, 9).lineStyle(5, 0xff7a3c, 0.82).lineBetween(x - 17, y + 8, x + 19, y - 10);
        this.activeFxCount += 2;
      }
    }
    for (const [fighter, pose, color] of [[this.sim.player, playerPose, 0x63ffff], [this.sim.ai, aiPose, 0xff69c8]] as const) {
      if (pose.rollPhase === 'rollLanding' && pose.rollProgress < 0.5) {
        const spread = 12 + pose.rollProgress * 24;
        this.effects.lineStyle(3, color, 0.32 * (1 - pose.rollProgress)).strokeEllipse(fighter.position.x, fighter.position.y + 18, spread * 2, spread * 0.65);
        this.effects.fillStyle(0xd6f8ff, 0.36 * (1 - pose.rollProgress)).fillCircle(fighter.position.x - 8, fighter.position.y + 17, 3).fillCircle(fighter.position.x + 10, fighter.position.y + 19, 2);
        this.activeFxCount += 3;
      }
    }
  }

  private drawDebug(playerPose: CombatPose, aiPose: CombatPose, telegraph: AttackTelegraph): void {
    this.debugLayer.clear(); this.debugText.setVisible(this.debug);
    if (!this.debug) return;
    for (const [fighter, pose, color] of [[this.sim.player, playerPose, 0x00ffff], [this.sim.ai, aiPose, 0xff66cc]] as const) {
      this.debugLayer.lineStyle(2, color, 0.8).strokeEllipse(fighter.position.x, fighter.position.y, 44, 32);
      this.debugLayer.lineStyle(2, 0xffffff, 0.9).lineBetween(pose.hand.x, pose.hand.y, pose.tip.x, pose.tip.y);
      this.debugLayer.fillStyle(0xffffff, 0.9).fillCircle(pose.tip.x, pose.tip.y, 3);
      const sweep = activeWeaponSweep(fighter);
      if (sweep) {
        const base = facingAngle(fighter.facing);
        this.debugLayer.fillStyle(color, 0.14).beginPath().moveTo(fighter.position.x, fighter.position.y).arc(fighter.position.x, fighter.position.y, sweep.reach, base + sweep.previousAngle, base + sweep.currentAngle).closePath().fillPath();
      }
    }
    const taps = this.dashDetector.debugState(this.sim.frame);
    const tapText = (key: MoveKey): string => `${key}:${taps[key].firstDownTick ?? '-'}+${taps[key].remainingTicks}${taps[key].released ? 'R' : 'H'}`;
    const dashRemaining = this.sim.player.state === 'dash' ? Math.max(0, GROUND_DASH.duration - this.sim.player.stateFrame) : 0;
    const metrics = this.snapshot();
    this.debugText.setText([
      `tick=${this.sim.frame} fixed=${this.sim.fixedHz}Hz render=${this.lastFrameMs.toFixed(2)}ms avg=${metrics.averageFrameMs.toFixed(2)}ms backlog=${metrics.currentBacklogTicks}/${this.maxBacklogTicks} view=${metrics.cameraZoom.toFixed(2)}x ${metrics.worldView.width.toFixed(0)}x${metrics.worldView.height.toFixed(0)}`,
      `telegraph=${telegraph.active} yellow=${telegraph.yellowArcActive} predicted=${telegraph.predictedContactTick ?? '-'} actual=${this.lastActualContactTick ?? '-'} delta=${this.lastPredictionDelta ?? '-'} ring=${telegraph.ringProgress.toFixed(2)} LMB=${telegraph.promptActive}`,
      `P blade=${this.sim.bladeActionState(this.sim.player)} result=${this.sim.player.lastBladeActionResult} input=${this.sim.player.lastBladeInputFrame ?? '-'} parry=${playerPose.parryActive}/${playerPose.parryTicksRemaining} red=${playerPose.parryActive} break=${this.sim.player.state === 'parried' ? this.sim.player.stateFrame : 0}/${PARRY.attackerStun}`,
      `P roll=${playerPose.rollPhase} invuln=${playerPose.rollInvulnerable} remaining=${this.sim.rollInvulnerableFramesRemaining(this.sim.player)} rotation=${Phaser.Math.RadToDeg(playerPose.rollRotation).toFixed(1)}deg charges=${this.sim.player.dodgeCharges}/2`,
      `P speed=${Math.hypot(this.sim.player.velocity.x, this.sim.player.velocity.y).toFixed(2)} dashDir=(${this.sim.player.velocity.x.toFixed(1)},${this.sim.player.velocity.y.toFixed(1)}) dashDist=${(GROUND_DASH.speed * GROUND_DASH.duration).toFixed(1)} dashRemaining=${dashRemaining} invuln=false`,
      `P anim=${playerPose.animation} phase=${playerPose.phase} progress=${playerPose.phaseProgress.toFixed(2)} weapon=${Phaser.Math.RadToDeg(playerPose.weaponAngle).toFixed(1)} momentum=${this.sim.player.attackForwardMomentum.toFixed(2)}`,
      `doubleTap ${tapText('W')} ${tapText('A')} ${tapText('S')} ${tapText('D')} window=${GROUND_DASH.doubleTapWindow}`,
      `AI anim=${aiPose.animation} attack=${attackTimeline(this.sim.ai)?.phase ?? 'none'} parry=${aiPose.parryActive} red=${aiPose.parryActive} break=${this.sim.ai.state === 'parried' ? this.sim.ai.stateFrame : 0}/${PARRY.attackerStun}`,
      `afterimages=${this.activeAfterimageCount} pooledFX=${this.activeFxCount}/${this.fxPoolCapacity} events=${this.sim.events.slice(-4).map((event) => `${event.type}@${event.contactActiveTick ?? '-'}`).join(',')}`,
    ]);
  }
}

new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: WIDTH, height: HEIGHT, backgroundColor: '#10151c', scene: CombatScene, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true, pixelArt: false }, fps: { target: 60, forceSetTimeOut: false } });

interface BrowserSnapshot {
  ready: boolean; renderedFrames: number; totalFixedTicks: number; fps: number; averageFrameMs: number; maxFrameMs: number;
  currentBacklogTicks: number; maxBacklogTicks: number; droppedBacklogMs: number; focusResetCount: number; cameraZoom: number; worldView: { width: number; height: number }; restartCount: number;
  sceneObjectCount: number; sceneInputListenerCount: number;
  player: { position: { x: number; y: number }; hp: number; state: string; attackPhase: string; parryPhase: string; dodgeCharges: number; bladeActionState: string; parryActive: boolean; parryBreakFrames: number; lastBladeActionResult: string; dashCooldown: number; rollPhase: string; rollInvulnerable: boolean; attackForwardMomentum: number };
  ai: { position: { x: number; y: number }; hp: number; state: string; attackPhase: string; parryPhase: string; parryActive: boolean; parryBreakFrames: number };
  telegraph: { active: boolean; predictedContactTick: number | null; countdownTicks: number | null; ringProgress: number; yellowArcActive: boolean; promptActive: boolean };
  winner: string | null; recentEvents: Array<CombatEvent>;
}

declare global {
  interface Window {
    __GAME_P0A__?: string;
    __GAME_P0B__?: { snapshot: () => BrowserSnapshot; restart: () => void };
  }
}
window.__GAME_P0A__ = 'ready';