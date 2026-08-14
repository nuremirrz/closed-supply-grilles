import * as THREE from 'three'
import type { SceneContext } from '@hvac/engine'

const LOUVERS_NAME = 'louvers'
const LEVER_NAME = 'lever'

/**
 * How far the damper swings open, in radians about its local X.
 *
 * ── Measured in-scene ────────────────────────────────────────────────────────
 * `louvers` is a flat plate, 0.60 × 0.01 × 0.90, hinged at its own origin: the
 * geometry runs z −0.894…0.006, so the panel hangs off the origin edge in −z.
 * Rotating about local X therefore swings it like a flap: positive lifts the
 * far edge up and back into the ceiling recess, negative drops it down into the
 * room, where it hangs across the view and hides the register it just opened.
 * Up is the one that reads as "opened out of the way".
 *
 * 0.40 rad ≈ 23°: a damper cracked open, not thrown wide. Enough for the slots
 * behind it to read as uncovered and for the air to have somewhere to go, while
 * the plate keeps its face to the room rather than swinging up towards edge-on,
 * where it shrinks to a line and the movement stops being legible. To retune,
 * only this matters.
 */
const OPEN_ANGLE = 0.4

// Slower than the grille's slide: a damper on a hinge is a heavier thing than a
// panel sliding aside, and the lever needs to be readable while it turns.
const SWING_SECONDS = 0.9

// The lever is a 4 cm knob beside the plate. It holds no state of its own — it
// turns in step with the damper so the small, easily-missed control still reads
// as the thing that caused the movement.
const LEVER_TURN = 1.4

const smoothstep = (t: number) => t * t * (3 - 2 * t)

export interface LouversApi {
  /** Swings the damper open, uncovering the register. Idempotent while moving. */
  open: () => void
  /** Swings it the other way from where it is now. */
  toggle: () => void
  /** True only once it has fully swung open — not while it is still moving. */
  isOpen: () => boolean
  /** True once it has fully swung shut. Deliberately not `!isOpen()`, which
   *  would also be true mid-swing. */
  isClosed: () => boolean
}

/**
 * Owns the bedroom register's damper. Same shape as the grille and the wardrobe
 * in the other levels, but the motion is a rotation rather than a translation —
 * which the engine never learns: it only ever sees open()/toggle() and a boolean
 * back.
 *
 * The plate belongs to the player: they can swing it either way at any time, and
 * the scripted step just drives the same open() a click would.
 */
export function createLouvers(ctx: SceneContext): LouversApi {
  let plate: THREE.Object3D | null = null
  let lever: THREE.Object3D | null = null
  let plateHomeX = 0
  let leverHomeX = 0
  let progress = 0 // 0 = shut, 1 = fully open
  let target = 0

  // The GLB loads asynchronously, so keep retrying until the nodes show up; once
  // found we cache their resting rotations (the lever ships rotated by π).
  const resolve = () => {
    if (plate) return
    plate = ctx.scene.getObjectByName(LOUVERS_NAME) ?? null
    if (!plate) return
    plateHomeX = plate.rotation.x
    lever = ctx.scene.getObjectByName(LEVER_NAME) ?? null
    if (lever) leverHomeX = lever.rotation.x
  }

  ctx.onFrame((dt) => {
    resolve()
    if (progress === target || !plate) return
    const step = dt / SWING_SECONDS
    progress =
      target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step)
    const eased = smoothstep(progress)
    plate.rotation.x = plateHomeX + OPEN_ANGLE * eased
    if (lever) lever.rotation.x = leverHomeX + LEVER_TURN * eased
  })

  return {
    open: () => {
      resolve()
      target = 1
    },
    toggle: () => {
      resolve()
      target = target === 1 ? 0 : 1
    },
    isOpen: () => progress >= 1,
    isClosed: () => progress <= 0,
  }
}
