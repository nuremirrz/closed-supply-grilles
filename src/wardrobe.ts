import * as THREE from 'three'
import type { SceneContext } from '@hvac/engine'

const WARDROBE_NAME = 'wardrobe'

/**
 * How the wardrobe rolls aside to clear the blocked supply.
 *
 * ── TUNED in-scene with the debug panel (2026-07-26) ─────────────────────────
 * The wardrobe is a double-door cabinet whose doors face world +X, and the brief
 * is: slide it the way the doors face. The measured geometry agrees:
 *   • wardrobe world AABB X[3.61..4.66] Z[0.73..2.40], 2.79 tall;
 *   • the supply vent it blocks: ceiling, X[3.90..4.44];
 *   • +X (door side) is open — exterior wall at X≈6.46, ceiling flat at 2.87;
 *   • −X is the cabinet's back, flush against the partition (no room that way).
 * Sliding +X by 0.90 moves its near edge 3.61→4.51, just past the vent's far edge
 * (4.44) so the supply clears, and its far edge 4.66→5.56 stops well short of the
 * +X wall (6.46). Direction and distance were dialled in on the debug panel.
 *
 * To retune: `axis` is the floor axis ('x' or 'z', never 'y'); `delta` is metres,
 * sign flips direction. On +X keep delta ≲ 1.8 (wall at 6.46) and ≥0.83 to clear
 * the vent.
 *
 * NB: this offsets the object's LOCAL position (like grille.ts), which equals its
 * world position here (parent is identity — local == world when measured), so 'x'
 * reads as a clean horizontal world move despite the wardrobe's own Y=90°.
 */
const MOVE_OFFSET: { axis: 'x' | 'z'; delta: number } = { axis: 'x', delta: 0.9 }

// Slide duration, matched to the grille's easing feel (~0.8s, smooth in/out).
const SLIDE_SECONDS = 0.8

const smoothstep = (t: number) => t * t * (3 - 2 * t)

export interface WardrobeApi {
  /** Rolls the wardrobe aside to uncover the supply. Idempotent while sliding. */
  moveAway: () => void
  /** Slides it the other way from where it is now: aside if home, home if aside. */
  toggle: () => void
  /** True only once it has fully slid aside — not while it is still moving. */
  isMovedAway: () => boolean
  /** Returns it to its original spot (e.g. for a restart). */
  reset: () => void
}

/**
 * Owns the wardrobe's slide-aside, by the same pattern as the grille: the object
 * belongs to the world, and both the scripted button and a direct click drive the
 * same move. Only `position` changes along the chosen axis — rotation is left
 * untouched, per spec.
 */
export function createWardrobe(ctx: SceneContext): WardrobeApi {
  let wardrobe: THREE.Object3D | null = null
  let homePos: THREE.Vector3 | null = null
  let progress = 0 // 0 = home, 1 = fully aside
  let target = 0

  // Local-space slide vector built from the tunable param above.
  const offset = new THREE.Vector3()
  offset[MOVE_OFFSET.axis] = MOVE_OFFSET.delta

  // The GLB loads asynchronously, so keep retrying until the node shows up; once
  // found we cache its home position.
  const resolve = () => {
    if (wardrobe) return
    wardrobe = ctx.scene.getObjectByName(WARDROBE_NAME) ?? null
    if (!wardrobe) return
    homePos = wardrobe.position.clone()
  }

  ctx.onFrame((dt) => {
    resolve() // resolve the node as soon as the model is in
    if (progress === target || !wardrobe || !homePos) return
    const step = dt / SLIDE_SECONDS
    progress =
      target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step)
    wardrobe.position.copy(homePos).addScaledVector(offset, smoothstep(progress))
  })

  return {
    moveAway: () => {
      resolve()
      target = 1
    },
    toggle: () => {
      resolve()
      target = target === 1 ? 0 : 1
    },
    isMovedAway: () => progress >= 1,
    reset: () => {
      target = 0
    },
  }
}
