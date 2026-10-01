/**
* | output |
* | --- |
* | "Diff view" |
*
* @param {Diff_ViewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const diff_view: ((inputs?: Diff_ViewInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Diff_ViewInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Diff_ViewInputs = {};
