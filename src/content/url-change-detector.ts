// This script runs in the page's main world (not isolated content script world)
// It intercepts history API calls and dispatches events for the content script

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
