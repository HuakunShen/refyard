/**
* | output |
* | --- |
* | "Resolve these files outside Refyard, stage the results with the staging panel above, then continue. Nothing here edits a conflicted file." |
*
* @param {Conflict_Resolution_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_resolution_hint: ((inputs?: Conflict_Resolution_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Resolution_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Resolution_HintInputs = {};
