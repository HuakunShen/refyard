/**
* | output |
* | --- |
* | "Working copies" |
*
* @param {Wip_Working_CopiesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_working_copies: ((inputs?: Wip_Working_CopiesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Wip_Working_CopiesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Wip_Working_CopiesInputs = {};
