# GAME-P0B Manual Browser Completion Procedure

1. Run `npm run build`, then `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort`.
2. Open `http://127.0.0.1:4174/`; confirm the 960x600 arena, both fighters, HUD, and no console error.
3. Press F3 and retain `window.__GAME_P0B__.snapshot()` before testing.
4. Verify WASD in eight directions, mouse aim at each canvas corner, left-click light attack, right-click heavy attack, Shift+right-click delayed heavy, Space dodge, and F parry.
5. While holding a movement key, switch focus away and return. Confirm movement is not stuck, `focusResetCount` increased, and `currentBacklogTicks` returned to zero without a tick burst.
6. Reproduce: approach -> light poke -> dodge -> delayed heavy -> early parry failure -> re-approach -> correctly timed parry -> counterattack. Record visible attack telegraphs and `recentEvents`.
7. Spam F through at least three recovery cycles and Space until both charges are depleted. Confirm recovery/cooldown leaves punishable gaps and dodge charges recover only after 90 fixed ticks.
8. Press R ten times, then compare `sceneObjectCount` and `sceneInputListenerCount` with step 3. Confirm `restartCount` increased by ten and no timer/input/event residue appears.
9. Leave F3 enabled for at least 60 seconds. Record `fps`, `averageFrameMs`, `maxFrameMs`, `maxBacklogTicks`, and `droppedBacklogMs` from the snapshot.
10. Attach the measured values and screenshots to `reports/game_p0b_browser_validation.json`; only then reconsider PASS.
