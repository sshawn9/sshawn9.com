# Blog initialization failure

The unit case returns a sidebar controller and then makes view initialization fail. It verifies that the returned sidebar is released, page listeners are aborted, and the ready marker is not left behind.

The page-size popup is also released: its listeners are aborted, the trigger stays disabled, and the portaled menu is restored to its owning page. A later mount enables the controls again.
