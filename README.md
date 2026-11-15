# NEON BREACH — a 3v3 tactical FPS in three.js

A round-based, Counter-Strike-style tactical first-person shooter that runs
offline in a desktop browser from static files — no build step, no network
requests. Built for the make.fun bounty **threejs-fps-02** ("Make the best
three.js tactical FPS").

## The game

Two teams of three fight over two bomb sites in the **Sector 7 Foundry**:

- **Vanguard** (you + 2 bot teammates) attacks; **Crimson** (3 bots) defends.
- **Rounds**: first to 5 wins the match. A round is won by eliminating the
  other squad, detonating the spike at Site A or B, or — for the defenders —
  running the clock out or defusing the spike.
- **The spike**: the carrier plants it by holding `E` on a site (3 s). Once
  planted it ticks for 40 s; defenders defuse by holding `E` on it (5 s).
- **Economy**: $800 to start, +$300 per kill, +$3,250 for a round win,
  +$1,900 for a loss. Spend it in the buy phase (`B`): VK-9 SMG ($1,500),
  AR-77 rifle ($2,700), LR-50 marksman ($4,750), Kevlar vest ($650).
- **Gunplay**: hitscan weapons with spread, recoil bloom, movement penalties,
  crouch bonuses, headshots, armor, tracers, muzzle flash and impact sparks.
  The LR-50 scopes with right-click.
- **Bots**: waypoint navigation, line-of-sight duels with reaction time and
  aim error, burst discipline, strafing, site holds, mid roams, plant and
  defuse behaviour, and bomb-carrier handoff when the carrier dies.
- **HUD**: health/armor bars, ammo, money, round timer, round pips, alive
  counts, kill feed, hitmarkers, damage direction, plant/defuse progress,
  a live minimap (enemies appear only while "spotted"), and a scoreboard.
- **Sound**: fully synthesized with WebAudio — no audio assets.

## Play

```sh
node serve.ts        # serves game/ on http://localhost:8080
```

Open http://localhost:8080, click **CLICK TO PLAY**, and fight. `WASD` move,
mouse look, click fire, `R` reload, `Shift` walk, `Space` jump, `Ctrl`
crouch, `E` plant/defuse, `B` buy, `1–4` weapons, `Tab` scoreboard, `M` mute.

Screenshot staging (deterministic, seeded): `?shot=start|play|buy|end&seed=1`.

## Entry program

`main.ts` (Node 22) copies `game/` and `screenshots/` to `/output` and
writes `/output/dossier.json` with `vendor/makefun-threejs.ts` from the kit.
three.js 0.187.0 is vendored byte-for-byte under `game/vendor/three/`.

## License

MIT — see `LICENSE`.
