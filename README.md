# Neon Blade 1v1 Combat Graybox

TypeScript, Vite, and Phaser 3 graybox for deterministic 60 Hz 1v1 combat. Combat displays mirrored player/AI health bars with a centered round timer.

The game opens on a prototype sign-in page and gates the main menu behind a browser session. Passwords are never stored; real multiplayer authentication still requires a server/API.

The game opens on a main menu. The Warehouse / Personal Page stores the selected character, trait preset, and item preset in browser storage. Character choice is visual; trait and item effects are intentionally not applied to combat balance yet.

## Controls

- Sign in: player ID plus a 4+ character prototype password
- Main menu: use LOG OUT to clear the current browser session

- WASD: move
- Mouse: aim
- Main menu: W/S or arrow keys, Enter to confirm
- Warehouse tabs: 1 Character, 2 Trait, 3 Item
- Warehouse selection: A/D or arrow keys, click a card to equip, Enter to deploy, Escape to save and return
- Left click: 3-tick blade intercept; continues into light attack when no parry contact occurs
- Right click: heavy attack; hold Shift when starting to add a short delay
- Double-tap WASD: non-invulnerable ground dash
- Diagonal dash: hold a perpendicular direction, then double-tap the other axis (for example hold D + WW)
- Space: directional invulnerable roll
- Q: feint during a legal pre-commitment window
- R: immediate round restart
- Escape during combat: return to the main menu
- F3: debug hitboxes, states, attack/parry phases, and frame time

## Commands

```sh
npm run dev
npm test
npm run lint
npm run build
```
