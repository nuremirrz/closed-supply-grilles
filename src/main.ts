import {
  applyStartCamera,
  createAirflowVisuals,
  createBreadcrumbs,
  createCameraStrip,
  createHints,
  createHud,
  createInspect,
  createInteractions,
  createInventory,
  createResultOverlay,
  createScene,
  getInitialLang,
  getLang,
  initCameraMotion,
  initLocaleBridge,
  loadModel,
  onChange,
  registerDictionary,
  setLang,
  t,
} from '@hvac/engine'
import { createLouvers } from './louvers'
import { dict } from './dictionary'
import {
  CAMERAS,
  INSPECTABLE,
  LABELS,
  TASKS,
  createClickTargets,
  createAirflowConfig,
  createDevicePose,
  createReading,
  createRegisters,
  hideForeignProps,
  createStateConfig,
  createTools,
  type GameState,
  type TaskProgress,
} from './level'

const container = document.getElementById('app')
if (!container) {
  throw new Error('Missing #app container in index.html')
}

// Dictionary first of all: the engine ships no strings, and registering does not
// re-render what is already on screen — so nothing may call t() before this.
registerDictionary(dict)

// Locale next, before anything renders: ?lang=… sets the initial locale, and a
// trusted embedding parent can switch it live over postMessage.
setLang(getInitialLang())
initLocaleBridge()

// Keep the tab title and <html lang> in sync with the active locale.
const applyDocumentMeta = () => {
  document.title = t('ui.docTitle')
  document.documentElement.lang = getLang()
}
applyDocumentMeta()
onChange(applyDocumentMeta)

// Boot the scene, start on the overview camera (before the first frame), mount
// the gameplay HUD, then load the model.
const ctx = createScene(container, { cameras: CAMERAS, inspectable: INSPECTABLE })
initCameraMotion(ctx)
applyStartCamera(ctx)
// Bottom-left camera strip: thumbnail per preset (stills captured after load).
const cameraStrip = createCameraStrip(ctx)
// "Look closer" inspect view + top-center breadcrumbs that reflect the location.
const inspect = createInspect(ctx)
createBreadcrumbs(ctx, inspect)
// Shared prop: the scripted button and a direct click both swing the damper.
const louvers = createLouvers(ctx)
// The flow's isDone/onAction close over the prop and the closer-look view, so
// it is built after both.
// How much air each register passes; the device and the visible stream share it.
const registers = createRegisters(louvers)
const states = createStateConfig(ctx, louvers, inspect)
// 3D labels + active-object highlight, driven by the HUD's state changes.
const hints = createHints(ctx, LABELS)
// Level-complete result card (shown on the final state; Restart reloads).
const overlay = createResultOverlay()
const hud = createHud<GameState, TaskProgress>(ctx, {
  states,
  tasks: TASKS,
  reading: createReading(registers),
  devicePose: createDevicePose(),
  progress: (base) => ({ ...base, louversOpen: louvers.isOpen() }),
  slug: 'closed-supply-grilles',
  hints,
  overlay,
})
// Visible airflow out of both registers, so the starved one reads as dead.
createAirflowVisuals(ctx, createAirflowConfig(registers))
createInteractions(ctx, { clickTargets: createClickTargets(louvers, hud) })
// Bottom-right inventory drawer: drag the anemometer onto either register.
const inventory = createInventory(ctx, { tools: createTools(hud) })
loadModel(ctx, () => {
  hideForeignProps(ctx) // the wardrobe belongs to Problem 2, not to this one
  hud.syncModel()
  cameraStrip.capture() // snapshot each preset now the model is in the scene
  inventory.syncModel() // render tool icons from the model
})
