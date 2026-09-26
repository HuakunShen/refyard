/**
* | output |
* | --- |
* | "Open" |
*
* @param {Launcher_Open_ActionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_open_action: ((inputs?: Launcher_Open_ActionInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Open_ActionInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Open_ActionInputs = {};
