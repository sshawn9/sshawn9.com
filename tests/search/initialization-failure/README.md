# Search initialization failure

The view case makes `IntersectionObserver.observe()` fail after the keyboard listener and observer have been created. It keeps the original exception, disconnects the half-created observer, aborts the listener signal, and confirms a new view can be created afterwards.

The controller case makes search startup fail while `view.destroy()` also fails. It verifies that Pagefind is still released, the local fallback becomes visible, and the reported aggregate retains the startup error.
