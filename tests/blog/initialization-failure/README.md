# Blog initialization failure

The unit case returns a sidebar controller and then makes view initialization fail. It verifies that the returned sidebar is released, page listeners are aborted, and the ready marker is not left behind.

A separate lifecycle case verifies that disposal disables the controls, restores access to mobile tags, and returns the page-size menu to its owning page. A later mount enables the controls again.
