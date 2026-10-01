/**
* | output |
* | --- |
* | "Add submodule" |
*
* @param {Submodule_AddInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const submodule_add: ((inputs?: Submodule_AddInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Submodule_AddInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Submodule_AddInputs = {};
