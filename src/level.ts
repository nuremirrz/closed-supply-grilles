import * as THREE from 'three'
import {
  activeCameraPreset,
  flyToCameraPresetByName,
  type CameraPreset,
  type ClickTarget,
  type HudProgressBase,
  type LabelConfig,
  type ReadingTaker,
  type SceneContext,
  type StateConfig,
  type TaskConfig,
  type Tool,
} from '@hvac/engine'
import type { WardrobeApi } from './wardrobe'

/**
 * Nodes this level's GLB is expected to carry. TEMPORARY scaffolding for the
 * model swap — `louvers`, `lever` and `supply_bedroom` are new in v2, so this
 * confirms they actually arrived. Drop it once the level's mechanics are wired.
 */
export const EXPECTED_OBJECTS = [
  'house_shell',
  'supply_duct',
  'supply_bedroom',
  'return_grille',
  'filter',
  'anemometer',
  'wardrobe',
  'louvers',
  'lever',
]

/** Logs a ✅/❌ per expected node. Call from the loadModel callback. */
export function checkModelObjects(ctx: SceneContext): void {
  const missing: string[] = []
  const lines = EXPECTED_OBJECTS.map((name) => {
    const found = !!ctx.scene.getObjectByName(name)
    if (!found) missing.push(name)
    return `${found ? '✅' : '❌'} ${name}`
  })
  console.log(
    `[model] ${EXPECTED_OBJECTS.length - missing.length}/${EXPECTED_OBJECTS.length} expected nodes found\n` +
      lines.join('\n'),
  )
  if (missing.length) console.warn('[model] missing nodes:', missing)

  // Everything the GLB actually contains, so a renamed node is easy to spot.
  const actual: string[] = []
  ctx.scene.traverse((o) => {
    if (o.name) actual.push(o.name)
  })
  console.log('[model] all named nodes:', actual)

  // World placement of each node — the raw material for this level's camera
  // presets, which still hold the previous model's coordinates.
  const rows = EXPECTED_OBJECTS.map((name) => {
    const obj = ctx.scene.getObjectByName(name)
    if (!obj) return { node: name, found: false }
    const box = new THREE.Box3().setFromObject(obj)
    const c = box.getCenter(new THREE.Vector3())
    const s = box.getSize(new THREE.Vector3())
    const f = (n: number) => Number(n.toFixed(2))
    return {
      node: name,
      found: true,
      centre: `${f(c.x)}, ${f(c.y)}, ${f(c.z)}`,
      size: `${f(s.x)} × ${f(s.y)} × ${f(s.z)}`,
    }
  })
  console.table(rows)

  // Expose the scene for ad-hoc inspection from the console during the port.
  ;(window as unknown as { __ctx: SceneContext }).__ctx = ctx
}

// Fixed inspection viewpoints, named for the HVAC stage each one frames. The
// coordinates belong to this level's model; the first is the starting camera.
export const CAMERAS: CameraPreset[] = [
  {
    name: 'system_overview',
    position: { x: 6.29, y: 1.6, z: -12.54 },
    target: { x: 1.13, y: 2.98, z: 0.82 },
  },
  {
    name: 'supply_air',
    position: { x: 4.62, y: 1.43, z: -1.08 },
    target: { x: 4.17, y: 2.84, z: 0.71 },
  },
  {
    name: 'return_air',
    position: { x: 2.05, y: 0.19, z: -0.34 },
    target: { x: 2.05, y: 2.84, z: 0.71 },
  },
  {
    name: 'air_filter',
    position: { x: 2.01, y: 1.44, z: 0.68 },
    target: { x: 2.01, y: 3.13, z: 0.71 },
  },
]

// Stations you can look closer at — everything except the wide overview.
export const INSPECTABLE = ['supply_air', 'return_air', 'air_filter']

export type GameState =
  | 'overview'
  | 'measure_low'
  | 'locate_block'
  | 'move_wardrobe'
  | 'measure_ok'
  | 'complete'

/** What the player has actually done, independent of where the guided flow sits. */
export interface TaskProgress extends HudProgressBase {
  blockCleared: boolean
}

// GLB object each label rides on, its i18n key, and the steps it lights up on.
export const LABELS: LabelConfig[] = [
  {
    objectName: 'supply_duct',
    labelKey: 'label.supply',
    activeOnStates: ['measure_low', 'measure_ok'],
  },
  {
    objectName: 'wardrobe',
    labelKey: 'label.wardrobe',
    activeOnStates: ['locate_block', 'move_wardrobe'],
  },
]

// The checklist is keyed to real accomplishments, not the flow's position, so a
// task done out of order still ticks the moment it actually happens.
export const TASKS: TaskConfig<TaskProgress>[] = [
  { taskKey: 'task.check_supply', done: (p) => p.supplyMeasured },
  { taskKey: 'task.move_wardrobe', done: (p) => p.blockCleared },
  { taskKey: 'task.remeasure', done: (p) => p.airflowRechecked },
]

/**
 * Ordered flow for Problem 2 (blocked supply). The whole diagnosis happens at the
 * supply: measure low → notice the wardrobe → slide it aside → measure normal.
 *
 * Each `onAction` closes over the wardrobe, changes the world and then moves the
 * flow on itself — the engine never sees the prop. `isDone` covers the other
 * route: a direct click on the object changes the same world, and the poll picks
 * it up.
 */
export function createStateConfig(
  ctx: SceneContext,
  wardrobe: WardrobeApi,
): StateConfig<GameState> {
  return {
    order: ['overview', 'measure_low', 'locate_block', 'move_wardrobe', 'measure_ok', 'complete'],
    data: {
      overview: {
        hintKey: 'state.overview.hint',
        cameraPreset: 'system_overview',
        btnKey: 'state.overview.btn',
        isDone: () => activeCameraPreset() === 'supply_air',
        onAction: (flow) => {
          flyToCameraPresetByName(ctx, 'supply_air')
          flow.advance()
        },
      },
      measure_low: {
        hintKey: 'state.measure_low.hint',
        cameraPreset: 'supply_air',
        btnKey: 'state.measure.btn',
        measuring: true,
        // Airflow already healthy (wardrobe cleared early) → problem solved, so
        // skip the diagnose/clear steps straight to the finish.
        onAction: (flow) => (wardrobe.isMovedAway() ? flow.jumpTo('complete') : flow.advance()),
      },
      locate_block: {
        // No camera cut: we are already at the supply from measuring, and that
        // view frames the wardrobe — the label + highlight move onto it.
        hintKey: 'state.locate_block.hint',
        btnKey: 'state.locate_block.btn',
        // No onAction → the button just advances: "Look around" acknowledges.
      },
      move_wardrobe: {
        // Bound to the supply view for now (duct + wardrobe in frame). A dedicated
        // 'wardrobe' preset can be added later.
        hintKey: 'state.move_wardrobe.hint',
        cameraPreset: 'supply_air',
        btnKey: 'state.move_wardrobe.btn',
        isDone: () => wardrobe.isMovedAway(),
        onAction: (flow) => {
          wardrobe.moveAway()
          flow.advance()
        },
      },
      measure_ok: {
        // Shares the button key with measure_low — one "Measure" label, no dupe.
        hintKey: 'state.measure_ok.hint',
        cameraPreset: 'supply_air',
        btnKey: 'state.measure.btn',
        measuring: true,
        // Only finish once the airflow actually reads healthy; if the wardrobe
        // was put back the supply is blocked again, so wait until it's cleared.
        onAction: (flow) => {
          if (wardrobe.isMovedAway()) flow.advance()
        },
      },
      complete: {
        hintKey: 'state.complete.hint',
      },
    },
    // Airflow at the supply, in m/s. It depends on whether the supply is blocked,
    // not on the step: the wardrobe chokes the flow (low), moving it aside restores
    // it (healthy). The anemometer reads whichever is physically true when measured.
    airflow: { low: 0.7, ok: 2.5, normMin: 2, normMax: 3.5 },
  }
}

/** Tools in the inventory drawer; dragging one onto its object applies it. */
export function createTools(hud: ReadingTaker): Tool[] {
  return [
    {
      id: 'anemometer',
      labelKey: 'tool.anemometer',
      iconNode: 'anemometer',
      // The device parks on the supply grille while measuring, so accept either.
      targetNodes: ['supply_duct', 'anemometer'],
      usable: () => hud.canTakeReading(),
      apply: () => hud.takeReading(),
    },
  ]
}

/** Clickable objects: a click travels to them, then acts once already framed. */
export function createClickTargets(wardrobe: WardrobeApi, hud: ReadingTaker): ClickTarget[] {
  return [
    { objectName: 'supply_duct', preset: 'supply_air' },
    // The device only exists while measuring, and the step already parks the
    // camera on it — so a click is always its own button, never a trip.
    {
      objectName: 'anemometer',
      preset: 'supply_air',
      act: () => hud.takeReading(),
      canAct: () => hud.canTakeReading(),
    },
    // The wardrobe sits in the supply view, so from there a click is its own
    // button. It slides freely either way at any time — move it aside or put it
    // back — and the airflow reading tracks whichever side it ends up on.
    { objectName: 'wardrobe', preset: 'supply_air', act: () => wardrobe.toggle() },
  ]
}
