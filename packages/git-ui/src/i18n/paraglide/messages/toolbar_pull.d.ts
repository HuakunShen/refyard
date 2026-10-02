/**
* | output |
* | --- |
* | "Pull" |
*
* @param {Toolbar_PullInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_pull: ((inputs?: Toolbar_PullInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Toolbar_PullInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Toolbar_PullInputs = {};
