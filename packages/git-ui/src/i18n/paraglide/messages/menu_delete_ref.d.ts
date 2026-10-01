/**
* | output |
* | --- |
* | "Delete…" |
*
* @param {Menu_Delete_RefInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_delete_ref: ((inputs?: Menu_Delete_RefInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Delete_RefInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Delete_RefInputs = {};
