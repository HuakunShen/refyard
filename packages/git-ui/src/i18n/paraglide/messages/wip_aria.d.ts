/**
* | output |
* | --- |
* | "Worktree changes" |
*
* @param {Wip_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_aria: ((inputs?: Wip_AriaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Wip_AriaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Wip_AriaInputs = {};
