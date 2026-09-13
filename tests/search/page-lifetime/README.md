# Search tasks and index ownership

The search page owns each query and its Pagefind instance. Empty queries are handled locally. A result may commit only to the task that requested it, even if the engine loads late. Leaving the page invalidates work and releases its index; re-entry cannot retain an old instance or lose the new one to old cleanup.

Browser cases cover cold-load typing, repeated client-side entry and exit, leaving before the module loads, leaving while the Worker initializes, and returning before an old query settles. They use the actual generated Pagefind runtime and observe its Worker messages. Pending queries settle before destruction so they cannot register result data after cleanup. The section-selection unit case preserves the existing three strongest matches in document order without repeating the main page.

Existing search cases continue to cover atomic card replacement, failure fallback, keyboard navigation, IME, URL state, deployment cache identity, and scroll restoration. Timing is measured separately, not asserted against a machine-dependent CI threshold.
