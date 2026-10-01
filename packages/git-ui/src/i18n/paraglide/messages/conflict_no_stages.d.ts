/**
* | output |
* | --- |
* | "no stages read" |
*
* @param {Conflict_No_StagesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_no_stages: ((inputs?: Conflict_No_StagesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_No_StagesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_No_StagesInputs = {};
