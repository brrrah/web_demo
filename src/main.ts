import Phaser from 'phaser';
import { CombatSimulation, SimpleCombatAI, type CombatEvent, type Fighter, type FighterInput } from './combat';
import { activeWeaponSweep, attackTimeline, combatPose, facingAngle, type CombatPose } from './combatMotion';
import { predictAttackTelegraph, type AttackTelegraph } from './combatTelegraph';
import { GROUND_DASH, PARRY } from './combatData';
import { DoubleTapDashDetector, PLAYER_GROUND_BINDINGS, composeDashDirection, type MoveKey } from './groundInput';
import { PARRY_READABILITY, VIEW_FEEL, parryCueStyle, visibleWorldSize } from './presentationData';
import { AI_PROFILE, CHARACTER_PROFILES, resolveCharacterProfile, type CharacterId, type CharacterProfile, type FighterPalette } from './characterProfiles';
import { DEFAULT_LOADOUT, ITEMS, TRAITS, itemById, loadLoadout, sanitizeLoadout, saveLoadout, traitById, type ItemId, type PlayerLoadout, type TraitId } from './playerLoadout';
import { clearAuthSession, createPrototypeSession, isAuthSession, loadAuthSession, saveAuthSession, validateLogin, type AuthSession } from './authSession';
import { HEALTH_HUD, healthFillRect } from './healthHud';

const WIDTH = VIEW_FEEL.viewportWidth; const HEIGHT = VIEW_FEEL.viewportHeight; const STEP_MS = 1000 / 60;


class ProceduralFighterView {
  readonly graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) { this.graphics = scene.add.graphics(); }

  render(fighter: Fighter, pose: CombatPose, profile: CharacterProfile): void {
    this.graphics.clear();
    const palette = profile.palette;
    const displayPalette = pose.parryActive
      ? { body: 0xf22d36, bodyDark: 0x741018, skin: 0xff7676, arm: 0xff3b42, blade: palette.blade, glow: 0xff2028, hair: 0xf22d36, hairDark: 0x741018, accent: 0xff7676 }
      : palette;
    const speed = Math.hypot(fighter.velocity.x, fighter.velocity.y);
    if (pose.animation === 'move' && speed >= VIEW_FEEL.movementTrailThreshold) {
      this.graphics.lineStyle(3, palette.glow, 0.18).lineBetween(fighter.position.x - fighter.velocity.x * 3.4, fighter.position.y - fighter.velocity.y * 3.4 + 18, fighter.position.x - fighter.velocity.x * 0.4, fighter.position.y - fighter.velocity.y * 0.4 + 18);
      this.drawFigure(fighter, pose, profile, displayPalette, 0.09, -fighter.velocity.x * VIEW_FEEL.movementGhostOffset, -fighter.velocity.y * VIEW_FEEL.movementGhostOffset);
    }
    if (pose.animation === 'dash') {
      this.graphics.lineStyle(5, palette.glow, 0.5).lineBetween(fighter.position.x - fighter.velocity.x * 7.4, fighter.position.y - fighter.velocity.y * 7.4 + 18, fighter.position.x - fighter.velocity.x * 0.5, fighter.position.y - fighter.velocity.y * 0.5 + 18);
      for (let ghost = 0; ghost < VIEW_FEEL.dashGhostOffsets.length; ghost += 1) {
        const offset = VIEW_FEEL.dashGhostOffsets[ghost];
        this.drawFigure(fighter, pose, profile, displayPalette, 0.05 + ghost * 0.055, -fighter.velocity.x * offset, -fighter.velocity.y * offset);
      }
    } else if (pose.animation === 'dodge') {
      this.graphics.lineStyle(5, palette.glow, 0.24).lineBetween(fighter.position.x - fighter.velocity.x * 4.2, fighter.position.y - fighter.velocity.y * 4.2 + 19, fighter.position.x - fighter.velocity.x * 0.5, fighter.position.y - fighter.velocity.y * 0.5 + 19);
      this.drawFigure(fighter, pose, profile, displayPalette, 0.08, -fighter.velocity.x * 3.4, -fighter.velocity.y * 3.4);
      this.drawFigure(fighter, pose, profile, displayPalette, 0.18, -fighter.velocity.x * 1.7, -fighter.velocity.y * 1.7);
    }
    const spawnAlpha = pose.animation === 'respawn' ? Math.max(0.25, 1 - fighter.spawnFrames / 16) : 1;
    this.drawFigure(fighter, pose, profile, displayPalette, fighter.flashFrames > 0 ? 1 : spawnAlpha, 0, 0);
  }

  private drawFigure(fighter: Fighter, pose: CombatPose, profile: CharacterProfile, palette: FighterPalette, alpha: number, offsetX: number, offsetY: number): void {
    const g = this.graphics;
    const heroine = profile.silhouette === 'heroine';
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
    const shoulderSpread = (heroine ? 9 : 11) * (1 - pose.rollTuck * 0.48);
    const shoulderLift = 4 - pose.rollTuck * 3;
    const shoulderLeft = { x: body.x + side.x * shoulderSpread, y: body.y + side.y * 7 - shoulderLift };
    const shoulderRight = { x: body.x - side.x * shoulderSpread, y: body.y - side.y * 7 - shoulderLift };
    const hipSpread = (heroine ? 9 : 8) * (1 - pose.rollTuck * 0.62);
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
    if (heroine) {
      const hairRoot = { x: head.x - forward.x * 7, y: head.y - forward.y * 5 + 2 };
      const hairTip = { x: body.x - forward.x * 17 + side.x * 5, y: body.y - forward.y * 9 + 18 };
      g.lineStyle(11, palette.hairDark, alpha).lineBetween(hairRoot.x, hairRoot.y, hairTip.x, hairTip.y);
      g.lineStyle(7, palette.hair, alpha).lineBetween(hairRoot.x + side.x * 3, hairRoot.y + side.y * 3, hairTip.x + side.x * 5, hairTip.y + side.y * 5);
      g.fillStyle(palette.accent, alpha).fillCircle(hairRoot.x + side.x * 5, hairRoot.y + side.y * 5, 4);
    }
    g.fillStyle(palette.body, alpha).beginPath().moveTo(shoulderLeft.x, shoulderLeft.y).lineTo(shoulderRight.x, shoulderRight.y).lineTo(hipRight.x, hipRight.y).lineTo(hipLeft.x, hipLeft.y).closePath().fillPath();
    g.lineStyle(2, palette.bodyDark, alpha).strokeTriangle(shoulderLeft.x, shoulderLeft.y, shoulderRight.x, shoulderRight.y, hipRight.x, hipRight.y);
    if (heroine) {
      const skirtFront = { x: origin.x + forward.x * 2, y: origin.y + forward.y * 2 + 13 };
      g.fillStyle(palette.accent, alpha).beginPath().moveTo(hipLeft.x, hipLeft.y - 3).lineTo(hipRight.x, hipRight.y - 3).lineTo(skirtFront.x - side.x * 13, skirtFront.y - side.y * 7).lineTo(skirtFront.x + side.x * 13, skirtFront.y + side.y * 7).closePath().fillPath();
      g.lineStyle(2, palette.bodyDark, alpha).lineBetween(hipLeft.x, hipLeft.y - 3, hipRight.x, hipRight.y - 3);
    }
    g.fillStyle(fighter.flashFrames > 0 ? 0xffffff : palette.skin, alpha).fillCircle(head.x, head.y, 9);
    if (heroine) {
      g.fillStyle(palette.hair, alpha).fillEllipse(head.x - forward.x * 2, head.y - 5, 20, 13);
      g.fillStyle(palette.hairDark, alpha).fillTriangle(head.x + forward.x * 8, head.y + forward.y * 5 - 4, head.x + side.x * 5 - forward.x * 2, head.y + side.y * 4, head.x - side.x * 5 - forward.x * 2, head.y - side.y * 4);
      g.fillStyle(0x40223d, alpha).fillCircle(head.x + forward.x * 6 + side.x * 2, head.y + forward.y * 4 + side.y * 2, 1.5);
    } else {
      g.fillStyle(palette.bodyDark, alpha).fillTriangle(head.x + forward.x * 12, head.y + forward.y * 9, head.x + side.x * 4, head.y + side.y * 3, head.x - side.x * 4, head.y - side.y * 3);
    }
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
    g.lineStyle(5, heroine ? palette.accent : palette.bodyDark, alpha).lineBetween(hand.x - Math.cos(guardAngle) * 8, hand.y - Math.sin(guardAngle) * 8, hand.x + Math.cos(guardAngle) * 8, hand.y + Math.sin(guardAngle) * 8);
  }
}

function drawSelectionPortrait(g: Phaser.GameObjects.Graphics, x: number, y: number, profile: CharacterProfile): void {
  const palette = profile.palette;
  const heroine = profile.silhouette === 'heroine';
  g.fillStyle(0x05080d, 0.5).fillEllipse(x, y + 108, 112, 26);
  if (heroine) {
    g.lineStyle(24, palette.hairDark, 1).lineBetween(x - 10, y - 58, x - 42, y + 52);
    g.lineStyle(15, palette.hair, 1).lineBetween(x - 6, y - 56, x - 32, y + 48);
    g.fillStyle(palette.accent, 1).fillCircle(x - 17, y - 45, 9);
  }
  g.lineStyle(18, palette.bodyDark, 1).lineBetween(x - 15, y + 56, x - 24, y + 100);
  g.lineBetween(x + 15, y + 56, x + 24, y + 100);
  g.fillStyle(palette.body, 1).fillTriangle(x - (heroine ? 30 : 38), y - 25, x + (heroine ? 30 : 38), y - 25, x, y + 58);
  if (heroine) {
    g.fillStyle(palette.accent, 1).fillTriangle(x - 35, y + 35, x + 35, y + 35, x, y + 72);
  }
  g.fillStyle(palette.skin, 1).fillCircle(x, y - 65, 29);
  if (heroine) {
    g.fillStyle(palette.hair, 1).fillEllipse(x - 3, y - 79, 62, 38);
    g.fillStyle(palette.hairDark, 1).fillTriangle(x - 27, y - 72, x + 28, y - 79, x + 8, y - 52);
    g.fillStyle(0x40223d, 1).fillCircle(x + 11, y - 63, 3);
    g.fillStyle(0xffa8c9, 1).fillCircle(x + 19, y - 54, 3);
  } else {
    g.fillStyle(palette.bodyDark, 1).fillTriangle(x - 34, y - 75, x + 34, y - 75, x, y - 46);
  }
  g.lineStyle(15, palette.arm, 1).lineBetween(x - 25, y - 12, x + 18, y + 12);
  g.lineBetween(x + 25, y - 12, x + 48, y - 1);
  g.fillStyle(palette.skin, 1).fillCircle(x + 48, y - 1, 8);
  g.lineStyle(9, palette.glow, 0.24).lineBetween(x + 44, y - 6, x + 94, y - 77);
  g.lineStyle(5, palette.blade, 1).lineBetween(x + 44, y - 6, x + 94, y - 77);
  g.lineStyle(2, 0xffffff, 0.9).lineBetween(x + 44, y - 6, x + 94, y - 77);
  g.lineStyle(8, heroine ? palette.accent : palette.bodyDark, 1).lineBetween(x + 35, y - 11, x + 52, y + 2);
}

const LOADOUT_REGISTRY_KEY = 'player-loadout';
const AUTH_REGISTRY_KEY = 'auth-session';

function safeSessionStorage(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

function readSceneAuth(scene: Phaser.Scene): AuthSession | null {
  const cached = scene.registry.get(AUTH_REGISTRY_KEY) as unknown;
  if (isAuthSession(cached)) return cached;
  const session = loadAuthSession(safeSessionStorage());
  if (session) scene.registry.set(AUTH_REGISTRY_KEY, session);
  return session;
}

function persistSceneAuth(scene: Phaser.Scene, session: AuthSession): AuthSession {
  const saved = saveAuthSession(safeSessionStorage(), session);
  scene.registry.set(AUTH_REGISTRY_KEY, saved);
  return saved;
}

function clearSceneAuth(scene: Phaser.Scene): void {
  clearAuthSession(safeSessionStorage());
  scene.registry.remove(AUTH_REGISTRY_KEY);
}

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function readSceneLoadout(scene: Phaser.Scene): PlayerLoadout {
  const cached = scene.registry.get(LOADOUT_REGISTRY_KEY) as unknown;
  const loadout = cached ? sanitizeLoadout(cached) : loadLoadout(safeLocalStorage());
  scene.registry.set(LOADOUT_REGISTRY_KEY, loadout);
  return loadout;
}

function persistSceneLoadout(scene: Phaser.Scene, loadout: PlayerLoadout): PlayerLoadout {
  const saved = saveLoadout(safeLocalStorage(), loadout);
  scene.registry.set(LOADOUT_REGISTRY_KEY, saved);
  return saved;
}

function drawMenuBackground(scene: Phaser.Scene): void {
  scene.cameras.main.setBackgroundColor('#0b0f18');
  const background = scene.add.graphics();
  background.fillGradientStyle(0x101a2b, 0x101a2b, 0x261329, 0x261329, 1).fillRect(0, 0, WIDTH, HEIGHT);
  background.lineStyle(1, 0x5a6a82, 0.18);
  for (let x = 0; x <= WIDTH; x += 48) background.lineBetween(x, 0, x, HEIGHT);
  for (let y = 0; y <= HEIGHT; y += 48) background.lineBetween(0, y, WIDTH, y);
}

interface MenuButton {
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

function createMenuButton(scene: Phaser.Scene, x: number, y: number, width: number, label: string, onClick: () => void): MenuButton {
  const background = scene.add.rectangle(x, y, width, 58, 0x182335, 0.98).setStrokeStyle(2, 0x53677f, 1).setInteractive({ useHandCursor: true });
  const text = scene.add.text(x, y, label, { fontFamily: 'Arial, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#f5f7fa' }).setOrigin(0.5);
  background.on('pointerdown', onClick);
  return { background, label: text };
}

class LoginScene extends Phaser.Scene {
  private errorText!: Phaser.GameObjects.Text;
  private formElement: HTMLFormElement | null = null;
  private submitHandler: ((event: Event) => void) | null = null;

  constructor() { super('login'); }

  create(): void {
    if (readSceneAuth(this)) {
      this.scene.start('main-menu');
      return;
    }
    drawMenuBackground(this);
    this.add.text(WIDTH / 2, 92, 'NEON BLADE', { fontFamily: 'Arial, sans-serif', fontSize: '48px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
    this.add.text(WIDTH / 2, 142, 'MULTIPLAYER ACCOUNT GATE', { fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#77f4ff' }).setOrigin(0.5);
    this.add.rectangle(WIDTH / 2, 340, 430, 350, 0x111a28, 0.98).setStrokeStyle(3, 0x53677f, 1);
    this.add.text(WIDTH / 2, 205, 'SIGN IN', { fontFamily: 'Arial, sans-serif', fontSize: '27px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);

    const form = document.createElement('form');
    Object.assign(form.style, {
      width: '330px', display: 'flex', flexDirection: 'column', gap: '10px',
      fontFamily: 'Arial, sans-serif', color: '#f5f7fa',
    });
    const userLabel = document.createElement('label');
    userLabel.textContent = 'PLAYER ID';
    Object.assign(userLabel.style, { fontSize: '12px', letterSpacing: '1px', color: '#a9b7c9' });
    const username = document.createElement('input');
    username.name = 'username';
    username.type = 'text';
    username.autocomplete = 'username';
    username.maxLength = 32;
    username.placeholder = 'player01';
    const passwordLabel = document.createElement('label');
    passwordLabel.textContent = 'PASSWORD';
    Object.assign(passwordLabel.style, { fontSize: '12px', letterSpacing: '1px', color: '#a9b7c9', marginTop: '4px' });
    const password = document.createElement('input');
    password.name = 'password';
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.placeholder = '4+ characters';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'SIGN IN';
    for (const input of [username, password]) {
      Object.assign(input.style, {
        height: '42px', padding: '0 12px', border: '2px solid #53677f', borderRadius: '4px',
        background: '#0b111c', color: '#ffffff', fontSize: '16px', outlineColor: '#75f4ff',
      });
    }
    Object.assign(submit.style, {
      height: '46px', marginTop: '10px', border: '2px solid #75f4ff', borderRadius: '4px',
      background: '#23475b', color: '#ffffff', fontSize: '16px', fontWeight: '700', cursor: 'pointer',
    });
    form.append(userLabel, username, passwordLabel, password, submit);
    this.add.dom(WIDTH / 2, 342, form).setOrigin(0.5);
    this.errorText = this.add.text(WIDTH / 2, 476, '', { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#ff7d91' }).setOrigin(0.5);
    this.add.text(WIDTH / 2, 518, 'Prototype login: no password is stored. Server authentication is not connected yet.', {
      fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#9aa7b8', align: 'center',
    }).setOrigin(0.5);

    this.formElement = form;
    this.submitHandler = (event: Event): void => {
      event.preventDefault();
      const validation = validateLogin(username.value, password.value);
      if (!validation.valid) {
        this.errorText.setText(validation.error ?? 'Unable to sign in.');
        return;
      }
      const session = createPrototypeSession(validation.username);
      persistSceneAuth(this, session);
      password.value = '';
      this.scene.start('main-menu');
    };
    form.addEventListener('submit', this.submitHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.formElement && this.submitHandler) this.formElement.removeEventListener('submit', this.submitHandler);
      this.formElement = null;
      this.submitHandler = null;
    });
    window.setTimeout(() => username.focus(), 0);
  }
}
class MainMenuScene extends Phaser.Scene {
  private selectedIndex = 0;
  private buttons: MenuButton[] = [];

  constructor() { super('main-menu'); }

  create(): void {
    const auth = readSceneAuth(this);
    if (!auth) { this.scene.start('login'); return; }
    delete window.__GAME_P0B__;
    this.selectedIndex = 0;
    this.buttons = [];
    drawMenuBackground(this);
    const loadout = readSceneLoadout(this);
    const profile = resolveCharacterProfile(loadout.characterId);

    this.add.text(WIDTH / 2, 105, 'NEON BLADE', { fontFamily: 'Arial, sans-serif', fontSize: '52px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
    this.add.text(WIDTH / 2, 158, 'QUARTER-VIEW DUEL PROTOTYPE', { fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#77f4ff' }).setOrigin(0.5);
    this.add.text(925, 28, 'SIGNED IN // ' + auth.displayName.toUpperCase(), { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#a9b7c9' }).setOrigin(1, 0);
    const logout = this.add.rectangle(865, 68, 120, 34, 0x281923, 1).setStrokeStyle(2, 0xc45b78, 1).setInteractive({ useHandCursor: true });
    this.add.text(865, 68, 'LOG OUT', { fontFamily: 'Arial, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#ff9db5' }).setOrigin(0.5);
    logout.on('pointerdown', () => this.logout());

    this.buttons.push(createMenuButton(this, WIDTH / 2, 282, 360, 'QUICK MATCH', () => this.startSelected(0)));
    this.buttons.push(createMenuButton(this, WIDTH / 2, 360, 360, 'WAREHOUSE / PERSONAL PAGE', () => this.startSelected(1)));

    this.add.text(WIDTH / 2, 445, `CURRENT  ${profile.name}  /  ${traitById(loadout.traitId).name}  /  ${itemById(loadout.itemId).name}`, {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#d6dce7', backgroundColor: '#101722dd', padding: { x: 14, y: 9 },
    }).setOrigin(0.5);
    this.add.text(WIDTH / 2, 540, 'W / S or UP / DOWN to choose - ENTER to confirm', { fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#e8c95d' }).setOrigin(0.5);

    const keyboard = this.input.keyboard!;
    keyboard.on('keydown-W', () => this.select(this.selectedIndex - 1));
    keyboard.on('keydown-UP', () => this.select(this.selectedIndex - 1));
    keyboard.on('keydown-S', () => this.select(this.selectedIndex + 1));
    keyboard.on('keydown-DOWN', () => this.select(this.selectedIndex + 1));
    keyboard.on('keydown-ENTER', () => this.startSelected(this.selectedIndex));
    this.refreshButtons();
  }

  private select(index: number): void {
    this.selectedIndex = Phaser.Math.Wrap(index, 0, this.buttons.length);
    this.refreshButtons();
  }

  private refreshButtons(): void {
    this.buttons.forEach((button, index) => {
      const selected = index === this.selectedIndex;
      button.background.setFillStyle(selected ? 0x29435a : 0x182335, 0.98);
      button.background.setStrokeStyle(selected ? 4 : 2, selected ? 0x75f4ff : 0x53677f, 1);
      button.label.setColor(selected ? '#ffffff' : '#c5ceda');
    });
  }

  private logout(): void {
    clearSceneAuth(this);
    this.scene.start('login');
  }

  private startSelected(index: number): void {
    if (index === 1) {
      this.scene.start('warehouse');
      return;
    }
    this.scene.start('combat', { loadout: readSceneLoadout(this) });
  }
}

type WarehouseTab = 'character' | 'trait' | 'item';

class WarehouseScene extends Phaser.Scene {
  private loadout: PlayerLoadout = { ...DEFAULT_LOADOUT };
  private activeTab: WarehouseTab = 'character';
  private content!: Phaser.GameObjects.Container;
  private summary!: Phaser.GameObjects.Text;
  private tabButtons: Array<{ tab: WarehouseTab; background: Phaser.GameObjects.Rectangle }> = [];

  constructor() { super('warehouse'); }

  create(): void {
    const auth = readSceneAuth(this);
    if (!auth) { this.scene.start('login'); return; }
    delete window.__GAME_P0B__;
    this.loadout = readSceneLoadout(this);
    this.activeTab = 'character';
    this.tabButtons = [];
    drawMenuBackground(this);

    this.add.text(36, 28, 'WAREHOUSE // PERSONAL LOADOUT', { fontFamily: 'Arial, sans-serif', fontSize: '29px', fontStyle: 'bold', color: '#ffffff' });
    this.add.text(38, 67, 'Visual loadout is saved now. Trait and item effects are reserved for a later balance pass.', { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#a9b7c9' });
    this.add.text(922, 78, 'SIGNED IN // ' + auth.displayName.toUpperCase(), { fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#8f9bad' }).setOrigin(1, 0);

    const tabs: Array<{ tab: WarehouseTab; label: string }> = [
      { tab: 'character', label: '1  CHARACTER' },
      { tab: 'trait', label: '2  TRAIT' },
      { tab: 'item', label: '3  ITEM' },
    ];
    tabs.forEach((entry, index) => {
      const x = 190 + index * 210;
      const background = this.add.rectangle(x, 118, 188, 44, 0x172130, 1).setStrokeStyle(2, 0x53677f, 1).setInteractive({ useHandCursor: true });
      this.add.text(x, 118, entry.label, { fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
      background.on('pointerdown', () => this.setTab(entry.tab));
      this.tabButtons.push({ tab: entry.tab, background });
    });

    this.content = this.add.container(0, 0);
    this.summary = this.add.text(922, 28, '', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#dce5ef', align: 'right' }).setOrigin(1, 0);

    createMenuButton(this, 195, 558, 250, 'SAVE & BACK', () => this.saveAndBack());
    createMenuButton(this, 765, 558, 250, 'DEPLOY', () => this.deploy());

    const keyboard = this.input.keyboard!;
    keyboard.on('keydown-ONE', () => this.setTab('character'));
    keyboard.on('keydown-TWO', () => this.setTab('trait'));
    keyboard.on('keydown-THREE', () => this.setTab('item'));
    keyboard.on('keydown-LEFT', () => this.shiftSelection(-1));
    keyboard.on('keydown-A', () => this.shiftSelection(-1));
    keyboard.on('keydown-RIGHT', () => this.shiftSelection(1));
    keyboard.on('keydown-D', () => this.shiftSelection(1));
    keyboard.on('keydown-ESC', () => this.saveAndBack());
    keyboard.on('keydown-ENTER', () => this.deploy());

    this.renderContent();
    this.refreshSummary();
  }

  private setTab(tab: WarehouseTab): void {
    this.activeTab = tab;
    this.renderContent();
  }

  private renderContent(): void {
    this.content.removeAll(true);
    this.tabButtons.forEach(({ tab, background }) => {
      const selected = tab === this.activeTab;
      background.setFillStyle(selected ? 0x29435a : 0x172130, 1);
      background.setStrokeStyle(selected ? 4 : 2, selected ? 0x75f4ff : 0x53677f, 1);
    });
    if (this.activeTab === 'character') {
      this.renderCharacterOptions();
      return;
    }
    this.renderLoadoutOptions(this.activeTab);
  }

  private renderCharacterOptions(): void {
    CHARACTER_PROFILES.forEach((profile, index) => {
      const x = WIDTH / 2 + (index - (CHARACTER_PROFILES.length - 1) / 2) * 330;
      const selected = this.loadout.characterId === profile.id;
      const card = this.add.rectangle(x, 334, 288, 340, selected ? 0x29384e : 0x151d29, 0.98)
        .setStrokeStyle(selected ? 5 : 2, selected ? profile.palette.glow : 0x52637a, 1)
        .setInteractive({ useHandCursor: true });
      const preview = this.add.graphics();
      drawSelectionPortrait(preview, x, 285, profile);
      const name = this.add.text(x, 428, profile.name, { fontFamily: 'Arial, sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
      const subtitle = this.add.text(x, 458, profile.subtitle, { fontFamily: 'Arial, sans-serif', fontSize: '17px', color: profile.palette.glow === 0x63ffff ? '#75f4ff' : '#ff9bdc' }).setOrigin(0.5);
      const equipped = this.add.text(x, 488, selected ? 'EQUIPPED' : 'CLICK TO EQUIP', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: selected ? '#ffe16a' : '#8f9bab' }).setOrigin(0.5);
      card.on('pointerdown', () => this.equipCharacter(profile.id));
      this.content.add([card, preview, name, subtitle, equipped]);
    });
  }

  private renderLoadoutOptions(kind: 'trait' | 'item'): void {
    const options = kind === 'trait' ? TRAITS : ITEMS;
    options.forEach((option, index) => {
      const x = 210 + index * 270;
      const selected = kind === 'trait' ? this.loadout.traitId === option.id : this.loadout.itemId === option.id;
      const color = kind === 'trait' ? 0xa879ff : 0x70e9ff;
      const card = this.add.rectangle(x, 342, 232, 300, selected ? 0x302d4d : 0x151d29, 0.98)
        .setStrokeStyle(selected ? 5 : 2, selected ? color : 0x52637a, 1)
        .setInteractive({ useHandCursor: true });
      const icon = this.add.graphics();
      icon.fillStyle(color, selected ? 0.34 : 0.18).fillCircle(x, 270, 46);
      icon.lineStyle(4, color, 0.9).strokeCircle(x, 270, 32 + index * 3);
      if (kind === 'trait') {
        icon.lineStyle(4, 0xffffff, 0.7).lineBetween(x - 20, 270, x + 20, 270).lineBetween(x, 250, x, 290);
      } else {
        icon.lineStyle(6, 0xffffff, 0.76).lineBetween(x - 17, 288, x + 19, 250);
        icon.lineStyle(5, color, 0.95).lineBetween(x - 22, 279, x - 9, 292);
      }
      const name = this.add.text(x, 342, option.name, { fontFamily: 'Arial, sans-serif', fontSize: '17px', fontStyle: 'bold', color: '#ffffff', align: 'center', wordWrap: { width: 200 } }).setOrigin(0.5);
      const description = this.add.text(x, 399, option.description, { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#b5c0ce', align: 'center', wordWrap: { width: 194 } }).setOrigin(0.5);
      const equipped = this.add.text(x, 465, selected ? 'EQUIPPED' : 'CLICK TO EQUIP', { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: selected ? '#ffe16a' : '#8f9bab' }).setOrigin(0.5);
      card.on('pointerdown', () => {
        if (kind === 'trait') this.equipTrait(option.id as TraitId);
        else this.equipItem(option.id as ItemId);
      });
      this.content.add([card, icon, name, description, equipped]);
    });
  }

  private equipCharacter(characterId: CharacterId): void {
    this.loadout = persistSceneLoadout(this, { ...this.loadout, characterId });
    this.renderContent();
    this.refreshSummary();
  }

  private equipTrait(traitId: TraitId): void {
    this.loadout = persistSceneLoadout(this, { ...this.loadout, traitId });
    this.renderContent();
    this.refreshSummary();
  }

  private equipItem(itemId: ItemId): void {
    this.loadout = persistSceneLoadout(this, { ...this.loadout, itemId });
    this.renderContent();
    this.refreshSummary();
  }

  private shiftSelection(direction: number): void {
    if (this.activeTab === 'character') {
      const index = CHARACTER_PROFILES.findIndex((profile) => profile.id === this.loadout.characterId);
      this.equipCharacter(CHARACTER_PROFILES[Phaser.Math.Wrap(index + direction, 0, CHARACTER_PROFILES.length)].id);
      return;
    }
    if (this.activeTab === 'trait') {
      const index = TRAITS.findIndex((option) => option.id === this.loadout.traitId);
      this.equipTrait(TRAITS[Phaser.Math.Wrap(index + direction, 0, TRAITS.length)].id);
      return;
    }
    const index = ITEMS.findIndex((option) => option.id === this.loadout.itemId);
    this.equipItem(ITEMS[Phaser.Math.Wrap(index + direction, 0, ITEMS.length)].id);
  }

  private refreshSummary(): void {
    this.summary.setText([
      resolveCharacterProfile(this.loadout.characterId).name,
      traitById(this.loadout.traitId).name,
      itemById(this.loadout.itemId).name,
    ]);
  }

  private saveAndBack(): void {
    persistSceneLoadout(this, this.loadout);
    this.scene.start('main-menu');
  }

  private deploy(): void {
    const loadout = persistSceneLoadout(this, this.loadout);
    this.scene.start('combat', { loadout });
  }
}

class CombatScene extends Phaser.Scene {
  private sim = new CombatSimulation();
  private ai = new SimpleCombatAI();
  private selectedCharacter: CharacterProfile = resolveCharacterProfile(undefined);
  private loadout: PlayerLoadout = { ...DEFAULT_LOADOUT };
  private authSession: AuthSession | null = null;
  private accumulator = 0;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private playerView!: ProceduralFighterView;
  private aiView!: ProceduralFighterView;
  private arena!: Phaser.GameObjects.Graphics;
  private telegraphLayer!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Graphics;
  private debugLayer!: Phaser.GameObjects.Graphics;
  private healthHud!: Phaser.GameObjects.Graphics;
  private playerHealthText!: Phaser.GameObjects.Text;
  private aiHealthText!: Phaser.GameObjects.Text;
  private roundTimerText!: Phaser.GameObjects.Text;
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

  init(data: { loadout?: PlayerLoadout } = {}): void {
    this.loadout = persistSceneLoadout(this, data.loadout ?? readSceneLoadout(this));
    this.selectedCharacter = resolveCharacterProfile(this.loadout.characterId);
    this.sim = new CombatSimulation();
    this.ai = new SimpleCombatAI();
    this.dashDetector.reset();
    this.accumulator = 0;
    this.frameTimes = [];
    this.renderedFrames = 0;
    this.totalFixedTicks = 0;
    this.maxBacklogTicks = 0;
    this.droppedBacklogMs = 0;
  }

  create(): void {
    this.authSession = readSceneAuth(this);
    if (!this.authSession) { this.scene.start('login'); return; }
    this.cameras.main.setBackgroundColor('#10151c');
    this.arena = this.add.graphics(); this.telegraphLayer = this.add.graphics(); this.effects = this.add.graphics(); this.debugLayer = this.add.graphics();
    this.drawArena();
    this.playerView = new ProceduralFighterView(this); this.aiView = new ProceduralFighterView(this);
    this.healthHud = this.add.graphics().setDepth(10);
    this.playerHealthText = this.add.text(HEALTH_HUD.leftX + 10, HEALTH_HUD.y + 3, '', { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#ffffff' }).setDepth(11);
    this.aiHealthText = this.add.text(HEALTH_HUD.rightX + HEALTH_HUD.width - 10, HEALTH_HUD.y + 3, '', { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(1, 0).setDepth(11);
    this.roundTimerText = this.add.text(WIDTH / 2, HEALTH_HUD.y - 3, '', { fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#101722dd', padding: { x: 12, y: 2 } }).setOrigin(0.5, 0).setDepth(11);
    this.hud = this.add.text(20, 58, '', { fontFamily: 'monospace', fontSize: '14px', color: '#f5f7fa' }).setDepth(10);
    this.parryCue = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: PARRY_READABILITY.countdownFontSize.toString() + 'px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#7d5b00dd', padding: { x: 11, y: 6 } }).setOrigin(0.5).setDepth(13).setVisible(false);
    this.attackWarningCue = this.add.text(0, 0, 'WINDUP', { fontFamily: 'monospace', fontSize: PARRY_READABILITY.windupFontSize.toString() + 'px', fontStyle: 'bold', color: '#231900', backgroundColor: '#ffd84fe8', padding: { x: 8, y: 4 } }).setOrigin(0.5).setDepth(12).setVisible(false);
    this.parryBreakCue = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#fff3d0', backgroundColor: '#8a1f16e6', padding: { x: 8, y: 4 } }).setOrigin(0.5).setDepth(11).setVisible(false);
    this.debugText = this.add.text(20, 380, '', { fontFamily: 'monospace', fontSize: '12px', color: '#9fffc2', backgroundColor: '#000c', padding: { x: 8, y: 6 } }).setDepth(12);
    this.cameras.main.setZoom(VIEW_FEEL.worldCameraZoom).centerOn(VIEW_FEEL.worldCenterX, VIEW_FEEL.worldCenterY);
    this.uiCamera = this.cameras.add(0, 0, WIDTH, HEIGHT).setName('ui');
    this.cameras.main.ignore([this.healthHud, this.playerHealthText, this.aiHealthText, this.roundTimerText, this.hud, this.debugText, this.parryCue, this.attackWarningCue, this.parryBreakCue]);
    this.uiCamera.ignore([this.arena, this.telegraphLayer, this.effects, this.debugLayer, this.playerView.graphics, this.aiView.graphics]);
    const keyboard = this.input.keyboard!;
    this.keys = keyboard.addKeys('W,A,S,D,SPACE,Q,R,F3,SHIFT,ESC') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => { if (pointer.leftButtonDown()) this.pending.light = true; if (pointer.rightButtonDown()) this.pending.heavy = true; });
    this.input.mouse?.disableContextMenu();
    for (const key of ['W', 'A', 'S', 'D'] as MoveKey[]) {
      keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        const dash = this.dashDetector.keyDown(key, this.sim.frame, event.repeat);
        if (dash) {
          const heldMove = {
            x: Number(this.keys.D.isDown) - Number(this.keys.A.isDown),
            y: Number(this.keys.S.isDown) - Number(this.keys.W.isDown),
          };
          this.pending.dash = composeDashDirection(dash, heldMove);
        }
      });
      keyboard.on(`keyup-${key}`, () => this.dashDetector.keyUp(key));
    }
    keyboard.on(`keydown-${PLAYER_GROUND_BINDINGS.roll}`, () => { this.pending.dodge = true; });
    keyboard.on(`keydown-${PLAYER_GROUND_BINDINGS.feint}`, () => { this.pending.feint = true; });
    keyboard.on('keydown-R', () => this.restart());
    keyboard.on('keydown-ESC', () => this.scene.start('main-menu'));
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
      ready: true, characterId: this.selectedCharacter.id, traitId: this.loadout.traitId, itemId: this.loadout.itemId, renderedFrames: this.renderedFrames, totalFixedTicks: this.totalFixedTicks,
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
    this.playerView.render(this.sim.player, playerPose, this.selectedCharacter); this.aiView.render(this.sim.ai, aiPose, AI_PROFILE);
    this.drawTelegraph(telegraph);
    this.drawEffects(playerPose, aiPose);
    this.drawParryBreakCue();
    const seconds = Math.ceil(this.sim.roundFrames / 60);
    this.drawHealthHud(seconds);
    this.hud.setText(['WASD move | hold perpendicular + double-tap = diagonal dash | mouse aim', 'LOADOUT ' + traitById(this.loadout.traitId).name + ' / ' + itemById(this.loadout.itemId).name + ' (visual preset)', 'WINDUP + 6..1 ring = real contact timing | LMB! = intercept now | RED = active parry', 'PARRY SUCCESS = enemy PARRY BREAK for 1.0s', 'LMB otherwise light | RMB heavy | Shift+RMB delay | Q feint | Space phased invulnerable roll | R restart | Esc main menu | F3 debug', this.sim.winner ? 'WINNER: ' + this.sim.winner.toUpperCase() + ' - press R' : ''].filter(Boolean));
    this.drawDebug(playerPose, aiPose, telegraph);
  }

  private drawHealthHud(seconds: number): void {
    const playerFill = healthFillRect('left', this.sim.player.hp);
    const aiFill = healthFillRect('right', this.sim.ai.hp);
    const g = this.healthHud;
    g.clear();
    g.fillStyle(0x070b12, 0.94)
      .fillRect(HEALTH_HUD.leftX, HEALTH_HUD.y, HEALTH_HUD.width, HEALTH_HUD.height)
      .fillRect(HEALTH_HUD.rightX, HEALTH_HUD.y, HEALTH_HUD.width, HEALTH_HUD.height);
    g.fillStyle(this.selectedCharacter.palette.bodyDark, 0.8)
      .fillRect(HEALTH_HUD.leftX + HEALTH_HUD.inset, HEALTH_HUD.y + HEALTH_HUD.inset, HEALTH_HUD.width - HEALTH_HUD.inset * 2, HEALTH_HUD.height - HEALTH_HUD.inset * 2);
    g.fillStyle(AI_PROFILE.palette.bodyDark, 0.8)
      .fillRect(HEALTH_HUD.rightX + HEALTH_HUD.inset, HEALTH_HUD.y + HEALTH_HUD.inset, HEALTH_HUD.width - HEALTH_HUD.inset * 2, HEALTH_HUD.height - HEALTH_HUD.inset * 2);
    if (playerFill.width > 0) g.fillStyle(this.selectedCharacter.palette.body, 1).fillRect(playerFill.x, playerFill.y, playerFill.width, playerFill.height);
    if (aiFill.width > 0) g.fillStyle(AI_PROFILE.palette.body, 1).fillRect(aiFill.x, aiFill.y, aiFill.width, aiFill.height);
    g.lineStyle(3, this.selectedCharacter.palette.glow, 0.9).strokeRect(HEALTH_HUD.leftX, HEALTH_HUD.y, HEALTH_HUD.width, HEALTH_HUD.height);
    g.lineStyle(3, AI_PROFILE.palette.glow, 0.9).strokeRect(HEALTH_HUD.rightX, HEALTH_HUD.y, HEALTH_HUD.width, HEALTH_HUD.height);
    for (let segment = 1; segment < 4; segment += 1) {
      const leftX = HEALTH_HUD.leftX + HEALTH_HUD.width * segment / 4;
      const rightX = HEALTH_HUD.rightX + HEALTH_HUD.width * segment / 4;
      g.lineStyle(1, 0xffffff, 0.22).lineBetween(leftX, HEALTH_HUD.y + 3, leftX, HEALTH_HUD.y + HEALTH_HUD.height - 3);
      g.lineBetween(rightX, HEALTH_HUD.y + 3, rightX, HEALTH_HUD.y + HEALTH_HUD.height - 3);
    }
    this.playerHealthText
      .setColor(this.sim.player.hp <= 25 ? '#ffd0d0' : '#ffffff')
      .setText((this.authSession?.displayName.toUpperCase() ?? 'PLAYER') + ' / ' + this.selectedCharacter.name + '  HP ' + this.sim.player.hp.toString().padStart(3));
    this.aiHealthText
      .setColor(this.sim.ai.hp <= 25 ? '#ffd0d0' : '#ffffff')
      .setText('HP ' + this.sim.ai.hp.toString().padStart(3) + '  RIVAL AI');
    this.roundTimerText.setText(seconds.toString().padStart(2, '0') + 's');
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

new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: WIDTH, height: HEIGHT, backgroundColor: '#10151c', scene: [LoginScene, MainMenuScene, WarehouseScene, CombatScene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true, pixelArt: false }, fps: { target: 60, forceSetTimeOut: false }, dom: { createContainer: true } });

interface BrowserSnapshot {
  ready: boolean; characterId: CharacterId; traitId: TraitId; itemId: ItemId; renderedFrames: number; totalFixedTicks: number; fps: number; averageFrameMs: number; maxFrameMs: number;
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