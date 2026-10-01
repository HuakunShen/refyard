/**
* | output |
* | --- |
* | "Edit…" |
*
* @param {Common_Edit_EllipsisInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_edit_ellipsis: ((inputs?: Common_Edit_EllipsisInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Common_Edit_EllipsisInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Common_Edit_EllipsisInputs = {};
