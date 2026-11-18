/** Ansichten der Momo-Galerie (#187): Momo außerhalb der Insel in 104 dp oder im Insel-Canvas. */
export const momoGalleryViews = ['heute', 'insel'] as const;
export type MomoGalleryView = (typeof momoGalleryViews)[number];
