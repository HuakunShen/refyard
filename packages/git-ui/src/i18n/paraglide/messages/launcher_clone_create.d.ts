/**
* | output |
* | --- |
* | "Clone / Create" |
*
* @param {Launcher_Clone_CreateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_clone_create: ((inputs?: Launcher_Clone_CreateInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Clone_CreateInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Clone_CreateInputs = {};
