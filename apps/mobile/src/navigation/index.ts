// Navigation der App-Shell (#101): Routenkatalog, Links aus `RouteTarget` und Routendateien, die
// ihre Parameter mit den Schemas aus `@abnehm/contracts/routes` prüfen.

export { hrefFor, targetFromLink, type LinkParams, type RouteHref } from './href';
export { modalScreens, ownerOf, pathOf, routeCatalog, type Owner, type Presentation } from './route-catalog';
export { closeRoute, openTarget, routeScreen, type RouteScreenProps, type TargetOf } from './route-screen';
