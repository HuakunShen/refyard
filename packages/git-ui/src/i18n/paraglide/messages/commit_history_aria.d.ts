/**
* | output |
* | --- |
* | "Commit history — arrow keys move the selection" |
*
* @param {Commit_History_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_history_aria: ((inputs?: Commit_History_AriaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_History_AriaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_History_AriaInputs = {};
