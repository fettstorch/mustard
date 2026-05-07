// Runs in the page's main world (not isolated content script world).
// Intercepts history API calls and dispatches events for the content script.
// web_accessible_resources is declared in wxt.config.ts so content scripts can inject this script.
export default defineUnlistedScript({
  main() {
    const originalPushState = history.pushState.bind(history)
    const originalReplaceState = history.replaceState.bind(history)

    history.pushState = function (...args) {
      originalPushState(...args)
      window.dispatchEvent(new CustomEvent('mustard-url-change'))
    }

    history.replaceState = function (...args) {
      originalReplaceState(...args)
      window.dispatchEvent(new CustomEvent('mustard-url-change'))
    }
  },
})
