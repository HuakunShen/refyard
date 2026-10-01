/**
* | output |
* | --- |
* | "Waiting for authorization…" |
*
* @param {Pr_WaitingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_waiting: ((inputs?: Pr_WaitingInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pr_WaitingInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pr_WaitingInputs = {};
