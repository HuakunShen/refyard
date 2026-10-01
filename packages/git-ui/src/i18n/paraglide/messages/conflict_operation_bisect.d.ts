/**
* | output |
* | --- |
* | "bisect" |
*
* @param {Conflict_Operation_BisectInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_bisect: ((inputs?: Conflict_Operation_BisectInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Operation_BisectInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Operation_BisectInputs = {};
