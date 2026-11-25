// Bump when the saved shape of TasSnapshot changes (draftShape.test.ts fails until you do):
// a draft from another version is then offered only to discard, never resumed half-filled.
// Kept free of imports so the screenshot script can read it outside the app.
export const DRAFT_UI_VERSION = 5;
