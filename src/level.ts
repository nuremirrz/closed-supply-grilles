import {
  activeCameraPreset,
  type AirflowVisual,
  type CameraPreset,
  type ClickTarget,
  type HudProgressBase,
  type InspectApi,
  type LabelConfig,
  type ReadingTaker,
  type SceneContext,
  type StateConfig,
  type TaskConfig,
  type Tool,
} from '@hvac/engine'
import type { LouversApi } from './louvers'

// Fixed inspection viewpoints, named for the room each one frames. The
// coordinates belong to this level's model; the first is the starting camera.
// The return side plays no part in this problem, so it gets no station.
//
// Re-aimed for House_final3.glb. Both registers kept their size and their 2.84
// ceiling height, so each close-up keeps the framing it had: the camera offsets
// relative to the register each one looks at are the old ones, applied to the
// new positions. Only the wide shot needed fresh numbers — the house is deep now
// (7.7 across Z, was a near-flat 4.85).
export const CAMERAS: CameraPreset[] = [
  {
    name: 'system_overview',
    position: { x: 7, y: 6.5, z: -19 },
    target: { x: 3.4, y: 1.4, z: 0.7 },
  },
  {
    name: 'supply_air',
    position: { x: 7.27, y: 1.43, z: -1.07 },
    target: { x: 6.82, y: 2.84, z: 0.72 },
  },
  {
    // The bedroom register sits across the house at x ≈ 0.17. Framed from below
    // and slightly back, so the damper and its lever both sit in shot.
    name: 'supply_bedroom',
    position: { x: 0.15, y: 1.7, z: -0.55 },
    target: { x: 0.15, y: 2.82, z: 1.1 },
  },
]

// Stations you can look closer at — everything except the wide overview.
export const INSPECTABLE = ['supply_air', 'supply_bedroom']

/**
 * Props that ship in the shared house model but belong to another level's
 * problem. The wardrobe is Problem 2's blockage; here it only stands in the way
 * of the living-room register, so it is hidden rather than removed from the GLB.
 */
const FOREIGN_PROPS = ['wardrobe']

/** Hides the other levels' props. Call once the model has loaded. */
export function hideForeignProps(ctx: SceneContext): void {
  for (const name of FOREIGN_PROPS) {
    const obj = ctx.scene.getObjectByName(name)
    if (obj) obj.visible = false
  }
}

/**
 * Where the anemometer parks at each station, in world space. Both registers
 * are the same part mirrored across the house, so the device sits at the centre
 * of whichever one is being measured, hanging 0.14 m below the ceiling plane.
 * Without this it would stay at the living-room register the model shipped it
 * at, and the bedroom measurements would happen with no device in shot.
 */
const DEVICE_POSES: Record<string, { x: number; y: number; z: number }> = {
  supply_air: { x: 6.8, y: 2.7, z: 0.69 },
  supply_bedroom: { x: 0.16, y: 2.7, z: 0.68 },
}

/** Carries the device to the register the camera is at. */
export function createDevicePose(): () => { x: number; y: number; z: number } | null {
  return () => DEVICE_POSES[activeCameraPreset() ?? ''] ?? null
}

/** Airflow at a register, in m/s. Healthy band is 2–3.5 (see the state config). */
const FLOW_HEALTHY = 2.5
/** With the bedroom damper shut, its share is forced through the living room. */
const FLOW_OVER = 4.2
/** A shut damper passes nothing at all. */
const FLOW_NONE = 0

export type GameState =
  | 'overview'
  | 'measure_living'
  | 'goto_bedroom'
  | 'measure_bedroom'
  | 'locate_louvers'
  | 'open_louvers'
  | 'measure_ok'
  | 'recheck_living'
  | 'complete'

/** What the player has actually done, independent of where the guided flow sits. */
export interface TaskProgress extends HudProgressBase {
  louversOpen: boolean
}

/** A supply register: its node in the GLB, the station framing it, its airflow. */
interface Register {
  node: string
  preset: string
  flow: () => number
}

/**
 * How much air each register passes right now — the level's single source of
 * truth, feeding both the device and the visible stream so the two can never
 * disagree.
 *
 * The shut bedroom damper forces its share through the living-room register, so
 * that one runs above the norm while the bedroom passes nothing. Opening the
 * damper balances both back to healthy.
 */
export function createRegisters(louvers: LouversApi): Register[] {
  return [
    {
      node: 'supply_bedroom1',
      preset: 'supply_air',
      flow: () => (louvers.isOpen() ? FLOW_HEALTHY : FLOW_OVER),
    },
    {
      node: 'supply_bedroom',
      preset: 'supply_bedroom',
      flow: () => (louvers.isOpen() ? FLOW_HEALTHY : FLOW_NONE),
    },
  ]
}

/** What the device reads: the flow at whichever register the camera is at. */
export function createReading(registers: readonly Register[]): () => number {
  return () => registers.find((r) => r.preset === activeCameraPreset())?.flow() ?? FLOW_HEALTHY
}

/** Visible streams at both registers, off the same flows. */
export function createAirflowConfig(registers: readonly Register[]): AirflowVisual[] {
  return registers.map((r) => ({ objectName: r.node, flow: r.flow }))
}

// GLB object each label rides on, its i18n key, and the steps it lights up on.
export const LABELS: LabelConfig[] = [
  {
    objectName: 'supply_bedroom1',
    labelKey: 'label.supply',
    activeOnStates: ['measure_living', 'recheck_living'],
  },
  {
    objectName: 'supply_bedroom',
    labelKey: 'label.bedroom',
    activeOnStates: ['goto_bedroom', 'measure_bedroom', 'locate_louvers', 'measure_ok'],
  },
  { objectName: 'louvers', labelKey: 'label.louvers', activeOnStates: ['open_louvers'] },
]

// The checklist is keyed to real accomplishments, not the flow's position, so a
// task done out of order — e.g. opening the damper before ever measuring —
// still ticks the moment it actually happens.
export const TASKS: TaskConfig<TaskProgress>[] = [
  { taskKey: 'task.measure', done: (p) => p.supplyMeasured },
  { taskKey: 'task.open_louvers', done: (p) => p.louversOpen },
  { taskKey: 'task.remeasure', done: (p) => p.airflowRechecked },
]

/**
 * Ordered flow for Problem 3 (closed supply grilles). The diagnosis is a
 * comparison: the living-room register reads high, the bedroom one reads
 * nothing, and the difference is what points at the shut damper.
 *
 * Each `onAction` closes over the level's own prop, changes the world and then
 * moves the flow on itself — the engine never sees a damper. `isDone` covers the
 * other route: a direct click on the object changes the same world, and the poll
 * picks it up.
 */
export function createStateConfig(
  louvers: LouversApi,
  inspect: InspectApi,
): StateConfig<GameState> {
  return {
    order: [
      'overview',
      'measure_living',
      'goto_bedroom',
      'measure_bedroom',
      'locate_louvers',
      'open_louvers',
      'measure_ok',
      'recheck_living',
      'complete',
    ],
    data: {
      overview: {
        hintKey: 'state.overview.hint',
        cameraPreset: 'system_overview',
        // Getting to the living-room register is the step: click it or take the
        // camera strip there.
        isDone: () => activeCameraPreset() === 'supply_air',
      },
      measure_living: {
        hintKey: 'state.measure_living.hint',
        cameraPreset: 'supply_air',
        measuring: true,
        // Reads healthy already → the damper was opened before diagnosing, so
        // there is nothing left to find.
        onAction: (flow) => (louvers.isOpen() ? flow.jumpTo('complete') : flow.advance()),
      },
      goto_bedroom: {
        hintKey: 'state.goto_bedroom.hint',
        isDone: () => activeCameraPreset() === 'supply_bedroom',
      },
      measure_bedroom: {
        hintKey: 'state.measure_bedroom.hint',
        cameraPreset: 'supply_bedroom',
        measuring: true,
        // The reading's own "continue" press advances once the zero is on screen.
      },
      locate_louvers: {
        // No camera cut: we are already at the bedroom register from measuring.
        // The step is the close-up itself, so it ends when the player is in it —
        // they have to reach for "Inspect" in the breadcrumbs themselves.
        hintKey: 'state.locate_louvers.hint',
        isDone: () => inspect.isInspecting(),
      },
      open_louvers: {
        // Deliberately no cameraPreset: a preset flight would count as leaving
        // the closer look and drop us straight back out of it. The damper is
        // opened from the close-up, where the lever is actually legible — and
        // reaching for that lever is now the only way through.
        hintKey: 'state.open_louvers.hint',
        isDone: () => louvers.isOpen(),
      },
      measure_ok: {
        // The preset pulls back out of the close-up.
        hintKey: 'state.measure_ok.hint',
        cameraPreset: 'supply_bedroom',
        measuring: true,
        // Only move on once the air is actually flowing; if the damper was swung
        // shut again the bedroom is starved, so wait until it is open.
        onAction: (flow) => {
          if (louvers.isOpen()) flow.advance()
        },
      },
      recheck_living: {
        // Back to where the diagnosis started: the register that read 4.2 should
        // now read normal, which is what proves the system is balanced rather
        // than just the bedroom unblocked. The preset carries the camera there.
        hintKey: 'state.recheck_living.hint',
        cameraPreset: 'supply_air',
        measuring: true,
      },
      complete: {
        hintKey: 'state.complete.hint',
      },
    },
    // Healthy band, in m/s. What the device reads is createReading() above:
    // 4.2 at the living room and 0 in the bedroom while the damper is shut, 2.5
    // at both once it is open. Above the band counts as a fault too.
    airflow: { normMin: 2, normMax: 3.5 },
  }
}

/** Tools in the inventory drawer; dragging one onto its object applies it. */
export function createTools(hud: ReadingTaker): Tool[] {
  return [
    {
      id: 'anemometer',
      labelKey: 'tool.anemometer',
      iconNode: 'anemometer',
      // Either register is a valid place to hold the device, plus the device
      // itself once it is parked.
      targetNodes: ['supply_bedroom1', 'supply_bedroom', 'anemometer'],
      usable: () => hud.canTakeReading(),
      apply: () => hud.takeReading(),
    },
  ]
}

/** Clickable objects: a click travels to them, then acts once already framed. */
export function createClickTargets(louvers: LouversApi, hud: ReadingTaker): ClickTarget[] {
  return [
    { objectName: 'supply_bedroom1', preset: 'supply_air' },
    { objectName: 'supply_bedroom', preset: 'supply_bedroom' },
    // The device only exists while measuring, and the step already parks the
    // camera on it — so a click is always its own button, never a trip.
    {
      objectName: 'anemometer',
      preset: 'supply_air',
      // The device travels between registers, so wherever it is standing is a
      // place a click means "read", never "travel".
      redundantFrom: ['supply_bedroom'],
      act: () => hud.takeReading(),
      canAct: () => hud.canTakeReading(),
    },
    // Damper and lever are one control: the plate is the big target, the lever
    // is the small one the client actually reaches for. Both swing it either
    // way at any time, and the reading tracks whichever side it ends up on.
    { objectName: 'louvers', preset: 'supply_bedroom', act: () => louvers.toggle() },
    { objectName: 'lever', preset: 'supply_bedroom', act: () => louvers.toggle() },
  ]
}
