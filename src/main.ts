import {
  applyStartCamera,
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
import { createWardrobe } from './wardrobe'
import { dict } from './dictionary'
import {
  CAMERAS,
  INSPECTABLE,
  checkModelObjects,
  LABELS,
  TASKS,
  createClickTargets,
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
// Shared prop: the scripted button and a direct click both slide the wardrobe.
const wardrobe = createWardrobe(ctx)
// The flow's isDone/onAction close over the prop, so it is built after it.
const states = createStateConfig(ctx, wardrobe)
// 3D labels + active-object highlight, driven by the HUD's state changes.
const hints = createHints(ctx, LABELS)
// Level-complete result card (shown on the final state; Restart reloads).
const overlay = createResultOverlay()
const hud = createHud<GameState, TaskProgress>(ctx, {
  states,
  tasks: TASKS,
  isFaultCleared: () => wardrobe.isMovedAway(),
  progress: (base) => ({ ...base, blockCleared: wardrobe.isMovedAway() }),
  slug: 'blocked-duct',
  hints,
  overlay,
})
createInteractions(ctx, { clickTargets: createClickTargets(wardrobe, hud) })
// Bottom-right inventory drawer: drag the anemometer onto the supply to measure.
const inventory = createInventory(ctx, { tools: createTools(hud) })
loadModel(ctx, () => {
  checkModelObjects(ctx) // TEMPORARY: model-swap scaffolding, remove once P3 is wired
  hud.syncModel()
  cameraStrip.capture() // snapshot each preset now the model is in the scene
  inventory.syncModel() // render tool icons from the model
})
